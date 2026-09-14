-- 0095_role_editing_strings.sql
-- Decision 0326 — the write side of the role-management screen: create
-- and edit a role's own permissions, gated to Admin.RoleManagement.
INSERT INTO ui_strings (key, locale, value) VALUES
  ('action.newrole', 'en', 'New role'),
  ('roles.roleid', 'en', 'Role ID'),
  ('roles.roleidhelp', 'en', 'A short, permanent identifier. Cannot be changed later.'),
  ('roles.rolename', 'en', 'Name'),
  ('roles.create', 'en', 'Create'),
  ('roles.save', 'en', 'Save'),
  ('roles.edit', 'en', 'Edit role'),
  ('roles.changefailed', 'en', 'Could not save the role. Please try again.'),
  ('action.newrole', 'de', 'Neue Rolle'),
  ('roles.roleid', 'de', 'Rollen-ID'),
  ('roles.roleidhelp', 'de', 'Eine kurze, dauerhafte Kennung. Kann später nicht geändert werden.'),
  ('roles.rolename', 'de', 'Name'),
  ('roles.create', 'de', 'Erstellen'),
  ('roles.save', 'de', 'Speichern'),
  ('roles.edit', 'de', 'Rolle bearbeiten'),
  ('roles.changefailed', 'de', 'Die Rolle konnte nicht gespeichert werden. Bitte versuchen Sie es erneut.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('action.newrole','roles.roleid','roles.roleidhelp','roles.rolename','roles.create','roles.save','roles.edit','roles.changefailed') AND locale = 'en' == 8
