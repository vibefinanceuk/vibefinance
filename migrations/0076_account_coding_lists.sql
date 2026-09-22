-- 0076_account_coding_lists.sql
-- Account Coding — decision 0444.
--
-- *"Cost-Center Lists should be maintained under the Account Coding
-- tab, with other valid coding lists. This would include Company code
-- (Org), Cost-Center; Project, Commodity Code, General Ledger Code for
-- example."* Five example CSV exports followed, and all five shared
-- the exact same shape: `ID, Path, Default, Approver, Parent List ID,
-- Parent Entry ID`, plus two carried dynamic `Filter by - <other
-- list>` columns (GL Code scoped by both Company code and Commodity
-- Code; Cost Centre scoped by Company code). That shape is what this
-- migration builds — one generic framework, not five bespoke tables —
-- confirmed with the operator directly before writing this.
--
-- **Manageable lists only, the same declined scope decisions 0023/
-- 0024/0031 already established for intake channels and cost centres**:
-- nothing here is wired into rule validation, invoice-line capture, or
-- BT-code mapping. A rule can still reference any string as a BT-133
-- value regardless of what any of these tables contain.
--
-- **Company code and Cost Centre are registered here as list *types*,
-- for the "Filter by" mechanism below to name them, but their entries
-- are deliberately NOT duplicated into this migration's entries
-- table**: Company code already lives in `org_units`, and 0016's own
-- header comment is explicit that a cost centre is "a genuinely
-- separate concept from org_units, not merged and not foreign-keyed to
-- it" — reusing `cost_centres` here would break that. `cost_centres`
-- keeps its own dedicated table, columns, and routes, completely
-- unchanged by this migration.

CREATE TABLE coding_list_types (
  id         TEXT PRIMARY KEY
    CHECK (id IN ('company_code', 'cost_centre', 'project', 'commodity_code', 'gl_code')),
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO coding_list_types (id, name) VALUES
  ('company_code', 'Company code'),
  ('cost_centre', 'Cost Centre'),
  ('project', 'Project'),
  ('commodity_code', 'Commodity Code'),
  ('gl_code', 'General Ledger Code');

-- **Which other list(s) scope a given list's own entries** — the
-- generalisation of every "Filter by - X" column the operator's own
-- example exports carried. Declared once per list type here, then
-- every entry of that type carries one value per declared filter
-- (`coding_list_entry_filters`, below) — not a fixed column per filter,
-- since which lists filter which is itself the thing this table
-- records rather than assumes.
CREATE TABLE coding_list_type_filters (
  list_type_id        TEXT NOT NULL REFERENCES coding_list_types(id),
  filter_list_type_id TEXT NOT NULL REFERENCES coding_list_types(id)
    CHECK (filter_list_type_id != list_type_id),
  PRIMARY KEY (list_type_id, filter_list_type_id)
);

INSERT INTO coding_list_type_filters (list_type_id, filter_list_type_id) VALUES
  ('cost_centre', 'company_code'),
  ('gl_code', 'company_code'),
  ('gl_code', 'commodity_code');

-- **The three genuinely greenfield lists' own entries** — Project,
-- Commodity Code, and General Ledger Code had no schema anywhere
-- before this. `parent_entry_id` is a real, same-list, self-
-- referential pointer, confirmed with the operator directly rather
-- than relying on the dot-separated ID / slash-separated Path
-- convention the source export leaves it as (Project's own hierarchy,
-- e.g. `DE01MJO.10.10`, was nested that way only — Parent Entry ID was
-- blank throughout the actual example data).
CREATE TABLE coding_list_entries (
  list_type_id     TEXT NOT NULL REFERENCES coding_list_types(id)
    CHECK (list_type_id IN ('project', 'commodity_code', 'gl_code')),
  id               TEXT NOT NULL,
  name             TEXT NOT NULL,
  is_default       INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  approver_user_id TEXT REFERENCES org_users(id),
  parent_entry_id  TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (list_type_id, id),
  FOREIGN KEY (list_type_id, parent_entry_id) REFERENCES coding_list_entries(list_type_id, id)
);

CREATE INDEX idx_coding_list_entries_parent ON coding_list_entries(list_type_id, parent_entry_id);

-- **The per-entry filter values** — one row per (owner, declared
-- filter), matching a single "Filter by - X" cell in the source data.
-- Deliberately usable by an owner outside `coding_list_entries` too: a
-- cost centre's own entries stay in `cost_centres` (see above), so
-- `owner_list_type_id` names which table the id actually lives in and
-- application code resolves it per type — the same cross-table
-- validation `ledger-route.ts`'s own `handleUpdateCostCentre` already
-- does for ledger consistency, not a real foreign key, since the
-- owner and the filter value can each live in a different table
-- depending on `*_list_type_id`.
CREATE TABLE coding_list_entry_filters (
  owner_list_type_id  TEXT NOT NULL REFERENCES coding_list_types(id),
  owner_entry_id      TEXT NOT NULL,
  filter_list_type_id TEXT NOT NULL REFERENCES coding_list_types(id),
  filter_entry_id     TEXT NOT NULL,
  PRIMARY KEY (owner_list_type_id, owner_entry_id, filter_list_type_id)
);

CREATE INDEX idx_coding_list_entry_filters_value ON coding_list_entry_filters(filter_list_type_id, filter_entry_id);

-- Point-in-time: the five types and three declared filters are seed
-- data inserted by this migration itself; nothing else exists yet.
-- ASSERT: SELECT count(*) FROM coding_list_types == 5
-- ASSERT: SELECT count(*) FROM coding_list_type_filters == 3
-- ASSERT: SELECT count(*) FROM coding_list_entries == 0
-- ASSERT: SELECT count(*) FROM coding_list_entry_filters == 0

-- Standing invariant: only the three greenfield types ever own a row
-- here — belt and braces on top of the CHECK constraint, the same
-- doubled-up pattern 0075 already uses for uses_approval_hierarchy.
-- ASSERT ALWAYS: SELECT count(*) FROM coding_list_entries WHERE list_type_id NOT IN ('project', 'commodity_code', 'gl_code') == 0

-- Standing invariant: an entry is not its own parent — the same cycle
-- guard 0044 already states for cost_centres.parent_cost_centre_id.
-- ASSERT ALWAYS: SELECT count(*) FROM coding_list_entries WHERE parent_entry_id = id == 0

-- Standing invariant: an entry's approver, when set, is a real user.
-- ASSERT ALWAYS: SELECT count(*) FROM coding_list_entries WHERE approver_user_id IS NOT NULL AND approver_user_id NOT IN (SELECT id FROM org_users) == 0

-- Standing invariant: a filter value only ever exists for an
-- (owner type, filter type) pair this migration's own seed data
-- declared — nothing invents a new "Filter by" dimension outside
-- coding_list_type_filters.
-- ASSERT ALWAYS: SELECT count(*) FROM coding_list_entry_filters f WHERE NOT EXISTS (SELECT 1 FROM coding_list_type_filters d WHERE d.list_type_id = f.owner_list_type_id AND d.filter_list_type_id = f.filter_list_type_id) == 0
