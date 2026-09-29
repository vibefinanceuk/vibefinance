-- 0201_fix_escaped_quotes.sql
-- Decision 0546. Migration 0078 wrote curly quotes and a dash as
-- JavaScript escapes ("‘"), which SQL stores literally, so the
-- Timeline read "Business rule ‘…’ fired". The real
-- characters, written as themselves.

UPDATE ui_strings SET value = 'Business rule ‘{rule}’ fired: {actions}' WHERE key = 'activity.rulefired' AND locale = 'en';
UPDATE ui_strings SET value = 'Geschäftsregel „{rule}“ ausgelöst: {actions}' WHERE key = 'activity.rulefired' AND locale = 'de';
UPDATE ui_strings SET value = 'Nur intern — für den Lieferanten nicht sichtbar.' WHERE key = 'activity.internalonly' AND locale = 'de';

-- ASSERT: SELECT count(*) FROM ui_strings WHERE instr(value, '\u') > 0 == 0
