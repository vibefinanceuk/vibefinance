-- 0012_branding.sql
-- Decision 0096 — a customer's livery, set by the operator.
--
-- **Why the control plane holds this.** The UI is one shared
-- deployment (decision 0083 section 3), so branding cannot be a
-- per-Worker config file. It has to be fetched — and decisively, **the
-- login screen needs branding BEFORE an instance has been chosen**, so
-- an instance cannot be the source for that moment.
--
-- `vf-licence` already knows which customer a person belongs to, and is
-- what the UI talks to first.
--
-- Document 3's constraint is that CONTROL_DB holds "customers, licences
-- and aggregate usage counts -- never customer content". Branding is
-- not content in the sense that record meant, though it is the first
-- thing stored here that is not purely commercial. Worth noting rather
-- than glossing.
CREATE TABLE customer_branding (
  customer_id     TEXT PRIMARY KEY REFERENCES customers(id),

  -- The five tokens `docs/design/mockups/tokens.css` separates from the
  -- structural ones. Deliberately few: **branding reaches tokens only,
  -- so a customer cannot break a screen** (operator-interface.md
  -- section 7). Spacing, type scale and layout are not theirs to set.
  --
  -- All nullable. Absent means the default livery, which is what every
  -- customer gets until somebody decides otherwise -- no row required.
  brand_bar       TEXT,
  brand_fill      TEXT,
  brand_chip      TEXT,
  brand_chip_text TEXT,

  -- What the product is called for this customer. A partner reselling
  -- it may want their own name here; that commercial layer belongs in
  -- the control plane for the same reason licences do.
  brand_name      TEXT,

  -- Set by the operator at provisioning, never by the customer
  -- (decision 0083 section 3). A customer-facing editor would need a
  -- scoped write path into the control plane, where the admin key is
  -- operator-only -- and it can be added later without moving where the
  -- values live.
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by      TEXT
);

-- Point-in-time: the table exists and is empty. Every customer starts
-- on the default livery.
-- ASSERT: SELECT count(*) FROM customer_branding == 0

-- Standing invariant: branding belongs to a real customer.
-- ASSERT ALWAYS: SELECT count(*) FROM customer_branding WHERE customer_id NOT IN (SELECT id FROM customers) == 0

-- Standing invariant: a colour is a CSS hex colour or absent, never
-- something else.
--
-- **This is an injection guard, not tidiness.** These values are
-- interpolated into a stylesheet the browser executes. A value like
-- `red; } body { display: none` would close the rule and open another,
-- and a customer's livery must not be able to rewrite a screen.
-- Validated in the route too; stated here so it holds however the row
-- arrived.
-- ASSERT ALWAYS: SELECT count(*) FROM customer_branding WHERE brand_bar IS NOT NULL AND brand_bar NOT GLOB '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]' == 0
-- ASSERT ALWAYS: SELECT count(*) FROM customer_branding WHERE brand_fill IS NOT NULL AND brand_fill NOT GLOB '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]' == 0
-- ASSERT ALWAYS: SELECT count(*) FROM customer_branding WHERE brand_chip IS NOT NULL AND brand_chip NOT GLOB '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]' == 0
-- ASSERT ALWAYS: SELECT count(*) FROM customer_branding WHERE brand_chip_text IS NOT NULL AND brand_chip_text NOT GLOB '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]' == 0

-- Standing invariant: a brand name carries no character that could
-- escape the CSS string it is written into. Same reasoning as the
-- colours, different alphabet.
-- ASSERT ALWAYS: SELECT count(*) FROM customer_branding WHERE brand_name IS NOT NULL AND (brand_name GLOB '*"*' OR brand_name GLOB '*\*' OR brand_name GLOB '*;*' OR brand_name GLOB '*}*' OR trim(brand_name) = '') == 0
