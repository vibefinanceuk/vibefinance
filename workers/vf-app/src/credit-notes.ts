import { isCreditNote } from "@vibefinance/shared";
import type { RouteResult } from "./org-route.js";
import { hasPermission } from "./enforce.js";

/**
 * **A credit note and the invoice it credits — decision 0731.**
 *
 * A credit note names the invoice it credits (BT-25, read since 0730).
 * When it is captured, that invoice is looked for: the same supplier (by
 * VAT number, else by name), that invoice number, an invoice and not
 * another credit note. What then happens to the invoice is what AP Setup
 * › Credit Notes says (`credit_note_config`):
 *
 * - **in full, unpaid:** `take_out` marks the invoice Credited at once
 *   (its process instance `credited`, its open tasks cancelled, so it is
 *   never exported for payment); `confirm` holds it until someone in the
 *   chosen team confirms;
 * - **for part of it:** `pay` lets it go on to be paid, the ERP netting
 *   the credit; `hold` holds it until confirmed;
 * - **not found:** `review` waits for AP to say which invoice, or to
 *   process it against none; `process` goes on against none;
 * - **already gone for payment** (exported or delivered): always kept as
 *   a credit with the supplier, and the invoice marked Credited;
 * - **already returned or discarded:** Credited, the natural close of a
 *   return (the supplier corrected it with a credit note).
 *
 * While a credit note is to be confirmed, neither it nor its invoice is
 * exported. One row per credit note (`credit_notes`), written once:
 * reading the document again does not decide it again.
 */

export interface CreditNoteConfig {
  fullUnpaid: "take_out" | "confirm";
  partial: "pay" | "hold";
  notFound: "review" | "process";
  confirmTeamId: string | null;
  networkAllowed: boolean;
}

const DEFAULTS: CreditNoteConfig = { fullUnpaid: "confirm", partial: "pay", notFound: "review", confirmTeamId: null, networkAllowed: true };

export async function loadCreditNoteConfig(db: D1Database): Promise<CreditNoteConfig> {
  const row = await db
    .prepare("SELECT full_unpaid, partial, not_found, confirm_team_id, network_allowed FROM credit_note_config WHERE id = 'default'")
    .first<{ full_unpaid: string; partial: string; not_found: string; confirm_team_id: string | null; network_allowed: number }>();
  if (!row) return DEFAULTS;
  return {
    fullUnpaid: row.full_unpaid === "take_out" ? "take_out" : "confirm",
    partial: row.partial === "hold" ? "hold" : "pay",
    notFound: row.not_found === "process" ? "process" : "review",
    confirmTeamId: row.confirm_team_id,
    networkAllowed: row.network_allowed !== 0,
  };
}

/** `GET /credit-note-config` — the settings, and the teams one may confirm. */
export async function handleGetCreditNoteConfig(db: D1Database): Promise<RouteResult> {
  const teams = (await db.prepare("SELECT id, name FROM org_teams ORDER BY name").all<{ id: string; name: string }>()).results;
  return { status: 200, body: { config: await loadCreditNoteConfig(db), teams } };
}

/** `PUT /credit-note-config` — Admin.Configure, as the rest of AP Setup. */
export async function handlePutCreditNoteConfig(db: D1Database, userId: string, body: Partial<CreditNoteConfig>): Promise<RouteResult> {
  const now = await loadCreditNoteConfig(db);
  const next: CreditNoteConfig = { ...now, ...body };
  if (!["take_out", "confirm"].includes(next.fullUnpaid) || !["pay", "hold"].includes(next.partial) || !["review", "process"].includes(next.notFound)) {
    return { status: 400, body: { error: "fullUnpaid, partial and notFound take one of their two values" } };
  }
  if (next.confirmTeamId) {
    const team = await db.prepare("SELECT 1 FROM org_teams WHERE id = ?").bind(next.confirmTeamId).first();
    if (!team) return { status: 400, body: { error: "no such team" } };
  }
  await db
    .prepare(
      `INSERT INTO credit_note_config (id, full_unpaid, partial, not_found, confirm_team_id, network_allowed, updated_by, updated_at)
       VALUES ('default', ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET full_unpaid = excluded.full_unpaid, partial = excluded.partial, not_found = excluded.not_found,
         confirm_team_id = excluded.confirm_team_id, network_allowed = excluded.network_allowed, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
    )
    .bind(next.fullUnpaid, next.partial, next.notFound, next.confirmTeamId || null, next.networkAllowed ? 1 : 0, userId, new Date().toISOString())
    .run();
  return { status: 200, body: { config: await loadCreditNoteConfig(db) } };
}

// ---------------------------------------------------------------------------

export interface CreditedInvoice {
  id: string;
  number: string;
  total: number | null;
  instanceStatus: string | null;
  sentForPayment: boolean;
}

export interface CreditMatch {
  reference: string | null;
  invoice: CreditedInvoice | null;
  covers: "full" | "partial" | null;
}

const text = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" ? String(v) : null);
const amount = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : null);

/** The invoice a credit note's BT-25 names, from the same supplier. */
export async function findCreditedInvoice(db: D1Database, creditNoteId: string, facts: Record<string, unknown>, invoiceNumber: string | null = null): Promise<CreditMatch> {
  const reference = invoiceNumber ?? text(facts["BT-25"]);
  if (!reference) return { reference: null, invoice: null, covers: null };
  const vat = text(facts["BT-31"]);
  const name = text(facts["BT-27"]);
  /**
   * **The same supplier, however each document wrote it** (found live,
   * 11 October: a credit note from the network says GB111350965 where the
   * invoice read from email said 111350965). Any of: the VAT number
   * without its country prefix and spaces; the seller's name; the
   * supplier either is matched to (this one's own, or the one whose VAT
   * number it carries).
   */
  const bareVat = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^[A-Z]{2}(?=\d)/, "");
  const BARE_SQL = (col: string) =>
    `(CASE WHEN upper(replace(replace(${col}, ' ', ''), '.', '')) GLOB '[A-Z][A-Z][0-9]*' THEN substr(upper(replace(replace(${col}, ' ', ''), '.', '')), 3) ELSE upper(replace(replace(${col}, ' ', ''), '.', '')) END)`;
  const own = await db.prepare("SELECT supplier_id FROM invoice_headers WHERE id = ?").bind(creditNoteId).first<{ supplier_id: string | null }>();
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (vat) {
    clauses.push(`${BARE_SQL("h.supplier_vat_id")} = ?`, `h.supplier_id IN (SELECT s.id FROM suppliers s WHERE s.vat_id IS NOT NULL AND ${BARE_SQL("s.vat_id")} = ?)`);
    binds.push(bareVat(vat), bareVat(vat));
  }
  if (name) {
    clauses.push(`lower(trim(json_extract(h.facts_json, '$."BT-27"'))) = lower(?)`);
    binds.push(name);
  }
  if (own?.supplier_id) {
    clauses.push("h.supplier_id = ?");
    binds.push(own.supplier_id);
  }
  const where = clauses.join(" OR ");
  if (!where) return { reference, invoice: null, covers: null };
  const row = await db
    .prepare(
      `SELECT h.id, h.invoice_number, h.total_with_vat, pi.status AS instance_status,
              EXISTS (SELECT 1 FROM erp_export_invoices e WHERE e.invoice_id = h.id) OR
              EXISTS (SELECT 1 FROM destination_deliveries d WHERE d.invoice_id = h.id AND d.status = 'delivered') AS sent
       FROM invoice_headers h
       LEFT JOIN process_instances pi ON pi.subject_type = 'invoice' AND pi.subject_id = h.id
       WHERE h.id != ? AND h.document_kind = 'invoice' AND h.invoice_number = ? AND (${where})
       ORDER BY h.created_at DESC LIMIT 1`
    )
    .bind(creditNoteId, reference, ...binds)
    .first<{ id: string; invoice_number: string; total_with_vat: number | null; instance_status: string | null; sent: number }>();
  if (!row) return { reference, invoice: null, covers: null };
  const credit = amount(facts["BT-112"]);
  const covers = credit !== null && row.total_with_vat !== null && credit + 0.005 >= row.total_with_vat ? "full" : "partial";
  return {
    reference,
    invoice: { id: row.id, number: row.invoice_number, total: row.total_with_vat, instanceStatus: row.instance_status, sentForPayment: row.sent === 1 },
    covers,
  };
}

/** What a rule can test on a credit note: whether its invoice was found, and whether it credits it in full. */
export function creditFacts(match: CreditMatch): Record<string, string | boolean> {
  return { "creditNote.originalFound": match.invoice !== null, "creditNote.covers": match.covers ?? "none" };
}

/** The invoice is Credited: out of payment, its open tasks cancelled. */
async function markCredited(db: D1Database, invoiceId: string, userId: string | null, creditNumber: string | null): Promise<void> {
  const now = new Date().toISOString();
  const instance = await db
    .prepare("SELECT id FROM process_instances WHERE subject_type = 'invoice' AND subject_id = ? ORDER BY rowid DESC LIMIT 1")
    .bind(invoiceId)
    .first<{ id: string }>();
  if (!instance) return;
  await db
    .prepare("UPDATE process_instances SET status = 'credited', ended_by = ?, ended_at = ?, end_reason = ? WHERE id = ?")
    .bind(userId, now, `credited${creditNumber ? ` by ${creditNumber}` : ""}`, instance.id)
    .run();
  await db
    .prepare(
      `UPDATE tasks SET status = 'cancelled', ended_at = ?, end_reason = 'the invoice was credited'
       WHERE status = 'open' AND stage_visit_id IN (SELECT id FROM stage_visits WHERE process_instance_id = ?)`
    )
    .bind(now, instance.id)
    .run();
}

const TERMINAL_UNPAID = new Set(["returned_manually", "archived"]);

/**
 * Decide, once, what a just-captured credit note does to its invoice.
 * Nothing for an invoice, or for a credit note already decided.
 */
export async function settleCreditNote(db: D1Database, creditNoteId: string, facts: Record<string, unknown>, match?: CreditMatch): Promise<void> {
  if (!isCreditNote(facts)) return;
  const done = await db.prepare("SELECT 1 FROM credit_notes WHERE credit_note_id = ?").bind(creditNoteId).first();
  if (done) return;
  const found = match ?? (await findCreditedInvoice(db, creditNoteId, facts));
  const config = await loadCreditNoteConfig(db);
  const invoice = found.invoice;
  let state: "credited" | "netted" | "to_confirm" | "unmatched";
  let afterPayment = false;
  if (!invoice) state = config.notFound === "review" ? "to_confirm" : "unmatched";
  else if (invoice.instanceStatus === "credited") state = "netted";
  else if (invoice.sentForPayment) {
    state = "credited";
    afterPayment = true;
  } else if (invoice.instanceStatus && TERMINAL_UNPAID.has(invoice.instanceStatus)) state = "credited";
  else if (found.covers === "full") state = config.fullUnpaid === "take_out" ? "credited" : "to_confirm";
  else state = config.partial === "pay" ? "netted" : "to_confirm";

  await db
    .prepare(
      `INSERT INTO credit_notes (credit_note_id, reference, invoice_id, covers, state, after_payment, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (credit_note_id) DO NOTHING`
    )
    .bind(creditNoteId, found.reference, invoice?.id ?? null, found.covers, state, afterPayment ? 1 : 0, new Date().toISOString())
    .run();
  if (state === "credited" && invoice) await markCredited(db, invoice.id, null, text(facts["BT-1"]));
}

// ---------------------------------------------------------------------------

/** Who may confirm: the chosen team's members, or, with no team chosen, anyone with Admin.Configure. */
export async function mayConfirm(db: D1Database, userId: string): Promise<boolean> {
  const { confirmTeamId } = await loadCreditNoteConfig(db);
  if (confirmTeamId) {
    const member = await db.prepare("SELECT 1 FROM org_team_members WHERE team_id = ? AND user_id = ?").bind(confirmTeamId, userId).first();
    if (member) return true;
  }
  return hasPermission(db, userId, "Admin.Configure");
}

interface CreditRow {
  credit_note_id: string;
  reference: string | null;
  invoice_id: string | null;
  covers: string | null;
  state: string;
  after_payment: number;
  decided_by_name: string | null;
  decided_at: string | null;
  created_at: string;
  cn_number: string | null;
  cn_total: number | null;
  cn_currency: string | null;
  cn_facts: string | null;
  supplier_name: string | null;
  inv_number: string | null;
  inv_total: number | null;
}

const CREDIT_SELECT = `
  SELECT c.credit_note_id, c.reference, c.invoice_id, c.covers, c.state, c.after_payment, c.decided_at, c.created_at,
         u.name AS decided_by_name,
         cn.invoice_number AS cn_number, cn.total_with_vat AS cn_total, cn.currency AS cn_currency, cn.facts_json AS cn_facts,
         COALESCE(s.name, json_extract(cn.facts_json, '$."BT-27"')) AS supplier_name,
         inv.invoice_number AS inv_number, inv.total_with_vat AS inv_total
  FROM credit_notes c
  JOIN invoice_headers cn ON cn.id = c.credit_note_id
  LEFT JOIN suppliers s ON s.id = cn.supplier_id
  LEFT JOIN invoice_headers inv ON inv.id = c.invoice_id
  LEFT JOIN org_users u ON u.id = c.decided_by`;

function shape(r: CreditRow) {
  let note: string | null = null;
  try {
    note = text((JSON.parse(r.cn_facts || "{}") as Record<string, unknown>)["BT-22"]);
  } catch {
    // None.
  }
  return {
    creditNoteId: r.credit_note_id,
    creditNoteNumber: r.cn_number,
    total: r.cn_total,
    currency: r.cn_currency,
    supplierName: r.supplier_name,
    note,
    reference: r.reference,
    invoice: r.invoice_id ? { id: r.invoice_id, number: r.inv_number, total: r.inv_total } : null,
    covers: r.covers,
    state: r.state,
    afterPayment: r.after_payment === 1,
    decidedBy: r.decided_by_name,
    decidedAt: r.decided_at,
    createdAt: r.created_at,
  };
}

export type CreditView = ReturnType<typeof shape>;

/** `GET /credit-notes/to-confirm` — what is waiting, for someone who may decide it. */
export async function handleListCreditsToConfirm(db: D1Database, userId: string): Promise<RouteResult> {
  if (!(await mayConfirm(db, userId))) return { status: 200, body: { credits: [], mayConfirm: false } };
  const rows = (await db.prepare(`${CREDIT_SELECT} WHERE c.state = 'to_confirm' ORDER BY c.created_at`).all<CreditRow>()).results;
  return { status: 200, body: { credits: rows.map(shape), mayConfirm: true } };
}

/** The credit note side of one document: its own credit, or the credits against it (for the viewer). */
export async function creditsFor(db: D1Database, invoiceId: string, userId?: string) {
  const own = await db.prepare(`${CREDIT_SELECT} WHERE c.credit_note_id = ?`).bind(invoiceId).first<CreditRow>();
  const against = (await db.prepare(`${CREDIT_SELECT} WHERE c.invoice_id = ? ORDER BY c.created_at`).bind(invoiceId).all<CreditRow>()).results;
  const waiting = own?.state === "to_confirm" || against.some((r) => r.state === "to_confirm");
  return {
    credit: own ? shape(own) : null,
    creditedBy: against.map(shape),
    mayConfirm: waiting && userId ? await mayConfirm(db, userId) : false,
  };
}

/**
 * `POST /credit-notes/:id/decide` — `{ decision }`:
 * - `credit`: the invoice is Credited;
 * - `pay`: the invoice goes on to be paid, the ERP netting the credit;
 * - `link` with `invoiceNumber`: for one whose invoice was not found, this
 *   is it (then waits for `credit` or `pay`);
 * - `none`: processed against no invoice.
 */
export async function handleDecideCredit(
  db: D1Database,
  userId: string,
  creditNoteId: string,
  body: { decision?: string; invoiceNumber?: string }
): Promise<RouteResult> {
  if (!(await mayConfirm(db, userId))) return { status: 403, body: { error: "only the team AP Setup names may confirm credit notes" } };
  const row = await db.prepare("SELECT state, invoice_id FROM credit_notes WHERE credit_note_id = ?").bind(creditNoteId).first<{ state: string; invoice_id: string | null }>();
  if (!row) return { status: 404, body: { error: "not a credit note" } };
  if (row.state !== "to_confirm") return { status: 409, body: { error: "already decided", reason: "decided" } };
  const now = new Date().toISOString();
  const decided = (state: string) =>
    db.prepare("UPDATE credit_notes SET state = ?, decided_by = ?, decided_at = ? WHERE credit_note_id = ?").bind(state, userId, now, creditNoteId).run();

  if (body.decision === "link") {
    const header = await db.prepare("SELECT facts_json FROM invoice_headers WHERE id = ?").bind(creditNoteId).first<{ facts_json: string | null }>();
    const facts = JSON.parse(header?.facts_json || "{}") as Record<string, unknown>;
    const number = text(body.invoiceNumber);
    if (!number) return { status: 400, body: { error: "invoiceNumber is required", reason: "number" } };
    const match = await findCreditedInvoice(db, creditNoteId, facts, number);
    if (!match.invoice) return { status: 404, body: { error: "no invoice with that number from this supplier", reason: "not_found" } };
    await db
      .prepare("UPDATE credit_notes SET reference = ?, invoice_id = ?, covers = ? WHERE credit_note_id = ?")
      .bind(number, match.invoice.id, match.covers, creditNoteId)
      .run();
    return { status: 200, body: { credit: (await creditsFor(db, creditNoteId, userId)).credit } };
  }
  if (body.decision === "none") {
    if (row.invoice_id) return { status: 409, body: { error: "this credit note has its invoice", reason: "has_invoice" } };
    await decided("unmatched");
  } else if (body.decision === "credit" || body.decision === "pay") {
    if (!row.invoice_id) return { status: 409, body: { error: "say which invoice first", reason: "no_invoice" } };
    await decided(body.decision === "credit" ? "credited" : "netted");
    if (body.decision === "credit") {
      const cn = await db.prepare("SELECT invoice_number FROM invoice_headers WHERE id = ?").bind(creditNoteId).first<{ invoice_number: string | null }>();
      await markCredited(db, row.invoice_id, userId, cn?.invoice_number ?? null);
    }
  } else {
    return { status: 400, body: { error: "decision is one of credit, pay, link, none" } };
  }
  return { status: 200, body: { credit: (await creditsFor(db, creditNoteId, userId)).credit } };
}

/** SQL: not exported while a credit note about it is to be confirmed (either side). */
export const NOT_WAITING_ON_CREDIT = `NOT EXISTS (SELECT 1 FROM credit_notes cw WHERE cw.state = 'to_confirm' AND (cw.credit_note_id = h.id OR cw.invoice_id = h.id))`;

/** The Timeline's lines: on a credit note, what it credits; on an invoice, what credited it. */
export async function creditEvents(db: D1Database, invoiceId: string) {
  const { credit, creditedBy } = await creditsFor(db, invoiceId);
  const items: Array<Record<string, unknown>> = [];
  if (credit) {
    items.push({ kind: "action_taken", at: credit.createdAt, action: `credit_${credit.state}`, userName: "", invoiceNumber: credit.invoice?.number ?? credit.reference ?? "", covers: credit.covers });
    if (credit.decidedAt) items.push({ kind: "action_taken", at: credit.decidedAt, action: `credit_decided_${credit.state}`, userName: credit.decidedBy ?? "", invoiceNumber: credit.invoice?.number ?? "" });
  }
  for (const c of creditedBy) {
    if (c.state === "credited") items.push({ kind: "action_taken", at: c.decidedAt ?? c.createdAt, action: "credited_by", userName: c.decidedBy ?? "", invoiceNumber: c.creditNoteNumber ?? "" });
    else if (c.state === "to_confirm") items.push({ kind: "action_taken", at: c.createdAt, action: "credit_held", userName: "", invoiceNumber: c.creditNoteNumber ?? "" });
    else if (c.state === "netted") items.push({ kind: "action_taken", at: c.decidedAt ?? c.createdAt, action: "netted_by", userName: c.decidedBy ?? "", invoiceNumber: c.creditNoteNumber ?? "" });
  }
  return items;
}
