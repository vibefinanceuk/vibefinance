-- 0029_release_address_strings.sql
-- Decision 0133 — asking before releasing an address.
--
-- **Only a person can know whether an address was shared.** It may sit
-- in a supplier's ERP, and nothing records that — so the question names
-- the address rather than describing it, because "an address will be
-- released" is not something anybody can check.
INSERT INTO ui_strings (key, locale, value) VALUES ('sources.confirmrelease', 'en', 'This source has an email address that has never received anything. Deleting it releases the address. If it has been given to a supplier, retire the source instead.');
INSERT INTO ui_strings (key, locale, value) VALUES ('outcome.address_released', 'en', 'Source deleted and its address released.');
INSERT INTO ui_strings (key, locale, value) VALUES ('outcome.address_would_be_released', 'en', 'Deleting this source would release its email address.');

INSERT INTO ui_strings (key, locale, value) VALUES ('sources.confirmrelease', 'de', 'Diese Quelle hat eine E-Mail-Adresse, über die nie etwas empfangen wurde. Beim Löschen wird die Adresse freigegeben. Wurde sie einem Lieferanten mitgeteilt, legen Sie die Quelle stattdessen still.');
INSERT INTO ui_strings (key, locale, value) VALUES ('outcome.address_released', 'de', 'Quelle gelöscht und Adresse freigegeben.');
INSERT INTO ui_strings (key, locale, value) VALUES ('outcome.address_would_be_released', 'de', 'Beim Löschen dieser Quelle würde ihre E-Mail-Adresse freigegeben.');

-- Point-in-time: all three exist in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('sources.confirmrelease','outcome.address_released','outcome.address_would_be_released') == 6
