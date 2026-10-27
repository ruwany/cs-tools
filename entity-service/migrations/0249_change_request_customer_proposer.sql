-- Copyright (c) 2026 WSO2 LLC. (https://www.wso2.com).
--
-- WSO2 LLC. licenses this file to you under the Apache License,
-- Version 2.0 (the "License"); you may not use this file except
-- in compliance with the License.
-- You may obtain a copy of the License at
--
-- http://www.apache.org/licenses/LICENSE-2.0
--
-- Unless required by applicable law or agreed to in writing,
-- software distributed under the License is distributed on an
-- "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
-- KIND, either express or implied.  See the License for the
-- specific language governing permissions and limitations
-- under the License.

-- Who proposed the time a customer proposed for a change request (customer_updated_on,
-- migration 0043). The proposal itself writes these three columns, in the same UPDATE that
-- writes customer_updated_on (proposeCustomerTime):
--
--   customer_proposed_by_user_id  the registered contact who proposed it ("user" id)
--   customer_proposed_for         the proposed start the record is about
--   customer_proposed_on          when it was proposed
--
-- Until now the proposer was read from work_item.updated_by, the change's last writer, so any
-- staff save after a customer's proposal (a work note, a comment, the hold) made the proposal
-- read "nobody is recorded" and Accept was refused. The record survives those writes. It names a
-- proposer only while customer_proposed_for is the stored time itself: a stored time that moved
-- by any other writer is not the one recorded. A row with customer_proposed_for NULL keeps the old
-- last-writer rule: a proposal made before this migration and still waiting, or a time another
-- writer stores later on a change that has had no proposal since it entered Customer Approval; see
-- change_request_customer_proposal.go.
--
-- The trigger voids the record whenever a change request ENTERS Customer Approval: a proposal is
-- an answer to one customer request, and a time left over from an earlier round is nobody's
-- proposal in the new one. It sets customer_proposed_for to the stored time and clears who and
-- when, so when a time is stored the row is not read with the old last-writer rule (with none
-- stored, customer_proposed_for stays NULL until the next proposal). A change re-enters Customer
-- Approval when an old-flow Re-schedule still in flight finishes through the CAB, or through
-- another writer (a manual fix, an import); the trigger covers both, as 0052 does for the
-- confirmation. A plain Re-schedule starts a new round without moving the state, so the trigger
-- does not see it: that PATCH voids the record the same way in its own UPDATE
-- (patchChangeRequestTx).
--
-- Safe to run again: every statement is guarded or replaces itself
-- (TestChangeRequestProposalIntegration_ProposerMigrationIsSafeToRunAgain). One transaction, so a
-- psql -f run of this file alone cannot leave the columns without the trigger.
BEGIN;

ALTER TABLE change_request ADD COLUMN IF NOT EXISTS customer_proposed_by_user_id UUID REFERENCES "user"(id) ON DELETE SET NULL;
ALTER TABLE change_request ADD COLUMN IF NOT EXISTS customer_proposed_for TIMESTAMPTZ;
ALTER TABLE change_request ADD COLUMN IF NOT EXISTS customer_proposed_on TIMESTAMPTZ;

-- The other "user" references of change_request are indexed too; it keeps a user delete (ON
-- DELETE SET NULL) from scanning the table.
CREATE INDEX IF NOT EXISTS idx_change_request_customer_proposed_by_user_id ON change_request (customer_proposed_by_user_id);

CREATE OR REPLACE FUNCTION trg_change_request_void_customer_proposer() RETURNS trigger AS $$
BEGIN
    -- state::text: the comparison reads the same whether the column is this schema's enum or
    -- the sync tool's own shape of it.
    IF NEW.state::text = 'CUSTOMER_APPROVAL' AND OLD.state::text IS DISTINCT FROM 'CUSTOMER_APPROVAL' THEN
        NEW.customer_proposed_by_user_id := NULL;
        NEW.customer_proposed_for := NEW.customer_updated_on;
        NEW.customer_proposed_on := NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS change_request_void_customer_proposer ON change_request;
CREATE TRIGGER change_request_void_customer_proposer
    BEFORE UPDATE OF state ON change_request
    FOR EACH ROW EXECUTE FUNCTION trg_change_request_void_customer_proposer();

COMMIT;
