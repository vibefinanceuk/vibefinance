-- 0043_unreadable_document_strings.sql
-- Decision 0161 — saying that a document could not be read.
--
-- **The system knew and never said.** Decision 0055 makes an
-- undetectable document an invoice with no facts, waiting for a person
-- to key it — and it reached them as an empty form with no explanation.
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.unreadable', 'en', 'This document could not be read automatically. Key the fields from the image on the right.');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.tried', 'en', 'Tried:');

INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.unreadable', 'de', 'Dieses Dokument konnte nicht automatisch gelesen werden. Bitte erfassen Sie die Felder anhand des Bildes rechts.');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.tried', 'de', 'Versucht:');

-- Point-in-time: both exist in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('viewer.unreadable','viewer.tried') == 4
