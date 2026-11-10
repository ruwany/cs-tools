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

import {
  Alert,
  Box,
  Button,
  Chip,
  Grid,
  LinearProgress,
  Skeleton,
  Tab,
  Tabs,
  Typography,
} from "@wso2/oxygen-ui";
import type { JSX } from "react";
import { useSearchParams } from "react-router";
import QueryErrorState from "@components/QueryErrorState";
import RefreshButton from "@components/RefreshButton";
import DateRangeFilterFields, { type DateRange } from "@features/csm-operations/components/DateRangeFilterFields";
import { CABReportUnavailableError, useGetCABOperationsReport } from "@features/csm-operations/api/useGetCABOperationsReport";
import { formatDateOnly, todayUTCDateOnly } from "@features/csm-operations/utils/dateOnly";
import {
  CAB_DASHBOARD_PARAMS,
  CAB_DASHBOARD_VIEWS,
  CAB_SHORT_NOTES,
  type CabDashboardView,
  cabDashboardView,
  cabMonthSelection,
  cabPeriodProblem,
  dayMediumLabel,
  monthLabelSuffix,
  monthShortLabel,
} from "@features/csm-operations/utils/cabOperations";
import CabOverviewTab from "@features/csm-operations/components/cab-dashboard/CabOverviewTab";
import CabTrendsTab from "@features/csm-operations/components/cab-dashboard/CabTrendsTab";
import CabSummaryTab from "@features/csm-operations/components/cab-dashboard/CabSummaryTab";
import {
  CabDowntimeTab,
  CabGovernanceTab,
  CabPushbackTab,
  CabQueueTab,
  CabRegistryTab,
} from "@features/csm-operations/components/cab-dashboard/CabListTabs";

/** The tabs the month filter narrows; the others are the whole period (or, for the queue, now). */
const MONTH_FILTERED_VIEWS: ReadonlySet<CabDashboardView> = new Set(["overview", "registry", "downtime", "pushback"]);

/**
 * Operations > CAB dashboard (`/operations/cab-dashboard`): what the CAB was
 * asked to decide and how it decided, modelled on the "CAB Operations &
 * Governance" sheet, from `GET /reports/cab-operations`. The period (the
 * `from` / `to` URL parameters, UTC days; none is the backend's default, the
 * last four calendar months) is fetched once; the month chips (`month`) and
 * the tabs (`view`) only narrow what is shown of it, so they cost no request.
 * Everything is in the URL, so a view can be linked to and Back returns to it.
 *
 * Read only: the review queue links to each change request, where the CAB
 * decides. The page says what the data cannot show (`CAB_SHORT_NOTES`).
 */
export default function CabOperationsDashboard(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = cabDashboardView(searchParams);
  const range: DateRange = {
    from: searchParams.get(CAB_DASHBOARD_PARAMS.from) ?? "",
    to: searchParams.get(CAB_DASHBOARD_PARAMS.to) ?? "",
  };
  const problem = cabPeriodProblem(range.from, range.to, formatDateOnly(todayUTCDateOnly()));
  const query = useGetCABOperationsReport(range, { enabled: problem === null });
  const report = query.data ?? null;
  const selection = cabMonthSelection(searchParams.get(CAB_DASHBOARD_PARAMS.month), report);

  const setParams = (patch: Record<string, string | null>, replace = false): void => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [name, value] of Object.entries(patch)) {
          if (value) next.set(name, value);
          else next.delete(name);
        }
        return next;
      },
      { replace },
    );
  };

  const onRangeChange = (next: DateRange): void =>
    // A month of the old period may not be in the new one.
    setParams({ [CAB_DASHBOARD_PARAMS.from]: next.from, [CAB_DASHBOARD_PARAMS.to]: next.to, [CAB_DASHBOARD_PARAMS.month]: null }, true);

  const filters = (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Grid container spacing={2} alignItems="center">
        <DateRangeFilterFields label="CAB asked" value={range} onChange={onRangeChange} size={{ xs: 12, sm: 6, md: 3 }} />
        <Grid size={{ xs: 12, md: 6 }} sx={{ display: "flex", alignItems: "center", justifyContent: { xs: "space-between", md: "flex-end" }, gap: 1 }}>
          {(range.from || range.to) && (
            <Button size="small" variant="text" onClick={() => onRangeChange({ from: "", to: "" })}>
              Last four months
            </Button>
          )}
          <RefreshButton
            label="Refresh the CAB dashboard"
            onRefresh={() => void query.refetch()}
            isFetching={query.isFetching}
            updatedAt={query.dataUpdatedAt || undefined}
          />
        </Grid>
      </Grid>
      <Typography variant="caption" color="text.secondary">
        {report ? `${dayMediumLabel(report.from)} to ${dayMediumLabel(report.to)} (UTC). ` : ""}
        {CAB_SHORT_NOTES.join(" ")}
      </Typography>
    </Box>
  );

  if (problem) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {filters}
        <Alert severity="warning">{problem}</Alert>
      </Box>
    );
  }

  if (query.isPending) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }} aria-busy="true">
        {filters}
        <Skeleton variant="rounded" height={40} />
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))" }}>
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} variant="rounded" height={130} />
          ))}
        </Box>
        <Skeleton variant="rounded" height={280} />
      </Box>
    );
  }

  if (!report) {
    // A failed load is an error, never an empty dashboard. Not offered on this
    // deployment (a 404) is said as such, with no retry: retrying cannot fix it.
    const unavailable = query.error instanceof CABReportUnavailableError ? query.error : null;
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {filters}
        <QueryErrorState
          message={unavailable ? unavailable.message : "Could not load the CAB dashboard."}
          error={query.error}
          onRetry={unavailable ? undefined : () => void query.refetch()}
        />
      </Box>
    );
  }

  const monthFiltered = MONTH_FILTERED_VIEWS.has(view);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {filters}
      {query.isPlaceholderData && <LinearProgress aria-label="Loading the new period" />}
      {query.isError && (
        // Only a failed refresh keeps a report: a new period that fails has no
        // placeholder (TanStack shows placeholder data while pending only).
        <Alert severity="error">Could not refresh the CAB dashboard. The figures below are from the last successful load.</Alert>
      )}

      <Box
        role="group"
        aria-label="Month"
        sx={{ display: "flex", flexWrap: "wrap", gap: 1, opacity: monthFiltered ? 1 : 0.6 }}
      >
        {[{ value: "all", label: "All" }, ...report.months.map((m) => ({
          value: m.month,
          label: `${monthShortLabel(m.month)}${monthLabelSuffix(m)}`,
        }))].map((chip) => {
          const selected = selection === chip.value;
          return (
            <Chip
              key={chip.value}
              label={chip.label}
              size="small"
              clickable
              color={selected ? "primary" : "default"}
              variant={selected ? "filled" : "outlined"}
              aria-pressed={selected}
              onClick={() => setParams({ [CAB_DASHBOARD_PARAMS.month]: chip.value === "all" ? null : chip.value }, true)}
            />
          );
        })}
      </Box>

      <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Tabs
          value={view}
          onChange={(_, next: CabDashboardView) => setParams({ [CAB_DASHBOARD_PARAMS.view]: next === "overview" ? null : next })}
          aria-label="CAB dashboard"
          variant="scrollable"
          allowScrollButtonsMobile
        >
          {CAB_DASHBOARD_VIEWS.map((v) => (
            <Tab
              key={v.value}
              value={v.value}
              sx={{ textTransform: "none" }}
              label={v.value === "queue" && report.queue.length > 0 ? `${v.label} (${report.queue.length})` : v.label}
            />
          ))}
        </Tabs>
      </Box>

      {!monthFiltered && selection !== "all" && (
        <Typography variant="body2" color="text.secondary">
          The month filter does not apply to this tab.
        </Typography>
      )}

      {view === "overview" && <CabOverviewTab report={report} selection={selection} />}
      {view === "queue" && <CabQueueTab report={report} />}
      {view === "trends" && <CabTrendsTab report={report} />}
      {view === "registry" && <CabRegistryTab report={report} selection={selection} />}
      {view === "downtime" && <CabDowntimeTab report={report} selection={selection} />}
      {view === "governance" && <CabGovernanceTab report={report} />}
      {view === "pushback" && <CabPushbackTab report={report} selection={selection} />}
      {view === "summary" && <CabSummaryTab report={report} />}
    </Box>
  );
}
