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
	"errors"
	"fmt"
	"math"
	"testing"
	"time"

	"github.com/wso2-open-operations/cs-tools/entity-service/internal/apierror"
	"github.com/wso2-open-operations/cs-tools/entity-service/internal/domain"
	"github.com/wso2-open-operations/cs-tools/entity-service/internal/repository"
)

func cabT(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return t
}

func cabApprover(id, name, state, decided, comment string) repository.CABApproverRecord {
	return repository.CABApproverRecord{UserID: id, Name: name, Email: id + "@wso2.com", State: state,
		CreatedOn: cabT(decided).Add(-time.Hour), UpdatedOn: cabT(decided), Comment: comment}
}

func cabChange(id, state, model, env, team string, asked string, approvers ...repository.CABApproverRecord) repository.CABChangeRecord {
	c := repository.CABChangeRecord{
		ID: id, Number: "CHG-" + id, Subject: "Change " + id, State: state, Model: model, Environment: env,
		AccountID: "acc-x", AccountName: "Example Corp", RequestedByID: "req-1", RequestedByName: "Riley",
		Stages: []repository.CABStageRecord{{ID: "st-" + id, CreatedOn: cabT(asked), Approvers: approvers}},
	}
	if team != "" {
		c.AssignmentGroupID, c.AssignmentGroup = "team-"+team, "Team "+team
	}
	return c
}

func rateIs(t *testing.T, what string, got *float64, want float64) {
	t.Helper()
	if got == nil || math.Abs(*got-want) > 1e-9 {
		t.Errorf("%s approval rate = %v, want %v", what, got, want)
	}
}

// cabFixture is five change requests over October and November 2026:
//
//	A  Oct 3   Normal, PROD, outage declared   approved by Alice (then Dave)
//	B  Oct 15  Emergency                        rejected by Bob: "No rollback plan"
//	C  Nov 2   Standard, in Authorize           asked Alice and Carol, undecided: pending
//	D  Nov 5   Normal, cancelled, no team       nobody decided: cancelled
//	E  Nov 8   Normal; rejected by Bob on Sep 20, resubmitted, approved by Carol
//	           on Nov 9 with "Add the verification steps"
func cabFixture() []repository.CABChangeRecord {
	a := cabChange("a", "SCHEDULED", "NORMAL", "PRIMARY_PRODUCTION", "1", "2026-10-03T09:00:00Z",
		cabApprover("alice", "Alice", "APPROVED", "2026-10-03T12:00:00Z", ""),
		cabApprover("dave", "Dave", "APPROVED", "2026-10-03T15:00:00Z", ""))
	a.OutageDeclared, a.OutageSummary = true, "Full outage for 10 minutes"
	b := cabChange("b", "CANCELED", "EMERGENCY", "STAGING", "1", "2026-10-15T09:00:00Z",
		cabApprover("bob", "Bob", "REJECTED", "2026-10-15T10:00:00Z", "No rollback plan"),
		cabApprover("alice", "Alice", "CANCELLED", "2026-10-15T10:00:00Z", ""))
	b.AccountID, b.AccountName = "acc-y", "Other Ltd"
	c := cabChange("c", "AUTHORIZE", "STANDARD", "PRIMARY_PRODUCTION", "2", "2026-11-02T09:00:00Z",
		cabApprover("alice", "Alice", "REQUESTED", "2026-11-02T09:00:00Z", ""),
		cabApprover("carol", "Carol", "REQUESTED", "2026-11-02T09:00:00Z", ""))
	d := cabChange("d", "CANCELED", "NORMAL", "", "", "2026-11-05T09:00:00Z",
		cabApprover("alice", "Alice", "CANCELLED", "2026-11-06T09:00:00Z", ""))
	d.RequestedByID, d.RequestedByName = "", ""
	e := cabChange("e", "SCHEDULED", "NORMAL", "QA", "2", "2026-11-08T09:00:00Z",
		cabApprover("carol", "Carol", "APPROVED", "2026-11-09T09:00:00Z", "Add the verification steps"))
	e.Stages = append([]repository.CABStageRecord{{ID: "st-e0", CreatedOn: cabT("2026-09-20T09:00:00Z"),
		Approvers: []repository.CABApproverRecord{cabApprover("bob", "Bob", "REJECTED", "2026-09-21T09:00:00Z", "Too risky on a Friday")}}},
		e.Stages...)
	return []repository.CABChangeRecord{a, b, c, d, e}
}

func TestBuildCABOperationsReport(t *testing.T) {
	from, to, now := cabT("2026-10-01T00:00:00Z"), cabT("2026-11-10T00:00:00Z"), cabT("2026-11-10T08:30:00Z")
	members := []domain.CABOperationsMember{{UserID: "alice", Name: "Alice", Email: "alice@wso2.com"}}
	changes := cabFixture()
	// The queue's read: C (in the period), F (asked in June, before the period,
	// still waiting) and G (in Authorize, but its CAB stage is approved).
	f := cabChange("f", "AUTHORIZE", "NORMAL", "", "1", "2026-06-20T09:00:00Z",
		cabApprover("bob", "Bob", "REQUESTED", "2026-06-20T09:00:00Z", ""))
	g := cabChange("g", "AUTHORIZE", "NORMAL", "", "1", "2026-06-21T09:00:00Z",
		cabApprover("bob", "Bob", "APPROVED", "2026-06-22T09:00:00Z", ""))
	r := buildCABOperationsReport(changes, []repository.CABChangeRecord{changes[2], g, f}, members, from, to, now)

	if r.From != "2026-10-01" || r.To != "2026-11-10" || r.CurrentMonth != "2026-11" || r.GeneratedOn != "2026-11-10T08:30:00Z" {
		t.Fatalf("header %s %s %s %s", r.From, r.To, r.CurrentMonth, r.GeneratedOn)
	}
	tot := r.Totals
	if tot.Total != 5 || tot.Approved != 2 || tot.Rejected != 1 || tot.Pending != 1 || tot.Cancelled != 1 {
		t.Errorf("totals %+v", tot.CABOperationsCounts)
	}
	rateIs(t, "period", tot.ApprovalRate, 2.0/3.0)
	if tot.Prod != 2 || tot.OutageDeclared != 1 {
		t.Errorf("prod %d outage %d", tot.Prod, tot.OutageDeclared)
	}
	if tot.ByModel != (domain.CABOperationsModelCounts{Normal: 3, Standard: 1, Emergency: 1}) {
		t.Errorf("by model %+v", tot.ByModel)
	}
	// Alice, Dave, Bob and Carol all decided at least once.
	if tot.Approvers != 4 {
		t.Errorf("approvers %d, want 4", tot.Approvers)
	}

	// Months: October closed, November ongoing.
	if len(r.Months) != 2 {
		t.Fatalf("months %+v", r.Months)
	}
	oct, nov := r.Months[0], r.Months[1]
	if oct.Month != "2026-10" || oct.Ongoing || oct.Partial || oct.Total != 2 || oct.Approved != 1 || oct.Rejected != 1 || oct.Prod != 1 {
		t.Errorf("october %+v", oct)
	}
	rateIs(t, "october", oct.ApprovalRate, 0.5)
	if nov.Month != "2026-11" || !nov.Ongoing || !nov.Partial || nov.Total != 3 || nov.Pending != 1 || nov.Cancelled != 1 || nov.Approved != 1 {
		t.Errorf("november %+v", nov)
	}
	rateIs(t, "november", nov.ApprovalRate, 1)
	if len(oct.TopTeams) != 1 || oct.TopTeams[0].Name != "Team 1" || oct.TopTeams[0].Count != 2 {
		t.Errorf("october top teams %+v", oct.TopTeams)
	}
	if len(nov.TopTeams) != 2 || nov.TopTeams[0].Name != "Team 2" || nov.TopTeams[0].Count != 2 || nov.TopTeams[1].Name != "No team" {
		t.Errorf("november top teams %+v", nov.TopTeams)
	}

	// Daily: every day of the period, zero-filled.
	if len(r.Daily) != 41 || r.Daily[0].Day != "2026-10-01" || r.Daily[40].Day != "2026-11-10" {
		t.Fatalf("daily: %d days, %s..%s", len(r.Daily), r.Daily[0].Day, r.Daily[len(r.Daily)-1].Day)
	}
	if d := r.Daily[2]; d.Day != "2026-10-03" || d.Total != 1 || d.Approved != 1 || d.Prod != 1 || d.OutageDeclared != 1 {
		t.Errorf("Oct 3 %+v", d)
	}
	if d := r.Daily[14]; d.Day != "2026-10-15" || d.Emergency != 1 || d.Rejected != 1 {
		t.Errorf("Oct 15 %+v", d)
	}
	if d := r.Daily[1]; d.Total != 0 {
		t.Errorf("Oct 2 %+v, want zero", d)
	}

	// Weekly: ISO weeks from the Monday before the period.
	if r.Weekly[0].WeekStart != "2026-09-28" || r.Weekly[len(r.Weekly)-1].WeekStart != "2026-11-09" {
		t.Errorf("weeks %s..%s", r.Weekly[0].WeekStart, r.Weekly[len(r.Weekly)-1].WeekStart)
	}
	if len(r.WeeklyTeams) != 3 || r.WeeklyTeams[0].Name != "Team 1" || r.WeeklyTeams[1].Name != "Team 2" || r.WeeklyTeams[2].ID != nil {
		t.Errorf("weekly teams %+v", r.WeeklyTeams)
	}
	weekTotal := 0
	for _, w := range r.Weekly {
		weekTotal += w.Total
		sum := w.OtherTeams
		for _, bt := range w.ByTeam {
			sum += bt.Count
		}
		if sum != w.Total || len(w.ByTeam) != len(r.WeeklyTeams) {
			t.Errorf("week %s: teams sum %d of %d (%d teams)", w.WeekStart, sum, w.Total, len(w.ByTeam))
		}
	}
	if weekTotal != 5 {
		t.Errorf("weekly total %d", weekTotal)
	}
	// Week of Nov 2 (Mon) holds C (Nov 2), D (Nov 5) and E (Nov 8).
	for _, w := range r.Weekly {
		if w.WeekStart == "2026-11-02" && (w.Total != 3 || w.ByModel.Standard != 1 || w.ByModel.Normal != 2) {
			t.Errorf("week of Nov 2 %+v", w)
		}
	}

	// Customers by total.
	if len(r.Customers) != 2 || r.Customers[0].Name != "Example Corp" || r.Customers[0].Total != 4 ||
		r.Customers[1].Name != "Other Ltd" || r.Customers[1].Rejected != 1 || r.Customers[1].Emergency != 1 {
		t.Errorf("customers %+v", r.Customers)
	}

	// Teams.
	if len(r.Teams) != 3 || r.Teams[0].Name != "Team 1" || r.Teams[0].Total != 2 || r.Teams[0].OutageDeclared != 1 {
		t.Errorf("teams %+v", r.Teams)
	}
	rateIs(t, "team 1", r.Teams[0].ApprovalRate, 0.5)
	if r.Teams[2].Name != "No team" || r.Teams[2].GroupID != nil || r.Teams[2].ApprovalRate != nil {
		t.Errorf("no-team row %+v", r.Teams[2])
	}

	// Approver workload covers every CAB stage: Bob rejected twice (B, and E's
	// first stage).
	byName := map[string]domain.CABOperationsApprover{}
	for _, a := range r.Approvers {
		byName[a.Name] = a
	}
	if r.Approvers[0].Name != "Bob" || byName["Bob"].Decisions != 2 || byName["Bob"].Rejected != 2 || byName["Bob"].Comments != 2 {
		t.Errorf("approvers %+v", r.Approvers)
	}
	if byName["Carol"].Approved != 1 || byName["Carol"].Comments != 1 || byName["Alice"].Decisions != 1 || byName["Dave"].Approved != 1 {
		t.Errorf("approvers %+v", byName)
	}

	// Requesters: D has none.
	if len(r.Requesters) != 1 || r.Requesters[0].Name != "Riley" || r.Requesters[0].Total != 4 {
		t.Errorf("requesters %+v", r.Requesters)
	}

	// Queue: what waits now, whatever the period: F (asked before the period)
	// then C, with the members still asked; G's CAB stage is decided. F is not
	// counted in the period's figures.
	if len(r.Queue) != 2 || r.Queue[0].ID != "f" || r.Queue[0].AskedOn != "2026-06-20T09:00:00Z" || r.Queue[0].Model != "normal" ||
		len(r.Queue[0].Approvers) != 1 || r.Queue[0].Approvers[0] != "Bob" ||
		r.Queue[1].ID != "c" || len(r.Queue[1].Approvers) != 2 || r.Queue[1].Environment != "PRIMARY_PRODUCTION" {
		t.Errorf("queue %+v", r.Queue)
	}

	// Registry: newest asked first, with outcome, decider and comment.
	if r.RegistryTotal != 5 || r.Truncated || len(r.Registry) != 5 {
		t.Fatalf("registry %d / %d truncated %v", len(r.Registry), r.RegistryTotal, r.Truncated)
	}
	order := ""
	for _, it := range r.Registry {
		order += it.ID
	}
	if order != "edcba" {
		t.Errorf("registry order %q", order)
	}
	reg := map[string]domain.CABOperationsRegistryItem{}
	for _, it := range r.Registry {
		reg[it.ID] = it
	}
	if a := reg["a"]; a.Outcome != domain.CABOperationsOutcomeApproved || a.DecidedBy != "Alice" || a.DecidedOn == nil ||
		*a.DecidedOn != "2026-10-03T12:00:00Z" || !a.OutageDeclared || a.OutageSummary == "" || a.Model != "normal" {
		t.Errorf("registry a %+v", a)
	}
	if b := reg["b"]; b.Outcome != domain.CABOperationsOutcomeRejected || b.DecidedBy != "Bob" || b.CABComment != "No rollback plan" {
		t.Errorf("registry b %+v", b)
	}
	if e := reg["e"]; e.Outcome != domain.CABOperationsOutcomeApproved || e.CABComment != "Add the verification steps" || e.AskedOn != "2026-11-08T09:00:00Z" {
		t.Errorf("registry e %+v", e)
	}
	if reg["c"].Outcome != domain.CABOperationsOutcomePending || reg["d"].Outcome != domain.CABOperationsOutcomeCancelled || reg["d"].DecidedOn != nil {
		t.Errorf("registry c %+v d %+v", reg["c"], reg["d"])
	}

	// Pushback: two rejections and one comment on an approval, newest first.
	if r.PushbackTotal != 3 || len(r.Pushback) != 3 {
		t.Fatalf("pushback %+v", r.Pushback)
	}
	p := r.Pushback
	if p[0].ChangeRequestID != "e" || p[0].Kind != domain.CABOperationsPushbackComment || p[0].Decision != "APPROVED" ||
		p[1].ChangeRequestID != "b" || p[1].Kind != domain.CABOperationsPushbackRejection ||
		p[2].ChangeRequestID != "e" || p[2].Comment != "Too risky on a Friday" {
		t.Errorf("pushback %+v", p)
	}
	if len(r.CABMembers) != 1 || r.CABMembers[0].Email != "alice@wso2.com" {
		t.Errorf("members %+v", r.CABMembers)
	}
}

// TestBuildCABOperationsReport_Empty: no change requests still lists the
// calendar, with no rates and empty (never null) lists.
func TestBuildCABOperationsReport_Empty(t *testing.T) {
	r := buildCABOperationsReport(nil, nil, nil, cabT("2026-09-01T00:00:00Z"), cabT("2026-09-30T00:00:00Z"), cabT("2026-11-10T00:00:00Z"))
	if len(r.Months) != 1 || r.Months[0].Ongoing || r.Months[0].Partial || r.Months[0].ApprovalRate != nil || len(r.Daily) != 30 {
		t.Errorf("calendar %+v / %d days", r.Months, len(r.Daily))
	}
	if r.Totals.ApprovalRate != nil || r.Registry == nil || r.Queue == nil || r.Pushback == nil || r.CABMembers == nil ||
		r.Customers == nil || r.Teams == nil || r.Approvers == nil || r.Requesters == nil || r.WeeklyTeams == nil {
		t.Errorf("empty report has a nil list or a rate: %+v", r)
	}
}

// TestBuildCABOperationsReport_Caps: the registry and pushback lists are cut,
// their true counts kept.
func TestBuildCABOperationsReport_Caps(t *testing.T) {
	var changes []repository.CABChangeRecord
	n := domain.CABOperationsRegistryCap + 5
	for i := 0; i < n; i++ {
		asked := cabT("2026-10-01T00:00:00Z").Add(time.Duration(i) * time.Minute).Format(time.RFC3339)
		changes = append(changes, cabChange(fmt.Sprintf("x%05d", i), "CANCELED", "NORMAL", "", "1", asked,
			cabApprover("bob", "Bob", "REJECTED", asked, "")))
	}
	r := buildCABOperationsReport(changes, nil, nil, cabT("2026-10-01T00:00:00Z"), cabT("2026-10-31T00:00:00Z"), cabT("2026-11-10T00:00:00Z"))
	if len(r.Registry) != domain.CABOperationsRegistryCap || r.RegistryTotal != n || !r.Truncated {
		t.Errorf("registry %d / %d truncated %v", len(r.Registry), r.RegistryTotal, r.Truncated)
	}
	if len(r.Pushback) != domain.CABOperationsPushbackCap || r.PushbackTotal != n {
		t.Errorf("pushback %d / %d", len(r.Pushback), r.PushbackTotal)
	}
	if r.Registry[0].ID != fmt.Sprintf("x%05d", n-1) {
		t.Errorf("registry not newest first: %s", r.Registry[0].ID)
	}
	if r.Totals.Rejected != n {
		t.Errorf("totals count every change: %d", r.Totals.Rejected)
	}
}

// TestBuildCABOperationsReport_PartialMonths: a month the period cuts short at
// either end is partial; a month it covers whole is not.
func TestBuildCABOperationsReport_PartialMonths(t *testing.T) {
	r := buildCABOperationsReport(nil, nil, nil, cabT("2026-07-20T00:00:00Z"), cabT("2026-09-10T00:00:00Z"), cabT("2026-11-10T00:00:00Z"))
	got := ""
	for _, m := range r.Months {
		got += fmt.Sprintf("%s:%v ", m.Month, m.Partial)
	}
	if got != "2026-07:true 2026-08:false 2026-09:true " {
		t.Errorf("partial months %q", got)
	}
	// Whole months, February of a leap year included.
	r = buildCABOperationsReport(nil, nil, nil, cabT("2028-02-01T00:00:00Z"), cabT("2028-02-29T00:00:00Z"), cabT("2028-05-10T00:00:00Z"))
	if len(r.Months) != 1 || r.Months[0].Partial {
		t.Errorf("whole February %+v", r.Months)
	}
}

// TestCABStageDecision: one rejection beats any approval; only the latest
// stage counts.
func TestCABStageDecision(t *testing.T) {
	c := cabChange("r", "AUTHORIZE", "NORMAL", "", "", "2026-10-01T00:00:00Z",
		cabApprover("alice", "Alice", "APPROVED", "2026-10-01T01:00:00Z", ""),
		cabApprover("bob", "Bob", "REJECTED", "2026-10-01T02:00:00Z", ""))
	if d := cabStageDecision(c); d.outcome != domain.CABOperationsOutcomeRejected || d.decidedBy != "Bob" {
		t.Errorf("rejection: %+v", d)
	}
	c.Stages = append(c.Stages, repository.CABStageRecord{ID: "later", CreatedOn: cabT("2026-10-02T00:00:00Z"),
		Approvers: []repository.CABApproverRecord{cabApprover("carol", "", "REQUESTED", "2026-10-02T00:00:00Z", "")}})
	if d := cabStageDecision(c); d.outcome != domain.CABOperationsOutcomePending {
		t.Errorf("resubmitted, in Authorize: %+v", d)
	}
	c.State = "SCHEDULED"
	if d := cabStageDecision(c); d.outcome != domain.CABOperationsOutcomeCancelled {
		t.Errorf("undecided, moved on: %+v", d)
	}
}

func TestCABReportPeriod(t *testing.T) {
	now := cabT("2026-11-10T08:00:00Z")
	from, to, err := cabReportPeriod(domain.CABOperationsReportRequest{}, now)
	if err != nil || from.Format("2006-01-02") != "2026-08-01" || to.Format("2006-01-02") != "2026-11-10" {
		t.Errorf("default: %v %v %v", from, to, err)
	}
	from, _, err = cabReportPeriod(domain.CABOperationsReportRequest{To: "2026-02-15"}, now)
	if err != nil || from.Format("2006-01-02") != "2025-11-01" {
		t.Errorf("default from across a year: %v %v", from, err)
	}
	if _, _, err := cabReportPeriod(domain.CABOperationsReportRequest{From: "2024-12-01", To: "2026-11-30"}, now); err != nil {
		t.Errorf("24 months: %v", err)
	}
	for _, req := range []domain.CABOperationsReportRequest{
		{From: "2024-11-30", To: "2026-11-01"}, // 25 calendar months
		{From: "2026-11-02", To: "2026-11-01"},
		{From: "2026-13-01"},
		{To: "yesterday"},
	} {
		_, _, err := cabReportPeriod(req, now)
		var ve *apierror.ValidationError
		if !errors.As(err, &ve) {
			t.Errorf("%+v: got %v, want a ValidationError", req, err)
		}
	}
}

type stubCABRepo struct {
	from, to time.Time
	open     []repository.CABChangeRecord
}

func (s *stubCABRepo) ListOpenCABChanges(context.Context) ([]repository.CABChangeRecord, error) {
	return s.open, nil
}

func (s *stubCABRepo) ListCABChanges(_ context.Context, from, to time.Time) ([]repository.CABChangeRecord, error) {
	s.from, s.to = from, to
	return nil, nil
}

func (s *stubCABRepo) ListCABMembers(context.Context) ([]domain.CABOperationsMember, error) {
	return nil, nil
}

// TestCABOperationsReportService_ExclusiveEnd: the repository gets [from, to+1 day).
func TestCABOperationsReportService_ExclusiveEnd(t *testing.T) {
	// A change waiting since May is in the queue of an October report.
	repo := &stubCABRepo{open: []repository.CABChangeRecord{cabChange("old", "AUTHORIZE", "NORMAL", "", "", "2026-05-04T09:00:00Z",
		cabApprover("bob", "Bob", "REQUESTED", "2026-05-04T09:00:00Z", ""))}}
	svc := &cabOperationsReportService{repo: repo, now: func() time.Time { return cabT("2026-11-10T08:00:00Z") }}
	r, err := svc.BuildReport(context.Background(), domain.CABOperationsReportRequest{From: "2026-10-01", To: "2026-10-31"})
	if err != nil {
		t.Fatal(err)
	}
	if !repo.from.Equal(cabT("2026-10-01T00:00:00Z")) || !repo.to.Equal(cabT("2026-11-01T00:00:00Z")) {
		t.Errorf("repository range %v .. %v", repo.from, repo.to)
	}
	if len(r.Months) != 1 || r.Months[0].Ongoing {
		t.Errorf("months %+v", r.Months)
	}
	if len(r.Queue) != 1 || r.Queue[0].ID != "old" || r.Totals.Total != 0 {
		t.Errorf("queue %+v, totals %+v", r.Queue, r.Totals)
	}
}
