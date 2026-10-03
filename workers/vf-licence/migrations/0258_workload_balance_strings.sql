-- 0258_workload_balance_strings.sql
-- Decision 0615. Workload balance redrawn: one bar per team split by who
-- has its open work, teams with nothing open left out and counted, and a
-- member's share opening Documents.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('workload.balancequiet', 'en', '{n} teams with nothing open are not shown'),
 ('workload.balancequiet', 'de', '{n} Teams ohne offene Aufgaben werden nicht angezeigt'),
 ('workload.balanceothers', 'en', 'Others'),
 ('workload.balanceothers', 'de', 'Weitere'),
 ('documents.showing.openforteam', 'en', 'Showing what is open for {name} in {team}''s queue'),
 ('documents.showing.openforteam', 'de', 'Zeigt, was für {name} in der Warteschlange von {team} offen ist');

UPDATE ui_strings SET value = 'Who has each team''s open work, most uneven first' WHERE key = 'workload.balancesub' AND locale = 'en';
UPDATE ui_strings SET value = 'Wer die offene Arbeit jedes Teams hat, die ungleichmäßigsten zuerst' WHERE key = 'workload.balancesub' AND locale = 'de';
UPDATE ui_strings SET value = 'No team has open work right now' WHERE key = 'workload.nobalance' AND locale = 'en';
UPDATE ui_strings SET value = 'Kein Team hat gerade offene Arbeit' WHERE key = 'workload.nobalance' AND locale = 'de';

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('workload.balancequiet','workload.balanceothers','documents.showing.openforteam') == 6
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'workload.balancesub' AND value LIKE '%Variance%' == 0
