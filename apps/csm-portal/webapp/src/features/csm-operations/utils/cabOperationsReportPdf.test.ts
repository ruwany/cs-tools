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

import { beforeEach, describe, expect, it, vi } from "vitest";

// The tables are jspdf-autotable's business: what is checked is what this
// module hands it, and the text it draws itself, through recorders.
const { texts, saved, autoTable } = vi.hoisted(() => ({
  texts: [] as string[],
  saved: [] as string[],
  autoTable: vi.fn(),
}));
vi.mock("jspdf", () => ({
  jsPDF: class {
    internal = { getNumberOfPages: () => 1 };
    lastAutoTable = { finalY: 120 };
    setFillColor(): void {}
    rect(): void {}
    setTextColor(): void {}
    setFont(): void {}
    setFontSize(): void {}
    setDrawColor(): void {}
    setLineWidth(): void {}
    line(): void {}
    addPage(): void {}
    setPage(): void {}
    splitTextToSize(text: string): string[] {
      return [text];
    }
    text(value: string | string[]): void {
      texts.push(...(Array.isArray(value) ? value : [value]));
    }
    save(name: string): void {
      saved.push(name);
    }
  },
}));
vi.mock("jspdf-autotable", () => ({ default: autoTable }));

import { downloadCabOperationsReportPdf } from "@features/csm-operations/utils/cabOperationsReportPdf";
import { cabReportFixture } from "@features/csm-operations/test/cabOperationsFixture";

beforeEach(() => {
  texts.length = 0;
  saved.length = 0;
  autoTable.mockReset();
});

describe("downloadCabOperationsReportPdf", () => {
  it("draws the period, its figures, a row per month and the notes, and saves it under the period's dates", () => {
    downloadCabOperationsReportPdf(cabReportFixture());

    expect(texts).toContain("CAB operations summary report");
    expect(texts).toContain("Aug 1, 2026 to Nov 10, 2026");
    expect(texts).toContain("By month");
    expect(texts).toContain("What the data cannot show");
    expect(texts.some((t) => t.includes("Teams stand in for streams"))).toBe(true);

    // The period's figures (writeDetailsTable), then the month table.
    const [figures, months] = autoTable.mock.calls.map(([, options]) => options as { head: string[][]; body: string[][] });
    expect(figures.body).toContainEqual(["Changes presented to the CAB", "33"]);
    expect(months.head[0][0]).toBe("Month");
    expect(months.body).toHaveLength(4);
    expect(months.body[3][0]).toBe("Nov 2026 (so far)");

    expect(saved).toEqual(["cab-operations-2026-08-01-to-2026-11-10.pdf"]);
  });
});
