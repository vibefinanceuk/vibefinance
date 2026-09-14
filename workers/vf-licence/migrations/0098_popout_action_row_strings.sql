-- 0098_popout_action_row_strings.sql
-- Decision 0329, corrected — the operator's own follow-up: "I wanted
-- save and close button in the top right... the same as the supplier
-- pop-out." actionLink() looks up action.${name} for both its title
-- and its visible label; roles.create/roles.assign/roles.done (added
-- in decisions 0326-0328) were used as plain button text, not through
-- actionLink, so they cannot serve this. Added under the naming this
-- action-row pattern already uses everywhere else in the app.
INSERT INTO ui_strings (key, locale, value) VALUES
  ('action.create', 'en', 'Create'),
  ('action.assign', 'en', 'Assign'),
  ('action.done', 'en', 'Done'),
  ('action.create', 'de', 'Erstellen'),
  ('action.assign', 'de', 'Zuweisen'),
  ('action.done', 'de', 'Fertig');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('action.create','action.assign','action.done') AND locale = 'en' == 3
