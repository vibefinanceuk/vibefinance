-- 0041_missing_action_labels.sql
-- Decision 0158 — every action has a word.
--
-- **`action.assign_org` rendered as its own key** on the rule screen,
-- because nothing ever seeded it. Decision 0111 added the action and
-- the label was never written — and until decision 0153 nothing
-- displayed an action's name, so nobody saw.
--
-- Seeded from the vocabulary rather than from what a screen happened to
-- need: an action with no label is a key waiting to appear.
INSERT OR IGNORE INTO ui_strings (key, locale, value) VALUES ('action.assign_org', 'en', 'Assign to an operating unit');
INSERT OR IGNORE INTO ui_strings (key, locale, value) VALUES ('action.assign_cost_centre', 'en', 'Assign a cost centre');
INSERT OR IGNORE INTO ui_strings (key, locale, value) VALUES ('action.require_second_approval', 'en', 'Require a second approval');
INSERT OR IGNORE INTO ui_strings (key, locale, value) VALUES ('action.hold_until', 'en', 'Hold until a date');
INSERT OR IGNORE INTO ui_strings (key, locale, value) VALUES ('action.flag', 'en', 'Flag it');
INSERT OR IGNORE INTO ui_strings (key, locale, value) VALUES ('action.reject', 'en', 'Reject it');
INSERT OR IGNORE INTO ui_strings (key, locale, value) VALUES ('action.tag', 'en', 'Tag it');
INSERT OR IGNORE INTO ui_strings (key, locale, value) VALUES ('action.set_field', 'en', 'Set a field');
INSERT OR IGNORE INTO ui_strings (key, locale, value) VALUES ('action.notify', 'en', 'Notify');
INSERT OR IGNORE INTO ui_strings (key, locale, value) VALUES ('action.escalate_after', 'en', 'Escalate after');
INSERT OR IGNORE INTO ui_strings (key, locale, value) VALUES ('action.assign_task', 'en', 'Assign a task');
INSERT OR IGNORE INTO ui_strings (key, locale, value) VALUES ('action.route_to', 'en', 'Move to a stage');

INSERT OR IGNORE INTO ui_strings (key, locale, value) VALUES ('action.assign_org', 'de', 'Einer Organisationseinheit zuordnen');
INSERT OR IGNORE INTO ui_strings (key, locale, value) VALUES ('action.assign_cost_centre', 'de', 'Kostenstelle zuordnen');
INSERT OR IGNORE INTO ui_strings (key, locale, value) VALUES ('action.require_second_approval', 'de', 'Zweite Freigabe verlangen');
INSERT OR IGNORE INTO ui_strings (key, locale, value) VALUES ('action.hold_until', 'de', 'Bis zu einem Datum zurückhalten');
INSERT OR IGNORE INTO ui_strings (key, locale, value) VALUES ('action.flag', 'de', 'Markieren');
INSERT OR IGNORE INTO ui_strings (key, locale, value) VALUES ('action.reject', 'de', 'Ablehnen');
INSERT OR IGNORE INTO ui_strings (key, locale, value) VALUES ('action.tag', 'de', 'Etikettieren');
INSERT OR IGNORE INTO ui_strings (key, locale, value) VALUES ('action.set_field', 'de', 'Feld setzen');
INSERT OR IGNORE INTO ui_strings (key, locale, value) VALUES ('action.notify', 'de', 'Benachrichtigen');
INSERT OR IGNORE INTO ui_strings (key, locale, value) VALUES ('action.escalate_after', 'de', 'Danach eskalieren');
INSERT OR IGNORE INTO ui_strings (key, locale, value) VALUES ('action.assign_task', 'de', 'Aufgabe zuweisen');
INSERT OR IGNORE INTO ui_strings (key, locale, value) VALUES ('action.route_to', 'de', 'Zu einer Stufe bewegen');

-- Standing invariant: every action in the closed vocabulary has a label
-- in every seeded language. A screen rendering `action.assign_org` is a
-- screen showing a customer our column names.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key LIKE 'action.%' AND locale = 'en' >= 12
