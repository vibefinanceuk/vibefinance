-- 0065_user_properties.sql
-- Decision 0334 — "a way to specify User Properties": Cost Center,
-- Supervisor/Manager, Spend Limit/CCY, and Office Address Location.
-- Org Unit and Approval Limit already existed; Budget Holder is
-- derived from cost_centres.owner_user_id, confirmed live rather
-- than built as a second, independent flag that could drift from it.

-- A person's own cost centre — the forward relationship. The
-- reverse already existed (cost_centres.owner_user_id, migration
-- 0044): a cost centre has one owner who approves its charges. This
-- is a different question — which cost centre this person's own
-- spend is charged against — and the two are independent: someone
-- can own a cost centre without their own spend being charged there,
-- and vice versa.
ALTER TABLE org_users ADD COLUMN cost_centre_id TEXT REFERENCES cost_centres(id);

-- Self-referential, nullable — most people have one; nobody is
-- required to. CHECK compares two columns of the same row, which
-- SQLite evaluates per-row same as any other CHECK: nobody can be
-- recorded as their own manager. A longer cycle (A manages B manages
-- A) is not checked here — the same judgement call org charts
-- elsewhere make, catching the immediate case cheaply rather than
-- building general cycle detection for a field this ordinary.
ALTER TABLE org_users ADD COLUMN manager_id TEXT REFERENCES org_users(id)
  CHECK (manager_id IS NULL OR manager_id != id);

-- The exact structured shape org_units already has (migration 0053)
-- — address_line, city, postal_code, country — reused rather than
-- inventing a second address shape or falling back to free text.
ALTER TABLE org_users ADD COLUMN address_line TEXT;
ALTER TABLE org_users ADD COLUMN city TEXT;
ALTER TABLE org_users ADD COLUMN postal_code TEXT;
ALTER TABLE org_users ADD COLUMN country TEXT;

CREATE INDEX idx_org_users_manager ON org_users(manager_id);
CREATE INDEX idx_org_users_cost_centre ON org_users(cost_centre_id);

-- **Spend Limit, not Approval Limit — confirmed live, not assumed.**
-- "Different — spend limit is how much they can request/spend
-- themselves." The exact shape org_authority_limits already has
-- (currency, amount, one row per currency a person holds a limit
-- in) — a genuinely separate concept, not a rename of the existing
-- table, so the two can never be confused at the schema level either.
CREATE TABLE org_spend_limits (
  user_id    TEXT NOT NULL REFERENCES org_users(id),
  currency   TEXT NOT NULL,
  max_amount REAL NOT NULL CHECK (max_amount >= 0),
  PRIMARY KEY (user_id, currency)
);

-- Point-in-time: nothing exists in the new columns or table yet.
-- ASSERT: SELECT count(*) FROM org_users WHERE cost_centre_id IS NOT NULL OR manager_id IS NOT NULL OR address_line IS NOT NULL == 0
-- ASSERT: SELECT count(*) FROM org_spend_limits == 0

-- Standing invariants: the same referential discipline
-- org_authority_limits already has for its own foreign key.
-- ASSERT ALWAYS: SELECT count(*) FROM org_users WHERE cost_centre_id IS NOT NULL AND cost_centre_id NOT IN (SELECT id FROM cost_centres) == 0
-- ASSERT ALWAYS: SELECT count(*) FROM org_users WHERE manager_id IS NOT NULL AND manager_id NOT IN (SELECT id FROM org_users) == 0
-- ASSERT ALWAYS: SELECT count(*) FROM org_users WHERE manager_id = id == 0
-- ASSERT ALWAYS: SELECT count(*) FROM org_spend_limits WHERE user_id NOT IN (SELECT id FROM org_users) == 0
