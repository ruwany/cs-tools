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

import { Box, Typography } from "@wso2/oxygen-ui";
import { BarChart, LineChart, XAxis } from "@wso2/oxygen-ui-charts-react";
import type { JSX } from "react";

/**
 * The CAB dashboard's charts, on the house chart library
 * (`@wso2/oxygen-ui-charts-react`) the way `DashboardLineChart.tsx` uses it:
 * no animation, the library's legend off in favour of a hand-drawn one
 * (`ChartLegend`; see DashboardLineChart for why), an x-axis thinned to what
 * fits. Colours are passed in by the caller from the theme's palette, so they
 * follow the light and dark schemes.
 */

/** One drawn series: its data key, label and colour. */
export interface CabSeries {
  key: string;
  label: string;
  color: string;
}

/** The legend above a chart: a dot and a label per series. */
export function ChartLegend({ series }: { series: CabSeries[] }): JSX.Element {
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 2, rowGap: 0.5, mb: 1 }}>
      {series.map((s) => (
        <Box key={s.key} sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
          <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: s.color, flexShrink: 0 }} />
          <Typography variant="caption" color="text.secondary">
            {s.label}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

/** "Nothing to show" in place of a chart whose data is all zero. */
export function ChartEmpty({ height, message = "Nothing to show for this period." }: { height: number; message?: string }): JSX.Element {
  return (
    <Box sx={{ minHeight: height, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Typography variant="body2" color="text.secondary">
        {message}
      </Typography>
    </Box>
  );
}

const SPARKLINE_HEIGHT_PX = 36;

/**
 * A KPI tile's sparkline: one line, no axes, grid, tooltip or legend. A null
 * value (a day with nothing to rate) is a gap the line is drawn across.
 */
export function Sparkline({ values, color, label }: { values: Array<number | null>; color: string; label: string }): JSX.Element {
  const data = values.map((v, i) => ({ i, v }));
  return (
    <Box role="img" aria-label={label} sx={{ width: "100%", height: SPARKLINE_HEIGHT_PX }}>
      <LineChart
        data={data}
        xAxisDataKey="i"
        height={SPARKLINE_HEIGHT_PX}
        width="100%"
        legend={{ show: false }}
        grid={{ show: false }}
        tooltip={{ show: false }}
        margin={{ top: 4, right: 2, bottom: 2, left: 2 }}
        xAxis={{ show: false }}
        yAxis={{ show: false }}
        lines={[{ dataKey: "v", stroke: color, strokeWidth: 1.5, dot: false, connectNulls: true, isAnimationActive: false }]}
      />
    </Box>
  );
}

interface CabLineChartProps {
  /** One row per point: `label` (the x-axis) and one numeric field per series. */
  rows: Array<Record<string, string | number>>;
  series: CabSeries[];
  height?: number;
  /** Read by screen readers in place of the drawing. */
  ariaLabel: string;
}

/** A line chart of one or more series over the period's days. */
export function CabLineChart({ rows, series, height = 240, ariaLabel }: CabLineChartProps): JSX.Element {
  const total = rows.reduce((sum, r) => sum + series.reduce((s, x) => s + Number(r[x.key] ?? 0), 0), 0);
  if (rows.length === 0 || total === 0) return <ChartEmpty height={height} />;
  return (
    <Box>
      {series.length > 1 && <ChartLegend series={series} />}
      <Box role="img" aria-label={ariaLabel} sx={{ width: "100%", height }}>
        <LineChart
          data={rows}
          xAxisDataKey="label"
          height={height}
          width="100%"
          legend={{ show: false }}
          grid={{ show: true, strokeDasharray: "3 3" }}
          margin={{ top: 8, right: 8, bottom: 8, left: 0 }}
          tooltip={{ show: true, wrapperStyle: { zIndex: 1000 } }}
          xAxis={{ show: true, interval: "preserveStartEnd" }}
          yAxis={{ show: true }}
          lines={series.map((s) => ({
            dataKey: s.key,
            name: s.label,
            stroke: s.color,
            strokeWidth: 2,
            dot: false,
            isAnimationActive: false,
          }))}
        />
      </Box>
    </Box>
  );
}

interface CabStackedBarChartProps {
  rows: Array<Record<string, string | number>>;
  /** Stacked bottom first. */
  series: CabSeries[];
  height?: number;
  ariaLabel: string;
}

/** Stacked bars, one bar per row (a week), one segment per series. */
export function CabStackedBarChart({ rows, series, height = 260, ariaLabel }: CabStackedBarChartProps): JSX.Element {
  if (rows.length === 0 || series.length === 0) return <ChartEmpty height={height} />;
  return (
    <Box>
      <ChartLegend series={series} />
      <Box role="img" aria-label={ariaLabel} sx={{ width: "100%", height }}>
        <BarChart
          data={rows}
          xAxisDataKey="label"
          height={height}
          width="100%"
          legend={{ show: false }}
          grid={{ show: true, strokeDasharray: "3 3" }}
          margin={{ top: 8, right: 8, bottom: 8, left: 0 }}
          tooltip={{ show: true, wrapperStyle: { zIndex: 1000 } }}
          xAxis={{ show: false }}
          yAxis={{ show: true }}
          bars={series.map((s, i) => ({
            dataKey: s.key,
            name: s.label,
            fill: s.color,
            stackId: "intake",
            // Round only the top segment's top corners.
            radius: (i === series.length - 1 ? [4, 4, 0, 0] : 0) as number | [number, number, number, number],
            isAnimationActive: false,
          }))}
        >
          <XAxis dataKey="label" interval="preserveStartEnd" tickLine={false} />
        </BarChart>
      </Box>
    </Box>
  );
}

/**
 * A single bar split by share (the classification of the period's changes),
 * with each part's count and share listed under it. Drawn with plain boxes:
 * it is one proportion, not a series.
 */
export function ProportionBar({
  parts,
  ariaLabel,
}: {
  parts: Array<CabSeries & { value: number }>;
  ariaLabel: string;
}): JSX.Element {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total === 0) return <ChartEmpty height={48} />;
  const shown = parts.filter((p) => p.value > 0);
  return (
    <Box>
      <Box
        role="img"
        aria-label={ariaLabel}
        sx={{ display: "flex", height: 20, borderRadius: 1, overflow: "hidden", bgcolor: "action.hover" }}
      >
        {shown.map((p) => (
          <Box key={p.key} sx={{ width: `${(p.value / total) * 100}%`, bgcolor: p.color }} />
        ))}
      </Box>
      <Box sx={{ display: "flex", flexWrap: "wrap", columnGap: 3, rowGap: 0.5, mt: 1 }}>
        {parts.map((p) => (
          <Box key={p.key} sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: p.color, flexShrink: 0 }} />
            <Typography variant="body2">
              {p.label}: <strong>{p.value}</strong>{" "}
              <Typography component="span" variant="body2" color="text.secondary">
                ({Math.round((p.value / total) * 100)}%)
              </Typography>
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
