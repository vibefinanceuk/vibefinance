import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import worker from "../src/index.js";
import type { Env } from "../src/index.js";
import { handleCreateProcessInstance, visitCurrentStage } from "../src/workflow-engine.js";
import { handleAddDraftStage, handleCreateProcess, handleCreateStage, handleGetProcess, handleUpdateStage } from "../src/process-route.js";
import { checkTaskRule, ruleStillFiresForTask, taskLines } from "../src/stage-actions-route.js";
import { findLineCoder } from "../src/approval-hierarchy.js";
import { handleListMyTasks, linesOf } from "../src/task-list-route.js";
import { handleGetInvoice } from "../src/invoice-facts-route.js";
import { t } from "../src/i18n.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * **Tasks for lines — decision 0709.** A stage evaluated once per line can
 * raise one task per line (as before) or one task for all the lines going
 * to the same team, person and permission.
 *
 * INV-1 has four lines. Rule "Over 100" sends a line over 100 to the AP
 * Matching team; rule "IT cost" sends a line coded to IT to the IT team.
 *   line 1: 150        → Matching
 *   line 2: 150, IT    → Matching and IT
 *   line 3: 50,  IT    → IT
 *   line 4: 20         → nothing
 */

const LINES = [
  { lineNumber: 1, "BT-131": 150 },
  { lineNumber: 2, "BT-131": 150, "BT-133": "IT" },
  { lineNumber: 3, "BT-131": 50, "BT-133": "IT" },
  { lineNumber: 4, "BT-131": 20 },
];

async function rule(id: string, name: string, conditions: unknown, team: string) {
  await env.DB.prepare("INSERT INTO rules (id, rule_set_id, sort_order, enabled, name) VALUES (?, 'rs', ?, 1, ?)").bind(id, id === "r-over" ? 0 : 1, name).run();
  await env.DB.prepare(
    "INSERT INTO rule_versions (rule_id, version, source_text, compiled_json, compiled_by, approved_by, approved_at, effective_from) VALUES (?, 1, ?, ?, 'test', 'dan', '2026-01-01', '2026-01-01')"
  )
    .bind(id, name, JSON.stringify({ conditions, actions: [{ type: "assign_task", params: { team, permission: "AP.Match" } }] }))
    .run();
}

async function seed(lineTasks: "per_line" | "combined") {
  await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('u1', 'Acme')").run();
  await env.DB.prepare("INSERT INTO org_teams (id, name, unit_id) VALUES ('team-match', 'AP Matching', 'u1'), ('team-it', 'IT', 'u1')").run();
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('sam', 'sam@acme.com', 'Sam')").run();
  await env.DB.prepare(`INSERT INTO org_roles (id, name, permissions_json) VALUES ('r', 'r', '["AP.Match","AP.TaskView","Admin.Configure"]')`).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES ('sam', 'r')").run();
  await env.DB.prepare("INSERT INTO org_team_members (team_id, user_id) VALUES ('team-match', 'sam')").run();
  await env.DB.prepare("INSERT INTO rule_sets (id, name, mode, status) VALUES ('rs', 'Matching', 'all_matches', 'active')").run();
  await rule("r-over", "Over 100", { field: "BT-131", operator: "greater_than", value: 100 }, "team-match");
  await rule("r-it", "IT cost", { field: "BT-133", operator: "is", value: "IT" }, "team-it");

  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES ('inv-1', ?)").bind(JSON.stringify({ "BT-1": "INV-1", "BT-5": "GBP" })).run();
  for (const l of LINES) {
    const { lineNumber, ...facts } = l;
    await env.DB.prepare("INSERT INTO invoice_lines (id, invoice_id, line_number, facts_json) VALUES (?, 'inv-1', ?, ?)").bind(`l${lineNumber}`, lineNumber, JSON.stringify(facts)).run();
  }

  await handleCreateProcess(env.DB, { id: "p1", name: "AP" });
  await handleCreateStage(env.DB, "p1", { id: "matching", name: "Matching", sequence: 1, ruleSetId: "rs", evaluationScope: "line" });
  await handleCreateStage(env.DB, "p1", { id: "review", name: "Review", sequence: 2 });
  await env.DB.prepare("UPDATE process_stages SET line_tasks = ? WHERE id = 'matching'").bind(lineTasks).run();
  const created = await handleCreateProcessInstance(env.DB, "p1", { subjectType: "invoice", subjectId: "inv-1" });
  const instanceId = (created.body as { id: string }).id;
  const visited = await visitCurrentStage(env.DB, instanceId, { "BT-5": "GBP" }, LINES);
  expect(visited.status, JSON.stringify(visited.body)).toBe(200);
  return instanceId;
}

type TaskRow = { id: string; owner_team_id: string; line_number: number | null; rule_id: string; lines_json: string | null };
const tasks = async () =>
  (await env.DB.prepare("SELECT id, owner_team_id, line_number, rule_id, lines_json FROM tasks ORDER BY owner_team_id, line_number").all<TaskRow>()).results;
const setLine = (n: number, facts: Record<string, unknown>) =>
  env.DB.prepare("UPDATE invoice_lines SET facts_json = ? WHERE invoice_id = 'inv-1' AND line_number = ?").bind(JSON.stringify(facts), n).run();

beforeEach(async () => {
  await applyTestSchema();
});

describe("raising the tasks", () => {
  it("one per line: a task for every line and rule, as before", async () => {
    await seed("per_line");
    const raised = await tasks();
    expect(raised.map((r) => [r.owner_team_id, r.line_number, r.lines_json])).toEqual([
      ["team-it", 2, null],
      ["team-it", 3, null],
      ["team-match", 1, null],
      ["team-match", 2, null],
    ]);
  });

  it("combined: one task for each team, listing its lines and the rule for each", async () => {
    await seed("combined");
    const raised = await tasks();
    expect(raised).toHaveLength(2);
    const [it, match] = raised;
    expect(match).toMatchObject({ owner_team_id: "team-match", line_number: null, rule_id: "r-over" });
    expect(JSON.parse(match.lines_json!)).toEqual([{ line: 1, rule: "r-over" }, { line: 2, rule: "r-over" }]);
    expect(it).toMatchObject({ owner_team_id: "team-it", line_number: null, rule_id: "r-it" });
    expect(JSON.parse(it.lines_json!)).toEqual([{ line: 2, rule: "r-it" }, { line: 3, rule: "r-it" }]);
  });

  it("combined, with only one line for a team: stored exactly as a per-line task", async () => {
    LINES[1]["BT-131"] = 50; // line 2 no longer over 100
    try {
      await seed("combined");
    } finally {
      LINES[1]["BT-131"] = 150;
    }
    const match = (await tasks()).find((r) => r.owner_team_id === "team-match")!;
    expect(match).toMatchObject({ line_number: 1, rule_id: "r-over", lines_json: null });
  });

  it("a stage evaluated once per invoice is never combined", async () => {
    await env.DB.prepare("INSERT INTO rule_sets (id, name, mode, status) VALUES ('rs', 'x', 'all_matches', 'active')").run();
    await handleCreateProcess(env.DB, { id: "p1", name: "AP" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "S", sequence: 1, ruleSetId: "rs" });
    const r = await handleUpdateStage(env.DB, "p1", "s1", { lineTasks: "combined" });
    expect(r.body).toMatchObject({ evaluationScope: "header", lineTasks: "per_line" });
  });
});

describe("taskLines and linesOf", () => {
  it("read a combined task's lines, and treat any other task as its own line", () => {
    expect(taskLines({ rule_id: "r", line_number: 3, lines_json: null })).toEqual([{ line: 3, rule: "r" }]);
    expect(taskLines({ rule_id: "r", line_number: null, lines_json: '[{"line":2,"rule":"a"},{"line":1,"rule":"b"}]' })).toEqual([
      { line: 2, rule: "a" },
      { line: 1, rule: "b" },
    ]);
    expect(taskLines({ rule_id: "r", line_number: null, lines_json: "not json" })).toEqual([{ line: null, rule: "r" }]);
    expect(linesOf('[{"line":4},{"line":1},{"line":4}]')).toEqual([1, 4]);
    expect(linesOf(null)).toBeNull();
  });
});

describe("Complete on a combined task checks every line", () => {
  it("still fires while any line does, names those lines, and clears once all have", async () => {
    await seed("combined");
    const match = (await tasks()).find((r) => r.owner_team_id === "team-match")!;

    expect(await checkTaskRule(env.DB, match.id)).toMatchObject({ state: "fires", ruleName: "Over 100", firingLines: [1, 2], combined: true });

    await setLine(1, { "BT-131": 90 });
    const still = await ruleStillFiresForTask(env.DB, match.id);
    expect(still).toEqual({ blocked: true, ruleName: "Over 100", lines: [2], combined: true });
    expect(t("completeBlockedRuleStillFiresLines", "en", { rule: "Over 100", lines: still.lines.join(", ") })).toBe(
      'the condition that raised this task ("Over 100") still holds on line 2'
    );

    await setLine(2, { "BT-131": 90, "BT-133": "IT" });
    expect(await checkTaskRule(env.DB, match.id)).toMatchObject({ state: "cleared", firingLines: [] });
    // The IT task still has its lines: its own rule is unaffected.
    const itTask = (await tasks()).find((r) => r.owner_team_id === "team-it")!;
    expect(await checkTaskRule(env.DB, itTask.id)).toMatchObject({ state: "fires", firingLines: [2, 3] });
  });

  it("a per-line task answers as it did", async () => {
    await seed("per_line");
    const line1 = (await tasks()).find((r) => r.owner_team_id === "team-match" && r.line_number === 1)!;
    expect(await checkTaskRule(env.DB, line1.id)).toMatchObject({ state: "fires", firingLines: [1], combined: false });
  });

  it("the Complete route names the lines still failing", async () => {
    await seed("combined");
    await env.DB.prepare("INSERT INTO stage_actions (stage_id, action, reverify_rule_on_complete) VALUES ('matching', 'complete', 1)").run();
    const match = (await tasks()).find((r) => r.owner_team_id === "team-match")!;
    await env.DB.prepare("UPDATE tasks SET claimed_by = 'sam', claimed_at = datetime('now') WHERE id = ?").bind(match.id).run();
    await setLine(1, { "BT-131": 90 });
    const apiKey = await signIn();
    const res = await call("POST", `/tasks/${match.id}/complete`, apiKey, {});
    const body = (await res.json()) as { error: string; reason: string; lines: number[] };
    expect(res.status, JSON.stringify(body)).toBe(409);
    expect(body).toMatchObject({ reason: "rule_still_fires", lines: [2] });
    expect(body.error).toContain("still holds on line 2");
  });
});

describe("what reads a task's line", () => {
  it("the approver after coding is whoever completed the combined task covering that line", async () => {
    await seed("combined");
    const match = (await tasks()).find((r) => r.owner_team_id === "team-match")!;
    await env.DB.prepare("UPDATE tasks SET status = 'completed', completed_by = 'sam', completed_at = datetime('now') WHERE id = ?").bind(match.id).run();
    // Asked from Review's place (sequence 2), whose previous stage is Matching.
    const instanceId = (await env.DB.prepare("SELECT id FROM process_instances").first<{ id: string }>())!.id;
    expect(await findLineCoder(env.DB, instanceId, "p1", 2, 1, 2)).toBe("sam");
    expect(await findLineCoder(env.DB, instanceId, "p1", 2, 1, 3)).toBeNull();
  });

  it("the Tasks list gives a combined task's lines, and the invoice's banner too", async () => {
    await seed("combined");
    const listed = (await handleListMyTasks(env.DB, "sam")).body as { tasks: { lineNumber: number | null; lineNumbers: number[] | null }[] };
    expect(listed.tasks.map((t) => [t.lineNumber, t.lineNumbers])).toContainEqual([null, [1, 2]]);
    const invoice = (await handleGetInvoice(env.DB, "inv-1")).body as { openTaskReason: { lines: number[] | null } };
    expect(invoice.openTaskReason.lines).not.toBeNull();
  });
});

describe("editing a stage", () => {
  it("changes name, evaluated, and Tasks for lines; the process says so", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "AP" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Match", sequence: 1 });
    const r = await handleUpdateStage(env.DB, "p1", "s1", { name: "Matching", evaluationScope: "line", lineTasks: "combined" });
    expect(r).toEqual({ status: 200, body: { id: "s1", processId: "p1", name: "Matching", evaluationScope: "line", lineTasks: "combined" } });
    const process = (await handleGetProcess(env.DB, "p1")).body as { stages: { id: string; lineTasks: string; evaluationScope: string }[] };
    expect(process.stages.find((s) => s.id === "s1")).toMatchObject({ evaluationScope: "line", lineTasks: "combined" });

    // Back to once per invoice: nothing left to combine.
    expect((await handleUpdateStage(env.DB, "p1", "s1", { evaluationScope: "header" })).body).toMatchObject({ lineTasks: "per_line" });
  });

  it("refuses an unknown value, an empty name, and a stage from another process", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "AP" });
    await handleCreateProcess(env.DB, { id: "p2", name: "AR" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "S", sequence: 1 });
    expect((await handleUpdateStage(env.DB, "p1", "s1", { lineTasks: "bundled" })).status).toBe(400);
    expect((await handleUpdateStage(env.DB, "p1", "s1", { name: "  " })).status).toBe(400);
    expect((await handleUpdateStage(env.DB, "p2", "s1", { name: "X" })).status).toBe(404);
  });

  it("a draft stage can be added combined", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "AP" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "S", sequence: 1 });
    const r = await handleAddDraftStage(env.DB, "p1", { id: "coding", name: "Coding", evaluationScope: "line", lineTasks: "combined" });
    expect(r.body).toMatchObject({ lineTasks: "combined" });
  });

  it("PUT /processes/:id/draft/stages/:stage, for someone who may configure", async () => {
    await seed("per_line");
    const apiKey = await signIn();
    const res = await call("PUT", "/processes/p1/draft/stages/matching", apiKey, { lineTasks: "combined" });
    expect(res.status).toBe(200);
    expect((await env.DB.prepare("SELECT line_tasks FROM process_stages WHERE id = 'matching'").first<{ line_tasks: string }>())!.line_tasks).toBe("combined");
    expect((await call("PUT", "/processes/p1/draft/stages/matching", null, { lineTasks: "combined" })).status).toBe(401);
  });
});

async function signIn() {
  const apiKey = generateApiKey();
  await env.DB.prepare("UPDATE org_users SET api_key_hash = ? WHERE id = 'sam'").bind(await hashApiKey(apiKey)).run();
  const claims = { customerId: "test-customer", plan: "standard", features: [], volumeEntitlement: 10000, status: "active", issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() };
  await env.DB.prepare("INSERT OR REPLACE INTO licence_cache (id, claims_json, fetched_at) VALUES (1, ?, ?)").bind(JSON.stringify(claims), new Date().toISOString()).run();
  return apiKey;
}

const call = (method: string, path: string, apiKey: string | null, body?: unknown) =>
  worker.fetch(
    new Request(`https://example.com${path}`, {
      method,
      headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env as unknown as Env,
    { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext
  );
