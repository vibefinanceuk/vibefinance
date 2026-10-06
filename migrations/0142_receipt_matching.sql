-- 0142_receipt_matching.sql
-- Decision 0652 — Warehouse Receipts, slice 3a: the built-in Matching
-- check, the AP Receiving task, and fixing a receipt's lines.
--
-- **A stage can carry a built-in check.** Matching in the Warehouse
-- Receipts process checks each line of a pending receipt against its
-- purchase order, as the screen does; a receipt with any line needing
-- attention stops there with one task. Not NLP rules: the rule
-- vocabulary is shaped around invoices.
ALTER TABLE process_stages ADD COLUMN builtin_check TEXT;
UPDATE process_stages SET builtin_check = 'receipt_matching' WHERE id = 'warehouse-receipts-matching';

-- **Each line's check, and a line rejected on its own.** `check_reason`
-- is what Matching last found (NULL when the line matched). A rejected
-- line stays, with its reason, and never counts.
ALTER TABLE goods_receipt_lines ADD COLUMN check_reason TEXT;
ALTER TABLE goods_receipt_lines ADD COLUMN line_status TEXT NOT NULL DEFAULT 'active' CHECK (line_status IN ('active', 'rejected'));
ALTER TABLE goods_receipt_lines ADD COLUMN reject_reason TEXT;

-- **Where the process is already set up (0651)**, Matching gains what
-- setting it up now gives: AP.Receive on the stage, and the AP Receiving
-- team (Dan agreed, question 3), in the AP team's unit or else the top
-- unit, with everyone who holds AP.Receive as a member.
UPDATE process_stages SET required_permission = 'AP.Receive' WHERE id = 'warehouse-receipts-matching' AND required_permission IS NULL;
INSERT INTO org_teams (id, name, unit_id)
  SELECT 'ap-receiving', 'AP Receiving', u.id
  FROM (SELECT COALESCE((SELECT unit_id FROM org_teams WHERE id = 'ap-team'), (SELECT id FROM org_units WHERE parent_unit_id IS NULL ORDER BY created_at, id LIMIT 1)) AS id) u
  WHERE u.id IS NOT NULL
    AND EXISTS (SELECT 1 FROM processes WHERE id = 'warehouse-receipts')
    AND NOT EXISTS (SELECT 1 FROM org_teams WHERE id = 'ap-receiving');
INSERT OR IGNORE INTO org_team_members (team_id, user_id)
  SELECT DISTINCT 'ap-receiving', ur.user_id FROM org_user_roles ur JOIN org_roles r ON r.id = ur.role_id
  WHERE EXISTS (SELECT 1 FROM org_teams WHERE id = 'ap-receiving')
    AND EXISTS (SELECT 1 FROM json_each(r.permissions_json) p WHERE p.value = 'AP.Receive');
