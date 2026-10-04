import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import worker from "../src/index.js";
import type { Env } from "../src/index.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";
import {
  DEFAULT_AGENT_LIMIT,
  handleAgentNoteDone,
  handleCreateAgent,
  handleGetAgentNote,
  handleListAgentNotes,
  handleListAgentRuns,
  handleListAgents,
  handleRemoveAgent,
  handleRunAgentNow,
  handleSetAgentTimeZone,
  handleUpdateAgent,
  runDueAgents,
  type ReportTable,
} from "../src/agents.js";

/**
 * Agents, slice 1 — decision 0622. Acme UK and Acme DE; a three-stage AP
 * process ending at Payment-eligible.
 *
 * - inv-a: completed, Acme UK, Kingsway, GBP 120, due 1 September.
 * - inv-b: at Payment-eligible, Acme DE, Lager Nord, EUR 200, due 20 October.
 * - inv-c: at Approval: not yet payment-eligible.
 * - inv-d: payment-eligible but already delivered to the ERP.
 * - inv-e: payment-eligible but discarded.
 *
 * Dan makes agents everywhere; Uma only in Acme UK; Ada administers people.
 */

const MONDAY_8 = { every: "week", time: "08:00", weekday: 1 };
// Saturday 3 October 2026, 12:00 UTC.
const SATURDAY = new Date("2026-10-03T12:00:00Z");
// Monday 5 October, 07:00 UTC = 08:00 in London (summer time).
const MONDAY_RUN = "2026-10-05T07:00:00.000Z";

async function person(id: string, permissions: string[], unit: string | null) {
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES (?, ?, ?)").bind(id, `${id}@acme.com`, id[0].toUpperCase() + id.slice(1)).run();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)").bind(`r-${id}`, id, JSON.stringify(permissions)).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES (?, ?, ?)").bind(id, `r-${id}`, unit).run();
}

async function invoice(id: string, opts: { stage: string; status?: string; unit: string; supplier: string; currency: string; total: number; due: string }) {
  await env.DB.prepare(
    "INSERT INTO invoice_headers (id, facts_json, org_unit_id, invoice_number, currency, total_with_vat) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(id, JSON.stringify({ "BT-1": id.toUpperCase(), "BT-9": opts.due, "BT-27": opts.supplier }), opts.unit, id.toUpperCase(), opts.currency, opts.total)
    .run();
  await env.DB.prepare("INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES (?, 'ap', 'invoice', ?, ?, ?)")
    .bind(`pi-${id}`, id, opts.stage, opts.status ?? "in_progress")
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_units (id, name, kind) VALUES ('acme-uk', 'Acme UK', 'legal_entity'), ('acme-de', 'Acme DE', 'legal_entity')").run();
  await person("dan", ["AP.Agents", "AP.Analysis", "AP.FraudReview"], null);
  await person("uma", ["AP.Agents", "AP.Analysis"], "acme-uk");
  await person("ada", ["Admin.UserManagement", "Admin.Configure"], null);
  await person("pat", ["AP.Analysis"], null);
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
  await env.DB.prepare(
    "INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('coding', 'ap', 'Coding', 1), ('approval', 'ap', 'Approval', 2), ('eligible', 'ap', 'Payment-eligible', 3)"
  ).run();
  await invoice("inv-a", { stage: "eligible", status: "completed", unit: "acme-uk", supplier: "Kingsway", currency: "GBP", total: 120, due: "2026-09-01" });
  await invoice("inv-b", { stage: "eligible", unit: "acme-de", supplier: "Lager Nord GmbH", currency: "EUR", total: 200, due: "2026-10-20" });
  await invoice("inv-c", { stage: "approval", unit: "acme-uk", supplier: "Kingsway", currency: "GBP", total: 50, due: "2026-09-15" });
  await invoice("inv-d", { stage: "eligible", unit: "acme-uk", supplier: "Kingsway", currency: "GBP", total: 75, due: "2026-08-01" });
  await invoice("inv-e", { stage: "eligible", status: "archived", unit: "acme-uk", supplier: "Kingsway", currency: "GBP", total: 999, due: "2026-07-01" });
  await env.DB.prepare("INSERT INTO route_instances (id, route_id, process_id, name, status) VALUES ('erp-1', 'https-out', 'ap', 'ERP', 'active')").run();
  await env.DB.prepare(
    "INSERT INTO destination_deliveries (instance_id, invoice_id, status, attempts, created_at, delivered_at) VALUES ('erp-1', 'inv-d', 'delivered', 1, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')"
  ).run();
});

const make = async (user: string, input: Record<string, unknown> = {}) =>
  handleCreateAgent(env.DB, user, { name: "Outstanding payables", report: "outstanding_payables", orgIds: ["acme-uk", "acme-de"], schedule: MONDAY_8, ...input }, SATURDAY);

const notesOf = async (user: string) => ((await handleListAgentNotes(env.DB, user)).body as { notes: { id: string; agentName: string; rowCount: number; late: boolean }[] }).notes;
const tableOf = async (user: string, noteId: string) => ((await handleGetAgentNote(env.DB, user, noteId)).body as { table: ReportTable }).table;

describe("making an agent", () => {
  it("is saved paused, with what it reports, where and when", async () => {
    const made = await make("dan");
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({
      name: "Outstanding payables",
      report: "outstanding_payables",
      orgs: [{ id: "acme-uk", name: "Acme UK" }, { id: "acme-de", name: "Acme DE" }],
      schedule: MONDAY_8,
      status: "paused",
      nextRunAt: null,
      lastRun: null,
    });
  });

  it("is refused, in words, where incomplete or beyond what the author may see", async () => {
    expect((await make("dan", { name: " " })).body).toMatchObject({ reason: "name_missing" });
    expect((await make("dan", { report: "payroll" })).body).toMatchObject({ reason: "report_unknown" });
    expect((await make("dan", { orgIds: [] })).body).toMatchObject({ reason: "orgs_missing" });
    expect((await make("dan", { schedule: { every: "hour", time: "08:00" } })).body).toMatchObject({ reason: "every_invalid" });
    // Uma sees Acme UK only.
    const uma = await make("uma");
    expect(uma.status).toBe(422);
    expect(uma.body).toMatchObject({ reason: "org_not_permitted", error: "you cannot see this report for Acme DE" });
    // And possible duplicates need AP.FraudReview, which she lacks.
    expect((await make("uma", { report: "possible_duplicates", orgIds: ["acme-uk"] })).body).toMatchObject({ reason: "org_not_permitted" });
    expect((await make("uma", { orgIds: ["acme-uk"] })).status).toBe(201);
  });

  it("stops at the licence's count: the default where it says none, its own where it does", async () => {
    for (let i = 0; i < DEFAULT_AGENT_LIMIT; i++) expect((await make("dan", { name: `A${i}` })).status).toBe(201);
    const over = await make("dan", { name: "One too many" });
    expect(over.status).toBe(409);
    expect(over.body).toMatchObject({ reason: "limit_reached", max: DEFAULT_AGENT_LIMIT });
    // A removed agent frees its place.
    const list = (await handleListAgents(env.DB, "dan")).body as { agents: { id: string }[]; limit: { used: number; max: number } };
    expect(list.limit).toEqual({ used: DEFAULT_AGENT_LIMIT, max: DEFAULT_AGENT_LIMIT });
    await handleRemoveAgent(env.DB, "dan", list.agents[0].id);
    expect((await make("dan", { name: "Now it fits" })).status).toBe(201);

    // The licence says 6.
    const claims = { customerId: "c", plan: "growth", features: [], volumeEntitlement: 1000, status: "active", issuedAt: "x", expiresAt: "y", agentLimit: 6 };
    await env.DB.prepare("INSERT INTO licence_cache (id, claims_json, fetched_at) VALUES (1, ?, '2026-10-04')").bind(JSON.stringify(claims)).run();
    expect((await make("dan", { name: "Sixth" })).status).toBe(201);
    expect((await make("dan", { name: "Seventh" })).body).toMatchObject({ reason: "limit_reached", max: 6 });
  });

  it("offers each report only where the person holds its permission", async () => {
    const body = (await handleListAgents(env.DB, "uma")).body as { reports: { id: string; orgIds: string[] }[]; orgs: { id: string }[]; timeZone: string; canSetTimeZone: boolean };
    expect(body.orgs.map((o) => o.id)).toEqual(["acme-uk"]);
    expect(body.reports.find((r) => r.id === "outstanding_payables")?.orgIds).toEqual(["acme-uk"]);
    expect(body.reports.find((r) => r.id === "possible_duplicates")?.orgIds).toEqual([]);
    expect(body.timeZone).toBe("Europe/London");
    expect(body.canSetTimeZone).toBe(false);
  });
});

describe("starting, running and pausing", () => {
  it("works out the next run when started, and runs it once when due, delivering to the author", async () => {
    const id = ((await make("dan")).body as { id: string }).id;
    const started = await handleUpdateAgent(env.DB, "dan", id, { status: "active" }, SATURDAY);
    expect(started.body).toMatchObject({ status: "active", nextRunAt: MONDAY_RUN });

    // Not yet due.
    expect(await runDueAgents(env.DB, new Date("2026-10-05T06:59:00Z"))).toEqual({ ran: 0 });
    // Due: run once, and the next is the Monday after.
    const at = new Date("2026-10-05T07:02:00Z");
    expect(await runDueAgents(env.DB, at)).toEqual({ ran: 1 });
    expect(await runDueAgents(env.DB, at)).toEqual({ ran: 0 });
    const agent = ((await handleListAgents(env.DB, "dan")).body as { agents: { nextRunAt: string; lastRun: { status: string; late: boolean; rowCount: number } }[] }).agents[0];
    expect(agent.nextRunAt).toBe("2026-10-12T07:00:00.000Z");
    expect(agent.lastRun).toMatchObject({ status: "delivered", late: false, rowCount: 2 });

    const notes = await notesOf("dan");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ agentName: "Outstanding payables", rowCount: 2, late: false });
    expect(await notesOf("uma")).toEqual([]);
  });

  it("reports outstanding payables: payment-eligible, not delivered to the ERP, oldest due first", async () => {
    await make("dan");
    const id = ((await handleListAgents(env.DB, "dan")).body as { agents: { id: string }[] }).agents[0].id;
    await handleRunAgentNow(env.DB, "dan", id, new Date("2026-10-05T07:00:00Z"));
    const table = await tableOf("dan", (await notesOf("dan"))[0].id);
    expect(table.report).toBe("outstanding_payables");
    // inv-c is not eligible, inv-d went to the ERP, inv-e was discarded.
    // Aged against the due date (decision 0624): inv-a is 34 days past due, inv-b not yet due.
    expect(table.rows).toEqual([
      { org: "Acme UK", supplier: "Kingsway", currency: "GBP", invoices: 1, notDue: 0, d30: 0, d60: 120, d90: 0, d90plus: 0, total: 120, daysPastDue: 34 },
      { org: "Acme DE", supplier: "Lager Nord GmbH", currency: "EUR", invoices: 1, notDue: 200, d30: 0, d60: 0, d90: 0, d90plus: 0, total: 200, daysPastDue: 0 },
    ]);
    expect(table.totals).toEqual(
      expect.arrayContaining([
        { currency: "GBP", total: 120, count: 1 },
        { currency: "EUR", total: 200, count: 1 },
      ])
    );
    expect(table.skippedOrgs).toEqual([]);
  });

  it("runs a missed run once, late, and says so", async () => {
    const id = ((await make("dan")).body as { id: string }).id;
    await handleUpdateAgent(env.DB, "dan", id, { status: "active" }, SATURDAY);
    // Nothing ran for two weeks.
    expect(await runDueAgents(env.DB, new Date("2026-10-20T10:00:00Z"))).toEqual({ ran: 1 });
    const runs = ((await handleListAgentRuns(env.DB, "dan", id)).body as { runs: { late: boolean; scheduledFor: string; trigger: string }[] }).runs;
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ late: true, scheduledFor: MONDAY_RUN, trigger: "schedule" });
    const agent = ((await handleListAgents(env.DB, "dan")).body as { agents: { nextRunAt: string }[] }).agents[0];
    expect(agent.nextRunAt).toBe("2026-10-26T08:00:00.000Z");
  });

  it("sends nothing when there is nothing to report", async () => {
    await env.DB.prepare("DELETE FROM process_instances WHERE subject_id IN ('inv-a', 'inv-b')").run();
    const id = ((await make("dan")).body as { id: string }).id;
    expect((await handleRunAgentNow(env.DB, "dan", id, SATURDAY)).body).toMatchObject({ status: "nothing" });
    expect(await notesOf("dan")).toEqual([]);
  });

  it("leaves out an organisation the author no longer holds, and pauses when none or AP.Agents is left", async () => {
    await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES ('uma', 'r-uma', 'acme-de')").run();
    const id = ((await make("uma")).body as { id: string }).id;
    await handleUpdateAgent(env.DB, "uma", id, { status: "active" }, SATURDAY);
    await env.DB.prepare("DELETE FROM org_user_roles WHERE user_id = 'uma' AND unit_id = 'acme-de'").run();
    await runDueAgents(env.DB, new Date("2026-10-05T07:00:00Z"));
    const table = await tableOf("uma", (await notesOf("uma"))[0].id);
    expect(table.skippedOrgs).toEqual(["Acme DE"]);
    expect(table.rows.map((r) => r.org)).toEqual(["Acme UK"]);

    // Her role loses AP.Agents: the next run fails and the agent pauses itself.
    await env.DB.prepare("UPDATE org_roles SET permissions_json = '[\"AP.Analysis\"]' WHERE id = 'r-uma'").run();
    await runDueAgents(env.DB, new Date("2026-10-12T07:00:00Z"));
    const agent = (await env.DB.prepare("SELECT status, paused_reason, next_run_at FROM agents WHERE id = ?").bind(id).first())!;
    expect(agent).toEqual({ status: "paused", paused_reason: "author_access", next_run_at: null });
    const runs = ((await handleListAgentRuns(env.DB, "uma", id)).body as { runs: { status: string; error: string }[] }).runs;
    expect(runs[0]).toMatchObject({ status: "failed", error: "author_access" });
  });

  it("refuses to start a once already past, and pauses itself after a once has run", async () => {
    const past = ((await make("dan", { schedule: { every: "once", time: "09:00", date: "2026-10-01" } })).body as { id: string }).id;
    expect((await handleUpdateAgent(env.DB, "dan", past, { status: "active" }, SATURDAY)).body).toMatchObject({ reason: "once_past" });
    const once = ((await make("dan", { name: "Once", schedule: { every: "once", time: "09:00", date: "2026-10-06" } })).body as { id: string }).id;
    await handleUpdateAgent(env.DB, "dan", once, { status: "active" }, SATURDAY);
    expect(await runDueAgents(env.DB, new Date("2026-10-06T08:05:00Z"))).toEqual({ ran: 1 });
    const row = (await env.DB.prepare("SELECT status, paused_reason FROM agents WHERE id = ?").bind(once).first())!;
    expect(row).toEqual({ status: "paused", paused_reason: "finished" });
  });

  it("Run now goes to the author, paused or not, and leaves the schedule alone", async () => {
    const id = ((await make("dan")).body as { id: string }).id;
    expect((await handleRunAgentNow(env.DB, "dan", id, SATURDAY)).body).toMatchObject({ status: "delivered" });
    expect((await handleRunAgentNow(env.DB, "uma", id, SATURDAY)).status).toBe(403);
    const row = (await env.DB.prepare("SELECT status, next_run_at FROM agents WHERE id = ?").bind(id).first())!;
    expect(row).toEqual({ status: "paused", next_run_at: null });
    const runs = ((await handleListAgentRuns(env.DB, "dan", id)).body as { runs: { trigger: string }[] }).runs;
    expect(runs[0].trigger).toBe("now");
  });

  it("pausing always works, even where the rest no longer would", async () => {
    const id = ((await make("uma", { orgIds: ["acme-uk"] })).body as { id: string }).id;
    await handleUpdateAgent(env.DB, "uma", id, { status: "active" }, SATURDAY);
    await env.DB.prepare("DELETE FROM org_user_roles WHERE user_id = 'uma'").run();
    expect((await handleUpdateAgent(env.DB, "uma", id, { status: "paused" }, SATURDAY)).body).toMatchObject({ status: "paused", nextRunAt: null });
  });

  it("runs every report, each with its own permission", async () => {
    for (const report of ["overdue_not_eligible", "accruals", "open_tasks", "possible_duplicates"]) {
      const id = ((await make("dan", { name: report, report })).body as { id: string }).id;
      const result = (await handleRunAgentNow(env.DB, "dan", id, SATURDAY)).body as { status: string };
      expect(["delivered", "nothing"]).toContain(result.status);
      await handleRemoveAgent(env.DB, "dan", id);
    }
    // Accruals: inv-c at Approval in Acme UK.
    const id = ((await make("dan", { name: "Accruals", report: "accruals" })).body as { id: string }).id;
    await handleRunAgentNow(env.DB, "dan", id, SATURDAY);
    const table = await tableOf("dan", (await notesOf("dan")).find((n) => n.agentName === "Accruals")!.id);
    expect(table.rows).toEqual([{ org: "Acme UK", stage: "Approval", invoices: 1, total: 50, currency: "GBP" }]);
  });
});

describe("notes, removing and the time zone", () => {
  it("a note is its recipient's alone, and leaves the list when done", async () => {
    const id = ((await make("dan")).body as { id: string }).id;
    await handleRunAgentNow(env.DB, "dan", id, SATURDAY);
    const noteId = (await notesOf("dan"))[0].id;
    expect((await handleGetAgentNote(env.DB, "uma", noteId)).status).toBe(404);
    expect((await handleAgentNoteDone(env.DB, "uma", noteId)).status).toBe(404);
    expect((await handleAgentNoteDone(env.DB, "dan", noteId)).status).toBe(200);
    expect(await notesOf("dan")).toEqual([]);
  });

  it("only its author changes an agent; its author or an administrator removes it", async () => {
    const id = ((await make("dan")).body as { id: string }).id;
    expect((await handleUpdateAgent(env.DB, "uma", id, { name: "Mine now" })).status).toBe(403);
    expect((await handleRemoveAgent(env.DB, "pat", id)).status).toBe(403);
    const all = (await handleListAgents(env.DB, "ada", { all: true })).body as { agents: { id: string; authorName: string }[]; canManageAll: boolean };
    expect(all.canManageAll).toBe(true);
    expect(all.agents).toEqual([expect.objectContaining({ id, authorName: "Dan" })]);
    expect((await handleRemoveAgent(env.DB, "ada", id)).status).toBe(200);
    expect(((await handleListAgents(env.DB, "dan")).body as { agents: unknown[] }).agents).toEqual([]);
  });

  it("a new time zone moves every active agent's next run", async () => {
    const id = ((await make("dan")).body as { id: string }).id;
    await handleUpdateAgent(env.DB, "dan", id, { status: "active" }, SATURDAY);
    expect((await handleSetAgentTimeZone(env.DB, { timeZone: "Mars/Olympus" }, SATURDAY)).status).toBe(422);
    expect((await handleSetAgentTimeZone(env.DB, { timeZone: "Europe/Berlin" }, SATURDAY)).status).toBe(200);
    const agent = ((await handleListAgents(env.DB, "dan")).body as { agents: { nextRunAt: string }[]; timeZone: string });
    expect(agent.timeZone).toBe("Europe/Berlin");
    expect(agent.agents[0].nextRunAt).toBe("2026-10-05T06:00:00.000Z");
  });
});

describe("the routes — decision 0622", () => {
  it("need AP.Agents to make, let an administrator look, and need Admin.Configure for the time zone", async () => {
    const keyFor = async (id: string) => {
      const key = generateApiKey();
      await env.DB.prepare("UPDATE org_users SET api_key_hash = ? WHERE id = ?").bind(await hashApiKey(key), id).run();
      return key;
    };
    const dan = await keyFor("dan");
    const ada = await keyFor("ada");
    const pat = await keyFor("pat");
    const call = (path: string, key: string, init: RequestInit = {}) =>
      worker.fetch(new Request(`https://vf.example${path}`, { ...init, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" } }), env as unknown as Env);
    const body = JSON.stringify({ name: "Weekly", report: "outstanding_payables", orgIds: ["acme-uk"], schedule: MONDAY_8 });
    expect((await call("/agents", pat)).status).toBe(403);
    expect((await call("/agents", ada, { method: "POST", body })).status).toBe(403);
    const made = await call("/agents", dan, { method: "POST", body });
    expect(made.status).toBe(201);
    const { id } = (await made.json()) as { id: string };
    expect((await call(`/agents/${id}/run`, dan, { method: "POST" })).status).toBe(200);
    expect((await call(`/agents/${id}/runs`, ada)).status).toBe(200);
    expect((await call("/agent-notes", dan)).status).toBe(200);
    expect((await call("/agent-settings", dan, { method: "PUT", body: JSON.stringify({ timeZone: "Europe/Paris" }) })).status).toBe(403);
    expect((await call("/agent-settings", ada, { method: "PUT", body: JSON.stringify({ timeZone: "Europe/Paris" }) })).status).toBe(200);
    expect((await call(`/agents/${id}`, ada, { method: "DELETE" })).status).toBe(200);
  });
});
