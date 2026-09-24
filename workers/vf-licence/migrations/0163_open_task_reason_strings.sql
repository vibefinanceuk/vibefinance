-- 0163_open_task_reason_strings.sql
-- "Why is this task here" — decision 0478. Two kinds of string:
--   - the banner's own chrome (label + the click-to-expand affordance),
--     used regardless of which rule fired;
--   - the four standard matching rules' own display names, keyed by
--     the same stable `key` STANDARD_MATCHING_RULES (matching-config-
--     route.ts) already exposes for decision 0474's checkboxes. These
--     are the one exception decision 0478 carved out: their names are
--     code-known constants, translated through this ordinary string
--     table like any other UI label — NOT through the new
--     `rule_name_translations` table (migration 0079), which exists
--     for a customer's own authored rule names, created at runtime.
--
-- A custom rule's full descriptive sentence is deliberately NOT given
-- a key here, and never will be for the standard rules either — the
-- reason line's expanded detail stays exactly what was authored, in
-- whatever language that was, per the "the rule name is translatable,
-- the sentence is the author's own words" distinction this decision's
-- design discussion settled on.

-- Also: editing a custom rule's own German name — decision 0478,
-- `rule.js`'s own affordance beside its existing `rule.rename` (decision
-- 0266). German only, matching `strings.js`'s own LANGUAGES: a control
-- for a locale nobody can switch to is a menu that does nothing, the
-- same reasoning `strings.js`'s own comment already gives for not
-- offering the other four SUPPORTED_LOCALES there either.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('invoice.reasonline.label', 'en', 'Here because:'),
 ('invoice.reasonline.expand', 'en', 'click for details'),
 ('matching.standardrule.po_line_not_found.name', 'en', 'Standard rule: PO line not found'),
 ('matching.standardrule.price_mismatch.name', 'en', 'Standard rule: Price mismatch'),
 ('matching.standardrule.quantity_mismatch.name', 'en', 'Standard rule: Quantity mismatch'),
 ('matching.standardrule.unit_mismatch.name', 'en', 'Standard rule: Unit of measure mismatch'),
 ('rule.germanname', 'en', 'German name'),
 ('rule.setgermanname', 'en', 'Set German name'),
 ('rule.editgermanname', 'en', 'Edit German name'),
 ('rule.germannameprompt', 'en', 'German name for this rule (leave blank to remove it)'),
 ('rule.nogermanname', 'en', 'Shown in German as its own name, unchanged');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('invoice.reasonline.label', 'de', 'Hier, weil:'),
 ('invoice.reasonline.expand', 'de', 'Details anzeigen'),
 ('matching.standardrule.po_line_not_found.name', 'de', 'Standardregel: Bestellposition nicht gefunden'),
 ('matching.standardrule.price_mismatch.name', 'de', 'Standardregel: Preisabweichung'),
 ('matching.standardrule.quantity_mismatch.name', 'de', 'Standardregel: Mengenabweichung'),
 ('matching.standardrule.unit_mismatch.name', 'de', 'Standardregel: Abweichende Maßeinheit'),
 ('rule.germanname', 'de', 'Deutscher Name'),
 ('rule.setgermanname', 'de', 'Deutschen Namen festlegen'),
 ('rule.editgermanname', 'de', 'Deutschen Namen bearbeiten'),
 ('rule.germannameprompt', 'de', 'Deutscher Name für diese Regel (leer lassen, um ihn zu entfernen)'),
 ('rule.nogermanname', 'de', 'Wird auf Deutsch mit dem eigenen, unveränderten Namen angezeigt');

-- Point-in-time: every key exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('invoice.reasonline.label','invoice.reasonline.expand','matching.standardrule.po_line_not_found.name','matching.standardrule.price_mismatch.name','matching.standardrule.quantity_mismatch.name','matching.standardrule.unit_mismatch.name','rule.germanname','rule.setgermanname','rule.editgermanname','rule.germannameprompt','rule.nogermanname') == 22
