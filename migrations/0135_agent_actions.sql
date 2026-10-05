-- 0135_agent_actions.sql
-- Decision 0631 — Agents phase 3, slice 1: prepared actions, and the
-- first of them, reminding whoever holds a stuck task.
--
-- An agent may also prepare an action (`agents.action`). Each one waits
-- in `agent_actions` for a person holding the action's permission to
-- approve or reject it; approved, VibeFinance does it as that person
-- and keeps what happened. Unapproved after 5 working days it lapses.
-- One waits at a time for the same thing (`subject_key`).
--
-- `org_settings.agent_actions`: an administrator may turn prepared
-- actions off for the whole environment (Dan, 5 October 2026).

ALTER TABLE agents ADD COLUMN action TEXT CHECK (action IS NULL OR action IN ('remind_holder'));
ALTER TABLE org_settings ADD COLUMN agent_actions INTEGER NOT NULL DEFAULT 1 CHECK (agent_actions IN (0, 1));

CREATE TABLE agent_actions (
  id           TEXT PRIMARY KEY,
  agent_id     TEXT NOT NULL REFERENCES agents(id),
  -- The run that prepared it; cleared when old runs are purged, the action kept.
  run_id       TEXT,
  kind         TEXT NOT NULL CHECK (kind IN ('remind_holder')),
  subject_key  TEXT NOT NULL,
  invoice_id   TEXT REFERENCES invoice_headers(id),
  org_unit_id  TEXT,
  permission   TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('waiting', 'done', 'failed', 'rejected', 'expired')),
  prepared_at  TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  decided_by   TEXT REFERENCES org_users(id),
  decided_at   TEXT,
  note         TEXT,
  reason       TEXT,
  result_json  TEXT
);
CREATE UNIQUE INDEX idx_agent_actions_waiting ON agent_actions(agent_id, kind, subject_key) WHERE status = 'waiting';
CREATE INDEX idx_agent_actions_status ON agent_actions(status, expires_at);
CREATE INDEX idx_agent_actions_invoice ON agent_actions(invoice_id);

-- ASSERT ALWAYS: SELECT count(*) FROM agent_actions WHERE status <> 'waiting' AND status <> 'expired' AND decided_at IS NULL == 0
