-- 0048_labels_with_colons.sql
-- Decision 0181 — the viewer's heading reads as one list.
--
-- `Stage:` and `Unique Ref:` carried colons and `Waiting` and `Owner`
-- did not, so four lines meant to read the same way read two ways.
--
-- **Their own keys, not a colon on the existing ones.** `tasks.waiting`
-- and `tasks.owner` are also **column headings** in the task list,
-- where a trailing colon reads wrong — one key cannot be both a label
-- in a sentence and a heading over a column.
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.waitinglabel', 'en', 'Waiting:');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.ownerlabel', 'en', 'Owner:');

INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.waitinglabel', 'de', 'Wartet seit:');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.ownerlabel', 'de', 'Zuständig:');

-- Point-in-time: both exist in both seeded languages, with colons.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('viewer.waitinglabel','viewer.ownerlabel') AND value LIKE '%:' == 4
