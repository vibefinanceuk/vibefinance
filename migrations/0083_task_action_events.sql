-- 0083_task_action_events.sql
-- Decision 0488 — an audit trail of every task action taken, for the
-- Timeline/Chat feed. Asked live: "when an action is taken for the
-- Timeline / Chat to be updated with the icon of the button taken,
-- their comments and the name of the user taking the action along
-- with a timestamp - all being for audit purposes."
--
-- **Not a blanket new log table for every action.** `activity-route
-- .ts`'s own header comment states the principle this respects: "one
-- kind of new storage, and only one... a record able to quietly
-- disagree with the thing it claims to describe" is a named, already-
-- fixed bug class here (decisions 0236, 0264). Complete, Return,
-- Return To Supplier, and Discard are all already fully, durably
-- recorded on `tasks` itself (`completed_by`/`completed_at`,
-- `ended_by`/`ended_at`/`end_reason`/`status`/`returned_to_stage_id`)
-- and are each terminal — a given task completes, returns, or is
-- discarded at most once, ever — so the Timeline feed derives their
-- entries read-time from those columns, exactly as it already does
-- for `stage_completed`. Building a second table recording the same
-- events would be exactly the fault the file's own comment warns
-- against.
--
-- **Claim and Release are the genuine gap.** Both can cycle multiple
-- times on the same still-open task (claimed, released, claimed by
-- someone else, released again...), and `tasks.claimed_by`/
-- `claimed_at` is a single current-value pair, not a history — it can
-- only ever show the most recent claim. Release leaves no durable
-- trace at all today (it simply nulls those two columns). Neither
-- action has anywhere else that could be read instead; this is the
-- first place either is durably recorded across more than one cycle,
-- the same role `stage_visit_steps` (migration 0009) already plays
-- for rule firings rather than a second, disagreeable copy of them.
CREATE TABLE task_action_events (
  id       TEXT PRIMARY KEY,
  task_id  TEXT NOT NULL REFERENCES tasks(id),

  -- Scoped to exactly the two actions with no other durable trail.
  -- Widened later (the same "rebuild the table" pattern migration
  -- 0033 already used to widen `tasks.status`) if a future action
  -- turns out to need it too — never inferred, an explicit list.
  action   TEXT NOT NULL CHECK (action IN ('claim', 'release')),

  actor_id TEXT NOT NULL REFERENCES org_users(id),
  at       TEXT NOT NULL DEFAULT (datetime('now')),

  -- Nullable: neither route collects one yet (the generic comment-
  -- and-OK/Cancel modal the operator described is a later, separate
  -- decision) — the column exists now so that modal has somewhere to
  -- write once it does, rather than a second migration adding it then.
  comment  TEXT
);

CREATE INDEX idx_task_action_events_task ON task_action_events(task_id);

-- Point-in-time: nothing has been recorded yet.
-- ASSERT: SELECT count(*) FROM task_action_events == 0
