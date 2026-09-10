-- 0047_roles_are_held_somewhere.sql
--
-- **A role is held somewhere** — decision 0199.
--
-- Decision 0192's third step, and the one it called irreversible: the
-- point where a unit stops being a filing label and becomes a boundary.
--
-- The operator named the requirement precisely:
--
--   Assigning AP Manager role for one org will not give a user
--   visibility outside of that org.
--
-- **On the assignment, not on the role.** Decision 0194 found Oracle
-- scopes the *role* — a data role belongs to a business unit, and a
-- person holds several. That works and it duplicates: adding a country
-- means recreating every role in it.
--
-- Scoping the assignment says the same thing with one definition. *AP
-- Manager* is a bundle of permissions; **where somebody holds it** is a
-- separate fact, and Alice may hold it in France and Germany without
-- there being two of it.

-- SQLite cannot add a column to a primary key, and the key must change:
-- a person may hold the same role in two units.
CREATE TABLE org_user_roles_new (
  user_id TEXT NOT NULL REFERENCES org_users(id),
  role_id TEXT NOT NULL REFERENCES org_roles(id),

  -- **Where they hold it.** An operating unit or a legal entity: held
  -- at Acme France, it covers every operating unit beneath — the same
  -- reasoning as decisions 0196 and 0197.
  --
  -- **Null means everywhere**, which is what every existing assignment
  -- is. So nothing changes on the day this lands, and a customer with
  -- no units configured is unaffected for ever.
  unit_id TEXT REFERENCES org_units(id),

  granted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO org_user_roles_new (user_id, role_id, unit_id)
  SELECT user_id, role_id, NULL FROM org_user_roles;

DROP TABLE org_user_roles;
ALTER TABLE org_user_roles_new RENAME TO org_user_roles;

-- One row per person, role and place. `unit_id` is nullable, and in
-- SQLite two NULLs are not equal — so a unique index cannot express
-- "one group-wide assignment per role" on its own. Two partial indexes
-- can.
CREATE UNIQUE INDEX idx_user_roles_scoped
  ON org_user_roles(user_id, role_id, unit_id) WHERE unit_id IS NOT NULL;
CREATE UNIQUE INDEX idx_user_roles_everywhere
  ON org_user_roles(user_id, role_id) WHERE unit_id IS NULL;

CREATE INDEX idx_user_roles_unit ON org_user_roles(unit_id);

-- Point-in-time: every assignment that existed is now explicitly
-- group-wide, and none is scoped. **Nothing changed.**
-- ASSERT: SELECT count(*) FROM org_user_roles WHERE unit_id IS NOT NULL == 0

-- Standing invariant: an assignment names a role that exists. The
-- foreign key says so; this states it where a reader of the migrations
-- will see it, and it survives the table having been rebuilt.
-- ASSERT ALWAYS: SELECT count(*) FROM org_user_roles ur LEFT JOIN org_roles r ON r.id = ur.role_id WHERE r.id IS NULL == 0

-- Standing invariant: nobody holds the same role both everywhere and
-- somewhere. Holding it everywhere already covers holding it in France,
-- and the scoped row would read as a restriction it is not.
-- ASSERT ALWAYS: SELECT count(*) FROM org_user_roles a JOIN org_user_roles b ON a.user_id = b.user_id AND a.role_id = b.role_id WHERE a.unit_id IS NULL AND b.unit_id IS NOT NULL == 0
