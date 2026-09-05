-- 0038_field_visibility.sql
-- Decision 0114 — which fields a person sees, and what they may do
-- with them.
--
-- **Why this is needed.** The vocabulary now carries every mandatory
-- term of the invoice (decisions 0110, 0112). Putting all of them on a
-- screen would be unusable, and the operator's own framing:
--
--   If we put all of the fields on the screen it would be very busy.
--   Any fields like an ID may not be relevant to the user.
--
-- **Three states, not two.** Visible-and-editable, visible-but-not,
-- and hidden. The middle one is the point: BT-126 is a line identifier
-- somebody refers to when talking to a colleague and never types, and
-- hiding it entirely loses that.
--
-- **And it varies by stage**, on the operator's reasoning:
--
--   When the invoice gets to approval, we might have fields visible,
--   but not editable. Approvers should approve data, not edit data.
--
-- That is a control rather than a preference. An approver who can
-- change the amount they are approving has defeated the point of
-- approval.

-- ---------------------------------------------------------------
-- The customer's own baseline
-- ---------------------------------------------------------------
--
-- One row per field the customer has an opinion about. **Absence means
-- the default**, so a customer who configures nothing gets a working
-- screen and nobody has to seed 40 rows to begin.
CREATE TABLE field_visibility (
  -- A vocabulary field code: 'BT-5', 'BT-129'. Not a foreign key —
  -- the vocabulary lives in code, not in this database, and decision
  -- 0041's custom fields can add to it per customer.
  field      TEXT PRIMARY KEY,

  visibility TEXT NOT NULL CHECK (visibility IN ('edit', 'read', 'hidden')),

  -- Where it appears among its neighbours. Two fields sharing a
  -- position is untidy rather than wrong, so this is not unique.
  sort_order INTEGER NOT NULL DEFAULT 0,

  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------
-- What a stage does to it
-- ---------------------------------------------------------------
--
-- A stage may **restrict** what the customer allowed, never widen it.
--
-- A customer setting a field to 'read' and a stage promoting it to
-- 'edit' would quietly undo a control; a stage tightening 'edit' down
-- to 'read' is the approval case above. Enforcing the direction means a
-- misconfiguration cannot hand editing rights to an approver.
CREATE TABLE stage_field_visibility (
  stage_id   TEXT NOT NULL REFERENCES process_stages(id),
  field      TEXT NOT NULL,

  -- 'edit' is deliberately absent. A stage that wanted to permit
  -- editing would simply not have a row here.
  visibility TEXT NOT NULL CHECK (visibility IN ('read', 'hidden')),

  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (stage_id, field)
);

CREATE INDEX idx_stage_field_visibility_stage ON stage_field_visibility(stage_id);

-- Point-in-time: nothing is configured, and every screen behaves as it
-- did.
-- ASSERT: SELECT count(*) FROM field_visibility == 0
-- ASSERT: SELECT count(*) FROM stage_field_visibility == 0

-- Standing invariant: a stage override never grants editing.
--
-- **This is the one that matters.** The CHECK enforces it; restated so
-- that a future change relaxing the constraint is caught, because a
-- stage able to promote a field to 'edit' is a stage that can undo a
-- control the customer set — and an approver editing what they approve
-- is the case this whole record exists to prevent.
-- ASSERT ALWAYS: SELECT count(*) FROM stage_field_visibility WHERE visibility NOT IN ('read', 'hidden') == 0

-- Standing invariant: an override names a real stage.
-- ASSERT ALWAYS: SELECT count(*) FROM stage_field_visibility WHERE stage_id NOT IN (SELECT id FROM process_stages) == 0

-- Standing invariant: a field code is never blank. A row keyed by an
-- empty string would silently apply to nothing while looking like
-- configuration somebody wrote.
-- ASSERT ALWAYS: SELECT count(*) FROM field_visibility WHERE trim(field) = '' == 0
-- ASSERT ALWAYS: SELECT count(*) FROM stage_field_visibility WHERE trim(field) = '' == 0
