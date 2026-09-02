-- 0006_signup_requests.sql
-- Decision 0038 — the self-serve trial request stage, and the human
-- approval checkpoint in front of provisioning.
--
-- The real flow this serves: a prospective customer fills in a form
-- on the website ("Request a 30-day free trial ... a member of our
-- provisioning team will be in contact"). The request lands here as
-- 'pending'. A real person then reviews it, typically reaching the
-- requester by email to discuss their project and provide enablement,
-- documentation and training — none of which this table models,
-- deliberately: that conversation lives in email, not in the control
-- plane. Only the decision and its outcome are recorded here.
--
-- Approval TRIGGERS provisioning; it is not itself provisioning.
-- Deliberately decoupled (the operator's own framing) so the two can
-- fail, be retried, and evolve independently — a request can sit
-- approved-but-not-yet-provisioned as a real, legible state, rather
-- than approval being an all-or-nothing action that either fully
-- succeeds or leaves no trace.
CREATE TABLE signup_requests (
  id             TEXT PRIMARY KEY,
  -- What the requester typed into the form. company_name is not
  -- assumed to be a valid customer id, and is never used as one —
  -- the real customers.id is chosen by the operator at approval time.
  company_name   TEXT NOT NULL,
  contact_name   TEXT NOT NULL,
  contact_email  TEXT NOT NULL,
  -- Free text from the form, e.g. "we process ~400 supplier invoices
  -- a month, mostly Peppol". Nullable: a real form field a requester
  -- may reasonably leave blank.
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected')),
  -- Deliberately NOT unique on contact_email or company_name: a
  -- rejected request must never block a future signup from the same
  -- person or company (the operator's own requirement). Someone
  -- rejected today can genuinely come back in six months.
  requested_at   TEXT NOT NULL DEFAULT (datetime('now')),
  -- Both NULL until a real decision is made. decided_by is the
  -- authenticated operator, never a value supplied in a request body
  -- — the same derived-identity discipline decision 0010 already
  -- established for rule approval in vf-app.
  decided_at     TEXT,
  decided_by     TEXT,
  -- Set only on approval, once the customer and environment this
  -- request produced actually exist. NULL on a pending or rejected
  -- request, and NULL on an approved request whose provisioning
  -- hasn't run yet — the decoupling above made visible in the data.
  customer_id    TEXT REFERENCES customers(id),
  environment_id TEXT REFERENCES environments(id)
);

-- Point-in-time: empty at the moment this migration finishes.
-- ASSERT: SELECT count(*) FROM signup_requests == 0

-- Standing invariant: status is always one of the three real values
-- the routes and this schema both understand.
-- ASSERT ALWAYS: SELECT count(*) FROM signup_requests WHERE status NOT IN ('pending', 'approved', 'rejected') == 0

-- Standing invariant: a decided request always records both when and
-- by whom — never one without the other, which would mean a bug in
-- the decision path wrote a partial record.
-- ASSERT ALWAYS: SELECT count(*) FROM signup_requests WHERE status IN ('approved', 'rejected') AND (decided_at IS NULL OR decided_by IS NULL) == 0

-- Standing invariant: a pending request has never been decided.
-- ASSERT ALWAYS: SELECT count(*) FROM signup_requests WHERE status = 'pending' AND (decided_at IS NOT NULL OR decided_by IS NOT NULL) == 0

-- Standing invariant: only an approved request may ever point at a
-- real customer or environment. A rejected or pending request linked
-- to provisioned infrastructure would mean approval and provisioning
-- got out of step in a way that matters.
-- ASSERT ALWAYS: SELECT count(*) FROM signup_requests WHERE status != 'approved' AND (customer_id IS NOT NULL OR environment_id IS NOT NULL) == 0

-- Standing invariant: the two provisioning links are set together or
-- not at all — a request pointing at a customer but no environment
-- (or the reverse) is a half-recorded provisioning result.
-- ASSERT ALWAYS: SELECT count(*) FROM signup_requests WHERE (customer_id IS NULL) != (environment_id IS NULL) == 0

-- Standing invariant: every provisioning link points at something
-- real — the same shape as every other FK invariant in this chain.
-- ASSERT ALWAYS: SELECT count(*) FROM signup_requests WHERE customer_id IS NOT NULL AND customer_id NOT IN (SELECT id FROM customers) == 0
-- ASSERT ALWAYS: SELECT count(*) FROM signup_requests WHERE environment_id IS NOT NULL AND environment_id NOT IN (SELECT id FROM environments) == 0
