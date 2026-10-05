import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { checkQuery, queryCatalogue, runQuery, type AgentQuery } from "../src/agent-query.js";
import { handleCreateAgent, handleListAgents } from "../src/agents.js";

/**
 * Agents ask the data, slice 4: the other datasets — decision 0637.
 * Acme UK and Acme GmbH. Dan holds every permission everywhere; Uma
 * analyses the UK only; Sam sees suppliers in Germany only; Ivy monitors
 * integrations only.
 */

const NOW = new Date("2026-10-05T12:00:00Z");
const UK = { id: "acme-uk", name: "Acme UK Ltd" };
const DE = { id: "acme-de", name: "Acme GmbH" };

async function person(id: string, permissions: string[], unit: string | null) {
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES (?, ?, ?)").bind(id, `${id}@acme.com`, id).run();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)").bind(`r-${id}`, id, JSON.stringify(permissions)).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES (?, ?, ?)").bind(id, `r-${id}`, unit).run();
}

async function invoice(id: string, unit: string, number: string, supplier: string, total: number, status = "in_progress") {
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, org_unit_id, invoice_number, currency, total_with_vat, supplier_id, created_at) VALUES (?, '{}', ?, ?, 'GBP', ?, ?, '2026-09-28 09:00:00')")
    .bind(id, unit, number, total, supplier)
    .run();
  await env.DB.prepare("INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status, ended_at, return_reason_id) VALUES (?, 'ap', 'invoice', ?, 'approval', ?, ?, NULL)")
    .bind(`pi-${id}`, id, status, status === "returned_manually" ? "2026-09-30T10:00:00.000Z" : null)
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_units (id, name, kind) VALUES ('acme-uk', 'Acme UK Ltd', 'legal_entity'), ('acme-de', 'Acme GmbH', 'legal_entity')").run();
  await person("dan", ["AP.Agents", "AP.Analysis", "AP.Supplier", "AP.Validate", "Integration.Monitor"], null);
  await person("uma", ["AP.Agents", "AP.Analysis"], "acme-uk");
  await person("sam", ["AP.Agents", "AP.Supplier"], "acme-de");
  await person("ivy", ["AP.Agents", "Integration.Monitor"], null);
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
  await env.DB.prepare("INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('approval', 'ap', 'Approval', 1), ('coding', 'ap', 'Coding', 2)").run();
  await env.DB.prepare(
    "INSERT INTO suppliers (id, erp_identifier, name, country, status, on_hold, org_unit_id, vat_id) VALUES ('sup-kw', 'K1', 'Kingsway', 'GB', 'active', 0, 'acme-uk', 'GB1'), ('sup-ln', 'L1', 'Lager Nord GmbH', 'DE', 'active', 1, 'acme-de', 'DE1')",
  ).run();
  await invoice("uk-1", "acme-uk", "K-1", "sup-kw", 1200);
  await invoice("de-1", "acme-de", "LN-1", "sup-ln", 900);
  await invoice("uk-ret", "acme-uk", "K-2", "sup-kw", 300, "returned_manually");
  // Lines and coding: K-1 is two lines, the first split over two GL codes.
  await env.DB.prepare("INSERT INTO invoice_lines (id, invoice_id, line_number, description, amount, facts_json) VALUES ('l1', 'uk-1', 1, 'Pallets', 800, '{}'), ('l2', 'uk-1', 2, 'Delivery', 200, '{}'), ('l3', 'de-1', 1, 'Lager', 750, '{}')").run();
  await env.DB.prepare(
    "INSERT INTO invoice_line_coding_splits (invoice_id, line_number, seq, cost_centre, project, gl_code, amount) VALUES ('uk-1', 1, 1, 'CC10', NULL, '5000', 500), ('uk-1', 1, 2, 'CC10', NULL, '5100', 300), ('uk-1', 2, 1, 'CC20', NULL, '5100', 200), ('de-1', 1, 1, 'CC90', NULL, '5000', 750)",
  ).run();
  // K-1 spent 3 days at Approval, then moved to Coding on 1 October.
  await env.DB.prepare("INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome, created_at) VALUES ('v1', 'pi-uk-1', 'approval', 'matched', '2026-09-28 09:00:00'), ('v2', 'pi-uk-1', 'coding', 'matched', '2026-10-01 09:00:00')").run();
  // A purchase order in each company; the UK line is invoiced.
  await env.DB.prepare("INSERT INTO purchase_orders (id, order_number, currency, status, org_unit_id, seller_party_id) VALUES ('po-uk', 'PO-UK', 'GBP', 'active', 'acme-uk', 'GB1'), ('po-de', 'PO-DE', 'GBP', 'active', 'acme-de', 'DE1')").run();
  await env.DB.prepare("INSERT INTO purchase_order_lines (id, purchase_order_id, line_number, item_name, line_extension_amount) VALUES ('pl-uk', 'po-uk', 1, 'Pallets', 800), ('pl-de', 'po-de', 1, 'Lager', 750)").run();
  await env.DB.prepare("INSERT INTO invoice_line_po_pairings (invoice_id, line_number, order_number, po_line_number, paired_by, paired_at) VALUES ('uk-1', 1, 'PO-UK', 1, 'dan', '2026-10-01T00:00:00Z')").run();
  // A failed delivery of the German invoice; two received files.
  await env.DB.prepare("INSERT INTO route_instances (id, route_id, process_id, name, status) VALUES ('erp-1', 'https-out', 'ap', 'ERP', 'active')").run();
  await env.DB.prepare("INSERT INTO destination_deliveries (instance_id, invoice_id, status, attempts, last_error, created_at) VALUES ('erp-1', 'de-1', 'failed', 3, 'HTTP 500', '2026-10-02T00:00:00Z')").run();
  await env.DB.prepare("INSERT INTO route_messages (id, direction, status, counterparty, subject, error_text, received_at) VALUES ('m1', 'in', 'failed', 'billing@lager-nord.de', 'Rechnung LN-9', 'BT-2 is not a date', '2026-10-04T08:00:00Z'), ('m2', 'in', 'delivered', 'ap@kingsway.co.uk', 'K-3', NULL, '2026-10-04T09:00:00Z')").run();
});

const ok = (input: unknown): AgentQuery => {
  const c = checkQuery(input);
  if (!("query" in c)) throw new Error(c.reason);
  return c.query;
};
const run = (who: string, q: unknown, orgs = [UK, DE]) => runQuery(env.DB, who, orgs, ok(q), NOW);

describe("the other datasets", () => {
  it("adds up coding by GL code, per organisation and currency", async () => {
    const r = await run("dan", { dataset: "coding", groupBy: ["glCode"], measures: [{ fn: "sum", field: "amount" }], sort: [{ key: "sum_amount", dir: "desc" }] });
    expect(r.rows.map((x) => [x.org, x.glCode, x.currency, x.sum_amount])).toEqual([
      ["Acme GmbH", "5000", "GBP", 750],
      ["Acme UK Ltd", "5000", "GBP", 500],
      ["Acme UK Ltd", "5100", "GBP", 500],
    ]);
    expect(r.rows[1]._ids).toBe("uk-1");
  });

  it("lists invoice lines with their invoice's fields, and the order they are paired with", async () => {
    const r = await run("uma", { dataset: "lines", where: [{ field: "amount", op: "over", value: 100, currency: "GBP" }], show: ["invoice", "supplier", "description", "amount", "purchaseOrder"], sort: [{ key: "amount", dir: "desc" }] });
    expect(r.rows.map((x) => [x.invoice, x.supplier, x.description, x.amount, x.purchaseOrder])).toEqual([
      ["K-1", "Kingsway", "Pallets", 800, "PO-UK"],
      ["K-1", "Kingsway", "Delivery", 200, null],
    ]);
  });

  it("says how long invoices spent at each stage", async () => {
    const r = await run("dan", { dataset: "stage_visits", show: ["invoice", "visitStage", "daysSpent", "left"], sort: [{ key: "daysSpent", dir: "desc" }] });
    expect(r.rows.map((x) => [x.invoice, x.visitStage, x.daysSpent, x.left])).toEqual([
      ["K-1", "Coding", 4, null],
      ["K-1", "Approval", 3, "2026-10-01"],
    ]);
  });

  it("lists returns, with whether a corrected invoice has arrived", async () => {
    const r = await run("dan", { dataset: "returns", show: ["invoice", "daysSince", "replyArrived"] });
    expect(r.rows.map((x) => [x.invoice, x.daysSince, x.replyArrived])).toEqual([["K-2", 5, "no"]]);
  });

  it("scopes suppliers and purchase orders by their own permission and organisation", async () => {
    const sam = await run("sam", { dataset: "suppliers", show: ["supplier", "onHold"] });
    expect(sam.rows.map((x) => [x.supplier, x.onHold])).toEqual([["Lager Nord GmbH", "yes"]]);
    // Uma analyses the UK but holds no AP.Supplier: nothing.
    expect((await run("uma", { dataset: "suppliers", show: ["supplier"] })).rows).toEqual([]);
    const po = await run("dan", { dataset: "purchase_orders", show: ["order", "supplier", "item", "invoiced"], sort: [{ key: "order", dir: "desc" }] });
    expect(po.rows.map((x) => [x.order, x.supplier, x.item, x.invoiced])).toEqual([
      ["PO-UK", "Kingsway", "Pallets", "yes"],
      ["PO-DE", "Lager Nord GmbH", "Lager", "no"],
    ]);
  });

  it("lists deliveries and received files for those who monitor integrations, files with no organisation", async () => {
    const d = await run("ivy", { dataset: "deliveries", where: [{ field: "deliveryStatus", op: "is", value: "failed" }], show: ["invoice", "destination", "error"] });
    expect(d.rows.map((x) => [x.org, x.invoice, x.destination, x.error])).toEqual([["Acme GmbH", "LN-1", "ERP", "HTTP 500"]]);
    const f = await run("ivy", { dataset: "files", where: [{ field: "fileStatus", op: "is", value: "failed" }], show: ["from", "subject", "error"] });
    expect(f.columns.map((c) => c.key)).toEqual(["from", "subject", "error"]);
    expect(f.rows).toEqual([{ from: "billing@lager-nord.de", subject: "Rechnung LN-9", error: "BT-2 is not a date", _key: "q:m1" }]);
    // Uma does not monitor integrations: neither.
    expect((await run("uma", { dataset: "files", show: ["subject"] })).rows).toEqual([]);
    expect((await run("uma", { dataset: "deliveries", show: ["invoice"] })).rows).toEqual([]);
  });

  it("refuses 'only what is new' where nothing records when a row arrived", () => {
    expect(checkQuery({ dataset: "suppliers", show: ["supplier"], since: "last_run" })).toMatchObject({ reason: "query_since_invalid" });
  });
});

describe("who may ask what", () => {
  it("offers each person only the datasets they hold, with the organisations for each", async () => {
    const sam = await queryCatalogue(env.DB, "sam");
    expect(sam.datasets.map((d) => [d.id, d.orgIds])).toEqual([["suppliers", ["acme-de"]]]);
    const ivy = await queryCatalogue(env.DB, "ivy");
    expect(ivy.datasets.map((d) => d.id)).toEqual(["deliveries", "files"]);
    const dan = await queryCatalogue(env.DB, "dan");
    expect(dan.datasets.map((d) => d.id)).toEqual(["invoices", "tasks", "lines", "coding", "stage_visits", "returns", "suppliers", "purchase_orders", "deliveries", "files"]);
    // The form offers Sam his own question for Germany only.
    const list = (await handleListAgents(env.DB, "sam")).body as { reports: { id: string; orgIds: string[] }[] };
    expect(list.reports.find((r) => r.id === "query")?.orgIds).toEqual(["acme-de"]);
  });

  it("saves an agent's question against its dataset's own permission", async () => {
    const q = { dataset: "suppliers", where: [{ field: "onHold", op: "is", value: "yes" }], show: ["supplier", "holdReason"] };
    const made = await handleCreateAgent(env.DB, "sam", { name: "Suppliers on hold", report: "query", options: { query: q }, orgIds: ["acme-de"], schedule: { every: "week", weekday: 1, time: "08:00" } }, NOW);
    expect(made.status).toBe(201);
    const refused = await handleCreateAgent(env.DB, "sam", { name: "Suppliers on hold", report: "query", options: { query: q }, orgIds: ["acme-uk"], schedule: { every: "week", weekday: 1, time: "08:00" } }, NOW);
    expect(refused.body).toMatchObject({ reason: "org_not_permitted" });
  });
});
