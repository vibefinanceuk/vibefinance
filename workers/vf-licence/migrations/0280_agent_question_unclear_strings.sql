-- 0280_agent_question_unclear_strings.sql
-- Decision 0635 — Agents: a question written so it cannot be read is said
-- as unclear, and what narrows a plan with no report yet.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('agents.refusal.question_unclear', 'en', 'Could not read the part about {words} as written. Say it another way, for example with the amount and its currency, or choose a report in Edit steps.'),
 ('agents.refusal.question_unclear', 'de', 'Der Teil zu {words} ließ sich so nicht lesen. Sagen Sie es anders, etwa mit Betrag und Währung, oder wählen Sie einen Bericht unter Schritte bearbeiten.'),
 ('agents.plan.missing.shape', 'en', 'Follows from the report.'),
 ('agents.plan.missing.shape', 'de', 'Ergibt sich aus dem Bericht.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('agents.refusal.question_unclear', 'agents.plan.missing.shape') == 4
