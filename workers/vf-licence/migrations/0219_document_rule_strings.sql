-- 0219_document_rule_strings.sql
-- Decision 0569. Rules for the whole invoice in the mapping editor, the
-- add days function's name, and help.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('mapping.rules.heading', 'en', 'Rules for the whole invoice'),
 ('mapping.rules.heading', 'de', 'Regeln für die ganze Rechnung'),
 ('mapping.rules.sub', 'en', 'Defaults and values worked out from others, applied after the lines, in order.'),
 ('mapping.rules.sub', 'de', 'Standardwerte und aus anderen abgeleitete Werte, nach den Positionen angewendet, der Reihe nach.'),
 ('mapping.rules.none', 'en', 'No rules yet.'),
 ('mapping.rules.none', 'de', 'Noch keine Regeln.'),
 ('mapping.rules.say', 'en', 'A rule for the whole invoice'),
 ('mapping.rules.say', 'de', 'Eine Regel für die ganze Rechnung'),
 ('mapping.rules.placeholder', 'en', 'For example: the due date is 30 days after the invoice date'),
 ('mapping.rules.placeholder', 'de', 'Zum Beispiel: Fälligkeit ist 30 Tage nach dem Rechnungsdatum'),
 ('mapping.rules.missing', 'en', 'when it is missing'),
 ('mapping.rules.missing', 'de', 'wenn sie fehlt'),
 ('mapping.rules.always', 'en', 'always'),
 ('mapping.rules.always', 'de', 'immer'),
 ('mapping.rules.from', 'en', 'from {term}'),
 ('mapping.rules.from', 'de', 'aus {term}'),
 ('mapping.rules.fixed', 'en', 'a fixed value'),
 ('mapping.rules.fixed', 'de', 'ein fester Wert'),
 ('mapping.rules.example', 'en', 'On the sample, before and after:'),
 ('mapping.rules.example', 'de', 'Am Beispiel, vorher und nachher:'),
 ('mapping.rules.remove', 'en', 'Remove rule'),
 ('mapping.rules.remove', 'de', 'Regel entfernen'),
 ('mapping.fn.add_days', 'en', 'add days'),
 ('mapping.fn.add_days', 'de', 'Tage addieren'),
 ('mapping.rules.filled', 'en', 'By a rule'),
 ('mapping.rules.filled', 'de', 'Durch eine Regel'),
 ('help.screen.mapping.48', 'en', '## Rules for the whole invoice'),
 ('help.screen.mapping.48', 'de', '## Regeln für die ganze Rechnung'),
 ('help.screen.mapping.49', 'en', '- A rule fills a whole-invoice term the lines do not: a default, such as if the currency is missing, use EUR, or a value worked out from another, such as the due date is 30 days after the invoice date, or the buyer reference is the order number.'),
 ('help.screen.mapping.49', 'de', '- Eine Regel füllt eine Angabe der ganzen Rechnung, die die Positionen nicht füllen: einen Standardwert, etwa wenn die Währung fehlt, EUR verwenden, oder einen aus einem anderen abgeleiteten Wert, etwa Fälligkeit ist 30 Tage nach dem Rechnungsdatum oder die Käuferreferenz ist die Bestellnummer.'),
 ('help.screen.mapping.50', 'en', '- Say the rule, then Understand. The example shows the term before and after on the sample. Accept adds it to the draft. Rules are applied after the lines, in order, so a later rule can use what an earlier one filled.'),
 ('help.screen.mapping.50', 'de', '- Sagen Sie die Regel, dann Verstehen. Das Beispiel zeigt die Angabe vorher und nachher am Beispiel. Übernehmen fügt sie dem Entwurf hinzu. Regeln werden nach den Positionen der Reihe nach angewendet, sodass eine spätere Regel nutzen kann, was eine frühere gefüllt hat.'),
 ('help.screen.mapping.51', 'en', '- A rule fills a term when it is missing, unless you say always. A term mapped from the document is only ever filled when it is missing. Rules are versioned, tried and published with the mapping.'),
 ('help.screen.mapping.51', 'de', '- Eine Regel füllt eine Angabe, wenn sie fehlt, außer Sie sagen immer. Eine aus dem Dokument zugeordnete Angabe wird nur gefüllt, wenn sie fehlt. Regeln werden mit der Zuordnung versioniert, getestet und veröffentlicht.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('mapping.rules.heading','mapping.rules.sub','mapping.rules.none','mapping.rules.say','mapping.rules.placeholder','mapping.rules.missing','mapping.rules.always','mapping.rules.from','mapping.rules.fixed','mapping.rules.example','mapping.rules.remove','mapping.fn.add_days','mapping.rules.filled','help.screen.mapping.48','help.screen.mapping.49','help.screen.mapping.50','help.screen.mapping.51') == 34
