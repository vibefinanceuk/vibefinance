-- 0362_network_invoice_document_strings.sql
-- Decision 0770 — an invoice's or credit note's Document and Attachments in the supplier network.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('network.invoice.file.generated_rendering', 'en', 'Page drawn from your e-invoice'),
 ('network.invoice.file.generated_rendering', 'de', 'Aus Ihrer E-Rechnung erstellte Ansicht'),
 ('network.invoice.file.pdf', 'en', 'Your PDF, as sent'),
 ('network.invoice.file.pdf', 'de', 'Ihr PDF, wie gesendet'),
 ('network.invoice.file.xml', 'en', 'Your e-invoice, as sent'),
 ('network.invoice.file.xml', 'de', 'Ihre E-Rechnung, wie gesendet'),
 ('network.invoice.file.embedded_xml', 'en', 'The e-invoice inside your PDF'),
 ('network.invoice.file.embedded_xml', 'de', 'Die E-Rechnung in Ihrem PDF'),
 ('network.invoice.file.other', 'en', 'Your file, as sent'),
 ('network.invoice.file.other', 'de', 'Ihre Datei, wie gesendet'),
 ('apsetup.network.documents', 'en', 'Invoices and credit notes'),
 ('apsetup.network.documents', 'de', 'Rechnungen und Gutschriften'),
 ('apsetup.network.documents.share', 'en', 'Show suppliers the documents they sent'),
 ('apsetup.network.documents.share', 'de', 'Lieferanten die gesendeten Dokumente zeigen'),
 ('apsetup.network.documents.help', 'en', 'Their own PDF, or the page drawn from their e-invoice, with the file to download. Never the email it came in, nor anything else sent with it. Turn off if your scanned invoices carry your own stamps or notes.'),
 ('apsetup.network.documents.help', 'de', 'Ihr eigenes PDF oder die aus ihrer E-Rechnung erstellte Ansicht, mit der Datei zum Herunterladen. Nie die E-Mail, mit der es kam, und nichts, was mit ihm gesendet wurde. Abschalten, wenn Ihre gescannten Rechnungen eigene Stempel oder Notizen tragen.'),
 ('network.invoice.attachhead', 'en', 'As {customer} received it'),
 ('network.invoice.attachhead', 'de', 'Wie {customer} es erhalten hat'),
 ('network.invoice.attachnote', 'en', 'Only the document itself is shown here: not the email it came in, nor anything else sent with it.'),
 ('network.invoice.attachnote', 'de', 'Hier wird nur das Dokument selbst gezeigt: nicht die E-Mail, mit der es kam, und nichts, was mit ihm gesendet wurde.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('network.invoice.attachhead', 'network.invoice.attachnote', 'network.invoice.file.generated_rendering', 'network.invoice.file.pdf', 'network.invoice.file.xml', 'network.invoice.file.embedded_xml', 'network.invoice.file.other', 'apsetup.network.documents', 'apsetup.network.documents.share', 'apsetup.network.documents.help') == 20
