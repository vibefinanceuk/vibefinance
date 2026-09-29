-- 0206_erp_export_undo_popout_strings.sql
-- Decision 0554. Undoing an ERP export in the app's own pop-out, in place
-- of the browser's prompt: its heading, what will happen, and the reason
-- box's label and hint.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('erpexport.undotitle', 'en', 'Undo this export'),
 ('erpexport.undotitle', 'de', 'Diesen Export rückgängig machen'),
 ('erpexport.undoexplain', 'en', 'The export of {when} is undone: its {n} invoices go back to Ready to export, to be exported again. The file stays in Past exports.'),
 ('erpexport.undoexplain', 'de', 'Der Export vom {when} wird rückgängig gemacht: Seine {n} Rechnungen sind wieder bereit zum Export. Die Datei bleibt unter Bisherige Exporte.'),
 ('erpexport.undolabel', 'en', 'Why is it being undone?'),
 ('erpexport.undolabel', 'de', 'Warum wird er rückgängig gemacht?'),
 ('erpexport.undoplaceholder', 'en', 'For example: the ERP rejected the file'),
 ('erpexport.undoplaceholder', 'de', 'Zum Beispiel: Das ERP hat die Datei abgelehnt'),
 ('erpexport.undoneedsreason', 'en', 'Give a reason. It shows on the Timeline of each invoice in the export.'),
 ('erpexport.undoneedsreason', 'de', 'Bitte einen Grund angeben. Er erscheint im Verlauf jeder Rechnung dieses Exports.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('erpexport.undotitle','erpexport.undoexplain','erpexport.undolabel','erpexport.undoplaceholder','erpexport.undoneedsreason') == 10
