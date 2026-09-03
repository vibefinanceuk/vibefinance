-- 0030_keyed_fields.sql
-- Decision 0071 — a person producing facts extraction could not.
--
-- The third provenance class (decision 0055 section 8). Every task in
-- this system so far REVIEWS or APPROVES facts that already exist; this
-- is the first where a human being creates them, by reading a document
-- the platform could not.
--
-- A separate table from field_overrides (decision 0049), deliberately,
-- for two reasons that both come from that table's own shape:
--
--   * field_overrides.rule_id is NOT NULL, because an override with no
--     attributable rule is an unattributable change to financial data.
--     A person keying a value has no rule, and widening that column to
--     nullable would weaken the guarantee for the rule case to
--     accommodate a different one.
--   * field_overrides.stage_visit_id is NOT NULL, because a rule only
--     ever runs inside a stage visit. Keying acts on the invoice, and
--     the person doing it may not be looking at a stage at all.
--
-- Same evidence, different actor, different constraints.
CREATE TABLE keyed_fields (
  id             TEXT PRIMARY KEY,
  invoice_id     TEXT NOT NULL REFERENCES invoice_headers(id),
  -- The field, as the closed vocabulary names it. Enforced in code
  -- against isKnownField before anything is written: a person may key
  -- only what a rule could later reference, or the value would be
  -- unreachable by the rules it exists to feed.
  field          TEXT NOT NULL,
  -- What the field held before, as JSON so a number stays a number and
  -- an absent value stays distinguishable from an empty one. NULL means
  -- the field genuinely had no value -- keying a field extraction never
  -- produced is the ordinary case here, and CORRECTING one it produced
  -- wrongly is the more consequential one. Conflating them would hide
  -- the second.
  previous_value TEXT,
  new_value      TEXT NOT NULL,
  -- Derived from the authenticated caller, never accepted from a
  -- request body (decision 0055 section 8, and the same discipline
  -- decision 0007 applies to rule approval). A keyed value is a claim
  -- about what a document says, made by a named person, and it is only
  -- worth anything if the name is real.
  keyed_by       TEXT NOT NULL REFERENCES org_users(id),
  keyed_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_keyed_fields_invoice ON keyed_fields(invoice_id);
CREATE INDEX idx_keyed_fields_user ON keyed_fields(keyed_by);

-- Point-in-time: empty at the moment this migration finishes.
-- ASSERT: SELECT count(*) FROM keyed_fields == 0

-- Standing invariant: every keyed field names a real invoice. The FK
-- enforces it; restated so the replay runner reports it directly,
-- matching every other table in this project.
-- ASSERT ALWAYS: SELECT count(*) FROM keyed_fields WHERE invoice_id NOT IN (SELECT id FROM invoice_headers) == 0

-- Standing invariant: every keyed field names a real person. This is
-- the one that matters most -- an anonymous keyed value is a number
-- somebody typed with nobody accountable for it.
-- ASSERT ALWAYS: SELECT count(*) FROM keyed_fields WHERE keyed_by NOT IN (SELECT id FROM org_users) == 0

-- Standing invariant: a keyed value is never empty. Keying a field to
-- nothing is a deletion wearing a creation's clothes, and it has no
-- meaning here: a field a person cannot read is one they leave alone
-- (partial keying is allowed, see decision 0071).
-- ASSERT ALWAYS: SELECT count(*) FROM keyed_fields WHERE trim(new_value) = '' == 0
