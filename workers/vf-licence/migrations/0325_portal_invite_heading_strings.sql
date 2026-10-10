-- 0325_portal_invite_heading_strings.sql
-- Decision 0719 — the supplier pop-out's portal column: a heading over the
-- invitation, apart from the people already linked.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('suppliers.portal.invitesomeone', 'en', 'Invite someone from {supplier}'),
 ('suppliers.portal.invitesomeone', 'de', 'Jemanden von {supplier} einladen');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'suppliers.portal.invitesomeone' == 2
