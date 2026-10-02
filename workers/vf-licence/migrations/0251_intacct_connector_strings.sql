-- 0251_intacct_connector_strings.sql
-- Decision 0607. Sage Intacct: an OAuth user name, and look-up lists a customer leaves empty.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('httpsout.oauthusername', 'en', 'User name'),
 ('httpsout.oauthusername', 'de', 'Benutzername'),
 ('httpsout.oauthusernamehint', 'en', 'Only where the token address asks for one, as Sage Intacct does for its web services user (user@company).'),
 ('httpsout.oauthusernamehint', 'de', 'Nur wenn die Token-Adresse einen verlangt, wie Sage Intacct für seinen Webservice-Benutzer (benutzer@firma).'),
 ('mapping.lookup.unless_empty', 'en', 'unless the list is empty'),
 ('mapping.lookup.unless_empty', 'de', 'außer die Liste ist leer');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('httpsout.oauthusername','httpsout.oauthusernamehint','mapping.lookup.unless_empty') == 6
