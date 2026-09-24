-- 0162_remove_collaborator_strings.sql
-- Removing a collaborator — decision 0468's own named-but-deferred
-- gap ("a DELETE route is a real, separate follow-up once there is a
-- reason to ask for it"), built in decision 0476. The small "x" on
-- every chip in `collaborators.js`'s own roster bar, gated server-side
-- on the new AP.Manager permission — deliberately narrower than the
-- AP.Review that adds one.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('activity.removeperson', 'en', 'Remove from conversation'),
 ('activity.removepersonfailed', 'en', 'Could not remove that person. Try again.');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('activity.removeperson', 'de', 'Aus dem Gespräch entfernen'),
 ('activity.removepersonfailed', 'de', 'Person konnte nicht entfernt werden. Versuchen Sie es erneut.');

-- Point-in-time: every key exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('activity.removeperson', 'activity.removepersonfailed') == 4
