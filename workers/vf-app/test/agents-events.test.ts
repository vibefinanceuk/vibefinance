import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import type { CompilerModel } from "@vibefinance/shared";
import {
  handleCreateAgent,
  handleGetAgentNote,
  handleListAgentNotes,
  handleListAgentRuns,
  handleListAgents,
  handleUpdateAgent,
  runDueAgents,
  type AgentDeps,
  type ReportTable,
} from "../src/agents.js";
import { handleUnderstandAgent } from "../src/agent-understand.js";
import type { SendEmailInput } from "../src/resend-client.js";

/**
 * Agents phase 2, slice 3: agents started by an event — decision 0630.
 * Dan sees everything and watches the Route monitor; Maya is an AP
 * Manager in Acme UK only. An event agent looks every hour and sends each
 * person only what they have not been sent.
 */

const SATURDAY = new Date("2026-10-03T12:00:00Z");
const T0 = new Date("2026-10-05T07:00:00Z");
const hour = (n: number) => new Date(T0.getTime() + n * 3_600_000 + 60_000);

async function person(id: string, name: string, permissions: string[], unit: string | null) {
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES (?, ?, ?)").bind(id, `${id}@acme.com`, name).run();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)").bind(`r-${id}`, id, JSON.stringify(permissions)).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES (?, ?, ?)").bind(id, `r-${id}`, unit).run();
}

/** An invoice at Approval since `since`. */
async function atApproval(id: string, unit: string, since: string, total = 100) {
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, org_unit_id) VALUES (?1, json_set(?2, '$.BT-1', ?4, '$.BT-5', 'GBP', '$.BT-112', ?5), ?3)")
    .bind(id, JSON.stringify({ "BT-1": id.toUpperCase(), "BT-27": "Kingsway" }), unit, id.toUpperCase(), total)
    .run();
  await env.DB.prepare("INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES (?, 'ap', 'invoice', ?, 'approval', 'in_progress')")
    .bind(`pi-${id}`, id)
    .run();
  await env.DB.prepare("INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome, created_at) VALUES (?, ?, 'approval', 'automatic', ?)")
    .bind(`v-${id}-${since}`, `pi-${id}`, since)
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_units (id, name, kind) VALUES ('acme-uk', 'Acme UK', 'legal_entity'), ('acme-de', 'Acme DE', 'legal_entity')").run();
  await person("dan", "Dan", ["AP.Agents", "AP.Manager", "AP.Analysis", "AP.FraudReview", "Integration.Monitor"], null);
  await person("maya", "Maya", ["AP.Manager", "AP.Analysis"], "acme-uk");
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
  await env.DB.prepare("INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('approval', 'ap', 'Approval', 1), ('eligible', 'ap', 'Payment-eligible', 2)").run();
});

async function eventAgent(report: string, input: Record<string, unknown> = {}) {
  const made = await handleCreateAgent(env.DB, "dan", { name: "Watch", report, orgIds: ["acme-uk", "acme-de"], schedule: { every: "day", time: "08:00" }, ...input }, SATURDAY);
  expect(made.status).toBe(201);
  const id = (made.body as { id: string }).id;
  await handleUpdateAgent(env.DB, "dan", id, { status: "active" }, T0);
  return id;
}

const notes = async (user: string) => {
  const list = ((await handleListAgentNotes(env.DB, user)).body as { notes: { id: string }[] }).notes;
  return Promise.all(list.map(async (n) => ((await handleGetAgentNote(env.DB, user, n.id)).body as { table: ReportTable }).table));
};

describe("an invoice stuck at a stage", () => {
  it("looks every hour, sends only what is new, and leaves no run behind when nothing is", async () => {
    await atApproval("a1", "acme-uk", "2026-09-28 09:00:00"); // a week
    await atApproval("a2", "acme-uk", "2026-10-04 09:00:00"); // a day: not yet
    const id = await eventAgent("event_stuck");

    // Whatever was asked, it looks every hour.
    const listed = ((await handleListAgents(env.DB, "dan")).body as { agents: { id: string; schedule: unknown; options: unknown; nextRunAt: string }[]; reports: { id: string; event: boolean }[] });
    expect(listed.agents[0]).toMatchObject({ schedule: { every: "hour" }, options: { stageDays: 3 } });
    expect(listed.reports.find((r) => r.id === "event_stuck")?.event).toBe(true);
    expect(listed.reports.find((r) => r.id === "outstanding_payables")?.event).toBe(false);

    await runDueAgents(env.DB, hour(1));
    let mine = await notes("dan");
    expect(mine).toHaveLength(1);
    expect(mine[0].rows.map((r) => [r.invoice, r.stage, r.daysAtStage])).toEqual([["A1", "Approval", 7]]);
    expect(mine[0].totals).toEqual([{ currency: "GBP", total: 100, count: 1 }]);

    // An hour on: nothing new, nothing sent, no run kept.
    await runDueAgents(env.DB, hour(2));
    expect(await notes("dan")).toHaveLength(1);
    expect(((await handleListAgentRuns(env.DB, "dan", id)).body as { runs: unknown[] }).runs).toHaveLength(1);

    // a2 passes three days: only a2 is sent.
    await runDueAgents(env.DB, new Date("2026-10-07T10:01:00Z"));
    mine = await notes("dan");
    expect(mine.map((t) => t.rows.map((r) => r.invoice))).toEqual(expect.arrayContaining([["A2"], ["A1"]]));

    // a1 leaves Approval and comes back: a new stay, told again once it is old enough.
    await env.DB.prepare("INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome, created_at) VALUES ('v-a1-again', 'pi-a1', 'approval', 'automatic', '2026-10-01 09:00:00')").run();
    await runDueAgents(env.DB, new Date("2026-10-07T12:01:00Z"));
    expect((await notes("dan")).filter((t) => t.rows.some((r) => r.invoice === "A1"))).toHaveLength(2);
  });

  it("keeps what each person was sent apart, and sends again what an email could not deliver", async () => {
    await atApproval("u1", "acme-uk", "2026-09-28 09:00:00");
    await atApproval("d1", "acme-de", "2026-09-28 09:00:00");
    let ok = false;
    const sent: SendEmailInput[] = [];
    const deps: AgentDeps = {
      email: { apiKey: "re_test", from: "agents@vibefinance-ai.com" },
      appUrl: null,
      bucket: null,
      send: async (_k, input) => {
        if (!ok) return { ok: false, error: "down" };
        sent.push(input);
        return { ok: true, messageId: "m" };
      },
    };
    await eventAgent("event_stuck", { recipients: ["maya"], deliver: { task: false, email: true } });
    await runDueAgents(env.DB, hour(1), deps);
    expect(sent).toHaveLength(0);
    ok = true;
    await runDueAgents(env.DB, hour(2), deps);
    // Nothing was marked sent while email failed, so both go now: each their own.
    expect(sent.map((e) => e.to).sort()).toEqual(["dan@acme.com", "maya@acme.com"]);
    expect(sent.find((e) => e.to === "maya@acme.com")!.text).not.toContain("D1");
    await runDueAgents(env.DB, hour(3), deps);
    expect(sent).toHaveLength(2);
  });
});

describe("the other three events", () => {
  it("an invoice from a supplier not on file, said in words", async () => {
    await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, org_unit_id) VALUES ('x1', json_set('{\"BT-27\":\"Nobody Ltd\"}', '$.BT-1', 'X1', '$.BT-5', 'GBP', '$.BT-112', 50, '$.BT-2', '2026-10-01'), 'acme-uk')").run();
    const sent: SendEmailInput[] = [];
    const deps: AgentDeps = { email: { apiKey: "k", from: "a@b.c" }, appUrl: null, bucket: null, send: async (_k, input) => (sent.push(input), { ok: true, messageId: "m" }) };
    await eventAgent("event_unapproved_supplier", { deliver: { task: true, email: true } });
    await runDueAgents(env.DB, hour(1), deps);
    const [table] = await notes("dan");
    expect(table.rows).toMatchObject([{ invoice: "X1", reason: "notonfile", invoiceId: "x1" }]);
    expect(sent[0].text).toContain("Supplier not on file");
  });

  it("a supplier file that could not be read, from the last two weeks", async () => {
    const msg = (id: string, status: string, at: string) =>
      env.DB.prepare("INSERT INTO route_messages (id, direction, status, counterparty, subject, error_text, received_at) VALUES (?, 'in', ?, 'billing@lager-nord.de', 'Rechnung 88242', 'BT-2 is not a date', ?)").bind(id, status, at).run();
    await msg("m1", "failed", "2026-10-05T06:30:00Z");
    await msg("m2", "partial", "2026-10-04T10:00:00Z");
    await msg("m3", "delivered", "2026-10-05T06:00:00Z");
    await msg("m4", "failed", "2026-09-01T06:00:00Z"); // too old
    await eventAgent("event_file_failed");
    await runDueAgents(env.DB, hour(1));
    const [table] = await notes("dan");
    expect(table.rows.map((r) => r.messageId)).toEqual(["m1", "m2"]);
    expect(table.rows[0]).toMatchObject({ from: "billing@lager-nord.de", subject: "Rechnung 88242", problem: "BT-2 is not a date" });
    expect(table.totals).toEqual([{ currency: null, total: null, count: 2 }]);
  });
});

describe("in plain words", () => {
  it("an event report needs no time, and as soon as is not too often", async () => {
    const model: CompilerModel = {
      compile: async () =>
        JSON.stringify({ name: "Stuck invoices", report: "event_stuck", orgs: "all", schedule: { every: "hour" }, options: { stageDays: 5 }, refusals: [{ code: "too_often", words: "as soon as" }] }),
    };
    const r = await handleUnderstandAgent(env.DB, model, "dan", { text: "Tell me as soon as an invoice is stuck at a stage for 5 days" }, T0);
    expect(r.body).toMatchObject({
      draft: { report: "event_stuck", schedule: { every: "hour" }, options: { stageDays: 5 } },
      refusals: [],
      missing: [],
    });
  });
});
