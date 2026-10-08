-- 0153_process_ends_follow_current_version.sql — decision 0694.
--
-- A process's entry stage (where Sources deliver) and exit stage (where
-- Destinations read) are its current version's first and last stage
-- (decision 0557). Migration 0107 stored them once, and publishing a new
-- version never moved them: Supplier Maintenance, now Intake → Review →
-- Complete, still showed Review as both. From decision 0694 publishing
-- sets them; this brings every process up to date once.

UPDATE processes SET
  entry_stage_id = (SELECT v.stage_id FROM process_stage_versions v WHERE v.process_id = processes.id AND v.version = processes.version ORDER BY v.sequence ASC LIMIT 1),
  exit_stage_id = (SELECT v.stage_id FROM process_stage_versions v WHERE v.process_id = processes.id AND v.version = processes.version ORDER BY v.sequence DESC LIMIT 1)
WHERE EXISTS (SELECT 1 FROM process_stage_versions v WHERE v.process_id = processes.id AND v.version = processes.version);

-- ASSERT ALWAYS: SELECT count(*) FROM processes p WHERE EXISTS (SELECT 1 FROM process_stage_versions v WHERE v.process_id = p.id AND v.version = p.version) AND p.entry_stage_id IS NOT (SELECT v.stage_id FROM process_stage_versions v WHERE v.process_id = p.id AND v.version = p.version ORDER BY v.sequence ASC LIMIT 1) == 0
