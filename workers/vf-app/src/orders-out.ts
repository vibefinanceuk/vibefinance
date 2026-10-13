import { writeUblOrder, type OrderParty, type ParsedOrder } from "@vibefinance/shared";
import type { RouteResult } from "./org-route.js";
import { sendEmailViaResend } from "./resend-client.js";
import { addRouteEvent, finishRouteMessage, openOutboundMessage, routePartKey, storeRoutePart } from "./route-messages.js";
import { coveredUnits, covers, unitIdsOf } from "./destination-units.js";
import { ORDER_SUPPLIER_ID } from "./order-supplier.js";
import { orderEvent, type OrderDiff } from "./order-history.js";
import { orderCsv, orderPdf } from "./order-pdf.js";
import { confirmUrl, newConfirmToken, orderConfirmation } from "./order-confirm.js";

/**
 * **Orders to suppliers — decision 0759**, slice 4a of purchase orders.
 *
 * A Destination on the Purchase Orders process (`orders-email-out`) that
 * emails each released order, change and cancellation to the supplier,
 * with the order attached as Peppol BIS Order Only 3 UBL. Automatically on
 * release where its setting says so (the five-minute cron, and straight
 * after a release by hand), and by hand from the order (*Send to
 * supplier*), which also sends again.
 *
 * **Who it goes to**, in a fixed order, so it is predictable (Dan, 13
 * October 2026):
 *
 * 1. the address the order itself gives for the supplier (UBL's seller
 *    contact, or the order CSV's *Supplier email*);
 * 2. the supplier's orders address (`suppliers.orders_email`);
 * 3. the supplier's general email (0219);
 * 4. none: nothing is sent, and the order's Timeline says so; Purchasing
 *    can give an address and send it by hand.
 *
 * A supplier whose orders the customer's own procurement system sends
 * (`send_orders = 0`) is not sent one automatically; by hand still sends.
 *
 * Replies go to the order's buyer, or the Purchasing mailbox the
 * Destination gives; the buyer may be copied. Every send is an outbound
 * route message (the email and the UBL kept as its parts, in the Route
 * monitor and on the order's Attachments), a row in
 * `purchase_order_sends`, and an entry on the order's Timeline.
 */

export const ORDERS_OUT = "orders-email-out";

export interface OrdersOutSettings {
  sendOnRelease: boolean;
  replyTo: string | null;
  ccBuyer: boolean;
  attachUbl: boolean;
  /** Decision 0760: the order as a PDF, for people to read. */
  attachPdf: boolean;
}

export const DEFAULT_ORDERS_OUT: OrdersOutSettings = { sendOnRelease: true, replyTo: null, ccBuyer: true, attachUbl: true, attachPdf: true };

export interface OrdersOutDeps {
  email: { apiKey: string; from: string } | null;
  bucket?: R2Bucket | null;
  customerId?: string | null;
  send?: typeof sendEmailViaResend;
  now?: () => Date;
  /**
   * Decision 0762: where the email's *Confirm receipt* link goes — the
   * supplier network's confirm page, and which instance this is. Without
   * it the email has no link, and the order is confirmed in the supplier
   * network only.
   */
  confirm?: { networkUrl: string; environmentId: string } | null;
}

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/** One or more addresses, however separated; only those that could be one. */
export function addresses(value: string | null | undefined): string[] {
  return [...new Set((value ?? "").split(/[,;\s]+/).map((a) => a.trim().toLowerCase()).filter((a) => EMAIL.test(a)))];
}

export function settingsOf(json: string | null | undefined): OrdersOutSettings {
  let s: Partial<OrdersOutSettings> = {};
  try {
    s = json ? (JSON.parse(json) as Partial<OrdersOutSettings>) : {};
  } catch {
    s = {};
  }
  return {
    sendOnRelease: typeof s.sendOnRelease === "boolean" ? s.sendOnRelease : DEFAULT_ORDERS_OUT.sendOnRelease,
    replyTo: typeof s.replyTo === "string" && addresses(s.replyTo).length ? addresses(s.replyTo)[0] : null,
    ccBuyer: typeof s.ccBuyer === "boolean" ? s.ccBuyer : DEFAULT_ORDERS_OUT.ccBuyer,
    attachUbl: typeof s.attachUbl === "boolean" ? s.attachUbl : DEFAULT_ORDERS_OUT.attachUbl,
    attachPdf: typeof s.attachPdf === "boolean" ? s.attachPdf : DEFAULT_ORDERS_OUT.attachPdf,
  };
}

interface Instance {
  id: string;
  status: string | null;
  started_at: string | null;
  settings_json: string | null;
  unit_ids: string | null;
}

/** The Purchase Orders process's Orders to suppliers, where it has one that is not retired. */
export async function ordersOutInstance(db: D1Database): Promise<Instance | null> {
  return db
    .prepare(`SELECT id, status, started_at, settings_json, unit_ids FROM route_instances WHERE route_id = ? AND source_id IS NULL AND (status IS NULL OR status != 'retired') ORDER BY created_at LIMIT 1`)
    .bind(ORDERS_OUT)
    .first<Instance>();
}

// ── Who it goes to ─────────────────────────────────────────────────────

interface SupplierRow {
  id: string;
  name: string;
  email: string | null;
  orders_email: string | null;
  send_orders: number;
  country: string | null;
  vat_id: string | null;
  electronic_address: string | null;
  address_line: string | null;
  city: string | null;
  postal_code: string | null;
  phone: string | null;
  erp_identifier: string | null;
}

export type AddressFrom = "order" | "orders_email" | "supplier_email" | "given";

export interface Recipients {
  to: string[];
  from: AddressFrom | null;
  supplier: SupplierRow | null;
  /** The customer's own system sends this supplier its orders. */
  supplierSendsOwn: boolean;
}

async function supplierOfOrder(db: D1Database, sellerPartyId: string | null): Promise<SupplierRow | null> {
  if (!sellerPartyId) return null;
  return db
    .prepare(
      `SELECT id, name, email, orders_email, send_orders, country, vat_id, electronic_address, address_line, city, postal_code, phone, erp_identifier
       FROM suppliers WHERE id = ${ORDER_SUPPLIER_ID("?1")}`
    )
    .bind(sellerPartyId)
    .first<SupplierRow>();
}

/** Who an order goes to, by the fixed order of preference. */
export async function orderRecipients(db: D1Database, orderNumber: string): Promise<Recipients | null> {
  const po = await db.prepare("SELECT seller_party_id, supplier_email FROM purchase_orders WHERE order_number = ?").bind(orderNumber).first<{ seller_party_id: string | null; supplier_email: string | null }>();
  if (!po) return null;
  const supplier = await supplierOfOrder(db, po.seller_party_id);
  const supplierSendsOwn = supplier?.send_orders === 0;
  for (const [from, value] of [
    ["order", po.supplier_email],
    ["orders_email", supplier?.orders_email],
    ["supplier_email", supplier?.email],
  ] as const) {
    const to = addresses(value);
    if (to.length) return { to, from, supplier, supplierSendsOwn };
  }
  return { to: [], from: null, supplier, supplierSendsOwn };
}

// ── The order, as sent ─────────────────────────────────────────────────

interface OrderRow {
  id: string;
  order_number: string;
  issue_date: string | null;
  order_type_code: string | null;
  currency: string | null;
  seller_party_id: string | null;
  buyer_party_id: string | null;
  line_extension_amount: number | null;
  tax_exclusive_amount: number | null;
  tax_inclusive_amount: number | null;
  payable_amount: number | null;
  originator_reference: string | null;
  org_unit_id: string | null;
  buyer_user_id: string | null;
  supplier_email: string | null;
  status: string;
}

interface Company {
  name: string | null;
  vatId: string | null;
  endpoint: string | null;
  addressLine: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
}

/** The company that placed the order: its own unit, filled in from the legal entity above it. */
async function companyOf(db: D1Database, unitId: string | null): Promise<Company> {
  const empty: Company = { name: null, vatId: null, endpoint: null, addressLine: null, city: null, postalCode: null, country: null, email: null, phone: null };
  if (!unitId) return empty;
  const chain = (
    await db
      .prepare(
        `WITH RECURSIVE up(id, parent_unit_id, depth) AS (
           SELECT id, parent_unit_id, 0 FROM org_units WHERE id = ?
           UNION ALL SELECT u.id, u.parent_unit_id, up.depth + 1 FROM org_units u JOIN up ON u.id = up.parent_unit_id WHERE up.depth < 20
         ) SELECT o.name, o.kind, o.vat_id, o.buyer_endpoint, o.address_line, o.city, o.postal_code, o.country, o.email, o.phone
           FROM up JOIN org_units o ON o.id = up.id ORDER BY up.depth`
      )
      .bind(unitId)
      .all<Record<string, string | null>>()
  ).results;
  if (!chain.length) return empty;
  const entity = chain.find((u) => u.kind === "legal_entity") ?? chain[chain.length - 1];
  const pick = (k: string) => chain.find((u) => u[k])?.[k] ?? null;
  return {
    name: entity.name,
    vatId: entity.vat_id ?? pick("vat_id"),
    endpoint: entity.buyer_endpoint ?? pick("buyer_endpoint"),
    addressLine: pick("address_line"),
    city: pick("city"),
    postalCode: pick("postal_code"),
    country: pick("country"),
    email: pick("email"),
    phone: pick("phone"),
  };
}

interface Line {
  line_number: number;
  quantity: number | null;
  unit_code: string | null;
  line_extension_amount: number | null;
  item_name: string | null;
  item_description: string | null;
  sellers_item_id: string | null;
  standard_item_id: string | null;
  price_amount: number | null;
  base_quantity: number | null;
}

export interface OrderDocument {
  order: OrderRow;
  lines: Line[];
  company: Company;
  supplier: SupplierRow | null;
  buyer: { name: string; email: string | null } | null;
  parsed: ParsedOrder;
  ubl: string;
}

const u = <T>(v: T | null) => (v === null ? undefined : v);

/** The order as it stands, with its parties, and its UBL. Null where there is no such order. */
export async function orderDocument(db: D1Database, orderNumber: string, note: string | null = null): Promise<OrderDocument | null> {
  const order = await db.prepare("SELECT * FROM purchase_orders WHERE order_number = ?").bind(orderNumber).first<OrderRow>();
  if (!order) return null;
  const lines = (await db.prepare("SELECT * FROM purchase_order_lines WHERE purchase_order_id = ? ORDER BY line_number").bind(order.id).all<Line>()).results;
  const [company, supplier, buyer] = await Promise.all([
    companyOf(db, order.org_unit_id),
    supplierOfOrder(db, order.seller_party_id),
    order.buyer_user_id ? db.prepare("SELECT name, email FROM org_users WHERE id = ?").bind(order.buyer_user_id).first<{ name: string; email: string | null }>() : Promise.resolve(null),
  ]);
  const parsed: ParsedOrder = {
    orderNumber: order.order_number,
    issueDate: u(order.issue_date),
    orderTypeCode: u(order.order_type_code),
    currency: u(order.currency),
    sellerPartyId: u(order.seller_party_id),
    sellerContactEmail: u(order.supplier_email),
    buyerPartyId: u(order.buyer_party_id),
    lineExtensionAmount: u(order.line_extension_amount),
    taxExclusiveAmount: u(order.tax_exclusive_amount),
    taxInclusiveAmount: u(order.tax_inclusive_amount),
    payableAmount: u(order.payable_amount),
    originatorReference: u(order.originator_reference),
    lines: lines.map((l) => ({
      lineNumber: l.line_number,
      quantity: u(l.quantity),
      unitCode: u(l.unit_code),
      lineExtensionAmount: u(l.line_extension_amount),
      itemName: u(l.item_name),
      itemDescription: u(l.item_description),
      sellersItemId: u(l.sellers_item_id),
      standardItemId: u(l.standard_item_id),
      priceAmount: u(l.price_amount),
      baseQuantity: u(l.base_quantity),
    })),
  };
  const buyerParty: OrderParty = { id: order.buyer_party_id, ...company };
  const sellerParty: OrderParty = supplier
    ? { id: order.seller_party_id, name: supplier.name, vatId: supplier.vat_id, endpoint: supplier.electronic_address, addressLine: supplier.address_line, city: supplier.city, postalCode: supplier.postal_code, country: supplier.country, phone: supplier.phone }
    : { id: order.seller_party_id };
  const ubl = writeUblOrder({ ...parsed, buyer: buyerParty, seller: sellerParty, note });
  return { order, lines, company, supplier, buyer: buyer ?? null, parsed, ubl };
}

// ── The email ──────────────────────────────────────────────────────────

type Locale = "en" | "de";
export type OrderKind = "order" | "change" | "cancellation";

const WORDS: Record<Locale, Record<string, string>> = {
  en: {
    "subject.order": "Purchase order {number} from {company}",
    "subject.change": "Change to purchase order {number} from {company}",
    "subject.cancellation": "Cancellation of purchase order {number} from {company}",
    hello: "Hello,",
    "lead.order": "{company} has placed purchase order {number} with you.",
    "lead.change": "{company} has changed purchase order {number}. This replaces the order sent before.",
    "lead.cancellation": "{company} has cancelled purchase order {number}. Please do not deliver or invoice it.",
    ubl: "The order is attached as a Peppol BIS order (UBL), for your system to read.",
    pdf: "The order is attached as a PDF.",
    reply: "Reply to this email to reach {who}.",
    number: "Order number",
    date: "Order date",
    requisition: "Requisition",
    total: "Total",
    line: "Line",
    item: "Item",
    youritem: "Your item number",
    quantity: "Quantity",
    unit: "Unit",
    price: "Price",
    amount: "Amount",
    footer: "Sent for {company} by VibeFinance.",
    buyer: "the buyer",
    "confirm.order": "Please confirm you have received this order:",
    "confirm.change": "Please confirm you have received this change:",
    "confirm.cancellation": "Please confirm you have received this cancellation:",
    confirmbutton: "Confirm receipt",
  },
  de: {
    "subject.order": "Bestellung {number} von {company}",
    "subject.change": "Änderung der Bestellung {number} von {company}",
    "subject.cancellation": "Stornierung der Bestellung {number} von {company}",
    hello: "Guten Tag,",
    "lead.order": "{company} hat bei Ihnen die Bestellung {number} aufgegeben.",
    "lead.change": "{company} hat die Bestellung {number} geändert. Sie ersetzt die zuvor gesendete Bestellung.",
    "lead.cancellation": "{company} hat die Bestellung {number} storniert. Bitte weder liefern noch fakturieren.",
    ubl: "Die Bestellung ist als Peppol-BIS-Bestellung (UBL) beigefügt, zum Einlesen in Ihr System.",
    pdf: "Die Bestellung ist als PDF beigefügt.",
    reply: "Antworten Sie auf diese E-Mail, um {who} zu erreichen.",
    number: "Bestellnummer",
    date: "Bestelldatum",
    requisition: "Bedarfsanforderung",
    total: "Summe",
    line: "Pos.",
    item: "Artikel",
    youritem: "Ihre Artikelnummer",
    quantity: "Menge",
    unit: "Einheit",
    price: "Preis",
    amount: "Betrag",
    footer: "Für {company} von VibeFinance gesendet.",
    buyer: "den Besteller",
    "confirm.order": "Bitte bestätigen Sie den Empfang dieser Bestellung:",
    "confirm.change": "Bitte bestätigen Sie den Empfang dieser Änderung:",
    "confirm.cancellation": "Bitte bestätigen Sie den Empfang dieser Stornierung:",
    confirmbutton: "Empfang bestätigen",
  },
};

const GERMAN = new Set(["DE", "AT", "CH", "LI"]);
const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (m, k: string) => v[k] ?? m);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function money(n: number | null | undefined, currency: string | null, locale: Locale): string {
  if (typeof n !== "number") return "—";
  try {
    return new Intl.NumberFormat(locale === "de" ? "de-DE" : "en-GB", { style: "currency", currency: currency || "EUR" }).format(n);
  } catch {
    return n.toFixed(2);
  }
}
const qty = (n: number | null) => (typeof n === "number" ? (Number.isInteger(n) ? String(n) : String(Math.round(n * 1e6) / 1e6)) : "—");

/** The email for one order, in the supplier's language. Exported for its test. */
export function orderEmail(doc: OrderDocument, kind: OrderKind, opts: { replyTo: string | null; attachUbl: boolean; attachPdf?: boolean; confirmUrl?: string | null }): { subject: string; text: string; html: string; locale: Locale } {
  const locale: Locale = GERMAN.has((doc.supplier?.country ?? "").toUpperCase()) ? "de" : "en";
  const w = WORDS[locale];
  const company = doc.company.name ?? "";
  const v = { number: doc.order.order_number, company, who: doc.buyer?.name ?? opts.replyTo ?? w.buyer };
  const subject = fill(w[`subject.${kind}`], v);
  const facts: [string, string][] = (
    [
      [w.number, doc.order.order_number],
      [w.date, doc.order.issue_date],
      [w.requisition, doc.order.originator_reference],
      [w.total, typeof doc.order.payable_amount === "number" ? money(doc.order.payable_amount, doc.order.currency, locale) : null],
    ] as [string, string | null][]
  ).filter((f): f is [string, string] => Boolean(f[1]));
  const cols = [w.line, w.item, w.youritem, w.quantity, w.unit, w.price, w.amount];
  const rows = doc.lines.map((l) => [
    String(l.line_number),
    l.item_name ?? l.item_description ?? "—",
    l.sellers_item_id ?? "—",
    qty(l.quantity),
    l.unit_code ?? "—",
    money(l.price_amount, doc.order.currency, locale),
    money(l.line_extension_amount, doc.order.currency, locale),
  ]);
  const lead = fill(w[`lead.${kind}`], v);
  const replyLine = doc.buyer?.email || opts.replyTo ? fill(w.reply, v) : null;
  const text = [
    w.hello,
    "",
    lead,
    "",
    ...facts.map(([k, val]) => `${k}: ${val}`),
    "",
    ...(kind === "cancellation" ? [] : [cols.join(" | "), ...rows.map((r) => r.join(" | ")), ""]),
    // Decision 0762: one click confirms it.
    ...(opts.confirmUrl ? [w[`confirm.${kind}`], opts.confirmUrl, ""] : []),
    ...(opts.attachPdf ? [w.pdf, ""] : []),
    ...(opts.attachUbl ? [w.ubl, ""] : []),
    ...(replyLine ? [replyLine, ""] : []),
    fill(w.footer, v),
  ].join("\n");
  const cell = (s: string, num = false) => `<td style="padding:4px 8px;border-bottom:1px solid #e3e8ef${num ? ";text-align:right" : ""}">${esc(s)}</td>`;
  const html = `<div style="font-family:Calibri,Carlito,'Segoe UI',Arial,sans-serif;color:#121a26;font-size:14px;line-height:1.5">
<p style="margin:0 0 12px">${esc(w.hello)}</p>
<p style="margin:0 0 12px">${esc(lead)}</p>
<table style="border-collapse:collapse;margin:0 0 16px;font-size:13px">${facts.map(([k, val]) => `<tr><td style="padding:2px 12px 2px 0;color:#5b6675">${esc(k)}</td><td style="padding:2px 0">${esc(val)}</td></tr>`).join("")}</table>
${
  kind === "cancellation"
    ? ""
    : `<table style="border-collapse:collapse;margin:0 0 16px;font-size:13px"><tr>${cols.map((c, i) => `<th style="padding:4px 8px;text-align:${i >= 3 && i !== 4 ? "right" : "left"};color:#5b6675;border-bottom:1px solid #c7d2e0">${esc(c)}</th>`).join("")}</tr>${rows
        .map((r) => `<tr>${r.map((c, i) => cell(c, i >= 3 && i !== 4)).join("")}</tr>`)
        .join("")}</table>`
}
${
  opts.confirmUrl
    ? `<p style="margin:0 0 8px">${esc(w[`confirm.${kind}`])}</p><p style="margin:0 0 16px"><a href="${esc(opts.confirmUrl)}" style="display:inline-block;padding:8px 16px;background:#1f5fbf;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600">${esc(w.confirmbutton)}</a></p>`
    : ""
}
${opts.attachPdf ? `<p style="margin:0 0 12px;color:#5b6675">${esc(w.pdf)}</p>` : ""}
${opts.attachUbl ? `<p style="margin:0 0 12px;color:#5b6675">${esc(w.ubl)}</p>` : ""}
${replyLine ? `<p style="margin:0 0 12px">${esc(replyLine)}</p>` : ""}
<p style="margin:16px 0 0;color:#5b6675;font-size:12px">${esc(fill(w.footer, v))}</p></div>`;
  return { subject, text, html, locale };
}

// ── Sending ────────────────────────────────────────────────────────────

const bytesToBase64 = (bytes: Uint8Array) => {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const toBase64 = (s: string) => bytesToBase64(new TextEncoder().encode(s));

/** What a version of an order is called as a file: `PO-7.pdf`, `PO-7-change.pdf`, `PO-7-cancellation.pdf`. */
export const documentFilename = (orderNumber: string, kind: OrderKind, ext: string) => `${orderNumber}${kind === "order" ? "" : `-${kind}`}.${ext}`.replace(/[^\w.-]+/g, "_");

/**
 * **Which version of an order, and what it changed — decision 0760**: the
 * release named (or the latest), its kind, note and change reference, and
 * for a change what 0754 recorded it changed.
 */
export async function orderVersion(
  db: D1Database,
  orderNumber: string,
  intakeId: string | null = null
): Promise<{ id: string | null; kind: OrderKind; note: string | null; changeReference: string | null; changes: OrderDiff | null }> {
  const row = intakeId
    ? await db.prepare("SELECT id, kind, note, change_reference FROM purchase_order_intake WHERE id = ?").bind(intakeId).first<{ id: string; kind: OrderKind; note: string | null; change_reference: string | null }>()
    : await db
        .prepare("SELECT id, kind, note, change_reference FROM purchase_order_intake WHERE order_number = ? AND status = 'released' ORDER BY released_at DESC, rowid DESC LIMIT 1")
        .bind(orderNumber)
        .first<{ id: string; kind: OrderKind; note: string | null; change_reference: string | null }>();
  if (!row) return { id: null, kind: "order", note: null, changeReference: null, changes: null };
  let changes: OrderDiff | null = null;
  if (row.kind === "change") {
    const event = await db.prepare("SELECT detail_json FROM purchase_order_events WHERE intake_id = ? AND kind = 'changed' ORDER BY at DESC LIMIT 1").bind(row.id).first<{ detail_json: string | null }>();
    try {
      changes = event?.detail_json ? (JSON.parse(event.detail_json) as OrderDiff) : null;
    } catch {
      changes = null;
    }
  }
  return { id: row.id, kind: row.kind, note: row.note, changeReference: row.change_reference, changes };
}

export type DocumentFormat = "pdf" | "ubl" | "csv";

/**
 * **The order as a document — decision 0760**, for the Document tab in
 * VibeFinance and the supplier network: the order as it stands, as the
 * latest version released (a change's changes marked), as a PDF, its UBL,
 * or Purchase Orders' own CSV. Null where there is no such order.
 */
export async function orderFile(db: D1Database, orderNumber: string, format: DocumentFormat): Promise<{ bytes: Uint8Array; contentType: string; filename: string } | null> {
  const version = await orderVersion(db, orderNumber);
  const doc = await orderDocument(db, orderNumber, version.note);
  if (!doc) return null;
  if (format === "ubl") return { bytes: new TextEncoder().encode(doc.ubl), contentType: "application/xml; charset=utf-8", filename: documentFilename(orderNumber, version.kind, "xml") };
  if (format === "csv") return { bytes: new TextEncoder().encode(orderCsv(doc)), contentType: "text/csv; charset=utf-8", filename: documentFilename(orderNumber, version.kind, "csv") };
  const instance = await ordersOutInstance(db);
  const replyTo = instance ? settingsOf(instance.settings_json).replyTo : null;
  const pdf = await orderPdf(doc, { kind: version.kind, changes: version.changes, note: version.note, changeReference: version.changeReference, replyTo });
  return { bytes: pdf, contentType: "application/pdf", filename: documentFilename(orderNumber, version.kind, "pdf") };
}

export interface SendOutcome {
  status: "sent" | "failed" | "no_address" | "not_sent";
  to: string[];
  from: AddressFrom | null;
  messageId: string | null;
  error: string | null;
}

/**
 * One send of an order as it stands. `kind` and `intakeId` name the
 * version (the release it follows, where there is one); `to`, given by
 * hand, replaces the order of preference.
 */
export async function sendOrder(
  db: D1Database,
  deps: OrdersOutDeps,
  params: { instance: Instance; orderNumber: string; kind: OrderKind; intakeId: string | null; how: "on_release" | "by_hand"; by: string | null; to?: string[] | null; note?: string | null }
): Promise<SendOutcome> {
  const now = (deps.now ?? (() => new Date()))();
  const at = now.toISOString();
  const settings = settingsOf(params.instance.settings_json);
  // Decision 0762: the link's secret, made now; only its hash is kept, and only once the email has gone.
  const confirm = deps.confirm ? await newConfirmToken() : null;
  const record = async (outcome: SendOutcome) => {
    await db.batch([
      db
        .prepare(
          `INSERT INTO purchase_order_sends (id, instance_id, order_number, intake_id, kind, how, status, recipients_json, address_from, message_id, error, sent_by, created_at, confirm_token_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          crypto.randomUUID(),
          params.instance.id,
          params.orderNumber,
          params.intakeId,
          params.kind,
          params.how,
          outcome.status,
          outcome.status === "sent" ? JSON.stringify(outcome.to) : outcome.to.length ? JSON.stringify(outcome.to) : null,
          outcome.from,
          outcome.messageId,
          outcome.error,
          params.by,
          at,
          outcome.status === "sent" && confirm ? confirm.hash : null
        ),
      // On the order's Timeline (0754).
      orderEvent(
        db,
        params.orderNumber,
        outcome.status === "sent" ? "sent_to_supplier" : outcome.status === "failed" ? "send_failed" : "not_sent",
        params.by,
        { kind: params.kind, how: params.how, to: outcome.to, from: outcome.from, error: outcome.error, reason: outcome.status === "sent" || outcome.status === "failed" ? null : outcome.status, ubl: settings.attachUbl, pdf: settings.attachPdf, intakeId: params.intakeId },
        at
      ),
    ]);
    return outcome;
  };

  const doc = await orderDocument(db, params.orderNumber, params.note ?? null);
  if (!doc) return { status: "failed", to: [], from: null, messageId: null, error: `purchase order ${params.orderNumber} does not exist` };
  const recipients = await orderRecipients(db, params.orderNumber);
  const given = params.to ? params.to.flatMap((a) => addresses(a)) : [];
  const to = given.length ? given : recipients?.to ?? [];
  const from: AddressFrom | null = given.length ? "given" : recipients?.from ?? null;
  if (params.how === "on_release" && recipients?.supplierSendsOwn) return record({ status: "not_sent", to: [], from: null, messageId: null, error: null });
  if (!to.length) return record({ status: "no_address", to: [], from: null, messageId: null, error: null });

  const link = confirm && deps.confirm ? confirmUrl(deps.confirm.networkUrl, deps.confirm.environmentId, confirm.token) : null;
  const mail = orderEmail(doc, params.kind, { replyTo: settings.replyTo, attachUbl: settings.attachUbl, attachPdf: settings.attachPdf, confirmUrl: link });
  const filename = `${doc.order.order_number}.xml`.replace(/[^\w.-]+/g, "_");
  // Decision 0760: the order as a PDF, as this version says it (a change's changes marked).
  const version = settings.attachPdf ? await orderVersion(db, params.orderNumber, params.intakeId) : null;
  const pdf = settings.attachPdf ? await orderPdf(doc, { kind: params.kind, changes: version?.changes ?? null, note: params.note ?? version?.note ?? null, changeReference: version?.changeReference ?? null, replyTo: settings.replyTo }) : null;
  const pdfName = documentFilename(doc.order.order_number, params.kind, "pdf");
  const messageId = await openOutboundMessage(db, { destinationId: params.instance.id, recipient: to.join(", "), subject: mail.subject, bytes: mail.html.length + (settings.attachUbl ? doc.ubl.length : 0) + (pdf?.length ?? 0), receivedAt: at, actor: params.by ?? undefined, event: "sending" });
  if (messageId && deps.bucket && deps.customerId) {
    const enc = (t: string) => new TextEncoder().encode(t);
    const parts: [string, string, Uint8Array][] = [
      // The link's secret is the supplier's alone: the copy kept here leaves it out.
      ["email.html", "text/html", enc(confirm ? mail.html.split(confirm.token).join("…") : mail.html)],
      ...(pdf ? ([[pdfName, "application/pdf", pdf]] as [string, string, Uint8Array][]) : []),
      ...(settings.attachUbl ? ([[filename, "application/xml", enc(doc.ubl)]] as [string, string, Uint8Array][]) : []),
    ];
    let seq = 0;
    for (const [name, type, body] of parts) {
      seq++;
      await storeRoutePart(deps.bucket, db, { messageId, seq, role: "sent", filename: name, contentType: type, bytes: body, key: routePartKey(deps.customerId, params.instance.id, messageId, at, seq, name) });
    }
  }
  if (!deps.email) {
    const error = "email sending is not configured for this deployment";
    if (messageId) await finishRouteMessage(db, messageId, { status: "failed", failedPart: "delivery", errorCode: "email_not_configured", errorText: error });
    return record({ status: "failed", to, from, messageId: null, error });
  }
  const cc = settings.ccBuyer && doc.buyer?.email && !to.includes(doc.buyer.email.toLowerCase()) ? [doc.buyer.email] : [];
  const send = deps.send ?? sendEmailViaResend;
  const result = await send(deps.email.apiKey, {
    from: deps.email.from,
    to,
    cc,
    replyTo: settings.replyTo ?? doc.buyer?.email ?? null,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    ...(settings.attachUbl || pdf
      ? {
          attachments: [
            ...(pdf ? [{ filename: pdfName, content: bytesToBase64(pdf) }] : []),
            ...(settings.attachUbl ? [{ filename, content: toBase64(doc.ubl) }] : []),
          ],
        }
      : {}),
  });
  if (!result.ok) {
    if (messageId) await finishRouteMessage(db, messageId, { status: "failed", failedPart: "delivery", errorCode: "email_refused", errorText: result.error });
    return record({ status: "failed", to, from, messageId: null, error: result.error });
  }
  if (messageId) {
    await addRouteEvent(db, messageId, "delivered", { detail: `emailed ${to.join(", ")}${cc.length ? `, copied ${cc.join(", ")}` : ""}` });
    await finishRouteMessage(db, messageId, { status: "delivered" });
  }
  const outcome = await record({ status: messageId ? "sent" : "failed", to, from, messageId, error: messageId ? null : "the sent email could not be recorded" });
  if (messageId) await db.prepare("UPDATE purchase_order_sends SET email_id = ? WHERE message_id = ?").bind(result.messageId, messageId).run();
  return outcome;
}

/**
 * **Sending what was released — the cron, and straight after a release.**
 * Orders, changes and cancellations released since the Destination
 * started, in the companies it sends for, not yet sent for that release.
 */
export async function runOrderSends(db: D1Database, deps: OrdersOutDeps, limit = 20): Promise<number> {
  const instance = await ordersOutInstance(db);
  if (!instance || instance.status !== "active" || !instance.started_at) return 0;
  if (!settingsOf(instance.settings_json).sendOnRelease) return 0;
  const due = (
    await db
      .prepare(
        `SELECT i.id, i.order_number, i.kind, i.note, po.org_unit_id FROM purchase_order_intake i
         JOIN purchase_orders po ON po.order_number = i.order_number
         WHERE i.status = 'released' AND i.released_at >= ?
           AND NOT EXISTS (SELECT 1 FROM purchase_order_sends s WHERE s.instance_id = ? AND s.intake_id = i.id AND s.how = 'on_release')
         ORDER BY i.released_at, i.rowid LIMIT ?`
      )
      .bind(instance.started_at, instance.id, limit)
      .all<{ id: string; order_number: string; kind: OrderKind; note: string | null; org_unit_id: string | null }>()
  ).results;
  const covered = await coveredUnits(db, unitIdsOf(instance));
  let n = 0;
  for (const d of due) {
    if (!covers(covered, d.org_unit_id)) continue;
    await sendOrder(db, deps, { instance, orderNumber: d.order_number, kind: d.kind, intakeId: d.id, how: "on_release", by: null, note: d.note });
    n++;
  }
  return n;
}

// ── Routes ─────────────────────────────────────────────────────────────

/** The latest released version of an order: what *Send to supplier* sends. */
async function latestRelease(db: D1Database, orderNumber: string): Promise<{ id: string; kind: OrderKind; note: string | null } | null> {
  return db
    .prepare("SELECT id, kind, note FROM purchase_order_intake WHERE order_number = ? AND status = 'released' ORDER BY released_at DESC, rowid DESC LIMIT 1")
    .bind(orderNumber)
    .first<{ id: string; kind: OrderKind; note: string | null }>();
}

function sendView(r: Record<string, unknown>) {
  return {
    status: r.status,
    kind: r.kind,
    how: r.how,
    to: r.recipients_json ? (JSON.parse(String(r.recipients_json)) as string[]) : [],
    from: r.address_from,
    error: r.error,
    by: r.sent_by_name ?? null,
    at: r.created_at,
  };
}

/** `GET /purchase-orders/:number/send-to-supplier` — whether it can be sent, to whom, and what was sent. */
export async function handleGetOrderSending(db: D1Database, orderNumber: string): Promise<RouteResult> {
  const recipients = await orderRecipients(db, orderNumber);
  if (!recipients) return { status: 404, body: { error: `no purchase order ${orderNumber}` } };
  const instance = await ordersOutInstance(db);
  const sends = (
    await db
      .prepare(
        `SELECT s.*, u.name AS sent_by_name FROM purchase_order_sends s LEFT JOIN org_users u ON u.id = s.sent_by
         WHERE s.order_number = ? ORDER BY s.created_at DESC, s.rowid DESC LIMIT 20`
      )
      .bind(orderNumber)
      .all<Record<string, unknown>>()
  ).results;
  return {
    status: 200,
    body: {
      available: Boolean(instance),
      destination: instance ? { id: instance.id, status: instance.status, started: Boolean(instance.started_at) } : null,
      to: recipients.to,
      from: recipients.from,
      supplier: recipients.supplier ? { id: recipients.supplier.id, name: recipients.supplier.name } : null,
      supplierSendsOwn: recipients.supplierSendsOwn,
      sends: sends.map(sendView),
      // Decision 0762: whether the supplier has confirmed it has the order as it stands.
      confirmation: await orderConfirmation(db, orderNumber),
    },
  };
}

/** `POST /purchase-orders/:number/send-to-supplier` `{ to? }` — *Send to supplier*, by hand: the order as it stands. */
export async function handleSendOrderToSupplier(db: D1Database, deps: OrdersOutDeps, userId: string, orderNumber: string, body: Record<string, unknown>): Promise<RouteResult> {
  const instance = await ordersOutInstance(db);
  if (!instance) return { status: 409, body: { error: "the Purchase Orders process has no Orders to suppliers Destination", reason: "no_destination" } };
  const exists = await db.prepare("SELECT status FROM purchase_orders WHERE order_number = ?").bind(orderNumber).first<{ status: string }>();
  if (!exists) return { status: 404, body: { error: `no purchase order ${orderNumber}` } };
  const given = typeof body.to === "string" ? addresses(body.to) : Array.isArray(body.to) ? body.to.flatMap((a) => (typeof a === "string" ? addresses(a) : [])) : [];
  if ((typeof body.to === "string" && body.to.trim() && !given.length) || (Array.isArray(body.to) && body.to.length && !given.length)) {
    return { status: 400, body: { error: "that is not an email address", reason: "bad_address" } };
  }
  const release = await latestRelease(db, orderNumber);
  const kind: OrderKind = release?.kind ?? (exists.status === "closed" ? "order" : "order");
  const outcome = await sendOrder(db, deps, { instance, orderNumber, kind, intakeId: release?.id ?? null, how: "by_hand", by: userId, to: given.length ? given : null, note: release?.note ?? null });
  const status = outcome.status === "sent" ? 201 : outcome.status === "no_address" ? 409 : 502;
  return { status, body: { ...outcome, reason: outcome.status === "sent" ? null : outcome.status === "no_address" ? "no_address" : "send_failed" } };
}

/** `GET /route-instances/:id/orders-out` — its settings and its latest sends, for Process routes. */
export async function handleGetOrdersOut(db: D1Database, instanceId: string): Promise<RouteResult> {
  const instance = await db.prepare("SELECT id, route_id, status, started_at, settings_json FROM route_instances WHERE id = ?").bind(instanceId).first<{ id: string; route_id: string; status: string; started_at: string | null; settings_json: string | null }>();
  if (!instance || instance.route_id !== ORDERS_OUT) return { status: 404, body: { error: `no Orders to suppliers Destination ${instanceId}` } };
  const sends = (
    await db
      .prepare(
        `SELECT s.*, u.name AS sent_by_name FROM purchase_order_sends s LEFT JOIN org_users u ON u.id = s.sent_by
         WHERE s.instance_id = ? ORDER BY s.created_at DESC, s.rowid DESC LIMIT 25`
      )
      .bind(instanceId)
      .all<Record<string, unknown>>()
  ).results;
  return { status: 200, body: { settings: settingsOf(instance.settings_json), started: Boolean(instance.started_at), status: instance.status, sends: sends.map((s) => ({ orderNumber: s.order_number, ...sendView(s) })) } };
}

/** `PUT /route-instances/:id/orders-out` — its settings. */
export async function handlePutOrdersOut(db: D1Database, instanceId: string, body: Record<string, unknown>): Promise<RouteResult> {
  const instance = await db.prepare("SELECT route_id, settings_json FROM route_instances WHERE id = ?").bind(instanceId).first<{ route_id: string; settings_json: string | null }>();
  if (!instance || instance.route_id !== ORDERS_OUT) return { status: 404, body: { error: `no Orders to suppliers Destination ${instanceId}` } };
  const now = settingsOf(instance.settings_json);
  if ("replyTo" in body && body.replyTo !== null && body.replyTo !== "" && !(typeof body.replyTo === "string" && addresses(body.replyTo).length === 1)) {
    return { status: 400, body: { error: "the reply-to address is not an email address", reason: "bad_address" } };
  }
  const next: OrdersOutSettings = {
    sendOnRelease: typeof body.sendOnRelease === "boolean" ? body.sendOnRelease : now.sendOnRelease,
    ccBuyer: typeof body.ccBuyer === "boolean" ? body.ccBuyer : now.ccBuyer,
    attachUbl: typeof body.attachUbl === "boolean" ? body.attachUbl : now.attachUbl,
    attachPdf: typeof body.attachPdf === "boolean" ? body.attachPdf : now.attachPdf,
    replyTo: "replyTo" in body ? (typeof body.replyTo === "string" && body.replyTo.trim() ? addresses(body.replyTo)[0] : null) : now.replyTo,
  };
  await db.prepare("UPDATE route_instances SET settings_json = ? WHERE id = ?").bind(JSON.stringify(next), instanceId).run();
  return { status: 200, body: { settings: next } };
}

/** `POST /route-instances/:id/orders-out/start` — start sending: orders released from now on go automatically. */
export async function handleStartOrdersOut(db: D1Database, instanceId: string, now = new Date()): Promise<RouteResult> {
  const instance = await db.prepare("SELECT route_id, status, started_at FROM route_instances WHERE id = ?").bind(instanceId).first<{ route_id: string; status: string | null; started_at: string | null }>();
  if (!instance || instance.route_id !== ORDERS_OUT) return { status: 404, body: { error: `no Orders to suppliers Destination ${instanceId}` } };
  if (instance.status === "retired") return { status: 409, body: { error: "a retired Destination cannot start", reason: "retired" } };
  if (instance.started_at) return { status: 409, body: { error: "the Destination has already started: resume it instead", reason: "already_started" } };
  await db.prepare("UPDATE route_instances SET started_at = ?, status = 'active' WHERE id = ?").bind(now.toISOString(), instanceId).run();
  return { status: 200, body: { started: true, status: "active" } };
}

/**
 * **The order's parties and totals, for the supplier network's cards —
 * decision 0765**: the supplier as the customer keeps it (Seller), the
 * company that placed the order and who to talk to there (Buyer, as the
 * PDF's buyer block, 0761), the net, the VAT and the requisition. Null
 * where there is no such order.
 */
export async function orderCards(db: D1Database, orderNumber: string): Promise<{
  parties: {
    seller: { name: string | null; reference: string | null; vatId: string | null; addressLine: string | null; city: string | null; postalCode: string | null; country: string | null; email: string | null };
    buyer: { name: string | null; vatId: string | null; addressLine: string | null; city: string | null; postalCode: string | null; country: string | null; contact: string | null; email: string | null; phone: string | null };
  };
  net: number | null;
  vat: number | null;
  requisition: string | null;
} | null> {
  const doc = await orderDocument(db, orderNumber);
  if (!doc) return null;
  const s = doc.supplier;
  const c = doc.company;
  const o = doc.order;
  const instance = doc.buyer?.email ? null : await ordersOutInstance(db);
  const replyTo = instance ? settingsOf(instance.settings_json).replyTo : null;
  // As the PDF's totals (0761): the tax between what excludes it and what includes it.
  const excl = o.tax_exclusive_amount ?? o.line_extension_amount;
  const incl = o.tax_inclusive_amount ?? o.payable_amount;
  const vat = typeof excl === "number" && typeof incl === "number" ? Math.round((incl - excl) * 100) / 100 : null;
  return {
    parties: {
      seller: {
        name: s?.name ?? null,
        reference: s?.erp_identifier ?? null,
        vatId: s?.vat_id ?? o.seller_party_id,
        addressLine: s?.address_line ?? null,
        city: s?.city ?? null,
        postalCode: s?.postal_code ?? null,
        country: s?.country ?? null,
        email: o.supplier_email ?? addresses(s?.orders_email)[0] ?? s?.email ?? null,
      },
      buyer: {
        name: c.name,
        vatId: c.vatId,
        addressLine: c.addressLine,
        city: c.city,
        postalCode: c.postalCode,
        country: c.country,
        contact: doc.buyer?.name ?? null,
        email: doc.buyer?.email ?? replyTo ?? c.email,
        phone: c.phone,
      },
    },
    net: o.line_extension_amount,
    vat,
    requisition: o.originator_reference,
  };
}
