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

package handler_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/wso2-open-operations/cs-tools/entity-service/internal/apierror"
	"github.com/wso2-open-operations/cs-tools/entity-service/internal/domain"
	"github.com/wso2-open-operations/cs-tools/entity-service/internal/handler"
)

type stubCABOperationsSvc struct {
	got domain.CABOperationsReportRequest
	err error
}

func (s *stubCABOperationsSvc) BuildReport(_ context.Context, req domain.CABOperationsReportRequest) (domain.CABOperationsReport, error) {
	s.got = req
	if s.err != nil {
		return domain.CABOperationsReport{}, s.err
	}
	return domain.CABOperationsReport{From: "2026-10-01", To: "2026-11-10", Registry: []domain.CABOperationsRegistryItem{}}, nil
}

// TestCABOperationsReportHandler passes from and to through, answers the
// report as JSON with no-store, and maps a validation error to 400.
func TestCABOperationsReportHandler(t *testing.T) {
	stub := &stubCABOperationsSvc{}
	h := handler.NewCABOperationsReportHandler(stub)
	rec := httptest.NewRecorder()
	h.GetCABOperationsReport(rec, httptest.NewRequest(http.MethodGet, "/reports/cab-operations?from=2026-10-01&to=2026-11-10", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("code %d: %s", rec.Code, rec.Body.String())
	}
	if stub.got.From != "2026-10-01" || stub.got.To != "2026-11-10" {
		t.Fatalf("request %+v", stub.got)
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("Cache-Control %q", rec.Header().Get("Cache-Control"))
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["from"] != "2026-10-01" {
		t.Fatalf("body %v", body)
	}

	stub = &stubCABOperationsSvc{err: &apierror.ValidationError{Msg: "from must not be after to"}}
	rec = httptest.NewRecorder()
	handler.NewCABOperationsReportHandler(stub).GetCABOperationsReport(rec,
		httptest.NewRequest(http.MethodGet, "/reports/cab-operations?from=2026-12-01&to=2026-11-01", nil))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("validation error: code %d", rec.Code)
	}
}
