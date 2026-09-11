-- 0056_dashboard_cards.sql
--
-- **What a person chose to see** — decision 0240.
--
-- A dashboard is **a list of card instances**, each a type plus its
-- settings — not a fixed screen. Decision 0239 found why: six of the
-- metrics asked for name a stage, and stages are customer data
-- (decision 0008), renamed by a customer and versioned by decision
-- 0150.
--
-- **Six hardcoded cards would be wrong for the second customer and
-- stale for the first.** One card taking a stage is six instances of
-- one thing, and is also what makes a library possible.

CREATE TABLE dashboard_cards (
  id      TEXT PRIMARY KEY,

  -- **Per person**, because the question is *"what is my workload"*. A
  -- shared default per role is a second concept and waits until
  -- somebody asks for it.
  user_id TEXT NOT NULL REFERENCES org_users(id),

  -- **From a closed set**, for decision 0031's reason: a catalogue
  -- somebody picks from is safe in a way an arbitrary query is not, and
  -- every type is a query we wrote and can scope.
  --
  -- Listed by hand because SQLite cannot import a TypeScript constant —
  -- and a test asserts the two agree, which decision 0200 learned the
  -- hard way when a hand-copied list drifted twice in an hour.
  card_type TEXT NOT NULL CHECK (card_type IN (
    'waiting_for_me',
    'on_my_clock',
    'items_at_stage',
    'where_things_are',
    'done',
    'ageing',
    'exceptions_by_supplier',
    'needs_somebody',
    'received'
  )),

  -- Which stage, which period — whatever the type needs. JSON because
  -- the types need different things, and a column per setting would be
  -- a column per type.
  settings_json TEXT NOT NULL DEFAULT '{}',

  -- **Where it sits.** A dashboard nobody can reorder is a dashboard
  -- whose most useful card is wherever it was added.
  position INTEGER NOT NULL,

  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_dashboard_cards_user ON dashboard_cards(user_id, position);

-- Point-in-time: nobody has a dashboard, so everybody gets the default
-- set. Deliberately not seeded here — **a default belongs in code where
-- it can change with the card types**, and a migration seeding one for
-- every existing user would freeze today's idea of a good dashboard
-- into every account.
-- ASSERT: SELECT count(*) FROM dashboard_cards == 0

-- Standing invariant: a card's settings are JSON. A string that is not
-- would be read as an empty object and the card would silently show
-- everything.
-- ASSERT ALWAYS: SELECT count(*) FROM dashboard_cards WHERE json_valid(settings_json) = 0 == 0

-- Standing invariant: one position per person. Two cards claiming the
-- same place makes the order depend on row order, which is not a rule
-- anybody could state.
-- ASSERT ALWAYS: SELECT count(*) FROM (SELECT user_id, position FROM dashboard_cards GROUP BY user_id, position HAVING count(*) > 1) == 0
