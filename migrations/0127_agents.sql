-- 0127_agents.sql
-- Decision 0622 — Agents, slice 1: the engine. An agent is a report an
-- AP Manager sets up once, for organisations they choose, run on a
-- schedule by the five-minute cron and delivered to their task list.
-- No AI in this slice; agents are made from a form.

-- The environment's own time zone, which every agent's schedule reads.
ALTER TABLE org_settings ADD COLUMN time_zone TEXT NOT NULL DEFAULT 'Europe/London';

CREATE TABLE agents (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  author_id         TEXT NOT NULL REFERENCES org_users(id),
  -- One of the reports in agents.ts (AGENT_REPORTS); checked there.
  report            TEXT NOT NULL,
  -- The organisations chosen when it was made: a JSON array of org_units ids.
  org_unit_ids_json TEXT NOT NULL DEFAULT '[]',
  -- When it runs: {"every": "day"|"workday"|"week"|"month"|"once", "time": "HH:MM", ...}.
  schedule_json     TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'paused' CHECK (status IN ('active', 'paused', 'removed')),
  -- Why it was paused by the system rather than a person: 'author_access', 'finished'.
  paused_reason     TEXT,
  next_run_at       TEXT,
  last_run_at       TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  removed_at        TEXT,
  removed_by        TEXT REFERENCES org_users(id)
);
CREATE INDEX idx_agents_due ON agents(status, next_run_at);
CREATE INDEX idx_agents_author ON agents(author_id);

CREATE TABLE agent_runs (
  id            TEXT PRIMARY KEY,
  agent_id      TEXT NOT NULL REFERENCES agents(id),
  -- 'schedule' for the cron, 'now' for Run now (to the author only).
  trigger       TEXT NOT NULL CHECK (trigger IN ('schedule', 'now')),
  scheduled_for TEXT,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  -- 'delivered': a note was made; 'nothing': no rows, so nothing was sent; 'failed': see error.
  status        TEXT NOT NULL CHECK (status IN ('running', 'delivered', 'nothing', 'failed')),
  late          INTEGER NOT NULL DEFAULT 0,
  row_count     INTEGER,
  totals_json   TEXT,
  error         TEXT
);
CREATE INDEX idx_agent_runs_agent ON agent_runs(agent_id, started_at);

-- What an agent delivered to someone's task list. Its own table, not a
-- task: it belongs to no stage, so it never counts in workload.
CREATE TABLE agent_notes (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL REFERENCES agents(id),
  run_id      TEXT NOT NULL REFERENCES agent_runs(id),
  user_id     TEXT NOT NULL REFERENCES org_users(id),
  report_json TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  done_at     TEXT
);
CREATE INDEX idx_agent_notes_user ON agent_notes(user_id, done_at, created_at);

-- Every role that holds AP.Manager may make agents.
UPDATE org_roles
SET permissions_json = json_insert(permissions_json, '$[#]', 'AP.Agents')
WHERE permissions_json LIKE '%"AP.Manager"%' AND permissions_json NOT LIKE '%"AP.Agents"%';

-- ASSERT: SELECT count(*) FROM agents == 0
-- ASSERT: SELECT count(*) FROM org_settings WHERE time_zone <> 'Europe/London' == 0
-- Point-in-time: every role holding AP.Manager can now make agents.
-- ASSERT: SELECT count(*) FROM org_roles WHERE permissions_json LIKE '%"AP.Manager"%' AND permissions_json NOT LIKE '%"AP.Agents"%' == 0
-- An active agent always knows when it runs next.
-- ASSERT ALWAYS: SELECT count(*) FROM agents WHERE status = 'active' AND next_run_at IS NULL == 0
