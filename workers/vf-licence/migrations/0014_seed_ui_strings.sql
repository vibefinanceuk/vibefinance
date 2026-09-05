-- 0014_seed_ui_strings.sql
-- Decision 0107 — the interface's words, in English and German.
--
-- **English is complete and is the fallback** (decision 0008). German
-- is here to prove the mechanism carries more than one language rather
-- than to be exhaustive: a scheme tested only in its fallback is a
-- scheme that has never been used.
--
-- Separated from the table's own migration so that adding a language,
-- or fixing a wording, is its own reviewable change rather than an edit
-- to a schema that was already applied.

INSERT INTO ui_strings (key, locale, value) VALUES ('signin.title', 'en', 'Sign in to continue');
INSERT INTO ui_strings (key, locale, value) VALUES ('signin.email', 'en', 'Email');
INSERT INTO ui_strings (key, locale, value) VALUES ('signin.password', 'en', 'Password');
INSERT INTO ui_strings (key, locale, value) VALUES ('signin.environment', 'en', 'Environment');
INSERT INTO ui_strings (key, locale, value) VALUES ('signin.choose', 'en', 'Sign in to choose');
INSERT INTO ui_strings (key, locale, value) VALUES ('signin.continue', 'en', 'Continue');
INSERT INTO ui_strings (key, locale, value) VALUES ('signin.failed', 'en', 'Sign-in failed');
INSERT INTO ui_strings (key, locale, value) VALUES ('signin.unreachable', 'en', 'Could not reach the sign-in service.');
INSERT INTO ui_strings (key, locale, value) VALUES ('signin.noaccess', 'en', 'You have no instances to sign in to. An administrator can grant access.');
INSERT INTO ui_strings (key, locale, value) VALUES ('signin.first', 'en', 'Signed in. This is your first sign-in.');
INSERT INTO ui_strings (key, locale, value) VALUES ('tasks.signout', 'en', 'Sign out');
INSERT INTO ui_strings (key, locale, value) VALUES ('tasks.allstages', 'en', 'All stages');
INSERT INTO ui_strings (key, locale, value) VALUES ('tasks.everything', 'en', 'Everything');
INSERT INTO ui_strings (key, locale, value) VALUES ('tasks.mine', 'en', 'Mine');
INSERT INTO ui_strings (key, locale, value) VALUES ('tasks.available', 'en', 'Available');
INSERT INTO ui_strings (key, locale, value) VALUES ('tasks.locked', 'en', 'Held by others');
INSERT INTO ui_strings (key, locale, value) VALUES ('tasks.stage', 'en', 'Stage');
INSERT INTO ui_strings (key, locale, value) VALUES ('tasks.supplier', 'en', 'Supplier');
INSERT INTO ui_strings (key, locale, value) VALUES ('tasks.amount', 'en', 'Amount');
INSERT INTO ui_strings (key, locale, value) VALUES ('tasks.waiting', 'en', 'Waiting');
INSERT INTO ui_strings (key, locale, value) VALUES ('tasks.owner', 'en', 'Owner');
INSERT INTO ui_strings (key, locale, value) VALUES ('tasks.empty', 'en', 'Nothing here.');
INSERT INTO ui_strings (key, locale, value) VALUES ('tasks.notkeyed', 'en', 'Not yet keyed');
INSERT INTO ui_strings (key, locale, value) VALUES ('tasks.nodocument', 'en', 'No document');
INSERT INTO ui_strings (key, locale, value) VALUES ('tasks.loadfailed', 'en', 'Could not load your tasks.');
INSERT INTO ui_strings (key, locale, value) VALUES ('action.claim', 'en', 'Claim');
INSERT INTO ui_strings (key, locale, value) VALUES ('action.release', 'en', 'Release');
INSERT INTO ui_strings (key, locale, value) VALUES ('action.key', 'en', 'Key');
INSERT INTO ui_strings (key, locale, value) VALUES ('action.complete', 'en', 'Complete');
INSERT INTO ui_strings (key, locale, value) VALUES ('action.return', 'en', 'Return');
INSERT INTO ui_strings (key, locale, value) VALUES ('action.return_to_supplier', 'en', 'To supplier');
INSERT INTO ui_strings (key, locale, value) VALUES ('action.discard', 'en', 'Discard');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.title', 'en', 'Key from document');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.back', 'en', 'Back to tasks');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.open', 'en', 'Open in new window');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.document', 'en', 'Document');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.save', 'en', 'Save keyed values');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.nodocument', 'en', 'No document is retained for this invoice.');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.nothing', 'en', 'Nothing to save — key at least one field.');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.saved', 'en', 'Saved.');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.savefailed', 'en', 'Could not save.');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-1', 'en', 'Invoice number');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-2', 'en', 'Issue date');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-31', 'en', 'Supplier VAT');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-5', 'en', 'Currency');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-106', 'en', 'Net before VAT');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-110', 'en', 'VAT amount');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-112', 'en', 'Total with VAT');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-115', 'en', 'Amount due');
INSERT INTO ui_strings (key, locale, value) VALUES ('signin.title', 'de', 'Anmelden, um fortzufahren');
INSERT INTO ui_strings (key, locale, value) VALUES ('signin.email', 'de', 'E-Mail');
INSERT INTO ui_strings (key, locale, value) VALUES ('signin.password', 'de', 'Passwort');
INSERT INTO ui_strings (key, locale, value) VALUES ('signin.environment', 'de', 'Umgebung');
INSERT INTO ui_strings (key, locale, value) VALUES ('signin.choose', 'de', 'Zur Auswahl anmelden');
INSERT INTO ui_strings (key, locale, value) VALUES ('signin.continue', 'de', 'Weiter');
INSERT INTO ui_strings (key, locale, value) VALUES ('signin.failed', 'de', 'Anmeldung fehlgeschlagen');
INSERT INTO ui_strings (key, locale, value) VALUES ('signin.unreachable', 'de', 'Der Anmeldedienst ist nicht erreichbar.');
INSERT INTO ui_strings (key, locale, value) VALUES ('signin.noaccess', 'de', 'Sie haben keine Instanzen, bei denen Sie sich anmelden können. Ein Administrator kann Zugriff gewähren.');
INSERT INTO ui_strings (key, locale, value) VALUES ('signin.first', 'de', 'Angemeldet. Dies ist Ihre erste Anmeldung.');
INSERT INTO ui_strings (key, locale, value) VALUES ('tasks.signout', 'de', 'Abmelden');
INSERT INTO ui_strings (key, locale, value) VALUES ('tasks.allstages', 'de', 'Alle Phasen');
INSERT INTO ui_strings (key, locale, value) VALUES ('tasks.everything', 'de', 'Alles');
INSERT INTO ui_strings (key, locale, value) VALUES ('tasks.mine', 'de', 'Meine');
INSERT INTO ui_strings (key, locale, value) VALUES ('tasks.available', 'de', 'Verfügbar');
INSERT INTO ui_strings (key, locale, value) VALUES ('tasks.locked', 'de', 'Von anderen gehalten');
INSERT INTO ui_strings (key, locale, value) VALUES ('tasks.stage', 'de', 'Phase');
INSERT INTO ui_strings (key, locale, value) VALUES ('tasks.supplier', 'de', 'Lieferant');
INSERT INTO ui_strings (key, locale, value) VALUES ('tasks.amount', 'de', 'Betrag');
INSERT INTO ui_strings (key, locale, value) VALUES ('tasks.waiting', 'de', 'Wartend');
INSERT INTO ui_strings (key, locale, value) VALUES ('tasks.owner', 'de', 'Inhaber');
INSERT INTO ui_strings (key, locale, value) VALUES ('tasks.empty', 'de', 'Nichts vorhanden.');
INSERT INTO ui_strings (key, locale, value) VALUES ('tasks.notkeyed', 'de', 'Noch nicht erfasst');
INSERT INTO ui_strings (key, locale, value) VALUES ('tasks.nodocument', 'de', 'Kein Dokument');
INSERT INTO ui_strings (key, locale, value) VALUES ('tasks.loadfailed', 'de', 'Ihre Aufgaben konnten nicht geladen werden.');
INSERT INTO ui_strings (key, locale, value) VALUES ('action.claim', 'de', 'Übernehmen');
INSERT INTO ui_strings (key, locale, value) VALUES ('action.release', 'de', 'Freigeben');
INSERT INTO ui_strings (key, locale, value) VALUES ('action.key', 'de', 'Erfassen');
INSERT INTO ui_strings (key, locale, value) VALUES ('action.complete', 'de', 'Abschließen');
INSERT INTO ui_strings (key, locale, value) VALUES ('action.return', 'de', 'Zurücksenden');
INSERT INTO ui_strings (key, locale, value) VALUES ('action.return_to_supplier', 'de', 'An Lieferant');
INSERT INTO ui_strings (key, locale, value) VALUES ('action.discard', 'de', 'Verwerfen');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.title', 'de', 'Aus Dokument erfassen');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.back', 'de', 'Zurück zu den Aufgaben');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.open', 'de', 'In neuem Fenster öffnen');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.document', 'de', 'Dokument');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.save', 'de', 'Erfasste Werte speichern');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.nodocument', 'de', 'Für diese Rechnung ist kein Dokument gespeichert.');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.nothing', 'de', 'Nichts zu speichern – erfassen Sie mindestens ein Feld.');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.saved', 'de', 'Gespeichert.');
INSERT INTO ui_strings (key, locale, value) VALUES ('viewer.savefailed', 'de', 'Speichern nicht möglich.');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-1', 'de', 'Rechnungsnummer');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-2', 'de', 'Rechnungsdatum');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-31', 'de', 'USt-IdNr. des Lieferanten');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-5', 'de', 'Währung');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-106', 'de', 'Nettobetrag');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-110', 'de', 'Steuerbetrag');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-112', 'de', 'Bruttobetrag');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-115', 'de', 'Zahlbetrag');

-- Point-in-time: every key has English, and German is complete too.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE locale = 'en' == 49
-- ASSERT: SELECT count(*) FROM ui_strings WHERE locale = 'de' == 49
