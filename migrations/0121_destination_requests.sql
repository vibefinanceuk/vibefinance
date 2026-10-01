-- 0121_destination_requests.sql
-- Decision 0588 — a rule can send an invoice to a Destination: "invoices
-- for project-only suppliers also go to Oracle Projects". Recorded when
-- the rule fires; the Destination then takes the invoice as well as
-- those its business units cover (0587), once it is payment-eligible.

CREATE TABLE destination_requests (
  invoice_id   TEXT NOT NULL REFERENCES invoice_headers(id),
  instance_id  TEXT NOT NULL REFERENCES route_instances(id),
  rule_id      TEXT,
  requested_at TEXT NOT NULL,
  PRIMARY KEY (invoice_id, instance_id)
);
CREATE INDEX idx_destination_requests_instance ON destination_requests(instance_id);

-- ASSERT: SELECT count(*) FROM destination_requests == 0
-- ASSERT ALWAYS: SELECT count(*) FROM destination_requests r JOIN route_instances i ON i.id = r.instance_id WHERE i.source_id IS NOT NULL == 0
