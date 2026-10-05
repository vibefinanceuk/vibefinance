-- 0138_absences.sql
-- Decision 0641 — Absence and cover (Agents phase 3, slice 3, as Dan
-- asked it on 5 October 2026): a person marks themselves absent from a
-- start date to the day they return, naming who covers; an AP Manager
-- sees their team's absences and may amend or cancel one; while the
-- person is away their open tasks pass to the cover, and come back on
-- their return.

CREATE TABLE absences (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES org_users(id),
  -- The first day away, and the first day back (YYYY-MM-DD, in the
  -- organisation's time zone). Away while starts_on <= today < returns_on.
  starts_on     TEXT NOT NULL,
  returns_on    TEXT NOT NULL,
  cover_user_id TEXT REFERENCES org_users(id),
  -- 1: their open tasks pass to the cover while they are away.
  pass_tasks    INTEGER NOT NULL DEFAULT 1 CHECK (pass_tasks IN (0, 1)),
  -- 1: tasks passed and still open with the cover come back on return.
  hand_back     INTEGER NOT NULL DEFAULT 1 CHECK (hand_back IN (0, 1)),
  note          TEXT,
  created_by    TEXT NOT NULL REFERENCES org_users(id),
  created_at    TEXT NOT NULL,
  updated_by    TEXT REFERENCES org_users(id),
  updated_at    TEXT,
  cancelled_by  TEXT REFERENCES org_users(id),
  cancelled_at  TEXT,
  -- When the return was dealt with (tasks handed back), once.
  ended_at      TEXT,
  CHECK (starts_on < returns_on),
  CHECK (cover_user_id IS NULL OR cover_user_id <> user_id)
);
CREATE INDEX idx_absences_user ON absences(user_id, starts_on);
CREATE INDEX idx_absences_dates ON absences(returns_on, starts_on);

-- Each task passed, kept, or handed back under an absence.
CREATE TABLE absence_moves (
  absence_id   TEXT NOT NULL REFERENCES absences(id),
  task_id      TEXT NOT NULL REFERENCES tasks(id),
  -- Which hold moved: a claim on a team's task, or a task named to them.
  field        TEXT NOT NULL CHECK (field IN ('claimed_by', 'owner_user_id')),
  from_user_id TEXT NOT NULL REFERENCES org_users(id),
  to_user_id   TEXT REFERENCES org_users(id),
  -- moved: with the cover; kept: stayed, and why; returned: handed back;
  -- left: had moved on (done, or passed elsewhere) by the return.
  status       TEXT NOT NULL CHECK (status IN ('moved', 'kept', 'returned', 'left')),
  reason       TEXT,
  at           TEXT NOT NULL,
  PRIMARY KEY (absence_id, task_id)
);

-- ASSERT: SELECT count(*) FROM absences == 0
-- ASSERT ALWAYS: SELECT count(*) FROM absences WHERE starts_on >= returns_on == 0
