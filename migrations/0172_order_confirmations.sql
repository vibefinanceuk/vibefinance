-- 0172_order_confirmations.sql — decision 0762.
--
-- **The supplier confirms it has the order**, slice 4c of purchase orders.
-- Each order emailed to the supplier carries a link of its own. Opening it
-- in a browser confirms that version of the order and goes on to the
-- supplier network. A supplier who never saw the email confirms on the
-- order there instead (Dan, 13 October 2026).
--
-- A confirmation is of one version: the order as first released, or a
-- change or cancellation released after it. A change needs confirming
-- again; an earlier email's link still confirms only the version it sent.

-- The link's secret, as a SHA-256 hash: the link itself is only in the email.
ALTER TABLE purchase_order_sends ADD COLUMN confirm_token_hash TEXT;
CREATE UNIQUE INDEX idx_po_sends_confirm ON purchase_order_sends(confirm_token_hash) WHERE confirm_token_hash IS NOT NULL;

CREATE TABLE purchase_order_confirmations (
  id            TEXT PRIMARY KEY,
  order_number  TEXT NOT NULL,
  -- The version confirmed: its release, or none for an order loaded without one.
  intake_id     TEXT REFERENCES purchase_order_intake(id),
  kind          TEXT NOT NULL CHECK (kind IN ('order', 'change', 'cancellation')),
  -- The email whose link confirmed it; none when confirmed in the supplier network.
  send_id       TEXT REFERENCES purchase_order_sends(id),
  how           TEXT NOT NULL CHECK (how IN ('link', 'network')),
  -- The supplier's person, when confirmed in the supplier network.
  by_email      TEXT,
  -- The browser that opened the link, kept so a confirmation made by a mail scanner can be told apart.
  user_agent    TEXT,
  created_at    TEXT NOT NULL,
  CHECK ((how = 'link') = (send_id IS NOT NULL))
);
-- Once per version.
CREATE UNIQUE INDEX idx_po_confirm_version ON purchase_order_confirmations(order_number, COALESCE(intake_id, ''));

-- ASSERT: SELECT count(*) FROM purchase_order_sends WHERE confirm_token_hash IS NOT NULL == 0
-- ASSERT ALWAYS: SELECT count(*) FROM purchase_order_confirmations WHERE (how = 'link') != (send_id IS NOT NULL) == 0
