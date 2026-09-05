-- 0020_remaining_field_labels.sql
-- Decision 0107 — every field the vocabulary declares now has a label.
--
-- **Reported from a live screen for the second time**: fields reading
-- `field.bt-34`, `field.bt-27`, `field.bt-49`. Nineteen were missing,
-- not the eight visible — the rest are hidden by default and would have
-- appeared the moment somebody configured them.
--
-- `string-coverage.test.ts` should have caught this and did not,
-- because its key list is maintained by hand and decisions 0110, 0112
-- and 0114 added fields to the screen without adding them to it. That
-- test now derives the field labels from the vocabulary instead, so a
-- new field cannot be declared without a label being demanded.
--
-- The words are the specification's own business term names, shortened
-- only where a label has no room.
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-3', 'en', 'Invoice type');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-9', 'en', 'Due date');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-10', 'en', 'Buyer reference');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-13', 'en', 'Purchase order');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-23', 'en', 'Business process');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-24', 'en', 'Specification');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-27', 'en', 'Seller name');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-34', 'en', 'Seller electronic address');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-40', 'en', 'Seller country');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-44', 'en', 'Buyer name');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-48', 'en', 'Buyer VAT id');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-49', 'en', 'Buyer electronic address');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-55', 'en', 'Buyer country');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-109', 'en', 'Total without VAT');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-133', 'en', 'Cost centre');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-151', 'en', 'VAT category');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-152', 'en', 'VAT rate');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bg-20', 'en', 'Allowances');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bg-21', 'en', 'Charges');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-3', 'de', 'Rechnungsart');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-9', 'de', 'Fälligkeitsdatum');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-10', 'de', 'Referenz des Käufers');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-13', 'de', 'Bestellnummer');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-23', 'de', 'Geschäftsprozess');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-24', 'de', 'Spezifikation');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-27', 'de', 'Name des Verkäufers');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-34', 'de', 'Elektronische Adresse des Verkäufers');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-40', 'de', 'Land des Verkäufers');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-44', 'de', 'Name des Käufers');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-48', 'de', 'USt-IdNr. des Käufers');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-49', 'de', 'Elektronische Adresse des Käufers');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-55', 'de', 'Land des Käufers');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-109', 'de', 'Betrag ohne Steuer');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-133', 'de', 'Kostenstelle');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-151', 'de', 'Steuerkategorie');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bt-152', 'de', 'Steuersatz');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bg-20', 'de', 'Nachlässe');
INSERT INTO ui_strings (key, locale, value) VALUES ('field.bg-21', 'de', 'Zuschläge');

-- Point-in-time: every declared field now has an English label.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key LIKE 'field.%' AND locale = 'en' == 36
