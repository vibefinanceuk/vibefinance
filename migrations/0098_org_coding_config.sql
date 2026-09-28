-- 0098_org_coding_config.sql
-- Decision 0540 — AP Setup's own Account Coding settings, a singleton
-- like org_matching_config (0078). Its first setting: whether a coded
-- line carries a Cost Centre OR a Project, never both ('exclusive', the
-- operator's default), or may carry both ('both', the behaviour before
-- this decision).
CREATE TABLE org_coding_config (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  cost_object_rule TEXT NOT NULL DEFAULT 'exclusive' CHECK (cost_object_rule IN ('exclusive', 'both')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The row exists from the start, as for org_matching_config: nothing
-- reading it ever has to allow for "no config row yet".
INSERT INTO org_coding_config (id) VALUES (1);

-- ASSERT: SELECT count(*) FROM org_coding_config WHERE cost_object_rule = 'exclusive' == 1
-- ASSERT ALWAYS: SELECT count(*) FROM org_coding_config == 1
