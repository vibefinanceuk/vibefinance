-- 0254_neutral_setting_hints.sql
-- Decision 0610. Dan, on the Business Central Destination: "The Dynamics
-- connector should not mention other ERPs." The two optional settings'
-- hints say what each does without naming an ERP, and a Destination shows
-- them only where its connector uses them.

UPDATE ui_strings SET value = 'Some services refuse a change without a security token: before each invoice, one is fetched from the service with its session cookies, and sent with the invoice.' WHERE key = 'httpsout.csrfhint' AND locale = 'en';
UPDATE ui_strings SET value = 'Manche Services lehnen eine Änderung ohne Sicherheitstoken ab: Vor jeder Rechnung wird eines mit den Sitzungs-Cookies vom Service abgerufen und mit der Rechnung gesendet.' WHERE key = 'httpsout.csrfhint' AND locale = 'de';
UPDATE ui_strings SET value = 'Only where the token address asks for one, in the form it gives (such as user@company).' WHERE key = 'httpsout.oauthusernamehint' AND locale = 'en';
UPDATE ui_strings SET value = 'Nur wenn die Token-Adresse einen verlangt, in der dort genannten Form (etwa benutzer@firma).' WHERE key = 'httpsout.oauthusernamehint' AND locale = 'de';

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('httpsout.csrfhint', 'httpsout.oauthusernamehint') AND (value LIKE '%SAP%' OR value LIKE '%Intacct%') == 0
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('httpsout.csrfhint', 'httpsout.oauthusernamehint') == 4
