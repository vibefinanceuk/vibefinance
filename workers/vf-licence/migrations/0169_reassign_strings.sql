-- 0169_reassign_strings.sql
--
-- Decision 0489 — Reassign: the button label, its own small picker's
-- field labels and empty-candidates note, and the Timeline/Chat line
-- for a reassign, matching activity.stagecompleted's own {who}
-- placeholder convention plus a second, {target}.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('action.reassign', 'en', 'Reassign'),
 ('action.reassign.wholabel', 'en', 'Reassign to'),
 ('action.reassign.commentlabel', 'en', 'Comment (optional)'),
 ('action.reassign.nonefound', 'en', 'Nobody else on this team can take this task.'),
 ('activity.reassigned', 'en', '{who} reassigned this to {target}');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('action.reassign', 'de', 'Neu zuweisen'),
 ('action.reassign.wholabel', 'de', 'Neu zuweisen an'),
 ('action.reassign.commentlabel', 'de', 'Kommentar (optional)'),
 ('action.reassign.nonefound', 'de', 'Niemand sonst in diesem Team kann diese Aufgabe übernehmen.'),
 ('activity.reassigned', 'de', '{who} hat dies {target} neu zugewiesen');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('action.reassign', 'action.reassign.wholabel', 'action.reassign.commentlabel', 'action.reassign.nonefound', 'activity.reassigned') == 10
