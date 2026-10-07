-- 0301_receipt_attachments_strings.sql
-- Decision 0659 — a goods receipt's Attachments tab.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('receipts.attach.empty', 'en', 'Nothing was received with this receipt: it was keyed on the screen, or arrived before files were kept.'),
 ('receipts.attach.empty', 'de', 'Mit diesem Wareneingang wurde nichts empfangen: Er wurde am Bildschirm erfasst oder kam, bevor Dateien aufbewahrt wurden.'),
 ('receipts.attach.nofile', 'en', 'This file is no longer kept.'),
 ('receipts.attach.nofile', 'de', 'Diese Datei wird nicht mehr aufbewahrt.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('receipts.attach.empty', 'receipts.attach.nofile') == 4
