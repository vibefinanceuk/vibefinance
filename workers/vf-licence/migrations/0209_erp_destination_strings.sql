-- 0209_erp_destination_strings.sql
-- Decision 0558. The ERP export as a Destination: in the Route monitor, an
-- export as a message sent out, undone exports, and who did what; on
-- Process routes, pausing and resuming the ERP Destination. The ERP card's
-- note now says what the Destination does.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('routemonitor.status.undone', 'en', 'Undone'),
 ('routemonitor.status.undone', 'de', 'Rückgängig gemacht'),
 ('routemonitor.made.sentone', 'en', '→ invoice {number} sent'),
 ('routemonitor.made.sentone', 'de', '→ Rechnung {number} gesendet'),
 ('routemonitor.invoicessent', 'en', 'Invoices it sent'),
 ('routemonitor.invoicessent', 'de', 'Gesendete Rechnungen'),
 ('routemonitor.made.sent', 'en', '→ {n} invoices sent'),
 ('routemonitor.made.sent', 'de', '→ {n} Rechnungen gesendet'),
 ('routemonitor.sentout', 'en', 'sent out'),
 ('routemonitor.sentout', 'de', 'ausgehend'),
 ('routemonitor.sent', 'en', 'What was sent'),
 ('routemonitor.sent', 'de', 'Was gesendet wurde'),
 ('routemonitor.by', 'en', 'by {who}'),
 ('routemonitor.by', 'de', 'von {who}'),
 ('routemonitor.event.exported', 'en', 'Exported'),
 ('routemonitor.event.exported', 'de', 'Exportiert'),
 ('routemonitor.event.undone', 'en', 'Undone'),
 ('routemonitor.event.undone', 'de', 'Rückgängig gemacht'),
 ('routemonitor.event.file_not_stored', 'en', 'File not kept'),
 ('routemonitor.event.file_not_stored', 'de', 'Datei nicht aufbewahrt'),
 ('routemonitor.error.undone.title', 'en', 'This export was undone'),
 ('routemonitor.error.undone.title', 'de', 'Dieser Export wurde rückgängig gemacht'),
 ('routemonitor.error.undone.body', 'en', 'Someone undid it, with the reason below, because the ERP did not take the file. Its invoices went back to Ready to export.'),
 ('routemonitor.error.undone.body', 'de', 'Jemand hat ihn mit dem unten genannten Grund rückgängig gemacht, weil das ERP die Datei nicht übernommen hat. Seine Rechnungen sind wieder bereit zum Export.'),
 ('routemonitor.error.undone.fix', 'en', 'once the ERP issue is fixed, export them again from the ERP export screen.'),
 ('routemonitor.error.undone.fix', 'de', 'Sobald das Problem im ERP behoben ist, exportieren Sie sie erneut über die Seite ERP-Export.'),
 ('processroutes.pause', 'en', 'Pause'),
 ('processroutes.pause', 'de', 'Pausieren'),
 ('processroutes.resume', 'en', 'Resume'),
 ('processroutes.resume', 'de', 'Fortsetzen'),
 ('processroutes.pausefailed', 'en', 'The Destination could not be changed. Try again.'),
 ('processroutes.pausefailed', 'de', 'Das Ziel konnte nicht geändert werden. Bitte erneut versuchen.'),
 ('processroutes.pausednote', 'en', 'Paused: nothing is exported for this process. Its payment-eligible invoices wait here until it is resumed.'),
 ('processroutes.pausednote', 'de', 'Pausiert: Für diesen Prozess wird nichts exportiert. Seine zahlungsreifen Rechnungen warten hier, bis es fortgesetzt wird.');

UPDATE ui_strings SET value = 'Invoices reaching Payment Eligible are exported from the ERP export screen, each once, as a CSV file. Each export shows in the Route monitor as a message sent out on this Destination.' WHERE key = 'processroutes.erpnote' AND locale = 'en';
UPDATE ui_strings SET value = 'Rechnungen, die Zahlungsreif erreichen, werden über die Seite ERP-Export einmal als CSV-Datei exportiert. Jeder Export erscheint im Routen-Monitor als ausgehende Nachricht dieses Ziels.' WHERE key = 'processroutes.erpnote' AND locale = 'de';

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('routemonitor.status.undone','routemonitor.invoicessent','routemonitor.made.sentone','routemonitor.made.sent','routemonitor.sentout','routemonitor.sent','routemonitor.by','routemonitor.event.exported','routemonitor.event.undone','routemonitor.event.file_not_stored','routemonitor.error.undone.title','routemonitor.error.undone.body','routemonitor.error.undone.fix','processroutes.pause','processroutes.resume','processroutes.pausefailed','processroutes.pausednote') == 34
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'processroutes.erpnote' AND value LIKE '%Route monitor%' == 1
