-- 0097_person_creation_strings.sql
-- Decision 0328 — creating a person, and setting their org, name,
-- email, and approval limit.
INSERT INTO ui_strings (key, locale, value) VALUES
  ('action.newperson', 'en', 'New person'),
  ('roles.personname', 'en', 'Name'),
  ('roles.personemail', 'en', 'Email'),
  ('roles.personorg', 'en', 'Organisation'),
  ('roles.limitcurrency', 'en', 'Currency'),
  ('roles.limitamount', 'en', 'Approval limit'),
  ('roles.apikeywarning', 'en', 'This key is shown only once. Copy it now — it cannot be recovered later.'),
  ('roles.apikey', 'en', 'API key'),
  ('roles.done', 'en', 'Done'),
  ('roles.createpersonfailed', 'en', 'Could not create the person. Please try again.'),
  ('action.newperson', 'de', 'Neue Person'),
  ('roles.personname', 'de', 'Name'),
  ('roles.personemail', 'de', 'E-Mail'),
  ('roles.personorg', 'de', 'Organisation'),
  ('roles.limitcurrency', 'de', 'Währung'),
  ('roles.limitamount', 'de', 'Freigabelimit'),
  ('roles.apikeywarning', 'de', 'Dieser Schlüssel wird nur einmal angezeigt. Kopieren Sie ihn jetzt — er kann später nicht wiederhergestellt werden.'),
  ('roles.apikey', 'de', 'API-Schlüssel'),
  ('roles.done', 'de', 'Fertig'),
  ('roles.createpersonfailed', 'de', 'Die Person konnte nicht erstellt werden. Bitte versuchen Sie es erneut.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('action.newperson','roles.personname','roles.personemail','roles.personorg','roles.limitcurrency','roles.limitamount','roles.apikeywarning','roles.apikey','roles.done','roles.createpersonfailed') AND locale = 'en' == 10
