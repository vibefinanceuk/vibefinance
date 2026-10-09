-- 0156_sender_lookup_index.sql — decision 0703.
--
-- An emailed invoice's supplier is worked out from who sent it, before it is
-- read, so the reading can be told what that supplier's invoices look like:
-- earlier invoices from the same address, compared without case.

CREATE INDEX IF NOT EXISTS idx_route_messages_counterparty ON route_messages(lower(counterparty));

-- ASSERT: SELECT count(*) FROM sqlite_master WHERE name = 'idx_route_messages_counterparty' == 1
