-- 0065_state_action_labels.sql
-- Decision 0234 — the supplier state actions, as buttons with icons.
--
-- **`action.save` and `action.activate` already existed** (migration
-- 0023, the rules screen), and mean the same thing here — saving is
-- saving, and activating a supplier is the same verb as activating a
-- rule. Reused rather than redefined: two keys for one word is two
-- places for a translator to disagree with themselves.
--
-- **`actionLink` labels a glyph by its action name** (decision 0229), so
-- these are `action.*` keys rather than the `suppliers.*` ones the plain
-- buttons used. The old keys stay: one a customer may have translated is
-- not something to remove in passing.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('action.hold', 'en', 'Hold'),
 ('action.releasehold', 'en', 'Release hold'),
 ('action.deactivate', 'en', 'Deactivate');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('action.hold', 'de', 'Sperren'),
 ('action.releasehold', 'de', 'Sperre aufheben'),
 ('action.deactivate', 'de', 'Deaktivieren');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('action.hold','action.releasehold','action.deactivate') == 6
