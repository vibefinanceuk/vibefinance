-- 0013_ui_strings.sql
-- Decision 0107 — the interface's own words.
--
-- **In the control plane, for the same reason branding is** (decision
-- 0096): the login screen needs its words before an instance has been
-- chosen, so an instance cannot be the source. `vf-ui` is one shared
-- deployment serving every customer, and this is the only database it
-- can reach through `vf-licence`.
--
-- **In D1 rather than a bundled file**, on the operator's instruction.
-- A translation shipped in the JavaScript means a UI deployment to fix
-- a wording error or add a language, and both are things somebody who
-- does not deploy should be able to do.
CREATE TABLE ui_strings (
  -- A dotted name, chosen to be readable in the source it replaces:
  -- `tasks.claim` rather than `t42`. A key nobody can read is one
  -- somebody eventually inlines the English beside "for clarity".
  key    TEXT NOT NULL,

  -- The same six vf-app supports (`src/i18n.ts`). Not widened here:
  -- offering a language the API cannot answer in would be worse than
  -- offering neither.
  locale TEXT NOT NULL CHECK (locale IN ('en', 'de', 'fr', 'es', 'it', 'nl')),

  value  TEXT NOT NULL,

  PRIMARY KEY (key, locale)
);

CREATE INDEX idx_ui_strings_locale ON ui_strings(locale);

-- Point-in-time: the table exists and is empty. The words arrive in
-- migration 0014 — separated so that adding a language, or fixing a
-- wording, is its own reviewable change rather than an edit to a schema
-- that was already applied.
-- ASSERT: SELECT count(*) FROM ui_strings == 0

-- Standing invariant: every key has an English value.
--
-- **This is the one that matters.** Decision 0008 established that an
-- unrecognised or absent locale falls back to English and never errors.
-- That guarantee is only as good as English being complete — a German
-- string with no English sibling breaks the fallback for everybody who
-- is not German.
-- ASSERT ALWAYS: SELECT count(*) FROM (SELECT DISTINCT key FROM ui_strings WHERE key NOT IN (SELECT key FROM ui_strings WHERE locale = 'en')) == 0

-- Standing invariant: no blank values. A key present with an empty
-- string is worse than a key absent -- the absent one falls back to
-- English, and the blank one renders as nothing at all.
-- ASSERT ALWAYS: SELECT count(*) FROM ui_strings WHERE trim(value) = '' == 0

-- Standing invariant: keys are lowercase dotted names. Stated so the
-- set stays greppable against the source that uses them.
-- ASSERT ALWAYS: SELECT count(*) FROM ui_strings WHERE key != lower(key) OR trim(key) = '' == 0
