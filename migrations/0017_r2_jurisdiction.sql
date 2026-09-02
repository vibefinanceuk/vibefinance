-- 0017_r2_jurisdiction.sql
-- R2 jurisdictional restrictions — see docs/decisions/
-- 0033-r2-jurisdiction.md, extending decision 0013's own "one R2
-- bucket per customer" design. Confirmed directly against Cloudflare's
-- current R2 documentation before adding this: only three
-- jurisdictions currently offer a genuine, hard storage guarantee —
-- 'eu', 'fedramp', 'us'. NULL means unspecified/automatic, R2's own
-- default when no jurisdiction is requested — not a fourth choice.
--
-- Deliberately buildable and testable on its own, ahead of the rest
-- of R2 retention, which stays design-only (decision 0013's own
-- consistent status) — genuine R2 bucket provisioning isn't something
-- this environment can create or test.
--
-- A real, known, explicitly unsolved gap, not silently omitted: this
-- does not cover Saudi Arabia, or any other country R2 doesn't
-- currently offer a jurisdiction for. Attempting to set a jurisdiction
-- outside this list is correctly refused by the CHECK constraint
-- below — the same real limitation stated in the decision doc, now
-- also enforced structurally, not just documented.
ALTER TABLE org_profiles ADD COLUMN r2_jurisdiction TEXT
  CHECK (r2_jurisdiction IS NULL OR r2_jurisdiction IN ('eu', 'fedramp', 'us'));

-- Standing invariant: restated so the replay tool reports it directly,
-- matching the same discipline applied to cius_profile's own CHECK
-- when org_profiles was first created (migration 0003).
-- ASSERT ALWAYS: SELECT count(*) FROM org_profiles WHERE r2_jurisdiction IS NOT NULL AND r2_jurisdiction NOT IN ('eu', 'fedramp', 'us') == 0
