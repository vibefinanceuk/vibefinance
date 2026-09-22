-- 0145_ap_setup_strings.sql
--
-- Decision 0440 — "AP Setup," the new nav section the operator asked
-- for directly: "Under a new side menu option, I would like to
-- establish AP Configuration options... Matching, Account Coding and
-- Approval Hierarchy setup screens in tabs." Matching and Account
-- Coding are real placeholder tabs (decision 0439's own "What is not
-- built" — both are genuinely greenfield); Approval Hierarchy is live,
-- built on the migration and resolver decision 0439 already shipped.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('nav.apsetup', 'en', 'AP Setup'),
 ('apsetup.subtitle', 'en', 'How invoices are matched, coded and approved'),
 ('apsetup.matching', 'en', 'Matching'),
 ('apsetup.coding', 'en', 'Account Coding'),
 ('apsetup.approvalhierarchy', 'en', 'Approval Hierarchy'),
 ('apsetup.notbuilt', 'en', 'Not built yet'),
 ('apsetup.loadfailed', 'en', 'AP Setup could not be loaded'),
 ('apsetup.mode', 'en', 'Approval mode'),
 ('apsetup.mode.employee_supervisor', 'en', 'Employee-Supervisor'),
 ('apsetup.mode.cost_object', 'en', 'Cost-Object'),
 ('apsetup.mode.manual', 'en', 'Manual'),
 ('apsetup.mode.api', 'en', 'API'),
 ('apsetup.defaultapprover', 'en', 'Default Approver'),
 ('apsetup.defaultapprovernone', 'en', 'None set'),
 ('apsetup.modesub', 'en', 'Applies customer-wide, only once Validation, Matching and Coding are complete. The Default Approver catches a routing gap — a missing supervisor or cost centre owner.'),
 ('apsetup.savemodefailed', 'en', 'Could not save the approval mode'),
 ('apsetup.supervisoroverrides', 'en', 'Supervisor overrides'),
 ('apsetup.supervisoroverridessub', 'en', 'A person''s supervisor, specific to one org — overrides their group-wide manager for Employee-Supervisor routing there'),
 ('apsetup.nosupervisoroverrides', 'en', 'No supervisor overrides configured'),
 ('apsetup.reportsto', 'en', 'reports to'),
 ('apsetup.limitoverrides', 'en', 'Approval limit overrides'),
 ('apsetup.limitoverridessub', 'en', 'A person''s approval limit, specific to one org and one currency — overrides their group-wide limit there'),
 ('apsetup.nolimitoverrides', 'en', 'No approval limit overrides configured'),
 ('apsetup.overridesavefailed', 'en', 'Could not save that override'),
 ('apsetup.add', 'en', 'Add'),
 ('apsetup.person', 'en', 'Person'),
 ('apsetup.supervisor', 'en', 'Supervisor'),
 ('apsetup.limitcurrency', 'en', 'Currency'),
 ('apsetup.limitamount', 'en', 'Amount');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('nav.apsetup', 'de', 'AP-Einrichtung'),
 ('apsetup.subtitle', 'de', 'Wie Rechnungen abgeglichen, kontiert und genehmigt werden'),
 ('apsetup.matching', 'de', 'Abgleich'),
 ('apsetup.coding', 'de', 'Kontierung'),
 ('apsetup.approvalhierarchy', 'de', 'Genehmigungshierarchie'),
 ('apsetup.notbuilt', 'de', 'Noch nicht verfügbar'),
 ('apsetup.loadfailed', 'de', 'AP-Einrichtung konnte nicht geladen werden'),
 ('apsetup.mode', 'de', 'Genehmigungsmodus'),
 ('apsetup.mode.employee_supervisor', 'de', 'Mitarbeiter-Vorgesetzter'),
 ('apsetup.mode.cost_object', 'de', 'Kostenobjekt'),
 ('apsetup.mode.manual', 'de', 'Manuell'),
 ('apsetup.mode.api', 'de', 'API'),
 ('apsetup.defaultapprover', 'de', 'Standard-Genehmiger'),
 ('apsetup.defaultapprovernone', 'de', 'Nicht festgelegt'),
 ('apsetup.modesub', 'de', 'Gilt kundenweit, erst sobald Validierung, Abgleich und Kontierung abgeschlossen sind. Der Standard-Genehmiger fängt eine Weiterleitungslücke ab — einen fehlenden Vorgesetzten oder Kostenstelleninhaber.'),
 ('apsetup.savemodefailed', 'de', 'Genehmigungsmodus konnte nicht gespeichert werden'),
 ('apsetup.supervisoroverrides', 'de', 'Vorgesetzten-Ausnahmen'),
 ('apsetup.supervisoroverridessub', 'de', 'Der Vorgesetzte einer Person, spezifisch für eine Organisation — überschreibt dort den unternehmensweiten Vorgesetzten für die Mitarbeiter-Vorgesetzter-Weiterleitung'),
 ('apsetup.nosupervisoroverrides', 'de', 'Keine Vorgesetzten-Ausnahmen konfiguriert'),
 ('apsetup.reportsto', 'de', 'berichtet an'),
 ('apsetup.limitoverrides', 'de', 'Genehmigungslimit-Ausnahmen'),
 ('apsetup.limitoverridessub', 'de', 'Das Genehmigungslimit einer Person, spezifisch für eine Organisation und eine Währung — überschreibt dort das unternehmensweite Limit'),
 ('apsetup.nolimitoverrides', 'de', 'Keine Genehmigungslimit-Ausnahmen konfiguriert'),
 ('apsetup.overridesavefailed', 'de', 'Diese Ausnahme konnte nicht gespeichert werden'),
 ('apsetup.add', 'de', 'Hinzufügen'),
 ('apsetup.person', 'de', 'Person'),
 ('apsetup.supervisor', 'de', 'Vorgesetzter'),
 ('apsetup.limitcurrency', 'de', 'Währung'),
 ('apsetup.limitamount', 'de', 'Betrag');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('nav.apsetup','apsetup.subtitle','apsetup.matching','apsetup.coding','apsetup.approvalhierarchy','apsetup.notbuilt','apsetup.loadfailed','apsetup.mode','apsetup.mode.employee_supervisor','apsetup.mode.cost_object','apsetup.mode.manual','apsetup.mode.api','apsetup.defaultapprover','apsetup.defaultapprovernone','apsetup.modesub','apsetup.savemodefailed','apsetup.supervisoroverrides','apsetup.supervisoroverridessub','apsetup.nosupervisoroverrides','apsetup.reportsto','apsetup.limitoverrides','apsetup.limitoverridessub','apsetup.nolimitoverrides','apsetup.overridesavefailed','apsetup.add','apsetup.person','apsetup.supervisor','apsetup.limitcurrency','apsetup.limitamount') == 58
