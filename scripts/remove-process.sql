-- remove-process.sql — remove one process and everything that belongs to it.
--
-- Usage (from workers/vf-app):
--   1. Put the process id on the marked line below (see the query at the end
--      of this header to list them).
--   2. npx wrangler d1 execute vf-app-poc --remote --file=../../scripts/remove-process.sql
--
-- To list processes first:
--   npx wrangler d1 execute vf-app-poc --remote --command="SELECT id, name, subject_type FROM processes"
--
-- What goes: the process; its stages and their versions, visibility, actions,
-- return targets and rule-set overrides; its intake channels and pending
-- uploads; its sources (Email, HTTPS, SFTP) with their keys and arrivals; its
-- route instances (sources and destinations) with their alerts, secrets,
-- requests and deliveries; every route message through them with its parts,
-- events and items; every process instance, stage visit and task in it.
--
-- What stays: invoices, goods receipts and supplier mappings (any link from
-- them to a removed message is cleared, not the record itself), and the rule
-- sets its stages pointed at (rules are kept; they belong to no process).
-- R2 files are not deleted: a message's stored parts stay in the bucket.
--
-- Order matters: D1 enforces foreign keys, so children go before parents.
-- Tested against every migration with two processes seeded across all 42
-- related tables: one removed completely, the other untouched, and no
-- reference left pointing at anything removed.
-- Atomic: wrangler imports the file as one unit, and if it fails to complete
-- the database returns to its original state (confirmed on the first real run,
-- removing test-process: 77 statements, 40 rows written, 8 October 2026).

CREATE TABLE IF NOT EXISTS _remove_process (id TEXT PRIMARY KEY);
DELETE FROM _remove_process;
INSERT INTO _remove_process (id) VALUES ('PUT-THE-PROCESS-ID-HERE');   -- <<< the only line to change

-- What belongs to it, worked out once.
CREATE TABLE IF NOT EXISTS _rp_stages (id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS _rp_sources (id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS _rp_instances (id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS _rp_routes (id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS _rp_channels (id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS _rp_messages (id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS _rp_visits (id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS _rp_tasks (id TEXT PRIMARY KEY);
DELETE FROM _rp_stages; DELETE FROM _rp_sources; DELETE FROM _rp_instances; DELETE FROM _rp_routes;
DELETE FROM _rp_channels; DELETE FROM _rp_messages; DELETE FROM _rp_visits; DELETE FROM _rp_tasks;

INSERT INTO _rp_stages SELECT id FROM process_stages WHERE process_id IN (SELECT id FROM _remove_process);
INSERT INTO _rp_sources SELECT id FROM sources WHERE process_id IN (SELECT id FROM _remove_process);
INSERT INTO _rp_instances SELECT id FROM process_instances WHERE process_id IN (SELECT id FROM _remove_process);
INSERT INTO _rp_channels SELECT id FROM intake_channels WHERE process_id IN (SELECT id FROM _remove_process);
INSERT INTO _rp_routes SELECT id FROM route_instances
  WHERE process_id IN (SELECT id FROM _remove_process) OR source_id IN (SELECT id FROM _rp_sources);
INSERT INTO _rp_messages SELECT id FROM route_messages
  WHERE instance_id IN (SELECT id FROM _rp_sources) OR destination_id IN (SELECT id FROM _rp_routes);
INSERT INTO _rp_visits SELECT id FROM stage_visits
  WHERE stage_id IN (SELECT id FROM _rp_stages) OR process_instance_id IN (SELECT id FROM _rp_instances);
INSERT INTO _rp_tasks SELECT id FROM tasks
  WHERE stage_id IN (SELECT id FROM _rp_stages) OR stage_visit_id IN (SELECT id FROM _rp_visits);

-- Tasks and their history.
DELETE FROM task_action_events WHERE task_id IN (SELECT id FROM _rp_tasks);
DELETE FROM absence_moves WHERE task_id IN (SELECT id FROM _rp_tasks);
DELETE FROM supplier_return_emails WHERE task_id IN (SELECT id FROM _rp_tasks) OR process_instance_id IN (SELECT id FROM _rp_instances);
UPDATE tasks SET returned_to_stage_id = NULL WHERE returned_to_stage_id IN (SELECT id FROM _rp_stages);
DELETE FROM tasks WHERE id IN (SELECT id FROM _rp_tasks);

-- Stage visits and process instances.
DELETE FROM stage_visit_steps WHERE stage_visit_id IN (SELECT id FROM _rp_visits);
DELETE FROM field_overrides WHERE stage_visit_id IN (SELECT id FROM _rp_visits);
DELETE FROM stage_visits WHERE id IN (SELECT id FROM _rp_visits);
DELETE FROM intake_capture_events WHERE process_instance_id IN (SELECT id FROM _rp_instances) OR channel_id IN (SELECT id FROM _rp_channels);
DELETE FROM process_instances WHERE id IN (SELECT id FROM _rp_instances);

-- Route messages: links from records that stay are cleared, then the messages go.
UPDATE invoice_documents SET route_message_id = NULL, part_seq = NULL WHERE route_message_id IN (SELECT id FROM _rp_messages);
UPDATE goods_receipts SET route_message_id = NULL WHERE route_message_id IN (SELECT id FROM _rp_messages);
UPDATE supplier_mapping_versions SET sample_message_id = NULL WHERE sample_message_id IN (SELECT id FROM _rp_messages);
DELETE FROM destination_deliveries WHERE message_id IN (SELECT id FROM _rp_messages) OR instance_id IN (SELECT id FROM _rp_routes);
DELETE FROM route_message_items WHERE message_id IN (SELECT id FROM _rp_messages);
DELETE FROM route_message_events WHERE message_id IN (SELECT id FROM _rp_messages);
DELETE FROM route_message_parts WHERE message_id IN (SELECT id FROM _rp_messages);
DELETE FROM route_messages WHERE id IN (SELECT id FROM _rp_messages);

-- Route instances (its sources' and its destinations').
DELETE FROM route_alert_log WHERE alert_id IN (SELECT id FROM route_alerts WHERE instance_id IN (SELECT id FROM _rp_routes));
DELETE FROM route_alerts WHERE instance_id IN (SELECT id FROM _rp_routes);
DELETE FROM connector_secrets WHERE instance_id IN (SELECT id FROM _rp_routes);
DELETE FROM destination_requests WHERE instance_id IN (SELECT id FROM _rp_routes);
DELETE FROM outbound_mapping_versions WHERE instance_id IN (SELECT id FROM _rp_routes);
DELETE FROM route_instances WHERE id IN (SELECT id FROM _rp_routes);

-- Sources.
DELETE FROM inbound_email_events WHERE source_id IN (SELECT id FROM _rp_sources);
UPDATE source_keys SET replaced_by = NULL WHERE source_id IN (SELECT id FROM _rp_sources);
DELETE FROM source_keys WHERE source_id IN (SELECT id FROM _rp_sources);
DELETE FROM sources WHERE id IN (SELECT id FROM _rp_sources);

-- Intake channels and pending uploads.
DELETE FROM pending_document_pages WHERE pending_document_id IN (SELECT id FROM pending_documents WHERE channel_id IN (SELECT id FROM _rp_channels));
DELETE FROM pending_documents WHERE channel_id IN (SELECT id FROM _rp_channels);
UPDATE sources SET legacy_channel_id = NULL WHERE legacy_channel_id IN (SELECT id FROM _rp_channels);
DELETE FROM intake_channels WHERE id IN (SELECT id FROM _rp_channels);

-- Stages, then the process.
DELETE FROM stage_field_visibility WHERE stage_id IN (SELECT id FROM _rp_stages);
DELETE FROM stage_field_visibility_overrides WHERE stage_id IN (SELECT id FROM _rp_stages);
DELETE FROM stage_rule_set_overrides WHERE stage_id IN (SELECT id FROM _rp_stages);
DELETE FROM stage_actions WHERE stage_id IN (SELECT id FROM _rp_stages);
DELETE FROM stage_return_targets WHERE source_stage_id IN (SELECT id FROM _rp_stages) OR target_stage_id IN (SELECT id FROM _rp_stages);
DELETE FROM process_stage_versions WHERE process_id IN (SELECT id FROM _remove_process) OR stage_id IN (SELECT id FROM _rp_stages);
UPDATE processes SET entry_stage_id = NULL, exit_stage_id = NULL WHERE id IN (SELECT id FROM _remove_process);
DELETE FROM process_stages WHERE id IN (SELECT id FROM _rp_stages);
DELETE FROM processes WHERE id IN (SELECT id FROM _remove_process);

-- Tidy up the working tables.
DROP TABLE _rp_tasks; DROP TABLE _rp_visits; DROP TABLE _rp_messages; DROP TABLE _rp_channels;
DROP TABLE _rp_routes; DROP TABLE _rp_instances; DROP TABLE _rp_sources; DROP TABLE _rp_stages;
DROP TABLE _remove_process;
