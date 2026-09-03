-- 0024_field_overrides.sql
-- Decision 0049 — set_field, and recording what a rule changed.
--
-- set_field has been in the closed vocabulary since the beginning,
-- described in ACTION_DESCRIPTIONS, and implemented nowhere. The
-- third such capability found this week, after 'warned' (0040) and
-- validation.passed (0044): declared, plumbed as far as the compiler,
-- and never once executed.
--
-- Why every change is recorded, and not optionally: a rule that
-- silently rewrites an extracted value destroys the one property that
-- makes extraction trustworthy -- that a stored fact came off the
-- document. "This total was 2,272.47 as read, and a rule changed it
-- to 3,137.47" is exactly the question an auditor asks about a
-- regulatory system, and it must be answerable from the record rather
-- than reconstructed.
--
-- Recorded per stage visit rather than per invoice, matching decision
-- 0044's reasoning: a rule firing describes a MOMENT of evaluation,
-- not a permanent property of a document. The same invoice revisited
-- produces a second visit with its own overrides, and both survive.
CREATE TABLE field_overrides (
  id              TEXT PRIMARY KEY,
  stage_visit_id  TEXT NOT NULL REFERENCES stage_visits(id),
  -- Which rule did it. Without this, an override is an unattributable
  -- change to financial data -- and knowing WHICH rule is what lets
  -- someone fix the rule rather than just the invoice.
  rule_id         TEXT NOT NULL,
  field           TEXT NOT NULL,
  -- The value before the rule ran, as JSON so a number stays a number
  -- and an absent value stays distinguishable from an empty one.
  -- NULL means the field genuinely had no value: a rule SETTING a
  -- field is different from a rule OVERWRITING one, and conflating
  -- them would hide the more consequential case.
  previous_value  TEXT,
  new_value       TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_field_overrides_visit ON field_overrides(stage_visit_id);

-- Point-in-time: empty at the moment this migration finishes.
-- ASSERT: SELECT count(*) FROM field_overrides == 0

-- Standing invariant: an override always names a real field. An
-- empty field name would record that something changed without
-- recording what.
-- ASSERT ALWAYS: SELECT count(*) FROM field_overrides WHERE trim(field) = '' == 0

-- Standing invariant: an override always names the rule responsible.
-- An unattributable change to financial data is exactly what this
-- table exists to prevent.
-- ASSERT ALWAYS: SELECT count(*) FROM field_overrides WHERE trim(rule_id) = '' == 0

-- Standing invariant: values are always real JSON. They are parsed
-- when the record is read, and a malformed value would fail there --
-- long after the visit that wrote it, where it is far harder to
-- attribute.
-- ASSERT ALWAYS: SELECT count(*) FROM field_overrides WHERE json_valid(new_value) = 0 == 0
-- ASSERT ALWAYS: SELECT count(*) FROM field_overrides WHERE previous_value IS NOT NULL AND json_valid(previous_value) = 0 == 0

-- Standing invariant: a recorded override always changed something.
-- Writing a row where the new value equals the old one would fill the
-- audit trail with changes that never happened, making the real ones
-- harder to find.
-- ASSERT ALWAYS: SELECT count(*) FROM field_overrides WHERE previous_value = new_value == 0
