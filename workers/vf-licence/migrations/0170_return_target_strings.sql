-- 0170_return_target_strings.sql
-- Decision 0490 — third of the five-step Coding-pilot sequence.
--
-- Two surfaces: the viewer's own Return picker (`action.return.*`),
-- which first made Return reachable at all (see migrations/
-- 0085_stage_return_targets.sql and openReturnPicker's own comment in
-- viewer.js for why), and a new section inside AP Setup's existing
-- Stage Restrictions tab (`apsetup.stagerestrictions.returntargets*`)
-- where an operator configures the curated list that picker reads
-- from.
--
-- `action.return`, `apsetup.add`, `roles.remove`, and
-- `apsetup.stagerestrictions.savefailed` already exist and are reused
-- directly — the picker's own title and submit button, the AP Setup
-- add-row button, each configured row's own remove button, and this
-- section's own save-failure message, rather than four near-duplicate
-- strings naming the same things.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('action.return.wholabel', 'en', 'Return to'),
 ('action.return.reasonlabel', 'en', 'Reason'),
 ('action.return.nonefound', 'en', 'No return targets are configured for this stage.'),
 ('apsetup.stagerestrictions.returntargetsheading', 'en', 'Return targets'),
 ('apsetup.stagerestrictions.returntargetshint', 'en', 'Where Return can send a document from this stage, and which team receives it. Only stages a document has actually visited are ever offered when returning it.'),
 ('apsetup.stagerestrictions.notargetsyet', 'en', 'No return targets configured for this stage yet.'),
 ('apsetup.stagerestrictions.targetstage', 'en', 'Target stage'),
 ('apsetup.stagerestrictions.returnteam', 'en', 'Team');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('action.return.wholabel', 'de', 'Zurücksenden an'),
 ('action.return.reasonlabel', 'de', 'Grund'),
 ('action.return.nonefound', 'de', 'Für diese Phase sind keine Rücksendeziele eingerichtet.'),
 ('apsetup.stagerestrictions.returntargetsheading', 'de', 'Rücksendeziele'),
 ('apsetup.stagerestrictions.returntargetshint', 'de', 'Wohin „Zurücksenden“ ein Dokument von dieser Phase aus schicken kann, und welches Team es erhält. Angeboten werden beim Zurücksenden stets nur Phasen, die das Dokument tatsächlich durchlaufen hat.'),
 ('apsetup.stagerestrictions.notargetsyet', 'de', 'Für diese Phase sind noch keine Rücksendeziele eingerichtet.'),
 ('apsetup.stagerestrictions.targetstage', 'de', 'Zielphase'),
 ('apsetup.stagerestrictions.returnteam', 'de', 'Team');

-- Point-in-time: every key exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('action.return.wholabel','action.return.reasonlabel','action.return.nonefound','apsetup.stagerestrictions.returntargetsheading','apsetup.stagerestrictions.returntargetshint','apsetup.stagerestrictions.notargetsyet','apsetup.stagerestrictions.targetstage','apsetup.stagerestrictions.returnteam') == 16
