-- 0182_route_to_approver_limit_note.sql
-- Decision 0517. The note Route To Approver's picker shows on an
-- Approval task whose person's approval limit does not cover the
-- invoice. The operator's Manual definition: "if that is not the case
-- the selected user needs to select freely among the users in the
-- company".

INSERT INTO ui_strings (key, locale, value) VALUES
 ('action.route_to_approver.limitnote', 'en', 'Your approval limit does not cover this invoice. Choose who should approve it instead.');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('action.route_to_approver.limitnote', 'de', 'Ihr Genehmigungslimit deckt diese Rechnung nicht ab. Wählen Sie aus, wer sie stattdessen genehmigen soll.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'action.route_to_approver.limitnote' == 2
