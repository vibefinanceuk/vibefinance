-- 0168_task_action_events_strings.sql
--
-- Decision 0488 — Timeline/Chat lines for the five task actions the
-- activity feed now renders (claim/release, derived from the new
-- task_action_events table; return/return-to-supplier/discard, derived
-- read-time from `tasks` itself). `{who}` matches activity.stage
-- completed's own placeholder convention; `{stage}` on activity.
-- returned names the target stage a Return-To-Stage button sent it
-- back to.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('activity.claimed', 'en', '{who} claimed this task'),
 ('activity.released', 'en', '{who} released this task'),
 ('activity.returned', 'en', '{who} returned this to {stage}'),
 ('activity.returnedtosupplier', 'en', '{who} returned this to the supplier'),
 ('activity.discarded', 'en', '{who} discarded this task');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('activity.claimed', 'de', '{who} hat diese Aufgabe beansprucht'),
 ('activity.released', 'de', '{who} hat diese Aufgabe freigegeben'),
 ('activity.returned', 'de', '{who} hat dies an {stage} zurückgesendet'),
 ('activity.returnedtosupplier', 'de', '{who} hat dies an den Lieferanten zurückgesendet'),
 ('activity.discarded', 'de', '{who} hat diese Aufgabe verworfen');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('activity.claimed', 'activity.released', 'activity.returned', 'activity.returnedtosupplier', 'activity.discarded') == 10
