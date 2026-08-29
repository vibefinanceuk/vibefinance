import type { RouteResult } from "./customers-route.js";

export interface UpsertLicenceBody {
  customerId?: unknown;
  plan?: unknown;
  features?: unknown;
  volumeEntitlement?: unknown;
  validFrom?: unknown;
  validTo?: unknown;
  status?: unknown;
  statusReason?: unknown;
  statusEffectiveAt?: unknown;
}

const VALID_STATUSES = ["active", "warned", "blocked"] as const;

export async function handleUpsertLicence(
  db: D1Database,
  body: UpsertLicenceBody
): Promise<RouteResult> {
  const { customerId, plan, volumeEntitlement, validFrom } = body;
  if (
    typeof customerId !== "string" ||
    !customerId ||
    typeof plan !== "string" ||
    !plan ||
    typeof volumeEntitlement !== "number" ||
    typeof validFrom !== "string" ||
    !validFrom
  ) {
    return {
      status: 400,
      body: {
        error:
          "customerId, plan (strings), volumeEntitlement (number) and validFrom (string) are required",
      },
    };
  }

  const features = Array.isArray(body.features)
    ? body.features.filter((f): f is string => typeof f === "string")
    : [];
  const validTo = typeof body.validTo === "string" ? body.validTo : null;
  const status =
    typeof body.status === "string" && (VALID_STATUSES as readonly string[]).includes(body.status)
      ? body.status
      : "active";
  const statusReason = typeof body.statusReason === "string" ? body.statusReason : null;
  const statusEffectiveAt =
    typeof body.statusEffectiveAt === "string" ? body.statusEffectiveAt : null;

  const customerExists = await db
    .prepare("SELECT id FROM customers WHERE id = ?")
    .bind(customerId)
    .first();
  if (!customerExists) {
    return { status: 404, body: { error: `customer ${customerId} does not exist` } };
  }

  // licences.customer_id is the primary key — one row per customer, so
  // this is a genuine upsert (create the first licence, or replace the
  // current one on a plan change), not an append. See
  // workers/vf-licence/migrations/0001_control_plane_schema.sql's own
  // comment on why this table isn't versioned.
  await db
    .prepare(
      `INSERT INTO licences
         (customer_id, plan, features_json, volume_entitlement, valid_from, valid_to, status, status_reason, status_effective_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(customer_id) DO UPDATE SET
         plan = excluded.plan,
         features_json = excluded.features_json,
         volume_entitlement = excluded.volume_entitlement,
         valid_from = excluded.valid_from,
         valid_to = excluded.valid_to,
         status = excluded.status,
         status_reason = excluded.status_reason,
         status_effective_at = excluded.status_effective_at,
         updated_at = datetime('now')`
    )
    .bind(
      customerId,
      plan,
      JSON.stringify(features),
      volumeEntitlement,
      validFrom,
      validTo,
      status,
      statusReason,
      statusEffectiveAt
    )
    .run();

  return {
    status: 200,
    body: { customerId, plan, features, volumeEntitlement, validFrom, validTo, status },
  };
}
