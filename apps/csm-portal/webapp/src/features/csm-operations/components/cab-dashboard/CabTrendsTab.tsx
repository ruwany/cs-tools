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
  Box,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useTheme,
} from "@wso2/oxygen-ui";
import { useState, type JSX } from "react";
import type { BeCABOperationsReport } from "@api/backend/types";
import { CabCard } from "@features/csm-operations/components/cab-dashboard/CabCard";
import { CAB_TABLE_SX, CAB_TABLE_WRAPPER_SX } from "@features/csm-operations/components/cab-dashboard/cabTableStyles";
import { useReportChartColors } from "@features/csm-reports/components/useReportChartColors";
import {
  CabLineChart,
  CabStackedBarChart,
  ProportionBar,
} from "@features/csm-operations/components/cab-dashboard/CabCharts";
import {
  CAB_MODEL_LABELS,
  type CabWeeklySplit,
  cabBurnUp,
  cabWeeklyStack,
  dayShortLabel,
  formatRate,
  formatShare,
} from "@features/csm-operations/utils/cabOperations";

/**
 * Trends over the whole period (the month filter does not narrow them: the
 * report has no team or customer figures per month): by team, the
 * classification of the changes, the weekly intake and the cumulative burn-up.
 */
export default function CabTrendsTab({ report }: { report: BeCABOperationsReport }): JSX.Element {
  const { palette } = useTheme();
  const teamColors = useReportChartColors();
  const [split, setSplit] = useState<CabWeeklySplit>("team");

  const modelColors = {
    normal: palette.primary.main,
    standard: palette.info.main,
    emergency: palette.error.main,
    other: palette.grey[500],
  };
  const weekly = cabWeeklyStack(report, split);
  const weeklySeries = weekly.series.map((s, i) => ({
    ...s,
    color:
      split === "type"
        ? modelColors[s.key as keyof typeof modelColors]
        : s.key === "otherTeams"
          ? palette.grey[500]
          : teamColors[i % teamColors.length],
  }));
  const burnUp = cabBurnUp(report.daily).map((p) => ({ ...p, label: dayShortLabel(p.day) }));
  const t = report.totals;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Typography variant="body2" color="text.secondary">
        The whole period. Change the dates to narrow it. Teams stand in for streams.
      </Typography>

      <CabCard title="By team" caption="Each assignment group's changes presented to the CAB, busiest first.">
        {report.teams.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No change requests in this period.
          </Typography>
        ) : (
          <Box sx={CAB_TABLE_WRAPPER_SX}>
            <TableContainer>
              <Table size="small" sx={CAB_TABLE_SX} aria-label="By team">
                <TableHead>
                  <TableRow sx={{ bgcolor: "action.hover" }}>
                    <TableCell>Team</TableCell>
                    <TableCell align="right">Presented</TableCell>
                    <TableCell align="right">Approval rate</TableCell>
                    <TableCell align="right">Outages declared</TableCell>
                    <TableCell align="right">Standard</TableCell>
                    <TableCell align="right">Emergency</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {report.teams.map((team) => (
                    <TableRow key={`${team.groupId ?? "none"}-${team.name}`}>
                      <TableCell sx={{ maxWidth: 320 }}>
                        <Typography variant="body2" noWrap title={team.name}>
                          {team.name}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">{team.total}</TableCell>
                      <TableCell align="right">{formatRate(team.approvalRate)}</TableCell>
                      <TableCell align="right">
                        {team.outageDeclared} ({formatShare(team.outageDeclared, team.total)})
                      </TableCell>
                      <TableCell align="right">{team.standard}</TableCell>
                      <TableCell align="right">{team.emergency}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}
      </CabCard>

      <CabCard title="Classification" caption={`${t.total} change${t.total === 1 ? "" : "s"} by change model.`}>
        <ProportionBar
          ariaLabel="Changes by change model"
          parts={(["normal", "standard", "emergency", "other"] as const)
            .filter((m) => m !== "other" || t.byModel.other > 0)
            .map((m) => ({ key: m, label: CAB_MODEL_LABELS[m], color: modelColors[m], value: t.byModel[m] }))}
        />
      </CabCard>

      <CabCard
        title="Weekly intake"
        caption="Changes presented each week (Monday to Sunday)."
        action={
          <ToggleButtonGroup
            exclusive
            size="small"
            value={split}
            aria-label="Split the weekly intake"
            onChange={(_, next: CabWeeklySplit | null) => {
              if (next) setSplit(next);
            }}
          >
            <ToggleButton value="team" sx={{ textTransform: "none", px: 1.5 }}>
              By team
            </ToggleButton>
            <ToggleButton value="type" sx={{ textTransform: "none", px: 1.5 }}>
              By type
            </ToggleButton>
          </ToggleButtonGroup>
        }
      >
        <CabStackedBarChart
          rows={weekly.rows}
          series={weeklySeries}
          ariaLabel={split === "team" ? "Weekly intake by team" : "Weekly intake by change model"}
        />
      </CabCard>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 5 }}>
          <CabCard title="Customer intake" caption="Changes presented, by customer.">
            {report.customers.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No change requests in this period.
              </Typography>
            ) : (
              <Box sx={CAB_TABLE_WRAPPER_SX}>
                <TableContainer sx={{ maxHeight: 360 }}>
                  <Table size="small" stickyHeader sx={CAB_TABLE_SX} aria-label="Customer intake">
                    <TableHead>
                      <TableRow sx={{ bgcolor: "action.hover" }}>
                        <TableCell>Customer</TableCell>
                        <TableCell align="right">Presented</TableCell>
                        <TableCell align="right">Approved</TableCell>
                        <TableCell align="right">Rejected</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {report.customers.map((c) => (
                        <TableRow key={`${c.accountId ?? "none"}-${c.name}`}>
                          <TableCell sx={{ maxWidth: 220 }}>
                            <Typography variant="body2" noWrap title={c.name}>
                              {c.name}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">{c.total}</TableCell>
                          <TableCell align="right">{c.approved}</TableCell>
                          <TableCell align="right">{c.rejected}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            )}
          </CabCard>
        </Grid>
        <Grid size={{ xs: 12, md: 7 }}>
          <CabCard title="Cumulative burn-up" caption="Running totals from the start of the period.">
            <CabLineChart
              rows={burnUp}
              ariaLabel="Cumulative changes presented, approved, PROD, standard and emergency"
              series={[
                { key: "total", label: "Presented", color: palette.primary.main },
                { key: "approved", label: "Approved", color: palette.success.main },
                { key: "prod", label: "PROD", color: palette.warning.main },
                { key: "standard", label: "Standard", color: palette.info.main },
                { key: "emergency", label: "Emergency", color: palette.error.main },
              ]}
            />
          </CabCard>
        </Grid>
      </Grid>
    </Box>
  );
}
