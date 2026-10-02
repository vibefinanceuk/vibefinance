import type { RouteResult } from "./customers-route.js";

/**
 * **Reviewing partners' connectors — decision 0600**, step 3 of slice 4.
 *
 * VibeFinance approves each version a partner submits before any customer
 * sees it (Dan, 1 October 2026). The operator console's review queue
 * shows each version waiting with everything it rests on: the partner,
 * who submitted it and where it was built (the partner's sandbox, or a
 * customer it serves, 0596), the notes for the reviewer, which customers
 * it is for, and its definition and outbound mapping. The reviewer
 * approves it, or sends it back with a reason the partner sees.
 *
 * A whole connector can be suspended with a reason, and reinstated. A
 * suspended connector, or one whose partner is suspended, will not be
 * offered to customers (step 4); Destinations already made from it keep
 * working.
 *
 * All privileged, and recorded in the admin log at the edge.
 */

interface Row {
  connector_id: string;
  version: number;
  status: string;
  name: string;
  description: string;
  notes: string | null;
  audience_json: string | null;
  definition_json: string;
  submitted_by: string;
  submitted_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_reason: string | null;
  partner_id: string;
  partner_name: string;
  partner_status: string;
  connector_status: string;
  suspended_reason: string | null;
  source_environment_id: string;
  source_kind: string | null;
  source_customer_id: string | null;
  source_customer_name: string | null;
  sandbox_customer_id: string;
}

const SELECT = `SELECT v.*, c.partner_id, c.status AS connector_status, c.suspended_reason, c.source_environment_id,
       p.name AS partner_name, p.status AS partner_status, p.sandbox_customer_id,
       e.kind AS source_kind, e.customer_id AS source_customer_id, sc.name AS source_customer_name
  FROM partner_connector_versions v
  JOIN partner_connectors c ON c.id = v.connector_id
  JOIN partners p ON p.id = c.partner_id
  LEFT JOIN environments e ON e.id = c.source_environment_id
  LEFT JOIN customers sc ON sc.id = e.customer_id`;

async function customerNames(db: D1Database): Promise<Map<string, string>> {
  const rows = (await db.prepare("SELECT id, name FROM customers").all<{ id: string; name: string }>()).results;
  return new Map(rows.map((r) => [r.id, r.name]));
}

function view(r: Row, names: Map<string, string>) {
  const audience = r.audience_json ? (JSON.parse(r.audience_json) as string[]) : null;
  return {
    connectorId: r.connector_id,
    version: r.version,
    status: r.status,
    name: r.name,
    description: r.description,
    notes: r.notes,
    audience: audience ? audience.map((id) => ({ id, name: names.get(id) ?? id })) : "all",
    definition: JSON.parse(r.definition_json) as unknown,
    submittedBy: r.submitted_by,
    submittedAt: r.submitted_at,
    reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at,
    reviewReason: r.review_reason,
    partner: { id: r.partner_id, name: r.partner_name, status: r.partner_status },
    connector: { status: r.connector_status, suspendedReason: r.suspended_reason },
    source: {
      environmentId: r.source_environment_id,
      kind: r.source_kind,
      customerId: r.source_customer_id,
      customerName: r.source_customer_name,
      sandbox: r.source_customer_id === r.sandbox_customer_id,
    },
  };
}

/**
 * `GET /partner-connectors?status=submitted` — the review queue, oldest
 * first; without `status`, every connector's versions, newest first.
 */
export async function listPartnerConnectors(db: D1Database, status: string | null): Promise<RouteResult> {
  const names = await customerNames(db);
  const rows = status
    ? (await db.prepare(`${SELECT} WHERE v.status = ? ORDER BY v.submitted_at`).bind(status).all<Row>()).results
    : (await db.prepare(`${SELECT} ORDER BY lower(p.name), lower(c.name), v.version DESC`).all<Row>()).results;
  return { status: 200, body: { versions: rows.map((r) => view(r, names)) } };
}

async function versionOf(db: D1Database, connectorId: string, version: number): Promise<Row | null> {
  return db.prepare(`${SELECT} WHERE v.connector_id = ? AND v.version = ?`).bind(connectorId, version).first<Row>();
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** `POST /partner-connectors/:id/versions/:v/approve` and `/return` `{ reason }`. */
export async function reviewVersion(
  db: D1Database,
  actor: string,
  connectorId: string,
  version: number,
  decision: "approve" | "return",
  body: Record<string, unknown>,
  now = new Date()
): Promise<RouteResult> {
  const row = await versionOf(db, connectorId, version);
  if (!row) return { status: 404, body: { error: `version ${version} of connector ${connectorId} does not exist` } };
  if (row.status !== "submitted") return { status: 409, body: { error: `version ${version} is ${row.status}, not waiting for review`, reason: "not_waiting" } };
  const reason = str(body.reason);
  if (decision === "return" && !reason) return { status: 400, body: { error: "say why it is sent back: the partner sees it", reason: "no_reason" } };
  const status = decision === "approve" ? "approved" : "returned";
  const r = await db
    .prepare(
      "UPDATE partner_connector_versions SET status = ?, reviewed_by = ?, reviewed_at = ?, review_reason = ? WHERE connector_id = ? AND version = ? AND status = 'submitted'"
    )
    .bind(status, actor, now.toISOString(), decision === "return" ? reason.slice(0, 1000) : reason ? reason.slice(0, 1000) : null, connectorId, version)
    .run();
  if ((r.meta.changes ?? 0) === 0) return { status: 409, body: { error: "it was decided or withdrawn meanwhile", reason: "not_waiting" } };
  return { status: 200, body: { connectorId, version, status } };
}

/** `POST /partner-connectors/:id/suspend` `{ reason }` and `/reinstate`. */
export async function suspendConnector(db: D1Database, actor: string, connectorId: string, suspend: boolean, body: Record<string, unknown>, now = new Date()): Promise<RouteResult> {
  const c = await db.prepare("SELECT id, name, status FROM partner_connectors WHERE id = ?").bind(connectorId).first<{ id: string; name: string; status: string }>();
  if (!c) return { status: 404, body: { error: `connector ${connectorId} does not exist` } };
  if (suspend) {
    if (c.status === "suspended") return { status: 409, body: { error: `${c.name} is already suspended`, reason: "already" } };
    const reason = str(body.reason);
    if (!reason) return { status: 400, body: { error: "say why it is suspended", reason: "no_reason" } };
    await db
      .prepare("UPDATE partner_connectors SET status = 'suspended', suspended_at = ?, suspended_by = ?, suspended_reason = ? WHERE id = ?")
      .bind(now.toISOString(), actor, reason.slice(0, 500), connectorId)
      .run();
    return { status: 200, body: { connectorId, status: "suspended" } };
  }
  if (c.status !== "suspended") return { status: 409, body: { error: `${c.name} is not suspended`, reason: "already" } };
  await db.prepare("UPDATE partner_connectors SET status = 'active', suspended_at = NULL, suspended_by = NULL, suspended_reason = NULL WHERE id = ?").bind(connectorId).run();
  return { status: 200, body: { connectorId, status: "active" } };
}
