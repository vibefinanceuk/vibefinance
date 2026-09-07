import type { RouteResult } from "./customers-route.js";

interface EnvironmentRow {
  id: string;
  customer_id: string;
  kind: string;
  region: string;
  instance_url: string;
  worker_name: string | null;
  d1_database_name: string | null;
  d1_database_id: string | null;
  locale: string | null;
  created_at: string;
}

function toFleetView(row: EnvironmentRow): Record<string, unknown> {
  return {
    id: row.id,
    customerId: row.customer_id,
    kind: row.kind,
    region: row.region,
    instanceUrl: row.instance_url,
    workerName: row.worker_name,
    d1DatabaseName: row.d1_database_name,
    d1DatabaseId: row.d1_database_id,
    locale: row.locale,
    createdAt: row.created_at,
    // Deliberately never api_key_hash — this route is the fleet
    // manifest a tool like migrate-all reads, not an environment-
    // detail endpoint, and there is no reason a hash (even a hash,
    // never the plaintext) needs to leave this database at all.
  };
}

/**
 * GET /environments — the fleet manifest every fleet tool
 * (migrate-all, deploy-all, "who's on what version") ultimately reads
 * from. Re-keyed to list environments, not customers (decision 0036)
 * — a customer's deployment-specific details (region, instance_url,
 * worker_name, and so on) now live per environment, since a single
 * customer can have more than one real deployment (a sandbox and a
 * production environment). See docs/decisions/0011-fleet-tooling.md.
 * An environment with no fleet metadata set (worker_name,
 * d1_database_name, d1_database_id all NULL) is included, not
 * filtered out — a fleet tool deciding what to skip is its own
 * responsibility, not something this route should silently do for it.
 */
export async function handleListEnvironments(db: D1Database): Promise<RouteResult> {
  const rows = await db
    .prepare(
      `SELECT id, customer_id, kind, region, instance_url, worker_name, d1_database_name, d1_database_id, locale, created_at
       FROM environments ORDER BY id`
    )
    .all<EnvironmentRow>();

  return { status: 200, body: { environments: rows.results.map(toFleetView) } };
}

interface SetFleetMetadataBody {
  workerName?: unknown;
  d1DatabaseName?: unknown;
  d1DatabaseId?: unknown;
  locale?: unknown;
  /**
   * The R2 bucket, and where the Worker actually is — decision 0136.
   *
   * **Recorded by the thing that created them.** Setting these by hand
   * produced a wrong bucket name within an hour of the column existing,
   * which is why `provision_infrastructure.py` writes them and a
   * verification step exists at all.
   */
  r2BucketName?: unknown;
  instanceUrl?: unknown;
}

function validateOptionalString(value: unknown, fieldName: string): string | { error: string } | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value) {
    return { error: `${fieldName}, if provided, must be a non-empty string` };
  }
  return value;
}

/**
 * PATCH /environments/:id/fleet-metadata — sets or updates one
 * environment's deployment specifics. A true partial update: only
 * fields present in the body are changed, everything else keeps its
 * current value — this is how Acme's own production environment (the
 * one that predates decision 0036's migration) gets backfilled, and
 * how any future redeploy — a database gets recreated, say — gets
 * recorded, without needing to resend fields that haven't changed.
 */
export async function handleSetFleetMetadata(
  db: D1Database,
  environmentId: string,
  body: SetFleetMetadataBody
): Promise<RouteResult> {
  const existing = await db
    .prepare(
      `SELECT id, worker_name, d1_database_name, d1_database_id, locale,
              r2_bucket_name, instance_url
       FROM environments WHERE id = ?`
    )
    .bind(environmentId)
    .first<{
      id: string;
      worker_name: string | null;
      d1_database_name: string | null;
      d1_database_id: string | null;
      locale: string | null;
      r2_bucket_name: string | null;
      instance_url: string;
    }>();
  if (!existing) {
    return { status: 404, body: { error: `environment ${environmentId} does not exist` } };
  }

  const workerName = validateOptionalString(body.workerName, "workerName");
  if (workerName && typeof workerName === "object") return { status: 400, body: { error: workerName.error } };
  const d1DatabaseName = validateOptionalString(body.d1DatabaseName, "d1DatabaseName");
  if (d1DatabaseName && typeof d1DatabaseName === "object")
    return { status: 400, body: { error: d1DatabaseName.error } };
  const d1DatabaseId = validateOptionalString(body.d1DatabaseId, "d1DatabaseId");
  if (d1DatabaseId && typeof d1DatabaseId === "object") return { status: 400, body: { error: d1DatabaseId.error } };
  const locale = validateOptionalString(body.locale, "locale");
  const r2BucketName = validateOptionalString(body.r2BucketName, "r2BucketName");
  const instanceUrl = validateOptionalString(body.instanceUrl, "instanceUrl");
  if (locale && typeof locale === "object") return { status: 400, body: { error: locale.error } };
  if (r2BucketName && typeof r2BucketName === "object") return { status: 400, body: { error: r2BucketName.error } };
  if (instanceUrl && typeof instanceUrl === "object") return { status: 400, body: { error: instanceUrl.error } };

  const merged = {
    worker_name: (workerName as string | undefined) ?? existing.worker_name,
    d1_database_name: (d1DatabaseName as string | undefined) ?? existing.d1_database_name,
    d1_database_id: (d1DatabaseId as string | undefined) ?? existing.d1_database_id,
    locale: (locale as string | undefined) ?? existing.locale,
    r2_bucket_name: (r2BucketName as string | undefined) ?? existing.r2_bucket_name,
    // **`instance_url` is NOT NULL**, so it always has a value — the
    // `not-yet-deployed.invalid` placeholder decision 0039 put there.
    // Replacing it is what makes a customer reachable, and is the last
    // thing a deploy does.
    instance_url: (instanceUrl as string | undefined) ?? existing.instance_url,
  };

  await db
    .prepare(
      `UPDATE environments
       SET worker_name = ?, d1_database_name = ?, d1_database_id = ?, locale = ?,
           r2_bucket_name = ?, instance_url = ?
       WHERE id = ?`
    )
    .bind(
      merged.worker_name,
      merged.d1_database_name,
      merged.d1_database_id,
      merged.locale,
      merged.r2_bucket_name,
      merged.instance_url,
      environmentId
    )
    .run();

  return {
    status: 200,
    body: {
      id: environmentId,
      workerName: merged.worker_name,
      d1DatabaseName: merged.d1_database_name,
      d1DatabaseId: merged.d1_database_id,
      locale: merged.locale,
      r2BucketName: merged.r2_bucket_name,
      instanceUrl: merged.instance_url,
    },
  };
}
