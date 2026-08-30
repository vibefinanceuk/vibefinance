import type { RouteResult } from "./customers-route.js";

interface CustomerRow {
  id: string;
  name: string;
  region: string;
  instance_url: string;
  worker_name: string | null;
  d1_database_name: string | null;
  d1_database_id: string | null;
  locale: string | null;
  created_at: string;
}

function toFleetView(row: CustomerRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    region: row.region,
    instanceUrl: row.instance_url,
    workerName: row.worker_name,
    d1DatabaseName: row.d1_database_name,
    d1DatabaseId: row.d1_database_id,
    locale: row.locale,
    createdAt: row.created_at,
    // Deliberately never api_key_hash — this route is the fleet
    // manifest a tool like migrate-all reads, not a customer-detail
    // endpoint, and there is no reason a hash (even a hash, never the
    // plaintext) needs to leave this database at all.
  };
}

/**
 * GET /customers — the fleet manifest every fleet tool (migrate-all,
 * deploy-all, "who's on what version") ultimately reads from. See
 * docs/decisions/0011-fleet-tooling.md. A customer with no fleet
 * metadata set (worker_name, d1_database_name, d1_database_id all
 * NULL) is included, not filtered out — a fleet tool deciding what to
 * skip is its own responsibility, not something this route should
 * silently do for it.
 */
export async function handleListCustomers(db: D1Database): Promise<RouteResult> {
  const rows = await db
    .prepare(
      `SELECT id, name, region, instance_url, worker_name, d1_database_name, d1_database_id, locale, created_at
       FROM customers ORDER BY id`
    )
    .all<CustomerRow>();

  return { status: 200, body: { customers: rows.results.map(toFleetView) } };
}

interface SetFleetMetadataBody {
  workerName?: unknown;
  d1DatabaseName?: unknown;
  d1DatabaseId?: unknown;
  locale?: unknown;
}

function validateOptionalString(value: unknown, fieldName: string): string | { error: string } | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value) {
    return { error: `${fieldName}, if provided, must be a non-empty string` };
  }
  return value;
}

/**
 * PATCH /customers/:id/fleet-metadata — sets or updates a customer's
 * deployment specifics. A true partial update: only fields present in
 * the body are changed, everything else keeps its current value —
 * this is how Acme, the one real customer that predates this
 * migration, gets backfilled (and how any future redeploy — a
 * customer's database gets recreated, say — gets recorded) without
 * needing to resend fields that haven't changed.
 */
export async function handleSetFleetMetadata(
  db: D1Database,
  customerId: string,
  body: SetFleetMetadataBody
): Promise<RouteResult> {
  const existing = await db
    .prepare(
      "SELECT id, worker_name, d1_database_name, d1_database_id, locale FROM customers WHERE id = ?"
    )
    .bind(customerId)
    .first<{
      id: string;
      worker_name: string | null;
      d1_database_name: string | null;
      d1_database_id: string | null;
      locale: string | null;
    }>();
  if (!existing) {
    return { status: 404, body: { error: `customer ${customerId} does not exist` } };
  }

  const workerName = validateOptionalString(body.workerName, "workerName");
  if (workerName && typeof workerName === "object") return { status: 400, body: { error: workerName.error } };
  const d1DatabaseName = validateOptionalString(body.d1DatabaseName, "d1DatabaseName");
  if (d1DatabaseName && typeof d1DatabaseName === "object")
    return { status: 400, body: { error: d1DatabaseName.error } };
  const d1DatabaseId = validateOptionalString(body.d1DatabaseId, "d1DatabaseId");
  if (d1DatabaseId && typeof d1DatabaseId === "object") return { status: 400, body: { error: d1DatabaseId.error } };
  const locale = validateOptionalString(body.locale, "locale");
  if (locale && typeof locale === "object") return { status: 400, body: { error: locale.error } };

  const merged = {
    worker_name: (workerName as string | undefined) ?? existing.worker_name,
    d1_database_name: (d1DatabaseName as string | undefined) ?? existing.d1_database_name,
    d1_database_id: (d1DatabaseId as string | undefined) ?? existing.d1_database_id,
    locale: (locale as string | undefined) ?? existing.locale,
  };

  await db
    .prepare(
      "UPDATE customers SET worker_name = ?, d1_database_name = ?, d1_database_id = ?, locale = ? WHERE id = ?"
    )
    .bind(merged.worker_name, merged.d1_database_name, merged.d1_database_id, merged.locale, customerId)
    .run();

  return {
    status: 200,
    body: {
      id: customerId,
      workerName: merged.worker_name,
      d1DatabaseName: merged.d1_database_name,
      d1DatabaseId: merged.d1_database_id,
      locale: merged.locale,
    },
  };
}
