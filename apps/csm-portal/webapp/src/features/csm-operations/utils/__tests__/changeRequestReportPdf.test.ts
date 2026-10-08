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
import type { BeChangeRequestDetail } from "@api/backend/types";

// The PDF itself is jsPDF's business; what is checked here is the details table the report hands to the shared
// writer, so jsPDF and the writer's page plumbing are replaced by recorders.
const writeDetailsTable = vi.fn();
vi.mock("jspdf", () => ({
  jsPDF: class {
    save(): void {}
  },
}));
vi.mock("@utils/pdfReportKit", () => ({
  condenseBlankLines: (t: string) => t,
  htmlToPdfPlainText: (t: string) => t,
  safeFileNamePart: (t: string) => t,
  stampFooterPageNumbers: () => undefined,
  writeActivityList: () => undefined,
  writeDetailsTable: (...args: unknown[]) => writeDetailsTable(...args),
  writeHeading: () => undefined,
  writeReportHeader: () => undefined,
  writeWrapped: () => undefined,
}));

import { generateChangeRequestReportPdf } from "@features/csm-operations/utils/changeRequestReportPdf";

const CR: BeChangeRequestDetail = {
  id: "chg-1",
  number: "CHG0001234",
  subject: "Upgrade the gateway cluster",
  createdOn: "2026-01-01T00:00:00Z",
  state: "scheduled",
  type: "normal",
};

function customerApprovedRow(
  overrides: Partial<BeChangeRequestDetail>,
  approvals?: ReadonlyArray<{ stage: string }>,
): string | undefined {
  writeDetailsTable.mockClear();
  generateChangeRequestReportPdf({ ...CR, ...overrides }, [], approvals);
  const rows = writeDetailsTable.mock.calls[0]?.[1] as Array<{ label: string; value: string }> | undefined;
  return rows?.find((r) => r.label === "Customer approved")?.value;
}

describe("generateChangeRequestReportPdf — the Customer approved row", () => {
  beforeEach(() => writeDetailsTable.mockClear());

  it("reads Yes when the customer's own approval was recorded, No when it was not", () => {
    expect(customerApprovedRow({ hasCustomerApproved: true })).toBe("Yes");
    expect(customerApprovedRow({ hasCustomerApproved: false })).toBe("No");
  });

  it("reads 'Proposed time accepted' for a change WSO2 scheduled by accepting the customer's proposal (nothing is stamped as their approval)", () => {
    expect(
      customerApprovedRow({ hasCustomerApproved: false, customerProposal: { startOn: "2030-03-08T09:00:00Z", answer: "agreed" } }),
    ).toBe("Proposed time accepted");
    // The raw column of the previous system says the same where the derived read model is absent.
    expect(customerApprovedRow({ hasCustomerApproved: false, confirmCustomerUpdatedDate: "agree" })).toBe("Proposed time accepted");
  });

  // The Agree stays on the row when the customers are asked again: in Customer Approval nothing was scheduled by it, so the row must
  // not say the proposed time was accepted (Approve and Reject are live for the customer).
  it("reads No, not 'Proposed time accepted', for an Agree standing on a change that is (back) in Customer Approval, or before it", () => {
    for (const state of ["customer_approval", "authorize", "assess", "new"] as const) {
      expect(
        customerApprovedRow({ state, hasCustomerApproved: false, customerProposal: { startOn: "2030-03-08T09:00:00Z", answer: "agreed" } }),
        state,
      ).toBe("No");
      expect(customerApprovedRow({ state, hasCustomerApproved: false, confirmCustomerUpdatedDate: "agree" }), state).toBe("No");
    }
    // Once the change has moved on, the same Agree reads as accepted.
    for (const state of ["scheduled", "implement", "closed"] as const) {
      expect(
        customerApprovedRow({ state, hasCustomerApproved: false, customerProposal: { startOn: "2030-03-08T09:00:00Z", answer: "agreed" } }),
        state,
      ).toBe("Proposed time accepted");
    }
  });

  it("still reads No for a proposal nobody accepted", () => {
    expect(
      customerApprovedRow({ hasCustomerApproved: false, customerProposal: { startOn: "2030-03-08T09:00:00Z", answer: "disagreed" } }),
    ).toBe("No");
  });

  it("leaves the row out when the backend sent no flag at all", () => {
    expect(customerApprovedRow({})).toBeUndefined();
    expect(customerApprovedRow({ type: "emergency", state: "closed" }, [])).toBeUndefined();
  });
});

// An Emergency change acts without customer consent: the detail page reads "Not applicable" for its customer approval, so the
// exported report must not say "No" (which reads as a customer who did not approve). Same rule: only the state and the stage
// rows of that gate show the change went through it.
describe("generateChangeRequestReportPdf — the Customer approved row of an Emergency change", () => {
  const emergency: Partial<BeChangeRequestDetail> = { type: "emergency", state: "closed" };
  const cabOnly = [{ stage: "CAB Approval" }];

  it("reads Not applicable instead of No, as the detail page does", () => {
    expect(customerApprovedRow({ ...emergency, hasCustomerApproved: false }, cabOnly)).toBe("Not applicable");
    expect(customerApprovedRow({ ...emergency, hasCustomerApproved: false }, [])).toBe("Not applicable");
  });

  it("reads Not applicable, not Yes, when only a stored flag says the customer approved (a flag need not be the customer's answer)", () => {
    expect(customerApprovedRow({ ...emergency, hasCustomerApproved: true }, cabOnly)).toBe("Not applicable");
    expect(customerApprovedRow({ ...emergency, hasCustomerApproved: true }, [])).toBe("Not applicable");
  });

  it("reads as stored when a stage row of the gate exists (a change raised before the rule), or when the change sits in it", () => {
    const withGate = [{ stage: "ECAB Approval" }, { stage: "Customer Approval" }];
    expect(customerApprovedRow({ ...emergency, hasCustomerApproved: true }, withGate)).toBe("Yes");
    expect(customerApprovedRow({ ...emergency, hasCustomerApproved: false }, withGate)).toBe("No");
    expect(customerApprovedRow({ type: "emergency", state: "customer_approval", hasCustomerApproved: false }, cabOnly)).toBe("No");
  });

  it("says nothing when the stage rows are not loaded and only they could show the gate was passed", () => {
    expect(customerApprovedRow({ ...emergency, hasCustomerApproved: false }, undefined)).toBeUndefined();
    expect(customerApprovedRow({ ...emergency, hasCustomerApproved: true }, undefined)).toBeUndefined();
    // The state alone settles a change that sits in the gate.
    expect(customerApprovedRow({ type: "emergency", state: "customer_approval", hasCustomerApproved: false }, undefined)).toBe("No");
  });

  it("leaves a Normal change as it was, with or without the stage rows", () => {
    for (const approvals of [undefined, [], [{ stage: "CAB Approval" }]]) {
      expect(customerApprovedRow({ type: "normal", state: "closed", hasCustomerApproved: false }, approvals)).toBe("No");
      expect(customerApprovedRow({ type: "normal", state: "closed", hasCustomerApproved: true }, approvals)).toBe("Yes");
    }
  });
});
