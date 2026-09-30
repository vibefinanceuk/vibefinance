-- 0221_attachments_strings.sql
-- Decision 0571. The viewer's Attachments tab, in place of the XML tab, and the
-- route message an invoice came in, named in the Timeline.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('viewer.attachmentstab', 'en', 'Attachments'),
 ('viewer.attachmentstab', 'de', 'Anhänge'),
 ('activity.receivedroute', 'en', 'Received by {source}, message {message}'),
 ('activity.receivedroute', 'de', 'Eingegangen über {source}, Nachricht {message}'),
 ('activity.receivedroutefrom', 'en', 'Received by {source} from {sender}, message {message}'),
 ('activity.receivedroutefrom', 'de', 'Eingegangen über {source} von {sender}, Nachricht {message}'),
 ('activity.receivedfile', 'en', 'Read from {file}'),
 ('activity.receivedfile', 'de', 'Gelesen aus {file}'),
 ('attachments.loading', 'en', 'Loading what was received…'),
 ('attachments.loading', 'de', 'Das Empfangene wird geladen…'),
 ('attachments.failed', 'en', 'The attachments could not be loaded.'),
 ('attachments.failed', 'de', 'Die Anhänge konnten nicht geladen werden.'),
 ('attachments.empty', 'en', 'Nothing received with this invoice is kept.'),
 ('attachments.empty', 'de', 'Zu dieser Rechnung ist nichts Empfangenes gespeichert.'),
 ('attachments.message', 'en', '{message} · {source} · {when}'),
 ('attachments.message', 'de', '{message} · {source} · {when}'),
 ('attachments.messagefrom', 'en', '{message} from {sender} · {source} · {when}'),
 ('attachments.messagefrom', 'de', '{message} von {sender} · {source} · {when}'),
 ('attachments.withinvoice', 'en', 'Kept with the invoice'),
 ('attachments.withinvoice', 'de', 'Mit der Rechnung gespeichert'),
 ('attachments.email', 'en', 'The email'),
 ('attachments.email', 'de', 'Die E-Mail'),
 ('attachments.embedded', 'en', 'The XML inside the PDF'),
 ('attachments.embedded', 'de', 'Das XML im PDF'),
 ('attachments.original', 'en', 'The original document'),
 ('attachments.original', 'de', 'Das Originaldokument'),
 ('attachments.thisinvoice', 'en', 'This invoice'),
 ('attachments.thisinvoice', 'de', 'Diese Rechnung'),
 ('attachments.choose', 'en', 'Choose a file to see it here.'),
 ('attachments.choose', 'de', 'Wählen Sie eine Datei, um sie hier zu sehen.'),
 ('attachments.downloadonly', 'en', 'This file is not shown here, to keep the page safe. Download it to open it.'),
 ('attachments.downloadonly', 'de', 'Diese Datei wird hier nicht angezeigt, damit die Seite sicher bleibt. Laden Sie sie herunter, um sie zu öffnen.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('viewer.attachmentstab','activity.receivedroute','activity.receivedroutefrom','activity.receivedfile','attachments.loading','attachments.failed','attachments.empty','attachments.message','attachments.messagefrom','attachments.withinvoice','attachments.email','attachments.embedded','attachments.original','attachments.thisinvoice','attachments.choose','attachments.downloadonly') == 32
