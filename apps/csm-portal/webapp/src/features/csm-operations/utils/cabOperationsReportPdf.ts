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

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  PDF_ACCENT_COLOR,
  PDF_ACCENT_TINT,
  PDF_DIVIDER_COLOR,
  PDF_MARGIN_X,
  PDF_MUTED_TEXT_COLOR,
  PDF_TEXT_COLOR,
  type PdfCursor,
  safeFileNamePart,
  stampFooterPageNumbers,
  toPdfSafeText,
  writeBulletList,
  writeDetailsTable,
  writeHeading,
  writeReportHeader,
  writeWrapped,
} from "@utils/pdfReportKit";
import { CAB_DATA_NOTES, cabSummary } from "@features/csm-operations/utils/cabOperations";
import type { BeCABOperationsReport } from "@api/backend/types";

/**
 * The CAB dashboard's summary report as a PDF (the sheet's "Formal Summary
 * Report"): the period's figures, a table per month and what the data cannot
 * show. Built on `@utils/pdfReportKit` like the change request report, with
 * the same figures the Summary report tab shows (`cabSummary`), and loaded on
 * demand (`import()`) so jsPDF stays out of the main bundle.
 */
export function buildCabOperationsReportPdf(report: BeCABOperationsReport): jsPDF {
  const summary = cabSummary(report);
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const cur: PdfCursor = { doc, y: 0 };

  writeReportHeader(cur, "CAB operations summary report", summary.period);
  writeWrapped(cur, `Generated on ${summary.generatedOn}.`, { size: 9, color: PDF_MUTED_TEXT_COLOR });
  cur.y += 2;

  writeHeading(cur, "The period", 2);
  writeDetailsTable(
    cur,
    summary.totals.map((t) => ({ label: t.label, value: t.value })),
  );

  writeHeading(cur, "By month", 2);
  autoTable(doc, {
    startY: cur.y,
    theme: "grid",
    head: [summary.monthHeader.map(toPdfSafeText)],
    body: summary.monthRows.map((row) => row.map(toPdfSafeText)),
    styles: { fontSize: 8.5, cellPadding: 1.8, textColor: PDF_TEXT_COLOR, lineColor: PDF_DIVIDER_COLOR, lineWidth: 0.1 },
    headStyles: { fillColor: PDF_ACCENT_COLOR, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 },
    alternateRowStyles: { fillColor: PDF_ACCENT_TINT },
    margin: { left: PDF_MARGIN_X, right: PDF_MARGIN_X },
  });
  const lastTable = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable;
  cur.y = (lastTable?.finalY ?? cur.y) + 7;

  writeHeading(cur, "What the data cannot show", 2);
  writeBulletList(cur, [...CAB_DATA_NOTES]);

  stampFooterPageNumbers(doc);
  return doc;
}

/** Builds the summary report and downloads it as `cab-operations-<from>-to-<to>.pdf`. */
export function downloadCabOperationsReportPdf(report: BeCABOperationsReport): void {
  buildCabOperationsReportPdf(report).save(
    `cab-operations-${safeFileNamePart(report.from)}-to-${safeFileNamePart(report.to)}.pdf`,
  );
}
