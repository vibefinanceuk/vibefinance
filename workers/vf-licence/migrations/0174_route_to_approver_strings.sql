-- 0174_route_to_approver_strings.sql
--
-- Decision 0495 — Route To Approver: the button label, its own small
-- picker's field label and empty-candidates note. The same shape
-- migration 0169 (Reassign) already established — no Timeline/Chat
-- line of its own, unlike Reassign's activity.reassigned: completing
-- this task already writes the ordinary stage-completed activity
-- entry (decision 0454), and there is no separate "route to approver"
-- event — it is the same POST /tasks/:id/complete every stage uses.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('action.route_to_approver', 'en', 'Route To Approver'),
 ('action.route_to_approver.wholabel', 'en', 'Route to'),
 ('action.route_to_approver.nonefound', 'en', 'Nobody is set up to approve this yet.');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('action.route_to_approver', 'de', 'An Genehmiger weiterleiten'),
 ('action.route_to_approver.wholabel', 'de', 'Weiterleiten an'),
 ('action.route_to_approver.nonefound', 'de', 'Es ist noch niemand als Genehmiger eingerichtet.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('action.route_to_approver', 'action.route_to_approver.wholabel', 'action.route_to_approver.nonefound') == 6
