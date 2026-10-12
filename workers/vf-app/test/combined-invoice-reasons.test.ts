import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCreateProcessInstance, visitCurrentStage } from "../src/workflow-engine.js";
import { handleCreateProcess, handleCreateStage } from "../src/process-route.js";
import { checkTaskRule, taskLines } from "../src/stage-actions-route.js";
import { handleListMyTasks, reasonsOf } from "../src/task-list-route.js";
import { handleGetInvoice } from "../src/invoice-facts-route.js";

/**
 * **Reasons for the whole invoice, combined — decision 0746.** At
 * Validation (evaluated once per invoice), "No number" and "No supplier"
 * both send INV-1 to AP Team; "Over 1000" sends it to Finance. AP Team gets
 * one task with both reasons; Finance its own.
 */

async function rule(id: string, name: string, conditions: unknown, team: string, order: number) {
  await env.DB.prepare("INSERT INTO rules (id, rule_set_id, sort_order, enabled, name) VALUES (?, 'rs', ?, 1, ?)").bind(id, order, name).run();
  await env.DB.prepare(
    "INSERT INTO rule_versions (rule_id, version, source_text, compiled_json, compiled_by, approved_by, approved_at, effective_from) VALUES (?, 1, ?, ?, 'test', 'dan', '2026-01-01', '2026-01-01')"
  )
    .bind(id, name, JSON.stringify({ conditions, actions: [{ type: "assign_task", params: { team, permission: "AP.Validate" } }] }))
    .run();
}

const HEADER = { "BT-5": "GBP", "BT-1": "", "BT-27": "", "BT-112": 1500 };

async function seed() {
  await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('u1', 'Acme')").run();
  await env.DB.prepare("INSERT INTO org_teams (id, name, unit_id) VALUES ('team-ap', 'AP Team', 'u1'), ('team-fin', 'Finance', 'u1')").run();
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('sam', 'sam@acme.com', 'Sam')").run();
  await env.DB.prepare(`INSERT INTO org_roles (id, name, permissions_json) VALUES ('r', 'r', '["AP.Validate","AP.TaskView"]')`).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES ('sam', 'r')").run();
  await env.DB.prepare("INSERT INTO org_team_members (team_id, user_id) VALUES ('team-ap', 'sam')").run();
  await env.DB.prepare("INSERT INTO rule_sets (id, name, mode, status) VALUES ('rs', 'Validation', 'all_matches', 'active')").run();
  await rule("r-number", "No number", { field: "BT-1", operator: "is", value: "" }, "team-ap", 0);
  await rule("r-supplier", "No supplier", { field: "BT-27", operator: "is", value: "" }, "team-ap", 1);
  await rule("r-big", "Over 1000", { field: "BT-112", operator: "greater_than", value: 1000 }, "team-fin", 2);
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES ('inv-1', ?)").bind(JSON.stringify(HEADER)).run();
  await handleCreateProcess(env.DB, { id: "p1", name: "AP" });
  await handleCreateStage(env.DB, "p1", { id: "validation", name: "Validation", sequence: 1, ruleSetId: "rs" });
  await handleCreateStage(env.DB, "p1", { id: "review", name: "Review", sequence: 2 });
  const created = await handleCreateProcessInstance(env.DB, "p1", { subjectType: "invoice", subjectId: "inv-1" });
  const visited = await visitCurrentStage(env.DB, (created.body as { id: string }).id, HEADER, []);
  expect(visited.status, JSON.stringify(visited.body)).toBe(200);
}

type TaskRow = { id: string; owner_team_id: string; line_number: number | null; rule_id: string; lines_json: string | null };
const tasks = async () =>
  (await env.DB.prepare("SELECT id, owner_team_id, line_number, rule_id, lines_json FROM tasks ORDER BY owner_team_id").all<TaskRow>()).results;
const setFacts = (facts: Record<string, unknown>) => env.DB.prepare("UPDATE invoice_headers SET facts_json = ? WHERE id = 'inv-1'").bind(JSON.stringify(facts)).run();

beforeEach(async () => {
  await applyTestSchema();
  await seed();
});

describe("one task per hands for the invoice's reasons", () => {
  it("AP Team gets one task with both reasons; Finance its own, stored as before", async () => {
    const [ap, fin] = await tasks();
    expect(ap).toMatchObject({ owner_team_id: "team-ap", line_number: null, rule_id: "r-number" });
    expect(JSON.parse(ap.lines_json!)).toEqual([{ line: null, rule: "r-number" }, { line: null, rule: "r-supplier" }]);
    expect(fin).toMatchObject({ owner_team_id: "team-fin", line_number: null, rule_id: "r-big", lines_json: null });
    expect(taskLines(ap)).toEqual([{ line: null, rule: "r-number" }, { line: null, rule: "r-supplier" }]);
    expect(reasonsOf(ap.lines_json)).toBe(2);
    expect(reasonsOf(fin.lines_json)).toBe(1);
  });

  it("still fires while either reason holds, naming it; cleared only when both have", async () => {
    const [ap] = await tasks();
    expect(await checkTaskRule(env.DB, ap.id)).toMatchObject({ state: "fires", ruleName: "No number", firingLines: [] });
    await setFacts({ ...HEADER, "BT-1": "INV-1" });
    expect(await checkTaskRule(env.DB, ap.id)).toMatchObject({ state: "fires", ruleName: "No supplier" });
    await setFacts({ ...HEADER, "BT-1": "INV-1", "BT-27": "Lager Nord" });
    expect(await checkTaskRule(env.DB, ap.id)).toMatchObject({ state: "cleared" });
  });

  it("the Tasks list says how many reasons, and the invoice's banner names each", async () => {
    const listed = (await handleListMyTasks(env.DB, "sam")).body as { tasks: { reasonCount: number; lineNumbers: number[] | null }[] };
    expect(listed.tasks.map((t) => [t.reasonCount, t.lineNumbers])).toEqual([[2, null]]);
    // Finance's task done, the banner shows AP Team's: its first reason, and the other beside it.
    await env.DB.prepare("UPDATE tasks SET status = 'completed' WHERE owner_team_id = 'team-fin'").run();
    const invoice = (await handleGetInvoice(env.DB, "inv-1")).body as { openTaskReason: { name: string; others: { name: string }[]; lines: number[] | null } };
    expect(invoice.openTaskReason).toMatchObject({ name: "No number", others: [{ name: "No supplier", standardKey: null }], lines: null });
  });
});
