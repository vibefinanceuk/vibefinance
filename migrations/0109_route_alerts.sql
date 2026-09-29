-- 0109_route_alerts.sql
-- Decision 0559 — Routes, slice 5: alerts
-- (docs/design/routes-phase1-data-model.md, section 3.10).
--
-- An alert says who to tell, and when: on each failed message, when a
-- route's failures in a day reach a number, or when a Source has received
-- nothing for some hours. For one route, or every route (instance_id
-- NULL). Sent by email (through Resend, as Return To Supplier already
-- sends, 0498) and/or to a webhook, signed with the alert's own secret.

CREATE TABLE route_alerts (
  id                 TEXT PRIMARY KEY,
  instance_id        TEXT REFERENCES route_instances(id),
  on_failure         INTEGER NOT NULL DEFAULT 1 CHECK (on_failure IN (0, 1)),
  failures_per_day   INTEGER CHECK (failures_per_day IS NULL OR failures_per_day > 0),
  silent_hours       INTEGER CHECK (silent_hours IS NULL OR silent_hours > 0),
  emails             TEXT,
  webhook_url        TEXT,
  webhook_secret     TEXT,
  created_at         TEXT NOT NULL,
  created_by         TEXT REFERENCES org_users(id)
);

-- What was sent, so a threshold alerts once a day and a silence once per
-- silence, however often they are checked.
CREATE TABLE route_alert_log (
  alert_id   TEXT NOT NULL REFERENCES route_alerts(id),
  kind       TEXT NOT NULL CHECK (kind IN ('failure', 'threshold', 'silent', 'test')),
  dedupe_key TEXT NOT NULL,
  sent_at    TEXT NOT NULL,
  outcome    TEXT NOT NULL,
  PRIMARY KEY (alert_id, kind, dedupe_key)
);

-- ASSERT: SELECT count(*) FROM route_alerts == 0
-- An alert tells someone: an email address or a webhook.
-- ASSERT ALWAYS: SELECT count(*) FROM route_alerts WHERE COALESCE(emails, '') = '' AND COALESCE(webhook_url, '') = '' == 0
-- And is about something: a failure, a threshold or a silence.
-- ASSERT ALWAYS: SELECT count(*) FROM route_alerts WHERE on_failure = 0 AND failures_per_day IS NULL AND silent_hours IS NULL == 0
