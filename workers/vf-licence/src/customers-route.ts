import { generateApiKey, hashApiKey } from "./auth.js";

export interface CreateCustomerBody {
  id?: unknown;
  name?: unknown;
  region?: unknown;
  instanceUrl?: unknown;
  workerName?: unknown;
  d1DatabaseName?: unknown;
  d1DatabaseId?: unknown;
  locale?: unknown;
}

export interface RouteResult {
  status: number;
  body: Record<string, unknown>;
}

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

export async function handleCreateCustomer(
  db: D1Database,
  body: CreateCustomerBody
): Promise<RouteResult> {
  const { id, name, region, instanceUrl } = body;
  if (
    typeof id !== "string" ||
    !id ||
    typeof name !== "string" ||
    !name ||
    typeof region !== "string" ||
    !region ||
    typeof instanceUrl !== "string" ||
    !instanceUrl
  ) {
    return {
      status: 400,
      body: { error: "id, name, region and instanceUrl (all strings) are required" },
    };
  }

  // Fleet metadata (Blueprint build order step 5 — see
  // docs/decisions/0011-fleet-tooling.md) is optional at creation
  // time, same as it is via the dedicated PATCH .../fleet-metadata
  // route: a customer can exist in the control plane before their
  // vf-app deployment's specifics are known, and a fleet tool must
  // treat a customer with none of this set as "not deployable yet",
  // never guess a default.
  const workerName = optionalStringField(body.workerName, "workerName");
  if (!workerName.ok) return { status: 400, body: { error: workerName.error } };
  const d1DatabaseName = optionalStringField(body.d1DatabaseName, "d1DatabaseName");
  if (!d1DatabaseName.ok) return { status: 400, body: { error: d1DatabaseName.error } };
  const d1DatabaseId = optionalStringField(body.d1DatabaseId, "d1DatabaseId");
  if (!d1DatabaseId.ok) return { status: 400, body: { error: d1DatabaseId.error } };
  const locale = optionalStringField(body.locale, "locale");
  if (!locale.ok) return { status: 400, body: { error: locale.error } };

  const existing = await db.prepare("SELECT id FROM customers WHERE id = ?").bind(id).first();
  if (existing) {
    return { status: 409, body: { error: `customer ${id} already exists` } };
  }

  // The plaintext key exists only in this response — only its hash is
  // ever stored, from this point on (see docs/decisions/
  // 0006-endpoint-authentication.md). If it's lost, the fix is
  // rotating it (POST /customers/:id/rotate-key), never recovering it.
  const apiKey = generateApiKey();
  const apiKeyHash = await hashApiKey(apiKey);

  await db
    .prepare(
      `INSERT INTO customers
         (id, name, region, instance_url, api_key_hash, worker_name, d1_database_name, d1_database_id, locale)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      name,
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
      name,
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
