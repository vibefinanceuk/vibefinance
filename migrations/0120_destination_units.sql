-- 0120_destination_units.sql
-- Decision 0587 — which business units a Destination sends for. A large
-- customer may run more than one ERP: each Destination covers the units
-- chosen (and every unit beneath each), or all of them when none is
-- chosen, as every Destination did before.

ALTER TABLE route_instances ADD COLUMN unit_ids TEXT;

-- ASSERT: SELECT count(*) FROM route_instances WHERE unit_ids IS NOT NULL == 0
-- Only a Destination covers units; a Source's unit is its own default (0204).
-- ASSERT ALWAYS: SELECT count(*) FROM route_instances WHERE unit_ids IS NOT NULL AND source_id IS NOT NULL == 0
