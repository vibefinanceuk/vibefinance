/**
 * What migrates from a sandbox to production, and what does not —
 * decision 0118.
 *
 * **Every table in a customer's instance is classified here**, and a
 * test asserts the schema and this list agree. A table added and not
 * classified fails that test by name, rather than silently migrating
 * or silently failing to.
 *
 * ---
 *
 * **Why a list and not a naming convention.** Prefixing tables `con_`
 * and `run_` was proposed and rejected: forty tables and 273 SQL
 * references would have to change, decision 0084 showed how badly
 * renaming a referenced table goes in SQLite, and — decisively — **a
 * convention cannot be checked**. It is followed or forgotten, which is
 * the weakness that let `field.bt-34` reach a live screen behind a
 * hand-maintained list (decision 0107).
 *
 * The binary also does not fit the line. `org_user_roles` does not
 * migrate, and it is not *runtime* data: it is a decision about a
 * person. A name saying otherwise would teach everyone the wrong
 * distinction.
 */

/**
 * Tables carrying what a customer **configured**.
 *
 * The operator's line: *"true configuration can be migrated; users are
 * not configuration"*, and *"roles and permissions can transfer,
 * assignment of them does not"*.
 */
export const CONFIGURATION_TABLES: readonly string[] = [
  // The workflow itself — what a customer spent a fortnight getting
  // right, and the thing rebuilding by hand would waste.
  "processes",
  "process_stages",

  // Rules, with their versions and worked examples. A rule without its
  // examples cannot be activated (decision 0008's gate), so they
  // travel together or the rule arrives unusable.
  "rule_sets",
  "rules",
  "rule_versions",
  "rule_examples",

  // The enterprise's own shape (decision 0111).
  "org_units",

  // **Definitions, not assignments.** A role is a name and a set of
  // permissions the customer authored; who holds it is a decision about
  // a person and is made again in production.
  "org_roles",
  "org_teams",
  "org_profiles",

  // How a screen is arranged (decision 0114).
  "field_visibility",
  "stage_field_visibility",

  // The vocabulary a customer extended (0041), and their coding
  // structure.
  "custom_fields",
  "cost_centres",

  // Where documents arrive, and the settings governing them.
  "sources",
  "org_settings",
];

/**
 * Tables carrying what a customer's instance **did**, or who did it.
 *
 * Not "runtime" — that word would be wrong for half of these. An
 * access decision about a person is not runtime data; it simply is not
 * configuration, and production makes it afresh.
 */
export const NON_MIGRATING_TABLES: readonly string[] = [
  // **People.** A user is a person, not a setting: access to a sandbox
  // is not access to real invoices, and copying them would make that
  // decision silently.
  "org_users",
  "org_user_roles",
  "org_team_members",
  "org_authority_limits",

  // Documents and everything derived from them.
  "invoice_headers",
  "invoice_lines",
  "invoice_documents",
  "expense_reports",
  "keyed_fields",
  "field_overrides",

  // Reference data that arrives from an ERP and will arrive again
  // (decision 0081).
  "purchase_orders",
  "purchase_order_lines",

  // Work in flight, and the record of work done.
  "process_instances",
  "stage_visits",
  "stage_visit_steps",
  "tasks",
  "invoice_runs",
  "invoice_run_steps",

  // Intake's own history, and documents half-arrived.
  "intake_capture_events",
  "intake_channels",
  "pending_documents",
  "pending_document_pages",

  // The instance's cached view of its own licence (decision 0003) —
  // fetched, never authored, and a new environment has its own.
  "licence_cache",
];

/**
 * Tables that exist only during a migration and are gone by its end.
 *
 * `tasks_new` is created and renamed to `tasks` by migration 0033's
 * rebuild. It is named here so the completeness test does not demand a
 * classification for something no schema ends up holding.
 */
export const TRANSIENT_TABLES: readonly string[] = ["tasks_new"];

/** Every table this project knows about, in exactly one class. */
export const ALL_CLASSIFIED_TABLES: readonly string[] = [
  ...CONFIGURATION_TABLES,
  ...NON_MIGRATING_TABLES,
  ...TRANSIENT_TABLES,
];

export type TableClass = "configuration" | "not-migrating" | "transient";

export function classifyTable(table: string): TableClass | null {
  if (CONFIGURATION_TABLES.includes(table)) return "configuration";
  if (NON_MIGRATING_TABLES.includes(table)) return "not-migrating";
  if (TRANSIENT_TABLES.includes(table)) return "transient";
  return null;
}
