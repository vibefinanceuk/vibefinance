-- 0122_instance_connectors.sql
-- Decision 0589 — the connector library. A route instance records the
-- connector it was made from, and that connector's version, so a later
-- version can be offered as an upgrade. Null is the route's own standard
-- connector (same id), version 1: every instance made before the library.

ALTER TABLE route_instances ADD COLUMN connector_id TEXT;
ALTER TABLE route_instances ADD COLUMN connector_version INTEGER;

-- ASSERT: SELECT count(*) FROM route_instances WHERE connector_id IS NOT NULL OR connector_version IS NOT NULL == 0
