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
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wso2-open-operations/cs-tools/entity-service/internal/apierror"
	"github.com/wso2-open-operations/cs-tools/entity-service/internal/domain"
)

// previousSystemCRServer stands in for the previous system's change request
// PATCH and records every body it receives.
type previousSystemCRServer struct {
	mu     sync.Mutex
	bodies []map[string]any
}

func (s *previousSystemCRServer) received() []map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]map[string]any(nil), s.bodies...)
}

func newPreviousSystemCRMirror(t *testing.T) (ChangeRequestService, *previousSystemCRServer) {
	t.Helper()
	srv := &previousSystemCRServer{}
	mux := http.NewServeMux()
	mux.HandleFunc("/change-requests/"+uuidToSysid(testUUID), func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		srv.mu.Lock()
		srv.bodies = append(srv.bodies, body)
		srv.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"message": "Change request updated", "changeRequest": {"id": "` + uuidToSysid(testUUID) + `", "number": "CHG0001", "createdOn": "2026-01-01 00:00:00"}}`))
	})
	return NewServiceNowChangeRequestService(newTestSNClient(t, mux)), srv
}

// The hold and the service have no field in the previous system's PATCH. A
// dual-write PATCH that carried only them used to be dispatched anyway: the
// mirror refused it ("at least one field must be provided") and a write-back
// failure was recorded for a write that was never going to be made.
func TestChangeRequestService_PatchChangeRequest_PostgresOnlyFieldsAreNotMirrored(t *testing.T) {
	reason := "waiting for the customer's maintenance window"
	onHold, offHold := true, false
	svcID := "66666666-7777-8888-9999-000000000000"
	repo := &stubChangeRequestRepo{
		patchChangeRequest: func(_ context.Context, id string, _ domain.PatchChangeRequestRequest, _ string) (domain.ChangeRequest, error) {
			return domain.ChangeRequest{SearchChangeRequestView: domain.SearchChangeRequestView{ID: id}}, nil
		},
	}
	ctx := contextWithUserIDToken(fakeJWTWithEmail(t, "jane.doe@example.com"))

	for name, req := range map[string]domain.PatchChangeRequestRequest{
		"put on hold":          {OnHold: &onHold, OnHoldReason: &reason},
		"take off hold":        {OnHold: &offHold},
		"edit the hold reason": {OnHoldReason: &reason},
		"set the service":      {ServiceID: &svcID},
		"set the offering":     {ServiceOfferingID: &svcID},
	} {
		t.Run(name, func(t *testing.T) {
			mirror, server := newPreviousSystemCRMirror(t)
			failures := &recordingSNWritebackFailures{}
			svc := NewChangeRequestServiceWithSNWriteback(repo, stubUserRepo{}, mirror, NewSNWritebackDispatcher(failures))
			if _, err := svc.PatchChangeRequest(ctx, testUUID, req); err != nil {
				t.Fatalf("PATCH refused: %v", err)
			}
			time.Sleep(150 * time.Millisecond) // the dispatch is asynchronous; give a wrongly-fired one time to show
			if got := failures.count(); got != 0 {
				t.Errorf("write-back failures = %d, want 0", got)
			}
			if got := server.received(); len(got) != 0 {
				t.Errorf("the previous system received %v, want nothing", got)
			}
		})
	}

	t.Run("with a mirrored field: only that field goes out", func(t *testing.T) {
		title := "new title"
		mirror, server := newPreviousSystemCRMirror(t)
		failures := &recordingSNWritebackFailures{}
		svc := NewChangeRequestServiceWithSNWriteback(repo, stubUserRepo{}, mirror, NewSNWritebackDispatcher(failures))
		req := domain.PatchChangeRequestRequest{Title: &title, OnHold: &onHold, OnHoldReason: &reason, ServiceID: &svcID}
		if _, err := svc.PatchChangeRequest(ctx, testUUID, req); err != nil {
			t.Fatalf("PATCH refused: %v", err)
		}
		deadline := time.Now().Add(2 * time.Second)
		for len(server.received()) == 0 && time.Now().Before(deadline) {
			time.Sleep(10 * time.Millisecond)
		}
		got := server.received()
		if len(got) != 1 {
			t.Fatalf("the previous system received %d PATCHes, want 1", len(got))
		}
		if got[0]["title"] != title {
			t.Errorf("mirrored title = %v, want %q", got[0]["title"], title)
		}
		for _, k := range []string{"onHold", "onHoldReason", "serviceId"} {
			if _, ok := got[0][k]; ok {
				t.Errorf("mirrored body carries %q: %v", k, got[0])
			}
		}
		if n := failures.count(); n != 0 {
			t.Errorf("write-back failures = %d, want 0", n)
		}
	})
}

// On the data source that talks to the previous system directly, a PATCH that
// names only the service or the hold has nothing to send: it is refused in words
// that say so instead of "at least one field must be provided", and the previous
// system is not called.
func TestSNChangeRequestService_PatchChangeRequest_RefusesFieldsItCannotSend(t *testing.T) {
	onHold := true
	reason := "r"
	svcID := "66666666-7777-8888-9999-000000000000"
	for name, tc := range map[string]struct {
		req  domain.PatchChangeRequestRequest
		want string
	}{
		"service":          {domain.PatchChangeRequestRequest{ServiceID: &svcID}, "serviceId is not supported on the ServiceNow data source"},
		"offering":         {domain.PatchChangeRequestRequest{ServiceOfferingID: &svcID}, "serviceOfferingId is not supported on the ServiceNow data source"},
		"hold with reason": {domain.PatchChangeRequestRequest{OnHold: &onHold, OnHoldReason: &reason}, "onHold, onHoldReason are not supported on the ServiceNow data source"},
		"nothing at all":   {domain.PatchChangeRequestRequest{}, "at least one field must be provided"},
	} {
		t.Run(name, func(t *testing.T) {
			svc, server := newPreviousSystemCRMirror(t)
			_, err := svc.PatchChangeRequest(contextWithUserIDToken("token"), testUUID, tc.req)
			var ve *apierror.ValidationError
			if !errors.As(err, &ve) || !strings.Contains(ve.Msg, tc.want) {
				t.Fatalf("error = %v, want a ValidationError saying %q", err, tc.want)
			}
			if got := server.received(); len(got) != 0 {
				t.Errorf("the previous system was called with %v", got)
			}
		})
	}
}
