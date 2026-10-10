import type { RouteResult } from "./org-route.js";
import { askLicence, type LicenceLink } from "./invitations-route.js";
import { portalLicensed } from "./portal-people-route.js";
import { sendEmailViaResend } from "./resend-client.js";
import type { PortalAccessClaims } from "@vibefinance/shared";

/**
 * **The conversation with a supplier about an invoice — decision 0721.**
 * Phase 2a of docs/design/supplier-portal.md.
 *
 * Someone at the customer writes, or asks (*Ask supplier*: the invoice
 * stays where it is and waits on the answer); the supplier's people linked
 * for the invoice's company see it in the supplier network and are
 * emailed; their reply comes back here, to the person holding the
 * invoice's task and whoever asked, by email. Kept apart from the internal
 * chat (`document_comments`) on purpose.
 */

export interface MessageEmail {
  apiKey: string | null;
  from: string | null;
  /** The supplier network, for the link in a supplier's email. */
  networkUrl: string;
  /** This customer's app, for the link in a reply's email. */
  appUrl: string | null;
}

export const DEFAULT_NETWORK_URL = "https://network.vibefinance-ai.com";
const MAX_BODY = 4000;

interface InvoiceRow {
  id: string;
  supplier_id: string | null;
  org_unit_id: string | null;
  invoice_number: string | null;
  supplier_name: string | null;
  company_name: string | null;
}

interface MessageRow {
  id: string;
  direction: "to_supplier" | "from_supplier";
  kind: "question" | "message";
  author_user_id: string | null;
  author_email: string | null;
  author_name: string;
  body: string;
  lines_json: string | null;
  stage_id: string | null;
  emailed_json: string | null;
  email_error: string | null;
  created_at: string;
}

async function invoiceOf(db: D1Database, invoiceId: string): Promise<InvoiceRow | null> {
  return db
    .prepare(
      `SELECT h.id, h.supplier_id, h.org_unit_id, h.invoice_number, s.name AS supplier_name, ou.name AS company_name
       FROM invoice_headers h
       LEFT JOIN suppliers s ON s.id = h.supplier_id
       LEFT JOIN org_units ou ON ou.id = h.org_unit_id
       WHERE h.id = ?`
    )
    .bind(invoiceId)
    .first<InvoiceRow>();
}

/** The invoice's company and every unit above it: a link for any of them covers the invoice (0715). */
async function unitAndAbove(db: D1Database, unitId: string): Promise<string[]> {
  const rows = (
    await db
      .prepare(
        `WITH RECURSIVE up(id, parent) AS (
           SELECT id, parent_unit_id FROM org_units WHERE id = ?
           UNION SELECT u.id, u.parent_unit_id FROM org_units u JOIN up ON u.id = up.parent
         ) SELECT id FROM up`
      )
      .bind(unitId)
      .all<{ id: string }>()
  ).results;
  return rows.map((r) => r.id);
}

/**
 * Who at the supplier is told: everyone linked to this supplier record
 * for the invoice's company (or a unit above it). Empty when the portal is
 * not licensed, the invoice has no supplier or company yet, or nobody is
 * linked; then there is nobody to ask, and Ask supplier is not offered.
 */
export async function recipientsFor(db: D1Database, link: LicenceLink | null, invoice: InvoiceRow): Promise<string[]> {
  if (!link || !invoice.supplier_id || !invoice.org_unit_id) return [];
  if (!(await portalLicensed(db))) return [];
  const r = await askLicence(link, "GET", `/portal-people?supplierId=${encodeURIComponent(invoice.supplier_id)}`);
  if (r.status !== 200) return [];
  const covering = new Set(await unitAndAbove(db, invoice.org_unit_id));
  const links = ((r.body.links ?? []) as { email: string; status: string; orgUnits: { id: string }[] }[]).filter(
    (l) => l.status === "active" && l.orgUnits.some((u) => covering.has(u.id))
  );
  return [...new Set(links.map((l) => l.email))].sort();
}

async function messages(db: D1Database, invoiceId: string): Promise<MessageRow[]> {
  return (
    await db.prepare("SELECT * FROM supplier_messages WHERE invoice_id = ? ORDER BY created_at, rowid").bind(invoiceId).all<MessageRow>()
  ).results;
}

/** Whether the customer is waiting on the supplier: the last word was the customer's, and it asked. */
export function awaitingReply(rows: Pick<MessageRow, "direction" | "kind">[]): boolean {
  const last = rows.at(-1);
  if (!last || last.direction !== "to_supplier") return false;
  // A question since the supplier last wrote.
  for (let i = rows.length - 1; i >= 0 && rows[i].direction === "to_supplier"; i--) if (rows[i].kind === "question") return true;
  return false;
}

function view(m: MessageRow) {
  return {
    id: m.id,
    direction: m.direction,
    kind: m.kind,
    authorName: m.author_name,
    // The supplier's own address on their reply; customer staff may see it.
    authorEmail: m.direction === "from_supplier" ? m.author_email : null,
    body: m.body,
    lines: m.lines_json ? (JSON.parse(m.lines_json) as number[]) : null,
    at: m.created_at,
    emailed: m.emailed_json ? (JSON.parse(m.emailed_json) as string[]) : [],
    emailError: m.email_error,
  };
}

/** `GET /invoices/:id/supplier-messages` — the conversation, who would be told, and whether it is waiting. */
export async function handleGetSupplierMessages(db: D1Database, link: LicenceLink | null, invoiceId: string): Promise<RouteResult> {
  const invoice = await invoiceOf(db, invoiceId);
  if (!invoice) return { status: 404, body: { error: `invoice ${invoiceId} does not exist` } };
  const rows = await messages(db, invoiceId);
  const recipients = await recipientsFor(db, link, invoice);
  return {
    status: 200,
    body: {
      // Shown when there is someone to write to, or a conversation already.
      available: recipients.length > 0 || rows.length > 0,
      canWrite: recipients.length > 0,
      supplierName: invoice.supplier_name,
      recipients,
      awaiting: awaitingReply(rows),
      messages: rows.map(view),
    },
  };
}

async function send(email: MessageEmail, to: string[], subject: string, text: string): Promise<string | null> {
  if (to.length === 0) return null;
  if (!email.apiKey || !email.from) return "email sending is not configured for this deployment";
  const failures: string[] = [];
  for (const address of to) {
    const r = await sendEmailViaResend(email.apiKey, { from: email.from, to: address, subject, text });
    if (!r.ok) failures.push(`${address}: ${r.error}`);
  }
  return failures.length ? failures.join("; ") : null;
}

function readLines(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const lines = [...new Set(value.filter((n): n is number => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  return lines.length ? lines.slice(0, 200) : null;
}

/**
 * `POST /invoices/:id/supplier-messages` `{ body, ask, lines }` — from
 * someone at the customer. `ask: true` is *Ask supplier*: a question the
 * invoice now waits on. Emailed to every linked person for the invoice's
 * company, with a link to the network; the invoice and its task do not move.
 */
export async function handlePostSupplierMessage(
  db: D1Database,
  link: LicenceLink | null,
  invoiceId: string,
  user: { id: string; name: string },
  body: Record<string, unknown>,
  email: MessageEmail,
  now = new Date()
): Promise<RouteResult> {
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text) return { status: 400, body: { error: "write a message", reason: "empty" } };
  if (text.length > MAX_BODY) return { status: 400, body: { error: `a message is at most ${MAX_BODY} characters`, reason: "too_long" } };
  const invoice = await invoiceOf(db, invoiceId);
  if (!invoice) return { status: 404, body: { error: `invoice ${invoiceId} does not exist` } };
  const recipients = await recipientsFor(db, link, invoice);
  if (recipients.length === 0) {
    return { status: 409, body: { error: "nobody at this supplier is linked for this invoice's company in the supplier network", reason: "no_recipients" } };
  }
  const ask = body.ask === true;
  const lines = readLines(body.lines);
  const stage = await db
    .prepare("SELECT current_stage_id FROM process_instances WHERE subject_type = 'invoice' AND subject_id = ? ORDER BY created_at DESC LIMIT 1")
    .bind(invoiceId)
    .first<{ current_stage_id: string }>();
  const id = crypto.randomUUID();
  const number = invoice.invoice_number ?? invoiceId;
  const customer = invoice.company_name ?? "Your customer";
  const subject = ask ? `${customer} has a question about invoice ${number}` : `${customer} has written about invoice ${number}`;
  const mail = [
    "Hello,",
    "",
    ask ? `${customer} has a question about invoice ${number}${lines ? ` (line ${lines.join(", ")})` : ""}:` : `${customer} has written about invoice ${number}:`,
    "",
    text,
    "",
    `Read and reply in the VibeFinance supplier network: ${email.networkUrl.replace(/\/+$/, "")}/`,
    "",
    "VibeFinance",
  ].join("\n");
  const emailError = await send(email, recipients, subject, mail);
  await db
    .prepare(
      `INSERT INTO supplier_messages (id, invoice_id, supplier_id, direction, kind, author_user_id, author_name, body, lines_json, stage_id, emailed_json, email_error, created_at)
       VALUES (?, ?, ?, 'to_supplier', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, invoiceId, invoice.supplier_id, ask ? "question" : "message", user.id, user.name, text, lines ? JSON.stringify(lines) : null, stage?.current_stage_id ?? null, JSON.stringify(recipients), emailError, now.toISOString())
    .run();
  const row = (await db.prepare("SELECT * FROM supplier_messages WHERE id = ?").bind(id).first<MessageRow>())!;
  return { status: 201, body: { message: view(row) } };
}

// ---------------------------------------------------------------------------
// From the supplier network (a portal access token, 0714).
// ---------------------------------------------------------------------------

/** The conversation as the supplier sees it: no one's email addresses, no sending errors. */
export function portalView(rows: MessageRow[]) {
  return rows.map((m) => ({
    id: m.id,
    from: m.direction === "to_supplier" ? "customer" : "supplier",
    kind: m.kind,
    authorName: m.direction === "from_supplier" ? m.author_name : null,
    body: m.body,
    lines: m.lines_json ? (JSON.parse(m.lines_json) as number[]) : null,
    at: m.created_at,
  }));
}

export async function portalMessages(db: D1Database, invoiceId: string) {
  return portalView(await messages(db, invoiceId));
}

/**
 * Who at the customer hears of a reply: whoever holds the invoice's open
 * task (claimed, or owned by a person), and whoever wrote to the supplier
 * last. People, by their email here; never a whole team.
 */
async function customerPeopleFor(db: D1Database, invoiceId: string): Promise<{ email: string; name: string }[]> {
  const rows = (
    await db
      .prepare(
        `SELECT u.email, u.name FROM tasks t
         JOIN stage_visits v ON v.id = t.stage_visit_id
         JOIN process_instances pi ON pi.id = v.process_instance_id
         JOIN org_users u ON u.id = COALESCE(t.claimed_by, t.owner_user_id)
         WHERE pi.subject_type = 'invoice' AND pi.subject_id = ? AND t.status = 'open'
         UNION
         SELECT u.email, u.name FROM supplier_messages m JOIN org_users u ON u.id = m.author_user_id
         WHERE m.id = (SELECT id FROM supplier_messages WHERE invoice_id = ? AND direction = 'to_supplier' ORDER BY created_at DESC, rowid DESC LIMIT 1)`
      )
      .bind(invoiceId, invoiceId)
      .all<{ email: string; name: string }>()
  ).results;
  const seen = new Set<string>();
  return rows.filter((r) => r.email && !seen.has(r.email) && seen.add(r.email));
}

/**
 * `POST /portal/invoices/:id/messages` `{ body }` — the supplier's person
 * writes. The invoice must be one the token covers (the caller has checked).
 */
export async function handlePortalReply(db: D1Database, claims: PortalAccessClaims, invoiceId: string, body: Record<string, unknown>, email: MessageEmail, now = new Date()): Promise<RouteResult> {
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text) return { status: 400, body: { error: "write a message", reason: "empty" } };
  if (text.length > MAX_BODY) return { status: 400, body: { error: `a message is at most ${MAX_BODY} characters`, reason: "too_long" } };
  const invoice = await invoiceOf(db, invoiceId);
  if (!invoice) return { status: 404, body: { error: "not found" } };
  const people = await customerPeopleFor(db, invoiceId);
  const supplier = invoice.supplier_name ?? "Your supplier";
  const number = invoice.invoice_number ?? invoiceId;
  const mail = [
    "Hello,",
    "",
    `${supplier} (${claims.email}) has replied about invoice ${number}:`,
    "",
    text,
    "",
    email.appUrl ? `Open it in VibeFinance: ${email.appUrl}/` : "Open it in VibeFinance, on the invoice's Supplier tab.",
    "",
    "VibeFinance",
  ].join("\n");
  const emailError = await send(email, people.map((p) => p.email), `${supplier} replied about invoice ${number}`, mail);
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO supplier_messages (id, invoice_id, supplier_id, direction, kind, author_email, author_name, body, emailed_json, email_error, created_at)
       VALUES (?, ?, ?, 'from_supplier', 'message', ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, invoiceId, invoice.supplier_id, claims.email, claims.email, text, JSON.stringify(people.map((p) => p.email)), emailError, now.toISOString())
    .run();
  return { status: 201, body: { messages: await portalMessages(db, invoiceId) } };
}
