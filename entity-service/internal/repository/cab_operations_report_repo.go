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

package repository

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/wso2-open-operations/cs-tools/entity-service/internal/domain"
)

// CABOperationsReportRepository reads the rows behind the CAB operations report
// (GET /reports/cab-operations). It only reads; the figures are worked out by
// the service.
type CABOperationsReportRepository interface {
	// ListCABChanges returns every change request whose LATEST CAB stage was
	// created in [from, to), with all of its CAB stages (oldest first) and their
	// approvers. Which stage is the CAB's is decided exactly as the change
	// request's approvals list shows it (isCABStageForReport).
	ListCABChanges(ctx context.Context, from, to time.Time) ([]CABChangeRecord, error)
	// ListOpenCABChanges returns every change request in Authorize that has a
	// CAB stage, whenever that stage was created, in the same shape: the review
	// queue is what waits for the CAB now, so no period bounds it. The caller
	// keeps the ones whose latest CAB stage is still undecided.
	ListOpenCABChanges(ctx context.Context) ([]CABChangeRecord, error)
	// ListCABMembers returns the members of the "CAB Approval" group who may
	// decide a CAB stage (active internal users), resolved the way the approval
	// flow resolves the group (namedGroup), sorted by name.
	ListCABMembers(ctx context.Context) ([]domain.CABOperationsMember, error)
}

// CABChangeRecord is one change request of the report.
type CABChangeRecord struct {
	ID      string
	Number  string
	Subject string
	// State is change_request.state (upper case), "" when NULL.
	State string
	// Model is change_request.change_model (upper case), "" when NULL.
	Model           string
	AccountID       string
	AccountName     string
	Environment     string
	AssignmentGroup string
	// AssignmentGroupID is "" when the change has no assignment group.
	AssignmentGroupID string
	RequestedByID     string
	RequestedByName   string
	// OutageDeclared is true when "Service outage / downtime" has visible text
	// (IsBlankRichText); OutageSummary is that text, plain, cut to 300 characters.
	OutageDeclared bool
	OutageSummary  string
	PlannedStart   *time.Time
	// Stages are the change's CAB stages, oldest first; the last one is the one
	// the report counts.
	Stages []CABStageRecord
}

// CABStageRecord is one CAB stage of a change request.
type CABStageRecord struct {
	ID        string
	CreatedOn time.Time
	// Approvers are in the order they were asked (created_on, id).
	Approvers []CABApproverRecord
}

// CABApproverRecord is one approver row of a CAB stage.
type CABApproverRecord struct {
	// UserID is "" when the approver's user row is missing.
	UserID string
	Name   string
	Email  string
	// State is the row's state, normalised (APPROVED, REJECTED, REQUESTED, ...).
	State     string
	CreatedOn time.Time
	// UpdatedOn is when the row last changed: the decision time once decided.
	UpdatedOn time.Time
	// Comment is the row's comment as plain text (ApproverCommentText: as typed
	// in the portal, markup removed from a migrated one), "" when blank.
	Comment string
}

type cabOperationsReportRepository struct {
	db *Scoped
}

// NewCABOperationsReportRepository constructs the Postgres-backed
// CABOperationsReportRepository. The reads run as the caller (the route is
// internal callers only), so row-level security still applies.
func NewCABOperationsReportRepository(db *Scoped) CABOperationsReportRepository {
	return &cabOperationsReportRepository{db: db}
}

// isCABStageForReport says whether a change request's stage is its CAB stage,
// by the rule the change request's approvals list uses to name it
// (changeRequestApprovalStageLabel, then classifyApprovalStage): a stage with a
// label is classified by it ("CAB Approval", and the older "Authorize" and
// "ECAB Approval"); a stage copied from the previous system (no label) is the CAB's when
// it is an Emergency change's stage in the "CAB Approval" group, or else when it
// is the change's second stage (position 1, ordered by created_on, id). The
// stage's state-dependent reading (runtimeApprovalStageKind) is deliberately not
// used: it says what may be decided now, and a report is about history.
func isCABStageForReport(label, groupName *string, position int, model string) bool {
	shown, _ := changeRequestApprovalStageLabel(
		changeRequestApprovalStageRow{checkpointLabel: label, assignmentGroupName: groupName}, position, model)
	return classifyApprovalStage(&shown, position) == stageKindCAB
}

// cabReportStagesSQL lists every stage of every change request that has a
// stage created in [$1, $2), with its position among the change's stages
// (ordered as the approvals list orders them). Only change requests: the join
// to change_request leaves out a standard change proposal's stages, which share
// the table (and the "CAB Approval" label). The range is on created_on itself,
// so it stays sargable. No index on created_on was added: approval_stage is one
// narrow row per stage, and on 80,000 stages (40,000 change requests) the plan
// scans it twice, hash joins and runs in about 40 ms (EXPLAIN ANALYZE,
// 2026-11-10); add one only if a real plan says so.
const cabReportStagesSQL = `
WITH touched AS (
  SELECT DISTINCT s.work_item_id
  FROM approval_stage s
  WHERE s.created_on >= $1 AND s.created_on < $2
)` + cabReportStagesOfTouchedSQL

// cabReportOpenStagesSQL lists every stage of every change request in
// Authorize (the review queue's candidates), with the same columns. There is
// no index on change_request.state: the table is scanned once, and the
// change requests in Authorize at any time are a handful.
const cabReportOpenStagesSQL = `
WITH touched AS (
  SELECT cr.id AS work_item_id
  FROM change_request cr
  WHERE cr.state = 'AUTHORIZE'::change_request_state_enum
)` + cabReportStagesOfTouchedSQL

// cabReportStagesOfTouchedSQL reads the stages of the change requests in a
// "touched" CTE.
const cabReportStagesOfTouchedSQL = `
SELECT s.id::text, s.work_item_id::text, s.created_on, s.checkpoint_label, g.name,
       COALESCE(cr.change_model::text, ''),
       (row_number() OVER (PARTITION BY s.work_item_id ORDER BY s.created_on, s.id) - 1)::int
FROM touched t
JOIN change_request cr ON cr.id = t.work_item_id
JOIN approval_stage s ON s.work_item_id = t.work_item_id
LEFT JOIN "group" g ON g.id = s.assignment_group_id`

// cabReportChangesSQL reads the change requests themselves. Environment is
// PRIMARY_PRODUCTION when the change's own deployment or any deployment linked
// to it (change_request_deployment) is a primary production one, else the own
// deployment's type, else the first linked one's.
const cabReportChangesSQL = `
SELECT wi.id::text, COALESCE(wi.number, ''), COALESCE(wi.subject, ''),
       COALESCE(cr.state::text, ''), COALESCE(cr.change_model::text, ''),
       COALESCE(a.id::text, ''), COALESCE(a.name, ''),
       COALESCE(
         CASE WHEN d.type::text = 'PRIMARY_PRODUCTION' OR EXISTS (
                SELECT 1 FROM change_request_deployment l JOIN deployment ld ON ld.id = l.deployment_id
                WHERE l.change_request_id = cr.id AND ld.type::text = 'PRIMARY_PRODUCTION')
              THEN 'PRIMARY_PRODUCTION' END,
         d.type::text,
         (SELECT ld.type::text FROM change_request_deployment l JOIN deployment ld ON ld.id = l.deployment_id
          WHERE l.change_request_id = cr.id AND ld.type IS NOT NULL ORDER BY ld.type::text LIMIT 1),
         ''),
       COALESCE(ag.id::text, ''), COALESCE(ag.name, ''),
       COALESCE(rb.id::text, ''),
       COALESCE(NULLIF(TRIM(rb.name), ''), NULLIF(TRIM(CONCAT_WS(' ', rb.first_name, rb.last_name)), ''), ''),
       COALESCE(cr.service_outage_downtime, ''),
       CASE WHEN isfinite(cr.start_on) THEN cr.start_on END
FROM work_item wi
JOIN change_request cr ON cr.id = wi.id
LEFT JOIN project p ON p.id = wi.project_id
LEFT JOIN account a ON a.id = p.account_id
LEFT JOIN deployment d ON d.id = wi.deployment_id
LEFT JOIN "group" ag ON ag.id = wi.assignment_group_id
LEFT JOIN "user" rb ON rb.id = cr.requested_by_user_id
WHERE wi.id = ANY($1::uuid[])`

// cabReportApproversSQL reads the approver rows of the chosen stages, with the
// display-name convention of changeRequestApprovalApproversQuery.
const cabReportApproversSQL = `
SELECT asa.stage_id::text, COALESCE(u.id::text, ''),
       COALESCE(NULLIF(TRIM(u.name), ''), NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), ''),
       COALESCE(u.email, ''), asa.state::text, asa.created_on, asa.updated_on, COALESCE(asa.comments, '')
FROM approval_stage_approver asa
LEFT JOIN "user" u ON u.id = asa.approver_user_id
WHERE asa.stage_id = ANY($1::uuid[])
ORDER BY asa.created_on, asa.id`

// cabOutageSummaryRunes caps CABChangeRecord.OutageSummary.
const cabOutageSummaryRunes = 300

// ListCABChanges implements CABOperationsReportRepository.
//
// crvis: internal callers only: GET /reports/cab-operations is wrapped by internalOnly (server/routes.go) and the service checks RequireInternalCaller again, so no customer identity reaches it
func (r *cabOperationsReportRepository) ListCABChanges(ctx context.Context, from, to time.Time) ([]CABChangeRecord, error) {
	// A change counts in the period of its latest CAB stage only.
	return r.listCABChanges(ctx, func(latest time.Time) bool {
		return !latest.Before(from) && latest.Before(to)
	}, cabReportStagesSQL, from, to)
}

// ListOpenCABChanges implements CABOperationsReportRepository.
//
// crvis: internal callers only, as ListCABChanges
func (r *cabOperationsReportRepository) ListOpenCABChanges(ctx context.Context) ([]CABChangeRecord, error) {
	return r.listCABChanges(ctx, func(time.Time) bool { return true }, cabReportOpenStagesSQL)
}

// listCABChanges runs stagesSQL (columns of cabReportStagesOfTouchedSQL), keeps
// the change requests that have a CAB stage and whose latest CAB stage's
// created_on passes keep, and reads their approvers and change rows.
func (r *cabOperationsReportRepository) listCABChanges(ctx context.Context, keep func(latest time.Time) bool, stagesSQL string, args ...any) ([]CABChangeRecord, error) {
	type stageRow struct {
		id, workItemID string
		createdOn      time.Time
		label, group   *string
		model          string
		position       int
	}
	rows, err := r.db.Query(ctx, stagesSQL, args...)
	if err != nil {
		return nil, fmt.Errorf("cab operations report: list stages: %w", err)
	}
	cabStages := map[string][]stageRow{}
	for rows.Next() {
		var s stageRow
		if err := rows.Scan(&s.id, &s.workItemID, &s.createdOn, &s.label, &s.group, &s.model, &s.position); err != nil {
			rows.Close()
			return nil, fmt.Errorf("cab operations report: scan stage: %w", err)
		}
		if isCABStageForReport(s.label, s.group, s.position, s.model) {
			cabStages[s.workItemID] = append(cabStages[s.workItemID], s)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("cab operations report: list stages: %w", err)
	}

	var changeIDs, stageIDs []string
	stagesByChange := map[string][]CABStageRecord{}
	for id, stages := range cabStages {
		sort.Slice(stages, func(i, j int) bool { return stages[i].position < stages[j].position })
		if !keep(stages[len(stages)-1].createdOn) {
			continue
		}
		changeIDs = append(changeIDs, id)
		for _, s := range stages {
			stageIDs = append(stageIDs, s.id)
			stagesByChange[id] = append(stagesByChange[id], CABStageRecord{ID: s.id, CreatedOn: s.createdOn})
		}
	}
	if len(changeIDs) == 0 {
		return []CABChangeRecord{}, nil
	}

	approversByStage := map[string][]CABApproverRecord{}
	rows, err = r.db.Query(ctx, cabReportApproversSQL, stageIDs)
	if err != nil {
		return nil, fmt.Errorf("cab operations report: list approvers: %w", err)
	}
	for rows.Next() {
		var stageID, state, comment string
		var a CABApproverRecord
		if err := rows.Scan(&stageID, &a.UserID, &a.Name, &a.Email, &state, &a.CreatedOn, &a.UpdatedOn, &comment); err != nil {
			rows.Close()
			return nil, fmt.Errorf("cab operations report: scan approver: %w", err)
		}
		a.State = normalizeChangeRequestApprovalStatus(&state)
		a.Comment = ApproverCommentText(comment)
		approversByStage[stageID] = append(approversByStage[stageID], a)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("cab operations report: list approvers: %w", err)
	}

	rows, err = r.db.Query(ctx, cabReportChangesSQL, changeIDs)
	if err != nil {
		return nil, fmt.Errorf("cab operations report: list change requests: %w", err)
	}
	defer rows.Close()
	out := make([]CABChangeRecord, 0, len(changeIDs))
	for rows.Next() {
		var c CABChangeRecord
		var outage string
		if err := rows.Scan(&c.ID, &c.Number, &c.Subject, &c.State, &c.Model, &c.AccountID, &c.AccountName,
			&c.Environment, &c.AssignmentGroupID, &c.AssignmentGroup, &c.RequestedByID, &c.RequestedByName,
			&outage, &c.PlannedStart); err != nil {
			return nil, fmt.Errorf("cab operations report: scan change request: %w", err)
		}
		c.State = strings.ToUpper(c.State)
		c.Model = strings.ToUpper(c.Model)
		if strings.TrimSpace(outage) != "" && !IsBlankRichText(outage) {
			c.OutageDeclared = true
			c.OutageSummary = RichTextPlainText(outage, cabOutageSummaryRunes)
		}
		for _, s := range stagesByChange[c.ID] {
			s.Approvers = approversByStage[s.ID]
			c.Stages = append(c.Stages, s)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("cab operations report: list change requests: %w", err)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

// ListCABMembers implements CABOperationsReportRepository.
func (r *cabOperationsReportRepository) ListCABMembers(ctx context.Context) ([]domain.CABOperationsMember, error) {
	_, members, exists, err := namedGroup(ctx, r.db, domain.CABApprovalGroupName)
	if err != nil {
		return nil, fmt.Errorf("cab operations report: %w", err)
	}
	if !exists || len(members) == 0 {
		return []domain.CABOperationsMember{}, nil
	}
	if members, err = onlyInternalApprovers(ctx, r.db, members); err != nil {
		return nil, fmt.Errorf("cab operations report: %w", err)
	}
	if len(members) == 0 {
		return []domain.CABOperationsMember{}, nil
	}
	rows, err := r.db.Query(ctx, `
		SELECT u.id::text,
		       COALESCE(NULLIF(TRIM(u.name), ''), NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), ''),
		       COALESCE(u.email, '')
		FROM "user" u WHERE u.id = ANY($1::uuid[])`, members)
	if err != nil {
		return nil, fmt.Errorf("cab operations report: list cab members: %w", err)
	}
	defer rows.Close()
	out := []domain.CABOperationsMember{}
	for rows.Next() {
		var m domain.CABOperationsMember
		if err := rows.Scan(&m.UserID, &m.Name, &m.Email); err != nil {
			return nil, fmt.Errorf("cab operations report: scan cab member: %w", err)
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("cab operations report: list cab members: %w", err)
	}
	sort.Slice(out, func(i, j int) bool {
		if !strings.EqualFold(out[i].Name, out[j].Name) {
			return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
		}
		return out[i].Email < out[j].Email
	})
	return out, nil
}
