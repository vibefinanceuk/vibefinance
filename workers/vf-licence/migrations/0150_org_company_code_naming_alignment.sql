-- 0150_org_company_code_naming_alignment.sql
-- Decision 0447 — reported live: "Please can the Access and AP Setup
-- screens to align on the naming of Org Units and Company Code. Perhaps
-- Org / Company Code is a good compromise?" Access's own Org units tab
-- (`roles.units`) and AP Setup's own Company code tab
-- (`apsetup.codingtab.companycode`) are the same underlying data —
-- AP Setup's own sub-heading already says as much ("Managed under
-- Access → Org Units. Shown here for reference only.") — so the two
-- screens showing two different names for it was the actual problem.
-- Both tabs now carry the operator's own suggested compromise, and the
-- AP Setup sub-heading's cross-reference is updated to match the
-- renamed Access tab it points at.
UPDATE ui_strings SET value = 'Org / Company Code' WHERE key = 'roles.units' AND locale = 'en';
UPDATE ui_strings SET value = 'Org / Buchungskreis' WHERE key = 'roles.units' AND locale = 'de';

UPDATE ui_strings SET value = 'Org / Company Code' WHERE key = 'apsetup.codingtab.companycode' AND locale = 'en';
UPDATE ui_strings SET value = 'Org / Buchungskreis' WHERE key = 'apsetup.codingtab.companycode' AND locale = 'de';

UPDATE ui_strings SET value = 'Managed under Access → Org / Company Code. Shown here for reference only.' WHERE key = 'apsetup.codingcompanycodesub' AND locale = 'en';
UPDATE ui_strings SET value = 'Verwaltet unter Zugriff → Org / Buchungskreis. Hier nur zur Referenz.' WHERE key = 'apsetup.codingcompanycodesub' AND locale = 'de';

-- Point-in-time: the wording changed and nothing was lost.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('roles.units','apsetup.codingtab.companycode','apsetup.codingcompanycodesub') == 6
