-- 0036_invoice_org.sql
-- Decision 0111 — which part of the enterprise an invoice belongs to.
--
-- Every serious accounts-payable system has this. Oracle EBS calls it
-- the **Operating Unit**, SAP a Company Code: a part of the enterprise
-- with its own suppliers, its own ledger, its own books. The operator's
-- statement of why it matters:
--
--   The Org needs to be settled upon entry into the system, because it
--   impacts everything downstream — user groups, GL structure.
--
-- An invoice processed under the wrong org is posted to the wrong books
-- and approved by the wrong people.

-- ---------------------------------------------------------------
-- What an org unit is, and what an invoice can be matched against
-- ---------------------------------------------------------------
--
-- `org_units` already has `parent_unit_id`, so a hierarchy needs no new
-- table — only a name for what each level IS.
--
-- **Two levels, not Oracle's five.** Business Group, Ledger and
-- Inventory Organization serve payroll, general ledger and stock, none
-- of which exists here. Adding four concepts nothing consumes is
-- precisely the mistake `org_units` itself has been until now: declared
-- in decision 0003 and referenced by nothing since.
ALTER TABLE org_units ADD COLUMN kind TEXT NOT NULL DEFAULT 'operating_unit'
  CHECK (kind IN ('legal_entity', 'operating_unit'));

-- The identifiers an arriving invoice can be matched against, each
-- named as the standard names it.
--
-- **BT-49 is what Peppol itself routes on** — the buyer's electronic
-- address, which is how an invoice reaches this enterprise at all. It
-- did not exist in the vocabulary until decision 0112, which is why
-- this could not be built before.
-- BT-49, the buyer electronic address.
ALTER TABLE org_units ADD COLUMN buyer_endpoint TEXT;
-- BT-48, the buyer VAT identifier.
ALTER TABLE org_units ADD COLUMN vat_id TEXT;
-- BT-10, the buyer's own routing reference.
ALTER TABLE org_units ADD COLUMN buyer_reference TEXT;

-- **Comments go on their own line, never trailing SQL.** The test
-- harness strips only lines that START with `--`, then collapses
-- whitespace to one line — so a trailing comment survives and comments
-- out every statement after it. Found here; the convention every other
-- migration already follows.

-- ---------------------------------------------------------------
-- Where an invoice gets its org
-- ---------------------------------------------------------------
--
-- Nullable, deliberately. Every invoice captured before this migration
-- has no org, and inventing one would be worse than admitting it:
-- decision 0111 makes **Validation** the point at which an org must be
-- known, not capture, precisely so a document that cannot be placed
-- becomes a task rather than a guess.
ALTER TABLE invoice_headers ADD COLUMN org_unit_id TEXT REFERENCES org_units(id);

-- How it got there, so a disagreement can be investigated rather than
-- argued about. 'rule' means a customer's own rule fired; 'source'
-- means the transport's default; 'manual' means a person decided.
ALTER TABLE invoice_headers ADD COLUMN org_assigned_by TEXT
  CHECK (org_assigned_by IN ('rule', 'source', 'manual'));

-- A source's default org — the deterministic answer for a customer who
-- runs one mailbox per part of the enterprise, and the fallback when a
-- document says nothing readable.
ALTER TABLE sources ADD COLUMN default_org_unit_id TEXT REFERENCES org_units(id);

CREATE INDEX idx_invoice_headers_org ON invoice_headers(org_unit_id);

-- Point-in-time: nothing has an org yet, and every existing org unit is
-- an operating unit by default.
-- ASSERT: SELECT count(*) FROM invoice_headers WHERE org_unit_id IS NOT NULL == 0
-- ASSERT: SELECT count(*) FROM org_units WHERE kind != 'operating_unit' == 0

-- Standing invariant: an org, if set, is a real one. The foreign key
-- enforces it; restated because this is the first thing ever to
-- reference org_units and a future rebuild must not quietly drop it.
-- ASSERT ALWAYS: SELECT count(*) FROM invoice_headers WHERE org_unit_id IS NOT NULL AND org_unit_id NOT IN (SELECT id FROM org_units) == 0

-- Standing invariant: an org and a record of how it was assigned travel
-- together. **One without the other is worse than neither** — an org
-- nobody can explain, or a provenance pointing at nothing.
-- ASSERT ALWAYS: SELECT count(*) FROM invoice_headers WHERE (org_unit_id IS NULL) != (org_assigned_by IS NULL) == 0

-- Standing invariant: an invoice is only ever assigned to an operating
-- unit, never to a legal entity above it. A legal entity is a tax and
-- reporting boundary; the operating unit is where payables happen, and
-- posting to the wrong level is the thing this whole record exists to
-- prevent.
-- ASSERT ALWAYS: SELECT count(*) FROM invoice_headers h JOIN org_units u ON u.id = h.org_unit_id WHERE u.kind != 'operating_unit' == 0

-- Standing invariant: an operating unit's parent, where it has one, is
-- a legal entity. A hierarchy that can nest arbitrarily is a hierarchy
-- nobody can reason about.
-- ASSERT ALWAYS: SELECT count(*) FROM org_units c JOIN org_units p ON p.id = c.parent_unit_id WHERE c.kind = 'operating_unit' AND p.kind != 'legal_entity' == 0
