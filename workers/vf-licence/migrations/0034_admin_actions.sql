-- 0034_admin_actions.sql
-- Decision 0140 — who did what, in the control plane.
--
-- **Seven routes are admin-gated and two record who acted.**
-- `/signup-requests` writes `decided_by`; everything else — creating a
-- customer, issuing a licence, minting a credential, granting somebody
-- access to an environment, rewriting the fleet's own wording —
-- records nothing at all.
--
-- ISO 27001 **A.8.15** asks that privileged operations be logged.
-- SOC 2 **CC7.2** asks the same. And because an approval decides
-- whether a business gets an accounts-payable system, **SOC 1** has an
-- interest too: the control that matters is not that somebody was
-- allowed, but that it can be shown afterwards who allowed it.
--
-- `intake_capture_events` is the precedent (decision 0055): every
-- arrival recorded whether or not it succeeded, because a system that
-- logs only its successes cannot answer the question anybody actually
-- asks.

CREATE TABLE admin_actions (
  id TEXT PRIMARY KEY,

  -- **Who, verified rather than claimed.**
  --
  -- Today `decided_by` on a signup request is whatever the caller sent,
  -- and `signup-route.ts` says so honestly: the admin key is a single
  -- shared secret, so vf-licence cannot tell who is acting. That was
  -- right for one operator with curl and it is not attribution.
  --
  -- This holds an identity the route established — an email from a
  -- verified Cloudflare Access assertion (decision 0140) — or the
  -- literal 'admin-key' where no better identity was available, which
  -- is a fact worth recording rather than a gap worth hiding.
  actor TEXT NOT NULL,

  -- How that identity was established, so a reader can weigh it.
  -- 'access' is a verified assertion; 'admin-key' means the shared
  -- secret and nothing more.
  actor_source TEXT NOT NULL CHECK (actor_source IN ('access', 'admin-key')),

  -- What was done, and to what. `action` is a route's own name for
  -- itself; `subject` is the thing it acted on.
  action TEXT NOT NULL,
  subject TEXT,

  -- **Refusals too.** A log of successes cannot answer "did anybody try
  -- to provision a customer we rejected", which is exactly what an
  -- auditor asks.
  outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'refused')),
  status_code INTEGER NOT NULL,

  -- What the route was asked to do, for a reader who needs more than
  -- the verb. **Never a secret**: decision 0009 is this project's own
  -- record of key material reaching a place nobody expected, and a log
  -- is exactly such a place.
  detail TEXT,

  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_admin_actions_occurred ON admin_actions(occurred_at DESC);
CREATE INDEX idx_admin_actions_actor ON admin_actions(actor, occurred_at DESC);

-- Point-in-time: nothing has been recorded yet.
-- ASSERT: SELECT count(*) FROM admin_actions == 0

-- Standing invariant: an actor is never blank.
--
-- **A log with an empty actor is worse than no row**: it asserts that
-- something happened and that nobody did it, which is the one answer
-- that cannot be true.
-- ASSERT ALWAYS: SELECT count(*) FROM admin_actions WHERE trim(actor) = '' == 0

-- Standing invariant: a refusal never claims a success code, and a
-- success never claims a refusal.
--
-- The outcome and the code are two statements about one event, and a
-- reader who found them disagreeing could trust neither.
-- ASSERT ALWAYS: SELECT count(*) FROM admin_actions WHERE outcome = 'succeeded' AND status_code >= 400 == 0
-- ASSERT ALWAYS: SELECT count(*) FROM admin_actions WHERE outcome = 'refused' AND status_code < 400 == 0
