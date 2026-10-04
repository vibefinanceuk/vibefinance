import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import worker from "../src/index.js";
import type { Env } from "../src/index.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";
import {
  handleCreateAgent,
  handleGetAgentNote,
  handleListAgentNotes,
  handleListAgentRuns,
  handleListAgents,
  handleRunAgentNow,
  handleStopAgent,
  handleUpdateAgent,
  purgeOldAgentRecords,
  runDueAgents,
  type AgentDeps,
  type ReportTable,
} from "../src/agents.js";
import { buildAgentEmail, reportCsv } from "../src/agent-email.js";
import type { SendEmailInput } from "../src/resend-client.js";

/**
 * Agents, slice 2: email — decision 0623. Dan makes agents everywhere;
 * Maya is an AP Manager in Acme UK only, reading German; Pat is not an AP
 * Manager. Acme UK owes Kingsway GBP 120; Acme DE owes Lager Nord EUR 200.
 */

const MONDAY_8 = { every: "week", time: "08:00", weekday: 1 };
const SATURDAY = new Date("2026-10-03T12:00:00Z");
const MONDAY = new Date("2026-10-05T07:00:00Z");

async function person(id: string, name: string, permissions: string[], unit: string | null, locale: string | null = null) {
  await env.DB.prepare("INSERT INTO org_users (id, email, name, locale) VALUES (?, ?, ?, ?)").bind(id, `${id}@acme.com`, name, locale).run();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)").bind(`r-${id}`, id, JSON.stringify(permissions)).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES (?, ?, ?)").bind(id, `r-${id}`, unit).run();
}

async function invoice(id: string, unit: string, supplier: string, currency: string, total: number) {
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, org_unit_id, invoice_number, currency, total_with_vat) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, JSON.stringify({ "BT-1": id, "BT-9": "2026-09-01", "BT-27": supplier }), unit, id, currency, total)
    .run();
  await env.DB.prepare("INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES (?, 'ap', 'invoice', ?, 'eligible', 'completed')")
    .bind(`pi-${id}`, id)
    .run();
}

function fakeEmail() {
  const sent: SendEmailInput[] = [];
  const deps: AgentDeps = {
    email: { apiKey: "re_test", from: "agents@vibefinance-ai.com" },
    appUrl: "https://app.vibefinance-ai.com",
    bucket: env.DOCUMENTS,
    send: async (_key, input) => {
      sent.push(input);
      return { ok: true, messageId: `msg-${sent.length}` };
    },
  };
  return { sent, deps };
}

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_units (id, name, kind) VALUES ('acme-uk', 'Acme UK', 'legal_entity'), ('acme-de', 'Acme DE', 'legal_entity')").run();
  await person("dan", "Dan", ["AP.Agents", "AP.Manager", "AP.Analysis"], null);
  await person("maya", "Maya", ["AP.Manager", "AP.Analysis"], "acme-uk", "de");
  await person("pat", "Pat", ["AP.Analysis"], null);
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
  await env.DB.prepare("INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('approval', 'ap', 'Approval', 1), ('eligible', 'ap', 'Payment-eligible', 2)").run();
  await invoice("inv-a", "acme-uk", "Kingsway", "GBP", 120);
  await invoice("inv-b", "acme-de", "Lager Nord GmbH", "EUR", 200);
});

const make = async (input: Record<string, unknown> = {}) =>
  handleCreateAgent(
    env.DB,
    "dan",
    { name: "Weekly payables", report: "outstanding_payables", orgIds: ["acme-uk", "acme-de"], schedule: MONDAY_8, ...input },
    SATURDAY
  );

const start = async (id: string) => handleUpdateAgent(env.DB, "dan", id, { status: "active" }, SATURDAY);

describe("who an agent goes to, and how", () => {
  it("goes to its author always, and to AP Managers chosen; never to anyone else", async () => {
    expect((await make({ recipients: ["pat"] })).body).toMatchObject({ reason: "recipient_not_manager" });
    expect((await make({ deliver: { task: false, email: false } })).body).toMatchObject({ reason: "deliver_missing" });
    const made = await make({ recipients: ["maya"], deliver: { task: true, email: true } });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({
      deliver: { task: true, email: true },
      recipients: [
        { id: "dan", name: "Dan", optedOut: false },
        { id: "maya", name: "Maya", optedOut: false },
      ],
    });
    const list = (await handleListAgents(env.DB, "dan", { emailReady: true })).body as { managers: { id: string }[]; emailReady: boolean };
    // Dan is the author, so only the other AP Managers are offered.
    expect(list.managers.map((m) => m.id)).toEqual(["maya"]);
    expect(list.emailReady).toBe(true);
  });

  it("gives each recipient their own copy: only the organisations they can see, gathered with their access", async () => {
    const id = ((await make({ recipients: ["maya"] })).body as { id: string }).id;
    await start(id);
    await runDueAgents(env.DB, MONDAY);
    const tableFor = async (user: string) => {
      const notes = ((await handleListAgentNotes(env.DB, user)).body as { notes: { id: string; canStop: boolean }[] }).notes;
      expect(notes).toHaveLength(1);
      return { note: notes[0], table: ((await handleGetAgentNote(env.DB, user, notes[0].id)).body as { table: ReportTable }).table };
    };
    const dan = await tableFor("dan");
    // The same due date: the larger total first.
    expect(dan.table.rows.map((r) => r.org)).toEqual(["Acme DE", "Acme UK"]);
    expect(dan.note.canStop).toBe(false);
    const maya = await tableFor("maya");
    expect(maya.table.rows.map((r) => r.org)).toEqual(["Acme UK"]);
    expect(maya.note.canStop).toBe(true);
    const runs = ((await handleListAgentRuns(env.DB, "dan", id)).body as { runs: { deliveries: { userName: string; channel: string; status: string }[] }[] }).runs;
    expect(runs[0].deliveries).toEqual([
      { userName: "Dan", channel: "task", status: "sent", error: null, summary: "no_ai" },
      { userName: "Maya", channel: "task", status: "sent", error: null, summary: "no_ai" },
    ]);
  });

  it("emails each in their own language, with the CSV, the copy kept, and a stop link for all but the author", async () => {
    const { sent, deps } = fakeEmail();
    const id = ((await make({ recipients: ["maya"], deliver: { task: false, email: true } })).body as { id: string }).id;
    await start(id);
    await runDueAgents(env.DB, MONDAY, deps);
    expect(sent.map((m) => m.to)).toEqual(["dan@acme.com", "maya@acme.com"]);
    const [toDan, toMaya] = sent;
    expect(toDan.subject).toMatch(/^Weekly payables · /);
    expect(toDan.text).toContain("Outstanding payables");
    expect(toDan.text).toContain("Lager Nord GmbH");
    expect(toDan.html).toContain("https://app.vibefinance-ai.com");
    expect(toDan.html).not.toContain("stopagent");
    expect(toMaya.text).toContain("Offene Verbindlichkeiten");
    expect(toMaya.text).not.toContain("Lager Nord GmbH");
    expect(toMaya.text).toContain("Auf die Organisationen beschränkt, die Sie sehen dürfen.");
    expect(toMaya.html).toContain(`https://app.vibefinance-ai.com/?stopagent=${id}`);
    const csv = new TextDecoder().decode(Uint8Array.from(atob(toMaya.attachments![0].content), (c) => c.charCodeAt(0)));
    expect(csv.split("\r\n")[0]).toBe("Organisation,Lieferant,Währung,Rechnungen,Noch nicht fällig,1–30 Tage,31–60 Tage,61–90 Tage,Über 90 Tage,Summe,Tage überfällig");
    expect(csv).toContain("Acme UK,Kingsway,GBP,1,0,0,120,0,0,120,34");
    // Nothing on the task list: email only.
    expect(((await handleListAgentNotes(env.DB, "dan")).body as { notes: unknown[] }).notes).toEqual([]);
    // The copy sent is kept.
    const copies = await env.DB.prepare("SELECT copy_key, message_id FROM agent_deliveries WHERE user_id = 'maya'").first<{ copy_key: string; message_id: string }>();
    expect(copies?.message_id).toBe("msg-2");
    const kept = await env.DOCUMENTS.get(copies!.copy_key);
    expect(JSON.parse(await kept!.text())).toMatchObject({ to: "maya@acme.com", subject: toMaya.subject });
  });

  it("says when email is not set up: the run fails if email was its only way, and is delivered where the task list was too", async () => {
    const emailOnly = ((await make({ deliver: { task: false, email: true } })).body as { id: string }).id;
    expect((await handleRunAgentNow(env.DB, "dan", emailOnly, MONDAY)).body).toMatchObject({ status: "failed", error: "email_not_configured" });
    const both = ((await make({ name: "Both", deliver: { task: true, email: true } })).body as { id: string }).id;
    expect((await handleRunAgentNow(env.DB, "dan", both, MONDAY)).body).toMatchObject({ status: "delivered", deliveries: 1 });
    const runs = ((await handleListAgentRuns(env.DB, "dan", both)).body as { runs: { error: string; deliveries: { channel: string; status: string; error: string | null }[] }[] }).runs;
    expect(runs[0].deliveries).toEqual([
      { userName: "Dan", channel: "task", status: "sent", error: null, summary: "no_ai" },
      { userName: "Dan", channel: "email", status: "failed", error: "email_not_configured", summary: "no_ai" },
    ]);
  });

  it("Run now goes to its author alone", async () => {
    const { sent, deps } = fakeEmail();
    const id = ((await make({ recipients: ["maya"], deliver: { task: true, email: true } })).body as { id: string }).id;
    await handleRunAgentNow(env.DB, "dan", id, MONDAY, deps);
    expect(sent.map((m) => m.to)).toEqual(["dan@acme.com"]);
    expect(((await handleListAgentNotes(env.DB, "maya")).body as { notes: unknown[] }).notes).toEqual([]);
  });
});

describe("stopping, and who stops getting it", () => {
  it("a recipient stops it for themselves; its author cannot, and someone not on it is told so", async () => {
    const id = ((await make({ recipients: ["maya"] })).body as { id: string }).id;
    await start(id);
    expect((await handleStopAgent(env.DB, "dan", id)).body).toMatchObject({ reason: "author_cannot_stop" });
    expect((await handleStopAgent(env.DB, "pat", id)).body).toMatchObject({ reason: "not_recipient" });
    expect((await handleStopAgent(env.DB, "maya", id)).body).toMatchObject({ stopped: true, name: "Weekly payables" });
    await runDueAgents(env.DB, MONDAY);
    expect(((await handleListAgentNotes(env.DB, "maya")).body as { notes: unknown[] }).notes).toEqual([]);
    expect(((await handleListAgentNotes(env.DB, "dan")).body as { notes: unknown[] }).notes).toHaveLength(1);
    // The author sees who stopped it; editing keeps it so.
    await handleUpdateAgent(env.DB, "dan", id, { name: "Renamed" }, SATURDAY);
    const agent = ((await handleListAgents(env.DB, "dan")).body as { agents: { recipients: { id: string; optedOut: boolean }[] }[] }).agents[0];
    expect(agent.recipients).toEqual([
      { id: "dan", name: "Dan", optedOut: false },
      { id: "maya", name: "Maya", optedOut: true },
    ]);
  });

  it("someone who is no longer an AP Manager gets nothing", async () => {
    const id = ((await make({ recipients: ["maya"] })).body as { id: string }).id;
    await start(id);
    await env.DB.prepare("UPDATE org_roles SET permissions_json = '[\"AP.Analysis\"]' WHERE id = 'r-maya'").run();
    await runDueAgents(env.DB, MONDAY);
    expect(((await handleListAgentNotes(env.DB, "maya")).body as { notes: unknown[] }).notes).toEqual([]);
  });

  it("the link in an email stops it through the router, for a recipient who makes no agents", async () => {
    const id = ((await make({ recipients: ["maya"] })).body as { id: string }).id;
    const key = generateApiKey();
    await env.DB.prepare("UPDATE org_users SET api_key_hash = ? WHERE id = 'maya'").bind(await hashApiKey(key)).run();
    const response = await worker.fetch(
      new Request(`https://vf.example/agents/${id}/stop`, { method: "POST", headers: { Authorization: `Bearer ${key}` } }),
      env as unknown as Env
    );
    expect(response.status).toBe(200);
  });
});

describe("kept for 13 months", () => {
  it("removes runs, deliveries, notes and copies older than that, and keeps the rest", async () => {
    const { deps } = fakeEmail();
    const id = ((await make({ deliver: { task: true, email: true } })).body as { id: string }).id;
    await handleRunAgentNow(env.DB, "dan", id, new Date("2025-08-01T08:00:00Z"), deps);
    await handleRunAgentNow(env.DB, "dan", id, MONDAY, deps);
    const oldKey = (await env.DB.prepare("SELECT d.copy_key FROM agent_deliveries d JOIN agent_runs r ON r.id = d.run_id WHERE r.started_at < '2026-01-01' AND d.copy_key IS NOT NULL").first<{ copy_key: string }>())!.copy_key;
    expect(await env.DOCUMENTS.get(oldKey)).not.toBeNull();
    expect(await purgeOldAgentRecords(env.DB, env.DOCUMENTS, MONDAY)).toEqual({ runs: 1 });
    expect(await env.DOCUMENTS.get(oldKey)).toBeNull();
    const left = await env.DB.prepare("SELECT (SELECT count(*) FROM agent_runs) AS runs, (SELECT count(*) FROM agent_deliveries) AS deliveries, (SELECT count(*) FROM agent_notes) AS notes").first();
    expect(left).toEqual({ runs: 1, deliveries: 2, notes: 1 });
  });
});

describe("the email itself", () => {
  const table: ReportTable = {
    report: "possible_duplicates",
    columns: [
      { key: "invoice", label: "agents.col.invoice", kind: "text" },
      { key: "total", label: "agents.col.total", kind: "money" },
    ],
    rows: Array.from({ length: 205 }, (_, i) => ({ invoice: i === 0 ? "=HYPERLINK(\"x\")" : `INV-${i}`, total: 1234.5 })),
    totals: [{ currency: "GBP", total: 253072.5, count: 205 }],
    skippedOrgs: ["Acme FR"],
    asAt: "2026-10-05T07:00:00.000Z",
  };

  it("shows at most 200 rows and sends the rest in the CSV, which never carries a formula", () => {
    const built = buildAgentEmail({ locale: "en", agentName: "Dupes", authorName: "Dan", table, timeZone: "Europe/London", appUrl: null, stopUrl: null, filtered: false });
    expect(built.text).toContain("5 more rows are in the attached CSV.");
    expect(built.text).toContain("Left out, as the agent's author can no longer see them: Acme FR.");
    expect(built.html).toContain("1,234.50");
    expect(built.html).not.toContain("<script");
    expect(built.filename).toBe("Dupes-2026-10-05.csv");
    const csv = reportCsv("en", table);
    expect(csv.split("\r\n")[1]).toBe(`"'=HYPERLINK(""x"")",1234.5`);
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(206);
  });

  it("escapes what a name could carry into the HTML", () => {
    const built = buildAgentEmail({ locale: "de", agentName: "<b>Mine</b>", authorName: "Dan", table: { ...table, rows: table.rows.slice(1, 2) }, timeZone: "Europe/Berlin", appUrl: null, stopUrl: null, filtered: false });
    expect(built.html).toContain("&lt;b&gt;Mine&lt;/b&gt;");
    expect(built.html).toContain("1.234,50");
  });
});
