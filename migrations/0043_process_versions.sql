-- 0043_process_versions.sql
-- Decision 0150 — versioning a process, built.
--
-- **The membership is versioned, not the stages.** A version on
-- `processes` alone would be a label with nothing behind it: if
-- `process_stages` rows are edited in place, an instance recorded as
-- running under v1 looks them up and gets v2's.
--
-- So a stage exists once, with its own id and its own properties, and
-- what is versioned is **which stages are in a process, in what
-- order**.
--
-- Three things come free. Every existing foreign key keeps working —
-- six tables reference `process_stages(id)` and none changes. Removing
-- a stage becomes *"not in this version"* rather than a deletion that
-- orphans history, which is what Line Review needs: it carries a
-- completed task, so the row cannot go. And resequencing is a different
-- `sequence` in v2 rather than a mutation nobody can reason about
-- afterwards.

-- Which version of its own shape a process is currently publishing.
ALTER TABLE processes ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

-- Which stages are in a process, in what order, at a given version.
CREATE TABLE process_stage_versions (
  process_id TEXT NOT NULL REFERENCES processes(id),
  version    INTEGER NOT NULL,
  stage_id   TEXT NOT NULL REFERENCES process_stages(id),
  sequence   INTEGER NOT NULL,

  PRIMARY KEY (process_id, version, stage_id)
);

CREATE INDEX idx_stage_versions_order ON process_stage_versions(process_id, version, sequence);

-- **The version an instance started under** — decision 0150.
--
-- The operator's own requirement: *"in-process invoices should
-- definitely finish on their current process. The invoice finished on
-- v1, and the item has no knowledge of v2."*
--
-- Moving one mid-flight is incoherent: it could skip a stage it should
-- have visited, or be sent back to one it already passed. Neither has
-- an honest answer, so neither is offered.
ALTER TABLE process_instances ADD COLUMN process_version INTEGER NOT NULL DEFAULT 1;

-- Every stage that exists today becomes version 1's membership.
--
-- **Backfilled from `process_stages.sequence`**, which is what every
-- read has used until now — so v1 describes exactly the process that
-- has been running, and nothing changes behaviour on the day this is
-- applied.
INSERT INTO process_stage_versions (process_id, version, stage_id, sequence)
SELECT process_id, 1, id, sequence FROM process_stages;

-- Point-in-time: every stage is in version 1, and every process is at
-- version 1.
-- ASSERT: SELECT count(*) FROM process_stage_versions WHERE version != 1 == 0
-- ASSERT: SELECT (SELECT count(*) FROM process_stage_versions) - (SELECT count(*) FROM process_stages) == 0

-- Standing invariant: a version never gives two stages the same place.
--
-- **Two stages at sequence 3** makes "what comes next" a question with
-- two answers, and the workflow engine picks whichever the database
-- returns first.
-- ASSERT ALWAYS: SELECT count(*) FROM (SELECT process_id, version, sequence FROM process_stage_versions GROUP BY process_id, version, sequence HAVING count(*) > 1) == 0

-- Standing invariant: an instance never claims a version its process
-- has no membership for.
--
-- An instance on v2 of a process that only ever published v1 would find
-- no stages at all and stop, silently.
-- ASSERT ALWAYS: SELECT count(*) FROM process_instances i WHERE NOT EXISTS (SELECT 1 FROM process_stage_versions v WHERE v.process_id = i.process_id AND v.version = i.process_version) == 0

-- Standing invariant: a process never publishes a version with no
-- stages in it.
-- ASSERT ALWAYS: SELECT count(*) FROM processes p WHERE NOT EXISTS (SELECT 1 FROM process_stage_versions v WHERE v.process_id = p.id AND v.version = p.version) == 0
