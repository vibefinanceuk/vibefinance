import { describe, expect, it } from "vitest";
import {
  CONFIGURATION_TABLES,
  NON_MIGRATING_TABLES,
  TRANSIENT_TABLES,
  ALL_CLASSIFIED_TABLES,
  classifyTable,
} from "./table-classes.js";

/**
 * The check decision 0118 asked for.
 *
 * **A convention cannot be checked; a list can.** Prefixing tables
 * `con_` and `run_` was proposed and rejected — forty tables, 273 SQL
 * references, and decision 0084's demonstration of how renaming a
 * referenced table goes in SQLite. This is what that proposal wanted,
 * enforced rather than hoped for.
 */

/**
 * Every table the migration chain creates, read from the chain itself.
 *
 * Loaded through Vite's own glob rather than `node:fs`, because
 * `shared` is a Workers package and has no Node types — a test that
 * only compiles because vitest happens to provide them at runtime is a
 * test that lies to `tsc`.
 */
const MIGRATION_SQL = import.meta.glob("../../migrations/*.sql", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

function tablesInSchema(): string[] {
  const created = new Set<string>();

  for (const sql of Object.values(MIGRATION_SQL)) {
    for (const match of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z_]+)/gi)) {
      created.add(match[1]);
    }
    // A rebuild renames a new table over the old one, so the name that
    // survives is the renamed-to one.
    for (const match of sql.matchAll(/ALTER TABLE [a-z_]+ RENAME TO ([a-z_]+)/gi)) {
      created.add(match[1]);
    }
  }
  return [...created].sort();
}

describe("every table is classified", () => {
  it("names each one exactly once", async () => {
    // **The failure this exists to produce.** A table added and not
    // classified silently migrates or silently does not, and nobody
    // finds out until a customer's production environment is missing
    // something or carrying something it should not.
    const schema = tablesInSchema();
    const unclassified = schema.filter((table) => classifyTable(table) === null);

    expect(
      unclassified,
      `In the schema and classified nowhere: ${unclassified.join(", ")}. ` +
        "Add each to CONFIGURATION_TABLES or NON_MIGRATING_TABLES in " +
        "shared/migration/table-classes.ts. Decision 0118 has the line: " +
        "what a customer configured migrates; what their instance did, " +
        "and who did it, does not."
    ).toEqual([]);
  });

  it("classifies nothing that is not in the schema", () => {
    // The other direction: a table renamed or dropped leaves a stale
    // entry claiming to classify something that no longer exists.
    const schema = new Set(tablesInSchema());
    const stale = ALL_CLASSIFIED_TABLES.filter((table) => !schema.has(table));

    expect(stale, `Classified and not in the schema: ${stale.join(", ")}`).toEqual([]);
  });

  it("puts nothing in two classes at once", () => {
    const all = [...CONFIGURATION_TABLES, ...NON_MIGRATING_TABLES, ...TRANSIENT_TABLES];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("the line decision 0118 draws", () => {
  it("migrates definitions and not assignments", () => {
    // The operator's own words: "roles and permissions can transfer,
    // assignment of them does not."
    expect(classifyTable("org_roles")).toBe("configuration");
    expect(classifyTable("org_user_roles")).toBe("not-migrating");
    expect(classifyTable("org_teams")).toBe("configuration");
    expect(classifyTable("org_team_members")).toBe("not-migrating");
  });

  it("does not migrate people", () => {
    // A user is a person, not a setting. Access to a sandbox is not
    // access to real invoices.
    expect(classifyTable("org_users")).toBe("not-migrating");
    expect(classifyTable("org_authority_limits")).toBe("not-migrating");
  });

  it("migrates the workflow a customer spent a fortnight on", () => {
    for (const table of ["processes", "process_stages", "rule_sets", "rules", "rule_versions"]) {
      expect(classifyTable(table), table).toBe("configuration");
    }
  });

  it("keeps a rule's worked examples with the rule", () => {
    // A rule cannot be activated without confirmed examples, so a rule
    // arriving without them arrives unusable.
    expect(classifyTable("rule_examples")).toBe("configuration");
  });

  it("does not migrate documents, or anything derived from them", () => {
    for (const table of [
      "invoice_headers",
      "invoice_lines",
      "invoice_documents",
      "keyed_fields",
      "field_overrides",
      "purchase_orders",
    ]) {
      expect(classifyTable(table), table).toBe("not-migrating");
    }
  });

  it("does not migrate work in flight", () => {
    for (const table of ["process_instances", "stage_visits", "tasks"]) {
      expect(classifyTable(table), table).toBe("not-migrating");
    }
  });

  it("migrates how a screen is arranged", () => {
    expect(classifyTable("field_visibility")).toBe("configuration");
    expect(classifyTable("stage_field_visibility")).toBe("configuration");
  });

  it("does not migrate a cached licence", () => {
    // Fetched, never authored, and a new environment has its own.
    expect(classifyTable("licence_cache")).toBe("not-migrating");
  });
});
