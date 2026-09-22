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
  await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('u1', 'Acme France')").run();
  await env.DB.prepare("INSERT INTO org_teams (id, name, unit_id) VALUES ('ap', 'AP Team', 'u1')").run();
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

  /**
   * Membership of the process's current version — decision 0160.
   *
   * `process-route.ts` does this when a stage is created through it.
   * These tests insert directly, so they do it themselves: **a stage in
   * no version is a stage the workflow engine steps straight past.**
   */
  await env.DB.prepare(
    `INSERT OR IGNORE INTO process_stage_versions (process_id, version, stage_id, sequence)
     SELECT p.id, p.version, s.id, s.sequence
     FROM process_stages s JOIN processes p ON p.id = s.process_id`
  ).run();

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

async function grant(userId: string, permissions: string[]) {
  const roleId = `role-${userId}`;
  await env.DB.prepare("INSERT OR IGNORE INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)")
    .bind(roleId, roleId, JSON.stringify(permissions))
    .run();
  await env.DB.prepare("INSERT OR IGNORE INTO org_user_roles (user_id, role_id) VALUES (?, ?)")
    .bind(userId, roleId)
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
  it("names the seller, not only its VAT identifier", async () => {
    // A person scanning a queue is looking for a company, not a tax
    // number -- and until decision 0112 the seller name was not read
    // from the document at all.
    await seedInstance("inv-1", "validation", "v-1");
    await env.DB.prepare(
      "UPDATE invoice_headers SET facts_json = ? WHERE id = ?"
    ).bind(JSON.stringify({ "BT-27": "Skelettbau Munch GmbH" }), "inv-1").run();
    await seedTask("t-1", "validation", "v-1", { user: "alice" });

    expect((await list("alice"))[0].subject?.supplierName).toBe("Skelettbau Munch GmbH");
  });

  it("falls back to the identifier when the document gave no name", async () => {
    await seedInstance("inv-1", "validation", "v-1");
    await seedTask("t-1", "validation", "v-1", { user: "alice" });
    const subject = (await list("alice"))[0].subject;
    expect(subject?.supplierName).toBeNull();
    expect(subject?.supplierVatId).toBe("DE813799533");
  });

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


describe("what a person may do with a task (decision 0103)", () => {
  /**
   * Reported by the server rather than inferred by the interface. A
   * client that re-derived these would drift -- a permission changes
   * and a button lingers, or vanishes while the action still works.
   *
   * This is presentation, not security: a client can still call
   * anything, and enforcement stays in the routes.
   */
  it("offers nothing on a task a colleague holds", async () => {
    await grant("sarah", ["AP.Validate", "AP.Return", "AP.Discard"]);
    await seedInstance("inv-1", "validation", "v-1");
    await seedTask("t-1", "validation", "v-1", { team: "ap" }, "alice");

    expect((await list("sarah"))[0].actions).toEqual([]);
  });

  it("offers only claiming on an unclaimed team task", async () => {
    // The one thing a person can do with a task they have not taken.
    await grant("alice", ["AP.Validate", "AP.Return", "AP.Discard"]);
    await seedInstance("inv-1", "validation", "v-1");
    await seedTask("t-1", "validation", "v-1", { team: "ap" });

    expect((await list("alice"))[0].actions).toEqual(["claim"]);
  });

  it("offers nothing to claim without the stage's own permission", async () => {
    await grant("alice", ["AP.Approve"]);
    await seedInstance("inv-1", "validation", "v-1");
    await seedTask("t-1", "validation", "v-1", { team: "ap" });

    expect((await list("alice"))[0].actions).toEqual([]);
  });

  it("offers keying, returning and discarding on their own task", async () => {
    await grant("alice", ["AP.Validate", "AP.Return", "AP.Discard"]);
    await seedInstance("inv-1", "validation", "v-1");
    await seedTask("t-1", "validation", "v-1", { user: "alice" });

    const actions = (await list("alice"))[0].actions;
    expect(actions).toContain("key");
    expect(actions).toContain("return");
    expect(actions).toContain("discard");
  });

  it("omits an action whose permission the person lacks", async () => {
    // The button that would have failed on click.
    await grant("alice", ["AP.Validate"]);
    await seedInstance("inv-1", "validation", "v-1");
    await seedTask("t-1", "validation", "v-1", { user: "alice" });

    const actions = (await list("alice"))[0].actions;
    expect(actions).toContain("key");
    expect(actions).not.toContain("return");
    expect(actions).not.toContain("discard");
  });

  it("offers nothing on a task demanding a permission they lack", async () => {
    // Assigned to them, and requiring something they do not hold —
    // which the routes would refuse.
    await grant("alice", ["AP.Approve"]);
    await seedInstance("inv-1", "validation", "v-1");
    await seedTask("t-1", "validation", "v-1", { user: "alice" });

    expect((await list("alice"))[0].actions).toEqual([]);
  });

  it("survives a role with unparseable permissions", async () => {
    // One bad row must not empty somebody's queue.
    await grant("alice", ["AP.Validate"]);
    await env.DB.prepare(
      "INSERT INTO org_roles (id, name, permissions_json) VALUES ('broken', 'Broken', 'not json')"
    ).run();
    await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES ('alice', 'broken')").run();
    await seedInstance("inv-1", "validation", "v-1");
    await seedTask("t-1", "validation", "v-1", { user: "alice" });

    expect((await list("alice"))[0].actions).toContain("key");
  });
});

describe("filtering, because a real queue is not thirty rows", () => {
  async function seedAcross() {
    await grant("alice", ["AP.Validate", "AP.Approve"]);
    await seedInstance("inv-1", "validation", "v-1");
    await seedInstance("inv-2", "approval", "v-2");
    await seedInstance("inv-3", "approval", "v-3");
    await seedTask("t-val", "validation", "v-1", { user: "alice" });
    await seedTask("t-app", "approval", "v-2", { team: "ap" });
    await seedTask("t-locked", "approval", "v-3", { team: "ap" }, "sarah");
  }

  it("returns every stage by default", async () => {
    await seedAcross();
    expect(await list("alice")).toHaveLength(3);
  });

  it("narrows to one stage", async () => {
    await seedAcross();
    const result = await handleListMyTasks(env.DB, "alice", { stageId: "approval" });
    const tasks = (result.body as { tasks: TaskRow[] }).tasks;
    expect(tasks).toHaveLength(2);
    expect(tasks.every((t) => t.stageId === "approval")).toBe(true);
  });

  it("narrows to one ownership kind", async () => {
    await seedAcross();
    const result = await handleListMyTasks(env.DB, "alice", { ownership: "mine" });
    const tasks = (result.body as { tasks: TaskRow[] }).tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe("t-val");
  });

  it("combines both", async () => {
    await seedAcross();
    const result = await handleListMyTasks(env.DB, "alice", {
      stageId: "approval",
      ownership: "locked",
    });
    expect((result.body as { tasks: TaskRow[] }).tasks).toHaveLength(1);
  });

  it("keeps the counts about the person's work, not the page", async () => {
    // A count that changed as somebody paged would be telling them
    // about the page rather than about their queue.
    //
    // **Paged past the "mine" task deliberately.** An earlier version
    // of this test filtered by ownership instead, and passed even when
    // the counts were computed over the page — because the page
    // happened to contain the one task being counted. The fail-watch
    // showing nothing is what exposed it.
    await seedAcross();
    const result = await handleListMyTasks(env.DB, "alice", { limit: 1, offset: 2 });
    const body = result.body as { tasks: TaskRow[]; counts: Record<string, number> };

    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].ownership).not.toBe("mine");
    expect(body.counts).toEqual({ mine: 1, available: 1, locked: 1 });
  });

  it("counts within the filter, because the question has changed", async () => {
    // The other half of the rule above. A Validation view reporting 39
    // available would be answering about a queue the person is not
    // looking at.
    await seedAcross();
    const result = await handleListMyTasks(env.DB, "alice", { stageId: "validation" });
    expect((result.body as { counts: Record<string, number> }).counts).toEqual({
      mine: 1,
      available: 0,
      locked: 0,
    });
  });

  it("pages, and reports the total behind the page", async () => {
    await seedAcross();
    const result = await handleListMyTasks(env.DB, "alice", { limit: 2 });
    const body = result.body as { tasks: TaskRow[]; total: number; limit: number };
    expect(body.tasks).toHaveLength(2);
    expect(body.total).toBe(3);
    expect(body.limit).toBe(2);
  });

  it("caps the limit, because an unbounded list works for one customer and not the next", async () => {
    await seedAcross();
    const result = await handleListMyTasks(env.DB, "alice", { limit: 100000 });
    expect((result.body as { limit: number }).limit).toBe(200);
  });

  it("offsets into the list", async () => {
    await seedAcross();
    const first = await handleListMyTasks(env.DB, "alice", { limit: 1 });
    const second = await handleListMyTasks(env.DB, "alice", { limit: 1, offset: 1 });
    const firstId = (first.body as { tasks: TaskRow[] }).tasks[0].id;
    const secondId = (second.body as { tasks: TaskRow[] }).tasks[0].id;
    expect(firstId).not.toBe(secondId);
  });
});

describe("releasing appears where it applies (decision 0104)", () => {
  it("offers release on a task this person claimed", async () => {
    await grant("alice", ["AP.Validate"]);
    await seedInstance("inv-1", "validation", "v-1");
    await seedTask("t-1", "validation", "v-1", { team: "ap" }, "alice");

    expect((await list("alice"))[0].actions).toContain("release");
  });

  it("does not offer release on a task assigned to them directly", async () => {
    // There is no claim to release. It is theirs by assignment, and
    // putting it back would mean returning it to nobody.
    await grant("alice", ["AP.Validate"]);
    await seedInstance("inv-1", "validation", "v-1");
    await seedTask("t-1", "validation", "v-1", { user: "alice" });

    expect((await list("alice"))[0].actions).not.toContain("release");
  });

  it("offers a manager release on a colleague's locked task, and nothing else", async () => {
    // The recovery path for a lock that never expires -- and the only
    // thing anybody may do to somebody else's work.
    await grant("sarah", ["AP.Validate", "AP.TaskManage"]);
    await seedInstance("inv-1", "validation", "v-1");
    await seedTask("t-1", "validation", "v-1", { team: "ap" }, "alice");

    expect((await list("sarah"))[0].actions).toEqual(["release"]);
  });

  it("offers a colleague without AP.TaskManage nothing at all", async () => {
    await grant("sarah", ["AP.Validate"]);
    await seedInstance("inv-1", "validation", "v-1");
    await seedTask("t-1", "validation", "v-1", { team: "ap" }, "alice");

    expect((await list("sarah"))[0].actions).toEqual([]);
  });
});

describe("who a task belongs to (decision 0180)", () => {
  /**
   * **`lockedBy` appears only once somebody claims a task.** A task
   * assigned to a person and not yet claimed had no `lockedBy`, and the
   * viewer read that as nobody — reporting *"Owner: Nobody yet"* about
   * a task sitting in its owner's own queue.
   *
   * Assignment and claiming are different facts: decision 0104 records
   * that a claim **is** a lock.
   */
  it("names the person a task is assigned to", async () => {
    await seedInstance("inv-1", "validation", "v-1");
    await seedTask("t-own", "validation", "v-1", { user: "alice" });
    const tasks = await list("alice");

    expect(tasks[0].ownedBy?.name).toBe("Alice");
  });

  it("names the team where a team owns it", async () => {
    // *"The AP team"* tells somebody whether it is theirs to take.
    await seedInstance("inv-1", "validation", "v-1");
    await seedTask("t-team", "validation", "v-1", { team: "ap" });
    const tasks = await list("alice");

    expect(tasks[0].ownedBy?.name).toBe("ap");
    expect(tasks[0].ownedBy?.email).toBeNull();
  });

  it("names whoever claimed it, not the team it came from", async () => {
    /**
     * **Claiming is how a team task becomes somebody's.**
     *
     * The first version of this reported the team for a task somebody
     * had claimed, which is the opposite of useful — the claim is
     * precisely the news.
     *
     * `ownershipOf` has always agreed: it returns `"mine"` for either
     * an assignment or a claim.
     */
    await seedInstance("inv-1", "validation", "v-1");
    await seedTask("t-both", "validation", "v-1", { team: "ap" }, "alice");
    const tasks = await list("alice");

    expect(tasks[0].ownedBy?.name).toBe("Alice");
    expect(tasks[0].ownership).toBe("mine");
  });

  it("names the team while nobody has taken it", async () => {
    // Which is what tells somebody whether it is theirs to take.
    await seedInstance("inv-1", "validation", "v-1");
    await seedTask("t-waiting", "validation", "v-1", { team: "ap" });
    const tasks = await list("alice");

    expect(tasks[0].ownedBy?.name).toBe("ap");
  });
});

describe("a task about one line (decision 0183)", () => {
  /**
   * **A stage scoped `per_line`** (decision 0027) evaluates its rules
   * once per invoice line, so an eight-line invoice raises eight tasks.
   * `assign_task` has carried the line number since, and the list never
   * reported it.
   *
   * Eight identical rows — same invoice, same supplier, same amount,
   * same stage — **teach somebody the list is broken.**
   */
  it("says which line it is about", async () => {
    await seedInstance("inv-1", "validation", "v-1");
    await seedTask("t-line", "validation", "v-1", { user: "alice" });
    await env.DB.prepare("UPDATE tasks SET line_number = 3 WHERE id = 't-line'").run();

    const tasks = await list("alice");
    expect(tasks[0].lineNumber).toBe(3);
  });

  it("says nothing where a task is about the whole document", async () => {
    // Which is most of them, and `null` means exactly that.
    await seedInstance("inv-1", "validation", "v-1");
    await seedTask("t-header", "validation", "v-1", { user: "alice" });

    const tasks = await list("alice");
    expect(tasks[0].lineNumber).toBeNull();
  });

  it("distinguishes two tasks on the same invoice", async () => {
    // **The whole point**: without the line they are the same row
    // twice.
    await seedInstance("inv-1", "validation", "v-1");
    await seedTask("t-l1", "validation", "v-1", { user: "alice" });
    await seedTask("t-l2", "validation", "v-1", { user: "alice" });
    await env.DB.prepare("UPDATE tasks SET line_number = 1 WHERE id = 't-l1'").run();
    await env.DB.prepare("UPDATE tasks SET line_number = 2 WHERE id = 't-l2'").run();

    const lines = (await list("alice")).map((t) => t.lineNumber).sort();
    expect(lines).toEqual([1, 2]);
  });
});

/**
 * Sets the invoice's facts and/or amount after `seedInstance()` has
 * already created it — mirrors `documents.test.ts`'s own pattern of
 * updating `invoice_headers` directly rather than growing `seedInstance`
 * a parameter for every field a search test happens to need.
 */
async function setInvoiceFacts(invoiceId: string, facts: Record<string, unknown>) {
  await env.DB.prepare("UPDATE invoice_headers SET facts_json = ? WHERE id = ?")
    .bind(JSON.stringify(facts), invoiceId)
    .run();
}

async function setInvoiceAmount(invoiceId: string, amount: number) {
  await env.DB.prepare("UPDATE invoice_headers SET total_with_vat = ? WHERE id = ?")
    .bind(amount, invoiceId)
    .run();
}

describe("searching — real SQL, decision 0449", () => {
  /**
   * **The same three fields the row itself shows** — stage name,
   * supplier (the BT-27 fact `sellerNameOf()` already reads), and
   * amount. Invoice number is deliberately not one of them: this
   * screen has never selected or displayed it, unlike Documents.
   */
  it("finds by stage name", async () => {
    await grant("alice", ["AP.Validate", "AP.Approve"]);
    await seedInstance("inv-1", "validation", "v-1");
    await seedInstance("inv-2", "approval", "v-2");
    await seedTask("t-1", "validation", "v-1", { user: "alice" });
    await seedTask("t-2", "approval", "v-2", { user: "alice" });

    const result = await handleListMyTasks(env.DB, "alice", { search: "valid" });
    expect((result.body as { tasks: TaskRow[] }).tasks.map((t) => t.id)).toEqual(["t-1"]);
  });

  it("finds by supplier name", async () => {
    await seedInstance("inv-1", "validation", "v-1");
    await seedInstance("inv-2", "validation", "v-2");
    await seedTask("t-1", "validation", "v-1", { user: "alice" });
    await seedTask("t-2", "validation", "v-2", { user: "alice" });
    await setInvoiceFacts("inv-1", { "BT-27": "Nordwind Logistik" });
    await setInvoiceFacts("inv-2", { "BT-27": "Munch GmbH" });

    const result = await handleListMyTasks(env.DB, "alice", { search: "nordwind" });
    expect((result.body as { tasks: TaskRow[] }).tasks.map((t) => t.id)).toEqual(["t-1"]);
  });

  it("finds by amount", async () => {
    await seedInstance("inv-1", "validation", "v-1");
    await seedInstance("inv-2", "validation", "v-2");
    await seedTask("t-1", "validation", "v-1", { user: "alice" });
    await seedTask("t-2", "validation", "v-2", { user: "alice" });
    await setInvoiceAmount("inv-1", 251.88);
    await setInvoiceAmount("inv-2", 900);

    const result = await handleListMyTasks(env.DB, "alice", { search: "251.88" });
    expect((result.body as { tasks: TaskRow[] }).tasks.map((t) => t.id)).toEqual(["t-1"]);
  });

  it("ignores case", async () => {
    await seedInstance("inv-1", "validation", "v-1");
    await seedTask("t-1", "validation", "v-1", { user: "alice" });
    await setInvoiceFacts("inv-1", { "BT-27": "Nordwind Logistik" });

    const result = await handleListMyTasks(env.DB, "alice", { search: "NORDWIND" });
    expect((result.body as { tasks: TaskRow[] }).tasks).toHaveLength(1);
  });

  it("escapes a literal % or _ in the term rather than treating it as a SQL wildcard", async () => {
    await seedInstance("inv-1", "validation", "v-1");
    await seedInstance("inv-2", "validation", "v-2");
    await seedTask("t-1", "validation", "v-1", { user: "alice" });
    await seedTask("t-2", "validation", "v-2", { user: "alice" });
    await setInvoiceFacts("inv-1", { "BT-27": "INV_100%" });
    await setInvoiceFacts("inv-2", { "BT-27": "INVX100Y" });

    // An unescaped LIKE pattern (`%_100%%`) would also match "INVX100Y",
    // since `_` and `%` are themselves SQL wildcards there.
    const result = await handleListMyTasks(env.DB, "alice", { search: "_100%" });
    expect((result.body as { tasks: TaskRow[] }).tasks.map((t) => t.id)).toEqual(["t-1"]);
  });

  it("returns nothing rather than everything when nothing matches", async () => {
    await seedInstance("inv-1", "validation", "v-1");
    await seedTask("t-1", "validation", "v-1", { user: "alice" });
    await setInvoiceFacts("inv-1", { "BT-27": "Nordwind Logistik" });

    const result = await handleListMyTasks(env.DB, "alice", { search: "zzzz" });
    expect((result.body as { tasks: TaskRow[] }).tasks).toHaveLength(0);
  });

  it("total narrows with a search term, same as the page itself", async () => {
    await seedInstance("inv-1", "validation", "v-1");
    await seedInstance("inv-2", "validation", "v-2");
    await seedTask("t-1", "validation", "v-1", { user: "alice" });
    await seedTask("t-2", "validation", "v-2", { user: "alice" });
    await setInvoiceFacts("inv-1", { "BT-27": "Nordwind Logistik" });
    await setInvoiceFacts("inv-2", { "BT-27": "Munch GmbH" });

    const result = await handleListMyTasks(env.DB, "alice", {
      search: "nordwind",
      page: 1,
      pageSize: 25,
    });
    const body = result.body as { tasks: TaskRow[]; total: number };
    expect(body.tasks).toHaveLength(1);
    expect(body.total).toBe(1);
  });
});

describe("real, server-side pagination — decision 0449", () => {
  async function seedMany(n: number) {
    for (let i = 0; i < n; i++) {
      const id = `inv-${i}`;
      await seedInstance(id, "validation", `v-${i}`);
      await seedTask(`t-${i}`, "validation", `v-${i}`, { user: "alice" });
    }
  }

  it("total/page/pageSize are always present — unlike Documents, counts were never gated on asking for a page", async () => {
    await seedInstance("inv-1", "validation", "v-1");
    await seedTask("t-1", "validation", "v-1", { user: "alice" });

    const result = await handleListMyTasks(env.DB, "alice");
    const body = result.body as { total: number; page: number; pageSize: number };
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(50);
  });

  it("total reflects every matching row, not just the page returned", async () => {
    await seedMany(60);
    const result = await handleListMyTasks(env.DB, "alice", { page: 1, pageSize: 25 });
    const body = result.body as { tasks: TaskRow[]; total: number; page: number; pageSize: number };
    expect(body.tasks).toHaveLength(25);
    expect(body.total).toBe(60);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(25);
  });

  it("page 2 returns a disjoint set from page 1", async () => {
    await seedMany(60);
    const page1 = (
      (await handleListMyTasks(env.DB, "alice", { page: 1, pageSize: 25 })).body as { tasks: TaskRow[] }
    ).tasks.map((t) => t.id);
    const page2 = (
      (await handleListMyTasks(env.DB, "alice", { page: 2, pageSize: 25 })).body as { tasks: TaskRow[] }
    ).tasks.map((t) => t.id);
    expect(page1).toHaveLength(25);
    expect(page2).toHaveLength(25);
    expect(page1.some((id) => page2.includes(id))).toBe(false);
  });

  it("a real, partial last page", async () => {
    await seedMany(60);
    const result = await handleListMyTasks(env.DB, "alice", { page: 3, pageSize: 25 });
    const body = result.body as { tasks: TaskRow[]; total: number };
    expect(body.tasks).toHaveLength(10);
    expect(body.total).toBe(60);
  });

  it("normalizes a bad page number back to 1", async () => {
    await seedMany(5);
    const result = await handleListMyTasks(env.DB, "alice", { page: NaN, pageSize: 25 });
    expect((result.body as { page: number }).page).toBe(1);
  });

  it("normalizes an unlisted page size back to the default", async () => {
    await seedMany(5);
    const result = await handleListMyTasks(env.DB, "alice", { page: 1, pageSize: 17 });
    expect((result.body as { pageSize: number }).pageSize).toBe(50);
  });

  it("every allowed page size is honoured", async () => {
    await seedMany(60);
    for (const size of [25, 50, 100, 200]) {
      const result = await handleListMyTasks(env.DB, "alice", { page: 1, pageSize: size });
      const body = result.body as { pageSize: number; tasks: TaskRow[] };
      expect(body.pageSize).toBe(size);
      expect(body.tasks.length).toBeLessThanOrEqual(size);
    }
  });

  it("page/pageSize win over legacy limit/offset when both are given", async () => {
    await seedMany(60);
    const result = await handleListMyTasks(env.DB, "alice", {
      limit: 5,
      offset: 0,
      page: 2,
      pageSize: 25,
    });
    const body = result.body as { tasks: TaskRow[]; page: number; pageSize: number };
    expect(body.tasks).toHaveLength(25);
    expect(body.page).toBe(2);
    expect(body.pageSize).toBe(25);
  });

  it("derives page/pageSize from limit/offset for a caller still using the legacy shape", async () => {
    // `dashboard-route.ts`'s own two internal callers use `limit: 1000`
    // and no page controls of their own — this is what they get back.
    await seedMany(5);
    const result = await handleListMyTasks(env.DB, "alice", { limit: 2, offset: 2 });
    const body = result.body as { page: number; pageSize: number };
    expect(body.page).toBe(2);
    expect(body.pageSize).toBe(2);
  });

  it("total is computed under the ownership filter, in SQL, not by loading everything first", async () => {
    // The genuine improvement over the old code: `total` for a
    // "mine"-only page used to be `filtered.length` after an in-Worker
    // `.filter()` over the whole visible set. Here it is a `count(*)`
    // that already applied `ownershipClause`.
    await grant("alice", ["AP.Validate"]);
    await seedInstance("inv-1", "validation", "v-1");
    await seedInstance("inv-2", "validation", "v-2");
    await seedInstance("inv-3", "validation", "v-3");
    await seedTask("t-1", "validation", "v-1", { user: "alice" });
    await seedTask("t-2", "validation", "v-2", { team: "ap" });
    await seedTask("t-3", "validation", "v-3", { team: "ap" }, "sarah");

    const result = await handleListMyTasks(env.DB, "alice", {
      ownership: "available",
      page: 1,
      pageSize: 25,
    });
    const body = result.body as { tasks: TaskRow[]; total: number; counts: Record<string, number> };
    expect(body.total).toBe(1);
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].id).toBe("t-2");
    // Counts describe every kind, unaffected by the ownership filter.
    expect(body.counts).toEqual({ mine: 1, available: 1, locked: 1 });
  });
});
