-- 0153_cost_object_priority_strings.sql
-- Cost-Object Priority — decision 0452, turning decision 0450's own
-- mock-up (`docs/design/mockups/cost-object-approval.html`) into a
-- real panel on AP Setup's Approval Hierarchy tab.
--
-- **"Priority" kept as the panel's own name, even though order is now
-- display-only** — the mock-up's own name, predating the operator
-- settling "parallel across cost objects" over "highest-priority
-- dimension wins" (see migration 0077's own header comment). Renaming
-- it would suggest a screen redesign nobody asked for; the copy below
-- is what actually changed.
--
-- **Drag-to-reorder, not up/down buttons** — the mock-up's own static
-- file used buttons only because a static HTML file cannot drag; the
-- real panel reuses `processes.js`'s own drag control for process
-- stage sequencing (decision 0352) instead, so there are no
-- "move up"/"move down" strings here to seed.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('apsetup.costobjectpriority', 'en', 'Cost-Object Priority'),
 ('apsetup.costobjectprioritysub', 'en', 'Shown because Approval mode is set to Cost-Object. Every dimension switched on here that is also coded on a line raises its own approval task, in parallel — not first-match-wins. Drag to reorder — order is display order only.'),
 ('apsetup.costobjectenable', 'en', 'Enable'),
 ('apsetup.costobjectsavefailed', 'en', 'Could not save the Cost-Object Priority list');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('apsetup.costobjectpriority', 'de', 'Kostenobjekt-Priorität'),
 ('apsetup.costobjectprioritysub', 'de', 'Angezeigt, weil der Genehmigungsmodus auf Kostenobjekt eingestellt ist. Jede hier aktivierte Dimension, die auf einer Zeile ebenfalls kontiert ist, löst eine eigene Genehmigungsaufgabe aus — parallel, nicht nach dem Prinzip „höchste Priorität gewinnt“. Zum Umsortieren ziehen — die Reihenfolge ist nur die Anzeigereihenfolge.'),
 ('apsetup.costobjectenable', 'de', 'Aktivieren'),
 ('apsetup.costobjectsavefailed', 'de', 'Die Kostenobjekt-Prioritätsliste konnte nicht gespeichert werden');

-- Point-in-time: every key exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('apsetup.costobjectpriority','apsetup.costobjectprioritysub','apsetup.costobjectenable','apsetup.costobjectsavefailed') == 8
