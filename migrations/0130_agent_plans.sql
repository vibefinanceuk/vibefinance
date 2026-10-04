-- 0130_agent_plans.sql
-- Decision 0625 — Agents, slice 4: plain words. An agent keeps the words
-- it was described in, and every version of its plan: what it reports,
-- where, when, how narrowed, how delivered and to whom. Each run records
-- the version it ran.

ALTER TABLE agents ADD COLUMN description TEXT;
ALTER TABLE agents ADD COLUMN plan_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE agent_runs ADD COLUMN plan_version INTEGER;

CREATE TABLE agent_plan_versions (
  agent_id    TEXT NOT NULL REFERENCES agents(id),
  version     INTEGER NOT NULL,
  description TEXT,
  plan_json   TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  created_by  TEXT NOT NULL REFERENCES org_users(id),
  PRIMARY KEY (agent_id, version)
);

-- Every agent so far has one plan: as it stands.
INSERT INTO agent_plan_versions (agent_id, version, description, plan_json, created_at, created_by)
SELECT a.id, 1, NULL,
       json_object(
         'report', a.report,
         'orgIds', json(a.org_unit_ids_json),
         'schedule', json(a.schedule_json),
         'options', json(a.options_json),
         'deliver', json_object('task', json(CASE a.deliver_task WHEN 1 THEN 'true' ELSE 'false' END), 'email', json(CASE a.deliver_email WHEN 1 THEN 'true' ELSE 'false' END)),
         'recipients', (SELECT json_group_array(r.user_id) FROM agent_recipients r WHERE r.agent_id = a.id AND r.user_id <> a.author_id)
       ),
       a.created_at, a.author_id
FROM agents a;

-- ASSERT: SELECT count(*) FROM agents a WHERE NOT EXISTS (SELECT 1 FROM agent_plan_versions v WHERE v.agent_id = a.id AND v.version = a.plan_version) == 0
-- Every agent's current plan is one of its versions.
-- ASSERT ALWAYS: SELECT count(*) FROM agents a WHERE NOT EXISTS (SELECT 1 FROM agent_plan_versions v WHERE v.agent_id = a.id AND v.version = a.plan_version) == 0
