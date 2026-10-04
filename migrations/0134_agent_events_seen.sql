-- 0134_agent_events_seen.sql
-- Decision 0630 — Agents phase 2, slice 3: agents started by an event. An
-- event agent looks every hour and sends each person only what they have
-- not been sent before: this is what each person was sent, by the row's
-- key (an invoice's stay at a stage, a possible duplicate, an invoice
-- from an unapproved supplier, a supplier file that failed). Kept 13
-- months, as the runs are.

CREATE TABLE agent_seen (
  agent_id TEXT NOT NULL REFERENCES agents(id),
  user_id  TEXT NOT NULL REFERENCES org_users(id),
  key      TEXT NOT NULL,
  sent_at  TEXT NOT NULL,
  PRIMARY KEY (agent_id, user_id, key)
);
CREATE INDEX idx_agent_seen_sent ON agent_seen(sent_at);
