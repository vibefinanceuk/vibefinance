import { env } from "cloudflare:test";
// Bundled at build time via Vite's `?raw` import — not read at runtime.
// Tests run inside the real workerd sandbox (that's the point: the real
// code path, not a mock), and an arbitrary host-filesystem readFileSync
// from within that sandbox does not reliably resolve project-relative
// paths, even with nodejs_compat. Importing the file as a module lets
// the bundler resolve it before the Worker ever starts, the same way
// application source would import any other module.
import schemaSql from "../../../migrations/0001_rule_engine_schema.sql?raw";
import licenceCacheSql from "../../../migrations/0002_licence_cache.sql?raw";
import orgAuthorityProfilesSql from "../../../migrations/0003_org_authority_profiles.sql?raw";
import orgUserApiKeysSql from "../../../migrations/0004_org_user_api_keys.sql?raw";
import ruleVersioningInvariantSql from "../../../migrations/0005_rule_versioning_invariant.sql?raw";
import orgTeamsSql from "../../../migrations/0006_org_teams.sql?raw";
import invoiceFactsSql from "../../../migrations/0007_invoice_facts.sql?raw";
import processesStagesTasksSql from "../../../migrations/0008_processes_stages_tasks.sql?raw";
import processInstancesSql from "../../../migrations/0009_process_instances_and_stage_visits.sql?raw";
import ruleSetsVocabularySql from "../../../migrations/0010_rule_sets_vocabulary.sql?raw";
import intakeChannelsSql from "../../../migrations/0011_intake_channels.sql?raw";
import mandateChannelExpenseReportsSql from "../../../migrations/0012_mandate_channel_and_expense_reports.sql?raw";
import perLineEvaluationSql from "../../../migrations/0013_per_line_evaluation.sql?raw";
import duplicateDetectionSql from "../../../migrations/0014_duplicate_detection.sql?raw";
import intakeCaptureEventsSql from "../../../migrations/0015_intake_capture_events.sql?raw";
import costCentresSql from "../../../migrations/0016_cost_centres.sql?raw";
import r2JurisdictionSql from "../../../migrations/0017_r2_jurisdiction.sql?raw";
import invoiceDocumentsSql from "../../../migrations/0018_invoice_documents.sql?raw";
import customFieldsSql from "../../../migrations/0019_custom_fields.sql?raw";
import hybridPdfFallbackSql from "../../../migrations/0020_hybrid_pdf_fallback.sql?raw";
import stageVisitValidationSql from "../../../migrations/0021_stage_visit_validation.sql?raw";
import pendingDocumentsSql from "../../../migrations/0022_pending_documents.sql?raw";
import pageExtractionSql from "../../../migrations/0023_page_extraction_results.sql?raw";
import fieldOverridesSql from "../../../migrations/0024_field_overrides.sql?raw";
import revalidationSql from "../../../migrations/0025_revalidation.sql?raw";
import extractionSettingsSql from "../../../migrations/0026_extraction_settings.sql?raw";
import sourcesSql from "../../../migrations/0027_sources.sql?raw";
import channelStructureSql from "../../../migrations/0028_intake_channel_structure.sql?raw";
import propagateSettingsSql from "../../../migrations/0029_propagate_extraction_settings.sql?raw";
import keyedFieldsSql from "../../../migrations/0030_keyed_fields.sql?raw";
import keyedLinesSql from "../../../migrations/0035_keyed_lines.sql?raw";
import invoiceOrgSql from "../../../migrations/0036_invoice_org.sql?raw";
import stageRequiresOrgSql from "../../../migrations/0037_stage_requires_org.sql?raw";
import fieldVisibilitySql from "../../../migrations/0038_field_visibility.sql?raw";
import sourceEmailSql from "../../../migrations/0039_source_email_address.sql?raw";
import sourceStatusSql from "../../../migrations/0040_source_status.sql?raw";
import readOnlyStageSql from "../../../migrations/0041_read_only_stage.sql?raw";
import inboundEmailSql from "../../../migrations/0042_inbound_email_events.sql?raw";
import processVersionsSql from "../../../migrations/0043_process_versions.sql?raw";
import accountingFrameSql from "../../../migrations/0044_accounting_frame.sql?raw";
import unitRuleSetsSql from "../../../migrations/0045_unit_rule_sets.sql?raw";
import unitFieldVisibilitySql from "../../../migrations/0046_unit_field_visibility.sql?raw";
import scopedRolesSql from "../../../migrations/0047_roles_are_held_somewhere.sql?raw";
import stagePermissionSql from "../../../migrations/0048_a_stage_declares_its_permission.sql?raw";
import taskStatesSql from "../../../migrations/0031_task_states_and_returns.sql?raw";
import orgSettingsSql from "../../../migrations/0032_org_settings_retention.sql?raw";
import discardedStateSql from "../../../migrations/0033_discarded_task_state.sql?raw";
import purchaseOrdersSql from "../../../migrations/0034_purchase_orders.sql?raw";

// Another known divergence from production, on top of the one below:
// D1's exec() splits its input by newline and executes each non-empty
// line as its own statement — it does not parse multi-line SQL the way
// a normal client would. A multi-line CREATE TABLE therefore has to be
// collapsed onto one line per statement before exec() will accept it.
// This is D1-specific; migrations/apply_migrations.py's --replay-only
// mode uses Python's sqlite3.executescript(), which has no such
// restriction, so this collapsing step exists only here.
function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

function toOneStatementPerLine(sql: string): string {
  const collapsed = sql.replace(/\s+/g, " ").trim();
  return collapsed
    .split(";")
    .map((stmt) => stmt.trim())
    .filter((stmt) => stmt.length > 0)
    .map((stmt) => `${stmt};`)
    .join("\n");
}

// The known divergence from production this local preview has (§7 of the
// change-and-promotion model asks that these be written down rather than
// reported as defects): this applies the migration's SQL directly via
// D1's exec, bypassing migrations/apply_migrations.py entirely — so the
// ASSERT / ASSERT ALWAYS machinery is NOT exercised here. That machinery
// is covered separately by `python3 migrations/apply_migrations.py
// --replay-only`. This setup only needs the schema to exist so the Worker
// has real tables to read and write against the real D1 binding.
// A third known divergence: storage does not appear to reset between
// individual `it()` blocks within this pool-workers version (no
// isolatedStorage option was found in this release — checked the
// compiled source directly rather than assuming). Re-running the raw
// CREATE TABLE statements on a persisted database throws "table already
// exists". Rather than depend on framework isolation behaviour that
// isn't confirmed to exist here, applyTestSchema drops every table
// first (children before parents, for the foreign keys) so each test
// gets a genuinely clean schema regardless of what the pool does or
// does not reset.
const TABLES_IN_DROP_ORDER = ["process_stage_versions", "inbound_email_events", "stage_field_visibility", "field_visibility", 
  "purchase_order_lines",
  "purchase_orders",
  "org_settings",
  "keyed_fields",
  "sources",
  "field_overrides",
  "pending_document_pages",
  "pending_documents",
  "custom_fields",
  "invoice_documents",
  "stage_rule_set_overrides",
  "stage_field_visibility_overrides",
  "cost_centres",
  "intake_capture_events",
  "expense_reports",
  "intake_channels",
  "stage_visit_steps",
  "tasks",
  "stage_visits",
  "process_instances",
  "process_stages",
  "processes",
  "invoice_lines",
  "invoice_headers",
  "invoice_run_steps",
  "invoice_runs",
  "rule_examples",
  "rule_versions",
  "rules",
  "rule_sets",
  "licence_cache",
  "org_team_members",
  "org_teams",
  "org_authority_limits",
  "org_user_roles",
  "org_profiles",
  "org_roles",
  "org_users",
  "org_units",
  // The accounting frame (decision 0195). After org_units, which
  // references it, and after cost_centres for the same reason.
  "ledgers",
];

export async function applyTestSchema(): Promise<void> {
  for (const table of TABLES_IN_DROP_ORDER) {
    await env.DB.exec(`DROP TABLE IF EXISTS ${table};`);
  }
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(schemaSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(licenceCacheSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(orgAuthorityProfilesSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(orgUserApiKeysSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(ruleVersioningInvariantSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(orgTeamsSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(invoiceFactsSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(processesStagesTasksSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(processInstancesSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(ruleSetsVocabularySql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(intakeChannelsSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(mandateChannelExpenseReportsSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(perLineEvaluationSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(duplicateDetectionSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(intakeCaptureEventsSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(costCentresSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(r2JurisdictionSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(invoiceDocumentsSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(customFieldsSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(hybridPdfFallbackSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(stageVisitValidationSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(pendingDocumentsSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(pageExtractionSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(fieldOverridesSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(revalidationSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(extractionSettingsSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(sourcesSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(channelStructureSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(propagateSettingsSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(keyedFieldsSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(keyedLinesSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(invoiceOrgSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(stageRequiresOrgSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(fieldVisibilitySql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(sourceEmailSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(sourceStatusSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(readOnlyStageSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(inboundEmailSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(processVersionsSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(accountingFrameSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(unitRuleSetsSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(unitFieldVisibilitySql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(scopedRolesSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(stagePermissionSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(taskStatesSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(orgSettingsSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(discardedStateSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(purchaseOrdersSql)));
}

/**
 * Seed a stage, and its membership of the process — decision 0160.
 *
 * Decision 0150 versioned the **membership**, so a stage exists once and
 * `process_stage_versions` records which stages are in a process at a
 * given version. **A stage in no version is in no process**, and the
 * workflow engine steps straight past it.
 *
 * Twelve test seedings inserted into `process_stages` alone and broke
 * seventeen tests — correctly, because that is what the change means.
 *
 * **Not a trigger**, though one was tried: `CREATE TRIGGER` contains
 * internal semicolons, and this harness flattens every statement to one
 * line before `exec` (decision 0016's own note about D1's exec), so the
 * schema would not load at all.
 *
 * **And not the real answer either.** A stage created by a route needs
 * its membership too, and nothing yet gives it one — recorded rather
 * than hidden behind a helper that makes tests pass.
 */
export async function seedStage(
  id: string,
  processId: string,
  name: string,
  sequence: number,
  extra: Record<string, string | number> = {}
): Promise<void> {
  const columns = ["id", "process_id", "name", "sequence", ...Object.keys(extra)];
  const values = [id, processId, name, sequence, ...Object.values(extra)];

  await env.DB.prepare(
    `INSERT INTO process_stages (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
  )
    .bind(...values)
    .run();

  await env.DB.prepare(
    `INSERT OR IGNORE INTO process_stage_versions (process_id, version, stage_id, sequence)
     SELECT ?, version, ?, ? FROM processes WHERE id = ?`
  )
    .bind(processId, id, sequence, processId)
    .run();
}
