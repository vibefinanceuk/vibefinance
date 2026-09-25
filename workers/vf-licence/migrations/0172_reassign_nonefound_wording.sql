-- 0172_reassign_nonefound_wording.sql
-- Decision 0493 — reported live, against the redrawn pop-out alert:
-- the message itself was unhelpful. "Nobody else on this team can
-- take this task" reads as a statement about the team; what a person
-- actually needs to know is why Reassign did nothing — there is
-- nobody eligible to hand it to.
UPDATE ui_strings SET value = 'There are no eligible users to reassign.' WHERE key = 'action.reassign.nonefound' AND locale = 'en';
UPDATE ui_strings SET value = 'Es gibt keine berechtigten Benutzer für eine Neuzuweisung.' WHERE key = 'action.reassign.nonefound' AND locale = 'de';

-- Point-in-time: the wording changed and nothing was lost.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'action.reassign.nonefound' == 2
