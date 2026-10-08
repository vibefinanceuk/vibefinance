-- 0306_email_size_limit_strings.sql
-- Decision 0691 — an Email source's size limit and what a sender is told.
-- `email.reject.toolarge` is the default message, edited here in Interface
-- wording; a source's own message overrides it. {size} and {limit} are
-- filled in, in megabytes.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('email.reject.toolarge', 'en', 'Thank you for your email. We could not process it because it is {size} MB, larger than the {limit} MB this address accepts. Please send it again as smaller emails, for example one invoice per email.'),
 ('email.reject.toolarge', 'de', 'Vielen Dank für Ihre E-Mail. Wir konnten sie nicht verarbeiten, da sie {size} MB groß ist und diese Adresse höchstens {limit} MB annimmt. Bitte senden Sie sie erneut in kleineren E-Mails, zum Beispiel eine Rechnung pro E-Mail.'),
 ('processroutes.field.maxemail', 'en', 'Largest email'),
 ('processroutes.field.maxemail', 'de', 'Größte E-Mail'),
 ('processroutes.maxemail.help', 'en', 'In MB, up to 25. Larger emails are returned to the sender with the message below. Blank uses the default, {n} MB.'),
 ('processroutes.maxemail.help', 'de', 'In MB, höchstens 25. Größere E-Mails gehen mit der Nachricht unten an den Absender zurück. Leer bedeutet den Standard, {n} MB.'),
 ('processroutes.field.rejectmsg', 'en', 'Message when too large'),
 ('processroutes.field.rejectmsg', 'de', 'Nachricht bei zu großer E-Mail'),
 ('processroutes.rejectmsg.help', 'en', 'Blank uses the default message, set in Interface wording. {size} and {limit} are filled in.'),
 ('processroutes.rejectmsg.help', 'de', 'Leer bedeutet die Standardnachricht aus den Oberflächentexten. {size} und {limit} werden ausgefüllt.'),
 ('processroutes.emaillimit.saved', 'en', 'Saved.'),
 ('processroutes.emaillimit.saved', 'de', 'Gespeichert.'),
 ('processroutes.emaillimit.failed', 'en', 'That could not be saved: the limit must be a whole number from 1 to 25, and the message at most 500 characters.'),
 ('processroutes.emaillimit.failed', 'de', 'Das konnte nicht gespeichert werden: Die Grenze muss eine ganze Zahl von 1 bis 25 sein und die Nachricht höchstens 500 Zeichen lang.'),
 ('routemonitor.error.too_large.title', 'en', 'The email was too large'),
 ('routemonitor.error.too_large.title', 'de', 'Die E-Mail war zu groß'),
 ('routemonitor.error.too_large.body', 'en', 'The email was larger than this source accepts, so it was refused as it arrived: nothing was stored or read. The sender''s mail system returned our message to them.'),
 ('routemonitor.error.too_large.body', 'de', 'Die E-Mail war größer, als diese Quelle annimmt, und wurde beim Eingang abgelehnt: Nichts wurde gespeichert oder gelesen. Das Mailsystem des Absenders hat ihm unsere Nachricht zurückgesandt.'),
 ('routemonitor.error.too_large.fix', 'en', 'ask the supplier to send smaller emails, or raise the limit on the source (Routes, the source''s panel).'),
 ('routemonitor.error.too_large.fix', 'de', 'Bitten Sie den Lieferanten um kleinere E-Mails, oder erhöhen Sie die Grenze an der Quelle (Routen, Bereich der Quelle).');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('email.reject.toolarge','processroutes.field.maxemail','processroutes.maxemail.help','processroutes.field.rejectmsg','processroutes.rejectmsg.help','processroutes.emaillimit.saved','processroutes.emaillimit.failed','routemonitor.error.too_large.title','routemonitor.error.too_large.body','routemonitor.error.too_large.fix') == 20
