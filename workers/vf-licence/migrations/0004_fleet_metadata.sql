-- 0004_fleet_metadata.sql
-- Blueprint build order step 5, "Fleet tooling" — the manifest every
-- fleet tool (migrate-all, deploy-all, "who's on what version")
-- ultimately needs: which customers exist, and where their vf-app
-- deployment actually lives.
--
-- Extends customers rather than introducing a separate fleet manifest
-- file or table — customers already tracks instance_url for exactly
-- this class of reason ("Where their Worker lives, including
-- self-hosted", 0001_control_plane_schema.sql's own comment). A
-- second, separate list of customers would only be able to drift out
-- of sync with this one.
--
-- vf-app's own wrangler.jsonc already documented this exact need
-- before this migration existed: "every other customer's
-- wrangler.jsonc differs only in database_id (and eventually
-- database_name)". Building this surfaced one more real, currently-
-- blocking field: the Worker's own `name` is hardcoded "vf-app" today,
-- and every Worker in one Cloudflare account needs a unique name — a
-- second customer's deployment cannot exist at all under the current
-- config without a distinct worker_name.
--
-- All four columns nullable, all backfilled at application layer —
-- same pattern as api_key_hash in 0003_customer_api_keys.sql. Acme,
-- the one real customer that predates this migration, gets NULLs
-- until backfilled explicitly; a fleet tool must treat a customer with
-- no fleet metadata as "not deployable yet", never guess a default.
ALTER TABLE customers ADD COLUMN worker_name TEXT;
ALTER TABLE customers ADD COLUMN d1_database_name TEXT;
ALTER TABLE customers ADD COLUMN d1_database_id TEXT;
ALTER TABLE customers ADD COLUMN locale TEXT;

-- Standing invariant: never an empty string for any of these — the
-- same "NULL means not yet configured, empty string means a real bug
-- in the write path" distinction already established for
-- api_key_hash.
-- ASSERT ALWAYS: SELECT count(*) FROM customers WHERE worker_name = '' == 0
-- ASSERT ALWAYS: SELECT count(*) FROM customers WHERE d1_database_name = '' == 0
-- ASSERT ALWAYS: SELECT count(*) FROM customers WHERE d1_database_id = '' == 0
-- ASSERT ALWAYS: SELECT count(*) FROM customers WHERE locale = '' == 0

-- Standing invariant: worker_name is unique among customers that have
-- one set at all — two customers cannot share a Worker name, since
-- Cloudflare itself would refuse the second deploy, but this should
-- be caught here, in data, before ever reaching a live `wrangler
-- deploy` failure.
-- ASSERT ALWAYS: SELECT count(*) FROM (SELECT worker_name FROM customers WHERE worker_name IS NOT NULL GROUP BY worker_name HAVING count(*) > 1) == 0

-- Standing invariant: same uniqueness requirement for d1_database_name
-- — two customers cannot share a database.
-- ASSERT ALWAYS: SELECT count(*) FROM (SELECT d1_database_name FROM customers WHERE d1_database_name IS NOT NULL GROUP BY d1_database_name HAVING count(*) > 1) == 0
