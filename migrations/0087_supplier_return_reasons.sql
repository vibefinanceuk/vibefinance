-- 0087_supplier_return_reasons.sql
-- Decision 0498 — Return To Supplier's own audited reason list.
--
-- Reported live, point 1 of five: *"Need a set of return reasons, so
-- that they can be audited, and available via drop-down in the
-- button."* Today `handleReturnToSupplier` accepts any free-text
-- `reason` string, typed into a bare native `window.prompt()` — no
-- categorisation, nothing a report can group by.
--
-- **A flat, dedicated list — not the Account Coding framework
-- (migration 0076).** That framework exists for hierarchical,
-- cross-filtered financial coding (GL code scoped by Company code,
-- and so on); a return reason is a single flat vocabulary with no
-- parent, no filter, no approver. Reusing it here would drag in a
-- `coding_list_types` CHECK, a filters table, and a shape none of
-- this needs — the same "one generic framework, not five bespoke
-- tables" judgement 0444 made, applied in the other direction: this
-- doesn't share the other five's shape either.
--
-- **Scoped to Return To Supplier only, not Discard.** Discard's own
-- reason (decision 0078) is still a bare `window.prompt()`, and stays
-- one for now — the operator was asked directly and chose to keep
-- this pass scoped to the button that was actually reported on.
--
-- **Deactivated, never deleted.** A reason already recorded against a
-- past return must keep resolving in history even once retired from
-- the dropdown — the same reasoning `suppliers.status` already uses
-- for a supplier no longer in use, rather than removing the row.
CREATE TABLE supplier_return_reasons (
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seeded with real defaults rather than left empty — an empty dropdown
-- would make the button unusable from the moment this ships, before
-- any customer has had a chance to configure their own list. Ordinary
-- rows, editable and deactivatable like any other through the new
-- admin screen; nothing about being seeded pins these in place.
INSERT INTO supplier_return_reasons (id, label, sort_order) VALUES
  ('duplicate_invoice',       'Duplicate invoice',                 10),
  ('misdirected',             'Not our invoice / misdirected',     20),
  ('incorrect_po_or_pricing', 'Incorrect PO reference or pricing', 30),
  ('goods_not_received',      'Goods or services not received',    40),
  ('missing_information',     'Missing required information',      50),
  ('other',                   'Other (see comment)',               60);
