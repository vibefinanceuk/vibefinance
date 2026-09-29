import type { InvoiceFacts } from "@vibefinance/shared";
import type { RouteResult } from "./org-route.js";
import { loadSplits } from "./coding-splits.js";
import { activePairings, loadPairings } from "./po-pairings.js";
import { scopedToChosenOrg, unitClause, unitsWherePermitted } from "./enforce.js";

/**
 * **The ERP export — decision 0552.** A CSV file of the invoices ready to
 * pay, one row per distribution: a line, or each row of a split line
 * (0548), with its supplier, amounts and Account Coding. The operator's
 * choices: a file download to start with (an API push and ERP-specific
 * layouts are planned as a later enhancement), and **payment-eligible
 * invoices, each exported once**.
 *
 * **Payment-eligible** is the definition the accruals report already
 * uses (0417): the invoice's process has completed, or it sits at its
 * process's final stage. A discarded or returned invoice is neither.
 *
 * **Each once.** An export records which invoices it took
 * (`erp_export_invoices`, one row per invoice, so no invoice can be in
 * two), and the rows it produced (`erp_export_rows`), so downloading
 * the same export again gives the same file even after an invoice is
 * later corrected.
 *
 * **The rows are the contract.** `ERP_EXPORT_COLUMNS` is the one list of
 * what a distribution carries; the CSV writes it as it is, and a later
 * API push or ERP-specific layout reads the same stored rows.
 */

export const ERP_EXPORT_COLUMNS = [
  "export_id",
  "invoice_id",
  "invoice_number",
  "issue_date",
  "due_date",
  "supplier_erp_id",
  "supplier_site",
  "supplier_name",
  "supplier_vat_id",
  "company",
  "currency",
  "invoice_net",
  "invoice_vat",
  "invoice_total",
  "po_number",
  "line_number",
  "split_row",
  "po_line",
  "description",
  "quantity",
  "unit",
  "net_amount",
  "vat_category",
  "vat_rate",
  "cost_centre",
  "project",
  "commodity_code",
  "gl_code",
] as const;

export type ErpExportRow = Record<(typeof ERP_EXPORT_COLUMNS)[number], string>;

/** Discarded or returned: never paid, so never exported. */
const NOT_PAYABLE = ["archived", "returned_manually"];

function text(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** An amount as an ERP import reads it: two places, a dot, no grouping. */
function money(v: unknown): string {
  const n = num(v);
  return n === null ? "" : n.toFixed(2);
}

/**
 * The invoices a new export would take, in the units this person may
 * export: payment-eligible and never exported.
 */
export async function eligibleInvoiceIds(db: D1Database, units: string[] | null): Promise<string[]> {
  const clause = unitClause({ units }, "h.org_unit_id");
  const rows = await db
    .prepare(
      `SELECT DISTINCT h.id AS id, h.issue_date AS issue_date
       FROM invoice_headers h
       JOIN process_instances pi ON pi.subject_type = 'invoice' AND pi.subject_id = h.id
       LEFT JOIN process_stages s ON s.id = pi.current_stage_id
       WHERE (
           pi.status = 'completed'
           OR (pi.status = 'in_progress'
               AND s.sequence = (SELECT max(s2.sequence) FROM process_stages s2 WHERE s2.process_id = pi.process_id))
         )
         AND NOT EXISTS (
           SELECT 1 FROM process_instances other
           WHERE other.subject_type = 'invoice' AND other.subject_id = h.id
             AND other.status IN (${NOT_PAYABLE.map(() => "?").join(", ")})
         )
         AND NOT EXISTS (SELECT 1 FROM erp_export_invoices e WHERE e.invoice_id = h.id)
         ${clause.sql}
       ORDER BY h.issue_date, h.id`
    )
    .bind(...NOT_PAYABLE, ...clause.binds)
    .all<{ id: string }>();
  return rows.results.map((r) => r.id);
}

/** One invoice's distributions: each line, or each row of a split line. */
export async function invoiceExportRows(db: D1Database, invoiceId: string, exportId: string): Promise<ErpExportRow[]> {
  const header = await db
    .prepare(
      `SELECT h.facts_json, h.org_unit_id, s.erp_identifier, s.erp_site_identifier, s.name AS supplier_name
       FROM invoice_headers h LEFT JOIN suppliers s ON s.id = h.supplier_id WHERE h.id = ?`
    )
    .bind(invoiceId)
    .first<{
      facts_json: string | null;
      org_unit_id: string | null;
      erp_identifier: string | null;
      erp_site_identifier: string | null;
      supplier_name: string | null;
    }>();
  if (!header) return [];
  let facts: Record<string, unknown> = {};
  try {
    facts = JSON.parse(header.facts_json || "{}") as Record<string, unknown>;
  } catch {
    // Exported with what the columns hold.
  }
  const lines = (
    await db
      .prepare("SELECT line_number, facts_json FROM invoice_lines WHERE invoice_id = ? ORDER BY line_number")
      .bind(invoiceId)
      .all<{ line_number: number; facts_json: string | null }>()
  ).results.map((l) => {
    let f: Record<string, unknown> = {};
    try {
      f = JSON.parse(l.facts_json || "{}") as Record<string, unknown>;
    } catch {
      // None.
    }
    return { lineNumber: l.line_number, facts: f };
  });
  const splits = await loadSplits(db, invoiceId);
  const pairings = activePairings(await loadPairings(db, invoiceId), facts as InvoiceFacts);

  const net = num(facts["BT-109"]) ?? num(facts["BT-106"]);
  const vat = num(facts["BT-110"]);
  const invoice = {
    export_id: exportId,
    invoice_id: invoiceId,
    invoice_number: text(facts["BT-1"]),
    issue_date: text(facts["BT-2"]),
    due_date: text(facts["BT-9"]),
    supplier_erp_id: text(header.erp_identifier),
    supplier_site: text(header.erp_site_identifier),
    supplier_name: text(header.supplier_name ?? facts["BT-27"]),
    supplier_vat_id: text(facts["BT-31"]),
    company: text(header.org_unit_id),
    currency: text(facts["BT-5"]),
    invoice_net: money(net),
    invoice_vat: money(vat),
    invoice_total: money(facts["BT-112"]),
    po_number: text(facts["BT-13"]),
  };
  // A line's coding, or the invoice's where the line holds none (per-line evaluation merges header beneath line, 0027).
  const coded = (line: Record<string, unknown>, field: string) => text(line[field]) || text(facts[field]);

  if (lines.length === 0) {
    const total = num(facts["BT-112"]);
    return [
      {
        ...invoice,
        line_number: "",
        split_row: "",
        po_line: "",
        description: "",
        quantity: "",
        unit: "",
        net_amount: money(net ?? (total !== null && vat !== null ? total - vat : total)),
        vat_category: "",
        vat_rate: "",
        cost_centre: text(facts["BT-133"]),
        project: text(facts["coding.project"]),
        commodity_code: text(facts["coding.commodity_code"]),
        gl_code: text(facts["coding.gl_code"]),
      },
    ];
  }

  const out: ErpExportRow[] = [];
  for (const { lineNumber, facts: line } of lines) {
    const pairing = pairings.get(lineNumber);
    const base = {
      ...invoice,
      line_number: String(lineNumber),
      po_line: pairing?.kind === "po_line" ? String(pairing.poLineNumber) : pairing?.kind === "non_po" ? "" : text(line["BT-132"]),
      description: text(line["BT-153"] ?? line["BT-154"]),
      quantity: text(line["BT-129"]),
      unit: text(line["BT-130"]),
      vat_category: text(line["BT-151"]),
      vat_rate: text(line["BT-152"]),
      commodity_code: coded(line, "coding.commodity_code"),
    };
    const rows = splits.get(lineNumber) ?? [];
    if (rows.length > 0) {
      for (const [i, r] of rows.entries()) {
        out.push({
          ...base,
          split_row: String(i + 1),
          // A split row's share of the quantity is not meaningful; the amount says what it takes.
          quantity: "",
          net_amount: money(r.amount),
          cost_centre: text(r.costCentre),
          project: text(r.project),
          gl_code: text(r.glCode),
        });
      }
    } else {
      out.push({
        ...base,
        split_row: "",
        net_amount: money(line["BT-131"]),
        cost_centre: coded(line, "BT-133"),
        project: coded(line, "coding.project"),
        gl_code: coded(line, "coding.gl_code"),
      });
    }
  }
  return out;
}

/**
 * RFC 4180, with a byte-order mark so Excel reads it as UTF-8. A text
 * cell that starts like a formula (`=`, `+`, `-`, `@`) is written with a
 * leading apostrophe, so a supplier's description can never run as one
 * in a spreadsheet; amounts are numbers and left alone.
 */
const NUMERIC = new Set(["invoice_net", "invoice_vat", "invoice_total", "net_amount", "quantity", "vat_rate", "line_number", "split_row"]);
export function toCsv(rows: ErpExportRow[]): string {
  const cell = (column: string, value: string) => {
    let v = value;
    if (!NUMERIC.has(column) && /^[=+\-@\t\r]/.test(v)) v = `'${v}`;
    return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const lines = [ERP_EXPORT_COLUMNS.join(","), ...rows.map((r) => ERP_EXPORT_COLUMNS.map((c) => cell(c, r[c] ?? "")).join(","))];
  return `﻿${lines.join("\r\n")}\r\n`;
}

async function exportUnits(db: D1Database, userId: string, currentOrg: string | null): Promise<string[] | null> {
  return scopedToChosenOrg(db, await unitsWherePermitted(db, userId, "AP.Export"), currentOrg);
}

/**
 * An export this person may see: every invoice in it is in a unit they
 * may export for. An export spanning units they do not hold is someone
 * else's to download.
 */
function visibleExportClause(units: string[] | null): { sql: string; binds: unknown[] } {
  if (units === null) return { sql: "", binds: [] };
  if (units.length === 0) return { sql: "AND 1 = 0", binds: [] };
  return {
    sql: `AND NOT EXISTS (
            SELECT 1 FROM erp_export_rows er JOIN invoice_headers h ON h.id = er.invoice_id
            WHERE er.export_id = x.id AND (h.org_unit_id IS NULL OR h.org_unit_id NOT IN (${units.map(() => "?").join(", ")})))`,
    binds: units,
  };
}

/** `GET /erp-exports` — what the next export would take, and the exports made so far. */
export async function handleListErpExports(db: D1Database, userId: string, currentOrg: string | null = null): Promise<RouteResult> {
  const units = await exportUnits(db, userId, currentOrg);
  const ids = await eligibleInvoiceIds(db, units);
  const pending = [];
  for (const id of ids.slice(0, 200)) {
    const h = await db
      .prepare(
        `SELECT h.id, h.invoice_number, h.currency, h.total_with_vat, h.issue_date, s.name AS supplier_name, h.facts_json
         FROM invoice_headers h LEFT JOIN suppliers s ON s.id = h.supplier_id WHERE h.id = ?`
      )
      .bind(id)
      .first<{ id: string; invoice_number: string | null; currency: string | null; total_with_vat: number | null; issue_date: string | null; supplier_name: string | null; facts_json: string | null }>();
    if (!h) continue;
    let facts: Record<string, unknown> = {};
    try {
      facts = JSON.parse(h.facts_json || "{}") as Record<string, unknown>;
    } catch {
      // Columns only.
    }
    pending.push({
      id: h.id,
      number: h.invoice_number ?? (text(facts["BT-1"]) || null),
      supplierName: h.supplier_name ?? (text(facts["BT-27"]) || null),
      issueDate: h.issue_date ?? (text(facts["BT-2"]) || null),
      currency: h.currency ?? (text(facts["BT-5"]) || null),
      total: h.total_with_vat ?? num(facts["BT-112"]),
    });
  }
  const visible = visibleExportClause(units);
  const exports = (
    await db
      .prepare(
        `SELECT x.id, x.created_at, x.invoice_count, x.row_count, u.name AS created_by_name,
                x.reversed_at, r.name AS reversed_by_name, x.reverse_reason
         FROM erp_exports x
         LEFT JOIN org_users u ON u.id = x.created_by
         LEFT JOIN org_users r ON r.id = x.reversed_by
         WHERE 1 = 1 ${visible.sql}
         ORDER BY x.created_at DESC LIMIT 50`
      )
      .bind(...visible.binds)
      .all<{
        id: string;
        created_at: string;
        invoice_count: number;
        row_count: number;
        created_by_name: string | null;
        reversed_at: string | null;
        reversed_by_name: string | null;
        reverse_reason: string | null;
      }>()
  ).results;
  return {
    status: 200,
    body: {
      pending: { count: ids.length, invoices: pending },
      exports: exports.map((x) => ({
        id: x.id,
        createdAt: x.created_at,
        createdByName: x.created_by_name,
        invoiceCount: x.invoice_count,
        rowCount: x.row_count,
        // Decision 0553 — undone: who, when, why. The file is still there to download.
        undone: x.reversed_at ? { at: x.reversed_at, byName: x.reversed_by_name, reason: x.reverse_reason } : null,
      })),
      columns: ERP_EXPORT_COLUMNS,
    },
  };
}

/**
 * `POST /erp-exports` — takes every payment-eligible invoice not yet
 * exported, in this person's units, and records the export. One batch:
 * an invoice another export took a moment earlier fails the whole batch
 * (its primary key), rather than going twice.
 */
export async function handleCreateErpExport(db: D1Database, userId: string, currentOrg: string | null = null): Promise<RouteResult> {
  const units = await exportUnits(db, userId, currentOrg);
  const ids = await eligibleInvoiceIds(db, units);
  if (ids.length === 0) {
    return { status: 409, body: { error: "There is nothing to export: no payment-eligible invoice is waiting.", reason: "nothing_to_export" } };
  }
  const exportId = crypto.randomUUID();
  const rows: { invoiceId: string; row: ErpExportRow }[] = [];
  for (const id of ids) for (const row of await invoiceExportRows(db, id, exportId)) rows.push({ invoiceId: id, row });

  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        "INSERT INTO erp_exports (id, created_by, created_at, invoice_count, row_count) VALUES (?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'), ?, ?)"
      )
      .bind(exportId, userId, ids.length, rows.length),
    ...ids.map((id) => db.prepare("INSERT INTO erp_export_invoices (invoice_id, export_id) VALUES (?, ?)").bind(id, exportId)),
    ...rows.map(({ invoiceId, row }, i) =>
      db
        .prepare("INSERT INTO erp_export_rows (export_id, seq, invoice_id, row_json) VALUES (?, ?, ?, ?)")
        .bind(exportId, i + 1, invoiceId, JSON.stringify(row))
    ),
  ];
  try {
    await db.batch(statements);
  } catch {
    return { status: 409, body: { error: "Another export took some of these invoices just now. Try again.", reason: "export_conflict" } };
  }
  return { status: 201, body: { id: exportId, invoiceCount: ids.length, rowCount: rows.length } };
}

/** `GET /erp-exports/:id/csv` — the export's own rows, as they were taken. */
export async function erpExportCsv(
  db: D1Database,
  userId: string,
  exportId: string,
  currentOrg: string | null = null
): Promise<{ status: number; csv?: string; filename?: string; body?: unknown }> {
  const units = await exportUnits(db, userId, currentOrg);
  const visible = visibleExportClause(units);
  const x = await db
    .prepare(`SELECT x.id, x.created_at FROM erp_exports x WHERE x.id = ? ${visible.sql}`)
    .bind(exportId, ...visible.binds)
    .first<{ id: string; created_at: string }>();
  if (!x) return { status: 404, body: { error: `export ${exportId} does not exist` } };
  const rows = (
    await db
      .prepare("SELECT row_json FROM erp_export_rows WHERE export_id = ? ORDER BY seq")
      .bind(exportId)
      .all<{ row_json: string }>()
  ).results.map((r) => JSON.parse(r.row_json) as ErpExportRow);
  const stamp = x.created_at.slice(0, 16).replace(/[-: ]/g, "").replace("T", "");
  return { status: 200, csv: toCsv(rows), filename: `vibefinance-erp-export-${stamp}-${exportId.slice(0, 8)}.csv` };
}

/**
 * **Undoing an export — decision 0553.** For when the file failed to
 * import on the ERP side. The whole export is undone, with a reason:
 * its invoices go back to Ready to export (so the next export takes them
 * again), and the export is kept, marked undone with who, when and why.
 * Its rows stay, so the file can still be downloaded. Each invoice's
 * Timeline says it was exported, and that the export was undone.
 */
export async function handleUndoErpExport(
  db: D1Database,
  userId: string,
  exportId: string,
  body: Record<string, unknown>,
  currentOrg: string | null = null
): Promise<RouteResult> {
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) return { status: 400, body: { error: "Say why the export is being undone.", reason: "reason_required" } };
  const units = await exportUnits(db, userId, currentOrg);
  const visible = visibleExportClause(units);
  const x = await db
    .prepare(`SELECT x.id, x.reversed_at FROM erp_exports x WHERE x.id = ? ${visible.sql}`)
    .bind(exportId, ...visible.binds)
    .first<{ id: string; reversed_at: string | null }>();
  if (!x) return { status: 404, body: { error: `export ${exportId} does not exist` } };
  if (x.reversed_at) return { status: 409, body: { error: "This export has already been undone.", reason: "already_undone" } };
  const count = await db.prepare("SELECT count(*) AS n FROM erp_export_invoices WHERE export_id = ?").bind(exportId).first<{ n: number }>();
  await db.batch([
    db.prepare("DELETE FROM erp_export_invoices WHERE export_id = ?").bind(exportId),
    db
      .prepare(
        "UPDATE erp_exports SET reversed_at = strftime('%Y-%m-%d %H:%M:%f', 'now'), reversed_by = ?, reverse_reason = ? WHERE id = ? AND reversed_at IS NULL"
      )
      .bind(userId, reason, exportId),
  ]);
  return { status: 200, body: { id: exportId, invoicesReleased: count?.n ?? 0 } };
}
