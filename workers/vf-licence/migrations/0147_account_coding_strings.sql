-- 0147_account_coding_strings.sql
--
-- Decision 0444 — Account Coding, AP Setup's third tab, now real:
-- Company code, Cost Centre, Project, Commodity Code, and General
-- Ledger Code. See migrations/0076_account_coding_lists.sql (vf-app)
-- for the schema this screen manages.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('apsetup.codingtab.companycode', 'en', 'Company code'),
 ('apsetup.codingtab.costcentre', 'en', 'Cost Centre'),
 ('apsetup.codingtab.project', 'en', 'Project'),
 ('apsetup.codingtab.commoditycode', 'en', 'Commodity Code'),
 ('apsetup.codingtab.glcode', 'en', 'General Ledger Code'),
 ('apsetup.codingcompanycodesub', 'en', 'Managed under Access → Org Units. Shown here for reference only.'),
 ('apsetup.codingcostcentresub', 'en', 'A company-wide financial construct, used by Cost-Object approval routing. Not scoped to any one process.'),
 ('apsetup.codingprojectsub', 'en', 'A manageable list only — not enforced against rule values or invoice lines.'),
 ('apsetup.codingcommoditycodesub', 'en', 'A manageable list only — not enforced against rule values or invoice lines.'),
 ('apsetup.codingglcodesub', 'en', 'A manageable list only — not enforced against rule values or invoice lines.'),
 ('apsetup.nocompanycodes', 'en', 'No company codes configured yet.'),
 ('apsetup.nocostcentres', 'en', 'No cost centres configured yet.'),
 ('apsetup.noprojects', 'en', 'No projects configured yet.'),
 ('apsetup.nocommoditycodes', 'en', 'No commodity codes configured yet.'),
 ('apsetup.noglcodes', 'en', 'No general ledger codes configured yet.'),
 ('apsetup.codingid', 'en', 'ID'),
 ('apsetup.codingname', 'en', 'Name'),
 ('apsetup.codingparent', 'en', 'Parent'),
 ('apsetup.codingdefault', 'en', 'Default'),
 ('apsetup.codingapprover', 'en', 'Approver'),
 ('apsetup.codingapprovallimit', 'en', 'Approval limit'),
 ('apsetup.codingentrysavefailed', 'en', 'Could not save that. Check the values and try again.');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('apsetup.codingtab.companycode', 'de', 'Buchungskreis'),
 ('apsetup.codingtab.costcentre', 'de', 'Kostenstelle'),
 ('apsetup.codingtab.project', 'de', 'Projekt'),
 ('apsetup.codingtab.commoditycode', 'de', 'Warengruppe'),
 ('apsetup.codingtab.glcode', 'de', 'Sachkonto'),
 ('apsetup.codingcompanycodesub', 'de', 'Verwaltet unter Zugriff → Organisationseinheiten. Hier nur zur Referenz.'),
 ('apsetup.codingcostcentresub', 'de', 'Eine unternehmensweite Finanzstruktur, verwendet für die Freigaberoutenführung im Modus Kostenobjekt. Nicht auf einen bestimmten Prozess beschränkt.'),
 ('apsetup.codingprojectsub', 'de', 'Nur eine verwaltbare Liste — wird nicht gegen Regelwerte oder Rechnungspositionen durchgesetzt.'),
 ('apsetup.codingcommoditycodesub', 'de', 'Nur eine verwaltbare Liste — wird nicht gegen Regelwerte oder Rechnungspositionen durchgesetzt.'),
 ('apsetup.codingglcodesub', 'de', 'Nur eine verwaltbare Liste — wird nicht gegen Regelwerte oder Rechnungspositionen durchgesetzt.'),
 ('apsetup.nocompanycodes', 'de', 'Noch keine Buchungskreise konfiguriert.'),
 ('apsetup.nocostcentres', 'de', 'Noch keine Kostenstellen konfiguriert.'),
 ('apsetup.noprojects', 'de', 'Noch keine Projekte konfiguriert.'),
 ('apsetup.nocommoditycodes', 'de', 'Noch keine Warengruppen konfiguriert.'),
 ('apsetup.noglcodes', 'de', 'Noch keine Sachkonten konfiguriert.'),
 ('apsetup.codingid', 'de', 'ID'),
 ('apsetup.codingname', 'de', 'Name'),
 ('apsetup.codingparent', 'de', 'Übergeordnet'),
 ('apsetup.codingdefault', 'de', 'Standard'),
 ('apsetup.codingapprover', 'de', 'Genehmiger'),
 ('apsetup.codingapprovallimit', 'de', 'Freigabelimit'),
 ('apsetup.codingentrysavefailed', 'de', 'Das konnte nicht gespeichert werden. Bitte Werte prüfen und erneut versuchen.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('apsetup.codingtab.companycode','apsetup.codingtab.costcentre','apsetup.codingtab.project','apsetup.codingtab.commoditycode','apsetup.codingtab.glcode','apsetup.codingcompanycodesub','apsetup.codingcostcentresub','apsetup.codingprojectsub','apsetup.codingcommoditycodesub','apsetup.codingglcodesub','apsetup.nocompanycodes','apsetup.nocostcentres','apsetup.noprojects','apsetup.nocommoditycodes','apsetup.noglcodes','apsetup.codingid','apsetup.codingname','apsetup.codingparent','apsetup.codingdefault','apsetup.codingapprover','apsetup.codingapprovallimit','apsetup.codingentrysavefailed') == 44
