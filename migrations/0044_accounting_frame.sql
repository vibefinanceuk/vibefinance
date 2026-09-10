-- 0044_accounting_frame.sql
--
-- **The accounting frame** — decision 0195.
--
-- Decision 0194 found the one thing both Oracle and SAP have that this
-- project does not. Oracle calls it a **Ledger**, SAP a **Controlling
-- Area**, and both describe the same object: a chart of accounts and a
-- fiscal calendar, to which **legal entities are assigned — one or
-- many**.
--
-- SAP states the rule this table exists to enforce:
--
--   One or many company codes can be linked to a single controlling
--   area. All the companies within one controlling area should use the
--   same chart of accounts and fiscal year variant.
--
-- And it is where a cost centre belongs: *"controlling area is created
-- under company code, and cost center is created under controlling
-- area."* Not under a legal entity — which is why one cost centre may
-- be charged by several companies that share a chart of accounts, and
-- why decision 0031 was right to keep `BT-133` apart from `org_units`
-- as *"a financial construct, not an organizational one."*
--
-- `ledger` rather than `controlling_area`, because Oracle's word is
-- the one an English-speaking finance team says out loud.

CREATE TABLE ledgers (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,

  -- **The three things that make a ledger a ledger**, in Oracle's own
  -- reckoning: a chart of accounts, a calendar and a currency. The
  -- chart itself is not modelled yet (see the note at the end); this
  -- names which one, so two ledgers cannot silently share a name and
  -- differ.
  chart_of_accounts TEXT NOT NULL,
  currency          TEXT NOT NULL,

  -- The fiscal year's own start, as a month number. A UK company
  -- closing in April and a French one closing in December cannot share
  -- a ledger, and this is what says so.
  fiscal_year_start_month INTEGER NOT NULL DEFAULT 1
    CHECK (fiscal_year_start_month BETWEEN 1 AND 12),

  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (name)
);

-- A legal entity accounts in exactly one ledger; a ledger serves one or
-- many entities. That is the shape both vendors describe, and it is
-- what makes cross-entity cost accounting possible at all.
--
-- Nullable, because every existing legal entity has no ledger and
-- adding one is a decision an operator makes rather than a migration
-- guesses at.
ALTER TABLE org_units ADD COLUMN ledger_id TEXT REFERENCES ledgers(id);

-- A cost centre belongs to a ledger, not to a company.
ALTER TABLE cost_centres ADD COLUMN ledger_id TEXT REFERENCES ledgers(id);

-- **The tree decision 0184 needs.** Escalation climbs to a *parent cost
-- object manager*, so a cost centre has a parent — and it is a cost
-- centre, not an org unit.
ALTER TABLE cost_centres ADD COLUMN parent_cost_centre_id TEXT
  REFERENCES cost_centres(id);

-- **Who approves what is charged here**, and up to how much. Decision
-- 0184's *default approver*: "each cost object has a pre-assigned owner
-- responsible for charges hitting their budget."
--
-- Both nullable: a cost centre with no owner escalates immediately to
-- its parent, which is a real configuration rather than a broken one.
ALTER TABLE cost_centres ADD COLUMN owner_user_id TEXT REFERENCES org_users(id);
ALTER TABLE cost_centres ADD COLUMN approval_limit REAL
  CHECK (approval_limit IS NULL OR approval_limit >= 0);

CREATE INDEX idx_cost_centres_ledger ON cost_centres(ledger_id);
CREATE INDEX idx_cost_centres_parent ON cost_centres(parent_cost_centre_id);
CREATE INDEX idx_org_units_ledger ON org_units(ledger_id);

-- Point-in-time: nothing is assigned yet, which is the honest starting
-- state.
-- ASSERT: SELECT count(*) FROM ledgers == 0
-- ASSERT: SELECT count(*) FROM org_units WHERE ledger_id IS NOT NULL == 0

-- Standing invariant: only a **legal entity** accounts in a ledger. An
-- operating unit processes transactions and does not account for
-- itself — decision 0036's split, and Oracle's rule that a business
-- unit *"must post to a particular ledger"* through its entity rather
-- than instead of it.
-- ASSERT ALWAYS: SELECT count(*) FROM org_units WHERE ledger_id IS NOT NULL AND kind != 'legal_entity' == 0

-- Standing invariant: a cost centre's parent is a cost centre in the
-- **same ledger**. A tree crossing charts of accounts is a tree whose
-- totals mean nothing.
-- ASSERT ALWAYS: SELECT count(*) FROM cost_centres c JOIN cost_centres p ON p.id = c.parent_cost_centre_id WHERE c.ledger_id IS NOT p.ledger_id AND c.ledger_id != p.ledger_id == 0

-- Standing invariant: a cost centre is not its own parent. Cheap to
-- state, and a cycle would make escalation loop forever.
-- ASSERT ALWAYS: SELECT count(*) FROM cost_centres WHERE parent_cost_centre_id = id == 0

-- Standing invariant: an approval limit needs somebody to hold it. A
-- limit with no owner is a number nobody can act on.
-- ASSERT ALWAYS: SELECT count(*) FROM cost_centres WHERE approval_limit IS NOT NULL AND owner_user_id IS NULL == 0
