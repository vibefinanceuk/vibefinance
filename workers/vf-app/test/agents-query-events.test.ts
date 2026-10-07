import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { checkQuery } from "../src/agent-query.js";
import { handleCreateAgent, handleListAgentNotes, handleListAgents, handleRunAgentNow, handleTryAgentQuery } from "../src/agents.js";
import { handleListAgentActions } from "../src/agent-actions.js";

/**
 * Agents ask the data, slice 5 — decision 0638: questions started by an
 * event, prepared actions from questions, and the day's allowance on the
 * licence. Dan may do everything in Acme UK.
 */

const MONDAY = new Date("2026-10-05T09:00:00Z");
const LATER = new Date("2026-10-05T10:00:00Z");

async function licence(claims: Record<string, unknown>) {
  await env.DB.prepare("DELETE FROM licence_cache").run();
  await env.DB.prepare("INSERT INTO licence_cache (id, claims_json, fetched_at) VALUES (1, ?, '2026-10-05')").bind(JSON.stringify({ status: "active", ...claims })).run();
}

async function invoice(id: string, number: string, total: number, received: string) {
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, org_unit_id, created_at) VALUES (?1, json_set('{}', '$.BT-1', ?2, '$.BT-5', 'GBP', '$.BT-112', ?3), 'acme-uk', ?4)").bind(id, number, total, received).run();
  await env.DB.prepare("INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES (?, 'ap', 'invoice', ?, 'approval', 'in_progress')").bind(`pi-${id}`, id).run();
  await env.DB.prepare("INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome, created_at) VALUES (?, ?, 'approval', 'matched', ?)").bind(`sv-${id}`, `pi-${id}`, received).run();
}

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_units (id, name, kind) VALUES ('acme-uk', 'Acme UK Ltd', 'legal_entity')").run();
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('dan', 'dan@acme.com', 'Dan Young'), ('uma', 'uma@acme.com', 'Uma Becker')").run();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES ('r-dan', 'dan', ?), ('r-uma', 'uma', ?)")
    .bind(JSON.stringify(["AP.Agents", "AP.Manager", "AP.Analysis", "AP.TaskManage"]), JSON.stringify(["AP.Approve"]))
    .run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES ('dan', 'r-dan', NULL), ('uma', 'r-uma', NULL)").run();
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
  await env.DB.prepare("INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('approval', 'ap', 'Approval', 1)").run();
  await invoice("big-1", "K-1", 150000, "2026-10-01 09:00:00");
  await invoice("small", "K-2", 500, "2026-10-01 09:00:00");
});

const BIG = { dataset: "invoices", event: true, where: [{ field: "total", op: "over", value: 100000, currency: "GBP" }], show: ["invoice", "total"] };

async function make(query: unknown, extra: Record<string, unknown> = {}) {
  return handleCreateAgent(env.DB, "dan", { name: "Big ones", report: "query", options: { query }, orgIds: ["acme-uk"], schedule: { every: "week", weekday: 1, time: "08:00" }, ...extra }, MONDAY);
}

const notes = async () => ((await handleListAgentNotes(env.DB, "dan")).body as { notes: { id: string; rowCount: number }[] }).notes;

describe("a question started by an event", () => {
  it("is looked at every hour and sends each person only what they have not had", async () => {
    const made = await make(BIG);
    expect(made.status).toBe(201);
    const id = (made.body as { id: string }).id;
    const agent = await env.DB.prepare("SELECT schedule_json FROM agents WHERE id = ?").bind(id).first<{ schedule_json: string }>();
    expect(JSON.parse(agent!.schedule_json)).toEqual({ every: "hour" });

    await handleRunAgentNow(env.DB, "dan", id, MONDAY);
    expect((await notes()).map((n) => n.rowCount)).toEqual([1]);
    // Nothing new: nothing sent, and no run left behind.
    await handleRunAgentNow(env.DB, "dan", id, LATER);
    expect(await notes()).toHaveLength(1);
    // A new large invoice: only it.
    await invoice("big-2", "K-3", 250000, "2026-10-05 09:30:00");
    await handleRunAgentNow(env.DB, "dan", id, LATER);
    expect((await notes()).map((n) => n.rowCount)).toEqual([1, 1]);
  });

  it("shows rows one each, not groups", () => {
    expect(checkQuery({ dataset: "invoices", event: true, groupBy: ["supplier"] })).toMatchObject({ reason: "query_event_grouped" });
  });
});

describe("prepared actions from a question", () => {
  it("prepares what its dataset can, and refuses what it cannot", async () => {
    expect((await make({ dataset: "lines", show: ["description"] }, { action: "remind_holder" })).body).toMatchObject({ reason: "action_not_for_report" });
    // Held tasks on the invoices a question finds are reminded about, for approval.
    await env.DB.prepare("INSERT INTO tasks (id, stage_id, stage_visit_id, owner_user_id, required_permission, status, created_at) VALUES ('t-1', 'approval', 'sv-big-1', 'uma', 'AP.Approve', 'open', '2026-09-28 09:00:00')").run();
    const made = await make({ dataset: "invoices", where: [{ field: "total", op: "over", value: 100000, currency: "GBP" }], show: ["invoice"] }, { action: "remind_holder" });
    expect(made.status).toBe(201);
    await handleRunAgentNow(env.DB, "dan", (made.body as { id: string }).id, MONDAY);
    const waiting = ((await handleListAgentActions(env.DB, "dan", MONDAY)).body as { actions: { kind: string; payload: { taskId: string } }[] }).actions;
    expect(waiting.map((a) => [a.kind, a.payload.taskId])).toEqual([["remind_holder", "t-1"]]);
    // The list says which actions each dataset's questions can prepare.
    const list = (await handleListAgents(env.DB, "dan")).body as { catalogue: { datasets: { id: string; actions: string[] }[] } };
    expect(list.catalogue.datasets.find((d) => d.id === "returns")?.actions).toEqual(["chase_supplier"]);
    expect(list.catalogue.datasets.find((d) => d.id === "tasks")?.actions).toEqual(["remind_holder"]);
  });
});

describe("the day's questions on the licence", () => {
  it("counts each try and run, and stops at the licence's number", async () => {
    await licence({ queryLimit: 2 });
    const q = { dataset: "invoices", show: ["invoice"] };
    expect((await handleTryAgentQuery(env.DB, "dan", { query: q, orgIds: ["acme-uk"] }, MONDAY)).status).toBe(200);
    expect((await handleTryAgentQuery(env.DB, "dan", { query: q, orgIds: ["acme-uk"] }, MONDAY)).status).toBe(200);
    expect((await handleTryAgentQuery(env.DB, "dan", { query: q, orgIds: ["acme-uk"] }, MONDAY)).body).toMatchObject({ reason: "query_limit_reached" });
    expect(((await handleListAgents(env.DB, "dan", { now: MONDAY })).body as { queries: unknown }).queries).toEqual({ used: 2, max: 2 });
    // A run past the allowance fails, and says why.
    const made = await make({ dataset: "invoices", show: ["invoice"] });
    const r = await handleRunAgentNow(env.DB, "dan", (made.body as { id: string }).id, MONDAY);
    expect(JSON.stringify(r.body)).toContain("query_limit_reached");
    // The next day starts again.
    expect((await handleTryAgentQuery(env.DB, "dan", { query: q, orgIds: ["acme-uk"] }, new Date("2026-10-06T09:00:00Z"))).status).toBe(200);
  });

  it("leaves questions out where the licence says 0", async () => {
    await licence({ queryLimit: 0 });
    expect((await make({ dataset: "invoices", show: ["invoice"] })).body).toMatchObject({ reason: "query_not_in_licence" });
    const list = (await handleListAgents(env.DB, "dan")).body as { catalogue: { datasets: unknown[] }; reports: { id: string; orgIds: string[] }[] };
    expect(list.catalogue.datasets).toEqual([]);
    expect(list.reports.find((r) => r.id === "query")?.orgIds).toEqual([]);
  });
});
