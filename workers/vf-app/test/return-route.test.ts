import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleReturnToStage, handleReturnToSupplier, handleDiscard } from "../src/return-route.js";
import type { AuthenticatedUser } from "../src/user-auth.js";

const DAN: AuthenticatedUser = { id: "u-dan", email: "dan@acme.com", name: "Dan Y." };
const SARAH: AuthenticatedUser = { id: "u-sarah", email: "sarah@acme.com", name: "Sarah K." };
const MGR: AuthenticatedUser = { id: "u-mgr", email: "mgr@acme.com", name: "Mo R." };

async function grant(userId: string, permissions: string[]) {
  const roleId = `role-${userId}`;
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)")
    .bind(roleId, roleId, JSON.stringify(permissions))
    .run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES (?, ?)").bind(userId, roleId).run();
}

/** An instance that has been through Coding and is now at Approval. */
async function atApproval(): Promise<{ instanceId: string; taskId: string; visitId: string }> {
  await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('p-ap', 'AP')").run();
  for (const [id, name, seq] of [
    ["s-validation", "Validation", 1],
    ["s-coding", "Coding", 2],
    ["s-approval", "Approval", 3],
    ["s-review", "Review", 4],
  ]) {
    await env.DB.prepare("INSERT INTO process_stages (id, process_id, name, sequence) VALUES (?, 'p-ap', ?, ?)")
      .bind(id, name, seq)
      .run();
  }
  const instanceId = "inst-1";
  await env.DB.prepare(
    "INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES (?, 'p-ap', 'invoice', 'inv-1', 's-approval', 'in_progress')"
  )
    .bind(instanceId)
    .run();
  // Visited Validation and Coding already; now at Approval.
  for (const [vid, sid] of [
    ["v-validation", "s-validation"],
    ["v-coding", "s-coding"],
    ["v-approval", "s-approval"],
  ]) {
    await env.DB.prepare(
      "INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome) VALUES (?, ?, ?, 'matched')"
    )
      .bind(vid, instanceId, sid)
      .run();
  }
  const taskId = "task-1";
  await env.DB.prepare(
    "INSERT INTO tasks (id, stage_id, stage_visit_id, owner_user_id, required_permission) VALUES (?, 's-approval', 'v-approval', 'u-dan', 'AP.Approve')"
  )
    .bind(taskId)
    .run();
  return { instanceId, taskId, visitId: "v-approval" };
}

beforeEach(async () => {
  await applyTestSchema();
  for (const u of [DAN, SARAH, MGR]) {
    await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES (?, ?, ?)")
      .bind(u.id, u.email, u.name)
      .run();
  }
  await env.DB.prepare("INSERT INTO org_teams (id, name) VALUES ('team-coding', 'Coding')").run();
});

describe("returning to an earlier stage", () => {
  it("moves the instance back and creates one task for the named person", async () => {
    const { instanceId, taskId } = await atApproval();
    await grant("u-dan", ["AP.Approve", "AP.Return"]);

    const result = await handleReturnToStage(
      env.DB,
      taskId,
      { stageId: "s-coding", reason: "cost centre is wrong", assignToUser: "u-sarah" },
      DAN
    );
    expect(result.status).toBe(200);

    const instance = await env.DB.prepare("SELECT current_stage_id FROM process_instances WHERE id = ?")
      .bind(instanceId)
      .first<{ current_stage_id: string }>();
    expect(instance?.current_stage_id).toBe("s-coding");

    const tasks = await env.DB.prepare(
      "SELECT owner_user_id, status FROM tasks WHERE stage_id = 's-coding'"
    ).all<{ owner_user_id: string; status: string }>();
    expect(tasks.results).toHaveLength(1);
    expect(tasks.results[0].owner_user_id).toBe("u-sarah");
  });

  it("marks the returner's task 'returned', never 'completed'", async () => {
    // Recording completed_by for a return would put a lie in the audit
    // trail: the person did not do the work, they declined it.
    const { taskId } = await atApproval();
    await grant("u-dan", ["AP.Approve", "AP.Return"]);
    await handleReturnToStage(
      env.DB,
      taskId,
      { stageId: "s-coding", reason: "wrong code", assignToUser: "u-sarah" },
      DAN
    );

    const row = await env.DB.prepare(
      "SELECT status, completed_by, ended_by, end_reason, returned_to_stage_id FROM tasks WHERE id = ?"
    )
      .bind(taskId)
      .first<Record<string, string | null>>();
    expect(row?.status).toBe("returned");
    expect(row?.completed_by).toBeNull();
    expect(row?.ended_by).toBe("u-dan");
    expect(row?.end_reason).toBe("wrong code");
    expect(row?.returned_to_stage_id).toBe("s-coding");
  });

  it("cancels sibling tasks, which are moot rather than abandoned", async () => {
    // Parallel approvers: if one of three returns the invoice, the
    // other two cannot be completed against a document that has left.
    const { taskId } = await atApproval();
    await env.DB.prepare(
      "INSERT INTO tasks (id, stage_id, stage_visit_id, owner_user_id, required_permission) VALUES ('task-2', 's-approval', 'v-approval', 'u-sarah', 'AP.Approve')"
    ).run();
    await grant("u-dan", ["AP.Approve", "AP.Return"]);

    await handleReturnToStage(
      env.DB,
      taskId,
      { stageId: "s-coding", reason: "wrong code", assignToTeam: "team-coding" },
      DAN
    );

    const sibling = await env.DB.prepare("SELECT status, ended_by FROM tasks WHERE id = 'task-2'").first<{
      status: string;
      ended_by: string;
    }>();
    expect(sibling?.status).toBe("cancelled");
    expect(sibling?.ended_by).toBe("u-dan");
  });

  it("refuses a stage this document has never visited", async () => {
    // route_to lets a rule skip ahead; returning somewhere new is not a
    // return.
    const { taskId } = await atApproval();
    await grant("u-dan", ["AP.Approve", "AP.Return"]);
    const result = await handleReturnToStage(
      env.DB,
      taskId,
      { stageId: "s-review", reason: "x", assignToUser: "u-sarah" },
      DAN
    );
    expect(result.status).toBe(422);
    expect(String((result.body as { detail: string }).detail)).toContain("actually visited");
  });

  it("requires a reason", async () => {
    const { taskId } = await atApproval();
    await grant("u-dan", ["AP.Approve", "AP.Return"]);
    const result = await handleReturnToStage(
      env.DB,
      taskId,
      { stageId: "s-coding", reason: "   ", assignToUser: "u-sarah" },
      DAN
    );
    expect(result.status).toBe(400);
  });

  it("requires exactly one of assignToUser or assignToTeam", async () => {
    const { taskId } = await atApproval();
    await grant("u-dan", ["AP.Approve", "AP.Return"]);
    for (const body of [
      { stageId: "s-coding", reason: "x" },
      { stageId: "s-coding", reason: "x", assignToUser: "u-sarah", assignToTeam: "team-coding" },
    ]) {
      expect((await handleReturnToStage(env.DB, taskId, body, DAN)).status).toBe(400);
    }
  });
});

describe("who may return", () => {
  it("refuses somebody without AP.Return, however senior their stage permission", async () => {
    const { taskId } = await atApproval();
    await grant("u-dan", ["AP.Approve"]);
    const result = await handleReturnToStage(
      env.DB,
      taskId,
      { stageId: "s-coding", reason: "x", assignToUser: "u-sarah" },
      DAN
    );
    expect(result.status).toBe(403);
    expect(String((result.body as { error: string }).error)).toContain("AP.Return");
  });

  it("refuses AP.Return without standing at this stage", async () => {
    // AP.Return activates returning where you already have standing,
    // and nowhere else. This task demands AP.Approve.
    const { taskId } = await atApproval();
    await grant("u-dan", ["AP.Review", "AP.Return"]);
    const result = await handleReturnToStage(
      env.DB,
      taskId,
      { stageId: "s-coding", reason: "x", assignToUser: "u-sarah" },
      DAN
    );
    expect(result.status).toBe(403);
    expect(String((result.body as { error: string }).error)).toContain("AP.Approve");
  });

  it("refuses somebody who does not hold the task", async () => {
    const { taskId } = await atApproval();
    await grant("u-sarah", ["AP.Approve", "AP.Return"]);
    const result = await handleReturnToStage(
      env.DB,
      taskId,
      { stageId: "s-coding", reason: "x", assignToUser: "u-sarah" },
      SARAH
    );
    expect(result.status).toBe(403);
    expect(String((result.body as { error: string }).error)).toContain("AP.ReturnAny");
  });

  it("allows a manager with AP.ReturnAny to return a task they do not hold", async () => {
    const { taskId } = await atApproval();
    // Deliberately WITHOUT AP.Approve — overriding ownership across
    // stages is the point, and demanding the stage permission would
    // leave a manager unable to unstick an Approval queue.
    await grant("u-mgr", ["AP.Return", "AP.ReturnAny"]);

    const result = await handleReturnToStage(
      env.DB,
      taskId,
      { stageId: "s-coding", reason: "supplier disputes this", assignToUser: "u-sarah" },
      MGR
    );
    expect(result.status).toBe(200);
    expect((result.body as { viaOverride: boolean }).viaOverride).toBe(true);
  });

  it("records the manager as the returner, not the task's holder", async () => {
    // Otherwise Dan's queue changes without explanation and the trail
    // says Dan returned his own work.
    const { taskId } = await atApproval();
    await grant("u-mgr", ["AP.Return", "AP.ReturnAny"]);
    await handleReturnToStage(
      env.DB,
      taskId,
      { stageId: "s-coding", reason: "x", assignToUser: "u-sarah" },
      MGR
    );

    const row = await env.DB.prepare("SELECT ended_by FROM tasks WHERE id = ?").bind(taskId).first<{
      ended_by: string;
    }>();
    expect(row?.ended_by).toBe("u-mgr");
  });
});

describe("returning to the supplier", () => {
  it("ends the instance in returned_manually, recording who and why", async () => {
    const { instanceId, taskId } = await atApproval();
    await grant("u-dan", ["AP.Approve", "AP.ReturnToSupplier"]);

    const result = await handleReturnToSupplier(env.DB, taskId, { reason: "duplicate of INV-1001" }, DAN);
    expect(result.status).toBe(200);

    const instance = await env.DB.prepare(
      "SELECT status, ended_by, end_reason FROM process_instances WHERE id = ?"
    )
      .bind(instanceId)
      .first<Record<string, string>>();
    expect(instance?.status).toBe("returned_manually");
    expect(instance?.ended_by).toBe("u-dan");
    expect(instance?.end_reason).toBe("duplicate of INV-1001");
  });

  it("says plainly that nothing was sent", async () => {
    // A button claiming to email a supplier and sometimes unable to is
    // worse than an honest record.
    const { taskId } = await atApproval();
    await grant("u-dan", ["AP.Approve", "AP.ReturnToSupplier"]);
    const result = await handleReturnToSupplier(env.DB, taskId, { reason: "duplicate" }, DAN);
    expect(String((result.body as { note: string }).note)).toContain("sent nothing");
  });

  it("refuses a manager holding AP.ReturnAny but not AP.ReturnToSupplier", async () => {
    // ReturnAny overrides ownership, not destination. The terminal act
    // always requires somebody to hold the terminal permission.
    const { taskId } = await atApproval();
    await grant("u-mgr", ["AP.Return", "AP.ReturnAny"]);
    const result = await handleReturnToSupplier(env.DB, taskId, { reason: "duplicate" }, MGR);
    expect(result.status).toBe(403);
    expect(String((result.body as { error: string }).error)).toContain("AP.ReturnToSupplier");
  });
});

describe("a task can only be ended once", () => {
  it("refuses returning a task that is already returned", async () => {
    const { taskId } = await atApproval();
    await grant("u-dan", ["AP.Approve", "AP.Return"]);
    const body = { stageId: "s-coding", reason: "x", assignToUser: "u-sarah" };
    expect((await handleReturnToStage(env.DB, taskId, body, DAN)).status).toBe(200);
    expect((await handleReturnToStage(env.DB, taskId, body, DAN)).status).toBe(409);
  });
});

describe("discarding — the third outcome (decision 0078)", () => {
  it("archives the instance, which is not the same terminal state as returned", async () => {
    // "Nothing further is needed" and "somebody is dealing with this"
    // are different answers to the open-items question a queue exists
    // to ask (decision 0055 section 5.4).
    const { instanceId, taskId } = await atApproval();
    await grant("u-dan", ["AP.Approve", "AP.Discard"]);

    const result = await handleDiscard(env.DB, taskId, { reason: "not an invoice — a statement" }, DAN);
    expect(result.status).toBe(200);

    const instance = await env.DB.prepare(
      "SELECT status, ended_by, end_reason FROM process_instances WHERE id = ?"
    )
      .bind(instanceId)
      .first<Record<string, string>>();
    expect(instance?.status).toBe("archived");
    expect(instance?.ended_by).toBe("u-dan");
    expect(instance?.end_reason).toBe("not an invoice — a statement");
  });

  it("deletes nothing", async () => {
    // A regulated system that lets a person delete a document has lost
    // the argument before it starts.
    const { taskId } = await atApproval();
    await grant("u-dan", ["AP.Approve", "AP.Discard"]);
    await handleDiscard(env.DB, taskId, { reason: "duplicate" }, DAN);

    const instances = await env.DB.prepare("SELECT count(*) AS n FROM process_instances").first<{ n: number }>();
    const tasks = await env.DB.prepare("SELECT count(*) AS n FROM tasks").first<{ n: number }>();
    const visits = await env.DB.prepare("SELECT count(*) AS n FROM stage_visits").first<{ n: number }>();
    expect(instances?.n).toBe(1);
    expect(tasks?.n).toBe(1);
    expect(visits?.n).toBe(3);
  });

  it("requires AP.Discard specifically, not the ability to return", async () => {
    // Keying introduces facts; discarding closes the matter. Somebody
    // trusted to send an invoice back is not automatically somebody who
    // decides it never needs looking at again.
    const { taskId } = await atApproval();
    await grant("u-dan", ["AP.Approve", "AP.Return", "AP.ReturnToSupplier"]);
    const result = await handleDiscard(env.DB, taskId, { reason: "duplicate" }, DAN);
    expect(result.status).toBe(403);
    expect(String((result.body as { error: string }).error)).toContain("AP.Discard");
  });

  it("requires a reason, because nobody will look again", async () => {
    const { taskId } = await atApproval();
    await grant("u-dan", ["AP.Approve", "AP.Discard"]);
    expect((await handleDiscard(env.DB, taskId, { reason: "  " }, DAN)).status).toBe(400);
  });

  it("refuses a manager holding AP.ReturnAny but not AP.Discard", async () => {
    // ReturnAny overrides ownership, not destination — the same
    // boundary as returning to a supplier.
    const { taskId } = await atApproval();
    await grant("u-mgr", ["AP.Return", "AP.ReturnAny"]);
    const result = await handleDiscard(env.DB, taskId, { reason: "duplicate" }, MGR);
    expect(result.status).toBe(403);
  });

  it("marks the task 'discarded', not 'returned' — nothing went back", async () => {
    // The first version of this reused 'returned', and the test written
    // alongside it documented the wrong behaviour — worse than no test.
    // A task marked 'returned' when its document was archived tells
    // whoever reads it later that somebody sent the invoice somewhere,
    // and nobody did.
    const { taskId } = await atApproval();
    await grant("u-dan", ["AP.Approve", "AP.Discard"]);
    await handleDiscard(env.DB, taskId, { reason: "duplicate" }, DAN);

    const row = await env.DB.prepare("SELECT status, completed_by, ended_by FROM tasks WHERE id = ?")
      .bind(taskId)
      .first<Record<string, string | null>>();
    expect(row?.status).toBe("discarded");
    expect(row?.completed_by).toBeNull();
    expect(row?.ended_by).toBe("u-dan");
  });
});
