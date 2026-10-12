-- 0167_order_checking.sql
-- Decision 0750 — purchase orders, slice 2: Checking's own check, the
-- Purchasing team's tasks, changes and cancellations.

-- **What an order on its way in is.** A whole order (as before), a change
-- to the order in force (an Order Change, or the same number sent again),
-- or a cancellation of it.
ALTER TABLE purchase_order_intake ADD COLUMN kind TEXT NOT NULL DEFAULT 'order' CHECK (kind IN ('order', 'change', 'cancellation'));
UPDATE purchase_order_intake SET kind = 'change' WHERE is_change = 1;
-- What Checking found, as a list of problems, each with the lines it is
-- about; empty when it passed.
ALTER TABLE purchase_order_intake ADD COLUMN check_json TEXT;
-- Released anyway, by a person who saw what Checking found.
ALTER TABLE purchase_order_intake ADD COLUMN release_override INTEGER NOT NULL DEFAULT 0 CHECK (release_override IN (0, 1));
ALTER TABLE purchase_order_intake ADD COLUMN released_by TEXT REFERENCES org_users(id);
-- A cancellation's reason, or an Order Change's own id and sequence.
ALTER TABLE purchase_order_intake ADD COLUMN note TEXT;
ALTER TABLE purchase_order_intake ADD COLUMN change_reference TEXT;
ALTER TABLE purchase_order_intake ADD COLUMN sequence_number TEXT;

-- **Where the process is already set up (0749)**, Checking gains what
-- setting it up now gives: its own check, AP.Purchasing on its tasks, and
-- the Purchasing team, in the AP team's unit or else the top unit, with
-- everyone who holds AP.Purchasing as a member.
UPDATE process_stages SET builtin_check = 'order_checking', required_permission = 'AP.Purchasing'
  WHERE id = 'purchase-orders-checking' AND builtin_check IS NULL;
INSERT INTO org_teams (id, name, unit_id)
  SELECT 'purchasing', 'Purchasing', u.id
  FROM (SELECT COALESCE((SELECT unit_id FROM org_teams WHERE id = 'ap-team'), (SELECT id FROM org_units WHERE parent_unit_id IS NULL ORDER BY created_at, id LIMIT 1)) AS id) u
  WHERE u.id IS NOT NULL
    AND EXISTS (SELECT 1 FROM processes WHERE id = 'purchase-orders')
    AND NOT EXISTS (SELECT 1 FROM org_teams WHERE id = 'purchasing');
INSERT OR IGNORE INTO org_team_members (team_id, user_id)
  SELECT DISTINCT 'purchasing', ur.user_id FROM org_user_roles ur JOIN org_roles r ON r.id = ur.role_id
  WHERE EXISTS (SELECT 1 FROM org_teams WHERE id = 'purchasing')
    AND EXISTS (SELECT 1 FROM json_each(r.permissions_json) p WHERE p.value = 'AP.Purchasing');
