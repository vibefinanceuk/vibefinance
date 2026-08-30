-- 0004_org_user_api_keys.sql
-- Real user authentication (see docs/decisions/0010-user-authentication-
-- and-enforcement.md). Same pattern already proven twice in
-- workers/vf-licence (ADMIN_API_KEY, per-customer keys): a random key
-- generated once, shown once in plaintext, only its hash ever stored.
--
-- Nullable, not NOT NULL, for the same reason customers.api_key_hash
-- is nullable (workers/vf-licence/migrations/0003_customer_api_keys.sql):
-- ALTER TABLE ADD COLUMN with no DEFAULT leaves every existing row
-- NULL, which is the correct state for a user created before this
-- migration — "no key configured" must mean "cannot authenticate",
-- never open access. New users get a real key at creation time,
-- enforced in application code (org-route.ts), not by this schema.

ALTER TABLE org_users ADD COLUMN api_key_hash TEXT;

-- Standing invariant: never an empty string — that would mean a bug
-- in the generation/hashing path stored a blank value instead of
-- either a real hash or NULL. Same invariant, same reasoning, as
-- customers.api_key_hash's own migration.
-- ASSERT ALWAYS: SELECT count(*) FROM org_users WHERE api_key_hash = '' == 0
