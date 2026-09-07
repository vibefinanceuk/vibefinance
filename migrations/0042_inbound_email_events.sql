-- 0042_inbound_email_events.sql
-- Decision 0147 — what arrived, and what happened to it.
--
-- The first real invoice by email was rejected, and **the only place
-- the reason existed was Cloudflare's own activity log**. A supplier
-- gets a clear bounce; the customer gets nothing, and *"we never
-- received it"* is a conversation they would have blind.
--
-- `intake_capture_events` is the precedent (decision 0055): every
-- arrival recorded whether or not it succeeded, because a system that
-- logs only its successes cannot answer the question anybody asks.
-- That table records arrivals **through a source**, and a message
-- rejected for naming an address no source claims never reaches one —
-- so it has nowhere to be recorded and this is where it goes.

CREATE TABLE inbound_email_events (
  id TEXT PRIMARY KEY,

  -- Who sent it, and where they sent it.
  --
  -- **The sender is the point.** Somebody chasing *"did our invoice
  -- arrive"* has an address and a date and nothing else, and the
  -- capture path discards `message.from` entirely.
  sender TEXT NOT NULL,
  recipient TEXT NOT NULL,

  -- The source it reached, where it reached one. Null is the
  -- interesting case: a message for an address nothing claims.
  source_id TEXT REFERENCES sources(id),

  outcome TEXT NOT NULL CHECK (outcome IN ('captured', 'rejected')),

  -- Why, in a word a route chose rather than a sentence.
  --
  -- The words a person reads live in the control plane like every other
  -- string (decision 0132), and a reason recorded in English here would
  -- be a reason a German customer reads in English.
  reason TEXT,

  -- How many attachments were found, and how many became invoices.
  -- **A message with three attachments and one invoice** is a thing
  -- somebody will ask about.
  attachments INTEGER NOT NULL DEFAULT 0,
  captured INTEGER NOT NULL DEFAULT 0,

  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_inbound_email_occurred ON inbound_email_events(occurred_at DESC);
CREATE INDEX idx_inbound_email_sender ON inbound_email_events(sender, occurred_at DESC);

-- Whether a source is actually receiving — decision 0147.
--
-- `email_routing` has read `not_configured` since decision 0126, and
-- **nothing has ever set it**. An address that receives while the
-- screen says "Not receiving yet" is a lie on a screen, which is worse
-- than the placeholder it replaced.
--
-- Set by the first message that arrives, rather than by somebody
-- remembering: a routing rule is created in Cloudflare's dashboard and
-- this database cannot see it, so **the only honest evidence that
-- routing works is a message arriving through it.**

-- Point-in-time: nothing recorded yet.
-- ASSERT: SELECT count(*) FROM inbound_email_events == 0

-- Standing invariant: a captured message captured something.
--
-- `captured` counting zero on a `captured` outcome would assert that an
-- invoice arrived and that none did.
-- ASSERT ALWAYS: SELECT count(*) FROM inbound_email_events WHERE outcome = 'captured' AND captured = 0 == 0

-- Standing invariant: nothing was captured from a rejected message.
-- ASSERT ALWAYS: SELECT count(*) FROM inbound_email_events WHERE outcome = 'rejected' AND captured > 0 == 0

-- Standing invariant: never more captured than arrived.
-- ASSERT ALWAYS: SELECT count(*) FROM inbound_email_events WHERE captured > attachments == 0
