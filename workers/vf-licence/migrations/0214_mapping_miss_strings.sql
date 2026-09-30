-- 0214_mapping_miss_strings.sql
-- Decision 0563. Supplier mappings: why a mapping that came close did not
-- read an invoice (not published, or not for this sender), and retiring a
-- mapping. The mapping editor's and Route monitor's help say so too.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('mapping.retire', 'en', 'Retire this mapping'),
 ('mapping.retire', 'de', 'Diese Zuordnung stilllegen'),
 ('mapping.retireconfirm.live', 'en', 'Retire {name}? It is live: invoices it reads today will fail until another mapping reads them. Its versions are kept as history.'),
 ('mapping.retireconfirm.live', 'de', '{name} stilllegen? Sie ist live: Rechnungen, die sie heute liest, scheitern, bis eine andere Zuordnung sie liest. Ihre Versionen bleiben als Verlauf erhalten.'),
 ('mapping.retireconfirm.draft', 'en', 'Retire {name}? It has never been published, so no invoice is affected. Its versions are kept as history.'),
 ('mapping.retireconfirm.draft', 'de', '{name} stilllegen? Sie wurde nie veröffentlicht, daher ist keine Rechnung betroffen. Ihre Versionen bleiben als Verlauf erhalten.'),
 ('mapping.retireyes', 'en', 'Retire it'),
 ('mapping.retireyes', 'de', 'Stilllegen'),
 ('mapping.retireno', 'en', 'Keep it'),
 ('mapping.retireno', 'de', 'Behalten'),
 ('mapping.retirefailed', 'en', 'The mapping could not be retired.'),
 ('mapping.retirefailed', 'de', 'Die Zuordnung konnte nicht stillgelegt werden.'),
 ('mapping.retired', 'en', 'This mapping is retired. It reads nothing, and can no longer be changed.'),
 ('mapping.retired', 'de', 'Diese Zuordnung ist stillgelegt. Sie liest nichts und kann nicht mehr geändert werden.'),
 ('mapping.retireddone', 'en', '{name} is retired.'),
 ('mapping.retireddone', 'de', '{name} ist stillgelegt.'),
 ('routemonitor.error.not_for_sender.title', 'en', 'A mapping reads this format, but not from this sender'),
 ('routemonitor.error.not_for_sender.title', 'de', 'Eine Zuordnung liest dieses Format, aber nicht von diesem Absender'),
 ('routemonitor.error.not_for_sender.body', 'en', 'A live mapping on this route reads this kind of file, but Who it is for does not include the address it came from. The file is kept, and nothing is lost.'),
 ('routemonitor.error.not_for_sender.body', 'de', 'Eine live Zuordnung auf dieser Route liest diese Art Datei, aber Für wen sie gilt enthält die Absenderadresse nicht. Die Datei ist gespeichert, nichts geht verloren.'),
 ('routemonitor.error.not_for_sender.fix', 'en', 'Open the mapping, add this sender to Who it is for and save, then reprocess. Who it is for applies at once, without publishing again.'),
 ('routemonitor.error.not_for_sender.fix', 'de', 'Öffnen Sie die Zuordnung, ergänzen Sie diesen Absender unter Für wen sie gilt und speichern Sie, dann erneut verarbeiten. Für wen sie gilt wirkt sofort, ohne erneutes Veröffentlichen.'),
 ('routemonitor.error.not_published.title', 'en', 'A mapping would read it, but has not been published'),
 ('routemonitor.error.not_published.title', 'de', 'Eine Zuordnung würde sie lesen, ist aber nicht veröffentlicht'),
 ('routemonitor.error.not_published.body', 'en', 'A mapping on this route is for this sender and this kind of file, but it is still a draft. Drafts are never used on real invoices. The file is kept, and nothing is lost.'),
 ('routemonitor.error.not_published.body', 'de', 'Eine Zuordnung auf dieser Route gilt für diesen Absender und diese Art Datei, ist aber noch ein Entwurf. Entwürfe werden nie für echte Rechnungen verwendet. Die Datei ist gespeichert, nichts geht verloren.'),
 ('routemonitor.error.not_published.fix', 'en', 'Open the mapping, try it on the sample, publish, then reprocess.'),
 ('routemonitor.error.not_published.fix', 'de', 'Öffnen Sie die Zuordnung, testen Sie sie am Beispiel, veröffentlichen Sie, dann erneut verarbeiten.'),
 ('routemonitor.notforsender', 'en', 'Not for this sender'),
 ('routemonitor.notforsender', 'de', 'Nicht für diesen Absender'),
 ('routemonitor.notpublished', 'en', 'Mapping not published'),
 ('routemonitor.notpublished', 'de', 'Zuordnung nicht veröffentlicht'),
 ('routemonitor.notforsenderwhy', 'en', '{name} reads this format on this route, but is not for {sender}.'),
 ('routemonitor.notforsenderwhy', 'de', '{name} liest dieses Format auf dieser Route, gilt aber nicht für {sender}.'),
 ('routemonitor.notpublishedwhy', 'en', '{name} would read it, but has never been published.'),
 ('routemonitor.notpublishedwhy', 'de', '{name} würde sie lesen, wurde aber nie veröffentlicht.'),
 ('help.screen.mapping.35', 'en', '## Retiring a mapping'),
 ('help.screen.mapping.35', 'de', '## Eine Zuordnung stilllegen'),
 ('help.screen.mapping.36', 'en', '- Retire this mapping, on the Mapping card, stops it reading anything and removes it from the Routes screen. Use it for a mapping made by mistake, or one a supplier no longer needs.'),
 ('help.screen.mapping.36', 'de', '- Diese Zuordnung stilllegen, auf der Karte Zuordnung, beendet jedes Lesen und entfernt sie von der Seite Routen. Für eine versehentlich angelegte Zuordnung oder eine, die ein Lieferant nicht mehr braucht.'),
 ('help.screen.mapping.37', 'en', '- Its versions are kept as history, and invoices it read still name it. A retired mapping cannot be changed or published again.'),
 ('help.screen.mapping.37', 'de', '- Ihre Versionen bleiben als Verlauf erhalten, und gelesene Rechnungen nennen sie weiterhin. Eine stillgelegte Zuordnung kann nicht mehr geändert oder veröffentlicht werden.');

UPDATE ui_strings SET value = '- Save keeps the name and who it is for. Who it is for applies at once, to the live version too, without publishing again.' WHERE key = 'help.screen.mapping.23' AND locale = 'en';
UPDATE ui_strings SET value = '- Speichern sichert den Namen und für wen sie gilt. Für wen sie gilt wirkt sofort, auch für die live Version, ohne erneutes Veröffentlichen.' WHERE key = 'help.screen.mapping.23' AND locale = 'de';
UPDATE ui_strings SET value = '- After publishing, reprocess the messages that failed while waiting for this mapping: only those from a sender it is for are offered. The next invoice from this supplier is read with it automatically.' WHERE key = 'help.screen.mapping.27' AND locale = 'en';
UPDATE ui_strings SET value = '- Verarbeiten Sie nach dem Veröffentlichen die Nachrichten erneut, die auf diese Zuordnung warteten: Angeboten werden nur die von einem Absender, für den sie gilt. Die nächste Rechnung dieses Lieferanten wird automatisch damit gelesen.' WHERE key = 'help.screen.mapping.27' AND locale = 'de';
UPDATE ui_strings SET value = '- A supplier''s own XML that no mapping reads fails in the Route monitor. Where a mapping came close, it says which and why: not published yet, or not for this sender. Otherwise it offers Map this format.' WHERE key = 'help.screen.mapping.30' AND locale = 'en';
UPDATE ui_strings SET value = '- Eigenes XML eines Lieferanten, das keine Zuordnung liest, scheitert im Routen-Monitor. Kam eine Zuordnung nahe, sagt er welche und warum: noch nicht veröffentlicht oder nicht für diesen Absender. Sonst bietet er Dieses Format zuordnen an.' WHERE key = 'help.screen.mapping.30' AND locale = 'de';
UPDATE ui_strings SET value = '- With no mapping yet, it fails with Map this format, which opens the mapping editor on that very file. Where a mapping came close, it says why instead: not published yet, or not for this sender, and offers Open the mapping.' WHERE key = 'help.screen.routemonitor.5' AND locale = 'en';
UPDATE ui_strings SET value = '- Ohne Zuordnung scheitert es mit Dieses Format zuordnen, was den Zuordnungseditor mit genau dieser Datei öffnet. Kam eine Zuordnung nahe, sagt er stattdessen warum: noch nicht veröffentlicht oder nicht für diesen Absender, und bietet Zuordnung öffnen an.' WHERE key = 'help.screen.routemonitor.5' AND locale = 'de';

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('mapping.retire','mapping.retireconfirm.live','mapping.retireconfirm.draft','mapping.retireyes','mapping.retireno','mapping.retirefailed','mapping.retired','mapping.retireddone','routemonitor.error.not_for_sender.title','routemonitor.error.not_for_sender.body','routemonitor.error.not_for_sender.fix','routemonitor.error.not_published.title','routemonitor.error.not_published.body','routemonitor.error.not_published.fix','routemonitor.notforsender','routemonitor.notpublished','routemonitor.notforsenderwhy','routemonitor.notpublishedwhy','help.screen.mapping.35','help.screen.mapping.36','help.screen.mapping.37') == 42
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('help.screen.mapping.23','help.screen.mapping.27','help.screen.mapping.30','help.screen.routemonitor.5') AND (value LIKE '%not for this sender%' OR value LIKE '%nicht für diesen Absender%' OR value LIKE '%without publishing again%' OR value LIKE '%ohne erneutes%' OR value LIKE '%a sender it is for%' OR value LIKE '%für den sie gilt%') == 8
