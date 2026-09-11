-- 0066_activate_and_close.sql
--
-- **`action.activate` never existed** — decision 0236.
--
-- Migration 0065 left it out on a claim that it was already defined,
-- which came from a grep that matched `action.save` twice. The button
-- rendered its own key: *"action.activate"*, on screen, in a product.
--
-- **And the check that would have caught it was removed in the same
-- edit.** `string-coverage` names every key the interface uses; taking
-- the key out of the migration and out of the list together leaves
-- nothing to notice.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('action.activate', 'en', 'Activate'),
 ('action.activate', 'de', 'Aktivieren');

-- **Close, which every pop-out has and none had an icon for** —
-- decision 0236.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('action.close', 'en', 'Close'),
 ('action.close', 'de', 'Schließen');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'action.activate' == 2
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'action.close' == 2

-- Standing invariant: every `action.*` key exists in both seeded
-- languages. **The shape of the fault this migration fixes** — a key
-- present in one and not the other shows a raw key to half the
-- customers, and nothing else looks for that.
-- ASSERT ALWAYS: SELECT count(*) FROM (SELECT key FROM ui_strings WHERE key LIKE 'action.%' GROUP BY key HAVING count(DISTINCT locale) != 2) == 0
