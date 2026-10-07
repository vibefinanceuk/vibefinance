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
import { readNumber, strayNumber, takeSummary } from "../src/agent-summary.js";
import type { SendEmailInput } from "../src/resend-client.js";

/**
 * Agents, slice 5: the AI summary — decision 0626. Dan sees Acme UK and
 * Acme DE; Maya, an AP Manager in Acme UK only, reads German; Sam, an AP
 * Manager everywhere, reads English. Acme UK owes Kingsway GBP 120;
 * Acme DE owes Lager Nord 24 GmbH EUR 200. The model is a stand-in.
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
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, org_unit_id) VALUES (?1, json_set(?2, '$.BT-1', ?4, '$.BT-5', ?5, '$.BT-112', ?6), ?3)")
    .bind(id, JSON.stringify({ "BT-1": id, "BT-9": "2026-09-01", "BT-27": supplier }), unit, id, currency, total)
    .run();
  await env.DB.prepare("INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES (?, 'ap', 'invoice', ?, 'eligible', 'completed')")
    .bind(`pi-${id}`, id)
    .run();
}

/** A stand-in model: answers by the language it is asked for, and keeps the prompts. */
function model(answer: (prompt: string) => string): CompilerModel & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    compile: async (prompt: string) => {
      prompts.push(prompt);
      return answer(prompt);
    },
  };
}

function deps(m: CompilerModel | null) {
  const sent: SendEmailInput[] = [];
  const d: AgentDeps = {
    email: { apiKey: "re_test", from: "agents@vibefinance-ai.com" },
    appUrl: "https://app.vibefinance-ai.com",
    bucket: env.DOCUMENTS,
    send: async (_key, input) => {
      sent.push(input);
      return { ok: true, messageId: `msg-${sent.length}` };
    },
    model: m,
  };
  return { sent, deps: d };
}

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_units (id, name, kind) VALUES ('acme-uk', 'Acme UK', 'legal_entity'), ('acme-de', 'Acme DE', 'legal_entity')").run();
  await person("dan", "Dan", ["AP.Agents", "AP.Manager", "AP.Analysis"], null);
  await person("maya", "Maya", ["AP.Manager", "AP.Analysis"], "acme-uk", "de");
  await person("sam", "Sam", ["AP.Manager", "AP.Analysis"], null, "en");
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
  await env.DB.prepare("INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('approval', 'ap', 'Approval', 1), ('eligible', 'ap', 'Payment-eligible', 2)").run();
  await invoice("inv-a", "acme-uk", "Kingsway", "GBP", 120);
  await invoice("inv-b", "acme-de", "Lager Nord 24 GmbH", "EUR", 200);
});

const make = async (input: Record<string, unknown> = {}) => {
  const made = await handleCreateAgent(
    env.DB,
    "dan",
    { name: "Weekly payables", report: "outstanding_payables", orgIds: ["acme-uk", "acme-de"], schedule: MONDAY_8, deliver: { task: true, email: true }, ...input },
    SATURDAY,
  );
  const id = (made.body as { id: string }).id;
  await handleUpdateAgent(env.DB, "dan", id, { status: "active" }, SATURDAY);
  return id;
};

const deliveries = async (id: string) =>
  ((await handleListAgentRuns(env.DB, "dan", id)).body as { runs: { deliveries: { userName: string; channel: string; summary: string | null }[] }[] }).runs[0].deliveries;

const noteTable = async (user: string) => {
  const notes = ((await handleListAgentNotes(env.DB, user)).body as { notes: { id: string }[] }).notes;
  return ((await handleGetAgentNote(env.DB, user, notes[0].id)).body as { table: ReportTable }).table;
};

const GOOD = (prompt: string) =>
  prompt.includes("in German")
    ? "Offen sind 120,00 GBP bei Kingsway in 1 Zeile."
    : "Kingsway is owed 120.00 GBP and Lager Nord 24 GmbH 200.00 EUR, 2 rows in all, 34 days past due.";

describe("the check: every number must be the table's", () => {
  const table: ReportTable = {
    report: "outstanding_payables",
    columns: [
      { key: "supplier", label: "agents.col.supplier", kind: "text" },
      { key: "total", label: "agents.col.total", kind: "money" },
      { key: "daysPastDue", label: "agents.col.dayspastdue", kind: "days" },
    ],
    rows: [
      { supplier: "Lager Nord 24 GmbH", total: 1234.5, daysPastDue: 71, _highlight: 1 },
      { supplier: "Kingsway", total: 99.99, daysPastDue: 3 },
    ],
    totals: [{ currency: "EUR", total: 1334.49, count: 2 }],
    previous: [{ currency: "EUR", total: 1000, count: 1 }],
    skippedOrgs: [],
    asAt: "2026-10-05T07:00:00Z",
  };

  it("reads numbers as each language writes them", () => {
    expect(readNumber("1,234.50", "en")).toBe(1234.5);
    expect(readNumber("1.234,50", "de")).toBe(1234.5);
    expect(readNumber("120,00", "de")).toBe(120);
  });

  it("allows cells, totals, counts, the change since last time, and a whole-number rounding", () => {
    expect(strayNumber("Lager Nord 24 GmbH owes 1,234.50, 71 days past due; 1 row is highlighted.", table, "en")).toBeNull();
    expect(strayNumber("In all 1,334.49 EUR on 2 rows, up 334.49 from 1,000.00; about 1,235 from Lager Nord 24 GmbH.", table, "en")).toBeNull();
    expect(strayNumber("Insgesamt 1.334,49 EUR, davon 99,99 bei Kingsway.", table, "de")).toBeNull();
  });

  it("names the first number that is not there: a sum, a percentage, a year, a date", () => {
    expect(strayNumber("Together 1,334.50 EUR.", table, "en")).toBe("1,334.50");
    expect(strayNumber("Up 33% since last week.", table, "en")).toBe("33");
    expect(strayNumber("The highest in 2026.", table, "en")).toBe("2026");
    expect(strayNumber("As at 5 October.", table, "en")).toBe("5");
  });
});

describe("the summary on each copy", () => {
  it("writes one in each reader's language from their own copy, on top of the email and the task", async () => {
    const m = model(GOOD);
    const { sent, deps: d } = deps(m);
    const id = await make({ recipients: ["maya"] });
    await runDueAgents(env.DB, MONDAY, d);

    expect(m.prompts).toHaveLength(2);
    const [english, german] = [m.prompts.find((p) => p.includes("in English"))!, m.prompts.find((p) => p.includes("in German"))!];
    expect(english).toContain("Lager Nord 24 GmbH");
    // Maya's copy is Acme UK only, so the model never sees Acme DE's numbers for her.
    expect(german).toContain("Kingsway");
    expect(german).not.toContain("Lager Nord");
    expect(german).toContain('"120,00"');

    const toDan = sent.find((e) => e.to === "dan@acme.com")!;
    expect(toDan.text).toContain("Summary, written by AI from the table below:\nKingsway is owed 120.00 GBP");
    expect(toDan.html).toContain("Summary, written by AI from the table below");
    const toMaya = sent.find((e) => e.to === "maya@acme.com")!;
    expect(toMaya.text).toContain("Zusammenfassung, von KI aus der Tabelle unten geschrieben:\nOffen sind 120,00 GBP");

    expect((await noteTable("maya")).summary).toBe("Offen sind 120,00 GBP bei Kingsway in 1 Zeile.");
    expect((await deliveries(id)).map((x) => [x.userName, x.channel, x.summary])).toEqual([
      ["Dan", "task", "written"],
      ["Dan", "email", "written"],
      ["Maya", "task", "written"],
      ["Maya", "email", "written"],
    ]);
  });

  it("writes the same copy once: two readers with the same table and language", async () => {
    const m = model(GOOD);
    const id = await make({ recipients: ["sam"], deliver: { task: true, email: false } });
    await runDueAgents(env.DB, MONDAY, deps(m).deps);
    expect(m.prompts).toHaveLength(1);
    expect((await deliveries(id)).map((x) => x.summary)).toEqual(["written", "written"]);
    const list = (await handleListAgents(env.DB, "dan", { now: MONDAY, aiReady: true })).body as { summaries: { used: number; max: number }; aiReady: boolean };
    expect(list.summaries).toEqual({ used: 1, max: 100 });
    expect(list.aiReady).toBe(true);
  });

  it("drops a summary with a number not in the table, and still sends the report", async () => {
    const { sent, deps: d } = deps(model(() => "Altogether 320.00 owed across 2 rows."));
    const id = await make();
    await runDueAgents(env.DB, MONDAY, d);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).not.toContain("Summary, written by AI");
    expect((await noteTable("dan")).summary).toBeNull();
    expect((await deliveries(id)).map((x) => x.summary)).toEqual(["mismatch", "mismatch"]);
  });

  it("goes without, and says why: the AI down, no AI here, the day's summaries used", async () => {
    const down = await make();
    await runDueAgents(env.DB, MONDAY, deps({ compile: async () => Promise.reject(new Error("down")) }).deps);
    expect((await deliveries(down)).map((x) => x.summary)).toEqual(["ai_unavailable", "ai_unavailable"]);

    const pauseAll = () => env.DB.prepare("UPDATE agents SET status = 'paused', next_run_at = NULL").run();
    await pauseAll();
    const none = await make();
    await runDueAgents(env.DB, MONDAY, deps(null).deps);
    expect((await deliveries(none)).map((x) => x.summary)).toEqual(["no_ai", "no_ai"]);

    await env.DB.prepare("INSERT INTO agent_ai_days (day, summaries) VALUES ('2026-10-05', 100) ON CONFLICT(day) DO UPDATE SET summaries = 100").run();
    await pauseAll();
    const m = model(GOOD);
    const full = await make();
    await runDueAgents(env.DB, MONDAY, deps(m).deps);
    expect(m.prompts).toHaveLength(0);
    expect((await deliveries(full)).map((x) => x.summary)).toEqual(["over_budget", "over_budget"]);
  });

  it("counts each day's summaries against the limit, one at a time", async () => {
    expect(await takeSummary(env.DB, 2, MONDAY)).toBe(true);
    expect(await takeSummary(env.DB, 2, MONDAY)).toBe(true);
    expect(await takeSummary(env.DB, 2, MONDAY)).toBe(false);
    // A new day starts again; a limit of 0 writes none.
    expect(await takeSummary(env.DB, 2, new Date("2026-10-06T07:00:00Z"))).toBe(true);
    expect(await takeSummary(env.DB, 0, new Date("2026-10-07T07:00:00Z"))).toBe(false);
  });

  it("can be turned off: no model call, said on each delivery, and a new plan version", async () => {
    const m = model(GOOD);
    const id = await make({ summary: false });
    const listed = (await handleListAgents(env.DB, "dan")).body as { agents: { id: string; summary: boolean; planVersion: number }[] };
    expect(listed.agents.find((a) => a.id === id)).toMatchObject({ summary: false, planVersion: 1 });
    await runDueAgents(env.DB, MONDAY, deps(m).deps);
    expect(m.prompts).toHaveLength(0);
    expect((await deliveries(id)).map((x) => x.summary)).toEqual(["off", "off"]);
    // Back on: the plan changed.
    const on = (await handleUpdateAgent(env.DB, "dan", id, { summary: true }, MONDAY)).body as { summary: boolean; planVersion: number };
    expect(on).toMatchObject({ summary: true, planVersion: 2 });
  });
});
