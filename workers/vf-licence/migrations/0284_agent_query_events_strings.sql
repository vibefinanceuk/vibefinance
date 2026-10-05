-- 0284_agent_query_events_strings.sql
-- Decision 0638 — Agents ask the data, slice 5: questions started by an
-- event, the day's allowance, ready-made questions, and help.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('agents.q.when', 'en', 'When'),
 ('agents.q.when', 'de', 'Wann'),
 ('agents.q.when.schedule', 'en', 'On its schedule'),
 ('agents.q.when.schedule', 'de', 'Nach Zeitplan'),
 ('agents.q.when.event', 'en', 'As soon as something new matches'),
 ('agents.q.when.event', 'de', 'Sobald etwas Neues passt'),
 ('agents.plan.q.event', 'en', 'as soon as something new matches, looked at every hour, each person sent only what they have not had'),
 ('agents.plan.q.event', 'de', 'sobald etwas Neues passt, stündlich geprüft, jede Person erhält nur, was sie noch nicht hatte'),
 ('agents.q.allowance', 'en', 'Questions today: {used} of {max}. Each run of a question, for each person, and each try takes one.'),
 ('agents.q.allowance', 'de', 'Abfragen heute: {used} von {max}. Jeder Lauf einer Abfrage je Person und jedes Ausprobieren zählt eine.'),
 ('agents.error.query_limit_reached', 'en', 'Today''s questions are used. They start again tomorrow, or ask about a larger plan.'),
 ('agents.error.query_limit_reached', 'de', 'Die Abfragen für heute sind aufgebraucht. Morgen geht es weiter, oder fragen Sie nach einem größeren Tarif.'),
 ('agents.error.query_not_in_licence', 'en', 'Your licence does not include agents'' own questions.'),
 ('agents.error.query_not_in_licence', 'de', 'Ihre Lizenz umfasst keine eigenen Abfragen von Agenten.'),
 ('agents.error.query_event_grouped', 'en', 'A question started by an event shows one row each, not groups.'),
 ('agents.error.query_event_grouped', 'de', 'Eine durch ein Ereignis gestartete Abfrage zeigt Einzelzeilen, keine Gruppen.'),
 ('agents.error.query_event_invalid', 'en', 'Choose on its schedule, or as soon as something new matches.'),
 ('agents.error.query_event_invalid', 'de', 'Wählen Sie nach Zeitplan oder sobald etwas Neues passt.'),
 ('agents.example.large_invoices.name', 'en', 'Large invoices'),
 ('agents.example.large_invoices.name', 'de', 'Große Rechnungen'),
 ('agents.example.large_invoices.words', 'en', 'Every Monday at 8am, invoices over £100,000 still in process, largest first.'),
 ('agents.example.large_invoices.words', 'de', 'Jeden Montag um 8 Uhr Rechnungen über 100.000 £ in Bearbeitung, die größten zuerst.'),
 ('agents.example.spend_by_gl.name', 'en', 'Spend by GL code'),
 ('agents.example.spend_by_gl.name', 'de', 'Ausgaben nach Sachkonto'),
 ('agents.example.spend_by_gl.words', 'en', 'On the last working day of each month at 4pm, the coded spend of invoices received in the last month, by GL code.'),
 ('agents.example.spend_by_gl.words', 'de', 'Am letzten Werktag jedes Monats um 16 Uhr die kontierten Ausgaben der im letzten Monat eingegangenen Rechnungen, nach Sachkonto.'),
 ('agents.example.slow_stages.name', 'en', 'Slow stages'),
 ('agents.example.slow_stages.name', 'de', 'Langsame Schritte'),
 ('agents.example.slow_stages.words', 'en', 'Every Monday at 8am, the average and longest days invoices spent at each stage in the last 30 days.'),
 ('agents.example.slow_stages.words', 'de', 'Jeden Montag um 8 Uhr die durchschnittlichen und längsten Tage der Rechnungen in jedem Schritt in den letzten 30 Tagen.'),
 ('agents.example.failed_deliveries.name', 'en', 'Failed deliveries to the ERP'),
 ('agents.example.failed_deliveries.name', 'de', 'Fehlgeschlagene Übermittlungen an das ERP'),
 ('agents.example.failed_deliveries.words', 'en', 'As soon as an invoice cannot be delivered to the ERP, which invoice and why.'),
 ('agents.example.failed_deliveries.words', 'de', 'Sobald eine Rechnung nicht an das ERP übermittelt werden kann, welche Rechnung und warum.'),
 ('help.screen.agents.42', 'en', '- A question can be started by an event: it is looked at every hour and sends only what is new. A question of invoices, tasks or time at stages can prepare reminders, and one of returns can prepare chasers, for approval as before. Each run and each try counts against the day''s questions on your licence.'),
 ('help.screen.agents.42', 'de', '- Eine Abfrage kann durch ein Ereignis gestartet werden: Sie wird stündlich geprüft und sendet nur Neues. Eine Abfrage zu Rechnungen, Aufgaben oder Zeit in den Schritten kann Erinnerungen vorbereiten, eine zu Rücksendungen Nachfassschreiben, zur Freigabe wie bisher. Jeder Lauf und jedes Ausprobieren zählt gegen die Abfragen des Tages in Ihrer Lizenz.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('agents.q.when', 'agents.q.when.schedule', 'agents.q.when.event', 'agents.plan.q.event', 'agents.q.allowance', 'agents.error.query_limit_reached', 'agents.error.query_not_in_licence', 'agents.error.query_event_grouped', 'agents.error.query_event_invalid', 'agents.example.large_invoices.name', 'agents.example.large_invoices.words', 'agents.example.spend_by_gl.name', 'agents.example.spend_by_gl.words', 'agents.example.slow_stages.name', 'agents.example.slow_stages.words', 'agents.example.failed_deliveries.name', 'agents.example.failed_deliveries.words', 'help.screen.agents.42') == 36
