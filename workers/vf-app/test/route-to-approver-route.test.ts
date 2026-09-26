import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleRouteToApproverCandidates } from "../src/route-to-approver-route.js";
import { handleCreateTask } from "../src/task-route.js";
import { handleCreateUser } from "../src/org-route.js";
import { handleCreateProcess, handleCreateStage } from "../src/process-route.js";
import { handleCreateProcessInstance } from "../src/workflow-engine.js";

/**
 * Route To Approver's own candidate list — decision 0495.
 *
 * Mirrors `handleReassignCandidates`'s own test shape (`task-route.
 * test.ts`): standing checked first, then the two conditions that
 * decide whether this ever applies at all — a next stage that
 * resolves through Approval Hierarchy, and the org actually
 * configured for Manual mode — before the candidate list itself.
 */

const asUser = (id: string) => ({ id, email: `${id}@x.com`, name: id });

async function grant(userId: string, permissions: string[]): Promise<void> {
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)")
    .bind(`r-${userId}`, userId, JSON.stringify(permissions))
    .run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES (?, ?)").bind(userId, `r-${userId}`).run();
}

/**
 * A real Coding task ('t'), on stage sequence 1, whose process's stage
 * 2 ('approval') requires `AP.Approve` and — only when `usesHierarchy`
 * is true — is marked `uses_approval_hierarchy`. `stage_visit_id` is
 * wired to a real `process_instances` row so `process_version` is
 * something other than null, the same as any task a real cascade
 * would ever produce.
 */
async function seedCodingTask(options: { usesHierarchy?: boolean; owner?: string; team?: string } = {}): Promise<void> {
  await handleCreateProcess(env.DB, { id: "p1", name: "AP" });
  await handleCreateStage(env.DB, "p1", { id: "coding", name: "Coding", sequence: 1 });
  await handleCreateStage(env.DB, "p1", { id: "approval", name: "Approval", sequence: 2 });
  if (options.usesHierarchy) {
    await env.DB.prepare("UPDATE process_stages SET uses_approval_hierarchy = 1, required_permission = 'AP.Approve' WHERE id = 'approval'").run();
  }
  const created = await handleCreateProcessInstance(env.DB, "p1", { subjectType: "invoice", subjectId: "inv-1" });
  const instanceId = (created.body as { id: string }).id;
  const visitId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome, created_at) VALUES (?, ?, 'coding', 'matched', datetime('now'))"
  )
    .bind(visitId, instanceId)
    .run();

  await handleCreateTask(env.DB, {
    id: "t",
    stageId: "coding",
    teamId: options.team,
    userId: options.owner,
    requiredPermission: "AP.Code",
  });
  await env.DB.prepare("UPDATE tasks SET stage_visit_id = ? WHERE id = 't'").bind(visitId).run();
}

beforeEach(async () => {
  await applyTestSchema();
  await handleCreateUser(env.DB, { id: "alice", email: "alice@x.com", name: "Alice" });
});

describe("handleRouteToApproverCandidates", () => {
  it("404s a task that does not exist", async () => {
    expect((await handleRouteToApproverCandidates(env.DB, "nope", asUser("alice"))).status).toBe(404);
  });

  it("403s a named-user task asked about by somebody other than the assigned user", async () => {
    await seedCodingTask({ usesHierarchy: true, owner: "alice" });
    await env.DB.prepare("UPDATE org_approval_config SET mode = 'manual' WHERE id = 1").run();
    await handleCreateUser(env.DB, { id: "mallory", email: "mallory@x.com", name: "Mallory" });
    const result = await handleRouteToApproverCandidates(env.DB, "t", asUser("mallory"));
    expect(result.status).toBe(403);
  });

  it("409s a team task that was never claimed", async () => {
    await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('u1', 'Acme France')").run();
    await env.DB.prepare("INSERT INTO org_teams (id, name, unit_id) VALUES ('ap', 'AP', 'u1')").run();
    await seedCodingTask({ usesHierarchy: true, team: "ap" });
    await env.DB.prepare("UPDATE org_approval_config SET mode = 'manual' WHERE id = 1").run();
    const result = await handleRouteToApproverCandidates(env.DB, "t", asUser("alice"));
    expect(result.status).toBe(409);
  });

  it("400s when the very next stage does not resolve through Approval Hierarchy at all", async () => {
    await seedCodingTask({ usesHierarchy: false, owner: "alice" });
    await env.DB.prepare("UPDATE org_approval_config SET mode = 'manual' WHERE id = 1").run();
    const result = await handleRouteToApproverCandidates(env.DB, "t", asUser("alice"));
    expect(result.status).toBe(400);
  });

  it("400s when the next stage needs Approval Hierarchy but the org is not configured for Manual mode", async () => {
    await seedCodingTask({ usesHierarchy: true, owner: "alice" });
    // employee_supervisor is applyTestSchema's own default — no
    // explicit UPDATE needed, which is itself the point being tested.
    const result = await handleRouteToApproverCandidates(env.DB, "t", asUser("alice"));
    expect(result.status).toBe(400);
  });

  it("200s with every org-wide holder of the next stage's own required_permission, nobody else", async () => {
    await seedCodingTask({ usesHierarchy: true, owner: "alice" });
    await env.DB.prepare("UPDATE org_approval_config SET mode = 'manual' WHERE id = 1").run();
    await handleCreateUser(env.DB, { id: "carol", email: "carol@x.com", name: "Carol" });
    await handleCreateUser(env.DB, { id: "dana", email: "dana@x.com", name: "Dana" });
    await grant("carol", ["AP.Approve"]);
    await grant("dana", ["AP.Code"]); // holds a DIFFERENT permission — never a candidate.

    const result = await handleRouteToApproverCandidates(env.DB, "t", asUser("alice"));
    expect(result.status).toBe(200);
    expect((result.body as { candidates: { id: string }[] }).candidates.map((c) => c.id)).toEqual(["carol"]);
  });

  it("200s with an empty list, not an error, when nobody holds the next stage's own permission yet", async () => {
    await seedCodingTask({ usesHierarchy: true, owner: "alice" });
    await env.DB.prepare("UPDATE org_approval_config SET mode = 'manual' WHERE id = 1").run();
    const result = await handleRouteToApproverCandidates(env.DB, "t", asUser("alice"));
    expect(result.status).toBe(200);
    expect((result.body as { candidates: unknown[] }).candidates).toEqual([]);
  });

  it("a unit-scoped grant still counts — this list is org-wide, not filtered by unit", async () => {
    await seedCodingTask({ usesHierarchy: true, owner: "alice" });
    await env.DB.prepare("UPDATE org_approval_config SET mode = 'manual' WHERE id = 1").run();
    await handleCreateUser(env.DB, { id: "erin", email: "erin@x.com", name: "Erin" });
    await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('remote-unit', 'Remote')").run();
    await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES ('r-erin', 'erin', ?)")
      .bind(JSON.stringify(["AP.Approve"]))
      .run();
    await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES ('erin', 'r-erin', 'remote-unit')").run();

    const result = await handleRouteToApproverCandidates(env.DB, "t", asUser("alice"));
    expect(result.status).toBe(200);
    expect((result.body as { candidates: { id: string }[] }).candidates.map((c) => c.id)).toEqual(["erin"]);
  });
});
