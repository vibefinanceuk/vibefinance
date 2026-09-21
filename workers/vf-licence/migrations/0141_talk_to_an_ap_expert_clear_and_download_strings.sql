-- 0141_talk_to_an_ap_expert_clear_and_download_strings.sql
--
-- Decision 0430's seventh addendum — a "Clear" button next to "Ask" to
-- reset the Q&A history, and a downloadable report (CSV or PDF, the
-- user's own choice) for an answer that carries real tabular data
-- (`ApAssistantAnswer.table`), offered only on explicit ask. See
-- `workers/vf-ui/public/ap-assistant.js`'s own top-of-file doc comment.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('apassistant.clear', 'en', 'Clear'),
 ('apassistant.downloadcsv', 'en', 'Download CSV'),
 ('apassistant.downloadpdf', 'en', 'Download PDF'),
 ('apassistant.popupblocked', 'en', 'Your browser blocked the PDF preview window — please allow pop-ups for this site and try again.');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('apassistant.clear', 'de', 'Löschen'),
 ('apassistant.downloadcsv', 'de', 'CSV herunterladen'),
 ('apassistant.downloadpdf', 'de', 'PDF herunterladen'),
 ('apassistant.popupblocked', 'de', 'Ihr Browser hat das PDF-Vorschaufenster blockiert — bitte lassen Sie Pop-ups für diese Seite zu und versuchen Sie es erneut.');

-- Point-in-time: every key above exists in both locales, nothing more.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('apassistant.clear','apassistant.downloadcsv','apassistant.downloadpdf','apassistant.popupblocked') == 8
