import { generateApiKey, hashApiKey } from "./auth.js";
import type { RouteResult } from "./customers-route.js";

export interface CreateEnvironmentBody {
  customerId?: unknown;
  kind?: unknown;
  region?: unknown;
  instanceUrl?: unknown;
  workerName?: unknown;
  d1DatabaseName?: unknown;
  d1DatabaseId?: unknown;
  locale?: unknown;
}

const VALID_KINDS = ["sandbox", "production"] as const;

function optionalStringField(
  value: unknown,
  fieldName: string
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: null };
  if (typeof value !== "string" || !value) {
    return { ok: false, error: `${fieldName}, if provided, must be a non-empty string` };
  }
  return { ok: true, value };
}

/**
 * Creates one real environment for an existing customer — decision
 * 0036. UNIQUE(customer_id, kind) in the schema means a second
 * 'production' (or a second 'sandbox') for the same customer is a
 * real, structural refusal, not silently allowed — matches the
 * described flow exactly: at most one sandbox and one production per
 * customer, ever.
 *
 * id is deterministic ({customerId}-{kind}), the same convention
 * decision 0036's own migration used to backfill Acme's existing
 * deployment as 'acme-production' — not random, so a customer's own
 * environment ids are predictable and human-readable, not opaque
 * UUIDs a person has to look up.
 *
 * Fleet metadata (workerName, d1DatabaseName, d1DatabaseId, locale) is
 * optional here, same as it was on the old, combined customer-creation
 * route — an environment can exist in the control plane before its
 * real vf-app deployment's specifics are known.
 */
export async function handleCreateEnvironment(
  db: D1Database,
  body: CreateEnvironmentBody
): Promise<RouteResult> {
  const { customerId, kind, region, instanceUrl } = body;
  if (
    typeof customerId !== "string" ||
    !customerId ||
    typeof kind !== "string" ||
    !(VALID_KINDS as readonly string[]).includes(kind) ||
    typeof region !== "string" ||
    !region ||
    typeof instanceUrl !== "string" ||
    !instanceUrl
  ) {
    return {
      status: 400,
      body: {
        error: `customerId, region and instanceUrl (all strings) and kind (one of ${VALID_KINDS.join(", ")}) are required`,
      },
    };
  }

  const customerExists = await db.prepare("SELECT id FROM customers WHERE id = ?").bind(customerId).first();
  if (!customerExists) {
    return { status: 404, body: { error: `customer ${customerId} does not exist` } };
  }

  const existingEnvironment = await db
    .prepare("SELECT id FROM environments WHERE customer_id = ? AND kind = ?")
    .bind(customerId, kind)
    .first();
  if (existingEnvironment) {
    return { status: 409, body: { error: `customer ${customerId} already has a ${kind} environment` } };
  }

  const workerName = optionalStringField(body.workerName, "workerName");
  if (!workerName.ok) return { status: 400, body: { error: workerName.error } };
  const d1DatabaseName = optionalStringField(body.d1DatabaseName, "d1DatabaseName");
  if (!d1DatabaseName.ok) return { status: 400, body: { error: d1DatabaseName.error } };
  const d1DatabaseId = optionalStringField(body.d1DatabaseId, "d1DatabaseId");
  if (!d1DatabaseId.ok) return { status: 400, body: { error: d1DatabaseId.error } };
  const locale = optionalStringField(body.locale, "locale");
  if (!locale.ok) return { status: 400, body: { error: locale.error } };

  const id = `${customerId}-${kind}`;

  // The plaintext key exists only in this response — only its hash is
  // ever stored, from this point on (see docs/decisions/
  // 0006-endpoint-authentication.md). If it's lost, the fix is
  // rotating it, never recovering it.
  const apiKey = generateApiKey();
  const apiKeyHash = await hashApiKey(apiKey);

  await db
    .prepare(
      `INSERT INTO environments
         (id, customer_id, kind, region, instance_url, api_key_hash, worker_name, d1_database_name, d1_database_id, locale)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      customerId,
      kind,
      region,
      instanceUrl,
      apiKeyHash,
      workerName.value,
      d1DatabaseName.value,
      d1DatabaseId.value,
      locale.value
    )
    .run();

  return {
    status: 201,
    body: {
      id,
      customerId,
      kind,
      region,
      instanceUrl,
      apiKey,
      workerName: workerName.value,
      d1DatabaseName: d1DatabaseName.value,
      d1DatabaseId: d1DatabaseId.value,
      locale: locale.value,
    },
  };
}
