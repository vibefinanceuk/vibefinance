-- 0237_partners.sql
-- Decision 0592 — partners, step 1 of slice 4 of the connector framework.
--
-- A partner (a system integrator) is its own record, created by
-- VibeFinance (Dan, 1 October 2026). Its people are named by email. It
-- serves the customers VibeFinance links it to: their Route library will
-- show its approved connectors (later steps). Its sandbox, where it
-- builds and tries connectors, is an ordinary customer record with
-- ordinary environments, so provisioning, credentials and access work
-- as for any customer; `sandbox_customer_id` says which.

CREATE TABLE partners (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  sandbox_customer_id TEXT NOT NULL UNIQUE REFERENCES customers(id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  created_by          TEXT,
  suspended_at        TEXT,
  suspended_by        TEXT,
  suspended_reason    TEXT
);

CREATE TABLE partner_people (
  partner_id TEXT NOT NULL REFERENCES partners(id),
  email      TEXT NOT NULL,
  added_at   TEXT NOT NULL DEFAULT (datetime('now')),
  added_by   TEXT,
  PRIMARY KEY (partner_id, email)
);
CREATE INDEX idx_partner_people_email ON partner_people(email);

CREATE TABLE partner_customers (
  partner_id  TEXT NOT NULL REFERENCES partners(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  linked_at   TEXT NOT NULL DEFAULT (datetime('now')),
  linked_by   TEXT,
  PRIMARY KEY (partner_id, customer_id)
);
CREATE INDEX idx_partner_customers_customer ON partner_customers(customer_id);

-- ASSERT: SELECT count(*) FROM partners == 0
