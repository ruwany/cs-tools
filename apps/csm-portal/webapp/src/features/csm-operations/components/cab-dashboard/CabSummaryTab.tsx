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
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@wso2/oxygen-ui";
import type { JSX } from "react";
import type { BeCABOperationsReport } from "@api/backend/types";
import ExportPdfButton from "@components/ExportPdfButton";
import { useErrorBanner } from "@context/error-banner/ErrorBannerContext";
import { CabCard } from "@features/csm-operations/components/cab-dashboard/CabCard";
import { CAB_TABLE_SX, CAB_TABLE_WRAPPER_SX } from "@features/csm-operations/components/cab-dashboard/cabTableStyles";
import { CAB_DATA_NOTES, cabSummary } from "@features/csm-operations/utils/cabOperations";

/**
 * The summary report (the sheet's "Formal Summary Report"): the period's
 * figures, a row per month and what the data cannot show, with "Export as
 * PDF" for a copy to share or keep (`cabOperationsReportPdf.ts`, the app's
 * PDF report kit, loaded on demand). The whole period: the month filter does
 * not narrow it.
 */
export default function CabSummaryTab({ report }: { report: BeCABOperationsReport }): JSX.Element {
  const { showError } = useErrorBanner();
  const summary = cabSummary(report);

  const handleExport = async (): Promise<void> => {
    try {
      const { downloadCabOperationsReportPdf } = await import("@features/csm-operations/utils/cabOperationsReportPdf");
      downloadCabOperationsReportPdf(report);
    } catch (err) {
      showError("Could not export the summary report as a PDF. Please try again.", err);
    }
  };

  return (
    <CabCard
      title="CAB operations summary report"
      caption={`${summary.period}. Generated on ${summary.generatedOn}.`}
      action={<ExportPdfButton onExport={handleExport} />}
    >
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <Box component="dl" sx={{ m: 0, display: "grid", gridTemplateColumns: { xs: "1fr auto", sm: "minmax(220px, max-content) auto" }, rowGap: 0.75, columnGap: 4 }}>
          {summary.totals.map((t) => (
            <Box key={t.label} sx={{ display: "contents" }}>
              <Typography component="dt" variant="body2" color="text.secondary">
                {t.label}
              </Typography>
              <Typography component="dd" variant="body2" sx={{ m: 0, fontWeight: 500 }}>
                {t.value}
              </Typography>
            </Box>
          ))}
        </Box>

        <Box>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>
            By month
          </Typography>
          <Box sx={CAB_TABLE_WRAPPER_SX}>
            <TableContainer>
              <Table size="small" sx={CAB_TABLE_SX} aria-label="By month">
                <TableHead>
                  <TableRow sx={{ bgcolor: "action.hover" }}>
                    {summary.monthHeader.map((h, i) => (
                      <TableCell key={h} align={i === 0 ? "left" : "right"}>
                        {h}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {summary.monthRows.map((row) => (
                    <TableRow key={row[0]}>
                      {row.map((cell, i) => (
                        <TableCell key={summary.monthHeader[i]} align={i === 0 ? "left" : "right"} sx={{ whiteSpace: "nowrap" }}>
                          {cell}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        </Box>

        <Box>
          <Typography variant="subtitle1" sx={{ mb: 0.5 }}>
            What the data cannot show
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 3 }}>
            {CAB_DATA_NOTES.map((note) => (
              <Typography component="li" variant="body2" color="text.secondary" key={note}>
                {note}
              </Typography>
            ))}
          </Box>
        </Box>
      </Box>
    </CabCard>
  );
}
