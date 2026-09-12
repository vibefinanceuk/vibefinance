-- 0082_xml_tab.sql
--
-- Decision 0273 — a third tab, "XML," beside Document and
-- Timeline / Chat: "include after document, the original XML
-- document in another tab (if it exists)."
INSERT INTO ui_strings (key, locale, value) VALUES
 ('viewer.xmltab', 'en', 'XML');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('viewer.xmltab', 'de', 'XML');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'viewer.xmltab' == 2
