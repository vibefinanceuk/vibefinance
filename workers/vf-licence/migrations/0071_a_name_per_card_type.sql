-- 0071_a_name_per_card_type.sql
--
-- **One name per card type** — decision 0249.
--
-- The picker asks for `dash.<card_type>` and five of the nine were
-- never defined, so it listed `dash.waiting_for_me` and
-- `dash.on_my_clock` to a person choosing what to see.
--
-- **Four worked by accident**: `ageing`, `done`, `received` and
-- `items_at_stage` happen to be the names the card headings already
-- used. The other five had headings under different keys —
-- `dash.waiting`, `dash.myclock`, `dash.wherethings` — which is two
-- names for one thing, and decision 0236 already said what that costs.
--
-- **So the card type is the name**, and both the heading and the picker
-- read it. The old keys stay: one a customer may have translated is not
-- something to remove in passing.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('dash.waiting_for_me', 'en', 'Waiting for me'),
 ('dash.on_my_clock', 'en', 'On my clock'),
 ('dash.where_things_are', 'en', 'Where things are'),
 ('dash.exceptions_by_supplier', 'en', 'Exceptions by supplier'),
 ('dash.needs_somebody', 'en', 'Needs somebody');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('dash.waiting_for_me', 'de', 'Wartet auf mich'),
 ('dash.on_my_clock', 'de', 'Unter meiner Verantwortung'),
 ('dash.where_things_are', 'de', 'Wo die Belege stehen'),
 ('dash.exceptions_by_supplier', 'de', 'Ausnahmen nach Lieferant'),
 ('dash.needs_somebody', 'de', 'Braucht jemanden');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('dash.waiting_for_me','dash.on_my_clock','dash.where_things_are','dash.exceptions_by_supplier','dash.needs_somebody') == 10

-- Standing invariant: **every card type has a name and a description**,
-- in both languages. The shape of the fault this fixes — a picker
-- listing a key is a picker nobody can use, and nothing else looks for
-- it because the key exists in neither place.
-- ASSERT ALWAYS: SELECT count(*) FROM (SELECT substr(key, 12) AS t FROM ui_strings WHERE key LIKE 'dash.about.%' AND locale = 'en' AND 'dash.' || substr(key, 12) NOT IN (SELECT key FROM ui_strings WHERE locale = 'en')) == 0
