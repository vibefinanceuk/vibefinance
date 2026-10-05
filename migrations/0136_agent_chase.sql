-- 0136_agent_chase.sql
-- Decision 0632 — Agents phase 3, slice 2: chasing a supplier about an
-- invoice returned with no reply.
--
-- **The kinds of action leave the schema.** 0135 listed them in CHECKs
-- (`agents.action`, `agent_actions.kind`), and every new action would
-- have meant rebuilding `agents`, which many tables point to (0055 shows
-- what that takes). The code already checks every action against its own
-- list (`AGENT_ACTIONS`), so:
--   - `agents.action_kind` replaces `agents.action`, which is left
--     unused (its values copied across);
--   - `agent_actions` is rebuilt without the list on `kind` (nothing
--     points to it), its statuses still checked.

ALTER TABLE agents ADD COLUMN action_kind TEXT;
UPDATE agents SET action_kind = action WHERE action IS NOT NULL;

CREATE TABLE agent_actions_new (
  id           TEXT PRIMARY KEY,
  agent_id     TEXT NOT NULL REFERENCES agents(id),
  run_id       TEXT,
  kind         TEXT NOT NULL,
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
INSERT INTO agent_actions_new (id, agent_id, run_id, kind, subject_key, invoice_id, org_unit_id, permission, payload_json, status, prepared_at, expires_at, decided_by, decided_at, note, reason, result_json)
  SELECT id, agent_id, run_id, kind, subject_key, invoice_id, org_unit_id, permission, payload_json, status, prepared_at, expires_at, decided_by, decided_at, note, reason, result_json FROM agent_actions;
DROP INDEX IF EXISTS idx_agent_actions_waiting;
DROP INDEX IF EXISTS idx_agent_actions_status;
DROP INDEX IF EXISTS idx_agent_actions_invoice;
DROP TABLE agent_actions;
ALTER TABLE agent_actions_new RENAME TO agent_actions;
CREATE UNIQUE INDEX idx_agent_actions_waiting ON agent_actions(agent_id, kind, subject_key) WHERE status = 'waiting';
CREATE INDEX idx_agent_actions_status ON agent_actions(status, expires_at);
CREATE INDEX idx_agent_actions_invoice ON agent_actions(invoice_id);

-- ASSERT: SELECT count(*) FROM agents WHERE action IS NOT NULL AND (action_kind IS NULL OR action_kind <> action) == 0
