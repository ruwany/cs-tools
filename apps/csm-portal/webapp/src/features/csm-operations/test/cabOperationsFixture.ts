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
 * A CAB operations report for the tests of the CAB dashboard, built in code:
 * August to November 2026, generated on 10 November (so November is the
 * ongoing month). The months add up to the totals; October against September
 * is the month-over-month comparison the tests read.
 */

import type {
  BeCABOperationsCounts,
  BeCABOperationsDay,
  BeCABOperationsMonth,
  BeCABOperationsReport,
} from "@api/backend/types";

function counts(
  total: number,
  approved: number,
  rejected: number,
  pending: number,
  cancelled: number,
  prod: number,
  outageDeclared: number,
  normal: number,
  standard: number,
  emergency: number,
): BeCABOperationsCounts {
  return {
    total,
    approved,
    rejected,
    pending,
    cancelled,
    approvalRate: approved + rejected > 0 ? approved / (approved + rejected) : null,
    prod,
    outageDeclared,
    byModel: { normal, standard, emergency, other: 0 },
  };
}

/** A month of the fixture; the ongoing one is also partial, as the period ends on its 10th. */
function month(key: string, c: BeCABOperationsCounts, ongoing = false): BeCABOperationsMonth {
  return {
    month: key,
    ...c,
    ongoing,
    partial: ongoing,
    topTeams: [
      { id: "g-apollo", name: "Apollo team", count: Math.ceil(c.total / 2) },
      { id: "g-artemis", name: "Artemis team", count: Math.floor(c.total / 2) },
    ],
  };
}

/** Every day from `from` to `to` (inclusive), zero, with `set`'s days filled in. */
function days(from: string, to: string, set: Record<string, Partial<BeCABOperationsDay>>): BeCABOperationsDay[] {
  const out: BeCABOperationsDay[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    out.push({ day, total: 0, approved: 0, rejected: 0, prod: 0, outageDeclared: 0, standard: 0, emergency: 0, ...set[day] });
  }
  return out;
}

export function cabReportFixture(): BeCABOperationsReport {
  const months = [
    month("2026-08", counts(10, 7, 2, 0, 1, 4, 2, 6, 3, 1)),
    month("2026-09", counts(8, 6, 2, 0, 0, 3, 1, 5, 2, 1)),
    month("2026-10", counts(12, 9, 1, 1, 1, 5, 3, 7, 4, 1)),
    month("2026-11", counts(3, 1, 0, 2, 0, 1, 0, 2, 1, 0), true),
  ];
  return {
    from: "2026-08-01",
    to: "2026-11-10",
    generatedOn: "2026-11-10T09:30:00Z",
    currentMonth: "2026-11",
    totals: { ...counts(33, 23, 5, 3, 2, 13, 6, 20, 10, 3), approvers: 3 },
    months,
    daily: days("2026-08-01", "2026-11-10", {
      "2026-08-04": { total: 10, approved: 7, rejected: 2, prod: 4, outageDeclared: 2, standard: 3, emergency: 1 },
      "2026-09-15": { total: 8, approved: 6, rejected: 2, prod: 3, outageDeclared: 1, standard: 2, emergency: 1 },
      "2026-10-06": { total: 5, approved: 4, rejected: 1, prod: 2, outageDeclared: 1, standard: 2 },
      "2026-10-20": { total: 7, approved: 5, prod: 3, outageDeclared: 2, standard: 2, emergency: 1 },
      "2026-11-09": { total: 3, approved: 1, prod: 1, standard: 1 },
    }),
    weeklyTeams: [
      { id: "g-apollo", name: "Apollo team" },
      { id: "g-artemis", name: "Artemis team" },
    ],
    weekly: [
      {
        weekStart: "2026-10-05",
        total: 5,
        byModel: { normal: 3, standard: 2, emergency: 0, other: 0 },
        byTeam: [
          { id: "g-apollo", name: "Apollo team", count: 3 },
          { id: "g-artemis", name: "Artemis team", count: 1 },
        ],
        otherTeams: 1,
      },
      {
        weekStart: "2026-10-19",
        total: 7,
        byModel: { normal: 4, standard: 2, emergency: 1, other: 0 },
        byTeam: [
          { id: "g-apollo", name: "Apollo team", count: 4 },
          { id: "g-artemis", name: "Artemis team", count: 3 },
        ],
        otherTeams: 0,
      },
    ],
    customers: [
      { accountId: "acc-example", name: "Example Corp", total: 20, approved: 14, rejected: 3, standard: 6, emergency: 2 },
      { accountId: "acc-other", name: "Other Corp", total: 13, approved: 9, rejected: 2, standard: 4, emergency: 1 },
    ],
    teams: [
      {
        groupId: "g-apollo",
        name: "Apollo team",
        total: 18,
        approved: 13,
        rejected: 2,
        approvalRate: 13 / 15,
        outageDeclared: 4,
        standard: 6,
        emergency: 2,
      },
      {
        groupId: "g-artemis",
        name: "Artemis team",
        total: 15,
        approved: 10,
        rejected: 3,
        approvalRate: 10 / 13,
        outageDeclared: 2,
        standard: 4,
        emergency: 1,
      },
    ],
    approvers: [
      { userId: "u-alice", name: "Alice Approver", email: "alice@example.com", decisions: 15, approved: 13, rejected: 2, comments: 4 },
      { userId: "u-bob", name: "Bob Board", email: "bob@example.com", decisions: 9, approved: 7, rejected: 2, comments: 1 },
      { userId: "u-carol", name: "Carol Chair", email: "carol@example.com", decisions: 4, approved: 3, rejected: 1, comments: 0 },
    ],
    requesters: [
      { userId: "u-dan", name: "Dan Developer", total: 12 },
      { userId: "u-erin", name: "Erin Engineer", total: 9 },
    ],
    queue: [
      {
        id: "cr-q1",
        number: "CHG0001001",
        subject: "Upgrade the gateway",
        accountName: "Example Corp",
        model: "normal",
        environment: "PRIMARY_PRODUCTION",
        plannedStart: "2026-11-14T02:00:00Z",
        outageDeclared: true,
        askedOn: "2026-10-31T08:00:00Z",
        approvers: ["Alice Approver", "Bob Board"],
      },
      {
        id: "cr-q2",
        number: "CHG0001002",
        subject: "Rotate certificates",
        accountName: "Other Corp",
        model: "standard",
        environment: "STAGING",
        plannedStart: null,
        outageDeclared: false,
        askedOn: "2026-11-09T10:00:00Z",
        approvers: [],
      },
    ],
    registry: [
      {
        id: "cr-r1",
        number: "CHG0002001",
        subject: "Patch the identity server",
        state: "AUTHORIZE",
        accountName: "Example Corp",
        model: "normal",
        environment: "PRIMARY_PRODUCTION",
        assignmentGroup: "Apollo team",
        requestedBy: "Dan Developer",
        outageDeclared: true,
        outageSummary: "Full outage of the login service for 30 minutes.",
        outcome: "PENDING",
        decidedBy: "",
        decidedOn: null,
        cabComment: "",
        askedOn: "2026-11-09T10:00:00Z",
        plannedStart: null,
      },
      {
        id: "cr-r2",
        number: "CHG0002002",
        subject: "Scale out the analytics nodes",
        state: "CANCELED",
        accountName: "Other Corp",
        model: "emergency",
        environment: "STAGING",
        assignmentGroup: "Artemis team",
        requestedBy: "Erin Engineer",
        outageDeclared: false,
        outageSummary: "",
        outcome: "REJECTED",
        decidedBy: "Bob Board",
        decidedOn: "2026-10-21T12:00:00Z",
        cabComment: "Add the rollback steps first.",
        askedOn: "2026-10-20T09:00:00Z",
        plannedStart: null,
      },
      {
        id: "cr-r3",
        number: "CHG0002003",
        subject: "Move the database to the new cluster",
        state: "CLOSED",
        accountName: "Example Corp",
        model: "standard",
        environment: "PRIMARY_PRODUCTION",
        assignmentGroup: "Apollo team",
        requestedBy: "Dan Developer",
        outageDeclared: true,
        outageSummary: "Read-only for 10 minutes.",
        outcome: "APPROVED",
        decidedBy: "Alice Approver",
        decidedOn: "2026-10-07T12:00:00Z",
        cabComment: "Add the verification steps.",
        askedOn: "2026-10-06T09:00:00Z",
        plannedStart: "2026-10-10T01:00:00Z",
      },
      {
        id: "cr-r4",
        number: "CHG0002004",
        subject: "Renew the load balancer licence",
        state: "CLOSED",
        accountName: "Other Corp",
        model: "normal",
        environment: "",
        assignmentGroup: "",
        requestedBy: "Erin Engineer",
        outageDeclared: false,
        outageSummary: "",
        outcome: "APPROVED",
        decidedBy: "Carol Chair",
        decidedOn: "2026-09-16T12:00:00Z",
        cabComment: "",
        askedOn: "2026-09-15T09:00:00Z",
        plannedStart: null,
      },
    ],
    registryTotal: 4,
    truncated: false,
    pushback: [
      {
        changeRequestId: "cr-r2",
        number: "CHG0002002",
        subject: "Scale out the analytics nodes",
        accountName: "Other Corp",
        kind: "REJECTION",
        decision: "REJECTED",
        approverName: "Bob Board",
        comment: "Add the rollback steps first.",
        decidedOn: "2026-10-21T12:00:00Z",
      },
      {
        changeRequestId: "cr-r3",
        number: "CHG0002003",
        subject: "Move the database to the new cluster",
        accountName: "Example Corp",
        kind: "COMMENT",
        decision: "APPROVED",
        approverName: "Alice Approver",
        comment: "Add the verification steps.",
        decidedOn: "2026-10-07T12:00:00Z",
      },
      {
        changeRequestId: "cr-r5",
        number: "CHG0002005",
        subject: "Turn off the old VPN",
        accountName: "Example Corp",
        kind: "REJECTION",
        decision: "REJECTED",
        approverName: "Carol Chair",
        comment: "",
        decidedOn: "2026-09-02T12:00:00Z",
      },
    ],
    pushbackTotal: 3,
    cabMembers: [
      { userId: "u-alice", name: "Alice Approver", email: "alice@example.com" },
      { userId: "u-bob", name: "Bob Board", email: "bob@example.com" },
      { userId: "u-carol", name: "Carol Chair", email: "carol@example.com" },
    ],
  };
}
