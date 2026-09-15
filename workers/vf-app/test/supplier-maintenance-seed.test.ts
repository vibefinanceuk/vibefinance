import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { applyTestSchema } from "./setup.js";
import seedSql from "../../../docs/operations/supplier-maintenance-seed.sql?raw";

/**
 * **The test harness's own known limitation** — decision 0160 already
 * found this: `env.DB.exec()` here expects one statement per line and
 * chokes on this file's own comments and multi-line statements, unlike
 * the real `wrangler d1 execute`, which already parsed this file fine
 * (it got as far as a real foreign-key error, not a parse error).
 * Stripped and split by hand here, the same way `apply_migrations.py`
 * itself has to for every other migration.
 */
function statementsIn(sql: string): string[] {
  const withoutComments = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  return withoutComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

describe("the actual, real seed script file — decision 0350 follow-up", () => {
  beforeEach(async () => {
    await applyTestSchema();
    // A real org unit, matching what a live customer would have —
    // the top-level entity the script's own subquery looks for.
    await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('acme', 'Acme Group')").run();
  });

  it("runs end to end with no foreign key violation, against a database with a real top-level org unit", async () => {
    for (const statement of statementsIn(seedSql)) {
      await env.DB.prepare(statement).run();
    }

    const process = await env.DB.prepare("SELECT id, version FROM processes WHERE id = 'supplier-maintenance'").first();
    expect(process).toEqual({ id: "supplier-maintenance", version: 1 });

    const stage = await env.DB
      .prepare("SELECT rule_set_id, required_permission FROM process_stages WHERE id = 'supplier-maintenance-review'")
      .first();
    expect(stage).toEqual({ rule_set_id: "supplier-maintenance-rules", required_permission: "Supplier.Maintain" });

    const team = await env.DB.prepare("SELECT unit_id FROM org_teams WHERE id = 'supplier-maintenance-team'").first();
    expect(team).toEqual({ unit_id: "acme" });

    const ruleVersion = await env.DB
      .prepare("SELECT approved_by, effective_from FROM rule_versions WHERE rule_id = 'b59c31d1-82c6-488d-ab98-3320569b32c6'")
      .first<{ approved_by: string; effective_from: string }>();
    expect(ruleVersion?.approved_by).toBe("operator");
    expect(ruleVersion?.effective_from).not.toBeNull();
  });

  /**
   * **The other real risk the script's own comments already name.**
   * A database with no top-level org unit at all (or a schema where
   * every row has a parent) makes the subquery return NULL, refused
   * by `unit_id`'s own `NOT NULL` — a different, clearer error than
   * the foreign-key one this test file exists to catch, confirmed
   * directly rather than assumed.
   */
  it("fails clearly, on the team's own NOT NULL constraint, when no top-level org unit exists at all", async () => {
    await env.DB.prepare("DELETE FROM org_units").run();
    await expect(
      (async () => {
        for (const statement of statementsIn(seedSql)) {
          await env.DB.prepare(statement).run();
        }
      })()
    ).rejects.toThrow(/NOT NULL/i);
  });
});
