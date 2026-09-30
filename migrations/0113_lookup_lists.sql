-- 0113_lookup_lists.sql
-- Decision 0568 — Routes phase 2, slice 3: look-up lists.
--
-- The customer's own lists that a supplier mapping can look a value up in,
-- through the `look_up` function: a supplier's unit word ("Rolle") to a
-- standard code, a supplier's article number to the customer's own. Shared:
-- a list is kept once, on the Routes screen, and any mapping may use it.
--
-- A list is read as it is when an invoice is read: lists are not versioned
-- with a mapping. Retiring one keeps its entries; a mapping that still
-- names it then says the list is not available.

CREATE TABLE lookup_lists (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at  TEXT NOT NULL,
  created_by  TEXT REFERENCES org_users(id),
  updated_at  TEXT NOT NULL,
  updated_by  TEXT REFERENCES org_users(id),
  retired_at  TEXT,
  retired_by  TEXT REFERENCES org_users(id)
);
-- One active list of each name, so a person saying "Units" means one list.
CREATE UNIQUE INDEX idx_lookup_lists_active_name ON lookup_lists(lower(name)) WHERE status = 'active';

CREATE TABLE lookup_entries (
  list_id    TEXT NOT NULL REFERENCES lookup_lists(id),
  -- The value as a supplier writes it, trimmed and in lower case: how it is found.
  key        TEXT NOT NULL,
  -- The same value as it was typed, for the person reading the list.
  from_value TEXT NOT NULL,
  to_value   TEXT NOT NULL,
  PRIMARY KEY (list_id, key)
);

-- ASSERT: SELECT count(*) FROM lookup_lists == 0
-- ASSERT ALWAYS: SELECT count(*) FROM lookup_entries e WHERE NOT EXISTS (SELECT 1 FROM lookup_lists l WHERE l.id = e.list_id) == 0
-- ASSERT ALWAYS: SELECT count(*) FROM lookup_entries WHERE trim(key) = '' OR trim(to_value) = '' == 0
-- ASSERT ALWAYS: SELECT count(*) FROM lookup_lists WHERE status = 'retired' AND retired_at IS NULL == 0
