import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleKeyInvoiceFields } from "../src/key-fields-route.js";
import { handleSetFieldVisibility } from "../src/field-visibility-route.js";
import { handleGetInvoice, loadLiveInvoiceFacts } from "../src/invoice-facts-route.js";
import { projectSpendByOthers } from "../src/project-budget.js";
import { handleCodingSuggestions } from "../src/coding-suggestions.js";
import { handlePairLine } from "../src/po-match-panel-route.js";

/**
 * Split coding — decision 0548. One line of 12,000.00 (INV-S, Kingsway,
 * at a coding stage where every coding field is editable), split across
 * Facilities (cc1), the Leeds fit-out project (PRJ-1) and Logistics (cc2).
 */

type Row = { costCentre: string | null; project: string | null; glCode: string | null; sharePct: number | null; amount: number };
const SPLIT: Row[] = [
  { costCentre: "cc1", project: null, glCode: "GL-6100", sharePct: 50, amount: 6000 },
  { costCentre: null, project: "PRJ-1", glCode: "GL-1610", sharePct: 30, amount: 3600 },
  { costCentre: "cc2", project: null, glCode: "GL-6100", sharePct: 20, amount: 2400 },
];

async function seedInvoice(id: string, supplier = "GB-KW", header: Record<string, unknown> = {}) {
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
  await env.DB.prepare("INSERT OR IGNORE INTO process_stages (id, process_id, name, sequence) VALUES ('coding', 'ap', 'Coding', 1)").run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO process_stage_versions (process_id, version, stage_id, sequence)
     SELECT p.id, p.version, s.id, s.sequence FROM process_stages s JOIN processes p ON p.id = s.process_id`
  ).run();
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES (?1, json_set(?4, '$.BT-31', ?2, '$.BT-1', ?3))")
    .bind(id, supplier, id.toUpperCase(), JSON.stringify({ "BT-1": id.toUpperCase(), "BT-31": supplier, ...header }))
    .run();
  await env.DB.prepare(
    "INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id) VALUES (?, 'ap', 'invoice', ?, 'coding')"
  )
    .bind(`pi-${id}`, id)
    .run();
  await env.DB.prepare("INSERT INTO invoice_lines (invoice_id, line_number, facts_json) VALUES (?, 1, ?)")
    .bind(id, JSON.stringify({ "BT-153": "Office refurbishment", "BT-131": 12000, "coding.commodity_code": "CM-BLD" }))
    .run();
}

const key = (id: string, line: Record<string, unknown>) =>
  handleKeyInvoiceFields(env.DB, id, { facts: {}, lines: [{ lineNumber: 1, facts: {}, ...line }] } as never, "u-dan");
const stored = async (id = "inv-s") =>
  (
    await env.DB.prepare("SELECT seq, cost_centre, project, gl_code, share_pct, amount FROM invoice_line_coding_splits WHERE invoice_id = ? ORDER BY seq")
      .bind(id)
      .all()
  ).results;
const lineFacts = async (id = "inv-s") =>
  JSON.parse((await env.DB.prepare("SELECT facts_json FROM invoice_lines WHERE invoice_id = ?").bind(id).first<{ facts_json: string }>())!.facts_json);

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-dan', 'dan@acme.com', 'Dan')").run();
  await handleSetFieldVisibility(env.DB, {
    fields: [
      { field: "BT-131", visibility: "edit" },
      { field: "BT-133", visibility: "edit" },
      { field: "coding.project", visibility: "edit" },
      { field: "coding.commodity_code", visibility: "edit" },
      { field: "coding.gl_code", visibility: "edit" },
    ],
  });
  await env.DB.prepare("INSERT INTO cost_centres (id, name) VALUES ('cc1', 'Facilities'), ('cc2', 'Logistics')").run();
  await env.DB.prepare(
    `INSERT INTO coding_list_entries (list_type_id, id, name, status, budget_amount) VALUES
       ('project', 'PRJ-1', 'Leeds fit-out', 'active', 10000), ('project', 'PRJ-OLD', 'Old', 'closed', NULL),
       ('commodity_code', 'CM-BLD', 'Building works', 'active', NULL),
       ('gl_code', 'GL-6100', 'Repairs', 'active', NULL), ('gl_code', 'GL-1610', 'Capital works', 'active', NULL)`
  ).run();
  // A GL code must be linked to the line's Commodity Code (decision 0511).
  await env.DB.prepare(
    `INSERT INTO coding_list_entry_filters (owner_list_type_id, owner_entry_id, filter_list_type_id, filter_entry_id) VALUES
       ('gl_code', 'GL-6100', 'commodity_code', 'CM-BLD'), ('gl_code', 'GL-1610', 'commodity_code', 'CM-BLD')`
  ).run();
  await seedInvoice("inv-s");
});

describe("saving a split — decision 0548", () => {
  it("stores the rows, clears the line's own cost centre, project and GL code, and records the change", async () => {
    await env.DB.prepare("UPDATE invoice_lines SET facts_json = json_set(facts_json, '$.\"BT-133\"', 'cc1') WHERE invoice_id = 'inv-s'").run();
    const result = await key("inv-s", { splits: SPLIT });
    expect(result.status).toBe(200);
    expect(await stored()).toEqual([
      { seq: 1, cost_centre: "cc1", project: null, gl_code: "GL-6100", share_pct: 50, amount: 6000 },
      { seq: 2, cost_centre: null, project: "PRJ-1", gl_code: "GL-1610", share_pct: 30, amount: 3600 },
      { seq: 3, cost_centre: "cc2", project: null, gl_code: "GL-6100", share_pct: 20, amount: 2400 },
    ]);
    expect(await lineFacts()).toMatchObject({ "BT-133": "", "coding.project": "", "coding.gl_code": "", "coding.commodity_code": "CM-BLD" });
    const trail = await env.DB.prepare("SELECT previous_value, new_value FROM keyed_fields WHERE field = 'line.1.coding.split'").first<{
      previous_value: string | null;
      new_value: string;
    }>();
    expect(trail!.previous_value).toBeNull();
    expect(JSON.parse(trail!.new_value)).toEqual(SPLIT);

    // The invoice reads back with the rows on the line.
    const body = (await handleGetInvoice(env.DB, "inv-s")).body as { lines: { lineNumber: number; splits?: Row[] }[] };
    expect(body.lines[0].splits).toEqual(SPLIT);
  });

  it("records nothing when the same split is sent again, and removes it with an empty list", async () => {
    await key("inv-s", { splits: SPLIT });
    await key("inv-s", { splits: SPLIT });
    expect((await env.DB.prepare("SELECT count(*) AS n FROM keyed_fields WHERE field = 'line.1.coding.split'").first<{ n: number }>())!.n).toBe(1);

    expect((await key("inv-s", { splits: [] })).status).toBe(200);
    expect(await stored()).toEqual([]);
    const last = await env.DB.prepare("SELECT new_value FROM keyed_fields WHERE field = 'line.1.coding.split' ORDER BY keyed_at DESC, rowid DESC").first();
    expect(last).toEqual({ new_value: "null" });
  });

  it("refuses a split that does not add up, has one row, or more than ten", async () => {
    const unbalanced = await key("inv-s", { splits: [SPLIT[0], { ...SPLIT[1], amount: 4800 }] });
    expect(unbalanced).toMatchObject({ status: 422, body: { reason: "invalid_split", problem: "unbalanced", line: 1 } });
    expect((await key("inv-s", { splits: [{ ...SPLIT[0], amount: 12000 }] })).body).toMatchObject({ problem: "too_few" });
    const eleven = Array.from({ length: 11 }, (_, i) => ({ ...SPLIT[0], sharePct: null, amount: i < 10 ? 1000 : 2000 }));
    expect((await key("inv-s", { splits: eleven })).body).toMatchObject({ problem: "too_many" });
    expect(await stored()).toEqual([]);
  });

  it("refuses a row whose value is not on its list or closed, naming the row", async () => {
    const result = await key("inv-s", { splits: [SPLIT[0], { ...SPLIT[1], project: "PRJ-OLD" }, SPLIT[2]] });
    expect(result).toMatchObject({
      status: 422,
      body: { reason: "invalid_coding", invalid: [{ field: "coding.project", value: "PRJ-OLD", reason: "closed", line: 1, split: 2 }] },
    });
  });

  it("refuses a row holding both a cost centre and a project under 'one or the other'", async () => {
    const result = await key("inv-s", { splits: [{ ...SPLIT[0], project: "PRJ-1" }, SPLIT[1], SPLIT[2]] });
    expect(result).toMatchObject({ status: 422, body: { reason: "cost_centre_and_project", lines: [1] } });
  });

  it("refuses a split at a stage where cost centre and project are read-only", async () => {
    await handleSetFieldVisibility(env.DB, {
      fields: [
        { field: "BT-133", visibility: "read" },
        { field: "coding.project", visibility: "read" },
      ],
    });
    expect(await key("inv-s", { splits: SPLIT })).toMatchObject({ status: 403, body: { reason: "not_editable_here", fields: ["coding.split"] } });
  });

  it("refuses a split on a PO invoice's line that is not marked Non-PO", async () => {
    await env.DB.prepare("UPDATE invoice_headers SET facts_json = json_set(facts_json, '$.\"BT-13\"', 'PO-1') WHERE id = 'inv-s'").run();
    expect(await key("inv-s", { splits: SPLIT })).toMatchObject({ status: 422, body: { reason: "coding_on_po_line" } });
  });
});

describe("what a split changes elsewhere — decision 0548", () => {
  it("flags the line for rules when a row's value is no longer valid", async () => {
    await key("inv-s", { splits: SPLIT });
    let line = (await loadLiveInvoiceFacts(env.DB, "inv-s"))!.lines[0];
    expect(line["coding.line_invalid"]).toBe("");
    await env.DB.prepare("UPDATE coding_list_entries SET status = 'closed' WHERE id = 'PRJ-1'").run();
    line = (await loadLiveInvoiceFacts(env.DB, "inv-s"))!.lines[0];
    expect(line["coding.line_invalid"]).toBe("coding.split");
  });

  it("counts only the project's share against its budget, for other invoices and for rules", async () => {
    await key("inv-s", { splits: SPLIT });
    expect(await projectSpendByOthers(env.DB, "PRJ-1", "another")).toBe(3600);
    expect(await projectSpendByOthers(env.DB, "PRJ-1", "inv-s")).toBe(0);
    const line = (await loadLiveInvoiceFacts(env.DB, "inv-s"))!.lines[0];
    expect(line).toMatchObject({ "project.over_budget": false, "project.budget_used_pct": 36 });
  });

  it("suggests this supplier's last split, as shares, for the next invoice", async () => {
    await key("inv-s", { splits: SPLIT });
    await seedInvoice("inv-t");
    const body = (await handleCodingSuggestions(env.DB, "inv-t")).body as { split?: unknown };
    expect(body.split).toEqual({
      invoiceNumber: "INV-S",
      rows: [
        { costCentre: "cc1", project: null, glCode: "GL-6100", sharePct: 50 },
        { costCentre: null, project: "PRJ-1", glCode: "GL-1610", sharePct: 30 },
        { costCentre: "cc2", project: null, glCode: "GL-6100", sharePct: 20 },
      ],
      labels: {
        "BT-133": { cc1: "Facilities", cc2: "Logistics" },
        "coding.project": { "PRJ-1": "Leeds fit-out" },
        "coding.gl_code": { "GL-6100": "Repairs", "GL-1610": "Capital works" },
      },
    });
    // Not when a row would no longer be accepted, and not from another supplier.
    await seedInvoice("inv-u", "GB-OTHER");
    expect(((await handleCodingSuggestions(env.DB, "inv-u")).body as { split?: unknown }).split).toBeUndefined();
    await env.DB.prepare("UPDATE coding_list_entries SET status = 'closed' WHERE id = 'PRJ-1'").run();
    expect(((await handleCodingSuggestions(env.DB, "inv-t")).body as { split?: unknown }).split).toBeUndefined();
  });

  it("goes when a Non-PO line is paired with a PO line, recorded like its other coding", async () => {
    await env.DB.prepare("INSERT INTO purchase_orders (id, order_number, payable_amount, status) VALUES ('po-1', 'PO-1', 20000, 'active')").run();
    await env.DB.prepare(
      "INSERT INTO purchase_order_lines (id, purchase_order_id, line_number, quantity, line_extension_amount, item_name, price_amount) VALUES ('pol-1', 'po-1', 1, 1, 12000, 'Works', 12000)"
    ).run();
    await env.DB.prepare("UPDATE invoice_headers SET facts_json = json_set(facts_json, '$.\"BT-13\"', 'PO-1') WHERE id = 'inv-s'").run();
    await env.DB.prepare("INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome, created_at) VALUES ('v-1', 'pi-inv-s', 'coding', 'matched', datetime('now'))").run();
    await env.DB.prepare(
      "INSERT INTO tasks (id, stage_id, owner_user_id, required_permission, status, stage_visit_id) VALUES ('t-1', 'coding', 'u-dan', 'AP.Match', 'open', 'v-1')"
    ).run();
    await handlePairLine(env.DB, "inv-s", "u-dan", { lineNumber: 1, nonPo: true });
    expect((await key("inv-s", { splits: SPLIT })).status).toBe(200);
    expect(await stored()).toHaveLength(3);

    await handlePairLine(env.DB, "inv-s", "u-dan", { lineNumber: 1, poLineNumber: 1 });
    expect(await stored()).toEqual([]);
    const last = await env.DB.prepare("SELECT new_value FROM keyed_fields WHERE field = 'line.1.coding.split' ORDER BY keyed_at DESC, rowid DESC").first();
    expect(last).toEqual({ new_value: "null" });
  });
});
