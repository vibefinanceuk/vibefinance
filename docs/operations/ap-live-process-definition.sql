-- Bringing ap-live's process definition in line with the real AP flow.
-- Decision 0080.
--
-- NOT A MIGRATION, deliberately. Migrations run against every
-- customer's database, and this is one customer's configuration —
-- named stages, named rule sets, particular rules. Decision 0061's
-- seeding worked as a migration because it DERIVED from whatever data
-- was there; inserting 'Coding' by name would assert that every
-- customer's AP process has a Coding stage.
--
-- Run once, by the operator, against vf-app-poc. Reviewed before
-- running: it renumbers stages and moves rules between rule sets on a
-- live database.
--
--   npx wrangler d1 execute vf-app-poc --remote --file=docs/operations/ap-live-process-definition.sql
--
-- WHAT IT DOES NOT TOUCH: the ~35 process instances currently parked at
-- Approval. Instances reference current_stage_id by id, never by
-- sequence, so renumbering leaves them exactly where they are. On
-- completion they will advance to Review rather than Payment-eligible,
-- which is the new definition applying to documents already in flight
-- — correct, and worth knowing rather than discovering.

-- ---------------------------------------------------------------
-- 1. Renumber the existing stages to leave room.
--
-- sequence is UNIQUE per process (migration 0008's standing
-- invariant), so the existing rows move out of the way first. Done in
-- descending order: moving Approval to 5 before anything occupies 5.
-- ---------------------------------------------------------------
UPDATE process_stages SET sequence = 7 WHERE id = 'payment-eligible' AND process_id = 'ap-live';
UPDATE process_stages SET sequence = 5 WHERE id = 'approval' AND process_id = 'ap-live';
-- 'received' stays at 1.

-- ---------------------------------------------------------------
-- 2. The missing stages.
--
-- Matching, Coding and Review carry no rule set yet. A stage with no
-- rule set cascades straight through (workflow-engine.ts), so an
-- invoice passes them without stopping and they cost nothing today.
--
-- They are not decoration. A stage that exists is a valid RETURN
-- target (decision 0075), and returning to a stage that does not exist
-- is refused — which is why a return from Approval could previously
-- only reach 'received'.
-- ---------------------------------------------------------------
INSERT INTO process_stages (id, process_id, name, sequence, evaluation_scope)
VALUES
  ('validation', 'ap-live', 'Validation', 2, 'header'),
  -- Matching: for an invoice WITH a purchase order reference. Both
  -- invoices pass through; only one has anything to do here, which is
  -- the operator's own design and needs no branching (decision 0079).
  ('matching',   'ap-live', 'Matching',   3, 'header'),
  -- Coding: booking against a GL code. An invoice with a matched PO
  -- would inherit its booking information; one without needs coding,
  -- manually or from history.
  ('coding',     'ap-live', 'Coding',     4, 'header'),
  ('review',     'ap-live', 'Review',     6, 'header');

-- ---------------------------------------------------------------
-- 3. A rule set for Validation.
--
-- A stage points at ONE rule set, so splitting rules across stages
-- means splitting the set. all_matches to match the Approval set it is
-- taking rules from: every conflict rule should get its chance, not
-- just the first.
-- ---------------------------------------------------------------
INSERT INTO rule_sets (id, name, mode, status)
VALUES ('ap-live-validation', 'AP Live Validation', 'all_matches', 'active');

UPDATE process_stages SET rule_set_id = 'ap-live-validation'
WHERE id = 'validation' AND process_id = 'ap-live';

-- ---------------------------------------------------------------
-- 4. Move the rules that were never about approval.
--
-- Of the seven approved rules on ap-live-approval, ONE is genuinely an
-- approval rule — the over-1000 task. The rest are validation work:
-- three set_field conflict resolutions, a conflict task, and the
-- validation-failed task. They fired at Approval only because it was
-- the sole stage with a rule set.
--
-- Named individually rather than moved by a pattern. A rule set is
-- what a customer's rules are evaluated against, and moving one by
-- accident changes when it fires.
-- ---------------------------------------------------------------
UPDATE rules SET rule_set_id = 'ap-live-validation' WHERE id IN (
  'f45d062a-c907-464b-b558-823a29ac55e3',  -- set BT-112 from net total (disabled)
  '3941ff33-31a7-4945-b5d4-748674a637ae',  -- conflict on BT-112 -> task
  '96abd97c-e013-4f59-a404-4539c99ff8cc',  -- validation not passed -> task
  '51b36fe2-9a6e-4333-b342-ebafaea125ee',  -- set BT-112 from alternative
  'ae62781c-27c9-4cbe-8676-9100a4170c66',  -- set BT-106 from alternative
  'ef1c0f3d-abff-4b56-960a-4e46000a5787'   -- set BT-115 from alternative
);

-- cd03368d (over 1000 -> AP.Approve task) deliberately stays on
-- ap-live-approval. It is the only one that was ever an approval rule.
