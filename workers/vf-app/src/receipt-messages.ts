import type { PortalAccessClaims } from "@vibefinance/shared";
import type { RouteResult } from "./org-route.js";
import type { LicenceLink } from "./invitations-route.js";
import {
  MAX_BODY,
  portalView,
  recipientsFor,
  send,
  unitAndAbove,
  view,
  type MessageEmail,
  type MessageRow,
} from "./supplier-messages.js";
import { portalMayReadReceipt, receiptsSharedWith } from "./receipt-sharing.js";

/**
 * **The conversation with a supplier about a goods receipt — decision
 * 0740.** The same conversation as an invoice's (0721), in the same store
 * (`supplier_messages`, by `receipt_id`): the warehouse writes on the
 * receipt's Supplier tab and the supplier's people linked for its company
 * are emailed; the supplier writes on the receipt in the network and the
 * person who recorded the receipt, everyone who receives goods for its
 * company, and whoever last wrote to them, are emailed.
 *
 * **Only while the receipt is shared with the supplier** (0738): with
 * sharing off, or a receipt the supplier would not see (still being
 * checked where only registered ones are shown, rejected, cancelled), the
 * warehouse cannot write and the supplier sees nothing; a conversation
 * already had stays on the receipt here. Kept apart from the receipt's
 * own Timeline / Chat, as an invoice's is.
 */

interface ReceiptRow {
  id: string;
  receipt_number: string;
  status: string;
  cancelled_at: string | null;
  created_by: string | null;
  org_unit_id: string | null;
  company_name: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
}

const BARE_SQL = (col: string) =>
  `(CASE WHEN upper(replace(replace(${col}, ' ', ''), '.', '')) GLOB '[A-Z][A-Z][0-9]*' THEN substr(upper(replace(replace(${col}, ' ', ''), '.', '')), 3) ELSE upper(replace(replace(${col}, ' ', ''), '.', '')) END)`;

/**
 * The receipt, its company and its supplier, from the first order it
 * names: the supplier record whose VAT number (however written) or ERP
 * number is the order's seller, an active one first — the same match 0738
 * shares receipts by.
 */
async function receiptOf(db: D1Database, receiptId: string): Promise<ReceiptRow | null> {
  return db
    .prepare(
      `SELECT r.id, r.receipt_number, r.status, r.cancelled_at, r.created_by,
              po.org_unit_id, ou.name AS company_name,
              s.id AS supplier_id, s.name AS supplier_name
       FROM goods_receipts r
       LEFT JOIN purchase_orders po ON po.order_number = (SELECT min(l.order_number) FROM goods_receipt_lines l WHERE l.receipt_id = r.id)
       LEFT JOIN org_units ou ON ou.id = po.org_unit_id
       LEFT JOIN suppliers s ON s.id = (
         SELECT x.id FROM suppliers x
         WHERE po.seller_party_id IS NOT NULL
           AND ((x.vat_id IS NOT NULL AND ${BARE_SQL("x.vat_id")} = ${BARE_SQL("po.seller_party_id")}) OR x.erp_identifier = po.seller_party_id)
         ORDER BY x.status = 'active' DESC, x.name LIMIT 1)
       WHERE r.id = ?`
    )
    .bind(receiptId)
    .first<ReceiptRow>();
}

/** Whether the supplier would see this receipt in the network now: shared with them, and of a kind that is shown. */
async function visibleToSupplier(db: D1Database, receipt: ReceiptRow): Promise<boolean> {
  if (!receipt.supplier_id || !receipt.org_unit_id || receipt.cancelled_at) return false;
  const sharing = await receiptsSharedWith(db, receipt.supplier_id);
  if (!sharing.shared) return false;
  return receipt.status === "registered" || (receipt.status === "pending" && !sharing.registeredOnly);
}

async function receiptMessages(db: D1Database, receiptId: string): Promise<MessageRow[]> {
  return (await db.prepare("SELECT * FROM supplier_messages WHERE receipt_id = ? ORDER BY created_at, rowid").bind(receiptId).all<MessageRow>()).results;
}

/** Who at the supplier is told: everyone linked to the supplier for the receipt's company (or above), while it is shared. */
async function supplierPeople(db: D1Database, link: LicenceLink | null, receipt: ReceiptRow): Promise<string[]> {
  if (!(await visibleToSupplier(db, receipt))) return [];
  return recipientsFor(db, link, {
    id: receipt.id,
    supplier_id: receipt.supplier_id,
    org_unit_id: receipt.org_unit_id,
    invoice_number: receipt.receipt_number,
    supplier_name: receipt.supplier_name,
    company_name: receipt.company_name,
  });
}

/** `GET /goods-receipts/:id/supplier-messages` — the conversation, who would be told, as an invoice's. */
export async function handleGetReceiptSupplierMessages(db: D1Database, link: LicenceLink | null, receiptId: string): Promise<RouteResult> {
  const receipt = await receiptOf(db, receiptId);
  if (!receipt) return { status: 404, body: { error: `goods receipt ${receiptId} does not exist` } };
  const rows = await receiptMessages(db, receiptId);
  const recipients = await supplierPeople(db, link, receipt);
  return {
    status: 200,
    body: {
      available: recipients.length > 0 || rows.length > 0,
      canWrite: recipients.length > 0,
      supplierName: receipt.supplier_name,
      recipients,
      // Decision 0740: no question waits on a receipt (not yet); unread counts only.
      awaiting: false,
      messages: rows.map(view),
    },
  };
}

/** `POST /goods-receipts/:id/supplier-messages` `{ body }` — someone who receives goods writes to the supplier. */
export async function handlePostReceiptSupplierMessage(
  db: D1Database,
  link: LicenceLink | null,
  receiptId: string,
  user: { id: string; name: string },
  body: Record<string, unknown>,
  email: MessageEmail,
  now = new Date()
): Promise<RouteResult> {
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text) return { status: 400, body: { error: "write a message", reason: "empty" } };
  if (text.length > MAX_BODY) return { status: 400, body: { error: `a message is at most ${MAX_BODY} characters`, reason: "too_long" } };
  const receipt = await receiptOf(db, receiptId);
  if (!receipt) return { status: 404, body: { error: `goods receipt ${receiptId} does not exist` } };
  const recipients = await supplierPeople(db, link, receipt);
  if (recipients.length === 0) {
    return {
      status: 409,
      body: { error: "this receipt is not shared with its supplier in the supplier network, or nobody there is linked for its company", reason: "no_recipients" },
    };
  }
  const customer = receipt.company_name ?? "Your customer";
  const mail = [
    "Hello,",
    "",
    `${customer} has written about goods receipt ${receipt.receipt_number}:`,
    "",
    text,
    "",
    `Read and reply in the VibeFinance supplier network: ${email.networkUrl.replace(/\/+$/, "")}/`,
    "",
    "VibeFinance",
  ].join("\n");
  const emailError = await send(email, recipients, `${customer} has written about goods receipt ${receipt.receipt_number}`, mail);
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO supplier_messages (id, receipt_id, supplier_id, direction, kind, author_user_id, author_name, body, emailed_json, email_error, created_at)
       VALUES (?, ?, ?, 'to_supplier', 'message', ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, receiptId, receipt.supplier_id, user.id, user.name, text, JSON.stringify(recipients), emailError, now.toISOString())
    .run();
  const row = (await db.prepare("SELECT * FROM supplier_messages WHERE id = ?").bind(id).first<MessageRow>())!;
  return { status: 201, body: { message: view(row) } };
}

/**
 * **Who at the customer hears of a supplier's message about a receipt:**
 * the person who recorded it, everyone holding AP.Receive for its company
 * (in it, above it, or everywhere), and whoever last wrote to the supplier
 * about it. People, by their email; active ones only.
 */
async function warehousePeopleFor(db: D1Database, receipt: ReceiptRow): Promise<string[]> {
  const units = receipt.org_unit_id ? await unitAndAbove(db, receipt.org_unit_id) : [];
  const rows = (
    await db
      .prepare(
        `SELECT u.email FROM org_users u WHERE u.id = ? AND u.status = 'active'
         UNION
         SELECT u.email FROM org_users u
           JOIN org_user_roles ur ON ur.user_id = u.id
           JOIN org_roles r ON r.id = ur.role_id
         WHERE u.status = 'active'
           AND EXISTS (SELECT 1 FROM json_each(r.permissions_json) p WHERE p.value = 'AP.Receive')
           AND (ur.unit_id IS NULL OR ur.unit_id IN (SELECT value FROM json_each(?)))
         UNION
         SELECT u.email FROM supplier_messages m JOIN org_users u ON u.id = m.author_user_id
         WHERE m.id = (SELECT id FROM supplier_messages WHERE receipt_id = ? AND direction = 'to_supplier' ORDER BY created_at DESC, rowid DESC LIMIT 1)
           AND u.status = 'active'`
      )
      .bind(receipt.created_by ?? "", JSON.stringify(units), receipt.id)
      .all<{ email: string | null }>()
  ).results;
  return [...new Set(rows.map((r) => r.email).filter((e): e is string => Boolean(e)))].sort();
}

/**
 * `POST /portal/receipts/:id/messages` `{ body }` — the supplier's person
 * writes about a receipt shared with them. The same 404 for one they may
 * not see as for none.
 */
export async function handlePortalReceiptReply(
  db: D1Database,
  claims: PortalAccessClaims,
  receiptId: string,
  body: Record<string, unknown>,
  email: MessageEmail,
  now = new Date()
): Promise<RouteResult> {
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text) return { status: 400, body: { error: "write a message", reason: "empty" } };
  if (text.length > MAX_BODY) return { status: 400, body: { error: `a message is at most ${MAX_BODY} characters`, reason: "too_long" } };
  if (!(await portalMayReadReceipt(db, claims, receiptId))) return { status: 404, body: { error: "not found" } };
  const receipt = (await receiptOf(db, receiptId))!;
  const people = await warehousePeopleFor(db, receipt);
  const supplier = receipt.supplier_name ?? "Your supplier";
  const mail = [
    "Hello,",
    "",
    `${supplier} (${claims.email}) has written about goods receipt ${receipt.receipt_number}:`,
    "",
    text,
    "",
    email.appUrl ? `Open it in VibeFinance: ${email.appUrl}/` : "Open it in VibeFinance, on the receipt's Supplier tab.",
    "",
    "VibeFinance",
  ].join("\n");
  const emailError = await send(email, people, `${supplier} wrote about goods receipt ${receipt.receipt_number}`, mail);
  await db
    .prepare(
      `INSERT INTO supplier_messages (id, receipt_id, supplier_id, direction, kind, author_email, author_name, body, emailed_json, email_error, created_at)
       VALUES (?, ?, ?, 'from_supplier', 'message', ?, ?, ?, ?, ?, ?)`
    )
    .bind(crypto.randomUUID(), receiptId, claims.supplierId, claims.email, claims.email, text, JSON.stringify(people), emailError, now.toISOString())
    .run();
  return { status: 201, body: { messages: portalView(await receiptMessages(db, receiptId)) } };
}

