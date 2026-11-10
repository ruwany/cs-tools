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

import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ApiQueryKeys } from "@constants/apiConstants";
import { useBackendApi } from "@api/backend/client";
import type { BeCABOperationsReport } from "@api/backend/types";

/** The period asked for: inclusive `YYYY-MM-DD` dates (UTC); empty leaves that end to the backend's default. */
export interface CABOperationsPeriod {
  from: string;
  to: string;
}

/** `/reports/cab-operations` with the period's non-empty ends as its query. */
export function cabOperationsReportPath(period: CABOperationsPeriod): string {
  const params = new URLSearchParams();
  if (period.from) params.set("from", period.from);
  if (period.to) params.set("to", period.to);
  const query = params.toString();
  return query ? `/reports/cab-operations?${query}` : "/reports/cab-operations";
}

/**
 * The CAB operations report (`GET /reports/cab-operations`) for Operations >
 * CAB dashboard. With neither end given the backend reports the last four
 * calendar months up to today. A changed period keeps showing the previous
 * report until the new one arrives (`isPlaceholderData`), so the page does not
 * blank out while the range is edited. `null` (a 404) is read as "no report".
 * `enabled: false` (a period the backend would refuse) sends nothing.
 */
export function useGetCABOperationsReport(
  period: CABOperationsPeriod,
  options: { enabled?: boolean } = {},
): UseQueryResult<BeCABOperationsReport | null, Error> {
  const api = useBackendApi();
  return useQuery<BeCABOperationsReport | null, Error>({
    queryKey: [ApiQueryKeys.CAB_OPERATIONS_REPORT, period.from, period.to],
    queryFn: (): Promise<BeCABOperationsReport | null> =>
      api.get<BeCABOperationsReport>(cabOperationsReportPath(period)),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    enabled: options.enabled ?? true,
  });
}
