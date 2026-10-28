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

// PATCH /change-requests/{id} sent as real JSON through the real handler, the
// real dual-write service and the real repository, against PostgreSQL. Only the
// previous system's mirror is stubbed (it records what it is sent). Covers:
//   - an explicit null clears a field (it used to read as "not provided");
//   - a PATCH that only sets the service is accepted (it used to be refused);
//   - priority: an unknown value is a 400 (it used to be a 500 from the enum
//     cast) and planning is refused (it used to be stored);
//   - a PATCH that only puts the change on hold is not sent to the mirror.
//
// Skipped without CHANGE_REQUEST_TEST_DSN, the repository package's convention.
//
//	CHANGE_REQUEST_TEST_DSN=postgres://... go test ./internal/handler/ -run ChangeRequestPatchIntegration -count=1 -p 1

package handler

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/wso2-open-operations/cs-tools/entity-service/internal/domain"
	"github.com/wso2-open-operations/cs-tools/entity-service/internal/middleware"
	"github.com/wso2-open-operations/cs-tools/entity-service/internal/repository"
	"github.com/wso2-open-operations/cs-tools/entity-service/internal/service"
)

const (
	cpiSubject   = "cr-patch-null-service-priority integration test"
	cpiServiceID = "c9000000-0000-0000-0000-000000000001"
	cpiEmail     = "cpi-engineer@test.local"
)

// cpiMirror stands in for the previous system's change request service the
// dual-write service mirrors a PATCH to. Only PatchChangeRequest is reachable.
type cpiMirror struct {
	service.ChangeRequestService
	mu    sync.Mutex
	calls []domain.PatchChangeRequestRequest
}

func (m *cpiMirror) PatchChangeRequest(_ context.Context, id string, req domain.PatchChangeRequestRequest) (domain.PatchChangeRequestResponse, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calls = append(m.calls, req)
	return domain.PatchChangeRequestResponse{ChangeRequest: domain.ChangeRequest{SearchChangeRequestView: domain.SearchChangeRequestView{ID: id}}}, nil
}

func (m *cpiMirror) received() []domain.PatchChangeRequestRequest {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]domain.PatchChangeRequestRequest(nil), m.calls...)
}

type changeRequestPatchEnv struct {
	pool   *pgxpool.Pool
	repo   repository.ChangeRequestRepository
	mirror *cpiMirror
	mux    *http.ServeMux
	token  string
}

func newChangeRequestPatchEnv(t *testing.T) *changeRequestPatchEnv {
	t.Helper()
	dsn := os.Getenv("CHANGE_REQUEST_TEST_DSN")
	if dsn == "" {
		t.Skip("CHANGE_REQUEST_TEST_DSN not set")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	sys := repository.WithSystemIdentity(context.Background())
	scoped := repository.NewScoped(pool)
	cleanup := func() {
		_, _ = scoped.Exec(sys, `DELETE FROM sn_writeback_failures WHERE entity_type = 'change_request' AND entity_id IN (
			SELECT id FROM work_item WHERE subject = $1)`, cpiSubject)
		_, _ = scoped.Exec(sys, `DELETE FROM event_outbox WHERE entity_id IN (SELECT id FROM work_item WHERE subject = $1)`, cpiSubject)
		_, _ = scoped.Exec(sys, `DELETE FROM work_item WHERE subject = $1`, cpiSubject)
		_, _ = pool.Exec(sys, `DELETE FROM service WHERE id = $1`, cpiServiceID)
	}
	cleanup()
	t.Cleanup(cleanup)
	if _, err := pool.Exec(sys, `INSERT INTO service (id, created_on, updated_on, created_by, updated_by, name, number)
		VALUES ($1, NOW(), NOW(), 'test', 'test', 'CPI Service', 'CPI-SVC-1')`, cpiServiceID); err != nil {
		t.Fatalf("seed service: %v", err)
	}

	repo := repository.NewChangeRequestRepository(scoped)
	mirror := &cpiMirror{}
	dispatcher := service.NewSNWritebackDispatcher(repository.NewSNWritebackFailureRepository(pool))
	h := NewChangeRequestHandler(service.NewChangeRequestServiceWithSNWriteback(repo, repository.NewUserRepository(pool), mirror, dispatcher))

	mux := http.NewServeMux()
	// System identity stands in for the identity middleware's internal-caller
	// scope (the CSM BFF is an internal caller); UserIDToken is the real
	// middleware that carries the portal user's x-user-id-token.
	mux.Handle("PATCH /change-requests/{id}", middleware.UserIDToken(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.PatchChangeRequest(w, r.WithContext(repository.WithSystemIdentity(r.Context())))
	})))

	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"none"}`))
	payload := base64.RawURLEncoding.EncodeToString([]byte(`{"email":"` + cpiEmail + `"}`))
	return &changeRequestPatchEnv{pool: pool, repo: repo, mirror: mirror, mux: mux, token: header + "." + payload + ".sig"}
}

func cpiStr(s string) *string { return &s }

// create makes a Normal change request in New with every clearable field set.
func (e *changeRequestPatchEnv) create(t *testing.T) string {
	t.Helper()
	normal := domain.ChangeRequestTypeNormal
	high := domain.ChangeRequestPriorityHigh
	software := domain.ChangeRequestCategorySoftware
	resp, err := e.repo.CreateChangeRequest(repository.WithSystemIdentity(context.Background()), domain.CreateChangeRequestRequest{
		Subject:                cpiSubject,
		Type:                   &normal,
		Priority:               &high,
		Category:               &software,
		ImplementationPlan:     cpiStr("<p>Roll the gateway one node at a time.</p>"),
		AffectedServicesText:   cpiStr("API gateway"),
		AffectedComponentsText: cpiStr("gateway-node-1"),
		RollbackDurationText:   cpiStr("30 minutes"),
	}, cpiEmail)
	if err != nil {
		t.Fatalf("CreateChangeRequest: %v", err)
	}
	return resp.ChangeRequest.ID
}

// patch sends body to PATCH /change-requests/{id} the way the CSM BFF forwards
// it, and returns the status and the response's message.
func (e *changeRequestPatchEnv) patch(t *testing.T, id, body string) (int, string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPatch, "/change-requests/"+id, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-user-id-token", e.token)
	rec := httptest.NewRecorder()
	e.mux.ServeHTTP(rec, req)
	var out struct {
		Message string `json:"message"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out.Message
}

type cpiRow struct {
	ImplementationPlan, Priority, Category, AffectedServices, AffectedComponent, RollbackDuration, ServiceID *string
}

func (e *changeRequestPatchEnv) row(t *testing.T, id string) cpiRow {
	t.Helper()
	var r cpiRow
	if err := e.pool.QueryRow(context.Background(), `
		SELECT implementation_plan, priority::text, category::text, affected_services, affected_component,
		       rollback_duration, service_id::text
		  FROM change_request WHERE id = $1`, id,
	).Scan(&r.ImplementationPlan, &r.Priority, &r.Category, &r.AffectedServices, &r.AffectedComponent, &r.RollbackDuration, &r.ServiceID); err != nil {
		t.Fatalf("read back change_request: %v", err)
	}
	return r
}

func TestChangeRequestPatchIntegration_ExplicitNullClears(t *testing.T) {
	e := newChangeRequestPatchEnv(t)

	t.Run("each field on its own", func(t *testing.T) {
		for field, col := range map[string]func(cpiRow) *string{
			"implementationPlan":     func(r cpiRow) *string { return r.ImplementationPlan },
			"priority":               func(r cpiRow) *string { return r.Priority },
			"category":               func(r cpiRow) *string { return r.Category },
			"affectedServicesText":   func(r cpiRow) *string { return r.AffectedServices },
			"affectedComponentsText": func(r cpiRow) *string { return r.AffectedComponent },
			"rollbackDurationText":   func(r cpiRow) *string { return r.RollbackDuration },
		} {
			id := e.create(t)
			if col(e.row(t, id)) == nil {
				t.Fatalf("%s: the seeded change request has no value to clear", field)
			}
			if code, msg := e.patch(t, id, `{"`+field+`": null}`); code != http.StatusOK {
				t.Fatalf(`{"%s": null} = %d %q, want 200`, field, code, msg)
			}
			if got := col(e.row(t, id)); got != nil {
				t.Errorf(`{"%s": null} left %q stored`, field, *got)
			}
		}
	})

	t.Run("a null beside other fields clears it too", func(t *testing.T) {
		id := e.create(t)
		if code, msg := e.patch(t, id, `{"title": "`+cpiSubject+`", "implementationPlan": null}`); code != http.StatusOK {
			t.Fatalf("PATCH = %d %q, want 200", code, msg)
		}
		if got := e.row(t, id).ImplementationPlan; got != nil {
			t.Errorf("implementation_plan = %q, want NULL", *got)
		}
		cr, err := e.repo.GetChangeRequestByID(repository.WithSystemIdentity(context.Background()), id)
		if err != nil {
			t.Fatalf("GetChangeRequestByID: %v", err)
		}
		if cr.ImplementationPlan != nil {
			t.Errorf("the detail still shows the plan %q", *cr.ImplementationPlan)
		}
	})

	t.Run("an omitted field is left alone", func(t *testing.T) {
		id := e.create(t)
		before := e.row(t, id)
		if code, msg := e.patch(t, id, `{"title": "`+cpiSubject+`"}`); code != http.StatusOK {
			t.Fatalf("PATCH = %d %q, want 200", code, msg)
		}
		after := e.row(t, id)
		if after.ImplementationPlan == nil || *after.ImplementationPlan != *before.ImplementationPlan ||
			after.Priority == nil || *after.Priority != *before.Priority {
			t.Errorf("an omitted field changed: before %+v, after %+v", before, after)
		}
	})
}

func TestChangeRequestPatchIntegration_ServiceAloneIsAPatch(t *testing.T) {
	e := newChangeRequestPatchEnv(t)
	id := e.create(t)
	if code, msg := e.patch(t, id, `{"serviceId": "`+cpiServiceID+`"}`); code != http.StatusOK {
		t.Fatalf("PATCH {serviceId} = %d %q, want 200", code, msg)
	}
	if got := e.row(t, id).ServiceID; got == nil || *got != cpiServiceID {
		t.Fatalf("service_id = %v, want %s", got, cpiServiceID)
	}
	time.Sleep(150 * time.Millisecond) // the mirror dispatch is asynchronous
	if got := e.mirror.received(); len(got) != 0 {
		t.Errorf("a service-only PATCH was sent to the previous system: %+v", got)
	}
}

func TestChangeRequestPatchIntegration_PriorityIsValidated(t *testing.T) {
	e := newChangeRequestPatchEnv(t)
	id := e.create(t)
	for _, p := range []string{"planning", "urgent"} {
		code, msg := e.patch(t, id, `{"priority": "`+p+`"}`)
		if code != http.StatusBadRequest {
			t.Errorf("priority %q = %d %q, want 400", p, code, msg)
		}
		if got := e.row(t, id).Priority; got == nil || *got != "HIGH" {
			t.Errorf("priority %q changed the stored priority to %v", p, got)
		}
	}
	if code, msg := e.patch(t, id, `{"priority": "low"}`); code != http.StatusOK {
		t.Fatalf("priority low = %d %q, want 200", code, msg)
	}
	if got := e.row(t, id).Priority; got == nil || *got != "LOW" {
		t.Fatalf("priority = %v, want LOW", got)
	}

	// A row migrated with the previous system's priority 5 still reads back as
	// "planning": only the write refuses it.
	if _, err := e.pool.Exec(context.Background(), `UPDATE change_request SET priority = 'PLANNING' WHERE id = $1`, id); err != nil {
		t.Fatalf("seed PLANNING: %v", err)
	}
	cr, err := e.repo.GetChangeRequestByID(repository.WithSystemIdentity(context.Background()), id)
	if err != nil {
		t.Fatalf("GetChangeRequestByID: %v", err)
	}
	if cr.Priority == nil || *cr.Priority != "planning" {
		t.Errorf("a PLANNING row reads back as %v, want planning", cr.Priority)
	}
}

// The repository refuses an unknown priority itself (400, not the enum cast's
// 500), for any caller that reaches it without the service's check.
func TestChangeRequestPatchIntegration_RepositoryRefusesUnknownPriority(t *testing.T) {
	e := newChangeRequestPatchEnv(t)
	id := e.create(t)
	for _, p := range []domain.ChangeRequestPriority{"planning", "urgent"} {
		pp := &p
		_, err := e.repo.PatchChangeRequest(repository.WithSystemIdentity(context.Background()), id,
			domain.PatchChangeRequestRequest{Priority: &pp}, cpiEmail)
		if err == nil {
			t.Fatalf("priority %q was accepted", p)
		}
		if !strings.Contains(err.Error(), "is not a change request priority") {
			t.Errorf("priority %q: error %q, want the repository's validation message", p, err)
		}
	}
}

func TestChangeRequestPatchIntegration_HoldIsNotMirrored(t *testing.T) {
	e := newChangeRequestPatchEnv(t)
	id := e.create(t)
	if code, msg := e.patch(t, id, `{"onHold": true, "onHoldReason": "waiting for the customer's window"}`); code != http.StatusOK {
		t.Fatalf("PATCH on hold = %d %q, want 200", code, msg)
	}
	if code, msg := e.patch(t, id, `{"onHold": false}`); code != http.StatusOK {
		t.Fatalf("PATCH off hold = %d %q, want 200", code, msg)
	}
	time.Sleep(150 * time.Millisecond) // the mirror dispatch is asynchronous
	if got := e.mirror.received(); len(got) != 0 {
		t.Errorf("a hold-only PATCH was sent to the previous system: %+v", got)
	}
	var failures int
	if err := e.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM sn_writeback_failures WHERE entity_type = 'change_request' AND entity_id = $1`, id,
	).Scan(&failures); err != nil {
		t.Fatalf("count write-back failures: %v", err)
	}
	if failures != 0 {
		t.Errorf("write-back failures = %d, want 0", failures)
	}
}
