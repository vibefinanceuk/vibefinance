-- 0002_usage_periods.sql
-- Blueprint, "Subsystem three", usage_periods: "Composite primary key
-- makes the push idempotent. Retries and duplicate cron fires cannot
-- double-count."

CREATE TABLE usage_periods (
  customer_id          TEXT NOT NULL REFERENCES customers(id),
  -- Calendar month, "YYYY-MM" — see shared/usage/types.ts's own
  -- comment on why. The primary key is the pair, not either column
  -- alone: this table holds many periods per customer over time, and
  -- one row per customer per period.
  period_key           TEXT NOT NULL,
  invoices_processed   INTEGER NOT NULL DEFAULT 0,
  rules_evaluated       INTEGER NOT NULL DEFAULT 0,
  -- Nullable: vf-app cannot compute this yet (no user/auth concept
  -- exists there today) — see shared/usage/types.ts. NULL means "not
  -- yet computable", never a fabricated 0.
  active_users          INTEGER,
  -- JSON object, e.g. {"matched": 12, "no_match": 3} — whatever
  -- outcome strings the interpreter actually produces. Deliberately
  -- not a fixed set of named columns, so this table never needs a
  -- migration when the interpreter's vocabulary of outcomes changes.
  outcome_counts_json    TEXT NOT NULL DEFAULT '{}',
  received_at            TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (customer_id, period_key)
);

-- Point-in-time: the schema exists and is empty at the moment this
-- migration finishes.
-- ASSERT: SELECT count(*) FROM usage_periods == 0

-- Standing invariant: every usage report belongs to a customer that
-- exists — same pattern as licences.customer_id in 0001.
-- ASSERT ALWAYS: SELECT count(*) FROM usage_periods WHERE customer_id NOT IN (SELECT id FROM customers) == 0

-- Standing invariant: no negative counts. A negative count here would
-- mean a computation bug on the vf-app side (see
-- workers/vf-app/src/usage.ts) got all the way through to storage —
-- worth catching structurally, not just trusting the sender.
-- ASSERT ALWAYS: SELECT count(*) FROM usage_periods WHERE invoices_processed < 0 == 0
-- ASSERT ALWAYS: SELECT count(*) FROM usage_periods WHERE rules_evaluated < 0 == 0
