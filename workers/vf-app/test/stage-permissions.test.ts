import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { PERMISSIONS } from "../src/permissions.js";
import migrationSql from "../../../migrations/0048_a_stage_declares_its_permission.sql?raw";
import { handleCreateProcess, handleCreateStage } from "../src/process-route.js";
import { handleCreateProcessInstance, visitCurrentStage } from "../src/workflow-engine.js";

/**
 * A stage declares who may work there — decision 0200.
 */

describe("the closed set, in two places", () => {
  /**
   * **A hand-copied list drifts, and this one did.**
   *
   * The migration names every permission because SQLite cannot import
   * a TypeScript constant. Writing it out, I invented five that do not
   * exist and omitted five that do — caught by comparing the two
   * before committing, which is what this now does on every run.
   */
  it("names exactly the permissions the code defines", () => {
    const inSql = [...migrationSql.matchAll(/'([A-Za-z]+\.[A-Za-z]+)'/g)]
      .map((m) => m[1])
      .sort();

    expect([...new Set(inSql)]).toEqual([...PERMISSIONS].sort());
  });
});

describe("what a stage may require", () => {
  beforeEach(async () => {
    await applyTestSchema();
    await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('ap', 'AP')").run();
  });

  async function stageRequiring(permission: string | null) {
    await env.DB.prepare(
      "INSERT INTO process_stages (id, process_id, name, sequence, required_permission) VALUES ('coding', 'ap', 'Coding', 1, ?)"
    )
      .bind(permission)
      .run();
  }

  it("accepts one from the closed set", async () => {
    // **`AP.Code` has existed since decision 0010** as a placeholder,
    // recorded as *"not built at all yet"*. A Coding stage is what it
    // was waiting for.
    await stageRequiring("AP.Code");

    const row = await env.DB.prepare(
      "SELECT required_permission FROM process_stages WHERE id = 'coding'"
    ).first<{ required_permission: string }>();
    expect(row?.required_permission).toBe("AP.Code");
  });

  it("accepts none, which is every stage today", async () => {
    await stageRequiring(null);
    const row = await env.DB.prepare(
      "SELECT required_permission FROM process_stages WHERE id = 'coding'"
    ).first<{ required_permission: string | null }>();
    expect(row?.required_permission).toBeNull();
  });
});

describe("a rule that disagrees with its stage", () => {
  /**
   * **The bug this exists to prevent, made unsayable.**
   *
   * A rule at Validation demanded `AP.Review`. Nothing objected,
   * because both are valid strings — and a working day of invoices sat
   * in a queue nobody could see.
   */
  beforeEach(async () => {
    await applyTestSchema();
    await handleCreateProcess(env.DB, { id: "ap", name: "AP" });
    await env.DB.prepare(
      "INSERT INTO rule_sets (id, name, mode) VALUES ('rs', 'rs', 'all_matches')"
    ).run();
    await handleCreateStage(env.DB, "ap", {
      id: "validation",
      name: "Validation",
      sequence: 1,
      ruleSetId: "rs",
    });
    await env.DB.prepare(
      "UPDATE process_stages SET required_permission = 'AP.Validate' WHERE id = 'validation'"
    ).run();

    await env.DB.prepare("INSERT INTO org_teams (id, name) VALUES ('ap-team', 'AP team')").run();
  });

  async function ruleAsking(permission: string) {
    await env.DB.prepare(
      "INSERT INTO rules (id, rule_set_id, sort_order, enabled) VALUES ('r1', 'rs', 1, 1)"
    ).run();
    await env.DB.prepare(
      `INSERT INTO rule_versions (rule_id, version, source_text, compiled_json, compiled_by,
                                  approved_by, approved_at, effective_from)
       VALUES ('r1', 1, 'assign a task', ?, 'test', 'alice', datetime('now'), datetime('now'))`
    )
      .bind(
        JSON.stringify({
          conditions: { all: [] },
          actions: [
            { type: "assign_task", params: { team: "ap-team", permission } },
          ],
        })
      )
      .run();

    await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES ('inv-1', '{}')").run();
    const created = await handleCreateProcessInstance(env.DB, "ap", {
      subjectType: "invoice",
      subjectId: "inv-1",
    });

    return visitCurrentStage(env.DB, (created.body as { id: string }).id, {});
  }

  it("is refused, not quietly corrected", async () => {
    /**
     * **Refused rather than preferred**, because silently overriding
     * what somebody wrote is how a rule comes to mean something other
     * than it says — decision 0033's argument that a refusal is a
     * first-class output.
     */
    const result = await ruleAsking("AP.Review");

    expect(result.status).toBe(409);
    expect((result.body as { reason: string }).reason).toBe("permission_disagrees_with_stage");
  });

  it("is accepted where it agrees", async () => {
    const result = await ruleAsking("AP.Validate");
    expect(result.status).toBe(200);
  });

  it("uses the stage's where the rule names none", async () => {
    // Which is the shape a rule should have once a stage declares one.
    await env.DB.prepare(
      "INSERT INTO rules (id, rule_set_id, sort_order, enabled) VALUES ('r1', 'rs', 1, 1)"
    ).run();
    await env.DB.prepare(
      `INSERT INTO rule_versions (rule_id, version, source_text, compiled_json, compiled_by,
                                  approved_by, approved_at, effective_from)
       VALUES ('r1', 1, 'assign a task', ?, 'test', 'alice', datetime('now'), datetime('now'))`
    )
      .bind(
        JSON.stringify({
          conditions: { all: [] },
          actions: [{ type: "assign_task", params: { team: "ap-team" } }],
        })
      )
      .run();

    await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES ('inv-1', '{}')").run();
    const created = await handleCreateProcessInstance(env.DB, "ap", {
      subjectType: "invoice",
      subjectId: "inv-1",
    });
    await visitCurrentStage(env.DB, (created.body as { id: string }).id, {});

    const task = await env.DB.prepare(
      "SELECT required_permission FROM tasks LIMIT 1"
    ).first<{ required_permission: string }>();
    expect(task?.required_permission).toBe("AP.Validate");
  });
});
