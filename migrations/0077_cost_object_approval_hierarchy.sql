-- 0077_cost_object_approval_hierarchy.sql
-- Cost-Object Approval Hierarchy generalization — decision 0452, Phase
-- 2 of the plan decision 0451 started.
--
-- Decision 0450's own design document named the shape directly: give
-- every cost object what `cost_centres` already has (an owner and a
-- limit), and a configurable, per-dimension on/off with a display
-- order, honest about which dimensions a line can actually carry a
-- value for. Decision 0451 closed the "nowhere to come from" half —
-- `coding.project`/`coding.commodity_code`/`coding.gl_code` are now
-- real, keyable line fields. This migration closes the other half.

-- **The missing half of what Cost Centre already has.** Same shape
-- `cost_centres.approval_limit` already is (0016): a nullable signing
-- amount, `NULL` meaning "approves anything," the top of a chain
-- rather than a gap in one.
ALTER TABLE coding_list_entries ADD COLUMN approval_limit REAL
  CHECK (approval_limit IS NULL OR approval_limit >= 0);

-- **Which cost-object dimensions route approval, and in what display
-- order.** Cost Centre is the one dimension decision 0439 already
-- routes on — enabled here by default so nothing already live changes
-- behaviour the moment this migration applies. The other three start
-- disabled: Line Level Account Coding (0451) makes them keyable, but
-- an operator turns each on deliberately, at the point they actually
-- want it to gate approval, rather than this migration silently
-- widening what blocks an invoice.
--
-- `sequence` is display order for AP Setup's own Cost-Object Priority
-- panel, not a resolution priority — every enabled dimension with a
-- coded value on a line is resolved, in parallel, per the operator's
-- own settled answer (see `docs/decisions/0452-cost-object-approval-hierarchy.md`).
-- "Priority" in the panel's own name is a naming carried over from
-- decision 0450's mock-up, before the question was settled either way.
CREATE TABLE cost_object_dimensions (
  list_type_id TEXT PRIMARY KEY REFERENCES coding_list_types(id)
    CHECK (list_type_id IN ('cost_centre', 'project', 'commodity_code', 'gl_code')),
  enabled      INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  sequence     INTEGER NOT NULL,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO cost_object_dimensions (list_type_id, enabled, sequence) VALUES
  ('cost_centre', 1, 0),
  ('project', 0, 1),
  ('commodity_code', 0, 2),
  ('gl_code', 0, 3);

-- Point-in-time: the four dimension rows exist, only cost_centre
-- enabled, and no coding_list_entries row has an approval_limit yet
-- (the column is new, and nothing has been through the AP Setup form
-- since).
-- ASSERT: SELECT count(*) FROM cost_object_dimensions == 4
-- ASSERT: SELECT count(*) FROM cost_object_dimensions WHERE enabled = 1 == 1
-- ASSERT: SELECT list_type_id FROM cost_object_dimensions WHERE enabled = 1 == 'cost_centre'
-- ASSERT: SELECT count(*) FROM coding_list_entries WHERE approval_limit IS NOT NULL == 0

-- Standing invariant: still exactly one row per dimension, and only
-- the four real dimensions — the CHECK and PRIMARY KEY already say so,
-- restated for the same reason 0075 restates org_approval_config's own
-- singleton shape.
-- ASSERT ALWAYS: SELECT count(*) FROM cost_object_dimensions == 4
-- ASSERT ALWAYS: SELECT count(*) FROM cost_object_dimensions WHERE list_type_id NOT IN ('cost_centre', 'project', 'commodity_code', 'gl_code') == 0

-- Standing invariant: enabled is always 0 or 1 — belt and braces on
-- top of the CHECK constraint, the same pattern org_users.status
-- established in 0003.
-- ASSERT ALWAYS: SELECT count(*) FROM cost_object_dimensions WHERE enabled NOT IN (0, 1) == 0

-- Standing invariant: an approval_limit, when set, is never negative —
-- restated on top of the CHECK, the same doubled-up pattern
-- cost_centres.approval_limit already carries in 0016.
-- ASSERT ALWAYS: SELECT count(*) FROM coding_list_entries WHERE approval_limit IS NOT NULL AND approval_limit < 0 == 0
