-- 0159_business_approver_approve_action_string.sql
-- The Business Approver role — decision 0471. A Non-PO invoice routed
-- to one or more collaborators holding `Procurement.Approve` shows
-- "Approve" in the Invoice Viewer rather than the generic "Complete"
-- every other stage's task uses — the same shared `complete` action
-- and `POST /tasks/:id/complete` route, only the button's own label
-- differs (`viewer.js`'s `taskActionButtons`, the same `label`
-- override decision 0374 already added `actionLink` for).

INSERT INTO ui_strings (key, locale, value) VALUES
 ('action.approve', 'en', 'Approve');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('action.approve', 'de', 'Genehmigen');

-- Point-in-time: the key exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'action.approve' == 2
