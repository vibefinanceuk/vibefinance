-- 0096_role_assignment_strings.sql
-- Decision 0327 — assigning and revoking a role through the screen.
INSERT INTO ui_strings (key, locale, value) VALUES
  ('roles.role', 'en', 'Role'),
  ('roles.org', 'en', 'Organisation'),
  ('roles.assign', 'en', 'Assign'),
  ('roles.remove', 'en', 'Remove'),
  ('roles.assignfailed', 'en', 'Could not assign the role. Please try again.'),
  ('roles.revokefailed', 'en', 'Could not remove the role. Please try again.'),
  ('roles.currentassignments', 'en', 'Current assignments'),
  ('roles.newassignment', 'en', 'New assignment'),
  ('roles.role', 'de', 'Rolle'),
  ('roles.org', 'de', 'Organisation'),
  ('roles.assign', 'de', 'Zuweisen'),
  ('roles.remove', 'de', 'Entfernen'),
  ('roles.assignfailed', 'de', 'Die Rolle konnte nicht zugewiesen werden. Bitte versuchen Sie es erneut.'),
  ('roles.revokefailed', 'de', 'Die Rolle konnte nicht entfernt werden. Bitte versuchen Sie es erneut.'),
  ('roles.currentassignments', 'de', 'Aktuelle Zuweisungen'),
  ('roles.newassignment', 'de', 'Neue Zuweisung');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('roles.role','roles.org','roles.assign','roles.remove','roles.assignfailed','roles.revokefailed','roles.currentassignments','roles.newassignment') AND locale = 'en' == 8
