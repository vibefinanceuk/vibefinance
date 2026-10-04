-- 0128_agent_email.sql
-- Decision 0623 — Agents, slice 2: email. An agent goes to its author and
-- any AP Managers chosen, on the task list, by email, or both. Each copy is
-- filtered to what its recipient may see and written in their language;
-- any recipient may stop receiving it. Every delivery is recorded, with a
-- copy of what was sent kept in R2 for 13 months.

ALTER TABLE agents ADD COLUMN deliver_task INTEGER NOT NULL DEFAULT 1 CHECK (deliver_task IN (0, 1));
ALTER TABLE agents ADD COLUMN deliver_email INTEGER NOT NULL DEFAULT 0 CHECK (deliver_email IN (0, 1));

CREATE TABLE agent_recipients (
  agent_id     TEXT NOT NULL REFERENCES agents(id),
  user_id      TEXT NOT NULL REFERENCES org_users(id),
  added_at     TEXT NOT NULL,
  -- Set when the recipient chose "Stop sending me this".
  opted_out_at TEXT,
  PRIMARY KEY (agent_id, user_id)
);

-- Every agent so far went to its author alone.
INSERT INTO agent_recipients (agent_id, user_id, added_at)
SELECT id, author_id, created_at FROM agents;

CREATE TABLE agent_deliveries (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL REFERENCES agent_runs(id),
  agent_id    TEXT NOT NULL REFERENCES agents(id),
  user_id     TEXT NOT NULL REFERENCES org_users(id),
  channel     TEXT NOT NULL CHECK (channel IN ('task', 'email')),
  status      TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  row_count   INTEGER,
  -- Resend's id for an email.
  message_id  TEXT,
  -- Where the copy sent is kept in R2, for 13 months.
  copy_key    TEXT,
  error       TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_agent_deliveries_run ON agent_deliveries(run_id);
CREATE INDEX idx_agent_deliveries_created ON agent_deliveries(created_at);

-- ASSERT: SELECT count(*) FROM agents a WHERE NOT EXISTS (SELECT 1 FROM agent_recipients r WHERE r.agent_id = a.id AND r.user_id = a.author_id) == 0
-- Every agent's author is among its recipients.
-- ASSERT ALWAYS: SELECT count(*) FROM agents a WHERE a.status <> 'removed' AND NOT EXISTS (SELECT 1 FROM agent_recipients r WHERE r.agent_id = a.id AND r.user_id = a.author_id) == 0
