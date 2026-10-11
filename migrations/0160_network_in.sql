-- 0160_network_in.sql — decision 0726.
--
-- Invoice submission through the supplier network
-- (docs/design/supplier-portal.md): a source route, "Supplier network in",
-- that a customer adds to an invoice process like Email in or HTTPS in.
-- Suppliers create the invoice in the network as Peppol BIS Billing 3.0 UBL
-- (decision 0727); it reaches this instance over HTTPS, with a portal
-- access token rather than a source key, so the route's gateway is https
-- and its format UBL.
--
-- The source keeps mechanism 'https' (the closed set in 0027 is unchanged,
-- as Receipts in did in 0144); the route says which it is.
--
-- network_org_units_json: the companies the source accepts invoices for,
-- a JSON list of org unit ids, a company covering the units beneath it.
-- NULL accepts every company. A supplier still sees only the companies
-- their invitation covers.

INSERT INTO routes (id, direction, name, origin) VALUES
  ('network-in', 'source', 'Supplier network in', 'standard');

INSERT INTO route_versions (route_id, version, status, receiving_gateway, receiving_format, translation, delivery_format, delivery_gateway, published_at) VALUES
  ('network-in', 1, 'live', 'https', 'ubl', 'standard_intake', 'en16931', 'process', datetime('now'));

ALTER TABLE sources ADD COLUMN network_org_units_json TEXT;

-- ASSERT: SELECT count(*) FROM route_versions WHERE route_id = 'network-in' AND status = 'live' == 1
