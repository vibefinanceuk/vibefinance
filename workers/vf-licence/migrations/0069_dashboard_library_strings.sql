-- 0069_dashboard_library_strings.sql
-- Decision 0243 — arranging a dashboard.
--
-- **Every card type needs two strings**: what it is called, and what it
-- shows. A picker listing nine names says nothing about which one
-- somebody wants — and `dash.about.*` is the sentence that makes the
-- choice possible.
--
-- The names themselves are already here from migration 0068, except
-- `items_at_stage`, which had no card of its own until now.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('dash.arrange', 'en', 'Arrange'),
 ('dash.done_arranging', 'en', 'Done arranging'),
 ('dash.addcard', 'en', 'Add a card'),
 ('dash.add', 'en', 'Add'),
 ('dash.remove', 'en', 'Remove'),
 ('dash.reset', 'en', 'Back to the default'),
 ('dash.whichstage', 'en', 'Which stage?'),
 ('dash.pickone', 'en', 'Choose a card first.'),
 ('dash.savefailed', 'en', 'That could not be saved.'),
 ('dash.items_at_stage', 'en', 'Items at a stage'),
 ('dash.about.waiting_for_me', 'en', 'How much is waiting, mine and my teams'''),
 ('dash.about.on_my_clock', 'en', 'What I hold, with both clocks'),
 ('dash.about.where_things_are', 'en', 'A bar for each stage'),
 ('dash.about.items_at_stage', 'en', 'One stage you choose'),
 ('dash.about.ageing', 'en', 'How long open work has waited'),
 ('dash.about.done', 'en', 'Finished today and this week'),
 ('dash.about.received', 'en', 'Invoices in, by day'),
 ('dash.about.exceptions_by_supplier', 'en', 'Which suppliers send work'),
 ('dash.about.needs_somebody', 'en', 'Things nothing else surfaces');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('dash.arrange', 'de', 'Anordnen'),
 ('dash.done_arranging', 'de', 'Fertig'),
 ('dash.addcard', 'de', 'Karte hinzufügen'),
 ('dash.add', 'de', 'Hinzufügen'),
 ('dash.remove', 'de', 'Entfernen'),
 ('dash.reset', 'de', 'Zurück zur Standardansicht'),
 ('dash.whichstage', 'de', 'Welche Stufe?'),
 ('dash.pickone', 'de', 'Wählen Sie zuerst eine Karte.'),
 ('dash.savefailed', 'de', 'Das konnte nicht gespeichert werden.'),
 ('dash.items_at_stage', 'de', 'Belege an einer Stufe'),
 ('dash.about.waiting_for_me', 'de', 'Wie viel wartet, meines und das meiner Teams'),
 ('dash.about.on_my_clock', 'de', 'Was bei mir liegt, mit beiden Fristen'),
 ('dash.about.where_things_are', 'de', 'Ein Balken je Stufe'),
 ('dash.about.items_at_stage', 'de', 'Eine Stufe Ihrer Wahl'),
 ('dash.about.ageing', 'de', 'Wie lange offene Arbeit wartet'),
 ('dash.about.done', 'de', 'Heute und diese Woche erledigt'),
 ('dash.about.received', 'de', 'Eingegangene Rechnungen je Tag'),
 ('dash.about.exceptions_by_supplier', 'de', 'Welche Lieferanten Arbeit verursachen'),
 ('dash.about.needs_somebody', 'de', 'Was sonst nirgends auftaucht');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key LIKE 'dash.about.%' == 18
