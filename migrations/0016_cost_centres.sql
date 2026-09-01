-- 0016_cost_centres.sql
-- A real, customer-managed cost centre list — see docs/decisions/
-- 0031-cost-centre-vs-org-units.md. Decision 0015 flagged the
-- "cost centre vs org_units" question across eight separate
-- decisions without ever resolving it; this is that resolution.
--
-- Deliberately global, not scoped per-process the way intake_channels
-- (decision 0024) is — a cost centre is a company-wide financial
-- construct, defined once by finance/accounting and used consistently
-- across every process (AP, AR, Expense), unlike an intake channel,
-- which is inherently tied to how something enters one specific
-- process. Matches how org_units itself is never process-scoped.
--
-- Deliberately kept a genuinely separate concept from org_units, not
-- merged and not foreign-keyed to it: a cost centre answers "where
-- does this cost get booked in the ledger," a financial/accounting
-- question; an org_unit answers "who has authority here," an
-- organizational one. The two often correlate in simple
-- organizations but are not guaranteed to — a single org_unit can
-- span multiple cost centres, and a single cost centre can be shared
-- across several org_units.
--
-- Real management (CRUD), deliberately not wired into rule
-- validation or evaluation anywhere — the same declined
-- closed-value-enforcement scope decisions 0023/0024 already
-- established for intake channels. A rule can still reference any
-- string as a BT-133 value regardless of what's in this table.
CREATE TABLE cost_centres (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (name)
);

-- Point-in-time: empty at the moment this migration finishes.
-- ASSERT: SELECT count(*) FROM cost_centres == 0
