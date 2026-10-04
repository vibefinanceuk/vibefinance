import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import {
  checkOptions,
  handleCreateAgent,
  handleGetAgentNote,
  handleListAgentNotes,
  handleListAgents,
  handleRunAgentNow,
  handleUpdateAgent,
  type AgentDeps,
  type ReportTable,
} from "../src/agents.js";
import { buildAgentEmail, compareWith } from "../src/agent-email.js";
import type { SendEmailInput } from "../src/resend-client.js";

/**
 * Agents, slice 3: shape and the new reports — decision 0624. "Now" is
 * Monday 5 October 2026. Acme UK; a process of Approval and Payment-eligible.
 */

const NOW = new Date("2026-10-05T07:00:00Z");
const MONDAY_8 = { every: "week", time: "08:00", weekday: 1 };

async function person(id: string, name: string, permissions: string[]) {
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES (?, ?, ?)").bind(id, `${id}@acme.com`, name).run();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)").bind(`r-${id}`, id, JSON.stringify(permissions)).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES (?, ?, NULL)").bind(id, `r-${id}`).run();
}

async function invoice(id: string, opts: { supplier: string; total: number; due: string | null; stage?: string; status?: string; currency?: string }) {
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, org_unit_id, invoice_number, currency, total_with_vat) VALUES (?, ?, 'acme-uk', ?, ?, ?)")
    .bind(id, JSON.stringify({ "BT-1": id.toUpperCase(), ...(opts.due ? { "BT-9": opts.due } : {}), "BT-27": opts.supplier }), id.toUpperCase(), opts.currency ?? "GBP", opts.total)
    .run();
  await env.DB.prepare("INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES (?, 'ap', 'invoice', ?, ?, ?)")
    .bind(`pi-${id}`, id, opts.stage ?? "eligible", opts.status ?? "completed")
    .run();
}

async function task(id: string, invoiceId: string, createdAt: string, claimedBy: string | null) {
  await env.DB.prepare("INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome) VALUES (?, ?, 'approval', 'matched')").bind(`sv-${id}`, `pi-${invoiceId}`).run();
  await env.DB.prepare(
    "INSERT INTO tasks (id, stage_id, stage_visit_id, owner_team_id, claimed_by, required_permission, status, created_at) VALUES (?, 'approval', ?, NULL, ?, 'AP.Approve', 'open', ?)"
  )
    .bind(id, `sv-${id}`, claimedBy, createdAt)
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_units (id, name, kind) VALUES ('acme-uk', 'Acme UK', 'legal_entity')").run();
  await person("dan", "Dan", ["AP.Agents", "AP.Manager", "AP.Analysis"]);
  await person("maya", "Maya", ["AP.Approve"]);
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
  await env.DB.prepare("INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('approval', 'ap', 'Approval', 1), ('eligible', 'ap', 'Payment-eligible', 2)").run();
});

const make = async (input: Record<string, unknown>) =>
  ((await handleCreateAgent(env.DB, "dan", { name: "A", orgIds: ["acme-uk"], schedule: MONDAY_8, ...input }, NOW)).body as { id: string; options: Record<string, number> });

async function runTable(id: string, at = NOW, deps?: AgentDeps): Promise<ReportTable> {
  await handleRunAgentNow(env.DB, "dan", id, at, deps);
  const notes = ((await handleListAgentNotes(env.DB, "dan")).body as { notes: { id: string; agentId: string }[] }).notes.filter((n) => n.agentId === id);
  return ((await handleGetAgentNote(env.DB, "dan", notes[0].id)).body as { table: ReportTable }).table;
}

describe("options", () => {
  it("each report takes its own, with defaults, and refuses what is out of range", () => {
    expect(checkOptions("outstanding_payables", {})).toEqual({ options: { highlightDays: 60 } });
    expect(checkOptions("outstanding_payables", { minTotal: "1000.555", withinDays: 3 })).toEqual({ options: { minTotal: 1000.56, highlightDays: 60 } });
    expect(checkOptions("outstanding_payables", { minTotal: -1 })).toEqual({ reason: "option_invalid_mintotal" });
    expect(checkOptions("due_soon_not_eligible", {})).toEqual({ options: { withinDays: 7 } });
    expect(checkOptions("due_soon_not_eligible", { withinDays: 0 })).toEqual({ reason: "option_invalid_withindays" });
    expect(checkOptions("stuck_work", { olderThanDays: 1.5 })).toEqual({ reason: "option_invalid_olderthandays" });
    expect(checkOptions("accruals", { minTotal: 5 })).toEqual({ options: {} });
  });

  it("are kept on the agent, offered with the reports, and kept when editing something else", async () => {
    const made = await make({ report: "outstanding_payables", options: { minTotal: 500, highlightDays: 30 } });
    expect(made.options).toEqual({ minTotal: 500, highlightDays: 30 });
    await handleUpdateAgent(env.DB, "dan", made.id, { name: "Renamed" }, NOW);
    const listed = (await handleListAgents(env.DB, "dan")).body as { agents: { options: unknown }[]; reports: { id: string; optionKeys: string[]; options: unknown }[] };
    expect(listed.agents[0].options).toEqual({ minTotal: 500, highlightDays: 30 });
    expect(listed.reports.find((r) => r.id === "stuck_work")).toMatchObject({ optionKeys: ["olderThanDays"], options: { olderThanDays: 5 } });
    expect((await handleCreateAgent(env.DB, "dan", { name: "B", report: "stuck_work", orgIds: ["acme-uk"], schedule: MONDAY_8, options: { olderThanDays: 0 } }, NOW)).body).toMatchObject({
      reason: "option_invalid_olderthandays",
    });
  });
});

describe("outstanding payables, aged", () => {
  beforeEach(async () => {
    await invoice("a1", { supplier: "Kingsway", total: 100, due: "2026-10-10" }); // not yet due
    await invoice("a2", { supplier: "Kingsway", total: 200, due: "2026-09-20" }); // 15 days
    await invoice("a3", { supplier: "Kingsway", total: 300, due: "2026-08-20" }); // 46 days
    await invoice("a4", { supplier: "Kingsway", total: 400, due: "2026-07-20" }); // 77 days
    await invoice("a5", { supplier: "Kingsway", total: 500, due: "2026-05-01" }); // 157 days
    await invoice("b1", { supplier: "Brightwell", total: 50, due: null }); // no due date: not yet due
  });

  it("splits each supplier's total by days past due, oldest first, and highlights past the limit", async () => {
    const id = (await make({ report: "outstanding_payables" })).id;
    const table = await runTable(id);
    expect(table.rows).toEqual([
      { org: "Acme UK", supplier: "Kingsway", currency: "GBP", invoices: 5, notDue: 100, d30: 200, d60: 300, d90: 400, d90plus: 500, total: 1500, daysPastDue: 157, _ids: "a1,a2,a3,a4,a5", _highlight: 1 },
      { org: "Acme UK", supplier: "Brightwell", currency: "GBP", invoices: 1, notDue: 50, d30: 0, d60: 0, d90: 0, d90plus: 0, total: 50, daysPastDue: 0, _ids: "b1" },
    ]);
    expect(table.totals).toEqual([{ currency: "GBP", total: 1550, count: 6 }]);
    expect(table.options).toEqual({ highlightDays: 60 });
  });

  it("keeps only suppliers owing at least the amount chosen, and says so in the email", async () => {
    const sent: SendEmailInput[] = [];
    const deps: AgentDeps = { email: { apiKey: "k", from: "a@b.c" }, appUrl: null, bucket: null, send: async (_k, input) => (sent.push(input), { ok: true, messageId: "m" }) };
    const id = (await make({ report: "outstanding_payables", options: { minTotal: 100 }, deliver: { task: true, email: true } })).id;
    const table = await runTable(id, NOW, deps);
    expect(table.rows.map((r) => r.supplier)).toEqual(["Kingsway"]);
    expect(table.totals).toEqual([{ currency: "GBP", total: 1500, count: 5 }]);
    expect(sent[0].text).toContain("Only suppliers owing at least 100.00.");
    expect(sent[0].text).toContain("Highlighted: oldest more than 60 days past due.");
    expect(sent[0].html).toContain("color:#9c2b1f;font-weight:700");
  });
});

describe("due soon, not yet payment-eligible", () => {
  it("lists invoices short of payment-eligible due within the days chosen, soonest first, two days or less highlighted", async () => {
    await invoice("d1", { supplier: "Kingsway", total: 100, due: "2026-10-06", stage: "approval", status: "in_progress" }); // 1 day
    await invoice("d2", { supplier: "Brightwell", total: 200, due: "2026-10-09", stage: "approval", status: "in_progress" }); // 4 days
    await invoice("d3", { supplier: "Brightwell", total: 300, due: "2026-10-15", stage: "approval", status: "in_progress" }); // 10 days
    await invoice("d4", { supplier: "Kingsway", total: 400, due: "2026-10-01", stage: "approval", status: "in_progress" }); // already past
    await invoice("d5", { supplier: "Kingsway", total: 500, due: "2026-10-06" }); // already payment-eligible
    const week = (await make({ report: "due_soon_not_eligible" })).id;
    const table = await runTable(week);
    expect(table.rows).toEqual([
      { org: "Acme UK", invoiceId: "d1", invoice: "D1", supplier: "Kingsway", stage: "Approval", due: "2026-10-06", daysToDue: 1, total: 100, currency: "GBP", _highlight: 1 },
      { org: "Acme UK", invoiceId: "d2", invoice: "D2", supplier: "Brightwell", stage: "Approval", due: "2026-10-09", daysToDue: 4, total: 200, currency: "GBP" },
    ]);
    const fortnight = (await make({ name: "Fortnight", report: "due_soon_not_eligible", options: { withinDays: 14 } })).id;
    expect((await runTable(fortnight)).rows.map((r) => r.invoice)).toEqual(["D1", "D2", "D3"]);
  });
});

describe("stuck work", () => {
  it("counts tasks open longer than the days chosen, by stage and who has them, oldest first", async () => {
    await invoice("s1", { supplier: "Kingsway", total: 1, due: null, stage: "approval", status: "in_progress" });
    await task("t1", "s1", "2026-09-22 09:00:00", "maya"); // 13 days
    await task("t2", "s1", "2026-09-28 09:00:00", "maya"); // 7 days
    await task("t3", "s1", "2026-09-29 09:00:00", null); // 6 days, unclaimed
    await task("t4", "s1", "2026-10-03 09:00:00", "maya"); // 2 days: too recent
    const id = (await make({ report: "stuck_work" })).id;
    const table = await runTable(id);
    expect(table.rows).toEqual([
      { org: "Acme UK", stage: "Approval", person: "Maya", open: 2, oldestDays: 13, _ids: "s1", _highlight: 1 },
      { org: "Acme UK", stage: "Approval", person: null, open: 1, oldestDays: 6, _ids: "s1" },
    ]);
    expect(table.totals).toEqual([{ currency: null, total: null, count: 3 }]);
  });
});

describe("compared with the last report", () => {
  it("carries what each person was last sent, and says up, down or no change", async () => {
    await invoice("c1", { supplier: "Kingsway", total: 100, due: "2026-09-01" });
    const id = (await make({ report: "outstanding_payables" })).id;
    const first = await runTable(id);
    expect(first.previous).toBeNull();
    await invoice("c2", { supplier: "Kingsway", total: 50, due: "2026-09-01" });
    await env.DB.prepare("UPDATE agent_notes SET done_at = '2026-10-05'").run();
    const second = await runTable(id, new Date("2026-10-12T07:00:00Z"));
    expect(second.previous).toEqual([{ currency: "GBP", total: 100, count: 1 }]);
    const built = buildAgentEmail({ locale: "en", agentName: "A", authorName: "Dan", table: second, timeZone: "Europe/London", appUrl: null, stopUrl: null, filtered: false });
    expect(built.text).toContain("150.00 GBP (2 invoices), up 50.00 since the last report");
  });

  it("says each way in words, counts included", () => {
    expect(compareWith("en", { currency: "GBP", total: 80, count: 1 }, [{ currency: "GBP", total: 100, count: 2 }])).toBe("down 20.00 since the last report");
    expect(compareWith("de", { currency: "EUR", total: 100, count: 1 }, [{ currency: "EUR", total: 100, count: 1 }])).toBe("unverändert seit dem letzten Bericht");
    expect(compareWith("en", { currency: null, total: null, count: 5 }, [{ currency: null, total: null, count: 3 }])).toBe("up 2 since the last report");
    expect(compareWith("en", { currency: "USD", total: 10, count: 1 }, [])).toBe("up 10.00 since the last report");
    expect(compareWith("en", { currency: "GBP", total: 10, count: 1 }, null)).toBe("");
  });
});
