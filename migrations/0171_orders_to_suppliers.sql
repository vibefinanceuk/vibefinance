-- 0171_orders_to_suppliers.sql — decision 0759.
--
-- **Orders to suppliers**, slice 4a of purchase orders: a Destination on
-- the Purchase Orders process that emails each released order, change and
-- cancellation to the supplier, with the order as a Peppol BIS Order 3 UBL
-- file, automatically on release or by hand from the order.
--
-- Who it goes to, in a fixed order (Dan, 13 October 2026): the address the
-- order itself gives for the supplier; else the supplier's orders address;
-- else the supplier's general email; else it waits, saying there is none.

-- The standard Destination route: from the process, as UBL, by email.
INSERT INTO routes (id, direction, name, origin) VALUES ('orders-email-out', 'destination', 'Orders to suppliers', 'standard');
INSERT INTO route_versions (route_id, version, status, receiving_gateway, receiving_format, translation, delivery_format, delivery_gateway, semantic_model, published_at, note)
VALUES ('orders-email-out', 1, 'live', 'process', 'ubl', 'purchase_order_v1', 'ubl', 'email', 'purchase_order', datetime('now'), 'Decision 0759: Orders to suppliers');

-- The address the order gives for the supplier: UBL's seller contact
-- (SellerSupplierParty/Party/Contact/ElectronicMail), or the order CSV's
-- "Supplier email" column. Written with the order, as its other facts are.
ALTER TABLE purchase_orders ADD COLUMN supplier_email TEXT;

-- The supplier's address for orders, apart from its general email (0219):
-- suppliers often have orders@ and accounts@. One or more, comma-separated.
ALTER TABLE suppliers ADD COLUMN orders_email TEXT;
-- Whether VibeFinance emails this supplier its orders. 0 where the
-- customer's own procurement system already sends them. VibeFinance's own
-- setting: a supplier load leaves it as set.
ALTER TABLE suppliers ADD COLUMN send_orders INTEGER NOT NULL DEFAULT 1 CHECK (send_orders IN (0, 1));

-- **One send of one version of an order.** An automatic send names the
-- order on its way in that was released (its intake); a send by hand
-- names the version in force then, or none for an order loaded before
-- orders came in by route. Never automatically twice for one release.
CREATE TABLE purchase_order_sends (
  id              TEXT PRIMARY KEY,
  instance_id     TEXT NOT NULL REFERENCES route_instances(id),
  order_number    TEXT NOT NULL,
  intake_id       TEXT REFERENCES purchase_order_intake(id),
  kind            TEXT NOT NULL CHECK (kind IN ('order', 'change', 'cancellation')),
  how             TEXT NOT NULL CHECK (how IN ('on_release', 'by_hand')),
  status          TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'no_address', 'not_sent')),
  -- Who it went to, and which of the four the address came from.
  recipients_json TEXT,
  address_from    TEXT CHECK (address_from IS NULL OR address_from IN ('order', 'orders_email', 'supplier_email', 'given')),
  message_id      TEXT REFERENCES route_messages(id),
  email_id        TEXT,
  error           TEXT,
  sent_by         TEXT REFERENCES org_users(id),
  created_at      TEXT NOT NULL,
  CHECK ((status = 'sent') = (recipients_json IS NOT NULL AND message_id IS NOT NULL))
);
CREATE INDEX idx_po_sends_order ON purchase_order_sends(order_number, created_at);
CREATE UNIQUE INDEX idx_po_sends_release ON purchase_order_sends(instance_id, intake_id) WHERE how = 'on_release' AND intake_id IS NOT NULL;

-- ASSERT: SELECT count(*) FROM route_versions WHERE route_id = 'orders-email-out' AND status = 'live' == 1
-- ASSERT: SELECT count(*) FROM suppliers WHERE send_orders != 1 == 0
-- ASSERT ALWAYS: SELECT count(*) FROM purchase_order_sends WHERE (status = 'sent') != (recipients_json IS NOT NULL AND message_id IS NOT NULL) == 0
