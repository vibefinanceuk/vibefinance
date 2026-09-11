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
  /**
   * **A process's shape, versioned** (decision 0150).
   *
   * Which stages are in a process at a given version is the same kind
   * of fact as the stages themselves, so it travels with them: a
   * production environment without it has instances pointing at a
   * version that does not exist.
   */
  "process_stage_versions",

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
  /**
   * **The supplier mirror** (decisions 0208, 0209). Configuration, and
   * the argument is the ERP identifier: a production environment
   * without these cannot name an invoice's supplier to the ERP, so
   * every invoice arrives unmatched and every one routes for review.
   *
   * Loaded from the customer's own master file rather than created
   * here, which is why it travels with configuration and not with work.
   */
  "suppliers",

  /**
   * **The accounting frame** (decision 0195). Oracle's ledger, SAP's
   * controlling area: a chart of accounts and a fiscal calendar, to
   * which legal entities are assigned. Cost centres hang beneath it,
   * so an environment without it has a tree with no root.
   */
  "ledgers",

  /**
   * **Which rules run for which unit** (decision 0196), and **which
   * fields a unit may key** (decision 0197).
   *
   * Both are overrides on a stage rather than tables of their own
   * subject — absent, every unit gets the group's answer, which is what
   * a new environment should have until somebody says otherwise.
   */
  "stage_rule_set_overrides",
  "stage_field_visibility_overrides",

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

  /**
   * **When the mirror was last told the truth.** A record of something
   * that happened, like any other event — and a new environment has no
   * loads because it has had none.
   */
  "supplier_loads",

  /**
   * **Not a table, an intermediate.** Migration 0047 rebuilt
   * `org_user_roles` to change its primary key, and SQLite cannot alter
   * one — so the new shape is created under a temporary name, filled,
   * and renamed.
   *
   * It does not exist in any finished schema. Classified only because
   * decision 0118's check reads `CREATE TABLE` statements rather than
   * the schema they produce, and an unclassified name is an error
   * whether or not the table survives.
   */
  "org_user_roles_new",

  // Work in flight, and the record of work done.
  "process_instances",
  "stage_visits",
  "stage_visit_steps",
  "tasks",
  "invoice_runs",
  "invoice_run_steps",

  // Intake's own history, and documents half-arrived.
  //
  // **`inbound_email_events` belongs here for the same reason**
  // (decision 0147): it records what a sandbox received, and a
  // production environment that inherited it would claim invoices
  // arrived at an address that never existed there.
  "inbound_email_events",
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
