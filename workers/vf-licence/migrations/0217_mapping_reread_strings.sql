-- 0217_mapping_reread_strings.sql
-- Decision 0566. Reading a captured supplier file again with a newer mapping
-- version, a failed file's card saying what was tried and why, and 1 rule
-- broken rather than 1 rules broken.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('routemonitor.brokenone', 'en', '1 rule broken'),
 ('routemonitor.brokenone', 'de', '1 Regel verletzt'),
 ('routemonitor.triedwith', 'en', 'Tried with {name}, version {n}:'),
 ('routemonitor.triedwith', 'de', 'Versucht mit {name}, Version {n}:'),
 ('routemonitor.reread.offer', 'en', 'Version {n} of the mapping is now live. This invoice was read with an earlier version, and nobody has worked on it yet, so it can be read again.'),
 ('routemonitor.reread.offer', 'de', 'Version {n} der Zuordnung ist jetzt aktiv. Diese Rechnung wurde mit einer früheren Version gelesen und noch nicht bearbeitet, daher kann sie erneut gelesen werden.'),
 ('routemonitor.reread.button', 'en', 'Read again with version {n}'),
 ('routemonitor.reread.button', 'de', 'Mit Version {n} erneut lesen'),
 ('routemonitor.reread.done', 'en', 'Read again with version {n}: no EN 16931 rules broken. The same invoice starts again at its first stage.'),
 ('routemonitor.reread.done', 'de', 'Mit Version {n} erneut gelesen: keine EN-16931-Regel verletzt. Dieselbe Rechnung beginnt wieder in ihrer ersten Stufe.'),
 ('routemonitor.reread.donebroken', 'en', 'Read again with version {n}. EN 16931 rules broken: {r}. The same invoice starts again at its first stage.'),
 ('routemonitor.reread.donebroken', 'de', 'Mit Version {n} erneut gelesen. Verletzte EN-16931-Regeln: {r}. Dieselbe Rechnung beginnt wieder in ihrer ersten Stufe.'),
 ('routemonitor.reread.failed', 'en', 'The file could not be read again.'),
 ('routemonitor.reread.failed', 'de', 'Die Datei konnte nicht erneut gelesen werden.'),
 ('routemonitor.reread.no.worked_on', 'en', 'A newer version of the mapping is live, but somebody has worked on this invoice, so it is not read again.'),
 ('routemonitor.reread.no.worked_on', 'de', 'Eine neuere Version der Zuordnung ist aktiv, aber diese Rechnung wurde bereits bearbeitet, daher wird sie nicht erneut gelesen.'),
 ('routemonitor.reread.no.not_in_progress', 'en', 'A newer version of the mapping is live, but this invoice''s process has finished, so it is not read again.'),
 ('routemonitor.reread.no.not_in_progress', 'de', 'Eine neuere Version der Zuordnung ist aktiv, aber der Prozess dieser Rechnung ist beendet, daher wird sie nicht erneut gelesen.'),
 ('routemonitor.reread.no.exported', 'en', 'A newer version of the mapping is live, but this invoice has been exported to the ERP, so it is not read again.'),
 ('routemonitor.reread.no.exported', 'de', 'Eine neuere Version der Zuordnung ist aktiv, aber diese Rechnung wurde ins ERP exportiert, daher wird sie nicht erneut gelesen.'),
 ('routemonitor.reread.no.mapping_retired', 'en', 'The mapping that read this file is retired, so it is not read again.'),
 ('routemonitor.reread.no.mapping_retired', 'de', 'Die Zuordnung, die diese Datei gelesen hat, ist stillgelegt, daher wird sie nicht erneut gelesen.'),
 ('routemonitor.reread.no.no_invoice', 'en', 'No invoice is linked to this file, so it is not read again.'),
 ('routemonitor.reread.no.no_invoice', 'de', 'Mit dieser Datei ist keine Rechnung verknüpft, daher wird sie nicht erneut gelesen.'),
 ('routemonitor.reread.no.no_newer_version', 'en', 'This file was already read with the live version.'),
 ('routemonitor.reread.no.no_newer_version', 'de', 'Diese Datei wurde bereits mit der aktiven Version gelesen.'),
 ('routemonitor.reread.no.read_failed', 'en', 'The live version cannot read this file. Open the mapping and try it on the sample to see why. Nothing was changed.'),
 ('routemonitor.reread.no.read_failed', 'de', 'Die aktive Version kann diese Datei nicht lesen. Öffnen Sie die Zuordnung und testen Sie sie am Beispiel, um zu sehen warum. Nichts wurde geändert.'),
 ('routemonitor.event.reread', 'en', 'Read again'),
 ('routemonitor.event.reread', 'de', 'Erneut gelesen'),
 ('routemonitor.event.reread_failed', 'en', 'Could not be read again'),
 ('routemonitor.event.reread_failed', 'de', 'Konnte nicht erneut gelesen werden');

UPDATE ui_strings SET value = '- Editing a live mapping starts a new draft. The live version keeps reading invoices until the draft is published. An invoice already read with an earlier version can be read again with the new one from the Route monitor, while nobody has worked on it.' WHERE key = 'help.screen.mapping.28' AND locale = 'en';
UPDATE ui_strings SET value = '- Wer eine aktive Zuordnung ändert, beginnt einen neuen Entwurf. Die aktive Version liest weiter Rechnungen, bis der Entwurf veröffentlicht ist. Eine mit einer früheren Version gelesene Rechnung kann im Routen-Monitor mit der neuen erneut gelesen werden, solange sie noch nicht bearbeitet wurde.' WHERE key = 'help.screen.mapping.28' AND locale = 'de';

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('routemonitor.brokenone','routemonitor.triedwith','routemonitor.reread.offer','routemonitor.reread.button','routemonitor.reread.done','routemonitor.reread.donebroken','routemonitor.reread.failed','routemonitor.reread.no.worked_on','routemonitor.reread.no.not_in_progress','routemonitor.reread.no.exported','routemonitor.reread.no.mapping_retired','routemonitor.reread.no.no_invoice','routemonitor.reread.no.no_newer_version','routemonitor.reread.no.read_failed','routemonitor.event.reread','routemonitor.event.reread_failed') == 32
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'help.screen.mapping.28' AND (value LIKE '%read again%' OR value LIKE '%erneut gelesen%') == 2
