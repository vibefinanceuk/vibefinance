import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { erpExportCsv, handleCreateErpExport, handleListErpExports, toCsv, ERP_EXPORT_COLUMNS } from "../src/erp-export-route.js";

/**
 * The ERP export — decision 0552. A three-stage process (Coding, Approval,
 * Payment-eligible). INV-A has completed its process; INV-B sits at the
 * final stage; INV-C is still at Approval; INV-D was discarded. INV-E is
 * payment-eligible but in Acme DE, where Fran may not export.
 */

async function person(id: string, permissions: string[], unit: string | null) {
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES (?, ?, ?)").bind(id, `${id}@acme.com`, id).run();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)").bind(`r-${id}`, id, JSON.stringify(permissions)).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES (?, ?, ?)").bind(id, `r-${id}`, unit).run();
}

async function invoice(
  id: string,
  opts: { stage: string; status?: string; unit?: string; facts?: Record<string, unknown>; lines?: Record<string, unknown>[]; supplier?: string | null }
) {
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, org_unit_id, supplier_id, invoice_number, currency, total_with_vat) VALUES (?, ?, ?, ?, ?, 'GBP', ?)")
    .bind(
      id,
      JSON.stringify({ "BT-1": id.toUpperCase(), "BT-2": "2026-09-20", "BT-9": "2026-10-20", "BT-5": "GBP", ...opts.facts }),
      opts.unit ?? "acme-uk",
      opts.supplier === undefined ? "sup-1" : opts.supplier,
      id.toUpperCase(),
      (opts.facts?.["BT-112"] as number | undefined) ?? 120
    )
    .run();
  for (const [i, l] of (opts.lines ?? []).entries()) {
    await env.DB.prepare("INSERT INTO invoice_lines (invoice_id, line_number, facts_json) VALUES (?, ?, ?)").bind(id, i + 1, JSON.stringify(l)).run();
  }
  await env.DB.prepare(
    "INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES (?, 'ap', 'invoice', ?, ?, ?)"
  )
    .bind(`pi-${id}`, id, opts.stage, opts.status ?? "in_progress")
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_units (id, name, kind) VALUES ('acme-uk', 'Acme UK', 'legal_entity'), ('acme-de', 'Acme DE', 'legal_entity')").run();
  await person("fran", ["AP.Export"], "acme-uk");
  await person("olga", ["AP.Export"], null);
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
  await env.DB.prepare(
    "INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('coding', 'ap', 'Coding', 1), ('approval', 'ap', 'Approval', 2), ('eligible', 'ap', 'Payment-eligible', 3)"
  ).run();
  await env.DB.prepare(
    "INSERT INTO suppliers (id, erp_identifier, erp_site_identifier, name, vat_id) VALUES ('sup-1', '40118', 'LEEDS', 'Kingsway Interiors', 'GB111')"
  ).run();

  await invoice("inv-a", {
    stage: "eligible",
    status: "completed",
    facts: { "BT-31": "GB111", "BT-109": 12240, "BT-110": 2448, "BT-112": 14688, "coding.commodity_code": "CM-BLD" },
    lines: [
      { "BT-153": "Office refurbishment", "BT-129": 1, "BT-130": "EA", "BT-131": 12000, "BT-151": "S", "BT-152": 20 },
      { "BT-153": "=cmd|' /C calc'!A0", "BT-131": 240, "BT-133": "cc1", "coding.gl_code": "6100", "BT-151": "S", "BT-152": 20 },
    ],
  });
  await env.DB.prepare(
    `INSERT INTO invoice_line_coding_splits (invoice_id, line_number, seq, cost_centre, project, gl_code, share_pct, amount) VALUES
       ('inv-a', 1, 1, 'cc1', NULL, '6100', 70, 8400), ('inv-a', 1, 2, NULL, 'PRJ-1', '1610', 30, 3600)`
  ).run();
  await invoice("inv-b", { stage: "eligible", facts: { "BT-112": 120, "BT-110": 20, "BT-133": "cc2", "coding.gl_code": "5000" }, supplier: null });
  await invoice("inv-c", { stage: "approval" });
  await invoice("inv-d", { stage: "coding", status: "archived" });
  await invoice("inv-e", { stage: "eligible", unit: "acme-de" });
});

const list = async (user: string) =>
  (await handleListErpExports(env.DB, user)).body as {
    pending: { count: number; invoices: { id: string; number: string; supplierName: string | null; total: number }[] };
    exports: { id: string; invoiceCount: number; rowCount: number; createdByName: string }[];
  };

describe("the ERP export — decision 0552", () => {
  it("offers only payment-eligible invoices never exported, in the units this person may export", async () => {
    expect((await list("fran")).pending.invoices.map((i) => i.id)).toEqual(["inv-a", "inv-b"]);
    expect((await list("olga")).pending.invoices.map((i) => i.id).sort()).toEqual(["inv-a", "inv-b", "inv-e"]);
  });

  it("exports each invoice once: a line per row, each split row on its own, the invoice's coding where a line has none", async () => {
    const made = await handleCreateErpExport(env.DB, "fran");
    expect(made).toMatchObject({ status: 201, body: { invoiceCount: 2, rowCount: 4 } });
    const id = (made.body as { id: string }).id;

    const csv = await erpExportCsv(env.DB, "fran", id);
    expect(csv.status).toBe(200);
    expect(csv.filename).toMatch(/^vibefinance-erp-export-\d{12}-[0-9a-f]{8}\.csv$/);
    const [head, ...rows] = csv.csv!.replace(/^﻿/, "").trim().split("\r\n");
    expect(head).toBe(ERP_EXPORT_COLUMNS.join(","));
    const cells = rows.map((r) => Object.fromEntries(ERP_EXPORT_COLUMNS.map((c, i) => [c, r.split(",")[i]])));
    // INV-A line 1, split 70/30: two distributions, the commodity from the invoice.
    expect(cells[0]).toMatchObject({
      invoice_id: "inv-a",
      invoice_number: "INV-A",
      supplier_erp_id: "40118",
      supplier_site: "LEEDS",
      company: "acme-uk",
      invoice_net: "12240.00",
      invoice_total: "14688.00",
      line_number: "1",
      split_row: "1",
      net_amount: "8400.00",
      cost_centre: "cc1",
      gl_code: "6100",
      commodity_code: "CM-BLD",
    });
    expect(cells[1]).toMatchObject({ line_number: "1", split_row: "2", net_amount: "3600.00", project: "PRJ-1", gl_code: "1610" });
    // A description that starts like a formula never runs as one.
    expect(cells[2]).toMatchObject({ line_number: "2", split_row: "", net_amount: "240.00", cost_centre: "cc1", description: "'=cmd|' /C calc'!A0" });
    // INV-B has no lines: one row, the net worked out from total less VAT, the invoice's own coding.
    expect(cells[3]).toMatchObject({ invoice_id: "inv-b", line_number: "", net_amount: "100.00", cost_centre: "cc2", gl_code: "5000", supplier_erp_id: "" });

    // Taken: nothing left to export, and a second export is refused.
    expect((await list("fran")).pending.count).toBe(0);
    expect(await handleCreateErpExport(env.DB, "fran")).toMatchObject({ status: 409, body: { reason: "nothing_to_export" } });
    expect((await list("fran")).exports).toEqual([expect.objectContaining({ id, invoiceCount: 2, rowCount: 4, createdByName: "fran" })]);
  });

  it("gives the same file again after an invoice is corrected", async () => {
    const id = ((await handleCreateErpExport(env.DB, "fran")).body as { id: string }).id;
    const first = (await erpExportCsv(env.DB, "fran", id)).csv;
    await env.DB.prepare("UPDATE invoice_line_coding_splits SET cost_centre = 'cc9' WHERE invoice_id = 'inv-a'").run();
    expect((await erpExportCsv(env.DB, "fran", id)).csv).toBe(first);
  });

  it("keeps an export spanning units a person does not hold out of their reach", async () => {
    const id = ((await handleCreateErpExport(env.DB, "olga")).body as { id: string }).id;
    expect((await list("fran")).exports).toEqual([]);
    expect((await erpExportCsv(env.DB, "fran", id)).status).toBe(404);
    expect((await erpExportCsv(env.DB, "olga", id)).status).toBe(200);
  });

  it("writes CSV that quotes commas, quotes and line breaks", () => {
    const row = Object.fromEntries(ERP_EXPORT_COLUMNS.map((c) => [c, ""])) as Record<(typeof ERP_EXPORT_COLUMNS)[number], string>;
    row.description = 'Chairs, "ergonomic"\nx2';
    row.net_amount = "-10.00";
    const csv = toCsv([row]);
    expect(csv).toContain('"Chairs, ""ergonomic""\nx2"');
    // A negative amount is a number, never escaped as a formula.
    expect(csv).toContain(",-10.00,");
  });
});
