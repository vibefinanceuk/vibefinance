-- 0030_manifest_completes_the_config.sql
-- Decisions 0136 and 0137 — the manifest holds everything a deploy
-- needs, and a requester says which region.
--
-- **The config is data this control plane already holds.** `environments`
-- carries `worker_name`, `d1_database_name` and `d1_database_id`
-- (decision 0006), and it was being treated as a file only because
-- nothing had asked the manifest for it.
--
-- Two things are missing.

-- The R2 bucket, which is the one binding the manifest does not carry.
ALTER TABLE environments ADD COLUMN r2_bucket_name TEXT;

-- Which region a requester wants — decision 0137.
--
-- **`region` on `environments` is hardcoded to 'eu' by provisioning**,
-- with no reasoning recorded anywhere: a default that became a decision
-- by nobody noticing. Decision 0084 made a customer able to hold
-- environments per region, so it is a real dimension — and a German
-- customer landing in 'eu' is right where an Australian one is not.
--
-- Asked on the form, because the requester knows and we would be
-- guessing. Nullable, because every request made before this was never
-- asked, and inventing an answer for them would be worse than an
-- honest absence.
ALTER TABLE signup_requests ADD COLUMN region TEXT
  CHECK (region IS NULL OR region IN ('eu', 'us'));

-- Point-in-time: nothing has a bucket recorded, and no existing request
-- was ever asked its region.
-- ASSERT: SELECT count(*) FROM environments WHERE r2_bucket_name IS NOT NULL == 0
-- ASSERT: SELECT count(*) FROM signup_requests WHERE region IS NOT NULL == 0

-- Standing invariant: a bucket name belongs to the environment that
-- names it.
--
-- Two environments sharing a bucket would put one customer's documents
-- where another's Worker can read them — the isolation decision 0001
-- exists for, undone by a row. **This is the manifest becoming an
-- instruction rather than a record** (decision 0136), and the reason it
-- now deserves an invariant it did not need when it held only names.
-- ASSERT ALWAYS: SELECT count(*) FROM (SELECT r2_bucket_name FROM environments WHERE r2_bucket_name IS NOT NULL GROUP BY r2_bucket_name HAVING count(*) > 1) == 0

-- Standing invariant: a D1 database likewise.
--
-- A shared `d1_database_id` is the same failure and worse: one
-- customer's Worker reading another's invoices.
-- ASSERT ALWAYS: SELECT count(*) FROM (SELECT d1_database_id FROM environments WHERE d1_database_id IS NOT NULL GROUP BY d1_database_id HAVING count(*) > 1) == 0
