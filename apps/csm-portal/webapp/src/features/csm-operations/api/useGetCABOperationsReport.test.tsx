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

import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const getMock = vi.fn();

vi.mock("@api/backend/client", () => ({
  useBackendApi: () => ({ get: getMock }),
}));

import {
  CABReportUnavailableError,
  cabOperationsReportPath,
  useGetCABOperationsReport,
} from "@features/csm-operations/api/useGetCABOperationsReport";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useGetCABOperationsReport", () => {
  beforeEach(() => {
    getMock.mockReset().mockResolvedValue({ from: "2026-08-01", to: "2026-11-10" });
  });

  it("sends only the ends that are set", () => {
    expect(cabOperationsReportPath({ from: "", to: "" })).toBe("/reports/cab-operations");
    expect(cabOperationsReportPath({ from: "2026-09-01", to: "" })).toBe("/reports/cab-operations?from=2026-09-01");
    expect(cabOperationsReportPath({ from: "2026-09-01", to: "2026-10-31" })).toBe(
      "/reports/cab-operations?from=2026-09-01&to=2026-10-31",
    );
  });

  it("reads the report of the period", async () => {
    const { result } = renderHook(() => useGetCABOperationsReport({ from: "2026-09-01", to: "2026-10-31" }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getMock).toHaveBeenCalledWith("/reports/cab-operations?from=2026-09-01&to=2026-10-31");
    expect(result.current.data).toEqual({ from: "2026-08-01", to: "2026-11-10" });
  });

  it("fails, rather than reading as an empty report, when the backend does not offer it (a 404)", async () => {
    getMock.mockResolvedValue(null);
    const { result } = renderHook(() => useGetCABOperationsReport({ from: "", to: "" }), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(CABReportUnavailableError);
    expect(result.current.data).toBeUndefined();
  });

  it("sends nothing when not enabled (a period the backend would refuse)", async () => {
    const { result } = renderHook(() => useGetCABOperationsReport({ from: "2020-01-01", to: "" }, { enabled: false }), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getMock).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");
  });
});
