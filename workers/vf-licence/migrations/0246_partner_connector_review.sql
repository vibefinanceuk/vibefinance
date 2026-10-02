-- 0246_partner_connector_review.sql
-- Decision 0600 — step 3 of slice 4: VibeFinance reviews each version a
-- partner submits (approved, or returned with a reason, recorded on the
-- version since 0241), and can suspend a whole connector.

ALTER TABLE partner_connectors ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended'));
ALTER TABLE partner_connectors ADD COLUMN suspended_at TEXT;
ALTER TABLE partner_connectors ADD COLUMN suspended_by TEXT;
ALTER TABLE partner_connectors ADD COLUMN suspended_reason TEXT;

-- ASSERT: SELECT count(*) FROM partner_connectors WHERE status != 'active' == 0
