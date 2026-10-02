-- 0245_destination_delete_strings.sql
-- Decision 0599. Deleting a Destination that has never sent.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('processroutes.dest.delete', 'en', 'Delete'),
 ('processroutes.dest.delete', 'de', 'Löschen'),
 ('processroutes.dest.deletetitle', 'en', 'Delete {name}'),
 ('processroutes.dest.deletetitle', 'de', '{name} löschen'),
 ('processroutes.dest.deletehint', 'en', 'It has never sent, so it goes entirely: its settings, sign-in, outbound mapping and anything set aside for it. This cannot be undone.'),
 ('processroutes.dest.deletehint', 'de', 'Es hat nie gesendet und wird daher vollständig entfernt: Einstellungen, Anmeldung, Ausgangs-Mapping und alles, was dafür zurückgestellt wurde. Das kann nicht rückgängig gemacht werden.'),
 ('processroutes.dest.error.has_sent', 'en', 'It has sent, or tried to. Retire it instead, so what it sent is kept.'),
 ('processroutes.dest.error.has_sent', 'de', 'Es hat gesendet oder es versucht. Legen Sie es stattdessen still, damit erhalten bleibt, was es gesendet hat.'),
 ('processroutes.dest.error.rule_requested', 'en', 'A rule has sent invoices to it. Retire it instead.'),
 ('processroutes.dest.error.rule_requested', 'de', 'Eine Regel hat Rechnungen dorthin gesendet. Legen Sie es stattdessen still.'),
 ('processroutes.dest.error.has_alerts', 'en', 'An alert watches it. Remove the alert in the Route monitor first.'),
 ('processroutes.dest.error.has_alerts', 'de', 'Eine Benachrichtigung überwacht es. Entfernen Sie sie zuerst im Routen-Monitor.'),
 ('processroutes.dest.error.not_https_out', 'en', 'Only an HTTPS out destination can be deleted.'),
 ('processroutes.dest.error.not_https_out', 'de', 'Nur ein HTTPS-Ausgang-Ziel kann gelöscht werden.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('processroutes.dest.delete','processroutes.dest.deletetitle','processroutes.dest.deletehint','processroutes.dest.error.has_sent','processroutes.dest.error.rule_requested','processroutes.dest.error.has_alerts','processroutes.dest.error.not_https_out') == 14
