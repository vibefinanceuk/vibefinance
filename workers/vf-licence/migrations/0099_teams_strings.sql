-- 0099_teams_strings.sql
-- Decision 0332 — creating and maintaining teams, and assigning
-- people to them.
INSERT INTO ui_strings (key, locale, value) VALUES
  ('roles.teams', 'en', 'Teams'),
  ('roles.noteamsconfigured', 'en', 'No teams configured yet.'),
  ('roles.teammembers', 'en', 'Members'),
  ('action.newteam', 'en', 'New team'),
  ('roles.teamname', 'en', 'Name'),
  ('roles.teamid', 'en', 'Team ID'),
  ('roles.teamidhelp', 'en', 'A short, permanent identifier. Cannot be changed later.'),
  ('roles.addmember', 'en', 'Add'),
  ('roles.member', 'en', 'Person'),
  ('roles.noteammembers', 'en', 'No members yet.'),
  ('roles.teamsavefailed', 'en', 'Could not save the team. Please try again.'),
  ('roles.addmemberfailed', 'en', 'Could not add that person. Please try again.'),
  ('roles.removememberfailed', 'en', 'Could not remove that person. Please try again.'),
  ('column.team', 'en', 'Team'),
  ('roles.teams', 'de', 'Teams'),
  ('roles.noteamsconfigured', 'de', 'Noch keine Teams eingerichtet.'),
  ('roles.teammembers', 'de', 'Mitglieder'),
  ('action.newteam', 'de', 'Neues Team'),
  ('roles.teamname', 'de', 'Name'),
  ('roles.teamid', 'de', 'Team-ID'),
  ('roles.teamidhelp', 'de', 'Eine kurze, dauerhafte Kennung. Kann später nicht geändert werden.'),
  ('roles.addmember', 'de', 'Hinzufügen'),
  ('roles.member', 'de', 'Person'),
  ('roles.noteammembers', 'de', 'Noch keine Mitglieder.'),
  ('roles.teamsavefailed', 'de', 'Das Team konnte nicht gespeichert werden. Bitte versuchen Sie es erneut.'),
  ('roles.addmemberfailed', 'de', 'Die Person konnte nicht hinzugefügt werden. Bitte versuchen Sie es erneut.'),
  ('roles.removememberfailed', 'de', 'Die Person konnte nicht entfernt werden. Bitte versuchen Sie es erneut.'),
  ('column.team', 'de', 'Team');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('roles.teams','roles.noteamsconfigured','roles.teammembers','action.newteam','roles.teamname','roles.teamid','roles.teamidhelp','roles.addmember','roles.member','roles.noteammembers','roles.teamsavefailed','roles.addmemberfailed','roles.removememberfailed','column.team') AND locale = 'en' == 14
