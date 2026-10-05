import type { RouteResult } from "./customers-route.js";

export interface UpsertLicenceBody {
  environmentId?: unknown;
  plan?: unknown;
  features?: unknown;
  volumeEntitlement?: unknown;
  /** Decision 0622: how many agents the environment may have; null or absent for vf-app's default. */
  agentLimit?: unknown;
  summaryLimit?: unknown;
  agentActions?: unknown;
  queryLimit?: unknown;
  validFrom?: unknown;
  validTo?: unknown;
  status?: unknown;
  statusReason?: unknown;
  statusEffectiveAt?: unknown;
}

const VALID_STATUSES = ["active", "warned", "blocked"] as const;

/**
 * A licence now belongs to one specific environment, not a customer as
 * a whole (decision 0036) — a sandbox's 30-day trial licence and a
 * production environment's real subscription are genuinely separate
 * entitlements, each with their own status, expiry, and volume
 * entitlement.
 */
export async function handleUpsertLicence(
  db: D1Database,
  body: UpsertLicenceBody
): Promise<RouteResult> {
  const { environmentId, plan, volumeEntitlement, validFrom } = body;
  if (
    typeof environmentId !== "string" ||
    !environmentId ||
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
          "environmentId, plan (strings), volumeEntitlement (number) and validFrom (string) are required",
      },
    };
  }

  if (
    body.agentLimit !== undefined &&
    body.agentLimit !== null &&
    !(typeof body.agentLimit === "number" && Number.isInteger(body.agentLimit) && body.agentLimit >= 0)
  ) {
    return { status: 400, body: { error: "agentLimit must be a whole number, 0 or more, or null" } };
  }
  const agentLimit = typeof body.agentLimit === "number" ? body.agentLimit : null;
  // Decision 0626: AI summaries a day, the same way.
  if (
    body.summaryLimit !== undefined &&
    body.summaryLimit !== null &&
    !(typeof body.summaryLimit === "number" && Number.isInteger(body.summaryLimit) && body.summaryLimit >= 0)
  ) {
    return { status: 400, body: { error: "summaryLimit must be a whole number, 0 or more, or null" } };
  }
  const summaryLimit = typeof body.summaryLimit === "number" ? body.summaryLimit : null;
  // Decision 0631: prepared actions in this tier or not; absent or null means allowed.
  if (body.agentActions !== undefined && body.agentActions !== null && typeof body.agentActions !== "boolean") {
    return { status: 400, body: { error: "agentActions must be true, false or null" } };
  }
  const agentActions = typeof body.agentActions === "boolean" ? body.agentActions : null;
  // Decision 0638: agents' own questions a day; 0 leaves them out, null the default.
  if (
    body.queryLimit !== undefined &&
    body.queryLimit !== null &&
    !(typeof body.queryLimit === "number" && Number.isInteger(body.queryLimit) && body.queryLimit >= 0)
  ) {
    return { status: 400, body: { error: "queryLimit must be a whole number, 0 or more, or null" } };
  }
  const queryLimit = typeof body.queryLimit === "number" ? body.queryLimit : null;

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

  const environmentExists = await db
    .prepare("SELECT id FROM environments WHERE id = ?")
    .bind(environmentId)
    .first();
  if (!environmentExists) {
    return { status: 404, body: { error: `environment ${environmentId} does not exist` } };
  }

  // licences.environment_id is the primary key — one row per
  // environment, so this is a genuine upsert (create the first
  // licence, or replace the current one on a plan change), not an
  // append. See workers/vf-licence/migrations/
  // 0001_control_plane_schema.sql's own comment on why this table
  // isn't versioned.
  await db
    .prepare(
      `INSERT INTO licences
         (environment_id, plan, features_json, volume_entitlement, valid_from, valid_to, status, status_reason, status_effective_at, agent_limit, summary_limit, agent_actions, query_limit, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(environment_id) DO UPDATE SET
         plan = excluded.plan,
         features_json = excluded.features_json,
         volume_entitlement = excluded.volume_entitlement,
         valid_from = excluded.valid_from,
         valid_to = excluded.valid_to,
         status = excluded.status,
         status_reason = excluded.status_reason,
         status_effective_at = excluded.status_effective_at,
         agent_limit = excluded.agent_limit,
         summary_limit = excluded.summary_limit,
         agent_actions = excluded.agent_actions,
         query_limit = excluded.query_limit,
         updated_at = datetime('now')`
    )
    .bind(
      environmentId,
      plan,
      JSON.stringify(features),
      volumeEntitlement,
      validFrom,
      validTo,
      status,
      statusReason,
      statusEffectiveAt,
      agentLimit,
      summaryLimit,
      agentActions === null ? null : agentActions ? 1 : 0,
      queryLimit
    )
    .run();

  return {
    status: 200,
    body: { environmentId, plan, features, volumeEntitlement, agentLimit, summaryLimit, agentActions, queryLimit, validFrom, validTo, status },
  };
}
