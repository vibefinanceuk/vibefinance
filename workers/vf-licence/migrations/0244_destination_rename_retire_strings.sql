-- 0244_destination_rename_retire_strings.sql
-- Decision 0597. Renaming and retiring a Destination, as a Source can be.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('processroutes.dest.rename', 'en', 'Rename destination'),
 ('processroutes.dest.rename', 'de', 'Ziel umbenennen'),
 ('processroutes.dest.renamehint', 'en', 'Its name on Process routes, in the Route monitor and in its deliveries. Rules name it by its id, so none needs changing.'),
 ('processroutes.dest.renamehint', 'de', 'Sein Name unter Prozessrouten, im Routen-Monitor und in seinen Zustellungen. Regeln nennen es über seine ID, daher muss keine geändert werden.'),
 ('processroutes.dest.retire', 'en', 'Retire {name}'),
 ('processroutes.dest.retire', 'de', '{name} stilllegen'),
 ('processroutes.dest.retirehint', 'en', 'It sends nothing more, and cannot be resumed. What it has sent stays in the Route monitor, and it stays on Process routes as retired.'),
 ('processroutes.dest.retirehint', 'de', 'Es sendet nichts mehr und kann nicht fortgesetzt werden. Was es gesendet hat, bleibt im Routen-Monitor, und es bleibt unter Prozessrouten als stillgelegt.'),
 ('processroutes.dest.retirednote', 'en', 'Retired. It sends nothing more. What it sent stays in the Route monitor.'),
 ('processroutes.dest.retirednote', 'de', 'Stillgelegt. Es sendet nichts mehr. Was es gesendet hat, bleibt im Routen-Monitor.'),
 ('processroutes.dest.error.name_taken', 'en', 'This process already has a destination with that name.'),
 ('processroutes.dest.error.name_taken', 'de', 'Dieser Prozess hat bereits ein Ziel mit diesem Namen.'),
 ('processroutes.dest.error.bad_name', 'en', 'Give it a name of up to 80 characters.'),
 ('processroutes.dest.error.bad_name', 'de', 'Geben Sie ihm einen Namen mit bis zu 80 Zeichen.'),
 ('processroutes.dest.error.retired', 'en', 'It is already retired.'),
 ('processroutes.dest.error.retired', 'de', 'Es ist bereits stillgelegt.'),
 ('processroutes.dest.error.erp_csv', 'en', 'The ERP CSV file is not retired here: its export screen is how its invoices leave.'),
 ('processroutes.dest.error.erp_csv', 'de', 'Die ERP-CSV-Datei wird hier nicht stillgelegt: Über ihren Exportbildschirm verlassen die Rechnungen das System.'),
 ('processroutes.dest.error.rule_sends_here', 'en', 'Rules send invoices to it: {rules}. Change or end them first.'),
 ('processroutes.dest.error.rule_sends_here', 'de', 'Regeln senden Rechnungen dorthin: {rules}. Ändern oder beenden Sie sie zuerst.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('processroutes.dest.rename','processroutes.dest.renamehint','processroutes.dest.retire','processroutes.dest.retirehint','processroutes.dest.retirednote','processroutes.dest.error.name_taken','processroutes.dest.error.bad_name','processroutes.dest.error.retired','processroutes.dest.error.erp_csv','processroutes.dest.error.rule_sends_here') == 20
