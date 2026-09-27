-- 0181_approval_mode_definitions.sql
-- Decision 0516. The operator's own definition of each Approval
-- Hierarchy mode, shown under AP Setup's mode picker with the selected
-- one highlighted. The English text is the operator's wording, with
-- "third part" corrected to "third-party". Two labels are renamed to
-- the operator's headings: "Organisational Approval (Employee
-- Supervisor)" and "Cost Object".
--
-- No value contains `;` (test/setup.ts's splitter, decision 0445).

INSERT INTO ui_strings (key, locale, value) VALUES
 ('apsetup.modedef.manual', 'en', 'The user submitting this for approval can freely select among users in the company. The selected user needs approval limit to approve the document, and if that is not the case the selected user needs to select freely among the users in the company.'),
 ('apsetup.modedef.cost_object', 'en', 'A task is created to the cost object owner for each different cost object identified at invoice line level. The cost object owner of each entry is maintained in the coding lists. The invoice will stay in the Approval stage until all Cost Object approvals are obtained.'),
 ('apsetup.modedef.employee_supervisor', 'en', 'Proceed up the chain of command of the user step by step until a user with appropriate approval limit approves the document.'),
 ('apsetup.modedef.api', 'en', 'Wait for an external source to command the next assignment. The document will be tagged with awaiting_approval_api and will wait for a command via API. An API is exposed for a third-party application to evaluate and trigger routing to an approver.');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('apsetup.modedef.manual', 'de', 'Wer das Dokument zur Genehmigung einreicht, kann frei unter den Benutzern des Unternehmens wählen. Der gewählte Benutzer braucht ein ausreichendes Genehmigungslimit, um das Dokument zu genehmigen. Ist das nicht der Fall, wählt der gewählte Benutzer seinerseits frei unter den Benutzern des Unternehmens.'),
 ('apsetup.modedef.cost_object', 'de', 'Für jedes auf Positionsebene erkannte Kostenobjekt wird eine Aufgabe an dessen Verantwortlichen erstellt. Der Verantwortliche jedes Eintrags wird in den Kontierungslisten gepflegt. Die Rechnung bleibt in der Genehmigungsstufe, bis alle Kostenobjekt-Genehmigungen vorliegen.'),
 ('apsetup.modedef.employee_supervisor', 'de', 'Schritt für Schritt die Vorgesetztenkette des Benutzers hinauf, bis ein Benutzer mit ausreichendem Genehmigungslimit das Dokument genehmigt.'),
 ('apsetup.modedef.api', 'de', 'Auf eine externe Quelle warten, die die nächste Zuweisung vorgibt. Das Dokument wird mit awaiting_approval_api gekennzeichnet und wartet auf einen Befehl per API. Eine API steht einer Drittanwendung zur Verfügung, um die Weiterleitung an einen Genehmiger zu prüfen und auszulösen.');

UPDATE ui_strings SET value = 'Organisational Approval (Employee Supervisor)' WHERE key = 'apsetup.mode.employee_supervisor' AND locale = 'en';
UPDATE ui_strings SET value = 'Organisatorische Genehmigung (Mitarbeiter-Vorgesetzter)' WHERE key = 'apsetup.mode.employee_supervisor' AND locale = 'de';
UPDATE ui_strings SET value = 'Cost Object' WHERE key = 'apsetup.mode.cost_object' AND locale = 'en';

-- Point-in-time: all four definitions exist in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key LIKE 'apsetup.modedef.%' == 8
