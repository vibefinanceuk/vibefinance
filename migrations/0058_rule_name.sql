-- 0058_rule_name.sql
--
-- **A rule's identity, not its logic** — decision 0266.
--
-- The activity panel evaluated in decisions 0264/0265 wants to say
-- *"Business rule 'Spend Threshold' fired"* rather than reading back a
-- whole compiled sentence. There is nowhere to put that today — a rule
-- has `source_text` on each of its `rule_versions`, and nothing that
-- survives across recompiling one.
--
-- **On `rules`, not `rule_versions`.** A name is the rule's own
-- identity — "Spend Threshold" does not change because somebody edited
-- the sentence and compiled a v2. Putting it on the version would mean
-- renaming a rule required recompiling it, or the name quietly
-- reverting to null on the next edit.
ALTER TABLE rules ADD COLUMN name TEXT;

-- **Nullable, with no backfill** — decision 0071's precedent. Every
-- rule compiled before this migration has no name, and none is
-- invented for it; a person names it if and when they want to.
-- ASSERT: SELECT count(*) FROM rules WHERE name IS NOT NULL == 0

-- Standing invariant: a name is either absent or a real one — never an
-- empty string sitting where NULL means the same thing more honestly.
-- ASSERT ALWAYS: SELECT count(*) FROM rules WHERE name IS NOT NULL AND trim(name) = '' == 0
