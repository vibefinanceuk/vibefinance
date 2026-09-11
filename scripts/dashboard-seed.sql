-- ============================================================
-- Dashboard seed data — tagged `seed:`, and removable.
-- ============================================================
--
-- **Every row this creates has an id beginning `seed:`**, so the block
-- at the bottom removes all of it and nothing else. Run that first if
-- you are re-seeding.
--
-- It uses **your own stages** rather than naming any, because
-- `process_stages` is customer data (decision 0008) and a seed that
-- hardcoded *Validation* would be wrong the moment you renamed one.
--
--   npx wrangler d1 execute vf-app-poc --remote --file=dashboard-seed.sql
--
-- **Read the block at the end before running.** It is the undo, and it
-- is commented out.

-- ------------------------------------------------------------
-- Remove any previous seed, so this is safe to run twice.
-- ------------------------------------------------------------
DELETE FROM tasks WHERE id LIKE 'seed:%';
DELETE FROM stage_visits WHERE id LIKE 'seed:%';
DELETE FROM process_instances WHERE id LIKE 'seed:%';
DELETE FROM invoice_lines WHERE id LIKE 'seed:%';
DELETE FROM invoice_headers WHERE id LIKE 'seed:%';

-- ------------------------------------------------------------
-- Twenty-four invoices, spread across suppliers, values and dates.
-- ------------------------------------------------------------
--
-- **Due dates straddle today**, because the worklist shows two clocks
-- and they only disagree if some invoices are overdue and others are
-- not (decision 0239).
INSERT INTO invoice_headers (id, supplier_vat_id, currency, issue_date, total_with_vat, facts_json, org_unit_id, org_assigned_by, supplier_id, created_at)
SELECT
  'seed:inv-' || n,
  s.vat_id,
  'GBP',
  date('now', '-' || (n * 2) || ' days'),
  -- Spread of values, so "highest value" sorts to something.
  round(120.0 + (n * n * 37.5), 2),
  json_object(
    'BT-1',  'SEED-' || printf('%04d', n),
    'BT-27', s.name,
    'BT-31', s.vat_id,
    -- **`printf('%+d')`, because `'+' || -10` is `'+-10 days'`** and
    -- SQLite returns null rather than complaining — which showed up as
    -- an invoice with no due date at all.
    'BT-9',  date('now', printf('%+d days', 18 - n)),
    'BT-5',  'GBP',
    'supplier.matched', 1,
    'supplier.onHold', CASE WHEN s.on_hold = 1 THEN 1 ELSE 0 END,
    'supplier.awaitingErp', CASE WHEN s.erp_identifier IS NULL THEN 1 ELSE 0 END,
    -- A few look like duplicates, so "needs somebody" has something.
    'invoice.duplicate_confidence', CASE WHEN n IN (7, 19) THEN 0.82 ELSE 0.1 END
  ),
  (SELECT id FROM org_units WHERE kind = 'legal_entity' ORDER BY id LIMIT 1),
  'source',
  s.id,
  datetime('now', '-' || (n % 7) || ' days')
FROM (
  WITH RECURSIVE counter(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM counter WHERE n < 24)
  SELECT n FROM counter
) AS numbers
JOIN (
  -- Round-robin across whatever suppliers you have.
  SELECT id, name, vat_id, on_hold, erp_identifier,
         row_number() OVER (ORDER BY name) - 1 AS seq,
         count(*) OVER () AS total
  FROM suppliers WHERE status = 'active'
) AS s ON s.seq = (numbers.n % s.total);

-- ------------------------------------------------------------
-- A process instance each, spread across your stages.
-- ------------------------------------------------------------
--
-- **Weighted rather than even**, because a real queue is not flat and a
-- donut of six equal slices says nothing (decision 0247).
INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status, created_at)
SELECT
  'seed:pi-' || h.id,
  st.process_id,
  'invoice',
  h.id,
  st.id,
  'in_progress',
  h.created_at
FROM invoice_headers h
JOIN (
  SELECT id, process_id,
         row_number() OVER (ORDER BY sequence) - 1 AS seq,
         count(*) OVER () AS total
  FROM process_stages
) AS st
  ON st.seq = (
    -- A lumpy spread: more at the later stages, as a real backlog is.
    CASE CAST(substr(h.id, 10) AS INTEGER) % 9
      WHEN 0 THEN 0 WHEN 1 THEN 0
      WHEN 2 THEN 1
      WHEN 3 THEN 2 WHEN 4 THEN 2
      ELSE 3
    END % st.total
  )
WHERE h.id LIKE 'seed:%';

-- ------------------------------------------------------------
-- A stage visit each, a third of them failing validation.
-- ------------------------------------------------------------
--
-- **So "exceptions by supplier" has something to count**, and the
-- reasons repeat the way real ones do.
INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome, validation_passed, validation_failures, created_at)
SELECT
  'seed:v-' || pi.id,
  pi.id,
  pi.current_stage_id,
  'matched',
  -- **Uneven on purpose.** Round-robin across suppliers gave every one
  -- the same count, and a bar list of 2-2-2-2 says nothing: the card
  -- exists to name *which* supplier sends work.
  CASE WHEN CAST(substr(pi.subject_id, 10) AS INTEGER) IN (1, 5, 9, 13, 17, 21, 3, 11, 19, 8, 16)
       THEN 0 ELSE 1 END,
  CASE WHEN CAST(substr(pi.subject_id, 10) AS INTEGER) IN (1, 5, 9, 13, 17, 21, 3, 11, 19, 8, 16)
    THEN json_array(
      CASE CAST(substr(pi.subject_id, 10) AS INTEGER) % 4
        WHEN 1 THEN 'missing purchase order reference'
        WHEN 3 THEN 'net plus VAT does not equal the total'
        ELSE 'no line detail'
      END)
    ELSE NULL END,
  pi.created_at
FROM process_instances pi
WHERE pi.id LIKE 'seed:%';

-- ------------------------------------------------------------
-- Tasks: some mine, some claimed, some on a team, some finished.
-- ------------------------------------------------------------
--
-- **Spread over forty days**, so the ageing buckets are not one bar and
-- four zeroes — which is what the live dashboard shows today.
--
-- `owner_user_id` and `claimed_by` are set to the first real person,
-- because *"on my clock"* means assigned to me or claimed by me and not
-- a team queue (decision 0239).
INSERT INTO tasks (id, stage_id, stage_visit_id, owner_user_id, owner_team_id, claimed_by, claimed_at, completed_by, completed_at, required_permission, status, created_at)
SELECT
  'seed:t-' || pi.id,
  pi.current_stage_id,
  'seed:v-' || pi.id,
  -- Assigned to me: every third.
  CASE WHEN n % 3 = 0 THEN me.id ELSE NULL END,
  -- On a team: every third, offset.
  CASE WHEN n % 3 = 1 THEN (SELECT id FROM org_teams ORDER BY id LIMIT 1) ELSE NULL END,
  -- Claimed by me: every third, offset again.
  CASE WHEN n % 3 = 2 THEN me.id ELSE NULL END,
  CASE WHEN n % 3 = 2 THEN datetime('now', '-' || (n % 12) || ' days') ELSE NULL END,
  -- A handful finished, so "done" is not three zeroes.
  CASE WHEN n > 18 THEN me.id ELSE NULL END,
  CASE WHEN n > 18 THEN datetime('now', '-' || (n % 6) || ' days') ELSE NULL END,
  'AP.Validate',
  CASE WHEN n > 18 THEN 'completed' ELSE 'open' END,
  -- **The ageing spread.** A few ancient, most recent.
  datetime('now', '-' || (
    CASE n % 8
      WHEN 0 THEN 45 WHEN 1 THEN 33
      WHEN 2 THEN 12 WHEN 3 THEN 9
      WHEN 4 THEN 5  WHEN 5 THEN 2
      ELSE 0
    END) || ' days')
FROM process_instances pi
CROSS JOIN (SELECT id FROM org_users ORDER BY created_at LIMIT 1) AS me
JOIN (
  SELECT id, CAST(substr(subject_id, 10) AS INTEGER) AS n
  FROM process_instances WHERE id LIKE 'seed:%'
) AS numbered ON numbered.id = pi.id
WHERE pi.id LIKE 'seed:%';

-- ------------------------------------------------------------
-- Three unplaced documents, for "needs somebody".
-- ------------------------------------------------------------
--
-- **No org unit and a reason**, which is what decision 0204 records and
-- nothing else on any screen reads.
INSERT INTO invoice_headers (id, currency, issue_date, total_with_vat, facts_json, created_at)
VALUES
  ('seed:unplaced-1', 'GBP', date('now', '-3 days'), 410.00,
   json_object('BT-27', 'Unknown Supplier Ltd', 'org.unplaced', 'no_match'), datetime('now', '-3 days')),
  ('seed:unplaced-2', 'EUR', date('now', '-6 days'), 1290.50,
   json_object('BT-27', 'Etwas GmbH', 'org.unplaced', 'no_identifier'), datetime('now', '-6 days')),
  ('seed:unplaced-3', 'GBP', date('now', '-1 days'), 88.00,
   json_object('BT-27', 'A New Supplier', 'org.unplaced', 'no_match'), datetime('now', '-1 days'));

-- ------------------------------------------------------------
-- What you should see afterwards.
-- ------------------------------------------------------------
-- SELECT 'invoices', count(*) FROM invoice_headers WHERE id LIKE 'seed:%'
-- UNION ALL SELECT 'open tasks', count(*) FROM tasks WHERE id LIKE 'seed:%' AND status = 'open'
-- UNION ALL SELECT 'mine', count(*) FROM tasks WHERE id LIKE 'seed:%' AND status = 'open'
--     AND (owner_user_id IS NOT NULL OR claimed_by IS NOT NULL)
-- UNION ALL SELECT 'stages used', count(DISTINCT current_stage_id) FROM process_instances WHERE id LIKE 'seed:%';

-- ============================================================
-- THE UNDO. Run this to remove everything above and nothing else.
-- ============================================================
--
-- DELETE FROM tasks WHERE id LIKE 'seed:%';
-- DELETE FROM stage_visits WHERE id LIKE 'seed:%';
-- DELETE FROM process_instances WHERE id LIKE 'seed:%';
-- DELETE FROM invoice_lines WHERE id LIKE 'seed:%';
-- DELETE FROM invoice_headers WHERE id LIKE 'seed:%';
