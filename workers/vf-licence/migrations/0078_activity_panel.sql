-- 0078_activity_panel.sql
--
-- Decision 0267 — the document activity panel: comments and derived
-- system events (received, stage completions, rule firings), hidden
-- by default in the document viewer.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('activity.tab', 'en', 'Activity'),
 ('activity.title', 'en', 'Activity'),
 ('activity.loading', 'en', 'Loading…'),
 ('activity.empty', 'en', 'Nothing here yet.'),
 ('activity.placeholder', 'en', 'Leave a note for your team…'),
 ('activity.post', 'en', 'Post'),
 ('activity.internalonly', 'en', 'Internal only — not visible to the supplier.'),
 ('activity.loadfailed', 'en', 'Could not load the activity for this document.'),
 ('activity.postfailed', 'en', 'That did not post. Try again.'),
 ('activity.received', 'en', 'Invoice received'),
 ('activity.stagecompleted', 'en', '{who} completed {stage}'),
 ('activity.rulefired', 'en', 'Business rule \u2018{rule}\u2019 fired: {actions}');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('activity.tab', 'de', 'Verlauf'),
 ('activity.title', 'de', 'Verlauf'),
 ('activity.loading', 'de', 'Wird geladen…'),
 ('activity.empty', 'de', 'Hier gibt es noch nichts.'),
 ('activity.placeholder', 'de', 'Hinterlassen Sie eine Notiz für Ihr Team…'),
 ('activity.post', 'de', 'Senden'),
 ('activity.internalonly', 'de', 'Nur intern \u2014 für den Lieferanten nicht sichtbar.'),
 ('activity.loadfailed', 'de', 'Der Verlauf für dieses Dokument konnte nicht geladen werden.'),
 ('activity.postfailed', 'de', 'Das wurde nicht gesendet. Bitte erneut versuchen.'),
 ('activity.received', 'de', 'Rechnung eingegangen'),
 ('activity.stagecompleted', 'de', '{who} hat {stage} abgeschlossen'),
 ('activity.rulefired', 'de', 'Geschäftsregel \u201e{rule}\u201c ausgelöst: {actions}');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key LIKE 'activity.%' == 24
