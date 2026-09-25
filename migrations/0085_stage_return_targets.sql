-- 0085_stage_return_targets.sql
-- Decision 0490 — third of the five-step Coding-pilot sequence.
--
-- **Return-to-a-stage was already built (decision 0075) but was never
-- actually reachable from the screen.** `handleReturnToStage` requires
-- a `stageId` plus exactly one of `assignToUser`/`assignToTeam` in the
-- request body; `viewer.js`'s own Return button posted only a
-- `{reason}`, the same bare-prompt shape Discard still uses. Clicking
-- Return has 400'd since the route was built — nothing prior to this
-- decision ever collected a target stage or an assignee from a person.
--
-- **A curated list per stage, not a free pick from every visited
-- one.** The visited-stage constraint in `return-route.ts` stays —
-- migration 0031/decision 0075's own load-bearing invariant, unchanged
-- — but "every stage this document happens to have passed through" is
-- not the same question as "where does it make sense to send this
-- back to, and who should receive it." An Approval task returned
-- without this table still only offers stages it has actually
-- visited; this table narrows and routes that set, the same shape
-- decision 0485 already gave Stage Restrictions for a different
-- question ("which stages does this screen even offer").
--
-- **A table, not a column on `stage_actions`** (the shape
-- `reverify_rule_on_complete` uses for `complete`): a stage can
-- reasonably offer more than one return target — Approval sending a
-- document back to either Coding or Validation depending on what's
-- wrong — and a scalar column can only ever hold one. One row per
-- (source stage, target stage), each naming the team that receives it,
-- is the real shape; `stage_actions`' own one-row-per-(stage, action)
-- design solves a different problem (one flag per action) and does
-- not fit a list.
--
-- **Names a team, not a person.** Every other place this system
-- assigns a task on stage entry (`workflow-engine.ts`'s own
-- `assign_task` resolution) names a team by default and lets that
-- team's own members claim it — a specific named assignee is the
-- approval-hierarchy resolver's own special case, not the general
-- rule. Configuring a person here would go stale the moment that
-- person changed teams or left; a team does not.
CREATE TABLE stage_return_targets (
  id                TEXT PRIMARY KEY,
  source_stage_id   TEXT NOT NULL REFERENCES process_stages(id),
  target_stage_id   TEXT NOT NULL REFERENCES process_stages(id),
  team_id           TEXT NOT NULL REFERENCES org_teams(id),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),

  -- A stage returning to itself is not a return at all — decision
  -- 0075's own two-capabilities framing ("backwards, to somewhere
  -- already visited") presumes somewhere else.
  CHECK (source_stage_id != target_stage_id)
);

CREATE UNIQUE INDEX idx_stage_return_targets_pair
  ON stage_return_targets(source_stage_id, target_stage_id);
CREATE INDEX idx_stage_return_targets_source ON stage_return_targets(source_stage_id);

-- Point-in-time: nothing configured yet, so a Return click today finds
-- an empty candidate list at every stage until an operator adds one —
-- the same "sparse, absence means not configured yet" shape
-- stage_actions (migration 0082) already established, not a default
-- that silently offers targets nobody chose.
-- ASSERT: SELECT count(*) FROM stage_return_targets == 0

-- ASSERT ALWAYS: SELECT count(*) FROM stage_return_targets WHERE source_stage_id NOT IN (SELECT id FROM process_stages) == 0
-- ASSERT ALWAYS: SELECT count(*) FROM stage_return_targets WHERE target_stage_id NOT IN (SELECT id FROM process_stages) == 0
-- ASSERT ALWAYS: SELECT count(*) FROM stage_return_targets WHERE team_id NOT IN (SELECT id FROM org_teams) == 0
-- ASSERT ALWAYS: SELECT count(*) FROM stage_return_targets WHERE source_stage_id = target_stage_id == 0
-- Both ends of a configured target belong to the same process — a
-- return that jumped process entirely would not be a return to
-- anywhere this document has been, or could ever have visited.
-- ASSERT ALWAYS: SELECT count(*) FROM stage_return_targets rt JOIN process_stages s ON s.id = rt.source_stage_id JOIN process_stages t ON t.id = rt.target_stage_id WHERE s.process_id != t.process_id == 0
