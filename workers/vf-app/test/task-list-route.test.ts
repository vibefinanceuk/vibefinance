import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleListMyTasks, type TaskRow } from "../src/task-list-route.js";

/** Alice and Sarah are both in the AP team; Mo is not. */
async function seedPeople() {
  for (const [id, name] of [["alice", "Alice"], ["sarah", "Sarah K."], ["mo", "Mo R."]]) {
    await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES (?, ?, ?)")
      .bind(id, `${id}@acme.com`, name)
      .run();
  }
  await env.DB.prepare("INSERT INTO org_teams (id, name) VALUES ('ap', 'AP Team')").run();
  for (const user of ["alice", "sarah"]) {
    await env.DB.prepare("INSERT INTO org_team_members (team_id, user_id) VALUES ('ap', ?)")
      .bind(user)
      .run();
  }
}

async function seedProcess() {
  await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('ap-live', 'AP')").run();
  for (const [id, name, seq] of [["validation", "Validation", 1], ["approval", "Approval", 2]]) {
    await env.DB.prepare(
      "INSERT INTO process_stages (id, process_id, name, sequence) VALUES (?, 'ap-live', ?, ?)"
    )
      .bind(id, name, seq)
      .run();
  }
}

/** An instance with an invoice behind it, and a visit to hang tasks on. */
async function seedInstance(invoiceId: string, stageId: string, visitId: string) {
  await env.DB.prepare(
    "INSERT INTO invoice_headers (id, supplier_vat_id, currency, issue_date, total_with_vat, facts_json) VALUES (?, 'DE813799533', 'EUR', '2026-08-21', 3137.47, '{}')"
  )
    .bind(invoiceId)
    .run();
  await env.DB.prepare(
    "INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES (?, 'ap-live', 'invoice', ?, ?, 'in_progress')"
  )
    .bind(`inst-${invoiceId}`, invoiceId, stageId)
    .run();
  await env.DB.prepare(
    "INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome) VALUES (?, ?, ?, 'matched')"
  )
    .bind(visitId, `inst-${invoiceId}`, stageId)
    .run();
}

async function seedTask(
  id: string,
  stageId: string,
  visitId: string,
  owner: { user?: string; team?: string },
  claimedBy?: string
) {
  await env.DB.prepare(
    "INSERT INTO tasks (id, stage_id, stage_visit_id, owner_user_id, owner_team_id, required_permission, claimed_by, claimed_at) VALUES (?, ?, ?, ?, ?, 'AP.Validate', ?, ?)"
  )
    .bind(id, stageId, visitId, owner.user ?? null, owner.team ?? null, claimedBy ?? null, claimedBy ? "2026-09-01 09:00:00" : null)
    .run();
}

async function list(userId: string): Promise<TaskRow[]> {
  const result = await handleListMyTasks(env.DB, userId);
  return (result.body as { tasks: TaskRow[] }).tasks;
}

beforeEach(async () => {
  await applyTestSchema();
  await seedPeople();
  await seedProcess();
});

describe("what a person sees", () => {
  it("shows a task assigned to them directly", async () => {
    await seedInstance("inv-1", "validation", "v-1");
    await seedTask("t-1", "validation", "v-1", { user: "alice" });

    const tasks = await list("alice");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].ownership).toBe("mine");
  });

  it("shows an unclaimed task belonging to their team", async () => {
    await seedInstance("inv-1", "validation", "v-1");
    await seedTask("t-1", "validation", "v-1", { team: "ap" });

    expect((await list("alice"))[0].ownership).toBe("available");
  });

  it("shows nothing to somebody outside the team", async () => {
    await seedInstance("inv-1", "validation", "v-1");
    await seedTask("t-1", "validation", "v-1", { team: "ap" });

    expect(await list("mo")).toHaveLength(0);
  });

  it("does not show another person's directly assigned task", async () => {
    await seedInstance("inv-1", "validation", "v-1");
    await seedTask("t-1", "validation", "v-1", { user: "sarah" });

    expect(await list("alice")).toHaveLength(0);
  });
});

describe("the ownership column", () => {
  it("reads 'mine' for a team task this person claimed", async () => {
    await seedInstance("inv-1", "validation", "v-1");
    await seedTask("t-1", "validation", "v-1", { team: "ap" }, "alice");

    expect((await list("alice"))[0].ownership).toBe("mine");
  });

  it("reads 'locked' for the same task, to a colleague", async () => {
    // The difference between my work and work I could take, which is
    // the difference between a to-do list and a pool.
    await seedInstance("inv-1", "validation", "v-1");
    await seedTask("t-1", "validation", "v-1", { team: "ap" }, "alice");

    expect((await list("sarah"))[0].ownership).toBe("locked");
  });

  it("names who holds a locked task and since when", async () => {
    // "Locked" alone cannot distinguish five minutes ago from since
    // Tuesday, and those mean very different things to somebody
    // deciding whether to ask.
    await seedInstance("inv-1", "validation", "v-1");
    await seedTask("t-1", "validation", "v-1", { team: "ap" }, "alice");

    const locked = (await list("sarah"))[0];
    expect(locked.lockedBy?.name).toBe("Alice");
    expect(locked.lockedBy?.since).toBe("2026-09-01 09:00:00");
  });

  it("says nothing about a holder when there is none", async () => {
    await seedInstance("inv-1", "validation", "v-1");
    await seedTask("t-1", "validation", "v-1", { team: "ap" });

    expect((await list("alice"))[0].lockedBy).toBeUndefined();
  });

  it("counts each kind", async () => {
    await seedInstance("inv-1", "validation", "v-1");
    await seedInstance("inv-2", "validation", "v-2");
    await seedInstance("inv-3", "validation", "v-3");
    await seedTask("t-1", "validation", "v-1", { user: "alice" });
    await seedTask("t-2", "validation", "v-2", { team: "ap" });
    await seedTask("t-3", "validation", "v-3", { team: "ap" }, "sarah");

    const result = await handleListMyTasks(env.DB, "alice");
    expect((result.body as { counts: Record<string, number> }).counts).toEqual({
      mine: 1,
      available: 1,
      locked: 1,
    });
  });
});

describe("one list across every stage", () => {
  it("shows tasks at different stages together", async () => {
    // A person may hold work at Validation and Approval at once, and a
    // queue that made them choose a stage first would ask them to know
    // what they are trying to find out.
    await seedInstance("inv-1", "validation", "v-1");
    await seedInstance("inv-2", "approval", "v-2");
    await seedTask("t-1", "validation", "v-1", { user: "alice" });
    await seedTask("t-2", "approval", "v-2", { user: "alice" });

    const stages = (await list("alice")).map((t) => t.stageId).sort();
    expect(stages).toEqual(["approval", "validation"]);
  });

  it("carries the stage name, so the interface can choose a screen", async () => {
    await seedInstance("inv-1", "validation", "v-1");
    await seedTask("t-1", "validation", "v-1", { user: "alice" });

    expect((await list("alice"))[0].stageName).toBe("Validation");
  });
});

describe("the subject", () => {
  it("carries the invoice, so a row means something to a person", async () => {
    // A task id is useless. A row needs the supplier and the amount.
    await seedInstance("inv-1", "validation", "v-1");
    await seedTask("t-1", "validation", "v-1", { user: "alice" });

    const subject = (await list("alice"))[0].subject;
    expect(subject?.type).toBe("invoice");
    expect(subject?.supplierVatId).toBe("DE813799533");
    expect(subject?.totalWithVat).toBe(3137.47);
  });

  it("is absent when the subject is not an invoice", async () => {
    // The engine is deliberately generic — it knows a subject has an
    // id, not what an invoice is. Stated by the shape rather than
    // pretended away.
    await env.DB.prepare(
      "INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES ('inst-x', 'ap-live', 'expense', 'exp-1', 'validation', 'in_progress')"
    ).run();
    await env.DB.prepare(
      "INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome) VALUES ('v-x', 'inst-x', 'validation', 'matched')"
    ).run();
    await seedTask("t-x", "validation", "v-x", { user: "alice" });

    const task = (await list("alice"))[0];
    expect(task.subject?.type).toBe("expense");
    expect(task.subject?.supplierVatId).toBeNull();
  });
});

describe("ordering and what is left out", () => {
  it("puts the oldest first, because age costs money", async () => {
    await seedInstance("inv-1", "validation", "v-1");
    await seedInstance("inv-2", "validation", "v-2");
    await seedTask("t-new", "validation", "v-1", { user: "alice" });
    await seedTask("t-old", "validation", "v-2", { user: "alice" });
    await env.DB.prepare("UPDATE tasks SET created_at = '2026-01-01 09:00:00' WHERE id = 't-old'").run();

    expect((await list("alice")).map((t) => t.id)).toEqual(["t-old", "t-new"]);
  });

  it("omits completed tasks — a queue is work, not history", async () => {
    await seedInstance("inv-1", "validation", "v-1");
    await seedTask("t-1", "validation", "v-1", { user: "alice" });
    await env.DB.prepare(
      "UPDATE tasks SET status = 'completed', completed_by = 'alice' WHERE id = 't-1'"
    ).run();

    expect(await list("alice")).toHaveLength(0);
  });

  it("omits a returned task, which is nobody's work now", async () => {
    await seedInstance("inv-1", "validation", "v-1");
    await seedTask("t-1", "validation", "v-1", { user: "alice" });
    await env.DB.prepare(
      "UPDATE tasks SET status = 'returned', ended_by = 'alice', end_reason = 'wrong code' WHERE id = 't-1'"
    ).run();

    expect(await list("alice")).toHaveLength(0);
  });
});
