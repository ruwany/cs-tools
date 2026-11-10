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
  Chip,
  FormControl,
  Grid,
  InputAdornment,
  InputLabel,
  Link,
  MenuItem,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from "@wso2/oxygen-ui";
import { Search } from "@wso2/oxygen-ui-icons-react";
import { useState, type JSX } from "react";
import { Link as RouterLink, useLocation } from "react-router";
import type {
  BeCABOperationsModel,
  BeCABOperationsOutcome,
  BeCABOperationsRegistryItem,
  BeCABOperationsReport,
} from "@api/backend/types";
import { CabCard } from "@features/csm-operations/components/cab-dashboard/CabCard";
import { CAB_TABLE_SX, CAB_TABLE_WRAPPER_SX } from "@features/csm-operations/components/cab-dashboard/cabTableStyles";
import {
  CAB_MODEL_LABELS,
  CAB_OUTCOME_COLORS,
  CAB_OUTCOME_LABELS,
  type CabMonthSelection,
  type CabRegistryFilters,
  EMPTY_REGISTRY_FILTERS,
  cabOutages,
  cabPushbackOf,
  dayMediumLabel,
  environmentLabel,
  filterCabRegistry,
  monthLongLabel,
  registryOptions,
} from "@features/csm-operations/utils/cabOperations";

/**
 * A change request's number, linking to its page (where the CAB decides; this
 * dashboard has no approve buttons). Passes this page's place as `from`, and
 * its own state as `parentState`, so the change request's Back returns here
 * (webapp CLAUDE.md, "Page conventions: Back navigation").
 */
function CabChangeRequestLink({ id, number }: { id: string; number: string }): JSX.Element {
  const location = useLocation();
  return (
    <Link
      component={RouterLink}
      to={`/operations/change-requests/${encodeURIComponent(id)}`}
      state={{ from: `${location.pathname}${location.search}`, parentState: location.state ?? null }}
      underline="hover"
      sx={{ fontWeight: 500, whiteSpace: "nowrap" }}
    >
      {number || "Change request"}
    </Link>
  );
}

/** A subject cell: one line, capped (webapp CLAUDE.md "Table conventions"), the whole subject on hover. */
function SubjectCell({ subject }: { subject: string }): JSX.Element {
  return (
    <TableCell sx={{ maxWidth: 360 }}>
      <Typography variant="body2" noWrap title={subject}>
        {subject || "—"}
      </Typography>
    </TableCell>
  );
}

function OutcomeChip({ outcome }: { outcome: BeCABOperationsOutcome }): JSX.Element {
  return <Chip size="small" variant="outlined" color={CAB_OUTCOME_COLORS[outcome]} label={CAB_OUTCOME_LABELS[outcome]} />;
}

/** Whole days from `from` to `to` (RFC 3339), at least 0. */
function daysBetween(from: string, to: string): number {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Number.isNaN(ms) ? 0 : Math.max(0, Math.floor(ms / 86_400_000));
}

function EmptyLine({ children }: { children: string }): JSX.Element {
  return (
    <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
      {children}
    </Typography>
  );
}

// --- Review queue -----------------------------------------------------------------

/** The change requests waiting for the CAB now, oldest asked first. Not narrowed by the period or the month filter. */
export function CabQueueTab({ report }: { report: BeCABOperationsReport }): JSX.Element {
  const queue = report.queue;
  return (
    <CabCard
      title={`Awaiting the CAB (${queue.length})`}
      caption="Change requests whose CAB approval is open now, whenever the CAB was asked, oldest first. Open one to approve or reject it. The dates and the month filter do not apply here."
    >
      {queue.length === 0 ? (
        <EmptyLine>Nothing is waiting for the CAB.</EmptyLine>
      ) : (
        <Box sx={CAB_TABLE_WRAPPER_SX}>
          <TableContainer>
            <Table size="small" sx={CAB_TABLE_SX} aria-label="Awaiting the CAB">
              <TableHead>
                <TableRow sx={{ bgcolor: "action.hover" }}>
                  <TableCell>Change request</TableCell>
                  <TableCell>Subject</TableCell>
                  <TableCell>Customer</TableCell>
                  <TableCell>Model</TableCell>
                  <TableCell>Environment</TableCell>
                  <TableCell>Planned start</TableCell>
                  <TableCell>Outage</TableCell>
                  <TableCell>Asked on</TableCell>
                  <TableCell>Waiting for</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {queue.map((q) => {
                  const waited = daysBetween(q.askedOn, report.generatedOn);
                  return (
                    <TableRow key={q.id}>
                      <TableCell>
                        <CabChangeRequestLink id={q.id} number={q.number} />
                      </TableCell>
                      <SubjectCell subject={q.subject} />
                      <TableCell sx={{ maxWidth: 200 }}>
                        <Typography variant="body2" noWrap title={q.accountName}>
                          {q.accountName || "—"}
                        </Typography>
                      </TableCell>
                      <TableCell>{CAB_MODEL_LABELS[q.model]}</TableCell>
                      <TableCell>{environmentLabel(q.environment)}</TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>{dayMediumLabel(q.plannedStart)}</TableCell>
                      <TableCell>{q.outageDeclared ? <Chip size="small" variant="outlined" color="error" label="Declared" /> : "—"}</TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>
                        {dayMediumLabel(q.askedOn)}
                        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                          {waited === 0 ? "today" : `${waited} day${waited === 1 ? "" : "s"} ago`}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ maxWidth: 240 }}>
                        <Typography variant="body2" title={q.approvers.join(", ")} noWrap>
                          {q.approvers.length > 0 ? q.approvers.join(", ") : "Nobody is asked"}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}
    </CabCard>
  );
}

// --- Registry ----------------------------------------------------------------------

const ROWS_PER_PAGE_OPTIONS = [25, 50, 100];

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (next: string) => void;
}): JSX.Element {
  const id = `cab-registry-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <FormControl size="small" fullWidth>
      <InputLabel id={`${id}-label`}>{label}</InputLabel>
      <Select
        labelId={`${id}-label`}
        id={id}
        label={label}
        value={value}
        onChange={(e) => onChange(String(e.target.value))}
      >
        <MenuItem value="">Any</MenuItem>
        {options.map((o) => (
          <MenuItem key={o.value} value={o.value}>
            {o.label}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

/** Every change request of the period (month filter applied), searchable and filterable. */
export function CabRegistryTab({
  report,
  selection,
}: {
  report: BeCABOperationsReport;
  selection: CabMonthSelection;
}): JSX.Element {
  const [filters, setFilters] = useState<CabRegistryFilters>(EMPTY_REGISTRY_FILTERS);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(ROWS_PER_PAGE_OPTIONS[0]);
  const rows = filterCabRegistry(report.registry, selection, filters);
  // The month chips and a new period change the rows without going through
  // update(), so the page is clamped here, once, for both the slice and the
  // pagination (a page past the end would show no rows beside "26-30 of 30").
  const safePage = Math.min(page, Math.max(0, Math.ceil(rows.length / rowsPerPage) - 1));
  const pageRows = rows.slice(safePage * rowsPerPage, safePage * rowsPerPage + rowsPerPage);
  const environments = registryOptions(report.registry, "environment");
  const customers = registryOptions(report.registry, "accountName");
  const hasNoEnvironment = report.registry.some((r) => r.environment === "");
  const update = (patch: Partial<CabRegistryFilters>): void => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(0);
  };

  return (
    <CabCard
      title="Registry"
      caption={`Every change request presented to the CAB${selection === "all" ? " in the period" : ` in ${monthLongLabel(selection)}`}, newest first.`}
    >
      {report.truncated && (
        <Alert severity="info" sx={{ mb: 2 }}>
          The registry lists the newest {report.registry.length} of the period&apos;s {report.registryTotal} change requests. Narrow
          the dates to see the rest.
        </Alert>
      )}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 12, md: 4 }}>
          <TextField
            size="small"
            fullWidth
            label="Search"
            placeholder="Number, subject, customer, team or requester"
            value={filters.search}
            onChange={(e) => update({ search: e.target.value })}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <Search size={16} />
                  </InputAdornment>
                ),
              },
            }}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 2 }}>
          <FilterSelect
            label="Outcome"
            value={filters.outcome}
            onChange={(v) => update({ outcome: v as BeCABOperationsOutcome | "" })}
            options={(Object.keys(CAB_OUTCOME_LABELS) as BeCABOperationsOutcome[]).map((o) => ({ value: o, label: CAB_OUTCOME_LABELS[o] }))}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 2 }}>
          <FilterSelect
            label="Model"
            value={filters.model}
            onChange={(v) => update({ model: v as BeCABOperationsModel | "" })}
            options={(Object.keys(CAB_MODEL_LABELS) as BeCABOperationsModel[]).map((m) => ({ value: m, label: CAB_MODEL_LABELS[m] }))}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 2 }}>
          <FilterSelect
            label="Environment"
            value={filters.environment}
            onChange={(v) => update({ environment: v })}
            options={[
              ...environments.map((e) => ({ value: e, label: environmentLabel(e) })),
              ...(hasNoEnvironment ? [{ value: "none", label: "No deployment" }] : []),
            ]}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 2 }}>
          <FilterSelect
            label="Customer"
            value={filters.customer}
            onChange={(v) => update({ customer: v })}
            options={customers.map((c) => ({ value: c, label: c }))}
          />
        </Grid>
      </Grid>

      <Box sx={CAB_TABLE_WRAPPER_SX}>
        <TableContainer>
          <Table size="small" sx={CAB_TABLE_SX} aria-label="Registry">
            <TableHead>
              <TableRow sx={{ bgcolor: "action.hover" }}>
                <TableCell>Change request</TableCell>
                <TableCell>Subject</TableCell>
                <TableCell>Customer</TableCell>
                <TableCell>Model</TableCell>
                <TableCell>Environment</TableCell>
                <TableCell>Team</TableCell>
                <TableCell>Requested by</TableCell>
                <TableCell>Outage</TableCell>
                <TableCell>Outcome</TableCell>
                <TableCell>Decided</TableCell>
                <TableCell>CAB comment</TableCell>
                <TableCell>Asked on</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pageRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} align="center">
                    <EmptyLine>No change requests match.</EmptyLine>
                  </TableCell>
                </TableRow>
              ) : (
                pageRows.map((r) => <RegistryRow key={r.id} row={r} />)
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={rows.length}
          page={safePage}
          onPageChange={(_, next) => setPage(next)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(Number(e.target.value));
            setPage(0);
          }}
          rowsPerPageOptions={ROWS_PER_PAGE_OPTIONS}
          showFirstButton
          showLastButton
        />
      </Box>
    </CabCard>
  );
}

function RegistryRow({ row }: { row: BeCABOperationsRegistryItem }): JSX.Element {
  return (
    <TableRow>
      <TableCell>
        <CabChangeRequestLink id={row.id} number={row.number} />
      </TableCell>
      <SubjectCell subject={row.subject} />
      <TableCell sx={{ maxWidth: 200 }}>
        <Typography variant="body2" noWrap title={row.accountName}>
          {row.accountName || "—"}
        </Typography>
      </TableCell>
      <TableCell>{CAB_MODEL_LABELS[row.model]}</TableCell>
      <TableCell>{environmentLabel(row.environment)}</TableCell>
      <TableCell sx={{ maxWidth: 200 }}>
        <Typography variant="body2" noWrap title={row.assignmentGroup}>
          {row.assignmentGroup || "—"}
        </Typography>
      </TableCell>
      <TableCell sx={{ maxWidth: 180 }}>
        <Typography variant="body2" noWrap title={row.requestedBy}>
          {row.requestedBy || "—"}
        </Typography>
      </TableCell>
      <TableCell>{row.outageDeclared ? <Chip size="small" variant="outlined" color="error" label="Declared" /> : "—"}</TableCell>
      <TableCell>
        <OutcomeChip outcome={row.outcome} />
      </TableCell>
      <TableCell sx={{ whiteSpace: "nowrap" }}>
        {row.decidedOn ? dayMediumLabel(row.decidedOn) : "—"}
        {row.decidedBy && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            {row.decidedBy}
          </Typography>
        )}
      </TableCell>
      <TableCell sx={{ maxWidth: 280 }}>
        <Typography variant="body2" noWrap title={row.cabComment}>
          {row.cabComment || "—"}
        </Typography>
      </TableCell>
      <TableCell sx={{ whiteSpace: "nowrap" }}>{dayMediumLabel(row.askedOn)}</TableCell>
    </TableRow>
  );
}

// --- Downtime & risk ----------------------------------------------------------------

/** The change requests with an outage declared (month filter applied). */
export function CabDowntimeTab({
  report,
  selection,
}: {
  report: BeCABOperationsReport;
  selection: CabMonthSelection;
}): JSX.Element {
  const rows = cabOutages(report.registry, selection);
  const prodRows = rows.filter((r) => r.environment === "PRIMARY_PRODUCTION").length;
  return (
    <CabCard
      title={`Outages declared (${rows.length})`}
      caption={`Change requests that declare a service outage, ${prodRows} of them on PROD. Full or partial is not recorded: the scope is the start of what the change request says.`}
    >
      {report.truncated && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Drawn from the newest {report.registry.length} of the period&apos;s {report.registryTotal} change requests. Narrow the dates
          to see the rest.
        </Alert>
      )}
      {rows.length === 0 ? (
        <EmptyLine>No change request declares an outage.</EmptyLine>
      ) : (
        <Box sx={CAB_TABLE_WRAPPER_SX}>
          <TableContainer>
            <Table size="small" sx={CAB_TABLE_SX} aria-label="Outages declared">
              <TableHead>
                <TableRow sx={{ bgcolor: "action.hover" }}>
                  <TableCell>Asked on</TableCell>
                  <TableCell>Change request</TableCell>
                  <TableCell>Customer</TableCell>
                  <TableCell>Environment</TableCell>
                  <TableCell>Scope</TableCell>
                  <TableCell>Team</TableCell>
                  <TableCell>Outcome</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>{dayMediumLabel(r.askedOn)}</TableCell>
                    <TableCell>
                      <CabChangeRequestLink id={r.id} number={r.number} />
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block", maxWidth: 280 }} noWrap title={r.subject}>
                        {r.subject}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 200 }}>
                      <Typography variant="body2" noWrap title={r.accountName}>
                        {r.accountName || "—"}
                      </Typography>
                    </TableCell>
                    <TableCell>{environmentLabel(r.environment)}</TableCell>
                    <TableCell sx={{ maxWidth: 360 }}>
                      <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                        {r.outageSummary || "—"}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 200 }}>
                      <Typography variant="body2" noWrap title={r.assignmentGroup}>
                        {r.assignmentGroup || "—"}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <OutcomeChip outcome={r.outcome} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}
    </CabCard>
  );
}

// --- Governance ------------------------------------------------------------------

/** Who decides: the CAB members' workload, the top requesters, and the CAB group's members. Whole period. */
export function CabGovernanceTab({ report }: { report: BeCABOperationsReport }): JSX.Element {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Typography variant="body2" color="text.secondary">
        The whole period. Change the dates to narrow it.
      </Typography>
      <CabCard
        title="CAB approver workload"
        caption="Each CAB member's decisions on the period's change requests (every CAB approval stage, not only the latest)."
      >
        {report.approvers.length === 0 ? (
          <EmptyLine>No CAB member has decided in this period.</EmptyLine>
        ) : (
          <Box sx={CAB_TABLE_WRAPPER_SX}>
            <TableContainer>
              <Table size="small" sx={CAB_TABLE_SX} aria-label="CAB approver workload">
                <TableHead>
                  <TableRow sx={{ bgcolor: "action.hover" }}>
                    <TableCell>CAB member</TableCell>
                    <TableCell align="right">Decisions</TableCell>
                    <TableCell align="right">Approved</TableCell>
                    <TableCell align="right">Rejected</TableCell>
                    <TableCell align="right">Comments</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {report.approvers.map((a) => (
                    <TableRow key={a.userId ?? a.email ?? a.name}>
                      <TableCell sx={{ maxWidth: 320 }}>
                        <Typography variant="body2" noWrap title={a.name}>
                          {a.name}
                        </Typography>
                        {a.email && (
                          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                            {a.email}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell align="right">{a.decisions}</TableCell>
                      <TableCell align="right">{a.approved}</TableCell>
                      <TableCell align="right">{a.rejected}</TableCell>
                      <TableCell align="right">{a.comments}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}
      </CabCard>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 6 }}>
          <CabCard title="Top requesters" caption="Who raised the most change requests the CAB was asked about.">
            {report.requesters.length === 0 ? (
              <EmptyLine>No requester is recorded in this period.</EmptyLine>
            ) : (
              <Box component="ol" sx={{ m: 0, pl: 3 }}>
                {report.requesters.map((r) => (
                  <Typography component="li" variant="body2" key={r.userId} sx={{ py: 0.25 }}>
                    {r.name} · {r.total}
                  </Typography>
                ))}
              </Box>
            )}
          </CabCard>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <CabCard
            title={`CAB members (${report.cabMembers.length})`}
            caption="The active members of the CAB Approval group, who can approve or reject a CAB approval stage."
          >
            {report.cabMembers.length === 0 ? (
              <EmptyLine>The CAB Approval group has no active members.</EmptyLine>
            ) : (
              <Box component="ul" sx={{ m: 0, pl: 3 }}>
                {report.cabMembers.map((m) => (
                  <Typography component="li" variant="body2" key={m.userId} sx={{ py: 0.25 }}>
                    {m.name}{" "}
                    <Typography component="span" variant="body2" color="text.secondary">
                      {m.email}
                    </Typography>
                  </Typography>
                ))}
              </Box>
            )}
          </CabCard>
        </Grid>
      </Grid>
    </Box>
  );
}

// --- Pushback -----------------------------------------------------------------------

/** The CAB's rejections and comments, newest first (month filter applied, by when the member decided). */
export function CabPushbackTab({
  report,
  selection,
}: {
  report: BeCABOperationsReport;
  selection: CabMonthSelection;
}): JSX.Element {
  const items = cabPushbackOf(report.pushback, selection);
  const rejections = items.filter((p) => p.kind === "REJECTION").length;
  return (
    <CabCard
      title={`CAB pushback (${items.length})`}
      caption={`${rejections} rejection${rejections === 1 ? "" : "s"} and ${items.length - rejections} comment${items.length - rejections === 1 ? "" : "s"} on other decisions, newest first. A comment on an approval counts too.`}
    >
      {report.pushbackTotal > report.pushback.length && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Showing the newest {report.pushback.length} of {report.pushbackTotal}. Narrow the dates to see the rest.
        </Alert>
      )}
      {items.length === 0 ? (
        <EmptyLine>No CAB rejections or comments.</EmptyLine>
      ) : (
        <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, display: "flex", flexDirection: "column", gap: 1.5 }}>
          {items.map((p, i) => (
            <Box
              component="li"
              key={`${p.changeRequestId}-${p.decidedOn}-${i}`}
              sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}
            >
              <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1 }}>
                <Chip
                  size="small"
                  variant="outlined"
                  color={p.kind === "REJECTION" ? "error" : "warning"}
                  label={p.kind === "REJECTION" ? "Rejected" : `Comment (${p.decision.toLowerCase()})`}
                />
                <CabChangeRequestLink id={p.changeRequestId} number={p.number} />
                <Typography variant="body2" noWrap title={p.subject} sx={{ minWidth: 0, flex: "1 1 200px" }}>
                  {p.subject}
                </Typography>
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                {p.approverName || "A CAB member"} · {dayMediumLabel(p.decidedOn)}
                {p.accountName ? ` · ${p.accountName}` : ""}
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.75, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {p.comment || "No comment was given."}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </CabCard>
  );
}
