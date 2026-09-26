-- 0090_supplier_return_emails.sql
-- Decision 0498 — the outbound record. Superseding note: decision
-- 0055 section 5.3/7 made "the system sends nothing" a deliberate
-- stance for Return To Supplier; this migration is the schema half of
-- the change that supersedes that one clause specifically (see
-- docs/decisions/SUPERSEDED.md and 0055's own updated header) — the
-- rest of 0055 section 7 (two terminal states, instance status rather
-- than a new stage) is untouched and still exactly right.
--
-- One row per actual send attempt, not per return. A return happens
-- once; what happened to the email sent about it is then its own
-- small lifeline — accepted by the provider, delivered, bounced, or
-- never sent at all — reported back asynchronously by Resend's own
-- webhook, arriving after this row already exists.
CREATE TABLE supplier_return_emails (
  id                  TEXT PRIMARY KEY,

  -- Which return this email belongs to. Both kept: the task is what a
  -- Timeline entry is naturally attached to (activity-route.ts's own
  -- taskEnded shape); the instance is what 0055 actually terminates,
  -- and survives even the rare case of a task row being hard to reach.
  process_instance_id TEXT NOT NULL REFERENCES process_instances(id),
  task_id             TEXT NOT NULL REFERENCES tasks(id),
  supplier_id         TEXT REFERENCES suppliers(id),

  to_address  TEXT NOT NULL,
  -- Null when the CC checkbox was not offered (no ap_team_email
  -- configured) or not ticked — not an empty string, so "nobody was
  -- copied" is never confused with "copied to nothing."
  cc_address  TEXT,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,

  provider            TEXT NOT NULL DEFAULT 'resend',
  -- Resend's own id for the send, once accepted — the join key the
  -- webhook handler uses to find this row again. Unique where present;
  -- many rows may have never gotten one (a send that failed outright).
  provider_message_id TEXT,

  -- **Six states, not a boolean "sent."** 'queued' the instant this
  -- row is written, before the provider call returns at all — so a
  -- Worker that dies mid-request still leaves a record that something
  -- was attempted. 'send_failed' is the provider call itself refusing
  -- or erroring; everything after 'sent' arrives later, from the
  -- webhook, and can only ever move forward along Resend's own event
  -- sequence, never back to 'queued' or 'send_failed'.
  status        TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sent', 'send_failed', 'delivered', 'bounced', 'complained', 'delayed')),
  status_detail TEXT,

  created_by TEXT NOT NULL REFERENCES org_users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at       TEXT,
  last_event_at TEXT
);

CREATE INDEX idx_supplier_return_emails_instance ON supplier_return_emails(process_instance_id);
CREATE INDEX idx_supplier_return_emails_task ON supplier_return_emails(task_id);
CREATE UNIQUE INDEX idx_supplier_return_emails_provider_message
  ON supplier_return_emails(provider_message_id)
  WHERE provider_message_id IS NOT NULL;
