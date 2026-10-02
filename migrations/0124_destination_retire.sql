-- 0124_destination_retire.sql
-- Decision 0597 — renaming and retiring a Destination, as a Source can be.
-- A retired Destination sends nothing more; what it sent is kept, with when
-- and by whom it was retired.

ALTER TABLE route_instances ADD COLUMN retired_at TEXT;
ALTER TABLE route_instances ADD COLUMN retired_by TEXT;

-- ASSERT: SELECT count(*) FROM route_instances WHERE retired_at IS NOT NULL == 0
