import { verifyPortalAccess, type PortalAccessClaims } from "@vibefinance/shared";
import { readLicenceState } from "./licence-cache.js";
import type { RouteResult } from "./org-route.js";
import { handlePortalReply, portalMessages, type MessageEmail } from "./supplier-messages.js";

/**
 * **The supplier portal's view of this instance — decision 0714.** Step 2
 * of docs/design/supplier-portal.md.
 *
 * A supplier's person reaches here only with a `portal_access` token from
 * vf-licence (0713): for this environment, one supplier record and the
 * companies the customer named. **Both come from the token, never from the
 * request**, and nothing here says anything an invoice's supplier should
 * not see: no stage names, rules, people, coding or scores. Read live,
 * every time; nothing is copied anywhere.
 */

/** The licence feature that turns the portal on for a customer (design §7.6). */
export const PORTAL_FEATURE = "supplier_portal";

/** What a supplier is told, in a vocabulary fixed for every customer (design §5). */
export const PORTAL_STATUSES = ["received", "in_review", "query_raised", "returned", "approved", "sent_for_payment", "paid", "rejected"] as const;
export type PortalStatus = (typeof PORTAL_STATUSES)[number];

export type PortalAuth = { ok: true; claims: PortalAccessClaims } | { ok: false; status: number; body: Record<string, unknown> };

/**
 * The supplier's token, checked: signed by the fleet key, a portal access
 * token, for this environment, in date; and the customer's licence has the
 * portal. A staff session is refused here as a portal token is refused
 * by staff routes.
 */
export async function portalAuth(
  db: D1Database,
  request: Request,
  publicKeyJwk: JsonWebKey | undefined,
  environmentId: string | undefined,
  now = new Date()
): Promise<PortalAuth> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return { ok: false, status: 401, body: { error: "unauthorized" } };
  if (!publicKeyJwk || !environmentId) {
    return { ok: false, status: 500, body: { error: "LICENCE_SIGNING_PUBLIC_KEY and ENVIRONMENT_ID must both be configured" } };
  }
  const verified = await verifyPortalAccess(token, publicKeyJwk, environmentId, now);
  if (!verified.ok) return { ok: false, status: 401, body: { error: "unauthorized" } };
  const licence = await readLicenceState(db);
  if (!licence.known || !(licence.claims.features ?? []).includes(PORTAL_FEATURE)) {
    return { ok: false, status: 403, body: { error: "the supplier portal is not part of this customer's licence", reason: "portal_not_licensed" } };
  }
  return { ok: true, claims: verified.claims };
}

interface PortalRow {
  id: string;
  invoice_number: string | null;
  issue_date: string | null;
  total_with_vat: number | null;
  currency: string | null;
  facts_json: string;
  created_at: string;
  org_unit_id: string;
  org_unit_name: string | null;
  instance_status: string | null;
  supplier_comment: string | null;
  cur_seq: number | null;
  approval_seq: number | null;
  task_count: number;
  exported: number;
  delivered: number;
  /** The supplier conversation's last word and whether a question waits since (0721). */
  query_open: number | null;
}

/**
 * **Where an invoice is, in the supplier's words.** From facts that are
 * already there, in order:
 *
 * - returned to the supplier: `returned` (decision 0724), with the comment
 *   the customer wrote for the supplier (0498);
 * - discarded: `rejected`;
 * - delivered to the ERP or a Destination: `sent_for_payment`;
 * - finished, or past the first approval stage of its process: `approved`;
 * - a person has had a task on it: `in_review`;
 * - otherwise (no process yet, or nobody has had to look): `received`.
 *
 * - the customer has asked (Ask supplier) and the supplier has not
 *   answered since: `query_raised` (decision 0721).
 *
 * `paid` comes with a payment date from the ERP; it is not produced yet.
 */
export function portalStatusOf(row: Pick<PortalRow, "instance_status" | "cur_seq" | "approval_seq" | "task_count" | "exported" | "delivered"> & { query_open?: number | null }): PortalStatus {
  // Decision 0724: returned is "correct it and send it again", apart from discarded (rejected).
  if (row.instance_status === "returned_manually") return "returned";
  if (row.instance_status === "archived") return "rejected";
  if (row.exported || row.delivered) return "sent_for_payment";
  // Decision 0721: the customer has asked, and the supplier has not answered since.
  if (row.query_open && row.instance_status !== "completed") return "query_raised";
  if (row.instance_status === "completed") return "approved";
  if (row.instance_status === "in_progress" && row.approval_seq !== null && row.cur_seq !== null && row.cur_seq > row.approval_seq) return "approved";
  if (row.task_count > 0) return "in_review";
  return "received";
}

const SELECT = `
  SELECT h.id, h.invoice_number, h.issue_date, h.total_with_vat, h.currency, h.facts_json, h.created_at,
         h.org_unit_id, ou.name AS org_unit_name,
         pi.status AS instance_status, pi.supplier_comment,
         (SELECT v.sequence FROM process_stage_versions v
           WHERE v.process_id = pi.process_id AND v.version = pi.process_version AND v.stage_id = pi.current_stage_id) AS cur_seq,
         (SELECT MIN(v.sequence) FROM process_stage_versions v JOIN process_stages s ON s.id = v.stage_id
           WHERE v.process_id = pi.process_id AND v.version = pi.process_version
             AND (s.uses_approval_hierarchy = 1 OR s.required_permission = 'AP.Approve')) AS approval_seq,
         (SELECT count(*) FROM tasks t JOIN stage_visits sv ON sv.id = t.stage_visit_id WHERE sv.process_instance_id = pi.id) AS task_count,
         EXISTS (SELECT 1 FROM erp_export_invoices e WHERE e.invoice_id = h.id) AS exported,
         EXISTS (SELECT 1 FROM destination_deliveries d WHERE d.invoice_id = h.id AND d.status = 'delivered') AS delivered,
         EXISTS (SELECT 1 FROM supplier_messages q WHERE q.invoice_id = h.id AND q.direction = 'to_supplier' AND q.kind = 'question'
                 AND NOT EXISTS (SELECT 1 FROM supplier_messages r WHERE r.invoice_id = h.id AND r.direction = 'from_supplier' AND r.created_at >= q.created_at)) AS query_open
  FROM invoice_headers h
  LEFT JOIN org_units ou ON ou.id = h.org_unit_id
  LEFT JOIN process_instances pi ON pi.id = (
    SELECT p.id FROM process_instances p WHERE p.subject_type = 'invoice' AND p.subject_id = h.id ORDER BY p.created_at DESC, p.id DESC LIMIT 1
  )`;

/**
 * Only this supplier's, only these companies' — and the units beneath
 * them (decision 0715): an invitation for a legal entity covers its
 * operating units, as a role there does (`unitsWherePermitted`). An
 * invoice not yet placed in a company belongs to none, so no link covers
 * it until it is.
 */
function scope(claims: PortalAccessClaims): { sql: string; binds: string[] } {
  return {
    sql: `h.supplier_id = ? AND h.org_unit_id IN (
      WITH RECURSIVE covered(id) AS (
        SELECT id FROM org_units WHERE id IN (${claims.orgUnitIds.map(() => "?").join(", ")})
        UNION SELECT u.id FROM org_units u JOIN covered c ON u.parent_unit_id = c.id
      ) SELECT id FROM covered)`,
    binds: [claims.supplierId, ...claims.orgUnitIds],
  };
}

function summary(row: PortalRow) {
  let facts: Record<string, unknown> = {};
  try {
    facts = JSON.parse(row.facts_json || "{}") as Record<string, unknown>;
  } catch {
    // An unreadable record still has its columns.
  }
  const status = portalStatusOf(row);
  return {
    id: row.id,
    invoiceNumber: row.invoice_number ?? (typeof facts["BT-1"] === "string" ? facts["BT-1"] : null),
    issueDate: row.issue_date,
    total: row.total_with_vat,
    currency: row.currency,
    purchaseOrder: typeof facts["BT-13"] === "string" ? facts["BT-13"] : null,
    company: row.org_unit_name ?? row.org_unit_id,
    receivedAt: row.created_at,
    status,
    // What the customer wrote for the supplier when it returned the invoice (0498). Nothing else.
    comment: status === "rejected" || status === "returned" ? row.supplier_comment : null,
  };
}

/**
 * `GET /portal/invoices?status=&q=` — this supplier's invoices for the
 * linked companies, newest first, at most 200. `q` matches the invoice
 * number or purchase order.
 */
export async function listPortalInvoices(db: D1Database, claims: PortalAccessClaims, params: URLSearchParams): Promise<RouteResult> {
  const { sql, binds } = scope(claims);
  const q = (params.get("q") ?? "").trim().slice(0, 100);
  const search = q ? ` AND (h.invoice_number LIKE ? OR json_extract(h.facts_json, '$."BT-13"') LIKE ?)` : "";
  const rows = (
    await db
      .prepare(`${SELECT} WHERE ${sql}${search} ORDER BY h.created_at DESC, h.id DESC LIMIT 200`)
      .bind(...binds, ...(q ? [`%${q}%`, `%${q}%`] : []))
      .all<PortalRow>()
  ).results;
  const wanted = params.get("status");
  const invoices = rows.map(summary).filter((i) => !wanted || i.status === wanted);
  return { status: 200, body: { invoices } };
}

/**
 * `GET /portal/invoices/:id` — one invoice, with its lines as read. The
 * same answer for one that does not exist and one that is not this
 * supplier's, so nothing can be learned by guessing ids.
 */
export async function getPortalInvoice(db: D1Database, claims: PortalAccessClaims, invoiceId: string): Promise<RouteResult> {
  const { sql, binds } = scope(claims);
  const row = await db.prepare(`${SELECT} WHERE h.id = ? AND ${sql}`).bind(invoiceId, ...binds).first<PortalRow>();
  if (!row) return { status: 404, body: { error: "not found" } };
  const lines = (
    await db.prepare("SELECT line_number, facts_json FROM invoice_lines WHERE invoice_id = ? ORDER BY line_number").bind(invoiceId).all<{ line_number: number; facts_json: string }>()
  ).results.map((l) => {
    let f: Record<string, unknown> = {};
    try {
      f = JSON.parse(l.facts_json || "{}") as Record<string, unknown>;
    } catch {
      // As above.
    }
    const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : null);
    return {
      lineNumber: l.line_number,
      description: typeof f["BT-153"] === "string" ? f["BT-153"] : null,
      quantity: num(f["BT-129"]),
      unitPrice: num(f["BT-146"]),
      netAmount: num(f["BT-131"]),
    };
  });
  const messages = await portalMessages(db, invoiceId);
  // Decision 0724: a return in the conversation already says the reason and the comment.
  const summarised = summary(row);
  if (messages.some((m) => m.kind === "return")) summarised.comment = null;
  return { status: 200, body: { invoice: { ...summarised, lines, messages } } };
}

/** `POST /portal/invoices/:id/messages` — the supplier writes about one of their invoices (0721). */
export async function replyOnPortalInvoice(db: D1Database, claims: PortalAccessClaims, invoiceId: string, body: Record<string, unknown>, email: MessageEmail): Promise<RouteResult> {
  const { sql, binds } = scope(claims);
  const mine = await db.prepare(`SELECT h.id FROM invoice_headers h WHERE h.id = ? AND ${sql}`).bind(invoiceId, ...binds).first();
  if (!mine) return { status: 404, body: { error: "not found" } };
  return handlePortalReply(db, claims, invoiceId, body, email);
}
