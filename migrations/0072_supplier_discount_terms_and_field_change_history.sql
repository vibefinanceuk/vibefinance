-- 0072_supplier_discount_terms_and_field_change_history.sql
--
-- Decision 0427 — Supplier Performance's own last two metrics.
--
-- **Discount terms, structured — the operator's own chosen path.**
-- Decision 0420 (and 0421's own doc for the payment-terms metric)
-- already found `suppliers.payment_terms` free text with no discount
-- rate or window anywhere. Rather than parse that text, two new
-- columns hold what a supplier's early-payment offer actually is,
-- loaded the same way `payment_terms` already is — a customer's own
-- CSV export, not a per-invoice guess.
--
-- **Forward-looking only, honestly.** A supplier loaded before these
-- columns existed has `NULL` in both until its own next reload — no
-- backfill invents a discount schedule for a supplier who was never
-- asked for one.
ALTER TABLE suppliers ADD COLUMN discount_pct REAL
  CHECK (discount_pct IS NULL OR (discount_pct >= 0 AND discount_pct <= 100));
ALTER TABLE suppliers ADD COLUMN discount_days INTEGER
  CHECK (discount_days IS NULL OR discount_days >= 0);

-- **A general field-change history — the operator's own chosen scope**,
-- wider than the hold-history metric alone needs. `suppliers.on_hold`
-- and `.hold_reason` (migration 0049) have always been current-state
-- only: a plain `UPDATE` overwrites them, and nothing has ever
-- recorded when a hold started, ended, or what any field on this
-- record replaced. This table is the general answer, not a
-- hold-specific one: every field any of this codebase's three
-- supplier write paths can change — the CSV mirror load's own upsert,
-- the hand-edit route (`handleUpdateSupplier`), and the hold/release/
-- activate/deactivate route (`handleSetSupplierState`) — is watched,
-- and a row is written only when a field's own value actually
-- transitions, never on every touch.
--
-- **A separate mechanism from decision 0350's own `detectSupplierChanges`**
-- (`supplier-maintenance.ts`), which stays exactly as it is: that one
-- watches four fields to decide whether to spawn a Supplier
-- Maintenance review task, a narrow, purpose-built trigger. This one is
-- a queryable historical record across every field, for a different
-- job — "how often, for how long, and why" — and neither reads from
-- nor writes to the other.
CREATE TABLE supplier_field_changes (
  id          TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  field       TEXT NOT NULL,
  -- Both nullable and both text: a field cleared to blank, or set for
  -- the first time, is a real transition with one side of it absent —
  -- not an error to work around.
  old_value   TEXT,
  new_value   TEXT,
  changed_by  TEXT NOT NULL,
  changed_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Every real query this decision's own routes make: a supplier's own
-- history for one field (hold history), ordered by time.
CREATE INDEX idx_supplier_field_changes_supplier
  ON supplier_field_changes(supplier_id, field, changed_at);

-- Point-in-time: nothing has changed yet on a schema that just gained
-- the ability to say so.
-- ASSERT: SELECT count(*) FROM supplier_field_changes == 0
