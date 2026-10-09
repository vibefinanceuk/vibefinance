-- 0309_ai_allowance_strings.sql
-- Decision 0696 — an emailed document not read because the day's AI
-- allowance is used up waits, and is read after the reset at 00:00 UTC.
-- The Route monitor's words for the wait and for the rare case where it
-- could not wait (read on arrival, or Reprocess).

INSERT INTO ui_strings (key, locale, value) VALUES
 ('routemonitor.event.read_deferred', 'en', 'Waiting for the AI allowance, will be read after 00:00 UTC'),
 ('routemonitor.event.read_deferred', 'de', 'Wartet auf das KI-Kontingent, wird nach 00:00 UTC gelesen'),
 ('routemonitor.error.ai_allowance.title', 'en', 'The AI allowance was used up'),
 ('routemonitor.error.ai_allowance.title', 'de', 'Das KI-Kontingent war aufgebraucht'),
 ('routemonitor.error.ai_allowance.body', 'en', 'Nothing was wrong with the file: the day''s AI allowance had run out, so it was not read. The sender was not told anything.'),
 ('routemonitor.error.ai_allowance.body', 'de', 'Mit der Datei war alles in Ordnung: Das KI-Kontingent des Tages war aufgebraucht, daher wurde sie nicht gelesen. Der Absender wurde nicht benachrichtigt.'),
 ('routemonitor.error.ai_allowance.fix', 'en', 'reprocess it after 00:00 UTC, when the allowance resets.'),
 ('routemonitor.error.ai_allowance.fix', 'de', 'Verarbeiten Sie sie nach 00:00 UTC erneut, wenn das Kontingent zurückgesetzt ist.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('routemonitor.event.read_deferred','routemonitor.error.ai_allowance.title','routemonitor.error.ai_allowance.body','routemonitor.error.ai_allowance.fix') == 8
