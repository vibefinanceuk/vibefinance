import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import {
  handleCreateAgent,
  handleGetAgent,
  handleListAgents,
  handleRunAgentNow,
  handleSetAgentSettings,
  handleUpdateAgent,
  runDueAgents,
  type AgentDeps,
} from "../src/agents.js";
import { addWorkingDays, handleDecideAgentAction, handleListAgentActions } from "../src/agent-actions.js";
import { handleGetActivity } from "../src/activity-route.js";
import type { SendEmailInput } from "../src/resend-client.js";

/**
 * Agents phase 3, slice 1: prepared actions, and reminding whoever holds
 * a stuck task — decision 0631. Dan makes agents and manages tasks
 * everywhere; Maya manages tasks in Acme UK; Pat manages none; Uma, who
 * reads German, holds the stuck tasks.
 */

const SATURDAY = new Date("2026-10-03T12:00:00Z");
const MONDAY = new Date("2026-10-05T09:00:00Z");

async function person(id: string, name: string, permissions: string[], unit: string | null, locale: string | null = null) {
  await env.DB.prepare("INSERT INTO org_users (id, email, name, locale) VALUES (?, ?, ?, ?)").bind(id, `${id}@acme.com`, name, locale).run();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)").bind(`r-${id}`, id, JSON.stringify(permissions)).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES (?, ?, ?)").bind(id, `r-${id}`, unit).run();
}

async function invoiceWithTask(id: string, unit: string, taskCreated: string, claimedBy: string | null) {
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, org_unit_id, invoice_number, currency, total_with_vat) VALUES (?, ?, ?, ?, 'GBP', 100)")
    .bind(id, JSON.stringify({ "BT-1": id.toUpperCase(), "BT-27": "Kingsway Logistics" }), unit, id.toUpperCase())
    .run();
  await env.DB.prepare("INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES (?, 'ap', 'invoice', ?, 'approval', 'in_progress')").bind(`pi-${id}`, id).run();
  await env.DB.prepare("INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome) VALUES (?, ?, 'approval', 'matched')").bind(`sv-${id}`, `pi-${id}`).run();
  await env.DB.prepare("INSERT INTO tasks (id, stage_id, stage_visit_id, owner_team_id, claimed_by, required_permission, status, created_at) VALUES (?, 'approval', ?, NULL, ?, 'AP.Approve', 'open', ?)")
    .bind(`t-${id}`, `sv-${id}`, claimedBy, taskCreated)
    .run();
}

function mailer() {
  const sent: SendEmailInput[] = [];
  const deps: AgentDeps = {
    email: { apiKey: "re_test", from: "agents@vibefinance-ai.com" },
    appUrl: "https://app.vibefinance-ai.com",
    bucket: null,
    send: async (_k, input) => (sent.push(input), { ok: true, messageId: "m" }),
  };
  return { sent, deps };
}

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_units (id, name, kind) VALUES ('acme-uk', 'Acme UK', 'legal_entity'), ('acme-de', 'Acme DE', 'legal_entity')").run();
  await person("dan", "Dan Young", ["AP.Agents", "AP.Manager", "AP.Analysis", "AP.TaskManage"], null);
  await person("maya", "Maya", ["AP.Manager", "AP.Analysis", "AP.TaskManage"], "acme-uk");
  await person("pat", "Pat", ["AP.Analysis"], null);
  await person("uma", "Uma Becker", ["AP.Approve"], null, "de");
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
  await env.DB.prepare("INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('approval', 'ap', 'Approval', 1), ('eligible', 'ap', 'Payment-eligible', 2)").run();
  await invoiceWithTask("k1", "acme-uk", "2026-09-28 09:00:00", "uma"); // 7 days, held
  await invoiceWithTask("k2", "acme-de", "2026-09-28 09:00:00", "uma"); // 7 days, held, Acme DE
  await invoiceWithTask("k3", "acme-uk", "2026-09-28 09:00:00", null); // 7 days, nobody holds it
  await invoiceWithTask("k4", "acme-uk", "2026-10-04 09:00:00", "uma"); // 1 day
});

async function remindingAgent() {
  const made = await handleCreateAgent(
    env.DB,
    "dan",
    { name: "Stuck work", report: "stuck_work", orgIds: ["acme-uk", "acme-de"], schedule: { every: "workday", time: "09:00" }, action: "remind_holder" },
    SATURDAY,
  );
  expect(made.status).toBe(201);
  return (made.body as { id: string }).id;
}

type Action = { id: string; status: string; payload: { holderName: string; invoiceNumber: string; stage: string; days: number }; decidedBy: string | null; note: string | null; result: unknown };
const waitingFor = async (user: string, now = MONDAY) => ((await handleListAgentActions(env.DB, user, now)).body as { actions: Action[] }).actions;

describe("an agent that also prepares", () => {
  it("takes only an action its report can prepare, and the action is part of the plan", async () => {
    const base = { name: "X", orgIds: ["acme-uk"], schedule: { every: "workday", time: "09:00" } };
    expect((await handleCreateAgent(env.DB, "dan", { ...base, report: "accruals", action: "remind_holder" }, SATURDAY)).body).toMatchObject({ reason: "action_not_for_report" });
    expect((await handleCreateAgent(env.DB, "dan", { ...base, report: "stuck_work", action: "pay_everyone" }, SATURDAY)).body).toMatchObject({ reason: "action_unknown" });
    const id = ((await handleCreateAgent(env.DB, "dan", { ...base, report: "stuck_work" }, SATURDAY)).body as { id: string }).id;
    const on = (await handleUpdateAgent(env.DB, "dan", id, { action: "remind_holder" }, SATURDAY)).body as { action: string; planVersion: number };
    expect(on).toMatchObject({ action: "remind_holder", planVersion: 2 });
    const reports = ((await handleListAgents(env.DB, "dan")).body as { reports: { id: string; actions: string[] }[]; actionsEnabled: unknown }).reports;
    expect(reports.find((r) => r.id === "stuck_work")?.actions).toEqual(["remind_holder"]);
    expect(reports.find((r) => r.id === "accruals")?.actions).toEqual([]);
  });
});

describe("reminding whoever holds a stuck task", () => {
  it("prepares one per held, old enough task, once, for those who may approve where the invoice is", async () => {
    const id = await remindingAgent();
    await handleRunAgentNow(env.DB, "dan", id, MONDAY);
    const forDan = await waitingFor("dan");
    // k3 is held by nobody; k4 is too recent.
    expect(forDan.map((a) => a.payload.invoiceNumber).sort()).toEqual(["K1", "K2"]);
    expect(forDan[0]).toMatchObject({ status: "waiting", payload: { holderName: "Uma Becker", stage: "Approval", days: 7 } });
    // Maya manages tasks in Acme UK only; Pat manages none.
    expect((await waitingFor("maya")).map((a) => a.payload.invoiceNumber)).toEqual(["K1"]);
    expect(await waitingFor("pat")).toEqual([]);
    // Run again: nothing new while they wait.
    await handleRunAgentNow(env.DB, "dan", id, new Date(MONDAY.getTime() + 3_600_000));
    expect(await waitingFor("dan")).toHaveLength(2);
  });

  it("approved, emails the holder in their language with the note, and says so in the Timeline and on the agent", async () => {
    const id = await remindingAgent();
    await handleRunAgentNow(env.DB, "dan", id, MONDAY);
    const k1 = (await waitingFor("maya"))[0];
    const { sent, deps } = mailer();
    expect((await handleDecideAgentAction(env.DB, "pat", k1.id, "approve", {}, deps, MONDAY)).status).toBe(403);
    const r = await handleDecideAgentAction(env.DB, "maya", k1.id, "approve", { note: "Bitte bis Mittwoch." }, deps, MONDAY);
    expect(r.body).toMatchObject({ status: "done", emailed: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("uma@acme.com");
    expect(sent[0].subject).toBe("Erinnerung zur Rechnung K1");
    expect(sent[0].text).toContain("Maya bittet Sie, sich die Rechnung K1 von Kingsway Logistics anzusehen, die seit 7 Tagen im Schritt Approval bei Ihnen liegt.");
    expect(sent[0].text).toContain("Hinweis: Bitte bis Mittwoch.");
    // Decided once only.
    expect((await handleDecideAgentAction(env.DB, "dan", k1.id, "approve", {}, deps, MONDAY)).body).toMatchObject({ reason: "already_done" });

    const timeline = (await handleGetActivity(env.DB, "k1")).body as { items: { kind: string; action?: string; userName?: string; targetUserName?: string; comment?: string }[] };
    expect(timeline.items.find((i) => i.action === "remind")).toMatchObject({ kind: "action_taken", userName: "Maya", targetUserName: "Uma Becker", comment: "Bitte bis Mittwoch." });
    const page = (await handleGetAgent(env.DB, "dan", id)).body as { actions: Action[] };
    expect(page.actions.find((a) => a.payload.invoiceNumber === "K1")).toMatchObject({ status: "done", decidedBy: "Maya", note: "Bitte bis Mittwoch.", result: { emailed: true } });
  });

  it("does nothing when rejected, or when the task moved on since it was prepared", async () => {
    const id = await remindingAgent();
    await handleRunAgentNow(env.DB, "dan", id, MONDAY);
    const [a, b] = await waitingFor("dan");
    const { sent, deps } = mailer();
    expect((await handleDecideAgentAction(env.DB, "dan", a.id, "reject", { reason: "Uma is on it" }, deps, MONDAY)).body).toMatchObject({ status: "rejected" });
    await env.DB.prepare("UPDATE tasks SET claimed_by = NULL WHERE id = ?").bind(`t-${b.payload.invoiceNumber.toLowerCase()}`).run();
    expect((await handleDecideAgentAction(env.DB, "dan", b.id, "approve", {}, deps, MONDAY)).body).toMatchObject({ reason: "changed" });
    expect(sent).toHaveLength(0);
    const page = (await handleGetAgent(env.DB, "dan", id)).body as { actions: { status: string; reason: string | null }[] };
    expect(page.actions.map((x) => [x.status, x.reason]).sort()).toEqual([["failed", "changed"], ["rejected", "Uma is on it"]]);
  });

  it("lapses after 5 working days, and is not prepared again for a week", async () => {
    expect(addWorkingDays(new Date("2026-10-09T09:00:00Z"), 5).toISOString()).toBe("2026-10-16T09:00:00.000Z"); // Friday to Friday
    const id = await remindingAgent();
    await handleRunAgentNow(env.DB, "dan", id, MONDAY);
    const [a] = await waitingFor("dan");
    const later = new Date("2026-10-12T09:01:00Z"); // after Monday 12 Oct 09:00
    await runDueAgents(env.DB, later);
    expect(await waitingFor("dan", later)).toEqual([]);
    expect((await handleDecideAgentAction(env.DB, "dan", a.id, "approve", {}, mailer().deps, later)).body).toMatchObject({ reason: "already_expired" });
    // K1 and K2, prepared 5 Oct, are not prepared again before 12 Oct; K4 is old enough by now.
    const sunday = new Date("2026-10-11T09:00:00Z");
    await handleRunAgentNow(env.DB, "dan", id, sunday);
    expect((await waitingFor("dan", sunday)).map((x) => x.payload.invoiceNumber)).toEqual(["K4"]);
    // On 13 Oct, K1 and K2 again.
    const tuesday = new Date("2026-10-13T09:00:00Z");
    await handleRunAgentNow(env.DB, "dan", id, tuesday);
    expect((await waitingFor("dan", tuesday)).map((x) => x.payload.invoiceNumber).sort()).toEqual(["K1", "K2", "K4"]);
  });

  it("prepares and offers nothing while an administrator has prepared actions off", async () => {
    const id = await remindingAgent();
    await handleRunAgentNow(env.DB, "dan", id, MONDAY);
    const [a] = await waitingFor("dan");
    expect((await handleSetAgentSettings(env.DB, { actionsEnabled: false })).body).toMatchObject({ actionsEnabled: { environment: false, licence: true } });
    expect(await waitingFor("dan")).toEqual([]);
    expect((await handleDecideAgentAction(env.DB, "dan", a.id, "approve", {}, mailer().deps, MONDAY)).body).toMatchObject({ reason: "actions_off" });
    expect((await handleSetAgentSettings(env.DB, { actionsEnabled: "maybe" })).status).toBe(422);
  });
});
