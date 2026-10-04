-- 0270_agent_summary_strings.sql
-- Decision 0626 — Agents, slice 5: the AI summary, its switch, what became
-- of it on each run, the summaries used today, and help.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('agents.summary.label', 'en', 'AI summary'),
 ('agents.summary.label', 'de', 'KI-Zusammenfassung'),
 ('agents.summary.on', 'en', 'Write a few sentences on top of each report'),
 ('agents.summary.on', 'de', 'Ein paar Sätze über jeden Bericht schreiben'),
 ('agents.summary.hint', 'en', 'Written by AI from each reader''s own copy, in their language. It is sent only when every number in it is in the table, and the report goes either way.'),
 ('agents.summary.hint', 'de', 'Von KI aus der Kopie jedes Lesers geschrieben, in seiner Sprache. Sie wird nur gesendet, wenn jede Zahl darin in der Tabelle steht, und der Bericht geht in jedem Fall.'),
 ('agents.summary.noai', 'en', 'AI is not set up here, so reports go without a summary.'),
 ('agents.summary.noai', 'de', 'KI ist hier nicht eingerichtet, daher gehen Berichte ohne Zusammenfassung.'),
 ('agents.summary.short', 'en', 'AI summary'),
 ('agents.summary.short', 'de', 'KI-Zusammenfassung'),
 ('agents.summary.today', 'en', 'AI summaries today: {used} of {max}. Past that, reports go without one.'),
 ('agents.summary.today', 'de', 'KI-Zusammenfassungen heute: {used} von {max}. Darüber hinaus gehen Berichte ohne.'),
 ('agents.summary.notelabel', 'en', 'Summary, written by AI from the table below'),
 ('agents.summary.notelabel', 'de', 'Zusammenfassung, von KI aus der Tabelle unten geschrieben'),
 ('agents.summary.run.written', 'en', 'summary written'),
 ('agents.summary.run.written', 'de', 'Zusammenfassung geschrieben'),
 ('agents.summary.run.mismatch', 'en', 'no summary: a number did not match the table'),
 ('agents.summary.run.mismatch', 'de', 'keine Zusammenfassung: eine Zahl passte nicht zur Tabelle'),
 ('agents.summary.run.over_budget', 'en', 'no summary: the AI summaries for today were used'),
 ('agents.summary.run.over_budget', 'de', 'keine Zusammenfassung: die KI-Zusammenfassungen für heute waren aufgebraucht'),
 ('agents.summary.run.ai_unavailable', 'en', 'no summary: the AI could not be reached'),
 ('agents.summary.run.ai_unavailable', 'de', 'keine Zusammenfassung: die KI war nicht erreichbar'),
 ('agents.summary.run.no_ai', 'en', 'no summary: AI is not set up here'),
 ('agents.summary.run.no_ai', 'de', 'keine Zusammenfassung: KI ist hier nicht eingerichtet'),
 ('agents.plan.summarise', 'en', 'Summary'),
 ('agents.plan.summarise', 'de', 'Zusammenfassung'),
 ('agents.plan.summary.on', 'en', 'A few sentences by AI on top, every number checked against the table'),
 ('agents.plan.summary.on', 'de', 'Ein paar Sätze von KI oben, jede Zahl mit der Tabelle abgeglichen'),
 ('agents.plan.summary.off', 'en', 'No summary, the table only'),
 ('agents.plan.summary.off', 'de', 'Keine Zusammenfassung, nur die Tabelle'),
 ('help.screen.agents.21', 'en', '## The AI summary'),
 ('help.screen.agents.21', 'de', '## Die KI-Zusammenfassung'),
 ('help.screen.agents.22', 'en', '- Each report can start with a few sentences written by AI from that reader''s own copy, in their language. Every number in it is checked against the table, and a summary with any other number is left out, so the report goes without it.'),
 ('help.screen.agents.22', 'de', '- Jeder Bericht kann mit ein paar Sätzen beginnen, die KI aus der Kopie des Lesers in seiner Sprache schreibt. Jede Zahl darin wird mit der Tabelle abgeglichen, und eine Zusammenfassung mit einer anderen Zahl wird weggelassen, sodass der Bericht ohne sie geht.'),
 ('help.screen.agents.23', 'en', '- It is on for a new agent, and can be turned off under Edit steps. Your licence sets how many summaries can be written a day, and each run says whether a summary was written and, if not, why.'),
 ('help.screen.agents.23', 'de', '- Sie ist bei einem neuen Agenten eingeschaltet und kann unter Schritte bearbeiten ausgeschaltet werden. Ihre Lizenz legt fest, wie viele Zusammenfassungen am Tag geschrieben werden können, und jeder Lauf zeigt, ob eine geschrieben wurde und, falls nicht, warum.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('agents.summary.label', 'agents.summary.on', 'agents.summary.hint', 'agents.summary.noai', 'agents.summary.short', 'agents.summary.today', 'agents.summary.notelabel', 'agents.summary.run.written', 'agents.summary.run.mismatch', 'agents.summary.run.over_budget', 'agents.summary.run.ai_unavailable', 'agents.summary.run.no_ai', 'agents.plan.summarise', 'agents.plan.summary.on', 'agents.plan.summary.off', 'help.screen.agents.21', 'help.screen.agents.22', 'help.screen.agents.23') == 36
