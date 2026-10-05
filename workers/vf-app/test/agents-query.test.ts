import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleAgentCatalogue, handleCreateAgent, handleGetAgentNote, handleListAgentNotes, handleRunAgentNow, handleTryAgentQuery, type ReportTable } from "../src/agents.js";
import { checkQuery, runQuery, type AgentQuery } from "../src/agent-query.js";
import { buildAgentEmail } from "../src/agent-email.js";

/**
 * Agents: asking the data, slice 1 — decision 0633. Acme has a UK and a
 * German company. Dan may analyse both; Uma only the UK. Kingsway (GBP)
 * and Lager Nord (EUR, and GBP in Germany) have invoices of all sizes.
 * Today is Monday 5 October.
 */

const MONDAY = new Date("2026-10-05T11:10:00Z");
const NEXT_MONDAY = new Date("2026-10-12T11:10:00Z");

async function person(id: string, name: string, permissions: string[], unit: string | null) {
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES (?, ?, ?)").bind(id, `${id}@acme.com`, name).run();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)").bind(`r-${id}`, id, JSON.stringify(permissions)).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES (?, ?, ?)").bind(id, `r-${id}`, unit).run();
}

async function invoice(id: string, o: { unit: string; number: string; supplier: string; total: number; currency: string; status?: string; received?: string; due?: string }) {
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, org_unit_id, invoice_number, currency, total_with_vat, issue_date, supplier_id, created_at) VALUES (?, ?, ?, ?, ?, ?, '2026-09-28', ?, ?)")
    .bind(id, JSON.stringify({ "BT-1": o.number, "BT-9": o.due ?? "2026-10-28" }), o.unit, o.number, o.currency, o.total, o.supplier, o.received ?? "2026-10-01 09:00:00")
    .run();
  await env.DB.prepare("INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES (?, 'ap', 'invoice', ?, 'approval', ?)")
    .bind(`pi-${id}`, id, o.status ?? "in_progress")
    .run();
  await env.DB.prepare("INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome, created_at) VALUES (?, ?, 'approval', 'matched', '2026-10-01 10:00:00')").bind(`sv-${id}`, `pi-${id}`).run();
}

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_units (id, name, kind) VALUES ('acme-uk', 'Acme UK Ltd', 'legal_entity'), ('acme-de', 'Acme GmbH', 'legal_entity')").run();
  await env.DB.prepare("INSERT INTO org_units (id, name, kind, parent_unit_id) VALUES ('ap-uk', 'AP UK', 'operating_unit', 'acme-uk'), ('ap-de', 'AP DE', 'operating_unit', 'acme-de')").run();
  await person("dan", "Dan Young", ["AP.Agents", "AP.Manager", "AP.Analysis"], null);
  await person("uma", "Uma Becker", ["AP.Agents", "AP.Manager", "AP.Analysis"], "acme-uk");
  await person("ned", "Ned", ["AP.Agents"], null);
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
  await env.DB.prepare("INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('approval', 'ap', 'Approval', 1)").run();
  await env.DB.prepare("INSERT INTO suppliers (id, name) VALUES ('sup-kw', 'Kingsway'), ('sup-ln', 'Lager Nord GmbH')").run();
  await invoice("uk-big", { unit: "ap-uk", number: "K-100", supplier: "sup-kw", total: 150000, currency: "GBP" });
  await invoice("uk-small", { unit: "ap-uk", number: "K-101", supplier: "sup-kw", total: 900, currency: "GBP" });
  await invoice("uk-eur", { unit: "ap-uk", number: "LN-7", supplier: "sup-ln", total: 200000, currency: "EUR" });
  await invoice("uk-done", { unit: "ap-uk", number: "K-99", supplier: "sup-kw", total: 120000, currency: "GBP", status: "completed" });
  await invoice("de-big", { unit: "ap-de", number: "LN-8", supplier: "sup-ln", total: 300000, currency: "GBP" });
  // Two open tasks, one Uma's at the UK invoice, one Dan's in Germany.
  await env.DB.prepare("INSERT INTO tasks (id, stage_id, stage_visit_id, owner_user_id, required_permission, status, created_at) VALUES ('t-uk', 'approval', 'sv-uk-big', 'uma', 'AP.Approve', 'open', '2026-09-30 09:00:00'), ('t-de', 'approval', 'sv-de-big', 'dan', 'AP.Approve', 'open', '2026-10-02 09:00:00')").run();
});

const UK = { id: "acme-uk", name: "Acme UK Ltd" };
const DE = { id: "acme-de", name: "Acme GmbH" };

/** Dan's Monday question: invoices over £100,000 still in process. */
const OVER_100K = {
  dataset: "invoices",
  where: [
    { field: "total", op: "over", value: 100000, currency: "GBP" },
    { field: "status", op: "is", value: "in_progress" },
  ],
  show: ["supplier", "invoice", "total", "stage"],
  sort: [{ key: "total", dir: "desc" }],
};

const ok = (input: unknown): AgentQuery => {
  const c = checkQuery(input);
  if (!("query" in c)) throw new Error(c.reason);
  return c.query;
};

describe("the check: only what the catalogue allows", () => {
  it("refuses anything not in the catalogue, with a reason", () => {
    const reason = (q: unknown) => (checkQuery(q) as { reason?: string }).reason;
    expect(reason({ dataset: "org_users", show: ["email"] })).toBe("query_dataset_unknown");
    expect(reason({ dataset: "invoices", show: ["total; DROP TABLE invoice_headers"] })).toBe("query_field_unknown");
    expect(reason({ dataset: "invoices", show: ["invoice"], where: [{ field: "total", op: "contains", value: "1" }] })).toBe("query_op_invalid");
    expect(reason({ dataset: "invoices", show: ["invoice"], where: [{ field: "total", op: "over", value: 100000 }] })).toBe("query_currency_missing");
    expect(reason({ dataset: "invoices", show: ["invoice"], where: [{ field: "status", op: "is", value: "paid" }] })).toBe("query_value_invalid");
    expect(reason({ dataset: "invoices", show: ["invoice"], where: [{ field: "received", op: "after", value: "last week" }] })).toBe("query_value_invalid");
    expect(reason({ dataset: "invoices", groupBy: ["invoice"] })).toBe("query_group_invalid");
    expect(reason({ dataset: "invoices", groupBy: ["supplier"], measures: [{ fn: "sum", field: "supplier" }] })).toBe("query_measure_invalid");
    expect(reason({ dataset: "invoices", show: ["invoice"], measures: [{ fn: "count" }] })).toBe("query_measure_without_group");
    expect(reason({ dataset: "invoices", show: ["invoice"], sort: [{ key: "total" }] })).toBe("query_sort_invalid");
    expect(reason({ dataset: "invoices", show: ["invoice"], limit: 1000 })).toBe("query_limit_invalid");
    expect(reason({ dataset: "invoices" })).toBe("query_show_missing");
  });

  it("never adds up money across currencies, and shows the currency beside it", () => {
    expect(ok({ dataset: "invoices", show: ["supplier", "total"] }).show).toEqual(["supplier", "total", "currency"]);
    const grouped = ok({ dataset: "invoices", groupBy: ["supplier"], measures: [{ fn: "sum", field: "total" }] });
    expect(grouped.groupBy).toEqual(["supplier", "currency"]);
    expect(ok({ dataset: "invoices", groupBy: ["supplier"] }).measures).toEqual([{ fn: "count" }]);
  });
});

describe("running a question", () => {
  it("answers the Monday question as asked: per invoice, in pounds only, still in process", async () => {
    const result = await runQuery(env.DB, "dan", [UK, DE], ok(OVER_100K), MONDAY);
    expect(result.rows.map((r) => [r.org, r.supplier, r.invoice, r.total, r.currency, r.stage])).toEqual([
      ["Acme GmbH", "Lager Nord GmbH", "LN-8", 300000, "GBP", "Approval"],
      ["Acme UK Ltd", "Kingsway", "K-100", 150000, "GBP", "Approval"],
    ]);
    expect(result.rows.map((r) => r.invoiceId)).toEqual(["de-big", "uk-big"]);
    expect(result.totals).toEqual([{ currency: "GBP", total: 450000, count: 2 }]);
    expect(result.columns.map((c) => c.label)).toEqual(["agents.col.org", "agents.col.supplier", "agents.col.invoice", "agents.col.total", "agents.col.currency", "agents.col.stage"]);
  });

  it("shows each person only what they may see, whatever organisations are asked for", async () => {
    const uma = await runQuery(env.DB, "uma", [UK, DE], ok(OVER_100K), MONDAY);
    expect(uma.rows.map((r) => r.invoice)).toEqual(["K-100"]);
    // Ned holds no analysis anywhere: nowhere is nowhere, not everything.
    const ned = await runQuery(env.DB, "ned", [UK, DE], ok(OVER_100K), MONDAY);
    expect(ned.rows).toEqual([]);
    // Tasks are scoped through their invoice in the same way.
    const tasks = ok({ dataset: "tasks", where: [{ field: "taskStatus", op: "is", value: "open" }], show: ["person", "invoice", "ageDays"] });
    expect((await runQuery(env.DB, "uma", [UK, DE], tasks, MONDAY)).rows.map((r) => [r.person, r.invoice, r.ageDays])).toEqual([["Uma Becker", "K-100", 5]]);
    expect((await runQuery(env.DB, "dan", [UK, DE], tasks, MONDAY)).rows).toHaveLength(2);
  });

  it("binds every value, so words in a filter are only ever words", async () => {
    const sly = ok({ dataset: "invoices", show: ["invoice"], where: [{ field: "supplier", op: "contains", value: "x') OR 1=1 --" }] });
    expect((await runQuery(env.DB, "dan", [UK, DE], sly, MONDAY)).rows).toEqual([]);
    const count = await env.DB.prepare("SELECT count(*) AS n FROM invoice_headers").first<{ n: number }>();
    expect(count?.n).toBe(5);
  });

  it("groups and measures, per organisation, and says when it was cut short", async () => {
    const q = ok({ dataset: "invoices", where: [{ field: "status", op: "is", value: "in_progress" }], groupBy: ["supplier"], measures: [{ fn: "count" }, { fn: "sum", field: "total" }], sort: [{ key: "sum_total", dir: "desc" }] });
    const result = await runQuery(env.DB, "dan", [UK, DE], q, MONDAY);
    expect(result.rows.map((r) => [r.org, r.supplier, r.currency, r.count, r.sum_total])).toEqual([
      ["Acme GmbH", "Lager Nord GmbH", "GBP", 1, 300000],
      ["Acme UK Ltd", "Lager Nord GmbH", "EUR", 1, 200000],
      ["Acme UK Ltd", "Kingsway", "GBP", 2, 150900],
    ]);
    expect(result.rows[2]._ids).toBe("uk-big,uk-small");
    expect(result.columns.at(-1)).toMatchObject({ label: "agents.col.m.sum|agents.col.total", kind: "money" });
    const short = await runQuery(env.DB, "dan", [UK, DE], ok({ ...OVER_100K, limit: 1 }), MONDAY);
    expect(short.rows).toHaveLength(1);
    expect(short.cutShort).toBe(1);
  });

  it("leaves out a field an administrator has hidden", async () => {
    await env.DB.prepare("INSERT INTO field_visibility (field, visibility) VALUES ('BT-27', 'hidden')").run();
    await expect(runQuery(env.DB, "dan", [UK], ok(OVER_100K), MONDAY)).rejects.toThrow("query_field_hidden");
    const catalogue = (await handleAgentCatalogue(env.DB, "dan")).body as { datasets: { id: string; fields: { key: string }[] }[] };
    expect(catalogue.datasets.map((d) => d.id)).toEqual(["invoices", "tasks", "lines", "coding", "stage_visits", "returns"]); // decision 0637: all an AP.Analysis holder may ask
    expect(catalogue.datasets[0].fields.map((f) => f.key)).not.toContain("supplier");
    const made = await handleCreateAgent(env.DB, "dan", { name: "Big ones", report: "query", options: { query: OVER_100K }, orgIds: ["acme-uk"], schedule: { every: "week", weekday: 1, time: "12:10" } }, MONDAY);
    expect(made.body).toMatchObject({ reason: "query_field_hidden" });
  });
});

describe("trying a question, and an agent asking it", () => {
  it("tries it with the person's own access, saving nothing", async () => {
    const tried = await handleTryAgentQuery(env.DB, "uma", { query: OVER_100K, orgIds: ["acme-uk"] }, MONDAY);
    expect(tried.status).toBe(200);
    expect((tried.body as { count: number }).count).toBe(1);
    expect((await handleTryAgentQuery(env.DB, "uma", { query: OVER_100K, orgIds: ["acme-de"] }, MONDAY)).body).toMatchObject({ reason: "org_not_permitted" });
    expect((await handleTryAgentQuery(env.DB, "uma", { query: { dataset: "invoices" }, orgIds: ["acme-uk"] }, MONDAY)).body).toMatchObject({ reason: "query_show_missing" });
    expect((await handleAgentCatalogue(env.DB, "ned")).body).toMatchObject({ datasets: [] });
  });

  it("runs as an agent, and sends only what is new since the last run when asked", async () => {
    const made = await handleCreateAgent(env.DB, "dan", { name: "Over £100,000", report: "query", options: { query: { ...OVER_100K, since: "last_run" } }, orgIds: ["acme-uk", "acme-de"], schedule: { every: "week", weekday: 1, time: "12:10" } }, MONDAY);
    expect(made.status).toBe(201);
    const id = (made.body as { id: string }).id;
    await handleRunAgentNow(env.DB, "dan", id, MONDAY);
    const first = ((await handleListAgentNotes(env.DB, "dan")).body as { notes: { id: string }[] }).notes[0];
    const table = ((await handleGetAgentNote(env.DB, "dan", first.id)).body as { table: ReportTable }).table;
    expect(table.report).toBe("query");
    expect(table.rows.map((r) => r.invoice)).toEqual(["LN-8", "K-100"]);

    await invoice("uk-new", { unit: "ap-uk", number: "K-200", supplier: "sup-kw", total: 250000, currency: "GBP", received: "2026-10-08 09:00:00" });
    await handleRunAgentNow(env.DB, "dan", id, NEXT_MONDAY);
    const notes = ((await handleListAgentNotes(env.DB, "dan")).body as { notes: { id: string; created_at: string }[] }).notes;
    const latest = notes.find((n) => n.id !== first.id)!;
    const second = ((await handleGetAgentNote(env.DB, "dan", latest.id)).body as { table: ReportTable }).table;
    expect(second.rows.map((r) => r.invoice)).toEqual(["K-200"]);
  });

  it("says measures and values in the reader's words", () => {
    const table: ReportTable = {
      report: "query",
      columns: [
        { key: "status", label: "agents.col.status", kind: "text", enumKey: "agents.qstatus" },
        { key: "sum_total", label: "agents.col.m.sum|agents.col.total", kind: "money" },
      ],
      rows: [{ status: "in_progress", sum_total: 150900 }],
      totals: [],
      skippedOrgs: [],
      asAt: MONDAY.toISOString(),
      cutShort: 100,
    };
    const de = buildAgentEmail({ locale: "de", table, agentName: "Große", authorName: "Dan", timeZone: "Europe/London", appUrl: null } as Parameters<typeof buildAgentEmail>[0]);
    expect(de.text).toContain("Summe, zusammen");
    expect(de.text).toContain("In Bearbeitung");
    expect(de.text).toContain("Hier stehen nur die ersten 100 Zeilen.");
    const en = buildAgentEmail({ locale: "en", table, agentName: "Big", authorName: "Dan", timeZone: "Europe/London", appUrl: null } as Parameters<typeof buildAgentEmail>[0]);
    expect(en.text).toContain("Total, added up");
    expect(en.csv).toContain("In process");
  });
});
