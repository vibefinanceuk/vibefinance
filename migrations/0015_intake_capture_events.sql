-- 0015_intake_capture_events.sql
-- Document/receipt intake — see docs/decisions/0029-intake-capture.md.
-- Decisions 0013, 0015, 0019, 0023, 0024, 0025, and 0026 all flagged
-- this gap without closing it. This is what actually captures
-- something through a real intake channel: store its facts, create a
-- process instance for that channel's own process, and visit it
-- immediately — one continuous call, reusing existing storage,
-- instance-creation, and evaluation logic exactly rather than
-- reimplementing any of it.

-- Every capture ATTEMPT through a channel is recorded, whether it
-- succeeds or fails — the same append-only discipline invoice_runs
-- and stage_visits already established. A rejected attempt previously
-- left no trace anywhere in this system at all; "exceptions" would
-- have been invisible to any future analytics. This closes that gap
-- from the start, not as an afterthought.
CREATE TABLE intake_capture_events (
  id                  TEXT PRIMARY KEY,
  channel_id          TEXT NOT NULL REFERENCES intake_channels(id),
  outcome             TEXT NOT NULL,
  -- Populated on rejection with a real, specific reason (missing id,
  -- invalid facts, a process with no stages to instantiate against);
  -- NULL on a genuine acceptance.
  reason              TEXT,
  -- NULL on rejection — there is nothing to point to. Set on
  -- acceptance, even if the very first visit hits an edge case (a
  -- conflicting route_to, say) — the instance was still genuinely
  -- created and entered the system.
  process_instance_id TEXT REFERENCES process_instances(id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_intake_capture_events_channel ON intake_capture_events(channel_id);

-- Point-in-time: empty at the moment this migration finishes.
-- ASSERT: SELECT count(*) FROM intake_capture_events == 0

-- Standing invariant: outcome is closed to the two states this
-- system actually produces — the same discipline already applied to
-- every other closed-vocabulary column in this project.
-- ASSERT ALWAYS: SELECT count(*) FROM intake_capture_events WHERE outcome NOT IN ('accepted', 'rejected') == 0

-- Standing invariant: an accepted event always points to a real
-- instance, and a rejected one never does — the two states are
-- mutually exclusive in what they can legitimately reference, not
-- just in name.
-- ASSERT ALWAYS: SELECT count(*) FROM intake_capture_events WHERE outcome = 'accepted' AND process_instance_id IS NULL == 0
-- ASSERT ALWAYS: SELECT count(*) FROM intake_capture_events WHERE outcome = 'rejected' AND process_instance_id IS NOT NULL == 0

-- Standing invariant: a rejection always carries a real reason — an
-- "exception" a customer can't explain isn't useful analytics.
-- ASSERT ALWAYS: SELECT count(*) FROM intake_capture_events WHERE outcome = 'rejected' AND (reason IS NULL OR reason = '') == 0
