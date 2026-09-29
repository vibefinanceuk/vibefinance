-- 0205_erp_export_undo_strings.sql
-- Decision 0553. The Timeline's lines for an ERP export and its undoing,
-- and Undo on the ERP export screen.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('activity.erpexported', 'en', '{who} exported this invoice to the ERP'),
 ('activity.erpexported', 'de', '{who} hat diese Rechnung ins ERP exportiert'),
 ('activity.erpexportundone', 'en', '{who} undid its ERP export, so it is back in Ready to export'),
 ('activity.erpexportundone', 'de', '{who} hat den ERP-Export rückgängig gemacht, die Rechnung ist wieder bereit zum Export'),
 ('erpexport.undo', 'en', 'Undo'),
 ('erpexport.undo', 'de', 'Rückgängig'),
 ('erpexport.undoprompt', 'en', 'Undo this export? Its {n} invoices go back to Ready to export, to be exported again. Why is it being undone?'),
 ('erpexport.undoprompt', 'de', 'Diesen Export rückgängig machen? Seine {n} Rechnungen werden wieder bereit zum Export. Warum wird er rückgängig gemacht?'),
 ('erpexport.undone', 'en', 'Undone'),
 ('erpexport.undone', 'de', 'Rückgängig gemacht'),
 ('erpexport.undoneby', 'en', 'by {who}, {when}'),
 ('erpexport.undoneby', 'de', 'von {who}, {when}'),
 ('erpexport.undonemsg', 'en', 'Export undone: {n} invoices are back in Ready to export.'),
 ('erpexport.undonemsg', 'de', 'Export rückgängig gemacht: {n} Rechnungen sind wieder bereit zum Export.'),
 ('erpexport.undofailed', 'en', 'The export could not be undone. Try again.'),
 ('erpexport.undofailed', 'de', 'Der Export konnte nicht rückgängig gemacht werden. Bitte erneut versuchen.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('activity.erpexported','activity.erpexportundone','erpexport.undo','erpexport.undoprompt','erpexport.undone','erpexport.undoneby','erpexport.undonemsg','erpexport.undofailed') == 16
