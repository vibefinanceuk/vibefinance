-- 0103_person_roles_properties_split_strings.sql
-- Decision 0337 — splitting role allocation and property assignment
-- into two separate pop-outs, each reached by its own icon in the
-- People grid.
INSERT INTO ui_strings (key, locale, value) VALUES
  ('action.roles', 'en', 'Roles'),
  ('action.properties', 'en', 'Properties'),
  ('action.roles', 'de', 'Rollen'),
  ('action.properties', 'de', 'Eigenschaften');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('action.roles','action.properties') AND locale = 'en' == 2
