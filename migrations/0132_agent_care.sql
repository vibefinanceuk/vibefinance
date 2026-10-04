-- 0132_agent_care.sql
-- Decision 0627 — Agents, slice 6: run history and care.
--
-- agent_events: what was changed on an agent, by whom and when — made,
-- its plan changed (with the version), renamed, started, paused, paused
-- because its author lost access, removed, and a recipient stopping it.
-- Changes only (Dan, 4 October 2026); runs stay on the agent's page.
--
-- agent_notes.kind: a 'failure' note is a task for the author when a
-- scheduled run fails, one per agent while it keeps failing, done by
-- itself when a run succeeds again.

ALTER TABLE agent_notes ADD COLUMN kind TEXT NOT NULL DEFAULT 'report' CHECK (kind IN ('report', 'failure'));

CREATE TABLE agent_events (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL REFERENCES agents(id),
  at          TEXT NOT NULL,
  -- NULL where VibeFinance did it (paused because its author lost access).
  user_id     TEXT REFERENCES org_users(id),
  kind        TEXT NOT NULL CHECK (kind IN ('created', 'changed', 'renamed', 'started', 'paused', 'paused_access', 'removed', 'stopped_receiving')),
  detail_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_agent_events_agent ON agent_events(agent_id, at);
CREATE INDEX idx_agent_events_at ON agent_events(at);

-- What is known already: when each agent was made, removed, and stopped by a recipient.
INSERT INTO agent_events (id, agent_id, at, user_id, kind, detail_json)
SELECT 'evt-made-' || id, id, created_at, author_id, 'created', json_object('version', 1) FROM agents;
INSERT INTO agent_events (id, agent_id, at, user_id, kind, detail_json)
SELECT 'evt-removed-' || id, id, removed_at, removed_by, 'removed', '{}' FROM agents WHERE status = 'removed' AND removed_at IS NOT NULL;
INSERT INTO agent_events (id, agent_id, at, user_id, kind, detail_json)
SELECT 'evt-stop-' || agent_id || '-' || user_id, agent_id, opted_out_at, user_id, 'stopped_receiving', '{}' FROM agent_recipients WHERE opted_out_at IS NOT NULL;

-- ASSERT: SELECT count(*) FROM agents a WHERE NOT EXISTS (SELECT 1 FROM agent_events e WHERE e.agent_id = a.id AND e.kind = 'created') == 0
-- ASSERT ALWAYS: SELECT count(*) FROM agent_notes WHERE kind NOT IN ('report', 'failure') == 0
