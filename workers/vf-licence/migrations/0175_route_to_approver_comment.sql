-- 0175_route_to_approver_comment.sql
--
-- Decision 0497 — Route To Approver's own optional comment, asked for
-- directly: "add an optional comment box to the Route To Approver box,
-- similar to the Reassign box." Genuinely new keys, so INSERT rather
-- than UPDATE (the same convention decisions 0172/0173 already
-- established for wording-only changes to an existing key). The
-- Timeline/Chat line matches activity.reassigned's own {who}/{target}
-- placeholder shape from migration 0169.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('action.route_to_approver.commentlabel', 'en', 'Comment (optional)'),
 ('activity.routedtoapprover', 'en', '{who} routed this to {target}');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('action.route_to_approver.commentlabel', 'de', 'Kommentar (optional)'),
 ('activity.routedtoapprover', 'de', '{who} hat dies an {target} weitergeleitet');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('action.route_to_approver.commentlabel', 'activity.routedtoapprover') == 4
