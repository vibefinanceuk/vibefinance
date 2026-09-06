-- 0028_source_outcome_strings.sql
-- Decision 0132 — what happened to a source, in the reader's language.
--
-- These were English sentences written in the API and shown verbatim,
-- so a German customer read them in English — exactly what decision
-- 0107 exists to prevent, in an interface translated since.
--
-- **And the tone was wrong**: "so it is simply gone" explains our
-- reasoning where a person wants the outcome. Each of these states what
-- happened, then why, in that order.
INSERT INTO ui_strings (key, locale, value) VALUES ('outcome.never_used', 'en', 'Source deleted. Nothing had been received through it.');
INSERT INTO ui_strings (key, locale, value) VALUES ('outcome.documents_arrived', 'en', 'Source retired. Invoices received through it retain its name, so the record is kept.');
INSERT INTO ui_strings (key, locale, value) VALUES ('outcome.address_issued', 'en', 'Source retired. An email address was issued for it, so the record is kept.');
INSERT INTO ui_strings (key, locale, value) VALUES ('outcome.address_taken', 'en', 'That name produces an address already in use. Choose a different name.');
INSERT INTO ui_strings (key, locale, value) VALUES ('outcome.name_unusable', 'en', 'That name cannot form an email address. Rename the source, then create the address.');
INSERT INTO ui_strings (key, locale, value) VALUES ('outcome.not_routed_yet', 'en', 'Address reserved. Delivery is not yet active.');

INSERT INTO ui_strings (key, locale, value) VALUES ('outcome.never_used', 'de', 'Quelle gelöscht. Es wurde nichts darüber empfangen.');
INSERT INTO ui_strings (key, locale, value) VALUES ('outcome.documents_arrived', 'de', 'Quelle stillgelegt. Empfangene Rechnungen tragen ihren Namen, daher bleibt der Eintrag erhalten.');
INSERT INTO ui_strings (key, locale, value) VALUES ('outcome.address_issued', 'de', 'Quelle stillgelegt. Für sie wurde eine E-Mail-Adresse vergeben, daher bleibt der Eintrag erhalten.');
INSERT INTO ui_strings (key, locale, value) VALUES ('outcome.address_taken', 'de', 'Dieser Name ergibt eine bereits vergebene Adresse. Bitte einen anderen Namen wählen.');
INSERT INTO ui_strings (key, locale, value) VALUES ('outcome.name_unusable', 'de', 'Aus diesem Namen lässt sich keine E-Mail-Adresse bilden. Bitte die Quelle umbenennen.');
INSERT INTO ui_strings (key, locale, value) VALUES ('outcome.not_routed_yet', 'de', 'Adresse reserviert. Die Zustellung ist noch nicht aktiv.');

-- Point-in-time: every outcome has words in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key LIKE 'outcome.%' == 12
