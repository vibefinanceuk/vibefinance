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
import supplierMirrorSql from "../../../migrations/0049_supplier_mirror.sql?raw";
import sitePurposeSql from "../../../migrations/0050_site_purpose_and_address.sql?raw";
import supplierEmailSql from "../../../migrations/0051_supplier_email.sql?raw";
import supplierPhoneSql from "../../../migrations/0052_supplier_phone.sql?raw";
import orgContactSql from "../../../migrations/0053_org_unit_contact.sql?raw";
import awaitingErpSql from "../../../migrations/0055_a_supplier_awaiting_the_erp.sql?raw";
import dashboardSql from "../../../migrations/0056_dashboard_cards.sql?raw";
import splitNeedsSomebodySql from "../../../migrations/0057_split_needs_somebody.sql?raw";
import taskStatesSql from "../../../migrations/0031_task_states_and_returns.sql?raw";
import orgSettingsSql from "../../../migrations/0032_org_settings_retention.sql?raw";
import discardedStateSql from "../../../migrations/0033_discarded_task_state.sql?raw";
import purchaseOrdersSql from "../../../migrations/0034_purchase_orders.sql?raw";
import ruleNameSql from "../../../migrations/0058_rule_name.sql?raw";
import documentCommentsSql from "../../../migrations/0059_document_comments.sql?raw";
import grandfatherNavPermissionsSql from "../../../migrations/0060_grandfather_the_new_nav_permissions.sql?raw";
import supplierOrgUnitSql from "../../../migrations/0061_supplier_org_unit.sql?raw";
import teamBelongsToOrgSql from "../../../migrations/0064_a_team_belongs_to_an_org.sql?raw";
import userPropertiesSql from "../../../migrations/0065_user_properties.sql?raw";
import purchaseOrderOrgSql from "../../../migrations/0068_purchase_order_org.sql?raw";
import purchaseOrderStatusSql from "../../../migrations/0069_purchase_order_status.sql?raw";
import embeddedXmlDocumentTypeSql from "../../../migrations/0070_embedded_xml_document_type.sql?raw";
// 0071 and 0074 are documentation-only ASSERT restatements with no
// real SQL body, the same "nothing to execute" shape as
// 0054/0062/0063/0066/0067 above — skipped here for the same reason.
import supplierDiscountAndFieldChangeHistorySql from "../../../migrations/0072_supplier_discount_terms_and_field_change_history.sql?raw";
import agreedPaymentMeansPlaceholderSql from "../../../migrations/0073_agreed_payment_means_placeholder.sql?raw";
// 0074 is a documentation-only ASSERT restatement with no real SQL
// body, the same "nothing to execute" shape noted above — skipped
// here for the same reason.
import approvalHierarchySql from "../../../migrations/0075_approval_hierarchy.sql?raw";
import accountCodingListsSql from "../../../migrations/0076_account_coding_lists.sql?raw";
import costObjectApprovalHierarchySql from "../../../migrations/0077_cost_object_approval_hierarchy.sql?raw";
import matchingExceptionsAndBusinessUserSql from "../../../migrations/0078_matching_exceptions_and_business_user.sql?raw";

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
const TABLES_IN_DROP_ORDER = ["document_comments",
  // Matching Exceptions and Business User (decision 0468/migration
  // 0078) — references invoice_headers and org_users, so it sits here
  // with document_comments, the other table dropped early for exactly
  // that reason. org_matching_config carries no foreign key at all, so
  // its own drop order genuinely does not matter; kept alongside its
  // own migration's sibling table for a reader's sake, not correctness.
  "invoice_collaborators", "org_matching_config", "process_stage_versions", "inbound_email_events", "stage_field_visibility", "field_visibility",
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
  // **After `invoice_headers`, which references them** (decision 0209).
  // Dropping a supplier an invoice still points at fails the foreign
  // key — which is the constraint doing its job on a teardown that had
  // the order wrong.
  "dashboard_cards",
  "supplier_field_changes",
  "suppliers",
  "suppliers_new",
  "supplier_loads",
  "invoice_run_steps",
  "invoice_runs",
  "rule_examples",
  "rule_versions",
  "rules",
  "rule_sets",
  "licence_cache",
  "org_team_members",
  "org_teams",
  // Approval Hierarchy (decision 0439) — reference org_users and/or
  // org_units, so before both, the same place org_authority_limits
  // itself already sits.
  "org_authority_limit_overrides",
  "org_user_supervisor_overrides",
  "org_approval_config",
  // Account Coding (decision 0444). Children before the parent they
  // all reference (coding_list_types), and before org_users, which
  // coding_list_entries.approver_user_id points at — the same
  // "children before parents, for the foreign keys" rule this whole
  // list already follows.
  "coding_list_entry_filters",
  "coding_list_entries",
  "coding_list_type_filters",
  // Cost-Object Approval Hierarchy generalization (decision 0452) —
  // references coding_list_types(id) too, so before it, the same rule
  // as its Account Coding siblings above.
  "cost_object_dimensions",
  "coding_list_types",
  "org_authority_limits",
  "org_spend_limits",
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
  /**
   * **A genuine cycle, not an ordering mistake — decision 0334.**
   * `cost_centres.owner_user_id` already referenced `org_users`
   * (migration 0044); `org_users.cost_centre_id` now references
   * `cost_centres` right back. No drop order satisfies both
   * directions at once. `PRAGMA foreign_keys = OFF` does not help —
   * `env.DB.exec()` does not carry pragma state between separate
   * calls in this environment, confirmed directly rather than
   * assumed. Breaking the cycle's own data instead: null the
   * columns that create it, on whichever of the two tables already
   * exists, before the drop loop runs. Wrapped in try/catch because
   * neither table exists yet on this suite's very first run.
   */
  try {
    await env.DB.exec("UPDATE org_users SET cost_centre_id = NULL;");
  } catch {
    // org_users does not exist yet — nothing to break a cycle with.
  }
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
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(supplierMirrorSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(sitePurposeSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(supplierEmailSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(supplierPhoneSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(orgContactSql)));
  // 0054 is a documentation-only correction with no real SQL body — it
  // exists in the real chain purely for its own commentary and
  // assertions, and apply_migrations.py's own bookkeeping INSERT is
  // what keeps a genuinely empty exec() from ever happening there.
  // This test harness calls exec() directly with no such padding, so
  // it is skipped here rather than sent as an empty statement. The
  // same is true of 0062, 0063, 0066, and 0067 below — each real,
  // each already in the deployed chain, none with anything to execute.
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(awaitingErpSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(dashboardSql)));
  /**
   * **A real, pre-existing gap in this test schema, found live —
   * decision 0358.** Never applied here at all: `dashboard_cards`'s
   * own CHECK constraint stayed frozen at migration 0056's original
   * list (still `needs_somebody`, missing `suppliers_awaiting_erp`,
   * `unplaced_documents`, and `possible_duplicates` entirely), so no
   * test could ever insert one of those three real, live card types
   * — which is exactly why none of them had any test coverage until
   * this decision wrote the first one and hit the constraint
   * directly.
   */
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(splitNeedsSomebodySql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(taskStatesSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(orgSettingsSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(discardedStateSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(purchaseOrdersSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(ruleNameSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(documentCommentsSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(grandfatherNavPermissionsSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(supplierOrgUnitSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(teamBelongsToOrgSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(userPropertiesSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(purchaseOrderOrgSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(purchaseOrderStatusSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(embeddedXmlDocumentTypeSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(supplierDiscountAndFieldChangeHistorySql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(agreedPaymentMeansPlaceholderSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(approvalHierarchySql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(accountCodingListsSql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(costObjectApprovalHierarchySql)));
  await env.DB.exec(toOneStatementPerLine(stripSqlComments(matchingExceptionsAndBusinessUserSql)));
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
