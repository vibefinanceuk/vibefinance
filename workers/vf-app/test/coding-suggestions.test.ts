import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCodingSuggestions } from "../src/coding-suggestions.js";
import { handleKeyInvoiceFields } from "../src/key-fields-route.js";
import { handleSetFieldVisibility } from "../src/field-visibility-route.js";

/**
 * Account Coding suggestions, per line — decision 0539. Northwind's
 * earlier lines: two pallet deliveries coded to Logistics / Freight /
 * 5410, three stationery lines coded to Office / Stationery / 6000.
 */

type Body = {
  lines: Record<
    string,
    {
      values: Record<string, string>;
      labels: Record<string, string>;
      basis: string;
      count: number;
      total: number;
      confidence: number;
      examples: string[];
    }
  >;
};

const FREIGHT = { "BT-133": "cc-log", "coding.commodity_code": "cm-frt", "coding.gl_code": "gl-5410" };
const STATIONERY = { "BT-133": "cc-off", "coding.commodity_code": "cm-sta", "coding.gl_code": "gl-6000" };

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-coder', 'coder@acme.com', 'Coder')").run();
  await env.DB.prepare("INSERT INTO cost_centres (id, name) VALUES ('cc-log', 'Logistics UK'), ('cc-off', 'Office')").run();
  await env.DB.prepare(
    `INSERT INTO coding_list_entries (list_type_id, id, name) VALUES
       ('commodity_code', 'cm-frt', 'Freight in'), ('commodity_code', 'cm-sta', 'Stationery'),
       ('gl_code', 'gl-5410', 'Carriage inwards'), ('gl_code', 'gl-6000', 'Office supplies')`
  ).run();
  // A General Ledger Code must be linked to its Commodity Code (decision 0511).
  await env.DB.prepare(
    `INSERT INTO coding_list_entry_filters (owner_list_type_id, owner_entry_id, filter_list_type_id, filter_entry_id) VALUES
       ('gl_code', 'gl-5410', 'commodity_code', 'cm-frt'), ('gl_code', 'gl-6000', 'commodity_code', 'cm-sta')`
  ).run();
});

let seq = 0;
/**
 * An earlier invoice line a person coded, recorded exactly as keying
 * records it: the line's facts, and a `keyed_fields` row per coding
 * field under its real name, `line.<n>.<field>`.
 */
async function codedLine(supplier: string, description: string, coding: Record<string, string>, opts: { keyed?: boolean } = {}) {
  const id = `hist-${++seq}`;
  await env.DB.prepare("INSERT INTO invoice_headers (id, supplier_vat_id, facts_json) VALUES (?, ?, '{}')").bind(id, supplier).run();
  await env.DB.prepare("INSERT INTO invoice_lines (id, invoice_id, line_number, facts_json) VALUES (?, ?, 1, ?)")
    .bind(crypto.randomUUID(), id, JSON.stringify({ "BT-153": description, "BT-131": 10, ...coding }))
    .run();
  if (opts.keyed !== false) {
    for (const [field, value] of Object.entries(coding)) {
      await env.DB.prepare(
        "INSERT INTO keyed_fields (id, invoice_id, field, previous_value, new_value, keyed_by, line_number) VALUES (?, ?, ?, NULL, ?, 'u-coder', 1)"
      )
        .bind(crypto.randomUUID(), id, `line.1.${field}`, JSON.stringify(value))
        .run();
    }
  }
  return id;
}

async function target(id: string, supplier: string | null, descriptions: string[], header: Record<string, unknown> = {}) {
  // BT-31 too: keying re-derives `supplier_vat_id` from it.
  await env.DB.prepare("INSERT INTO invoice_headers (id, supplier_vat_id, facts_json) VALUES (?, ?, ?)")
    .bind(id, supplier, JSON.stringify(supplier ? { "BT-31": supplier, ...header } : header))
    .run();
  for (const [i, d] of descriptions.entries()) {
    await env.DB.prepare("INSERT INTO invoice_lines (id, invoice_id, line_number, facts_json) VALUES (?, ?, ?, ?)")
      .bind(crypto.randomUUID(), id, i + 1, JSON.stringify({ "BT-153": d, "BT-131": 10 }))
      .run();
  }
}

const suggest = async (id: string) => (await handleCodingSuggestions(env.DB, id)).body as Body;

async function northwind() {
  await codedLine("GB-NW", "Pallet delivery, York", FREIGHT);
  await codedLine("GB-NW", "2 pallets delivery - Hull depot", FREIGHT);
  await codedLine("GB-NW", "A4 copier paper", STATIONERY);
  await codedLine("GB-NW", "Box files, blue", STATIONERY);
  await codedLine("GB-NW", "Printer paper A3", STATIONERY);
}

describe("a suggestion per line, from this supplier's lines like it (decision 0539)", () => {
  it("suggests each line the whole coding set its similar earlier lines got, so two lines of one invoice can differ", async () => {
    await northwind();
    await target("inv-t", "GB-NW", ["Pallet delivery, Leeds depot", "A4 paper, white"]);
    const body = await suggest("inv-t");

    expect(body.lines["1"]).toEqual({
      values: FREIGHT,
      labels: { "BT-133": "Logistics UK", "coding.commodity_code": "Freight in", "coding.gl_code": "Carriage inwards" },
      basis: "similar",
      count: 2,
      total: 2,
      confidence: 1,
      // The most similar first: "Hull depot" shares "depot" too.
      examples: ["2 pallets delivery - Hull depot", "Pallet delivery, York"],
    });
    expect(body.lines["2"]).toMatchObject({ values: STATIONERY, basis: "similar" });
  });

  it("falls back to the supplier's usual coding for a line like none of them", async () => {
    await northwind();
    await target("inv-t", "GB-NW", ["Annual service charge"]);
    expect((await suggest("inv-t")).lines["1"]).toMatchObject({ values: STATIONERY, basis: "supplier", count: 3, total: 5, confidence: 0.6 });
  });

  it("falls back to the supplier's usual coding when similar lines disagree", async () => {
    await northwind();
    await codedLine("GB-NW", "Pallet delivery, Leeds", STATIONERY);
    await codedLine("GB-NW", "Pallet delivery, Wakefield", { "BT-133": "cc-off" });
    await target("inv-t", "GB-NW", ["Pallet delivery, Leeds depot"]);
    // Similar: 2 freight, 1 stationery, 1 other — 50% agree, which is enough.
    expect((await suggest("inv-t")).lines["1"]).toMatchObject({ basis: "similar", count: 2, total: 4 });

    await codedLine("GB-NW", "Pallet delivery, Selby", STATIONERY);
    // Now 2 of 5 similar agree on any one set: below half, so the supplier's usual (5 stationery of 8).
    expect((await suggest("inv-t")).lines["1"]).toMatchObject({ values: STATIONERY, basis: "supplier", count: 5, total: 8 });
  });

  it("offers nothing from fewer than three lines unless one is like this line", async () => {
    await codedLine("GB-THIN", "Pallet delivery, York", FREIGHT);
    await codedLine("GB-THIN", "Pallet delivery, Hull", FREIGHT);
    await target("inv-t", "GB-THIN", ["Consultancy", "Pallet delivery, Leeds"]);
    const body = await suggest("inv-t");
    expect(body.lines["1"]).toBeUndefined();
    expect(body.lines["2"]).toMatchObject({ values: FREIGHT, basis: "similar" });
  });

  it("draws only on this supplier's lines", async () => {
    await northwind();
    await target("inv-t", "GB-OTHER", ["Pallet delivery, Leeds depot"]);
    expect((await suggest("inv-t")).lines).toEqual({});
  });

  it("draws only on lines a person coded, not a supplier's own cost centre, and not coding that was only cleared", async () => {
    await codedLine("GB-X", "Pallet delivery, York", FREIGHT, { keyed: false });
    const cleared = await codedLine("GB-X", "Pallet delivery, Hull", {}, { keyed: false });
    await env.DB.prepare(
      "INSERT INTO keyed_fields (id, invoice_id, field, previous_value, new_value, keyed_by, line_number) VALUES (?, ?, 'line.1.BT-133', ?, 'null', 'u-coder', 1)"
    )
      .bind(crypto.randomUUID(), cleared, JSON.stringify("cc-log"))
      .run();
    await target("inv-t", "GB-X", ["Pallet delivery, Leeds"]);
    expect((await suggest("inv-t")).lines).toEqual({});
  });

  it("finds history keyed through the real keying route — the field name 0457 never matched", async () => {
    await handleSetFieldVisibility(env.DB, { fields: [{ field: "BT-133", visibility: "edit" }, { field: "BT-131", visibility: "edit" }] });
    // A Coding stage for keying to run at, as coding-validation.test.ts seeds it.
    await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('ap', 'AP')").run();
    await env.DB.prepare("INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('coding', 'ap', 'Coding', 1)").run();
    await env.DB.prepare(
      `INSERT INTO process_stage_versions (process_id, version, stage_id, sequence)
       SELECT p.id, p.version, s.id, s.sequence FROM process_stages s JOIN processes p ON p.id = s.process_id`
    ).run();
    for (const place of ["York", "Hull"]) {
      await target(`hist-${place}`, "GB-REAL", [`Pallet delivery, ${place}`]);
      await env.DB.prepare(
        "INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id) VALUES (?, 'ap', 'invoice', ?, 'coding')"
      )
        .bind(`pi-${place}`, `hist-${place}`)
        .run();
      const keyed = await handleKeyInvoiceFields(
        env.DB,
        `hist-${place}`,
        { facts: {}, lines: [{ lineNumber: 1, facts: { "BT-133": "cc-log" } }] } as never,
        "u-coder"
      );
      expect(keyed.status).toBe(200);
    }
    await target("inv-t", "GB-REAL", ["Pallet delivery, Leeds"]);
    expect((await suggest("inv-t")).lines["1"]).toMatchObject({ values: { "BT-133": "cc-log" }, basis: "similar", count: 2 });
  });

  it("suggests only a PO invoice's Non-PO lines (decision 0537)", async () => {
    await northwind();
    await target("inv-t", "GB-NW", ["A4 paper, white", "Pallet delivery, Leeds depot"], { "BT-13": "PO-9" });
    expect((await suggest("inv-t")).lines).toEqual({});
    await env.DB.prepare(
      `INSERT INTO invoice_line_po_pairings (invoice_id, line_number, order_number, po_line_number, paired_by, paired_at, kind)
       VALUES ('inv-t', 2, 'PO-9', NULL, 'u-coder', '2026-09-28', 'non_po')`
    ).run();
    expect(Object.keys((await suggest("inv-t")).lines)).toEqual(["2"]);
  });

  it("drops a value the save would refuse, keeping the rest of the set (decision 0511)", async () => {
    // A set with both a cost centre and a project: AP Setup's "both allowed" (decision 0540).
    await env.DB.prepare("UPDATE org_coding_config SET cost_object_rule = 'both'").run();
    await codedLine("GB-J", "Pallet delivery, York", { ...FREIGHT, "coding.project": "PRJ-GONE" });
    await target("inv-t", "GB-J", ["Pallet delivery, Leeds"]);
    expect((await suggest("inv-t")).lines["1"].values).toEqual(FREIGHT);
  });

  it("drops a Cost Centre linked only to another company than this invoice's (decision 0511)", async () => {
    await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('UK01', 'Acme UK'), ('DE01', 'Acme DE')").run();
    await env.DB.prepare(
      "INSERT INTO coding_list_entry_filters (owner_list_type_id, owner_entry_id, filter_list_type_id, filter_entry_id) VALUES ('cost_centre', 'cc-log', 'company_code', 'DE01')"
    ).run();
    await codedLine("GB-K", "Pallet delivery, York", { "BT-133": "cc-log" });
    await target("inv-uk", "GB-K", ["Pallet delivery, Leeds"]);
    await target("inv-de", "GB-K", ["Pallet delivery, Leeds"]);
    await env.DB.prepare("UPDATE invoice_headers SET org_unit_id = 'UK01' WHERE id = 'inv-uk'").run();
    await env.DB.prepare("UPDATE invoice_headers SET org_unit_id = 'DE01' WHERE id = 'inv-de'").run();
    expect((await suggest("inv-uk")).lines).toEqual({});
    expect((await suggest("inv-de")).lines["1"].values).toEqual({ "BT-133": "cc-log" });
  });

  it("draws only on lines holding one of cost centre and project while the either/or rule is on (decision 0540)", async () => {
    await codedLine("GB-E", "Pallet delivery, York", { "BT-133": "cc-log", "coding.project": "PRJ-1" });
    await codedLine("GB-E", "Pallet delivery, Hull", { "BT-133": "cc-off" });
    await env.DB.prepare("INSERT INTO coding_list_entries (list_type_id, id, name) VALUES ('project', 'PRJ-1', 'Fit-out')").run();
    await target("inv-t", "GB-E", ["Pallet delivery, Leeds"]);
    expect((await suggest("inv-t")).lines["1"]).toMatchObject({ values: { "BT-133": "cc-off" }, count: 1, total: 1 });

    await env.DB.prepare("UPDATE org_coding_config SET cost_object_rule = 'both'").run();
    expect((await suggest("inv-t")).lines["1"]).toMatchObject({ count: 1, total: 2 });
  });

  it("404s an invoice that does not exist, and suggests nothing for one with no identified supplier", async () => {
    expect((await handleCodingSuggestions(env.DB, "no-such-invoice")).status).toBe(404);
    await target("inv-anon", null, ["Pallet delivery"]);
    expect(await handleCodingSuggestions(env.DB, "inv-anon")).toEqual({ status: 200, body: { lines: {} } });
  });
});
