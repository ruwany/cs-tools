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
 * Operations > CAB dashboard, rendered from a fixture report: each tab, the
 * month filter, the month-over-month figures of the tiles, the ongoing month,
 * and the loading / error / bad-period states. The report hook is stubbed
 * (its own test covers the request) and the chart library is replaced by
 * recorders of what each chart is handed (jsdom draws no SVG).
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JSX, ReactNode } from "react";
import "@testing-library/jest-dom/vitest";
import type { BeCABOperationsReport } from "@api/backend/types";
import { cabReportFixture } from "@features/csm-operations/test/cabOperationsFixture";

type ChartSeries = { dataKey: string; name?: string; stackId?: string };

vi.mock("@wso2/oxygen-ui-charts-react", () => ({
  LineChart: ({ data, lines }: { data: Array<Record<string, unknown>>; lines: ChartSeries[] }) => (
    <div
      data-testid="line-chart"
      data-series={lines.map((l) => l.name ?? l.dataKey).join(",")}
      data-points={data.length}
      data-sum={data.reduce((s, row) => s + lines.reduce((t, l) => t + (Number(row[l.dataKey]) || 0), 0), 0)}
    />
  ),
  BarChart: ({ data, bars, children }: { data: unknown[]; bars: ChartSeries[]; children?: ReactNode }) => (
    <div
      data-testid="bar-chart"
      data-series={bars.map((b) => b.name ?? b.dataKey).join(",")}
      data-stacked={bars.every((b) => b.stackId === "intake") ? "yes" : "no"}
      data-points={data.length}
    >
      {children}
    </div>
  ),
  XAxis: () => null,
}));

const showError = vi.fn();
vi.mock("@context/error-banner/ErrorBannerContext", () => ({
  useErrorBanner: () => ({ showError }),
}));

const downloadPdf = vi.fn();
vi.mock("@features/csm-operations/utils/cabOperationsReportPdf", () => ({
  downloadCabOperationsReportPdf: (report: unknown) => downloadPdf(report),
}));

interface QueryStub {
  data: BeCABOperationsReport | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  isPlaceholderData: boolean;
  error: Error | null;
  dataUpdatedAt: number;
  refetch: () => void;
}
let queryStub: QueryStub;
const hookCalls: Array<{ period: { from: string; to: string }; enabled: boolean | undefined }> = [];
const refetch = vi.fn();
vi.mock("@features/csm-operations/api/useGetCABOperationsReport", () => ({
  CABReportUnavailableError: class CABReportUnavailableError extends Error {
    constructor() {
      super("The CAB dashboard is not available on this deployment.");
    }
  },
  useGetCABOperationsReport: (period: { from: string; to: string }, options: { enabled?: boolean } = {}) => {
    hookCalls.push({ period, enabled: options.enabled });
    return queryStub;
  },
}));

import CabOperationsDashboard from "@features/csm-operations/components/cab-dashboard/CabOperationsDashboard";

function Probe(): JSX.Element {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderAt(entry = "/operations/cab-dashboard"): void {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/operations/:tab"
          element={
            <>
              <CabOperationsDashboard />
              <Probe />
            </>
          }
        />
        <Route path="/operations/change-requests/:id" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

const url = (): string => screen.getByTestId("location").textContent ?? "";
const tile = (key: string): HTMLElement => screen.getByTestId(`cab-kpi-${key}`);
const monthChips = (): HTMLElement => screen.getByRole("group", { name: "Month" });
const openTab = (name: RegExp | string): void => {
  fireEvent.click(within(screen.getByRole("tablist", { name: "CAB dashboard" })).getByRole("tab", { name }));
};

beforeEach(() => {
  hookCalls.length = 0;
  refetch.mockReset();
  showError.mockReset();
  downloadPdf.mockReset();
  queryStub = {
    data: cabReportFixture(),
    isPending: false,
    isError: false,
    isFetching: false,
    isPlaceholderData: false,
    error: null,
    dataUpdatedAt: 0,
    refetch,
  };
});

describe("CabOperationsDashboard — the period and the page's notes", () => {
  it("asks for the backend's default period with no dates in the URL, and the URL's dates otherwise", () => {
    renderAt();
    expect(hookCalls.at(-1)).toEqual({ period: { from: "", to: "" }, enabled: true });
    renderAt("/operations/cab-dashboard?from=2026-09-01&to=2026-10-31");
    expect(hookCalls.at(-1)).toEqual({ period: { from: "2026-09-01", to: "2026-10-31" }, enabled: true });
  });

  it("says what the data cannot show, and the period shown", () => {
    renderAt();
    expect(screen.getByText(/Presented = when the CAB was asked\./)).toBeInTheDocument();
    expect(screen.getByText(/Teams stand in for streams\./)).toBeInTheDocument();
    expect(screen.getByText(/Outage means an outage was declared on the change request; full vs partial is not recorded\./)).toBeInTheDocument();
    expect(screen.getByText(/Aug 1, 2026 to Nov 10, 2026 \(UTC\)/)).toBeInTheDocument();
  });

  it("refuses a period of more than 24 months without asking the backend", () => {
    renderAt("/operations/cab-dashboard?from=2020-01-01&to=2026-10-31");
    expect(hookCalls.at(-1)?.enabled).toBe(false);
    expect(screen.getByText("Pick a period of at most 24 calendar months.")).toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "CAB dashboard" })).not.toBeInTheDocument();
  });

  it("goes back to the last four months, dropping the month filter", () => {
    renderAt("/operations/cab-dashboard?from=2026-09-01&month=2026-10&view=registry");
    fireEvent.click(screen.getByRole("button", { name: "Last four months" }));
    expect(url()).toBe("/operations/cab-dashboard?view=registry");
  });

  it("shows placeholders while loading, and an error with a retry when the report fails", () => {
    queryStub = { ...queryStub, data: undefined, isPending: true };
    renderAt();
    expect(screen.queryByTestId("cab-kpi-total")).not.toBeInTheDocument();

    queryStub = { ...queryStub, isPending: false, isError: true, error: new Error("boom") };
    renderAt();
    expect(screen.getByText("Could not load the CAB dashboard.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("says the report is not offered on this deployment (a 404) as an error, with no retry and no empty dashboard", async () => {
    const { CABReportUnavailableError } = await import("@features/csm-operations/api/useGetCABOperationsReport");
    queryStub = { ...queryStub, data: undefined, isError: true, error: new CABReportUnavailableError() };
    renderAt();
    expect(screen.getByText("The CAB dashboard is not available on this deployment.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "CAB dashboard" })).not.toBeInTheDocument();
    expect(screen.queryByText(/no CAB report/i)).not.toBeInTheDocument();
  });

  it("keeps the last report on screen, marked, while a new period loads", () => {
    queryStub = { ...queryStub, isPlaceholderData: true, isFetching: true };
    renderAt();
    expect(screen.getByRole("progressbar", { name: "Loading the new period" })).toBeInTheDocument();
    expect(tile("total")).toHaveTextContent("33");
  });

  it("keeps the last report on screen, marked as not refreshed, when a refresh fails", () => {
    queryStub = { ...queryStub, isError: true, error: new Error("boom") };
    renderAt();
    expect(
      screen.getByText("Could not refresh the CAB dashboard. The figures below are from the last successful load."),
    ).toBeInTheDocument();
    expect(tile("total")).toHaveTextContent("33");
  });
});

describe("CabOperationsDashboard — Overview and the month filter", () => {
  it("shows the whole period with no comparison under All", () => {
    renderAt();
    expect(within(monthChips()).getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("The whole period. Pick a month to compare it with the month before.")).toBeInTheDocument();
    expect(tile("total")).toHaveTextContent("Changes presented33");
    expect(tile("approvalRate")).toHaveTextContent("82%");
    expect(tile("total")).not.toHaveTextContent(/vs /);
    // A card per month.
    for (const m of ["2026-08", "2026-09", "2026-10", "2026-11"]) expect(screen.getByTestId(`cab-month-${m}`)).toBeInTheDocument();
  });

  it("compares a picked month with the month before (MoM deltas), and keeps the month in the URL", () => {
    renderAt();
    fireEvent.click(within(monthChips()).getByRole("button", { name: "Oct 2026" }));
    expect(url()).toBe("/operations/cab-dashboard?month=2026-10");
    expect(screen.getByText("October 2026, compared with September 2026.")).toBeInTheDocument();
    expect(tile("total")).toHaveTextContent("12");
    expect(tile("total")).toHaveTextContent("+4 (+50%) vs Sep 2026");
    expect(tile("approvalRate")).toHaveTextContent("90%");
    expect(tile("approvalRate")).toHaveTextContent("+15 pts vs Sep 2026");
    expect(tile("prod")).toHaveTextContent("+2 (+67%) vs Sep 2026");
    expect(tile("outageDeclared")).toHaveTextContent("+2 (+200%) vs Sep 2026");
    expect(tile("emergency")).toHaveTextContent("No change vs Sep 2026");
    // Only that month's card.
    expect(screen.getByTestId("cab-month-2026-10")).toBeInTheDocument();
    expect(screen.queryByTestId("cab-month-2026-09")).not.toBeInTheDocument();
    // Pending has no sparkline (the report has no per-day open count); the others do.
    expect(within(tile("total")).getByRole("img", { name: "Changes presented by day" })).toBeInTheDocument();
    expect(within(tile("pending")).queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows the ongoing month as it stands, with a banner, and does not compare it", () => {
    renderAt("/operations/cab-dashboard?month=2026-11");
    const banner = screen.getByTestId("cab-ongoing-banner");
    expect(banner).toHaveTextContent("November 2026 is still under way: 3 changes presented so far, 1 approved, 0 rejected, 2 awaiting the CAB.");
    expect(tile("total")).toHaveTextContent("3");
    expect(tile("total")).not.toHaveTextContent(/vs /);
    expect(within(monthChips()).getByRole("button", { name: "Nov 2026 (so far)" })).toHaveAttribute("aria-pressed", "true");
  });

  it("does not compare a month the period cuts short, and marks it", () => {
    const cut = cabReportFixture();
    cut.from = "2026-08-01";
    cut.to = "2026-10-10";
    cut.months = cut.months
      .filter((m) => m.month !== "2026-11")
      .map((m) => ({ ...m, partial: m.month === "2026-10" }));
    cut.daily = cut.daily.filter((d) => d.day <= "2026-10-10");
    queryStub = { ...queryStub, data: cut };
    renderAt("/operations/cab-dashboard?month=2026-10");
    expect(
      screen.getByText("October 2026: only Oct 1 to Oct 10 is in the period, so it is not compared with the month before."),
    ).toBeInTheDocument();
    expect(tile("total")).not.toHaveTextContent(/vs /);
    expect(within(monthChips()).getByRole("button", { name: "Oct 2026 (part)" })).toHaveAttribute("aria-pressed", "true");
    expect(within(screen.getByTestId("cab-month-2026-10")).getByText("Part month")).toBeInTheDocument();
  });

  it("has no comparison for the first month of the period", () => {
    renderAt("/operations/cab-dashboard?month=2026-08");
    expect(screen.getByText(/The month before is outside the period, so there is no comparison\./)).toBeInTheDocument();
    expect(tile("total")).not.toHaveTextContent(/vs /);
  });

  it("reads an unknown month in the URL as All", () => {
    renderAt("/operations/cab-dashboard?month=2024-01");
    expect(within(monthChips()).getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
  });

  it("switches the daily activity chart's metric", () => {
    renderAt("/operations/cab-dashboard?month=2026-10");
    const daily = (): HTMLElement => screen.getByRole("img", { name: /presented to the CAB by day/ }).firstElementChild as HTMLElement;
    expect(daily()).toHaveAttribute("data-points", "31");
    expect(daily()).toHaveAttribute("data-sum", "12");
    fireEvent.click(screen.getByRole("button", { name: "PROD" }));
    expect(screen.getByRole("img", { name: "PROD presented to the CAB by day" })).toBeInTheDocument();
    expect(daily()).toHaveAttribute("data-sum", "5");
    fireEvent.click(screen.getByRole("button", { name: "Outages declared" }));
    expect(daily()).toHaveAttribute("data-sum", "3");
  });
});

describe("CabOperationsDashboard — the other tabs", () => {
  it("lists the review queue, oldest first, linking each change request (where the CAB decides)", () => {
    renderAt();
    openTab("Review queue (2)");
    expect(url()).toBe("/operations/cab-dashboard?view=queue");
    const table = screen.getByRole("table", { name: "Awaiting the CAB" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("CHG0001001");
    expect(rows[0]).toHaveTextContent("PROD");
    expect(rows[0]).toHaveTextContent("Declared");
    expect(rows[0]).toHaveTextContent("10 days ago");
    expect(rows[0]).toHaveTextContent("Alice Approver, Bob Board");
    expect(rows[1]).toHaveTextContent("Nobody is asked");
    expect(within(table).queryByRole("button", { name: /approve|reject/i })).not.toBeInTheDocument();
    fireEvent.click(within(rows[0]).getByRole("link", { name: "CHG0001001" }));
    expect(url()).toBe("/operations/change-requests/cr-q1");
  });

  it("does not narrow the queue by month, and says so", () => {
    renderAt("/operations/cab-dashboard?view=queue&month=2026-10");
    expect(screen.getByText("The month filter does not apply to this tab.")).toBeInTheDocument();
    expect(within(screen.getByRole("table", { name: "Awaiting the CAB" })).getAllByRole("row")).toHaveLength(3);
  });

  it("shows the trends: teams, classification, weekly intake by team or type, customers and the burn-up", () => {
    renderAt("/operations/cab-dashboard?view=trends");
    const teams = screen.getByRole("table", { name: "By team" });
    expect(within(teams).getAllByRole("row")[1]).toHaveTextContent("Apollo team1887%4 (22%)62");
    expect(screen.getByRole("img", { name: "Changes by change model" })).toBeInTheDocument();
    expect(screen.getByText(/Standard:/).closest("p")).toHaveTextContent("Standard: 10 (30%)");

    const weekly = (): HTMLElement => screen.getByTestId("bar-chart");
    expect(weekly()).toHaveAttribute("data-series", "Apollo team,Artemis team,Other teams");
    expect(weekly()).toHaveAttribute("data-stacked", "yes");
    fireEvent.click(screen.getByRole("button", { name: "By type" }));
    expect(weekly()).toHaveAttribute("data-series", "Normal,Standard,Emergency");

    expect(within(screen.getByRole("table", { name: "Customer intake" })).getAllByRole("row")).toHaveLength(3);
    const burnUp = screen.getByRole("img", { name: /^Cumulative changes/ }).firstElementChild as HTMLElement;
    expect(burnUp).toHaveAttribute("data-series", "Presented,Approved,PROD,Standard,Emergency");
  });

  it("searches and filters the registry, narrowed by the month", async () => {
    renderAt("/operations/cab-dashboard?view=registry");
    const rows = (): HTMLElement[] => within(screen.getByRole("table", { name: "Registry" })).getAllByRole("row").slice(1);
    expect(rows()).toHaveLength(4);
    expect(rows()[1]).toHaveTextContent("Rejected");
    expect(rows()[1]).toHaveTextContent("Add the rollback steps first.");

    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "database" } });
    expect(rows()).toHaveLength(1);
    expect(within(rows()[0]).getByRole("link", { name: "CHG0002003" })).toHaveAttribute("href", "/operations/change-requests/cr-r3");
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "" } });

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Outcome" }));
    fireEvent.click(await screen.findByRole("option", { name: "Approved" }));
    await waitFor(() => expect(rows()).toHaveLength(2));

    fireEvent.click(within(monthChips()).getByRole("button", { name: "Sep 2026" }));
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent("CHG0002004");
  });

  it("keeps showing rows when the month filter shortens the registry while on a later page", () => {
    // 30 change requests in October, 5 in September: page 2 of October, then September.
    const base = cabReportFixture().registry[0];
    const registry = [
      ...Array.from({ length: 30 }, (_, i) => ({
        ...base,
        id: `cr-oct-${i}`,
        number: `CHG10${String(i).padStart(3, "0")}`,
        askedOn: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}T09:00:00Z`,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        ...base,
        id: `cr-sep-${i}`,
        number: `CHG20${String(i).padStart(3, "0")}`,
        askedOn: `2026-09-${String(1 + i).padStart(2, "0")}T09:00:00Z`,
      })),
    ];
    queryStub = { ...queryStub, data: { ...cabReportFixture(), registry, registryTotal: registry.length } };
    renderAt("/operations/cab-dashboard?view=registry&month=2026-10");
    const rows = (): HTMLElement[] => within(screen.getByRole("table", { name: "Registry" })).getAllByRole("row").slice(1);
    fireEvent.click(screen.getByRole("button", { name: "Go to next page" }));
    expect(rows()).toHaveLength(5);
    expect(screen.getByText("26–30 of 30")).toBeInTheDocument();

    fireEvent.click(within(monthChips()).getByRole("button", { name: "Sep 2026" }));
    expect(screen.queryByText("No change requests match.")).not.toBeInTheDocument();
    expect(rows()).toHaveLength(5);
    expect(rows()[0]).toHaveTextContent("CHG20");
    expect(screen.getByText("1–5 of 5")).toBeInTheDocument();
  });

  it("says when the registry was cut short", () => {
    queryStub = { ...queryStub, data: { ...cabReportFixture(), truncated: true, registryTotal: 2500 } };
    renderAt("/operations/cab-dashboard?view=registry");
    expect(screen.getByText(/lists the newest 4 of the period's 2500 change requests/)).toBeInTheDocument();
  });

  it("lists the declared outages with their scope", () => {
    renderAt("/operations/cab-dashboard?view=downtime");
    const table = screen.getByRole("table", { name: "Outages declared" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Full outage of the login service for 30 minutes.");
    expect(rows[0]).toHaveTextContent("Awaiting the CAB");
    expect(screen.getByText(/2 of them on PROD/)).toBeInTheDocument();
  });

  it("shows the governance figures: approver workload, top requesters and CAB members", () => {
    renderAt("/operations/cab-dashboard?view=governance");
    const workload = screen.getByRole("table", { name: "CAB approver workload" });
    expect(within(workload).getAllByRole("row")[1]).toHaveTextContent("Alice Approveralice@example.com151324");
    expect(screen.getByText("Dan Developer · 12")).toBeInTheDocument();
    const members = screen.getByText("CAB members (3)").closest(".MuiCard-root") as HTMLElement;
    expect(within(members).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Alice Approver alice@example.com",
      "Bob Board bob@example.com",
      "Carol Chair carol@example.com",
    ]);
  });

  it("lists the CAB's pushback, newest first, narrowed by the month the member decided in", () => {
    renderAt("/operations/cab-dashboard?view=pushback");
    expect(screen.getByText("CAB pushback (3)")).toBeInTheDocument();
    expect(screen.getByText("Add the verification steps.")).toBeInTheDocument();
    expect(screen.getByText("Comment (approved)")).toBeInTheDocument();
    expect(screen.getByText("No comment was given.")).toBeInTheDocument();
    fireEvent.click(within(monthChips()).getByRole("button", { name: "Oct 2026" }));
    expect(screen.getByText("CAB pushback (2)")).toBeInTheDocument();
    expect(screen.queryByText("No comment was given.")).not.toBeInTheDocument();
  });

  it("shows the summary report and exports it as a PDF", async () => {
    renderAt("/operations/cab-dashboard?view=summary");
    expect(screen.getByText("CAB operations summary report")).toBeInTheDocument();
    expect(screen.getByText("Changes presented to the CAB").nextElementSibling).toHaveTextContent("33");
    const months = screen.getByRole("table", { name: "By month" });
    expect(within(months).getAllByRole("row")).toHaveLength(5);
    expect(within(months).getByText("Nov 2026 (so far)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Export as PDF" }));
    await waitFor(() => expect(downloadPdf).toHaveBeenCalledWith(queryStub.data));
    expect(showError).not.toHaveBeenCalled();
  });
});
