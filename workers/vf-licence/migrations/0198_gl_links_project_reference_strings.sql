-- 0198_gl_links_project_reference_strings.sql
-- Decision 0543. GL codes a cost centre may be charged with (AP Setup,
-- and a save refused), and the invoice's own project reference (BT-11)
-- as a label and as the reason for a suggestion.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('field.bt-11', 'en', 'Project reference'),
 ('apsetup.codingglcodes', 'en', 'GL codes'),
 ('apsetup.codingglcodes.any', 'en', 'Any'),
 ('apsetup.codingglcodes.help', 'en', 'None chosen: any GL code can be used with this cost centre. Choose some and only those can be. Hold Ctrl or Cmd to choose several.'),
 ('viewer.coding.invalid.wrong_cost_centre', 'en', 'is not allowed for the line''s cost centre'),
 ('viewer.coding.sug.invoice', 'en', 'The invoice names project “{reference}”: {project}');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('field.bt-11', 'de', 'Projektreferenz'),
 ('apsetup.codingglcodes', 'de', 'Sachkonten'),
 ('apsetup.codingglcodes.any', 'de', 'Alle'),
 ('apsetup.codingglcodes.help', 'de', 'Keines gewählt: jedes Sachkonto ist mit dieser Kostenstelle möglich. Sind welche gewählt, nur diese. Mit Strg oder Cmd mehrere wählen.'),
 ('viewer.coding.invalid.wrong_cost_centre', 'de', 'ist für die Kostenstelle der Position nicht zugelassen'),
 ('viewer.coding.sug.invoice', 'de', 'Die Rechnung nennt das Projekt „{reference}“: {project}');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('field.bt-11', 'apsetup.codingglcodes', 'apsetup.codingglcodes.any', 'apsetup.codingglcodes.help', 'viewer.coding.invalid.wrong_cost_centre', 'viewer.coding.sug.invoice') == 12
