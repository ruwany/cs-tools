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

import { describe, expect, it } from "vitest";
import { navNodeById, navViewForSearch } from "@config/csmNavItems";
import { cabReportFixture } from "@features/csm-operations/test/cabOperationsFixture";
import {
  CAB_DASHBOARD_VIEWS,
  EMPTY_REGISTRY_FILTERS,
  cabBurnUp,
  cabDashboardView,
  cabKpis,
  cabMonthSelection,
  cabOutages,
  cabPeriodProblem,
  cabPushbackOf,
  cabSummary,
  cabWeeklyStack,
  environmentLabel,
  filterCabRegistry,
  formatKpiDelta,
  formatRate,
  monthLongLabel,
  monthShortLabel,
  registryOptions,
} from "@features/csm-operations/utils/cabOperations";

describe("the dashboard's places", () => {
  it("reads the tab from ?view=, Overview for none or an unknown one", () => {
    expect(cabDashboardView(new URLSearchParams(""))).toBe("overview");
    expect(cabDashboardView(new URLSearchParams("view=registry"))).toBe("registry");
    expect(cabDashboardView(new URLSearchParams("view=nonsense"))).toBe("overview");
  });

  it("names every tab but Overview in the nav node's views, and nothing else (Recent and Pin name them)", () => {
    const node = navNodeById("operations.cab-dashboard")!;
    expect(node.views?.param).toBe("view");
    const named = Object.keys(node.views!.labels).sort();
    expect(named).toEqual(CAB_DASHBOARD_VIEWS.filter((v) => v.value !== "overview").map((v) => v.value).sort());
    expect(navViewForSearch(node, "?view=pushback&month=2026-10")?.label).toBe("CAB pushback");
  });
});

describe("cabPeriodProblem", () => {
  const today = "2026-11-10";

  it("accepts the default, an open end, and exactly 24 calendar months", () => {
    expect(cabPeriodProblem("", "", today)).toBeNull();
    expect(cabPeriodProblem("2026-09-01", "", today)).toBeNull();
    expect(cabPeriodProblem("", "2026-06-30", today)).toBeNull();
    expect(cabPeriodProblem("2024-12-31", "2026-11-01", today)).toBeNull();
  });

  it("refuses a start after the end (an empty end is today) and more than 24 months", () => {
    expect(cabPeriodProblem("2026-10-02", "2026-10-01", today)).toMatch(/must not be after/);
    expect(cabPeriodProblem("2026-11-11", "", today)).toMatch(/must not be after/);
    expect(cabPeriodProblem("2024-11-30", "2026-11-01", today)).toMatch(/at most 24 calendar months/);
  });
});

describe("formatting", () => {
  it("labels months, rates and environments in UTC and plain words", () => {
    expect(monthLongLabel("2026-10")).toBe("October 2026");
    expect(monthShortLabel("2026-01")).toBe("Jan 2026");
    expect(formatRate(0.875)).toBe("88%");
    expect(formatRate(null)).toBe("—");
    expect(environmentLabel("PRIMARY_PRODUCTION")).toBe("PROD");
    expect(environmentLabel("STAGING")).toBe("Staging");
    expect(environmentLabel("UAT")).toBe("UAT");
    expect(environmentLabel("")).toBe("—");
  });
});

describe("cabMonthSelection", () => {
  it("is the URL's month when the report has it, else all", () => {
    const report = cabReportFixture();
    expect(cabMonthSelection("2026-10", report)).toBe("2026-10");
    expect(cabMonthSelection("2025-01", report)).toBe("all");
    expect(cabMonthSelection(null, report)).toBe("all");
    expect(cabMonthSelection("2026-10", null)).toBe("all");
  });
});

describe("cabKpis", () => {
  const report = cabReportFixture();
  const byKey = (selection: string) => Object.fromEntries(cabKpis(report, selection).kpis.map((k) => [k.key, k]));

  it("compares a complete month with the month before: counts by difference, the rate in points", () => {
    const set = cabKpis(report, "2026-10");
    expect(set.comparedWith).toBe("2026-09");
    expect(set.ongoing).toBeNull();
    const k = byKey("2026-10");
    expect(k.total).toMatchObject({ value: 12, previous: 8, delta: 4 });
    // 90% against 75%.
    expect(k.approvalRate).toMatchObject({ isRate: true, delta: 15 });
    expect(k.prod).toMatchObject({ value: 5, delta: 2 });
    expect(k.outageDeclared).toMatchObject({ value: 3, delta: 2 });
    expect(k.pending).toMatchObject({ value: 1, previous: 0, delta: 1 });
    expect(k.standard).toMatchObject({ value: 4, delta: 2 });
    expect(k.emergency).toMatchObject({ value: 1, delta: 0 });

    expect(formatKpiDelta(k.total, set.comparedWith)).toBe("+4 (+50%) vs Sep 2026");
    expect(formatKpiDelta(k.approvalRate, set.comparedWith)).toBe("+15 pts vs Sep 2026");
    // No share against a month that had none.
    expect(formatKpiDelta(k.pending, set.comparedWith)).toBe("+1 vs Sep 2026");
    expect(formatKpiDelta(k.emergency, set.comparedWith)).toBe("No change vs Sep 2026");
  });

  it("shows a fall with a minus sign", () => {
    const k = byKey("2026-09");
    expect(formatKpiDelta(k.total, "2026-08")).toBe("−2 (−20%) vs Aug 2026");
  });

  it("does not compare the ongoing month, the first month of the period, or the whole period", () => {
    const ongoing = cabKpis(report, "2026-11");
    expect(ongoing.ongoing?.month).toBe("2026-11");
    expect(ongoing.comparedWith).toBeNull();
    expect(ongoing.kpis.every((k) => k.delta === null)).toBe(true);
    expect(ongoing.kpis.find((k) => k.key === "total")?.value).toBe(3);

    const first = cabKpis(report, "2026-08");
    expect(first.comparedWith).toBeNull();
    expect(first.kpis.every((k) => k.delta === null)).toBe(true);

    const all = cabKpis(report, "all");
    expect(all.comparedWith).toBeNull();
    expect(all.kpis.find((k) => k.key === "total")?.value).toBe(33);
    expect(formatKpiDelta(all.kpis[0], all.comparedWith)).toBeNull();
  });

  it("draws each sparkline over the selection's days, the rate with gaps, and none for pending", () => {
    const k = byKey("2026-10");
    expect(k.total.sparkline).toHaveLength(31);
    expect(k.total.sparkline[5]).toBe(5); // Oct 6
    expect(k.approvalRate.sparkline[5]).toBeCloseTo(0.8);
    expect(k.approvalRate.sparkline[0]).toBeNull();
    expect(k.pending.sparkline).toEqual([]);
    expect(byKey("all").total.sparkline).toHaveLength(report.daily.length);
  });
});

describe("cabBurnUp", () => {
  it("keeps running totals", () => {
    const points = cabBurnUp(cabReportFixture().daily);
    expect(points[0]).toMatchObject({ day: "2026-08-01", total: 0 });
    expect(points.at(-1)).toMatchObject({ total: 33, approved: 23, prod: 13, standard: 10, emergency: 3 });
    const oct6 = points.find((p) => p.day === "2026-10-06");
    expect(oct6).toMatchObject({ total: 23, approved: 17 });
  });
});

describe("cabWeeklyStack", () => {
  it("stacks by team (positional keys, then other teams) and leaves out a series with nothing in it", () => {
    const stack = cabWeeklyStack(cabReportFixture(), "team");
    expect(stack.series).toEqual([
      { key: "team0", label: "Apollo team" },
      { key: "team1", label: "Artemis team" },
      { key: "otherTeams", label: "Other teams" },
    ]);
    expect(stack.rows[0]).toMatchObject({ label: "Week of Oct 5", team0: 3, team1: 1, otherTeams: 1 });

    const byType = cabWeeklyStack(cabReportFixture(), "type");
    expect(byType.series.map((s) => s.key)).toEqual(["normal", "standard", "emergency"]);
    expect(byType.rows[1]).toMatchObject({ normal: 4, standard: 2, emergency: 1 });
  });
});

describe("the registry and its views", () => {
  const report = cabReportFixture();

  it("filters by month (when the CAB was asked), outcome, model, environment, customer and search", () => {
    const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
    expect(ids(filterCabRegistry(report.registry, "all", EMPTY_REGISTRY_FILTERS))).toEqual(["cr-r1", "cr-r2", "cr-r3", "cr-r4"]);
    expect(ids(filterCabRegistry(report.registry, "2026-10", EMPTY_REGISTRY_FILTERS))).toEqual(["cr-r2", "cr-r3"]);
    expect(ids(filterCabRegistry(report.registry, "all", { ...EMPTY_REGISTRY_FILTERS, outcome: "APPROVED" }))).toEqual([
      "cr-r3",
      "cr-r4",
    ]);
    expect(ids(filterCabRegistry(report.registry, "all", { ...EMPTY_REGISTRY_FILTERS, model: "emergency" }))).toEqual(["cr-r2"]);
    expect(
      ids(filterCabRegistry(report.registry, "all", { ...EMPTY_REGISTRY_FILTERS, environment: "PRIMARY_PRODUCTION" })),
    ).toEqual(["cr-r1", "cr-r3"]);
    expect(ids(filterCabRegistry(report.registry, "all", { ...EMPTY_REGISTRY_FILTERS, environment: "none" }))).toEqual(["cr-r4"]);
    expect(ids(filterCabRegistry(report.registry, "all", { ...EMPTY_REGISTRY_FILTERS, customer: "Other Corp" }))).toEqual([
      "cr-r2",
      "cr-r4",
    ]);
    expect(ids(filterCabRegistry(report.registry, "all", { ...EMPTY_REGISTRY_FILTERS, search: "erin" }))).toEqual(["cr-r2", "cr-r4"]);
    expect(ids(filterCabRegistry(report.registry, "all", { ...EMPTY_REGISTRY_FILTERS, search: "chg0002003" }))).toEqual(["cr-r3"]);
  });

  it("offers each distinct environment and customer once, sorted", () => {
    expect(registryOptions(report.registry, "environment")).toEqual(["PRIMARY_PRODUCTION", "STAGING"]);
    expect(registryOptions(report.registry, "accountName")).toEqual(["Example Corp", "Other Corp"]);
  });

  it("lists the declared outages and the pushback of a month", () => {
    expect(cabOutages(report.registry, "all").map((r) => r.id)).toEqual(["cr-r1", "cr-r3"]);
    expect(cabOutages(report.registry, "2026-10").map((r) => r.id)).toEqual(["cr-r3"]);
    expect(cabPushbackOf(report.pushback, "2026-09").map((p) => p.changeRequestId)).toEqual(["cr-r5"]);
    expect(cabPushbackOf(report.pushback, "all")).toHaveLength(3);
  });
});

describe("cabSummary", () => {
  it("gives the period's figures and a row per month, the ongoing one marked", () => {
    const summary = cabSummary(cabReportFixture());
    expect(summary.period).toBe("Aug 1, 2026 to Nov 10, 2026");
    const value = (label: string) => summary.totals.find((t) => t.label === label)?.value;
    expect(value("Changes presented to the CAB")).toBe("33");
    expect(value("Approval rate")).toBe("82% (28 decided)");
    expect(value("PROD changes")).toBe("13 (39%)");
    expect(value("CAB members who decided")).toBe("3");
    expect(value("Other changes")).toBeUndefined();
    expect(summary.monthRows).toHaveLength(4);
    expect(summary.monthRows[2]).toEqual(["Oct 2026", "12", "9", "1", "1", "90%", "5", "3", "4", "1"]);
    expect(summary.monthRows[3][0]).toBe("Nov 2026 (so far)");
  });
});
