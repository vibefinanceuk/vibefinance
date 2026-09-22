-- 0148_coding_list_csv_strings.sql
--
-- Decision 0445 — CSV Template and Load, for Cost Centre, Project,
-- Commodity Code, and General Ledger Code (not Company code). See
-- workers/vf-app/src/coding-list-csv-route.ts for the routes this
-- screen calls.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('apsetup.csvloadheading', 'en', 'Load from file'),
 ('apsetup.csvloadhelp', 'en', 'Load entries from a CSV export — an id already on file is updated, a new id is created, and an id not in the file is left alone.'),
 ('apsetup.csvloadbutton', 'en', 'Load'),
 ('apsetup.csvtemplatebutton', 'en', 'Template'),
 ('apsetup.csvnofile', 'en', 'Choose a file first.'),
 ('apsetup.csvloadfailed', 'en', 'Could not reach the server. Try again.'),
 ('apsetup.csvloadbroke', 'en', 'Something went wrong after the file loaded:'),
 ('apsetup.csventriescreated', 'en', '{n} entries created'),
 ('apsetup.csventriesupdated', 'en', '{n} entries updated'),
 ('apsetup.csvrefusedheading', 'en', 'Not loaded'),
 ('apsetup.csvrefusedentry', 'en', '{id}: {reason}'),
 ('apsetup.csvrefusedmore', 'en', '+{n} more'),
 ('apsetup.csvviewformat', 'en', 'View CSV format'),
 ('apsetup.csvfieldname', 'en', 'Field'),
 ('apsetup.csvacceptedcolumns', 'en', 'Accepted columns'),
 ('apsetup.csvrequired', 'en', 'Required');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('apsetup.csvloadheading', 'de', 'Aus Datei laden'),
 ('apsetup.csvloadhelp', 'de', 'Einträge aus einem CSV-Export laden — eine bereits vorhandene ID wird aktualisiert, eine neue ID wird angelegt, und eine ID, die nicht in der Datei enthalten ist, bleibt unverändert.'),
 ('apsetup.csvloadbutton', 'de', 'Laden'),
 ('apsetup.csvtemplatebutton', 'de', 'Vorlage'),
 ('apsetup.csvnofile', 'de', 'Bitte zuerst eine Datei auswählen.'),
 ('apsetup.csvloadfailed', 'de', 'Der Server konnte nicht erreicht werden. Bitte erneut versuchen.'),
 ('apsetup.csvloadbroke', 'de', 'Nach dem Laden der Datei ist etwas schiefgelaufen:'),
 ('apsetup.csventriescreated', 'de', '{n} Einträge angelegt'),
 ('apsetup.csventriesupdated', 'de', '{n} Einträge aktualisiert'),
 ('apsetup.csvrefusedheading', 'de', 'Nicht geladen'),
 ('apsetup.csvrefusedentry', 'de', '{id}: {reason}'),
 ('apsetup.csvrefusedmore', 'de', '+{n} weitere'),
 ('apsetup.csvviewformat', 'de', 'CSV-Format anzeigen'),
 ('apsetup.csvfieldname', 'de', 'Feld'),
 ('apsetup.csvacceptedcolumns', 'de', 'Akzeptierte Spalten'),
 ('apsetup.csvrequired', 'de', 'Pflichtfeld');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('apsetup.csvloadheading','apsetup.csvloadhelp','apsetup.csvloadbutton','apsetup.csvtemplatebutton','apsetup.csvnofile','apsetup.csvloadfailed','apsetup.csvloadbroke','apsetup.csventriescreated','apsetup.csventriesupdated','apsetup.csvrefusedheading','apsetup.csvrefusedentry','apsetup.csvrefusedmore','apsetup.csvviewformat','apsetup.csvfieldname','apsetup.csvacceptedcolumns','apsetup.csvrequired') == 32
