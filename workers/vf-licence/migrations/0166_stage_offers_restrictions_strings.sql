-- 0166_stage_offers_restrictions_strings.sql
-- Decision 0485 — which stages the Stage Restrictions tab (decision
-- 0483) even offers Account Coding checkboxes for.
--
-- Reported live, testing 0483: Intake ("only used transitionary so
-- that invoices can be extracted from a source") and Payment Eligible
-- ("another queue pending delivery to the ERP and cannot be retrieved
-- from") both showed a checkbox, though neither stage can ever have a
-- person keying a line. Approval and AP Review are the opposite case —
-- restricting there is a real business decision (segregation of
-- duties; coding should be locked once approved) — so this is an
-- explicit per-stage flag an operator sets once (migration 0081),
-- rather than the screen guessing from the stage's name or rule set.
--
-- Two new strings: the toggle itself, offered on every panel, and the
-- explanation shown in its place once a stage is turned off.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('apsetup.stagerestrictions.offerhere', 'en', 'Offer Account Coding restrictions for this stage'),
 ('apsetup.stagerestrictions.notoffered', 'en', 'Not configurable here — this stage is not one where a person keys Account Coding, so there is nothing to restrict.');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('apsetup.stagerestrictions.offerhere', 'de', 'Kontierungsbeschränkungen für diese Phase anbieten'),
 ('apsetup.stagerestrictions.notoffered', 'de', 'Hier nicht konfigurierbar — in dieser Phase wird keine Kontierung von Hand erfasst, es gibt also nichts einzuschränken.');

-- Point-in-time: both new keys exist in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('apsetup.stagerestrictions.offerhere','apsetup.stagerestrictions.notoffered') == 4
