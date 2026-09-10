-- 0050_signin_failure_strings.sql
-- Decision 0190 — a refusal and a failure are not the same thing.
--
-- Decision 0094's rule stands: every **authentication** failure gives
-- the same message, so the screen cannot be used to discover which
-- accounts exist. A 500 is not an authentication failure — it says our
-- service could not answer, and reporting it as *"Sign-in failed"*
-- blames a person for our outage.
--
-- **It discloses nothing**: a 500 is the same whoever asked, so it
-- cannot separate a real account from an invented one.
INSERT INTO ui_strings (key, locale, value) VALUES ('signin.unavailable', 'en', 'We could not reach the sign-in service. This is not your password — please try again shortly.');
INSERT INTO ui_strings (key, locale, value) VALUES ('signin.reachedfailed', 'en', 'Signed in, but we could not reach your environment. Please try again shortly.');

INSERT INTO ui_strings (key, locale, value) VALUES ('signin.unavailable', 'de', 'Der Anmeldedienst war nicht erreichbar. Es liegt nicht an Ihrem Passwort — bitte versuchen Sie es gleich erneut.');
INSERT INTO ui_strings (key, locale, value) VALUES ('signin.reachedfailed', 'de', 'Angemeldet, aber Ihre Umgebung war nicht erreichbar. Bitte versuchen Sie es gleich erneut.');

-- Point-in-time: both exist in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('signin.unavailable','signin.reachedfailed') == 4
