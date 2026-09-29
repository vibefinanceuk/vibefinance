-- 0202_supplier_project_only_strings.sql
-- Decision 0547. A supplier site whose spend is project-only
-- expenditure: the Suppliers screen's tick and its note, the Coding
-- pop-out's note, and the two reasons Complete gives.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('suppliers.projectonly', 'en', 'Project-only expenditure'),
 ('suppliers.projectonly', 'de', 'Nur Projektausgaben'),
 ('suppliers.projectonly.hint', 'en', 'Every line coded on this site''s invoices needs a project, never a cost centre. This is VibeFinance''s own setting: a supplier load leaves it as set here.'),
 ('suppliers.projectonly.hint', 'de', 'Jede kontierte Position auf Rechnungen dieses Standorts braucht ein Projekt, nie eine Kostenstelle. Dies ist eine Einstellung von VibeFinance: Ein Lieferantenimport lässt sie unverändert.'),
 ('suppliers.projectonly.short', 'en', 'Project only'),
 ('suppliers.projectonly.short', 'de', 'Nur Projekte'),
 ('viewer.coding.projectonly', 'en', 'This supplier''s spend is project-only: code the line to a project.'),
 ('viewer.coding.projectonly', 'de', 'Ausgaben bei diesem Lieferanten sind reine Projektausgaben: Kontieren Sie die Position auf ein Projekt.'),
 ('viewer.coding.projectonly.hascc', 'en', 'Choosing a project removes cost centre {cc}.'),
 ('viewer.coding.projectonly.hascc', 'de', 'Die Wahl eines Projekts entfernt die Kostenstelle {cc}.'),
 ('viewer.coding.invalid.project_required', 'en', 'is required: this supplier''s spend is project-only'),
 ('viewer.coding.invalid.project_required', 'de', 'ist erforderlich: Ausgaben bei diesem Lieferanten sind reine Projektausgaben'),
 ('viewer.coding.invalid.project_only', 'en', 'is not used for this supplier. Choose a project instead'),
 ('viewer.coding.invalid.project_only', 'de', 'wird bei diesem Lieferanten nicht verwendet. Wählen Sie stattdessen ein Projekt');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('suppliers.projectonly','suppliers.projectonly.hint','suppliers.projectonly.short','viewer.coding.projectonly','viewer.coding.projectonly.hascc','viewer.coding.invalid.project_required','viewer.coding.invalid.project_only') == 14
