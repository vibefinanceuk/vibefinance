-- 0273_agent_documents_strings.sql
-- Decision 0629 — Agents phase 2, slice 2: Open in Documents from an
-- agent report, the banner there, and help.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('documents.showing.agent', 'en', 'Showing the invoices in the agent report “{name}”'),
 ('documents.showing.agent', 'de', 'Rechnungen aus dem Agentenbericht „{name}“'),
 ('documents.showing.agentrow', 'en', 'Showing the invoices in the agent report “{name}”: {row}'),
 ('documents.showing.agentrow', 'de', 'Rechnungen aus dem Agentenbericht „{name}“: {row}'),
 ('documents.showing.agentunnamed', 'en', 'Showing the invoices in an agent report sent to you'),
 ('documents.showing.agentunnamed', 'de', 'Rechnungen aus einem an Sie gesendeten Agentenbericht'),
 ('agents.notes.opendocs', 'en', 'Open in Documents'),
 ('agents.notes.opendocs', 'de', 'In Dokumente öffnen'),
 ('agents.notes.rowhint', 'en', 'or choose a row to see its own invoices.'),
 ('agents.notes.rowhint', 'de', 'oder wählen Sie eine Zeile, um ihre Rechnungen zu sehen.'),
 ('help.screen.agents.29', 'en', '## From a report to the invoices'),
 ('help.screen.agents.29', 'de', '## Vom Bericht zu den Rechnungen'),
 ('help.screen.agents.30', 'en', '- Outstanding payables, due soon, stuck work and possible duplicates know the invoices behind each row. On a note, Open in Documents shows them all, and choosing a row shows its own. The email has a link to the same, which opens for the person it was sent to.'),
 ('help.screen.agents.30', 'de', '- Offene Verbindlichkeiten, bald fällige Rechnungen, festhängende Arbeit und mögliche Duplikate kennen die Rechnungen hinter jeder Zeile. In einer Notiz zeigt In Dokumente öffnen alle, und eine gewählte Zeile zeigt ihre eigenen. Die E-Mail enthält einen Link dorthin, der sich für die Person öffnet, an die sie ging.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('documents.showing.agent', 'documents.showing.agentrow', 'documents.showing.agentunnamed', 'agents.notes.opendocs', 'agents.notes.rowhint', 'help.screen.agents.29', 'help.screen.agents.30') == 14
