-- 0082_stage_actions.sql
-- Decision 0487 — the home for "what a stage's action does," as
-- distinct from decisions 0041/0081's "what a stage's fields look
-- like."
--
-- Asked live: *"If I click complete on the Coding Queue, it should
-- check that the coding is actually completed... would it be possible
-- to fire that rule again and confirm the resolution did take
-- place?"* Feasible on its own — the pure evaluator already exists,
-- facts are always live — but re-firing "the rule" only makes sense
-- for a task whose own condition can become false (Coding's
-- `gl_code is_empty`); an Approval task's condition ("amount >
-- threshold") never does, and blind re-firing would permanently block
-- every approval.
--
-- **Why a table, not a column on process_stages** (the shape
-- read_only and offer_field_restrictions already use): the operator's
-- own next request, mid-conversation, was *"I'm going to have to
-- over-hall the button available at each stage... there are buttons,
-- when pressed I would want rule execution to occur."* A scalar
-- column can express one behaviour per stage; the moment a second
-- action (Return, Discard, ...) wants its own configured behaviour, a
-- column-per-action shape means a migration every time one is added.
-- One row per (stage, action) is the real home for "button
-- behaviour," built now rather than migrated to later — the same
-- lesson decision 0143 already drew for read-only (a property, not a
-- hand-kept list) applied one level up, to which property belongs to
-- which action.
--
-- **Sparse, like stage_field_visibility (migration 0038), not
-- defaulted like offer_field_restrictions (0081).** Absence of a row
-- means "no behaviour configured for this action at this stage" —
-- today, exactly today's reality: nothing re-checks anything.
-- offer_field_restrictions defaulted to *offered* because turning it
-- off silently removed something already visible; this is the
-- opposite direction — turning it *on* is a new enforcement that can
-- refuse a completion that currently succeeds, so nothing is enforced
-- until an operator explicitly says so, once, per stage.
CREATE TABLE stage_actions (
  stage_id TEXT NOT NULL REFERENCES process_stages(id),

  -- The closed TaskAction vocabulary (task-list-route.ts) — a value
  -- outside it cannot mean anything, the same reasoning INVOICE_FIELDS
  -- and the permission vocabulary already apply to their own closed
  -- lists.
  action TEXT NOT NULL CHECK (action IN
    ('key', 'return', 'return_to_supplier', 'discard', 'claim', 'complete', 'release')),

  -- **The one flag this decision needs.** Deliberately not the only
  -- column this table will ever have — the whole point of the table
  -- over a scalar column is that the next per-action behaviour lands
  -- here as a new column on the same row, not a new migration moving
  -- data off process_stages.
  reverify_rule_on_complete INTEGER NOT NULL DEFAULT 0
    CHECK (reverify_rule_on_complete IN (0, 1)),

  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (stage_id, action)
);

CREATE INDEX idx_stage_actions_stage ON stage_actions(stage_id);

-- Point-in-time: nothing configured yet, so every existing Complete
-- click behaves exactly as it does today.
-- ASSERT: SELECT count(*) FROM stage_actions == 0
