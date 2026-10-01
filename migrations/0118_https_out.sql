-- 0118_https_out.sql
-- Decision 0585 — HTTPS out and the delivery engine (connector framework,
-- slice 1). A standard Destination route that posts each payment-eligible
-- invoice to an address the customer gives, with retries, the target's
-- own reference kept, and every request and reply in the Route monitor.

INSERT INTO routes (id, direction, name, origin) VALUES ('https-out', 'destination', 'HTTPS out', 'standard');
INSERT INTO route_versions (route_id, version, status, receiving_gateway, receiving_format, translation, delivery_format, delivery_gateway, published_at, note)
VALUES ('https-out', 1, 'live', 'process', 'en16931', 'vf_invoice_json_v1', 'en16931', 'https', datetime('now'), 'Decision 0585: HTTPS out');

-- When a Destination first started sending: what was already waiting then
-- was sent, or set aside, by the person who started it — never by itself.
ALTER TABLE route_instances ADD COLUMN started_at TEXT;
UPDATE route_instances SET started_at = created_at WHERE route_id = 'erp-csv';

-- A connector's secrets (a token, a password, a client secret): encrypted
-- with AES-GCM under the CONNECTOR_SECRETS_KEY Worker secret, never
-- returned once set.
CREATE TABLE connector_secrets (
  instance_id TEXT NOT NULL REFERENCES route_instances(id),
  name        TEXT NOT NULL,
  value_enc   TEXT NOT NULL,
  set_at      TEXT NOT NULL,
  set_by      TEXT REFERENCES org_users(id),
  PRIMARY KEY (instance_id, name)
);

-- One delivery per invoice per Destination: never sent twice.
CREATE TABLE destination_deliveries (
  instance_id     TEXT NOT NULL REFERENCES route_instances(id),
  invoice_id      TEXT NOT NULL REFERENCES invoice_headers(id),
  status          TEXT NOT NULL CHECK (status IN ('pending', 'retrying', 'delivered', 'failed', 'skipped')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_status     INTEGER,
  last_error      TEXT,
  message_id      TEXT REFERENCES route_messages(id),
  reference       TEXT,
  created_at      TEXT NOT NULL,
  delivered_at    TEXT,
  PRIMARY KEY (instance_id, invoice_id)
);
CREATE INDEX idx_destination_deliveries_due ON destination_deliveries(status, next_attempt_at);

-- ASSERT: SELECT count(*) FROM route_versions WHERE route_id = 'https-out' AND status = 'live' == 1
-- ASSERT: SELECT count(*) FROM destination_deliveries == 0
-- ASSERT ALWAYS: SELECT count(*) FROM destination_deliveries WHERE status = 'delivered' AND delivered_at IS NULL == 0
-- ASSERT ALWAYS: SELECT count(*) FROM destination_deliveries WHERE status IN ('pending', 'retrying') AND next_attempt_at IS NULL == 0
