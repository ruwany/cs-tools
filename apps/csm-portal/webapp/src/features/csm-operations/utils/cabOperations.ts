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

/**
 * The arithmetic behind Operations > CAB dashboard, kept out of the components
 * so it can be tested on its own: the URL's places and filters, the month
 * filter, the month-over-month figures of the KPI tiles, the cumulative
 * burn-up, the weekly stacks and the registry's filters. Every figure comes
 * from `GET /reports/cab-operations` (`BeCABOperationsReport`); nothing here
 * counts change requests the backend did not count.
 *
 * Dates: the report's days and months are UTC calendar days and months, and
 * its timestamps are RFC 3339 in UTC ("...Z"), so a timestamp's first 7 / 10
 * characters are its UTC month / day. Labels are formatted in UTC for the same
 * reason (a negative offset would otherwise show the day before).
 */

import type {
  BeCABOperationsCounts,
  BeCABOperationsDay,
  BeCABOperationsModel,
  BeCABOperationsMonth,
  BeCABOperationsOutcome,
  BeCABOperationsPushbackItem,
  BeCABOperationsRegistryItem,
  BeCABOperationsReport,
} from "@api/backend/types";

// --- Places and URL ----------------------------------------------------------

/** The dashboard's tabs, in order: the `view` URL parameter (Overview has none). */
export const CAB_DASHBOARD_VIEWS = [
  { value: "overview", label: "Overview" },
  { value: "queue", label: "Review queue" },
  { value: "trends", label: "Trends" },
  { value: "registry", label: "Registry" },
  { value: "downtime", label: "Downtime & risk" },
  { value: "governance", label: "Governance" },
  { value: "pushback", label: "Pushback" },
  { value: "summary", label: "Summary report" },
] as const;

export type CabDashboardView = (typeof CAB_DASHBOARD_VIEWS)[number]["value"];

/** URL parameters of the page: its tab, its month filter and its period. */
export const CAB_DASHBOARD_PARAMS = { view: "view", month: "month", from: "from", to: "to" } as const;

/** The tab the URL names, Overview for none or an unknown one. */
export function cabDashboardView(params: URLSearchParams): CabDashboardView {
  const raw = params.get(CAB_DASHBOARD_PARAMS.view);
  return CAB_DASHBOARD_VIEWS.some((v) => v.value === raw) ? (raw as CabDashboardView) : "overview";
}

/** The longest period the backend reports, in calendar months (both ends' months counted). */
export const CAB_MAX_MONTHS = 24;

/**
 * Why a period cannot be asked for, or null when it can. Either end may be
 * empty (the backend's default then applies to it). Mirrors the backend's own
 * check, so a bad range is explained here rather than by a failed request.
 */
export function cabPeriodProblem(from: string, to: string, today: string): string | null {
  const end = to || today;
  if (from && from > end) return "The start date must not be after the end date.";
  if (from) {
    const months =
      (Number(end.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
      (Number(end.slice(5, 7)) - Number(from.slice(5, 7))) +
      1;
    if (months > CAB_MAX_MONTHS) return `Pick a period of at most ${CAB_MAX_MONTHS} calendar months.`;
  }
  return null;
}

// --- Formatting ----------------------------------------------------------------

const MONTH_LONG = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
const MONTH_SHORT = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", year: "numeric" });
const DAY_SHORT = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const DAY_MEDIUM = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", dateStyle: "medium" });

function monthDate(month: string): Date {
  return new Date(`${month}-01T00:00:00Z`);
}

/** "2026-10" as "October 2026". */
export function monthLongLabel(month: string): string {
  const d = monthDate(month);
  return Number.isNaN(d.getTime()) ? month : MONTH_LONG.format(d);
}

/** "2026-10" as "Oct 2026". */
export function monthShortLabel(month: string): string {
  const d = monthDate(month);
  return Number.isNaN(d.getTime()) ? month : MONTH_SHORT.format(d);
}

/** "2026-10-07" as "Oct 7". */
export function dayShortLabel(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : DAY_SHORT.format(d);
}

/** A YYYY-MM-DD date or an RFC 3339 timestamp as its UTC day, "Oct 7, 2026"; "—" for none. */
export function dayMediumLabel(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(d.getTime()) ? value : DAY_MEDIUM.format(d);
}

/** A 0-1 rate as a whole percentage ("83%"); "—" when there is none. */
export function formatRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || Number.isNaN(rate)) return "—";
  return `${Math.round(rate * 100)}%`;
}

/** part / whole as a whole percentage; "—" when whole is 0. */
export function formatShare(part: number, whole: number): string {
  return whole > 0 ? formatRate(part / whole) : "—";
}

/** The report's model buckets, labelled. */
export const CAB_MODEL_LABELS: Record<BeCABOperationsModel, string> = {
  normal: "Normal",
  standard: "Standard",
  emergency: "Emergency",
  other: "Other",
};

/** The CAB outcomes, labelled. */
export const CAB_OUTCOME_LABELS: Record<BeCABOperationsOutcome, string> = {
  APPROVED: "Approved",
  REJECTED: "Rejected",
  PENDING: "Awaiting the CAB",
  CANCELLED: "Not decided",
};

/** A chip colour per outcome (the app's semantic roles). */
export const CAB_OUTCOME_COLORS: Record<BeCABOperationsOutcome, "success" | "error" | "warning" | "default"> = {
  APPROVED: "success",
  REJECTED: "error",
  PENDING: "warning",
  CANCELLED: "default",
};

/** A deployment type as the page shows it: "PROD" for primary production (the sheet's word), "—" for none. */
export function environmentLabel(environment: string): string {
  if (!environment) return "—";
  if (environment === "PRIMARY_PRODUCTION") return "PROD";
  const words = environment.toLowerCase().replace(/_/g, " ");
  return ["qa", "uat"].includes(words) ? words.toUpperCase() : words.charAt(0).toUpperCase() + words.slice(1);
}

// --- The month filter -----------------------------------------------------------

/** "all" or one YYYY-MM month of the report. */
export type CabMonthSelection = "all" | string;

/** The month the URL names, when it is one of the report's months; "all" otherwise. */
export function cabMonthSelection(raw: string | null, report: BeCABOperationsReport | null | undefined): CabMonthSelection {
  if (!raw || !report) return "all";
  return report.months.some((m) => m.month === raw) ? raw : "all";
}

/** True when an RFC 3339 timestamp or a YYYY-MM-DD date falls in the selection. */
export function inMonth(value: string | null | undefined, selection: CabMonthSelection): boolean {
  if (selection === "all") return true;
  return !!value && value.slice(0, 7) === selection;
}

/** True when a month's figures are a whole month's: neither ongoing nor cut short by the period. */
export function isWholeMonth(month: BeCABOperationsMonth): boolean {
  return !month.ongoing && !month.partial;
}

/** What a month's label adds: " (so far)" for the ongoing month, " (part)" for one the period cuts short. */
export function monthLabelSuffix(month: BeCABOperationsMonth): string {
  if (month.ongoing) return " (so far)";
  return month.partial ? " (part)" : "";
}

/** The days of the selection (the whole period for "all"). */
export function daysOf(report: BeCABOperationsReport, selection: CabMonthSelection): BeCABOperationsDay[] {
  return selection === "all" ? report.daily : report.daily.filter((d) => d.day.slice(0, 7) === selection);
}

// --- KPI tiles: the selection vs the month before ----------------------------------

export type CabKpiKey = "total" | "approvalRate" | "prod" | "outageDeclared" | "pending" | "standard" | "emergency";

export interface CabKpi {
  key: CabKpiKey;
  label: string;
  /** The value shown: a count, or a 0-1 rate (null: nothing decided). */
  value: number | null;
  /** True for the approval rate: `value` is a rate and the change is in percentage points. */
  isRate: boolean;
  /**
   * The change from the month before: a count difference, or percentage
   * points for the rate. Null when there is no comparison: "all", the first
   * month of the period, an ongoing or part month on either side, or a rate
   * missing on either side.
   */
  delta: number | null;
  /** The month before's value, when compared. */
  previous: number | null;
  /** One value per day of the selection (null: a day with no decision, for the rate). Empty: no sparkline. */
  sparkline: Array<number | null>;
}

export interface CabKpiSet {
  kpis: CabKpi[];
  /** The month compared with (YYYY-MM), or null when there is no comparison. */
  comparedWith: string | null;
  /** The selected month when it is the ongoing one (its figures are so far only, and it is not compared). */
  ongoing: BeCABOperationsMonth | null;
  /** The selected month when the period cuts it short and it is not the ongoing one (not compared). */
  partial: BeCABOperationsMonth | null;
  /** The month before the selected one when it is in the period but not whole (so there is no comparison). */
  partialBefore: BeCABOperationsMonth | null;
}

const KPI_DEFS: ReadonlyArray<{ key: CabKpiKey; label: string }> = [
  { key: "total", label: "Changes presented" },
  { key: "approvalRate", label: "Approval rate" },
  { key: "prod", label: "PROD changes" },
  { key: "outageDeclared", label: "Outages declared" },
  { key: "pending", label: "Awaiting the CAB" },
  { key: "standard", label: "Standard changes" },
  { key: "emergency", label: "Emergency changes" },
];

function kpiValue(counts: BeCABOperationsCounts, key: CabKpiKey): number | null {
  switch (key) {
    case "approvalRate":
      return counts.approvalRate;
    case "standard":
      return counts.byModel.standard;
    case "emergency":
      return counts.byModel.emergency;
    default:
      return counts[key];
  }
}

/** A day's approval rate, null when the CAB decided nothing that day. */
function dayRate(d: BeCABOperationsDay): number | null {
  return d.approved + d.rejected > 0 ? d.approved / (d.approved + d.rejected) : null;
}

function kpiSparkline(days: BeCABOperationsDay[], key: CabKpiKey): Array<number | null> {
  switch (key) {
    case "approvalRate":
      return days.map(dayRate);
    // The report has no per-day open count: a pending tile has no sparkline.
    case "pending":
      return [];
    default:
      return days.map((d) => d[key]);
  }
}

/**
 * The KPI tiles for a selection. "all" shows the period's totals with no
 * comparison. A month is compared with the month before it only when both are
 * in the period and both are whole: the ongoing month (the report's
 * `currentMonth`) and a month the period starts or ends inside (`partial`) are
 * shown as they stand but left out of the month-over-month comparison, on
 * either side, as a part month against a whole one would read as a fall (or,
 * as the base, a rise).
 */
export function cabKpis(report: BeCABOperationsReport, selection: CabMonthSelection): CabKpiSet {
  const index = selection === "all" ? -1 : report.months.findIndex((m) => m.month === selection);
  const month = index >= 0 ? report.months[index] : undefined;
  const current: BeCABOperationsCounts = month ?? report.totals;
  const ongoing = month?.ongoing ? month : null;
  const partial = month && !month.ongoing && month.partial ? month : null;
  const previousMonth = index > 0 ? report.months[index - 1] : undefined;
  const partialBefore = month && isWholeMonth(month) && previousMonth && !isWholeMonth(previousMonth) ? previousMonth : null;
  const before = month && isWholeMonth(month) && previousMonth && isWholeMonth(previousMonth) ? previousMonth : undefined;
  const days = daysOf(report, month ? month.month : "all");

  const kpis = KPI_DEFS.map(({ key, label }): CabKpi => {
    const value = kpiValue(current, key);
    const previous = before ? kpiValue(before, key) : null;
    const isRate = key === "approvalRate";
    let delta: number | null = null;
    if (before && value !== null && previous !== null) {
      delta = isRate ? Math.round((value - previous) * 100) : value - previous;
    }
    return { key, label, value, isRate, delta, previous, sparkline: kpiSparkline(days, key) };
  });
  return { kpis, comparedWith: before ? before.month : null, ongoing, partial, partialBefore };
}

/**
 * A tile's change as text: "+3 vs Sep 2026", "-12 pts vs Sep 2026" for the
 * rate, "No change vs Sep 2026". Null when there is no comparison.
 */
export function formatKpiDelta(kpi: CabKpi, comparedWith: string | null): string | null {
  if (kpi.delta === null || !comparedWith) return null;
  const versus = `vs ${monthShortLabel(comparedWith)}`;
  if (kpi.delta === 0) return `No change ${versus}`;
  const sign = kpi.delta > 0 ? "+" : "−";
  const amount = Math.abs(kpi.delta);
  const unit = kpi.isRate ? " pts" : "";
  const share =
    !kpi.isRate && kpi.previous ? ` (${sign}${Math.round((amount / kpi.previous) * 100)}%)` : "";
  return `${sign}${amount}${unit}${share} ${versus}`;
}

// --- Daily activity ----------------------------------------------------------------

/** The metrics the daily activity chart switches between. */
export const CAB_DAILY_METRICS = [
  { value: "total", label: "All changes" },
  { value: "prod", label: "PROD" },
  { value: "outageDeclared", label: "Outages declared" },
  { value: "standard", label: "Standard" },
  { value: "emergency", label: "Emergency" },
] as const;

export type CabDailyMetric = (typeof CAB_DAILY_METRICS)[number]["value"];

// --- Trends ---------------------------------------------------------------------

/** One day of the burn-up: running totals from the start of the period. */
export interface CabBurnUpPoint {
  day: string;
  total: number;
  approved: number;
  prod: number;
  standard: number;
  emergency: number;
}

/** Running totals of the given days (the cumulative burn-up). */
export function cabBurnUp(days: BeCABOperationsDay[]): CabBurnUpPoint[] {
  const run = { total: 0, approved: 0, prod: 0, standard: 0, emergency: 0 };
  return days.map((d) => {
    run.total += d.total;
    run.approved += d.approved;
    run.prod += d.prod;
    run.standard += d.standard;
    run.emergency += d.emergency;
    return { day: d.day, ...run };
  });
}

/** How the weekly intake bars are split. */
export type CabWeeklySplit = "team" | "type";

export interface CabWeeklyStack {
  /** One row per week: `label` and one numeric field per series key. */
  rows: Array<Record<string, string | number>>;
  /** The stacked series, bottom first. */
  series: Array<{ key: string; label: string }>;
}

/**
 * The weekly intake as stacked bars. By type: normal / standard / emergency /
 * other. By team: the report's `weeklyTeams` (its busiest teams), then
 * "Other teams" for the rest; a series is keyed by position (`team0`, ...),
 * since a team name is free text. Series with nothing in any week are left out.
 */
export function cabWeeklyStack(report: BeCABOperationsReport, split: CabWeeklySplit): CabWeeklyStack {
  let series: Array<{ key: string; label: string }>;
  let rows: Array<Record<string, string | number>>;
  if (split === "type") {
    series = (["normal", "standard", "emergency", "other"] as const).map((m) => ({ key: m, label: CAB_MODEL_LABELS[m] }));
    rows = report.weekly.map((w) => ({ label: `Week of ${dayShortLabel(w.weekStart)}`, weekStart: w.weekStart, ...w.byModel }));
  } else {
    series = [
      ...report.weeklyTeams.map((t, i) => ({ key: `team${i}`, label: t.name })),
      { key: "otherTeams", label: "Other teams" },
    ];
    rows = report.weekly.map((w) => {
      const row: Record<string, string | number> = { label: `Week of ${dayShortLabel(w.weekStart)}`, weekStart: w.weekStart };
      report.weeklyTeams.forEach((_, i) => {
        row[`team${i}`] = w.byTeam[i]?.count ?? 0;
      });
      row.otherTeams = w.otherTeams;
      return row;
    });
  }
  const used = series.filter((s) => rows.some((r) => Number(r[s.key] ?? 0) > 0));
  return { rows, series: used };
}

// --- Registry ----------------------------------------------------------------------

export interface CabRegistryFilters {
  search: string;
  outcome: BeCABOperationsOutcome | "";
  model: BeCABOperationsModel | "";
  /** A deployment type, "none" for no deployment, or "" for any. */
  environment: string;
  customer: string;
}

export const EMPTY_REGISTRY_FILTERS: CabRegistryFilters = { search: "", outcome: "", model: "", environment: "", customer: "" };

/**
 * The registry rows of the month selection (by when the CAB was asked) that
 * match the filters. The search matches the number, subject, customer, team
 * and requester, ignoring case.
 */
export function filterCabRegistry(
  items: BeCABOperationsRegistryItem[],
  selection: CabMonthSelection,
  filters: CabRegistryFilters,
): BeCABOperationsRegistryItem[] {
  const needle = filters.search.trim().toLowerCase();
  return items.filter((r) => {
    if (!inMonth(r.askedOn, selection)) return false;
    if (filters.outcome && r.outcome !== filters.outcome) return false;
    if (filters.model && r.model !== filters.model) return false;
    if (filters.environment && (filters.environment === "none" ? r.environment !== "" : r.environment !== filters.environment)) {
      return false;
    }
    if (filters.customer && r.accountName !== filters.customer) return false;
    if (needle) {
      const hay = [r.number, r.subject, r.accountName, r.assignmentGroup, r.requestedBy].join(" ").toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

/** The distinct non-empty values of one registry field, sorted, for a filter's options. */
export function registryOptions(items: BeCABOperationsRegistryItem[], field: "environment" | "accountName"): string[] {
  return [...new Set(items.map((r) => r[field]).filter((v) => v !== ""))].sort((a, b) => a.localeCompare(b));
}

/** The registry rows of the selection with an outage declared, newest asked first (the registry's own order). */
export function cabOutages(items: BeCABOperationsRegistryItem[], selection: CabMonthSelection): BeCABOperationsRegistryItem[] {
  return items.filter((r) => r.outageDeclared && inMonth(r.askedOn, selection));
}

/** The pushback items of the selection (by when the CAB member decided). */
export function cabPushbackOf(items: BeCABOperationsPushbackItem[], selection: CabMonthSelection): BeCABOperationsPushbackItem[] {
  return items.filter((p) => inMonth(p.decidedOn, selection));
}

// --- Summary report -----------------------------------------------------------------

/** What the report cannot show, said on the page and in the summary report alike. */
export const CAB_DATA_NOTES: readonly string[] = [
  "Presented means when the CAB was asked: the day the change request's latest CAB approval stage was created. No CAB meeting is recorded.",
  "Teams stand in for streams: the assignment group is shown, as the delivery stream is not recorded.",
  "Outage means an outage was declared on the change request (its service outage field is filled in); full or partial is not recorded.",
  "A change request counts once, in the month its latest CAB approval stage was created. Dates are UTC.",
];

/** The same, short, for the line under the page's filters. */
export const CAB_SHORT_NOTES: readonly string[] = [
  "Presented = when the CAB was asked.",
  "Teams stand in for streams.",
  "Outage means an outage was declared on the change request; full vs partial is not recorded.",
];

export interface CabSummary {
  /** "Jul 1, 2026 to Oct 31, 2026". */
  period: string;
  generatedOn: string;
  /** The period's headline figures, in order. */
  totals: Array<{ label: string; value: string }>;
  /** The per-month table's header and rows (an ongoing month says "so far", a part month "part"). */
  monthHeader: string[];
  monthRows: string[][];
}

/** The summary report (on screen and in the PDF) of a report. */
export function cabSummary(report: BeCABOperationsReport): CabSummary {
  const t = report.totals;
  const decidedNote = t.approved + t.rejected > 0 ? ` (${t.approved + t.rejected} decided)` : "";
  return {
    period: `${dayMediumLabel(report.from)} to ${dayMediumLabel(report.to)}`,
    generatedOn: dayMediumLabel(report.generatedOn),
    totals: [
      { label: "Changes presented to the CAB", value: String(t.total) },
      { label: "Approved", value: String(t.approved) },
      { label: "Rejected", value: String(t.rejected) },
      { label: "Awaiting the CAB", value: String(t.pending) },
      { label: "Not decided (moved on or cancelled)", value: String(t.cancelled) },
      { label: "Approval rate", value: `${formatRate(t.approvalRate)}${decidedNote}` },
      { label: "PROD changes", value: `${t.prod} (${formatShare(t.prod, t.total)})` },
      { label: "Outages declared", value: `${t.outageDeclared} (${formatShare(t.outageDeclared, t.total)})` },
      { label: "Normal changes", value: String(t.byModel.normal) },
      { label: "Standard changes", value: String(t.byModel.standard) },
      { label: "Emergency changes", value: String(t.byModel.emergency) },
      ...(t.byModel.other > 0 ? [{ label: "Other changes", value: String(t.byModel.other) }] : []),
      { label: "CAB rejections and comments", value: String(report.pushbackTotal) },
      { label: "CAB members who decided", value: String(t.approvers) },
      { label: "CAB members", value: String(report.cabMembers.length) },
    ],
    monthHeader: ["Month", "Presented", "Approved", "Rejected", "Awaiting", "Approval rate", "PROD", "Outages", "Standard", "Emergency"],
    monthRows: report.months.map((m) => [
      `${monthShortLabel(m.month)}${monthLabelSuffix(m)}`,
      String(m.total),
      String(m.approved),
      String(m.rejected),
      String(m.pending),
      formatRate(m.approvalRate),
      String(m.prod),
      String(m.outageDeclared),
      String(m.byModel.standard),
      String(m.byModel.emergency),
    ]),
  };
}
