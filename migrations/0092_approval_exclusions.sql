-- 0092_approval_exclusions.sql
-- Decision 0513. Two AP Setup options, which the operator named
-- directly after testing Route To Approver and picking themselves as
-- the approver of an invoice they had just coded:
--
--   "Exclude Validation User from Approval of Invoices"
--   "Exclude Coding User from Approval of Invoices"
--
-- These are columns on the existing `org_approval_config` singleton,
-- the same place `route_non_po_to_requester` (migration 0078) lives,
-- rather than a new table.
--
-- **Both default to off (0).** That keeps live behaviour exactly as it
-- is on deploy. Turning either one on only narrows Route To Approver's
-- own picker, and the server check behind it.
ALTER TABLE org_approval_config ADD COLUMN exclude_validation_user_from_approval INTEGER NOT NULL DEFAULT 0
  CHECK (exclude_validation_user_from_approval IN (0, 1));

ALTER TABLE org_approval_config ADD COLUMN exclude_coding_user_from_approval INTEGER NOT NULL DEFAULT 0
  CHECK (exclude_coding_user_from_approval IN (0, 1));

-- Point-in-time: both new options read off on the singleton row.
-- ASSERT: SELECT exclude_validation_user_from_approval + exclude_coding_user_from_approval FROM org_approval_config WHERE id = 1 == 0
