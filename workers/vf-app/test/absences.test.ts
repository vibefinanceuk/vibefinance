import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { absenceStatus, handleAmendAbsence, handleCancelAbsence, handleCreateAbsence, handleListAbsences, processAbsences } from "../src/absence.js";

/**
 * Absence and cover — decision 0641. The AP team is Uma, Ben and Cara,
 * with Maya their AP Manager; Pat is in another team. Ben may approve up
 * to 1,000 GBP and does not hold AP.Review. Today is Monday 5 October.
 */

const MONDAY = new Date("2026-10-05T09:00:00Z");
const THURSDAY = new Date("2026-10-08T09:00:00Z");

async function person(id: string, permissions: string[], manager: string | null = null) {
  await env.DB.prepare("INSERT INTO org_users (id, email, name, manager_id) VALUES (?, ?, ?, ?)").bind(id, `${id}@acme.com`, id[0].toUpperCase() + id.slice(1), manager).run();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)").bind(`r-${id}`, id, JSON.stringify(permissions)).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES (?, ?, NULL)").bind(id, `r-${id}`).run();
}

async function invoiceTask(id: string, total: number, task: { claimedBy?: string; ownerUser?: string; permission: string; status?: string }) {
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, org_unit_id, invoice_number, currency, total_with_vat) VALUES (?, '{}', 'acme-uk', ?, 'GBP', ?)").bind(id, id.toUpperCase(), total).run();
  await env.DB.prepare("INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES (?, 'ap', 'invoice', ?, 'approval', 'in_progress')").bind(`pi-${id}`, id).run();
  await env.DB.prepare("INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome) VALUES (?, ?, 'approval', 'matched')").bind(`sv-${id}`, `pi-${id}`).run();
  await env.DB.prepare("INSERT INTO tasks (id, stage_id, stage_visit_id, owner_team_id, owner_user_id, claimed_by, required_permission, status) VALUES (?, 'approval', ?, ?, ?, ?, ?, ?)")
    .bind(`t-${id}`, `sv-${id}`, task.ownerUser ? null : "ap-team", task.ownerUser ?? null, task.claimedBy ?? null, task.permission, task.status ?? "open")
    .run();
}

const holder = async (id: string) =>
  env.DB.prepare("SELECT claimed_by, owner_user_id FROM tasks WHERE id = ?").bind(id).first<{ claimed_by: string | null; owner_user_id: string | null }>();

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_units (id, name, kind) VALUES ('acme-uk', 'Acme UK Ltd', 'legal_entity')").run();
  await person("maya", ["AP.Manager", "AP.TaskView", "AP.TaskManage"]);
  await person("uma", ["AP.TaskView", "AP.Code", "AP.Approve", "AP.Review"], "maya");
  await person("ben", ["AP.TaskView", "AP.Code", "AP.Approve"], "maya");
  await person("cara", ["AP.TaskView", "AP.Code", "AP.Approve", "AP.Review"], "maya");
  await person("pat", ["AP.TaskView", "AP.Code"]);
  await env.DB.prepare("INSERT INTO org_teams (id, name, unit_id) VALUES ('ap-team', 'AP team', 'acme-uk'), ('other', 'Other', 'acme-uk')").run();
  await env.DB.prepare("INSERT INTO org_team_members (team_id, user_id) VALUES ('ap-team', 'uma'), ('ap-team', 'ben'), ('ap-team', 'cara'), ('ap-team', 'maya'), ('other', 'pat')").run();
  await env.DB.prepare("INSERT INTO org_authority_limits (user_id, currency, max_amount) VALUES ('ben', 'GBP', 1000), ('cara', 'GBP', 50000), ('uma', 'GBP', 50000)").run();
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
  await env.DB.prepare("INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('approval', 'ap', 'Approval', 1)").run();
  // Uma holds four: a coding task she claimed, a small and a large approval named to her, and a review Ben may not do.
  await invoiceTask("code1", 800, { claimedBy: "uma", permission: "AP.Code" });
  await invoiceTask("small", 800, { ownerUser: "uma", permission: "AP.Approve" });
  await invoiceTask("large", 3000, { ownerUser: "uma", permission: "AP.Approve" });
  await invoiceTask("review", 500, { claimedBy: "uma", permission: "AP.Review" });
});

async function away(actor: string, body: Record<string, unknown>, now = MONDAY) {
  const r = await handleCreateAbsence(env.DB, actor, body, now);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return (r.body as { id: string }).id;
}

type Listed = {
  mine: { id: string; state: string; coverName: string | null; tasks: { moved: number; returned: number; kept: { reason: string; count: number }[] } }[];
  team: { userName: string; state: string; mayChange: boolean }[];
  covering: { name: string }[];
  canManage: boolean;
};

describe("marking oneself away", () => {
  it("passes what the cover may do on the first day, and says why the rest stayed", async () => {
    await away("uma", { startsOn: "2026-10-05", returnsOn: "2026-10-08", coverUserId: "ben" });
    expect((await holder("t-code1"))?.claimed_by).toBe("ben");
    expect((await holder("t-small"))?.owner_user_id).toBe("ben");
    // Above Ben's limit, and a permission he does not hold: they stay with Uma.
    expect((await holder("t-large"))?.owner_user_id).toBe("uma");
    expect((await holder("t-review"))?.claimed_by).toBe("uma");

    const uma = (await handleListAbsences(env.DB, "uma", MONDAY)).body as Listed;
    expect(uma.mine[0]).toMatchObject({ state: "away", coverName: "Ben", tasks: { moved: 2, returned: 0 } });
    expect(uma.mine[0].tasks.kept.sort((a, b) => a.reason.localeCompare(b.reason))).toEqual([
      { reason: "limit:GBP", count: 1 },
      { reason: "permission:AP.Review", count: 1 },
    ]);
    // Ben is told whom he covers for; the Timeline says who passed what, and why.
    expect(((await handleListAbsences(env.DB, "ben", MONDAY)).body as Listed).covering).toEqual([{ userId: "uma", name: "Uma", returnsOn: "2026-10-08" }]);
    // Decision 0642: the top bar's Absence button says who is away, and who covers.
    expect(await absenceStatus(env.DB, "uma", MONDAY)).toEqual({ awayUntil: "2026-10-08", covering: 0 });
    expect(await absenceStatus(env.DB, "ben", MONDAY)).toEqual({ awayUntil: null, covering: 1 });
    const event = await env.DB.prepare("SELECT action, actor_id, target_user_id, comment FROM task_action_events WHERE task_id = 't-small'").first();
    expect(event).toEqual({ action: "reassign", actor_id: "uma", target_user_id: "ben", comment: "Away 2026-10-05 until 2026-10-08: passed to cover" });
  });

  it("passes new tasks as they arrive, and hands back what is still open on return", async () => {
    await away("uma", { startsOn: "2026-10-05", returnsOn: "2026-10-08", coverUserId: "ben" });
    await invoiceTask("later", 200, { claimedBy: "uma", permission: "AP.Code" });
    await processAbsences(env.DB, new Date("2026-10-06T09:00:00Z"));
    expect((await holder("t-later"))?.claimed_by).toBe("ben");
    // Ben finishes one while she is away.
    await env.DB.prepare("UPDATE tasks SET status = 'completed' WHERE id = 't-small'").run();
    expect(await processAbsences(env.DB, THURSDAY)).toEqual({ passed: 0, returned: 2 });
    expect((await holder("t-code1"))?.claimed_by).toBe("uma");
    expect((await holder("t-later"))?.claimed_by).toBe("uma");
    expect((await holder("t-small"))?.owner_user_id).toBe("ben");
    // Once only.
    expect(await processAbsences(env.DB, THURSDAY)).toEqual({ passed: 0, returned: 0 });
    const uma = (await handleListAbsences(env.DB, "uma", THURSDAY)).body as Listed;
    expect(uma.mine[0]).toMatchObject({ state: "back", tasks: { returned: 2 } });
  });

  it("waits for the first day when planned ahead, and keeps the tasks when asked to", async () => {
    await away("uma", { startsOn: "2026-10-07", returnsOn: "2026-10-09", coverUserId: "ben" });
    expect((await holder("t-code1"))?.claimed_by).toBe("uma");
    await processAbsences(env.DB, new Date("2026-10-07T07:00:00Z"));
    expect((await holder("t-code1"))?.claimed_by).toBe("ben");

    await away("cara", { startsOn: "2026-10-12", returnsOn: "2026-10-14", passTasks: false });
    const cara = (await handleListAbsences(env.DB, "cara", MONDAY)).body as Listed;
    expect(cara.mine[0]).toMatchObject({ state: "planned", coverName: null });
  });

  it("refuses what cannot be", async () => {
    const reason = async (actor: string, body: Record<string, unknown>) => ((await handleCreateAbsence(env.DB, actor, body, MONDAY)).body as { reason: string }).reason;
    expect(await reason("uma", { startsOn: "2026-10-01", returnsOn: "2026-10-08", coverUserId: "ben" })).toBe("starts_in_past");
    expect(await reason("uma", { startsOn: "2026-10-08", returnsOn: "2026-10-08", coverUserId: "ben" })).toBe("dates_order");
    expect(await reason("uma", { startsOn: "2026-10-06", returnsOn: "2026-10-08", coverUserId: "pat" })).toBe("cover_not_allowed");
    expect(await reason("uma", { startsOn: "2026-10-06", returnsOn: "2026-10-08" })).toBe("cover_missing");
    // Someone else's absence: only their AP Manager.
    expect(await reason("ben", { userId: "uma", startsOn: "2026-10-06", returnsOn: "2026-10-08", coverUserId: "cara" })).toBe("not_yours");
    expect(await reason("pat", { userId: "uma", startsOn: "2026-10-06", returnsOn: "2026-10-08", coverUserId: "cara" })).toBe("not_yours");
    await away("ben", { startsOn: "2026-10-06", returnsOn: "2026-10-09", coverUserId: "cara" });
    expect(await reason("uma", { startsOn: "2026-10-07", returnsOn: "2026-10-08", coverUserId: "ben" })).toBe("cover_away");
    expect(await reason("ben", { startsOn: "2026-10-08", returnsOn: "2026-10-10", coverUserId: "cara" })).toBe("overlaps");
  });
});

describe("an AP Manager and their team", () => {
  it("sees the team's absences, arranges one, and amends or cancels it", async () => {
    const id = await away("maya", { userId: "uma", startsOn: "2026-10-05", returnsOn: "2026-10-08", coverUserId: "ben" });
    expect((await holder("t-code1"))?.claimed_by).toBe("ben");
    const maya = (await handleListAbsences(env.DB, "maya", MONDAY)).body as Listed;
    expect(maya.canManage).toBe(true);
    expect(maya.team.map((a) => [a.userName, a.state, a.mayChange])).toEqual([["Uma", "away", true]]);
    // Pat sees nothing of the team, and may not change it.
    expect(((await handleListAbsences(env.DB, "pat", MONDAY)).body as Listed).team).toEqual([]);
    expect((await handleCancelAbsence(env.DB, "pat", id, MONDAY)).status).toBe(403);

    // A new cover while she is away: Ben's share comes back and goes to Cara, who may do all four.
    expect((await handleAmendAbsence(env.DB, "maya", id, { coverUserId: "cara" }, MONDAY)).status).toBe(200);
    for (const t of ["t-code1", "t-review"]) expect((await holder(t))?.claimed_by).toBe("cara");
    for (const t of ["t-small", "t-large"]) expect((await holder(t))?.owner_user_id).toBe("cara");

    // Cancelled: everything comes back to Uma at once.
    expect((await handleCancelAbsence(env.DB, "maya", id, MONDAY)).status).toBe(200);
    for (const t of ["t-code1", "t-review"]) expect((await holder(t))?.claimed_by).toBe("uma");
    for (const t of ["t-small", "t-large"]) expect((await holder(t))?.owner_user_id).toBe("uma");
    const uma = (await handleListAbsences(env.DB, "uma", MONDAY)).body as Listed;
    expect(uma.mine[0].state).toBe("cancelled");
    expect((await handleAmendAbsence(env.DB, "maya", id, { returnsOn: "2026-10-09" }, MONDAY)).body).toMatchObject({ reason: "over" });
  });
});
