-- 0250_sap_connector_strings.sql
-- Decision 0606. SAP S/4HANA Cloud: a CSRF token first, and OData's dates and amounts.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('httpsout.csrf', 'en', 'Fetch a CSRF token first'),
 ('httpsout.csrf', 'de', 'Zuerst ein CSRF-Token abrufen'),
 ('httpsout.csrfhint', 'en', 'SAP''s OData services need it: before each invoice, the service gives a token and session cookies, which are sent with it.'),
 ('httpsout.csrfhint', 'de', 'Die OData-Services von SAP verlangen es: Vor jeder Rechnung liefert der Service ein Token und Sitzungs-Cookies, die mitgesendet werden.'),
 ('mapping.fn.odata_date', 'en', 'OData date'),
 ('mapping.fn.odata_date', 'de', 'OData-Datum'),
 ('mapping.fn.decimal_text', 'en', 'Amount as text'),
 ('mapping.fn.decimal_text', 'de', 'Betrag als Text'),
 ('mapping.fn.pad', 'en', 'Pad with zeros'),
 ('mapping.fn.pad', 'de', 'Mit Nullen auffüllen'),
 ('outmap.src.senton', 'en', 'Day it is sent'),
 ('outmap.src.senton', 'de', 'Tag des Versands');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('httpsout.csrf','httpsout.csrfhint','mapping.fn.odata_date','mapping.fn.decimal_text','mapping.fn.pad','outmap.src.senton') == 12
