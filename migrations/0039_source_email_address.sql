-- 0039_source_email_address.sql
-- Decision 0126 — an address a supplier can send an invoice to.
--
-- A source has carried `mechanism: 'email'` since decision 0060 and
-- **no address**, so "this customer receives invoices by email" has
-- been a statement about intent rather than a thing that works.
--
-- **The local part is `<name>.<customer>`**, and the customer rather
-- than the environment is deliberate: decision 0118 provisions a
-- *second* environment when a trial becomes production, and an address
-- naming the sandbox would have to be reissued to every supplier on the
-- day a customer goes live. The customer id is stable across both.
--
-- Fleet-uniqueness follows from that without a registry, because a
-- customer id is unique across the fleet and the address contains it.

-- The full address, stored rather than derived.
--
-- **Derived would be cheaper and wrong.** A Cloudflare Email Routing
-- rule will exist naming this exact string (decision 0125), and a
-- formula that changed later would silently stop matching a rule
-- somebody's suppliers are already writing to. The address is a fact
-- about the world once it is issued.
ALTER TABLE sources ADD COLUMN email_address TEXT;

-- Whether mail actually reaches this instance yet.
--
-- **Honest about the half that is not built.** Creating the routing
-- rule needs the Cloudflare API, which is the unbuilt half of decision
-- 0039 — so an address can be configured and reserved before anything
-- can deliver to it. Saying so is the same discipline as
-- `infrastructureProvisioned: false`: a configuration screen that
-- implied mail was arriving would be worse than one that admits it is
-- not.
ALTER TABLE sources ADD COLUMN email_routing TEXT NOT NULL DEFAULT 'not_configured'
  CHECK (email_routing IN ('not_configured', 'active', 'suspended'));

-- One address, one source. Two sources sharing an address would make
-- "which process does this invoice enter" unanswerable.
CREATE UNIQUE INDEX idx_sources_email_address ON sources(email_address)
  WHERE email_address IS NOT NULL;

-- Point-in-time: no source has an address yet.
-- ASSERT: SELECT count(*) FROM sources WHERE email_address IS NOT NULL == 0

-- Standing invariant: only an email source has an email address.
-- An SFTP source carrying a mailbox would be a configuration nobody
-- could act on, and a report of "where can documents arrive" would read
-- it as real.
-- ASSERT ALWAYS: SELECT count(*) FROM sources WHERE email_address IS NOT NULL AND mechanism != 'email' == 0

-- Standing invariant: routing is only ever claimed for a source that
-- has an address. 'active' with no address would tell an operator mail
-- is arriving somewhere nobody can name.
-- ASSERT ALWAYS: SELECT count(*) FROM sources WHERE email_routing != 'not_configured' AND email_address IS NULL == 0

-- Standing invariant: an address is lower-case.
--
-- The local part of an address is case-sensitive by RFC 5321 and case-
-- INSENSITIVE in every practical mail system, so storing two casings
-- would make the unique index above enforce nothing.
-- ASSERT ALWAYS: SELECT count(*) FROM sources WHERE email_address IS NOT NULL AND email_address != lower(email_address) == 0
