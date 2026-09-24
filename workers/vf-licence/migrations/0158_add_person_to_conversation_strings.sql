-- 0158_add_person_to_conversation_strings.sql
-- "Add person to conversation" — decision 0468's own picture, built in
-- decision 0470. The Timeline / Chat tab's own new roster-and-search
-- control (`collaborators.js`), sitting above the feed
-- `activity.internalonly` already describes as "not visible to the
-- supplier" — unchanged by this decision, since a Business User added
-- here is a colleague (`Procurement.*`, decision 0468's own
-- namespace), never the supplier.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('activity.addperson', 'en', 'Add person'),
 ('activity.addpersonsearch', 'en', 'Search people…'),
 ('activity.addpersonnomatches', 'en', 'Nothing matches that.'),
 ('activity.addpersonfailed', 'en', 'Could not add that person. Try again.'),
 ('activity.collaborators', 'en', 'Collaborators');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('activity.addperson', 'de', 'Person hinzufügen'),
 ('activity.addpersonsearch', 'de', 'Personen suchen…'),
 ('activity.addpersonnomatches', 'de', 'Dazu passt nichts.'),
 ('activity.addpersonfailed', 'de', 'Person konnte nicht hinzugefügt werden. Versuchen Sie es erneut.'),
 ('activity.collaborators', 'de', 'Mitwirkende');

-- Point-in-time: every key exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('activity.addperson', 'activity.addpersonsearch', 'activity.addpersonnomatches', 'activity.addpersonfailed', 'activity.collaborators') == 10
