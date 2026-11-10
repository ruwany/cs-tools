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

package repository_test

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/wso2-open-operations/cs-tools/entity-service/internal/repository"
)

// The CAB operations report's read, against a real database. Skipped without
// CHANGE_REQUEST_TEST_DSN, like the other change request integration tests.
// Every row is dated March 2001 (one February 2001), far from any other test's
// data, because the report reads the whole table by date.
//
//	CHANGE_REQUEST_TEST_DSN=postgres://... go test ./internal/repository/ -run CABOperationsReportIntegration
const (
	cabRptAccount    = "3cab0000-0000-0000-0000-000000000001"
	cabRptProject    = "3cab0000-0000-0000-0000-000000000002"
	cabRptProdDep    = "3cab0000-0000-0000-0000-000000000003"
	cabRptStagingDep = "3cab0000-0000-0000-0000-000000000004"
	cabRptTeam       = "3cab0000-0000-0000-0000-000000000005"
	cabRptAlice      = "3cab0000-0000-0000-0000-0000000000a1"
	cabRptBob        = "3cab0000-0000-0000-0000-0000000000b0"
	cabRptRequester  = "3cab0000-0000-0000-0000-0000000000c0"

	cabRptLabelled    = "3cab0000-0000-0000-0001-000000000001" // Peer then CAB Approval, approved with a comment
	cabRptUnlabelled  = "3cab0000-0000-0000-0001-000000000002" // ServiceNow style, second stage rejected
	cabRptEmergency   = "3cab0000-0000-0000-0001-000000000003" // unlabelled stage in the CAB group, pending
	cabRptCancelled   = "3cab0000-0000-0000-0001-000000000004" // CAB stage, approvers cancelled
	cabRptEarlier     = "3cab0000-0000-0000-0001-000000000005" // CAB stage in February only
	cabRptResubmitted = "3cab0000-0000-0000-0001-000000000006" // rejected in February, approved in March
	cabRptPeerOnly    = "3cab0000-0000-0000-0001-000000000007" // no CAB stage
	cabRptProposal    = "3cab0000-0000-0000-0001-000000000008" // a proposal's "CAB Approval" stage
)

func TestCABOperationsReportIntegration_ListCABChanges(t *testing.T) {
	dsn := os.Getenv("CHANGE_REQUEST_TEST_DSN")
	if dsn == "" {
		t.Skip("CHANGE_REQUEST_TEST_DSN not set")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	scoped := repository.NewScoped(pool)
	sys := repository.WithSystemIdentity(context.Background())
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := scoped.Exec(sys, sql, args...); err != nil {
			t.Fatalf("seed (%.70s): %v", sql, err)
		}
	}

	workItems := []string{cabRptLabelled, cabRptUnlabelled, cabRptEmergency, cabRptCancelled, cabRptEarlier,
		cabRptResubmitted, cabRptPeerOnly, cabRptProposal}
	cleanup := func() {
		_, _ = scoped.Exec(sys, `DELETE FROM work_item WHERE id = ANY($1::uuid[])`, workItems)
		_, _ = scoped.Exec(sys, `DELETE FROM deployment WHERE id = ANY($1::uuid[])`, []string{cabRptProdDep, cabRptStagingDep})
		_, _ = scoped.Exec(sys, `DELETE FROM project WHERE id = $1`, cabRptProject)
		_, _ = scoped.Exec(sys, `DELETE FROM account WHERE id = $1`, cabRptAccount)
		_, _ = scoped.Exec(sys, `DELETE FROM "group" WHERE id = $1`, cabRptTeam)
		_, _ = scoped.Exec(sys, `DELETE FROM "user" WHERE id = $1`, cabRptRequester)
	}
	cleanup()
	t.Cleanup(cleanup)

	// The CAB: Alice and Bob only (isolateApprovalGroup puts the real members back).
	seedApprovalGroupMembers(t, scoped, crCABGroupID, cabRptAlice, cabRptBob)
	exec(`UPDATE "user" SET name = 'Alice CAB' WHERE id = $1`, cabRptAlice)
	exec(`UPDATE "user" SET name = 'Bob CAB' WHERE id = $1`, cabRptBob)
	exec(`INSERT INTO "user" (id, created_on, updated_on, created_by, updated_by, user_name, name, email, is_active, is_system_user)
	      VALUES ($1, now(), now(), 'cab-report-test', 'cab-report-test', 'cab-report-requester@example.com', 'Riley Requester',
	              'cab-report-requester@example.com', true, false)`, cabRptRequester)

	exec(`INSERT INTO account (id, created_on, updated_on, created_by, updated_by, name, number, sf_id)
	      VALUES ($1, now(), now(), 'cab-report-test', 'cab-report-test', 'CAB Report Test Corp', 'CAB-RPT-ACC', 'CAB-RPT-SF')`, cabRptAccount)
	exec(`INSERT INTO project (id, created_on, updated_on, created_by, updated_by, key, sf_id, name, account_id)
	      VALUES ($1, now(), now(), 'cab-report-test', 'cab-report-test', 'CABRPTPRJ', 'CABRPTPRJ', 'CAB Report Project', $2)`,
		cabRptProject, cabRptAccount)
	exec(`INSERT INTO deployment (id, created_on, updated_on, created_by, updated_by, number, name, is_active, project_id, type)
	      VALUES ($1, now(), now(), 'cab-report-test', 'cab-report-test', 'CABRPT-D1', 'Prod', true, $3, 'PRIMARY_PRODUCTION'),
	             ($2, now(), now(), 'cab-report-test', 'cab-report-test', 'CABRPT-D2', 'Staging', true, $3, 'STAGING')`,
		cabRptProdDep, cabRptStagingDep, cabRptProject)
	exec(`INSERT INTO "group" (id, created_on, updated_on, created_by, updated_by, name)
	      VALUES ($1, now(), now(), 'cab-report-test', 'cab-report-test', 'CAB Report Test Team')`, cabRptTeam)

	cr := func(id, number, state, model string, deployment *string, outage *string) {
		t.Helper()
		typ := "CHANGE_REQUEST"
		if id == cabRptProposal {
			typ = "STANDARD_CHANGE_PROPOSAL"
		}
		exec(`INSERT INTO work_item (id, created_on, updated_on, created_by, updated_by, number, subject, type, project_id, deployment_id, assignment_group_id)
		      VALUES ($1, '2001-02-01', '2001-02-01', 'cab-report-test', 'cab-report-test', $2, $7, $3::work_item_type_enum, $4, $5, $6)`,
			id, number, typ, cabRptProject, deployment, cabRptTeam, number+" subject")
		if typ != "CHANGE_REQUEST" {
			return
		}
		exec(`INSERT INTO change_request (id, state, change_model, service_outage_downtime, requested_by_user_id, start_on)
		      VALUES ($1, $2::change_request_state_enum, $3::change_request_change_model_enum, $4, $5, '2001-04-01T10:00:00Z')`,
			id, state, model, outage, cabRptRequester)
	}
	stageN := 0
	stage := func(workItem, created string, label, groupID *string, approvers ...[3]string) {
		t.Helper()
		stageN++
		id := fmt.Sprintf("3cab0000-0000-0000-0002-%012d", stageN)
		exec(`INSERT INTO approval_stage (id, created_on, updated_on, created_by, updated_by, work_item_id, checkpoint_label, assignment_group_id)
		      VALUES ($1, $2::timestamptz, $2::timestamptz, 'cab-report-test', 'cab-report-test', $3, $4, $5)`,
			id, created, workItem, label, groupID)
		for _, a := range approvers { // {user, state, comment}
			var comment *string
			if a[2] != "" {
				comment = &a[2]
			}
			exec(`INSERT INTO approval_stage_approver (id, created_on, updated_on, created_by, updated_by, stage_id, work_item_id, approver_user_id, state, comments)
			      VALUES (gen_random_uuid(), $1::timestamptz, $1::timestamptz + interval '1 hour', 'cab-report-test', 'cab-report-test', $2, $3, $4,
			              $5::approval_stage_approver_state_enum, $6)`,
				created, id, workItem, a[0], a[1], comment)
		}
	}
	str := func(s string) *string { return &s }
	cabLabel, peerLabel, cabGroup := str("CAB Approval"), str("Peer Approval"), str(crCABGroupID)
	prod, staging := str(cabRptProdDep), str(cabRptStagingDep)

	cr(cabRptLabelled, "CABRPT1", "SCHEDULED", "NORMAL", prod, str("<p>10 minute <b>outage</b></p>"))
	stage(cabRptLabelled, "2001-03-01T09:00:00Z", peerLabel, nil, [3]string{cabRptBob, "APPROVED", ""})
	stage(cabRptLabelled, "2001-03-02T09:00:00Z", cabLabel, cabGroup, [3]string{cabRptAlice, "APPROVED", "<p>Add the verification steps</p>"})

	// ServiceNow style: no labels; the second stage is the CAB's. Its own
	// deployment is staging, a linked one is production.
	cr(cabRptUnlabelled, "CABRPT2", "CANCELED", "NORMAL", staging, nil)
	exec(`INSERT INTO change_request_deployment (id, change_request_id, deployment_id) VALUES (gen_random_uuid(), $1, $2)`,
		cabRptUnlabelled, cabRptProdDep)
	stage(cabRptUnlabelled, "2001-03-03T09:00:00Z", nil, nil, [3]string{cabRptAlice, "APPROVED", ""})
	stage(cabRptUnlabelled, "2001-03-04T09:00:00Z", nil, nil, [3]string{cabRptBob, "REJECTED", "No <b>rollback</b> plan&nbsp;"})

	// Emergency: its one unlabelled stage is in the CAB group. A blank outage
	// field ("<p><br></p>") is no outage.
	cr(cabRptEmergency, "CABRPT3", "AUTHORIZE", "EMERGENCY", nil, str("<p><br></p>"))
	stage(cabRptEmergency, "2001-03-05T09:00:00Z", nil, cabGroup, [3]string{cabRptAlice, "REQUESTED", ""})

	cr(cabRptCancelled, "CABRPT4", "CANCELED", "NORMAL", nil, nil)
	stage(cabRptCancelled, "2001-03-06T09:00:00Z", cabLabel, cabGroup, [3]string{cabRptAlice, "CANCELLED", ""})

	cr(cabRptEarlier, "CABRPT5", "SCHEDULED", "NORMAL", nil, nil)
	stage(cabRptEarlier, "2001-02-20T09:00:00Z", cabLabel, cabGroup, [3]string{cabRptAlice, "APPROVED", ""})

	cr(cabRptResubmitted, "CABRPT6", "SCHEDULED", "STANDARD", nil, nil)
	stage(cabRptResubmitted, "2001-02-25T09:00:00Z", cabLabel, cabGroup, [3]string{cabRptBob, "REJECTED", "Too risky"})
	stage(cabRptResubmitted, "2001-03-07T09:00:00Z", cabLabel, cabGroup, [3]string{cabRptAlice, "APPROVED", ""})

	cr(cabRptPeerOnly, "CABRPT7", "ASSESS", "NORMAL", nil, nil)
	stage(cabRptPeerOnly, "2001-03-08T09:00:00Z", peerLabel, nil, [3]string{cabRptBob, "REQUESTED", ""})

	cr(cabRptProposal, "CABRPT8", "", "", nil, nil)
	stage(cabRptProposal, "2001-03-09T09:00:00Z", cabLabel, cabGroup, [3]string{cabRptAlice, "REQUESTED", ""})

	repo := repository.NewCABOperationsReportRepository(scoped)
	from, to := time.Date(2001, 3, 1, 0, 0, 0, 0, time.UTC), time.Date(2001, 4, 1, 0, 0, 0, 0, time.UTC)
	got, err := repo.ListCABChanges(sys, from, to)
	if err != nil {
		t.Fatalf("ListCABChanges: %v", err)
	}
	byID := map[string]repository.CABChangeRecord{}
	for _, c := range got {
		byID[c.ID] = c
	}
	for _, want := range []string{cabRptLabelled, cabRptUnlabelled, cabRptEmergency, cabRptCancelled, cabRptResubmitted} {
		if _, ok := byID[want]; !ok {
			t.Errorf("change %s missing from the report", want)
		}
	}
	for _, not := range []string{cabRptEarlier, cabRptPeerOnly, cabRptProposal} {
		if _, ok := byID[not]; ok {
			t.Errorf("change %s must not be in the report", not)
		}
	}

	l := byID[cabRptLabelled]
	if l.Number != "CABRPT1" || l.State != "SCHEDULED" || l.Model != "NORMAL" || l.AccountName != "CAB Report Test Corp" ||
		l.AccountID != cabRptAccount || l.Environment != "PRIMARY_PRODUCTION" || l.AssignmentGroup != "CAB Report Test Team" ||
		l.AssignmentGroupID != cabRptTeam || l.RequestedByName != "Riley Requester" || !l.OutageDeclared ||
		l.OutageSummary != "10 minute outage" || l.PlannedStart == nil {
		t.Errorf("labelled change %+v", l)
	}
	if len(l.Stages) != 1 || len(l.Stages[0].Approvers) != 1 {
		t.Fatalf("labelled change: only its CAB stage counts, got %+v", l.Stages)
	}
	if a := l.Stages[0].Approvers[0]; a.UserID != cabRptAlice || a.Name != "Alice CAB" || a.State != "APPROVED" ||
		a.Comment != "Add the verification steps" || !a.UpdatedOn.Equal(time.Date(2001, 3, 2, 10, 0, 0, 0, time.UTC)) {
		t.Errorf("labelled change approver %+v", a)
	}

	u := byID[cabRptUnlabelled]
	if u.Environment != "PRIMARY_PRODUCTION" || u.OutageDeclared || len(u.Stages) != 1 ||
		!u.Stages[0].CreatedOn.Equal(time.Date(2001, 3, 4, 9, 0, 0, 0, time.UTC)) {
		t.Errorf("unlabelled change %+v", u)
	} else if a := u.Stages[0].Approvers[0]; a.State != "REJECTED" || a.Comment != "No rollback plan" {
		t.Errorf("unlabelled change approver %+v", a)
	}

	e := byID[cabRptEmergency]
	if e.State != "AUTHORIZE" || e.Model != "EMERGENCY" || e.OutageDeclared || e.Environment != "" || len(e.Stages) != 1 {
		t.Errorf("emergency change %+v", e)
	}

	r := byID[cabRptResubmitted]
	if len(r.Stages) != 2 || r.Stages[0].Approvers[0].Comment != "Too risky" || r.Stages[1].Approvers[0].State != "APPROVED" {
		t.Errorf("resubmitted change %+v", r.Stages)
	}

	members, err := repo.ListCABMembers(sys)
	if err != nil {
		t.Fatalf("ListCABMembers: %v", err)
	}
	seen := map[string]bool{}
	for _, m := range members {
		seen[m.UserID] = true
	}
	if !seen[cabRptAlice] || !seen[cabRptBob] {
		t.Errorf("CAB members %+v, want Alice and Bob among them", members)
	}
}
