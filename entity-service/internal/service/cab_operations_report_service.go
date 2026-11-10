// Copyright (c) 2026 WSO2 LLC. (https://www.wso2.com).
//
// WSO2 LLC. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

package service

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/wso2-open-operations/cs-tools/entity-service/internal/apierror"
	"github.com/wso2-open-operations/cs-tools/entity-service/internal/domain"
	"github.com/wso2-open-operations/cs-tools/entity-service/internal/repository"
)

// CABOperationsReportService builds the CAB operations report
// (GET /reports/cab-operations).
type CABOperationsReportService interface {
	BuildReport(ctx context.Context, req domain.CABOperationsReportRequest) (domain.CABOperationsReport, error)
}

// cabReportDefaultMonths is how many calendar months the report covers when the
// caller names no period: this month and the three before it.
const cabReportDefaultMonths = 4

// cabReportWeeklyTeams is how many teams the weekly series breaks out.
const cabReportWeeklyTeams = 5

// cabReportTopRequesters is how many requesters the report lists.
const cabReportTopRequesters = 10

// cabReportMonthTopTeams is how many teams each month lists.
const cabReportMonthTopTeams = 3

type cabOperationsReportService struct {
	repo   repository.CABOperationsReportRepository
	access AccessService
	now    func() time.Time
}

// NewCABOperationsReportService constructs a CABOperationsReportService. The
// route is internal callers only; BuildReport checks it again (access may be nil
// in tests that build the service directly, which then skips the check).
func NewCABOperationsReportService(repo repository.CABOperationsReportRepository, access AccessService) CABOperationsReportService {
	return &cabOperationsReportService{repo: repo, access: access, now: time.Now}
}

// BuildReport implements CABOperationsReportService.
func (s *cabOperationsReportService) BuildReport(ctx context.Context, req domain.CABOperationsReportRequest) (domain.CABOperationsReport, error) {
	if s.access != nil {
		if err := RequireInternalCaller(ctx, s.access, "the CAB operations report is only available to internal callers"); err != nil {
			return domain.CABOperationsReport{}, err
		}
	}
	now := s.now().UTC()
	from, to, err := cabReportPeriod(req, now)
	if err != nil {
		return domain.CABOperationsReport{}, err
	}
	changes, err := s.repo.ListCABChanges(ctx, from, to.AddDate(0, 0, 1))
	if err != nil {
		return domain.CABOperationsReport{}, err
	}
	members, err := s.repo.ListCABMembers(ctx)
	if err != nil {
		return domain.CABOperationsReport{}, err
	}
	return buildCABOperationsReport(changes, members, from, to, now), nil
}

// cabReportPeriod resolves the inclusive period [from, to] (UTC midnights) from
// the request: both optional YYYY-MM-DD dates; to defaults to today, from to the
// first day of the month cabReportDefaultMonths-1 months before to's month. from
// after to, an unparseable date, or more than domain.CABOperationsMaxMonths
// calendar months (counting both ends' months) is a 400.
func cabReportPeriod(req domain.CABOperationsReportRequest, now time.Time) (time.Time, time.Time, error) {
	parse := func(name, v string) (time.Time, error) {
		t, err := time.Parse("2006-01-02", strings.TrimSpace(v))
		if err != nil {
			return time.Time{}, &apierror.ValidationError{Msg: name + " must be a date (YYYY-MM-DD)"}
		}
		return t, nil
	}
	to := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	if strings.TrimSpace(req.To) != "" {
		t, err := parse("to", req.To)
		if err != nil {
			return time.Time{}, time.Time{}, err
		}
		to = t
	}
	from := time.Date(to.Year(), to.Month()-(cabReportDefaultMonths-1), 1, 0, 0, 0, 0, time.UTC)
	if strings.TrimSpace(req.From) != "" {
		f, err := parse("from", req.From)
		if err != nil {
			return time.Time{}, time.Time{}, err
		}
		from = f
	}
	if from.After(to) {
		return time.Time{}, time.Time{}, &apierror.ValidationError{Msg: "from must not be after to"}
	}
	if months := cabMonthIndex(to) - cabMonthIndex(from) + 1; months > domain.CABOperationsMaxMonths {
		return time.Time{}, time.Time{}, &apierror.ValidationError{
			Msg: fmt.Sprintf("the period can cover at most %d calendar months", domain.CABOperationsMaxMonths)}
	}
	return from, to, nil
}

func cabMonthIndex(t time.Time) int { return t.Year()*12 + int(t.Month()) - 1 }

// cabModelBucket maps change_request.change_model to the report's buckets.
func cabModelBucket(model string) string {
	switch strings.ToUpper(strings.TrimSpace(model)) {
	case "NORMAL":
		return domain.CABOperationsModelNormal
	case "STANDARD":
		return domain.CABOperationsModelStandard
	case "EMERGENCY":
		return domain.CABOperationsModelEmergency
	}
	return domain.CABOperationsModelOther
}

// addModel counts one change request of model bucket in m.
func addModel(m *domain.CABOperationsModelCounts, bucket string) {
	switch bucket {
	case domain.CABOperationsModelNormal:
		m.Normal++
	case domain.CABOperationsModelStandard:
		m.Standard++
	case domain.CABOperationsModelEmergency:
		m.Emergency++
	default:
		m.Other++
	}
}

// cabApprovalRate is approved / (approved + rejected), nil when none was decided.
func cabApprovalRate(approved, rejected int) *float64 {
	if approved+rejected == 0 {
		return nil
	}
	r := float64(approved) / float64(approved+rejected)
	return &r
}

// cabDecision is what the report reads from a change request's latest CAB stage.
type cabDecision struct {
	outcome   domain.CABOperationsOutcome
	decidedBy string
	decidedOn *time.Time
}

// cabStageDecision resolves a change's outcome from its latest CAB stage, with
// the approvals list's own rule (one rejection makes the stage rejected, else one
// approval makes it approved): rejected names the rejecting member (the latest
// rejection), approved the first to approve. Undecided, it is pending while the
// change waits in Authorize, cancelled otherwise.
func cabStageDecision(c repository.CABChangeRecord) cabDecision {
	stage := c.Stages[len(c.Stages)-1]
	var rejected, approved *repository.CABApproverRecord
	for i := range stage.Approvers {
		a := &stage.Approvers[i]
		switch a.State {
		case "REJECTED":
			if rejected == nil || a.UpdatedOn.After(rejected.UpdatedOn) {
				rejected = a
			}
		case "APPROVED":
			if approved == nil || a.UpdatedOn.Before(approved.UpdatedOn) {
				approved = a
			}
		}
	}
	switch {
	case rejected != nil:
		t := rejected.UpdatedOn
		return cabDecision{outcome: domain.CABOperationsOutcomeRejected, decidedBy: cabPersonName(rejected.Name, rejected.Email), decidedOn: &t}
	case approved != nil:
		t := approved.UpdatedOn
		return cabDecision{outcome: domain.CABOperationsOutcomeApproved, decidedBy: cabPersonName(approved.Name, approved.Email), decidedOn: &t}
	case strings.EqualFold(c.State, "AUTHORIZE"):
		return cabDecision{outcome: domain.CABOperationsOutcomePending}
	}
	return cabDecision{outcome: domain.CABOperationsOutcomeCancelled}
}

func cabPersonName(name, email string) string {
	if strings.TrimSpace(name) != "" {
		return strings.TrimSpace(name)
	}
	return strings.TrimSpace(email)
}

func cabCount(counts *domain.CABOperationsCounts, c repository.CABChangeRecord, d cabDecision) {
	counts.Total++
	switch d.outcome {
	case domain.CABOperationsOutcomeApproved:
		counts.Approved++
	case domain.CABOperationsOutcomeRejected:
		counts.Rejected++
	case domain.CABOperationsOutcomePending:
		counts.Pending++
	default:
		counts.Cancelled++
	}
	if c.Environment == "PRIMARY_PRODUCTION" {
		counts.Prod++
	}
	if c.OutageDeclared {
		counts.OutageDeclared++
	}
	addModel(&counts.ByModel, cabModelBucket(c.Model))
}

func optionalID(id string) *string {
	if id == "" {
		return nil
	}
	return &id
}

func rfc3339(t time.Time) string { return t.UTC().Format(time.RFC3339) }

func rfc3339Ptr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := rfc3339(*t)
	return &s
}

// cabTeamTally is one assignment group's running figures; id "" is "no
// assignment group".
type cabTeamTally struct {
	id, name           string
	total              int
	approved, rejected int
	outage             int
	standard           int
	emergency          int
}

func cabTeamName(id, name string) string {
	if id == "" {
		return "No team"
	}
	if strings.TrimSpace(name) == "" {
		return "Unnamed team"
	}
	return name
}

// sortedTeamCounts returns the teams of tally as named counts, highest first
// (then by name), at most limit (0: all).
func sortedTeamCounts(tally map[string]*cabTeamTally, limit int) []domain.CABOperationsNamedCount {
	out := make([]domain.CABOperationsNamedCount, 0, len(tally))
	for _, t := range tally {
		out = append(out, domain.CABOperationsNamedCount{ID: optionalID(t.id), Name: cabTeamName(t.id, t.name), Count: t.total})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Name < out[j].Name
	})
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out
}

func tallyTeam(m map[string]*cabTeamTally, c repository.CABChangeRecord, d cabDecision) {
	t := m[c.AssignmentGroupID]
	if t == nil {
		t = &cabTeamTally{id: c.AssignmentGroupID, name: c.AssignmentGroup}
		m[c.AssignmentGroupID] = t
	}
	t.total++
	switch d.outcome {
	case domain.CABOperationsOutcomeApproved:
		t.approved++
	case domain.CABOperationsOutcomeRejected:
		t.rejected++
	}
	if c.OutageDeclared {
		t.outage++
	}
	switch cabModelBucket(c.Model) {
	case domain.CABOperationsModelStandard:
		t.standard++
	case domain.CABOperationsModelEmergency:
		t.emergency++
	}
}

// buildCABOperationsReport works out every figure of the report from the
// period's change requests. from and to are the inclusive period's first and
// last days (UTC midnights); now decides the ongoing month. Pure: no I/O.
//
// A change request counts once, on the day its latest CAB stage was created
// (asked on). Its outcome is that stage's (cabStageDecision). The approver
// workload and the pushback cover every CAB stage of each change request (a
// rejection before a resubmission is pushback too).
func buildCABOperationsReport(changes []repository.CABChangeRecord, members []domain.CABOperationsMember, from, to, now time.Time) domain.CABOperationsReport {
	now = now.UTC()
	report := domain.CABOperationsReport{
		From:         from.Format("2006-01-02"),
		To:           to.Format("2006-01-02"),
		GeneratedOn:  rfc3339(now),
		CurrentMonth: now.Format("2006-01"),
		CABMembers:   members,
	}
	if report.CABMembers == nil {
		report.CABMembers = []domain.CABOperationsMember{}
	}

	// Calendar: every month, day and ISO week of the period, zero-filled.
	monthIdx := map[string]int{}
	for m := time.Date(from.Year(), from.Month(), 1, 0, 0, 0, 0, time.UTC); !m.After(to); m = m.AddDate(0, 1, 0) {
		key := m.Format("2006-01")
		monthIdx[key] = len(report.Months)
		report.Months = append(report.Months, domain.CABOperationsMonth{Month: key, Ongoing: key == report.CurrentMonth})
	}
	dayIdx := map[string]int{}
	for d := from; !d.After(to); d = d.AddDate(0, 0, 1) {
		key := d.Format("2006-01-02")
		dayIdx[key] = len(report.Daily)
		report.Daily = append(report.Daily, domain.CABOperationsDay{Day: key})
	}
	weekIdx := map[string]int{}
	for w := cabWeekStart(from); !w.After(to); w = w.AddDate(0, 0, 7) {
		key := w.Format("2006-01-02")
		weekIdx[key] = len(report.Weekly)
		report.Weekly = append(report.Weekly, domain.CABOperationsWeek{WeekStart: key})
	}

	type decided struct {
		c repository.CABChangeRecord
		d cabDecision
		// askedOn is the latest CAB stage's created_on.
		askedOn time.Time
	}
	rows := make([]decided, 0, len(changes))
	for _, c := range changes {
		if len(c.Stages) == 0 {
			continue
		}
		askedOn := c.Stages[len(c.Stages)-1].CreatedOn.UTC()
		day := time.Date(askedOn.Year(), askedOn.Month(), askedOn.Day(), 0, 0, 0, 0, time.UTC)
		if day.Before(from) || day.After(to) {
			continue
		}
		rows = append(rows, decided{c: c, d: cabStageDecision(c), askedOn: askedOn})
	}

	allTeams := map[string]*cabTeamTally{}
	monthTeams := map[string]map[string]*cabTeamTally{}
	customers := map[string]*domain.CABOperationsCustomer{}
	requesters := map[string]*domain.CABOperationsRequester{}
	approvers := map[string]*domain.CABOperationsApprover{}
	var pushback []domain.CABOperationsPushbackItem

	for _, r := range rows {
		c, d := r.c, r.d
		bucket := cabModelBucket(c.Model)
		cabCount(&report.Totals.CABOperationsCounts, c, d)

		mKey := r.askedOn.Format("2006-01")
		if i, ok := monthIdx[mKey]; ok {
			cabCount(&report.Months[i].CABOperationsCounts, c, d)
			if monthTeams[mKey] == nil {
				monthTeams[mKey] = map[string]*cabTeamTally{}
			}
			tallyTeam(monthTeams[mKey], c, d)
		}
		if i, ok := dayIdx[r.askedOn.Format("2006-01-02")]; ok {
			day := &report.Daily[i]
			day.Total++
			switch d.outcome {
			case domain.CABOperationsOutcomeApproved:
				day.Approved++
			case domain.CABOperationsOutcomeRejected:
				day.Rejected++
			}
			if c.Environment == "PRIMARY_PRODUCTION" {
				day.Prod++
			}
			if c.OutageDeclared {
				day.OutageDeclared++
			}
			switch bucket {
			case domain.CABOperationsModelStandard:
				day.Standard++
			case domain.CABOperationsModelEmergency:
				day.Emergency++
			}
		}
		tallyTeam(allTeams, c, d)

		cust := customers[c.AccountID]
		if cust == nil {
			name := c.AccountName
			if c.AccountID == "" {
				name = "No customer"
			}
			cust = &domain.CABOperationsCustomer{AccountID: optionalID(c.AccountID), Name: name}
			customers[c.AccountID] = cust
		}
		cust.Total++
		switch d.outcome {
		case domain.CABOperationsOutcomeApproved:
			cust.Approved++
		case domain.CABOperationsOutcomeRejected:
			cust.Rejected++
		}
		switch bucket {
		case domain.CABOperationsModelStandard:
			cust.Standard++
		case domain.CABOperationsModelEmergency:
			cust.Emergency++
		}

		if c.RequestedByID != "" {
			req := requesters[c.RequestedByID]
			if req == nil {
				req = &domain.CABOperationsRequester{UserID: c.RequestedByID, Name: c.RequestedByName}
				requesters[c.RequestedByID] = req
			}
			req.Total++
		}

		// Every CAB stage's approver rows: workload, pushback, latest comment.
		var latestComment *repository.CABApproverRecord
		for _, st := range c.Stages {
			for i := range st.Approvers {
				a := &st.Approvers[i]
				decidedRow := a.State == "APPROVED" || a.State == "REJECTED"
				if decidedRow || a.Comment != "" {
					key := a.UserID
					if key == "" {
						key = "email:" + strings.ToLower(a.Email) + "|" + a.Name
					}
					ap := approvers[key]
					if ap == nil {
						ap = &domain.CABOperationsApprover{UserID: optionalID(a.UserID), Name: cabPersonName(a.Name, a.Email), Email: a.Email}
						approvers[key] = ap
					}
					if decidedRow {
						ap.Decisions++
						if a.State == "APPROVED" {
							ap.Approved++
						} else {
							ap.Rejected++
						}
					}
					if a.Comment != "" {
						ap.Comments++
					}
				}
				if a.State == "REJECTED" || a.Comment != "" {
					kind := domain.CABOperationsPushbackComment
					if a.State == "REJECTED" {
						kind = domain.CABOperationsPushbackRejection
					}
					pushback = append(pushback, domain.CABOperationsPushbackItem{
						ChangeRequestID: c.ID, Number: c.Number, Subject: c.Subject, AccountName: c.AccountName,
						Kind: kind, Decision: a.State, ApproverName: cabPersonName(a.Name, a.Email),
						Comment: a.Comment, DecidedOn: rfc3339(a.UpdatedOn),
					})
				}
				if a.Comment != "" && (latestComment == nil || a.UpdatedOn.After(latestComment.UpdatedOn)) {
					latestComment = a
				}
			}
		}

		reg := domain.CABOperationsRegistryItem{
			ID: c.ID, Number: c.Number, Subject: c.Subject, State: c.State, AccountName: c.AccountName,
			Model: bucket, Environment: c.Environment, AssignmentGroup: c.AssignmentGroup,
			RequestedBy: c.RequestedByName, OutageDeclared: c.OutageDeclared, OutageSummary: c.OutageSummary,
			Outcome: d.outcome, DecidedBy: d.decidedBy, DecidedOn: rfc3339Ptr(d.decidedOn),
			AskedOn: rfc3339(r.askedOn), PlannedStart: rfc3339Ptr(c.PlannedStart),
		}
		if latestComment != nil {
			reg.CABComment = latestComment.Comment
		}
		report.Registry = append(report.Registry, reg)

		if d.outcome == domain.CABOperationsOutcomePending {
			q := domain.CABOperationsQueueItem{
				ID: c.ID, Number: c.Number, Subject: c.Subject, AccountName: c.AccountName, Model: bucket,
				Environment: c.Environment, PlannedStart: rfc3339Ptr(c.PlannedStart), OutageDeclared: c.OutageDeclared,
				AskedOn: rfc3339(r.askedOn), Approvers: []string{},
			}
			for _, a := range c.Stages[len(c.Stages)-1].Approvers {
				if a.State == "REQUESTED" {
					q.Approvers = append(q.Approvers, cabPersonName(a.Name, a.Email))
				}
			}
			report.Queue = append(report.Queue, q)
		}
	}

	report.Totals.ApprovalRate = cabApprovalRate(report.Totals.Approved, report.Totals.Rejected)
	for k := range approvers {
		if approvers[k].Decisions > 0 {
			report.Totals.Approvers++
		}
	}
	for i := range report.Months {
		m := &report.Months[i]
		m.ApprovalRate = cabApprovalRate(m.Approved, m.Rejected)
		m.TopTeams = sortedTeamCounts(monthTeams[m.Month], cabReportMonthTopTeams)
	}

	// Weekly: the period's busiest teams broken out, the rest summed.
	top := sortedTeamCounts(allTeams, cabReportWeeklyTeams)
	report.WeeklyTeams = make([]domain.CABOperationsTeamRef, 0, len(top))
	topPos := map[string]int{}
	for i, t := range top {
		report.WeeklyTeams = append(report.WeeklyTeams, domain.CABOperationsTeamRef{ID: t.ID, Name: t.Name})
		key := ""
		if t.ID != nil {
			key = *t.ID
		}
		topPos[key] = i
	}
	for i := range report.Weekly {
		w := &report.Weekly[i]
		w.ByTeam = make([]domain.CABOperationsNamedCount, len(top))
		for j, t := range top {
			w.ByTeam[j] = domain.CABOperationsNamedCount{ID: t.ID, Name: t.Name}
		}
	}
	for _, r := range rows {
		i, ok := weekIdx[cabWeekStart(r.askedOn).Format("2006-01-02")]
		if !ok {
			continue
		}
		w := &report.Weekly[i]
		w.Total++
		addModel(&w.ByModel, cabModelBucket(r.c.Model))
		if j, ok := topPos[r.c.AssignmentGroupID]; ok {
			w.ByTeam[j].Count++
		} else {
			w.OtherTeams++
		}
	}

	report.Teams = make([]domain.CABOperationsTeam, 0, len(allTeams))
	for _, t := range allTeams {
		report.Teams = append(report.Teams, domain.CABOperationsTeam{
			GroupID: optionalID(t.id), Name: cabTeamName(t.id, t.name), Total: t.total, Approved: t.approved,
			Rejected: t.rejected, ApprovalRate: cabApprovalRate(t.approved, t.rejected), OutageDeclared: t.outage,
			Standard: t.standard, Emergency: t.emergency,
		})
	}
	sort.Slice(report.Teams, func(i, j int) bool {
		if report.Teams[i].Total != report.Teams[j].Total {
			return report.Teams[i].Total > report.Teams[j].Total
		}
		return report.Teams[i].Name < report.Teams[j].Name
	})

	report.Customers = make([]domain.CABOperationsCustomer, 0, len(customers))
	for _, c := range customers {
		report.Customers = append(report.Customers, *c)
	}
	sort.Slice(report.Customers, func(i, j int) bool {
		if report.Customers[i].Total != report.Customers[j].Total {
			return report.Customers[i].Total > report.Customers[j].Total
		}
		return report.Customers[i].Name < report.Customers[j].Name
	})

	report.Approvers = make([]domain.CABOperationsApprover, 0, len(approvers))
	for _, a := range approvers {
		report.Approvers = append(report.Approvers, *a)
	}
	sort.Slice(report.Approvers, func(i, j int) bool {
		a, b := report.Approvers[i], report.Approvers[j]
		if a.Decisions != b.Decisions {
			return a.Decisions > b.Decisions
		}
		if a.Comments != b.Comments {
			return a.Comments > b.Comments
		}
		return a.Name < b.Name
	})

	report.Requesters = make([]domain.CABOperationsRequester, 0, len(requesters))
	for _, r := range requesters {
		report.Requesters = append(report.Requesters, *r)
	}
	sort.Slice(report.Requesters, func(i, j int) bool {
		if report.Requesters[i].Total != report.Requesters[j].Total {
			return report.Requesters[i].Total > report.Requesters[j].Total
		}
		return report.Requesters[i].Name < report.Requesters[j].Name
	})
	if len(report.Requesters) > cabReportTopRequesters {
		report.Requesters = report.Requesters[:cabReportTopRequesters]
	}

	if report.Queue == nil {
		report.Queue = []domain.CABOperationsQueueItem{}
	}
	sort.SliceStable(report.Queue, func(i, j int) bool {
		if report.Queue[i].AskedOn != report.Queue[j].AskedOn {
			return report.Queue[i].AskedOn < report.Queue[j].AskedOn
		}
		return report.Queue[i].Number < report.Queue[j].Number
	})

	if report.Registry == nil {
		report.Registry = []domain.CABOperationsRegistryItem{}
	}
	sort.SliceStable(report.Registry, func(i, j int) bool {
		if report.Registry[i].AskedOn != report.Registry[j].AskedOn {
			return report.Registry[i].AskedOn > report.Registry[j].AskedOn
		}
		return report.Registry[i].Number > report.Registry[j].Number
	})
	report.RegistryTotal = len(report.Registry)
	if len(report.Registry) > domain.CABOperationsRegistryCap {
		report.Registry = report.Registry[:domain.CABOperationsRegistryCap]
		report.Truncated = true
	}

	if pushback == nil {
		pushback = []domain.CABOperationsPushbackItem{}
	}
	sort.SliceStable(pushback, func(i, j int) bool {
		if pushback[i].DecidedOn != pushback[j].DecidedOn {
			return pushback[i].DecidedOn > pushback[j].DecidedOn
		}
		return pushback[i].Number > pushback[j].Number
	})
	report.PushbackTotal = len(pushback)
	if len(pushback) > domain.CABOperationsPushbackCap {
		pushback = pushback[:domain.CABOperationsPushbackCap]
	}
	report.Pushback = pushback
	return report
}

// cabWeekStart is the Monday (UTC midnight) of t's ISO week.
func cabWeekStart(t time.Time) time.Time {
	d := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
	offset := (int(d.Weekday()) + 6) % 7 // Monday 0 .. Sunday 6
	return d.AddDate(0, 0, -offset)
}
