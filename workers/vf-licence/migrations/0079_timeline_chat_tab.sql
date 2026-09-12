-- 0079_timeline_chat_tab.sql
--
-- Decision 0269 — the activity panel moved from a drawer (decision
-- 0267) into a second tab beside the document preview, at the
-- operator's own words: "two tabs, reading 'Document' and
-- 'Timeline / Chat'."
--
-- **`activity.tab` and `activity.title` are left in place, unused** —
-- decision 0071's rule: a string a customer may already have
-- translated is not removed in passing just because the code stopped
-- reading it.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('activity.timelinetab', 'en', 'Timeline / Chat');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('activity.timelinetab', 'de', 'Verlauf / Chat');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'activity.timelinetab' == 2
