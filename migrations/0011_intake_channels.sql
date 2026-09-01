-- 0011_intake_channels.sql
-- Per-customer, per-process intake channels — see docs/decisions/
-- 0024-intake-channels.md and 0023-intake-stage-convention.md. A real,
-- flexible list a customer manages themselves, not a hardcoded
-- description string. Scoped to a process, not a vocabulary: AP and
-- AR both use the invoice vocabulary (decision 0021) but need
-- genuinely different channel lists (Email/Mailroom for AP, Billing
-- System A/B for AR) — a process is the precise, already-real entity
-- (decision 0018) this naturally belongs to. The same channel name
-- can exist under two different processes with no conflict — "Email"
-- under both an AP process and an Expense process, say.
--
-- Deliberately not wired into rule validation or evaluation at all —
-- decision 0023 explicitly declined closed-value enforcement (nothing
-- in this system checks that a condition's VALUE, as opposed to its
-- field name, belongs to a real set), and this migration doesn't
-- reopen that. This is management/CRUD only, the same scope
-- decision 0016 gave Teams before task eligibility used them.

CREATE TABLE intake_channels (
  id         TEXT PRIMARY KEY,
  process_id TEXT NOT NULL REFERENCES processes(id),
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (process_id, name)
);

CREATE INDEX idx_intake_channels_process ON intake_channels(process_id);

-- Point-in-time: empty at the moment this migration finishes.
-- ASSERT: SELECT count(*) FROM intake_channels == 0

-- Standing invariant: every channel references a real process — the
-- FK above already enforces this at the SQL layer; restated so the
-- replay tool reports it directly, matching every other table in this
-- project.
-- ASSERT ALWAYS: SELECT count(*) FROM intake_channels WHERE process_id NOT IN (SELECT id FROM processes) == 0
