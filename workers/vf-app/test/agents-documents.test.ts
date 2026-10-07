import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCreateAgent, handleListAgentNotes, handleUpdateAgent, runDueAgents, type AgentDeps } from "../src/agents.js";
import { handleListDocuments } from "../src/documents-route.js";
import type { SendEmailInput } from "../src/resend-client.js";

/**
 * Agents phase 2, slice 2: Open in Documents — decision 0629. Dan sees
 * Acme UK and Acme DE; Maya, an AP Manager, Acme UK only. Kingsway (UK)
 * has two invoices outstanding, Lager Nord (DE) one.
 */

const MONDAY_8 = { every: "week", time: "08:00", weekday: 1 };
const SATURDAY = new Date("2026-10-03T12:00:00Z");
const MONDAY = new Date("2026-10-05T07:00:00Z");

async function person(id: string, name: string, permissions: string[], unit: string | null) {
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES (?, ?, ?)").bind(id, `${id}@acme.com`, name).run();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)").bind(`r-${id}`, id, JSON.stringify(permissions)).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES (?, ?, ?)").bind(id, `r-${id}`, unit).run();
}

async function invoice(id: string, unit: string, supplier: string, currency: string, total: number) {
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, org_unit_id) VALUES (?1, json_set(?2, '$.BT-1', ?4, '$.BT-5', ?5, '$.BT-112', ?6), ?3)")
    .bind(id, JSON.stringify({ "BT-1": id, "BT-9": "2026-09-01", "BT-27": supplier }), unit, id, currency, total)
    .run();
  await env.DB.prepare("INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES (?, 'ap', 'invoice', ?, 'eligible', 'completed')")
    .bind(`pi-${id}`, id)
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_units (id, name, kind) VALUES ('acme-uk', 'Acme UK', 'legal_entity'), ('acme-de', 'Acme DE', 'legal_entity')").run();
  await person("dan", "Dan", ["AP.Agents", "AP.Manager", "AP.Analysis"], null);
  await person("maya", "Maya", ["AP.Manager", "AP.Analysis"], "acme-uk");
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
  await env.DB.prepare("INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('approval', 'ap', 'Approval', 1), ('eligible', 'ap', 'Payment-eligible', 2)").run();
  await invoice("inv-a", "acme-uk", "Kingsway", "GBP", 120);
  await invoice("inv-c", "acme-uk", "Kingsway", "GBP", 30);
  await invoice("inv-b", "acme-de", "Lager Nord GmbH", "EUR", 200);
});

async function scheduled(deliver: { task: boolean; email: boolean }, deps?: AgentDeps) {
  const made = await handleCreateAgent(env.DB, "dan", { name: "Weekly payables", report: "outstanding_payables", orgIds: ["acme-uk", "acme-de"], schedule: MONDAY_8, recipients: ["maya"], deliver }, SATURDAY);
  const id = (made.body as { id: string }).id;
  await handleUpdateAgent(env.DB, "dan", id, { status: "active" }, SATURDAY);
  await runDueAgents(env.DB, MONDAY, deps);
  return id;
}

const documentsAt = async (userId: string, query: Record<string, string>) => {
  const r = await handleListDocuments(env.DB, new URLSearchParams(query), null, userId);
  const body = r.body as { documents: { id: string }[]; agent?: { name: string | null } };
  return { ids: body.documents.map((d) => d.id).sort(), agent: body.agent };
};

describe("Open in Documents from a note on the task list", () => {
  it("opens at every invoice behind the report, or one row's, for its own reader only", async () => {
    await scheduled({ task: true, email: false });
    const danNote = ((await handleListAgentNotes(env.DB, "dan")).body as { notes: { id: string }[] }).notes[0].id;
    expect(await documentsAt("dan", { agentNote: danNote })).toEqual({ ids: ["inv-a", "inv-b", "inv-c"], agent: { name: "Weekly payables" } });
    // Equally past due, the larger first: row 0 is Lager Nord, row 1 Kingsway's two.
    expect((await documentsAt("dan", { agentNote: danNote, agentRow: "0" })).ids).toEqual(["inv-b"]);
    expect((await documentsAt("dan", { agentNote: danNote, agentRow: "1" })).ids).toEqual(["inv-a", "inv-c"]);
    expect((await documentsAt("dan", { agentNote: danNote, agentRow: "9" })).ids).toEqual([]);
    // Maya's own copy holds only what she may see.
    const mayaNote = ((await handleListAgentNotes(env.DB, "maya")).body as { notes: { id: string }[] }).notes[0].id;
    expect((await documentsAt("maya", { agentNote: mayaNote })).ids).toEqual(["inv-a", "inv-c"]);
    // Someone else's note opens nothing, not everything.
    expect(await documentsAt("maya", { agentNote: danNote })).toEqual({ ids: [], agent: { name: null } });
  });
});

describe("Open in Documents from the email", () => {
  it("links each copy to its own invoices, for the person it was sent to", async () => {
    const sent: SendEmailInput[] = [];
    const deps: AgentDeps = {
      email: { apiKey: "re_test", from: "agents@vibefinance-ai.com" },
      appUrl: "https://app.vibefinance-ai.com",
      bucket: null,
      send: async (_k, input) => (sent.push(input), { ok: true, messageId: `m-${sent.length}` }),
    };
    await scheduled({ task: false, email: true }, deps);
    const link = (to: string) => {
      const e = sent.find((x) => x.to === to)!;
      expect(e.html).toContain("Open these invoices in Documents");
      return /\?agentdocs=([^\s"&<]+)/.exec(e.text)![1];
    };
    const danCopy = link("dan@acme.com");
    const mayaCopy = link("maya@acme.com");
    expect((await documentsAt("dan", { agentDelivery: danCopy })).ids).toEqual(["inv-a", "inv-b", "inv-c"]);
    expect(await documentsAt("maya", { agentDelivery: mayaCopy })).toEqual({ ids: ["inv-a", "inv-c"], agent: { name: "Weekly payables" } });
    expect((await documentsAt("maya", { agentDelivery: danCopy })).ids).toEqual([]);
  });

  it("keeps the plain link where there are no invoices to open", async () => {
    const sent: SendEmailInput[] = [];
    const deps: AgentDeps = {
      email: { apiKey: "re_test", from: "agents@vibefinance-ai.com" },
      appUrl: "https://app.vibefinance-ai.com",
      bucket: null,
      send: async (_k, input) => (sent.push(input), { ok: true, messageId: "m" }),
    };
    const made = await handleCreateAgent(env.DB, "dan", { name: "Accruals", report: "accruals", orgIds: ["acme-uk"], schedule: MONDAY_8, deliver: { task: false, email: true } }, SATURDAY);
    await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, org_unit_id) VALUES ('acc-1', json_set('{}', '$.BT-1', 'acc-1', '$.BT-5', 'GBP', '$.BT-112', 10), 'acme-uk')").run();
    await env.DB.prepare("INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES ('pi-acc-1', 'ap', 'invoice', 'acc-1', 'approval', 'in_progress')").run();
    await handleUpdateAgent(env.DB, "dan", (made.body as { id: string }).id, { status: "active" }, SATURDAY);
    await runDueAgents(env.DB, MONDAY, deps);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).not.toContain("agentdocs");
    expect(sent[0].text).toContain("Open VibeFinance: https://app.vibefinance-ai.com");
  });
});
