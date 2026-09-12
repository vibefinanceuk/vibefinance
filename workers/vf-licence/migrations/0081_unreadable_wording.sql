-- 0081_unreadable_wording.sql
-- Decision 0273 — the operator's own wording, replacing "Key the
-- fields from the image on the right" (written when the image sat
-- beside the form) now that the note lives in the Timeline / Chat tab
-- rather than beside anything specific.
UPDATE ui_strings SET value = 'This document could not be read automatically. Please manually enter the fields in the cells provided.' WHERE key = 'viewer.unreadable' AND locale = 'en';
UPDATE ui_strings SET value = 'Dieses Dokument konnte nicht automatisch gelesen werden. Bitte erfassen Sie die Felder manuell in den vorgesehenen Feldern.' WHERE key = 'viewer.unreadable' AND locale = 'de';

-- Point-in-time: the wording changed and nothing was lost.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'viewer.unreadable' == 2
