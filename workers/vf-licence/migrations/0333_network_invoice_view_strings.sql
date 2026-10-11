-- 0333_network_invoice_view_strings.sql
-- Decision 0729 — an invoice in the network opens full screen, laid out as
-- Create, with the messages with the customer on the right.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('network.view.back', 'en', 'Documents'),
 ('network.view.back', 'de', 'Dokumente'),
 ('network.view.backtitle', 'en', 'Back to your documents'),
 ('network.view.backtitle', 'de', 'Zurück zu Ihren Dokumenten'),
 ('network.view.download', 'en', 'Download'),
 ('network.view.download', 'de', 'Herunterladen'),
 ('network.view.downloadtitle', 'en', 'Download this invoice as a CSV file'),
 ('network.view.downloadtitle', 'de', 'Diese Rechnung als CSV-Datei herunterladen'),
 ('network.view.subtitle', 'en', '{customer} · {company} · received {date}'),
 ('network.view.subtitle', 'de', '{customer} · {company} · eingegangen am {date}'),
 ('network.view.status', 'en', 'Status'),
 ('network.view.status', 'de', 'Status'),
 ('network.view.nolines', 'en', 'No lines were read from this invoice.'),
 ('network.view.nolines', 'de', 'Aus dieser Rechnung wurden keine Positionen gelesen.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key LIKE 'network.view.%' == 14
