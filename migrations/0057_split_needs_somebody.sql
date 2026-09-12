-- 0057_split_needs_somebody.sql
--
-- **Three cards instead of one** — decision 0259.
--
-- The operator:
--
--   The needs somebody card holds important items. I think it deserves
--   a separate card each, with a graphic, and a link to those
--   documents. 1) Unplaced Documents 2) Suppliers w/ No ERP Ref
--   3) Possible Duplicates
--
-- A combined count could never honestly link anywhere, because a click
-- has to land on one kind of thing and the combined card was three.
-- Splitting it is what makes "and a link to those documents" possible
-- at all.
--
-- SQLite cannot alter a CHECK constraint in place, so the table is
-- rebuilt. **Nothing references `dashboard_cards.id`** — confirmed by
-- searching every migration before writing this one — so this is the
-- plain rebuild, not migration 0055's park-and-restore, which existed
-- only because `invoice_headers.supplier_id` pointed at the table being
-- rebuilt there.

CREATE TABLE dashboard_cards_new (
  id      TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES org_users(id),
  card_type TEXT NOT NULL CHECK (card_type IN (
    'waiting_for_me',
    'on_my_clock',
    'items_at_stage',
    'where_things_are',
    'done',
    'ageing',
    'exceptions_by_supplier',
    'unplaced_documents',
    'suppliers_awaiting_erp',
    'possible_duplicates',
    'received'
  )),
  settings_json TEXT NOT NULL DEFAULT '{}',
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- **A saved 'needs_somebody' card becomes the first of its
-- replacements**, at the position it already held. Nothing is silently
-- dropped from anyone's arranged layout, and the other two are one
-- "Add a card" away — the same distance every other card is from
-- somebody who wants it, which is more honest than guessing that a
-- person wanted all three just because they once wanted one.
INSERT INTO dashboard_cards_new (id, user_id, card_type, settings_json, position, created_at)
SELECT id, user_id,
       CASE card_type WHEN 'needs_somebody' THEN 'unplaced_documents' ELSE card_type END,
       settings_json, position, created_at
FROM dashboard_cards;

DROP TABLE dashboard_cards;
ALTER TABLE dashboard_cards_new RENAME TO dashboard_cards;

CREATE INDEX idx_dashboard_cards_user ON dashboard_cards(user_id, position);

-- Point-in-time: nothing named the old type survives the rebuild.
-- ASSERT: SELECT count(*) FROM dashboard_cards WHERE card_type = 'needs_somebody' == 0

-- Standing invariant: a card's settings are JSON. Carried over from
-- migration 0056, whose table this replaces.
-- ASSERT ALWAYS: SELECT count(*) FROM dashboard_cards WHERE json_valid(settings_json) = 0 == 0

-- Standing invariant: one position per person. Carried over from
-- migration 0056, whose table this replaces.
-- ASSERT ALWAYS: SELECT count(*) FROM (SELECT user_id, position FROM dashboard_cards GROUP BY user_id, position HAVING count(*) > 1) == 0
