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
  Card,
  CardContent,
  Chip,
  Grid,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useTheme,
} from "@wso2/oxygen-ui";
import { useState, type JSX } from "react";
import type { BeCABOperationsMonth, BeCABOperationsReport } from "@api/backend/types";
import { CabLineChart, Sparkline } from "@features/csm-operations/components/cab-dashboard/CabCharts";
import {
  CAB_DAILY_METRICS,
  type CabDailyMetric,
  type CabKpi,
  type CabKpiKey,
  type CabMonthSelection,
  cabKpis,
  dayShortLabel,
  daysOf,
  formatKpiDelta,
  formatRate,
  formatShare,
  monthLongLabel,
  monthShortLabel,
} from "@features/csm-operations/utils/cabOperations";

/** A tile's sparkline colour, by meaning (the app's semantic roles). */
function useKpiColors(): Record<CabKpiKey, string> {
  const { palette } = useTheme();
  return {
    total: palette.primary.main,
    approvalRate: palette.success.main,
    prod: palette.warning.main,
    outageDeclared: palette.error.main,
    pending: palette.warning.main,
    standard: palette.info.main,
    emergency: palette.error.main,
  };
}

function KpiTile({ kpi, comparedWith, color }: { kpi: CabKpi; comparedWith: string | null; color: string }): JSX.Element {
  const value = kpi.isRate ? formatRate(kpi.value) : String(kpi.value ?? 0);
  const delta = formatKpiDelta(kpi, comparedWith);
  return (
    <Card sx={{ height: "100%" }} data-testid={`cab-kpi-${kpi.key}`}>
      <CardContent sx={{ py: 2, px: 2, "&:last-child": { pb: 1.5 } }}>
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.4 }}>
          {kpi.label}
        </Typography>
        <Typography variant="h4" sx={{ mt: 0.5 }}>
          {value}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", minHeight: "1.5em" }}>
          {delta ?? " "}
        </Typography>
        {kpi.sparkline.length > 1 && (
          <Sparkline values={kpi.sparkline} color={color} label={`${kpi.label} by day`} />
        )}
      </CardContent>
    </Card>
  );
}

function MonthCard({ month }: { month: BeCABOperationsMonth }): JSX.Element {
  const rows: Array<[string, string]> = [
    ["Presented", String(month.total)],
    ["Approval rate", formatRate(month.approvalRate)],
    ["Approved / rejected", `${month.approved} / ${month.rejected}`],
    ["Awaiting the CAB", String(month.pending)],
    ["PROD", `${month.prod} (${formatShare(month.prod, month.total)})`],
    ["Outages declared", String(month.outageDeclared)],
    ["Normal / standard / emergency", `${month.byModel.normal} / ${month.byModel.standard} / ${month.byModel.emergency}`],
  ];
  return (
    <Card sx={{ height: "100%" }} data-testid={`cab-month-${month.month}`}>
      <CardContent>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, mb: 1 }}>
          <Typography variant="h6">{monthLongLabel(month.month)}</Typography>
          {month.ongoing && <Chip size="small" variant="outlined" color="info" label="So far" />}
          {!month.ongoing && month.partial && <Chip size="small" variant="outlined" color="info" label="Part month" />}
        </Box>
        <Box component="dl" sx={{ m: 0, display: "grid", gridTemplateColumns: "1fr auto", rowGap: 0.5, columnGap: 2 }}>
          {rows.map(([label, value]) => (
            <Box key={label} sx={{ display: "contents" }}>
              <Typography component="dt" variant="body2" color="text.secondary">
                {label}
              </Typography>
              <Typography component="dd" variant="body2" sx={{ m: 0, textAlign: "right", fontWeight: 500 }}>
                {value}
              </Typography>
            </Box>
          ))}
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
          Top teams
        </Typography>
        {month.topTeams.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            None
          </Typography>
        ) : (
          month.topTeams.map((t) => (
            <Typography key={`${t.id ?? "none"}-${t.name}`} variant="body2" noWrap title={t.name}>
              {t.name} · {t.count}
            </Typography>
          ))
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Overview: the KPI tiles of the month selection (against the month before),
 * the ongoing month's banner, the daily activity chart and a card per month.
 */
export default function CabOverviewTab({
  report,
  selection,
}: {
  report: BeCABOperationsReport;
  selection: CabMonthSelection;
}): JSX.Element {
  const theme = useTheme();
  const colors = useKpiColors();
  const [metric, setMetric] = useState<CabDailyMetric>("total");
  const { kpis, comparedWith, ongoing, partial, partialBefore } = cabKpis(report, selection);
  const days = daysOf(report, selection);
  const metricLabel = CAB_DAILY_METRICS.find((m) => m.value === metric)?.label ?? "";
  const months = selection === "all" ? report.months : report.months.filter((m) => m.month === selection);

  let comparison: string;
  if (selection === "all") comparison = "The whole period. Pick a month to compare it with the month before.";
  else if (ongoing) comparison = `${monthLongLabel(selection)} so far.`;
  else if (partial && days.length > 0)
    comparison = `${monthLongLabel(selection)}: only ${dayShortLabel(days[0].day)} to ${dayShortLabel(days[days.length - 1].day)} is in the period, so it is not compared with the month before.`;
  else if (partialBefore)
    comparison = `${monthLongLabel(selection)}. Only part of ${monthLongLabel(partialBefore.month)} is in the period, so there is no comparison.`;
  else if (comparedWith) comparison = `${monthLongLabel(selection)}, compared with ${monthLongLabel(comparedWith)}.`;
  else comparison = `${monthLongLabel(selection)}. The month before is outside the period, so there is no comparison.`;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {ongoing && (
        <Alert severity="info" data-testid="cab-ongoing-banner">
          {monthLongLabel(ongoing.month)} is still under way: {ongoing.total} change
          {ongoing.total === 1 ? "" : "s"} presented so far, {ongoing.approved} approved, {ongoing.rejected} rejected,{" "}
          {ongoing.pending} awaiting the CAB. It is not compared with the month before until it ends.
        </Alert>
      )}

      <Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {comparison}
        </Typography>
        {/* Seven tiles: as many to a row as fit at 170px, so a phone shows one or two and a wide screen all seven. */}
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))" }}>
          {kpis.map((kpi) => (
            <KpiTile key={kpi.key} kpi={kpi} comparedWith={comparedWith} color={colors[kpi.key]} />
          ))}
        </Box>
      </Box>

      <Card>
        <CardContent>
          <Box
            sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 1, mb: 1.5 }}
          >
            <Typography variant="h6">Daily activity</Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={metric}
              aria-label="Daily activity metric"
              onChange={(_, next: CabDailyMetric | null) => {
                if (next) setMetric(next);
              }}
            >
              {CAB_DAILY_METRICS.map((m) => (
                <ToggleButton key={m.value} value={m.value} sx={{ textTransform: "none", px: 1.5 }}>
                  {m.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>
          <CabLineChart
            rows={days.map((d) => ({ label: dayShortLabel(d.day), value: d[metric] }))}
            series={[{ key: "value", label: metricLabel, color: theme.palette.primary.main }]}
            ariaLabel={`${metricLabel} presented to the CAB by day`}
          />
        </CardContent>
      </Card>

      <Box>
        <Typography variant="h6" sx={{ mb: 1.5 }}>
          {selection === "all" ? "By month" : monthShortLabel(selection)}
        </Typography>
        <Grid container spacing={2}>
          {months.map((m) => (
            <Grid key={m.month} size={{ xs: 12, sm: 6, lg: 3 }}>
              <MonthCard month={m} />
            </Grid>
          ))}
        </Grid>
      </Box>
    </Box>
  );
}
