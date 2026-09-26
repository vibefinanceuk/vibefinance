-- 0176_return_to_supplier_picker_strings.sql
-- Decision 0498 — Return To Supplier's own picker. Genuinely new keys
-- throughout, so every row is an INSERT, the same convention 0174/0175
-- both followed.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('action.return_to_supplier.nonefound', 'en', 'No active return reasons are configured — set one up under AP Setup first'),
 ('action.return_to_supplier.reasonlabel', 'en', 'Reason'),
 ('action.return_to_supplier.commentlabel', 'en', 'Comment for the supplier (optional)'),
 ('action.return_to_supplier.willgoto', 'en', 'This will be emailed to'),
 ('action.return_to_supplier.noemail', 'en', 'No email address on file for this supplier — the return will still go through, but nothing will be sent'),
 ('action.return_to_supplier.ccapteam', 'en', 'Copy the AP team');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('action.return_to_supplier.nonefound', 'de', 'Keine aktiven Rückgabegründe konfiguriert — bitte zuerst unter AP-Einrichtung anlegen'),
 ('action.return_to_supplier.reasonlabel', 'de', 'Grund'),
 ('action.return_to_supplier.commentlabel', 'de', 'Kommentar für den Lieferanten (optional)'),
 ('action.return_to_supplier.willgoto', 'de', 'Dies wird gesendet an'),
 ('action.return_to_supplier.noemail', 'de', 'Keine E-Mail-Adresse für diesen Lieferanten hinterlegt — die Rückgabe wird trotzdem durchgeführt, es wird jedoch nichts gesendet'),
 ('action.return_to_supplier.ccapteam', 'de', 'AP-Team in Kopie setzen');

-- The AP Setup admin tab — decision 0498's own point 1 and point 4
-- configuration screen.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('apsetup.returnreasons', 'en', 'Return Reasons'),
 ('apsetup.returnreasons.sub', 'en', 'The reasons available when returning an invoice to its supplier.'),
 ('apsetup.returnreasons.active', 'en', 'Active'),
 ('apsetup.returnreasons.newid', 'en', 'New reason id'),
 ('apsetup.returnreasons.newlabel', 'en', 'New reason label'),
 ('apsetup.returnreasons.idandlabelrequired', 'en', 'A reason id and label are both required'),
 ('apsetup.returnreasons.savefailed', 'en', 'That could not be saved'),
 ('apsetup.returnreasons.apteamemail', 'en', 'AP Team Email'),
 ('apsetup.returnreasons.apteamemailsub', 'en', 'Copied on a Return To Supplier email when the sender ticks the box. Leave blank to hide that option.'),
 ('apsetup.returnreasons.apteamemailplaceholder', 'en', 'ap-team@yourcompany.com');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('apsetup.returnreasons', 'de', 'Rückgabegründe'),
 ('apsetup.returnreasons.sub', 'de', 'Die Gründe, die bei der Rückgabe einer Rechnung an den Lieferanten zur Verfügung stehen.'),
 ('apsetup.returnreasons.active', 'de', 'Aktiv'),
 ('apsetup.returnreasons.newid', 'de', 'Neue Grund-ID'),
 ('apsetup.returnreasons.newlabel', 'de', 'Neue Grundbezeichnung'),
 ('apsetup.returnreasons.idandlabelrequired', 'de', 'Grund-ID und Bezeichnung sind beide erforderlich'),
 ('apsetup.returnreasons.savefailed', 'de', 'Das konnte nicht gespeichert werden'),
 ('apsetup.returnreasons.apteamemail', 'de', 'AP-Team-E-Mail'),
 ('apsetup.returnreasons.apteamemailsub', 'de', 'Wird bei einer Rückgabe an den Lieferanten in Kopie gesetzt, wenn die Person das Kästchen markiert. Leer lassen, um diese Option auszublenden.'),
 ('apsetup.returnreasons.apteamemailplaceholder', 'de', 'ap-team@ihrunternehmen.de');

-- The Timeline's own report of what happened to the email —
-- decision 0498's "full delivery/bounce tracking now."
INSERT INTO ui_strings (key, locale, value) VALUES
 ('activity.email.sent', 'en', 'Email sent to {to}'),
 ('activity.email.delivered', 'en', 'Email delivered to {to}'),
 ('activity.email.bounced', 'en', 'Email to {to} bounced'),
 ('activity.email.complained', 'en', '{to} marked this email as spam'),
 ('activity.email.delayed', 'en', 'Email to {to} is delayed'),
 ('activity.email.send_failed', 'en', 'Email could not be sent');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('activity.email.sent', 'de', 'E-Mail an {to} gesendet'),
 ('activity.email.delivered', 'de', 'E-Mail an {to} zugestellt'),
 ('activity.email.bounced', 'de', 'E-Mail an {to} konnte nicht zugestellt werden'),
 ('activity.email.complained', 'de', '{to} hat diese E-Mail als Spam markiert'),
 ('activity.email.delayed', 'de', 'E-Mail an {to} verzögert'),
 ('activity.email.send_failed', 'de', 'E-Mail konnte nicht gesendet werden');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key LIKE 'action.return_to_supplier.%' == 12
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key LIKE 'apsetup.returnreasons%' == 20
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key LIKE 'activity.email.%' == 12
