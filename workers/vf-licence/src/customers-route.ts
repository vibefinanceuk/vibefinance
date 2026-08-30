import { generateApiKey, hashApiKey } from "./auth.js";

export interface CreateCustomerBody {
  id?: unknown;
  name?: unknown;
  region?: unknown;
  instanceUrl?: unknown;
}

export interface RouteResult {
  status: number;
  body: Record<string, unknown>;
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
    .prepare("INSERT INTO customers (id, name, region, instance_url, api_key_hash) VALUES (?, ?, ?, ?, ?)")
    .bind(id, name, region, instanceUrl, apiKeyHash)
    .run();

  return { status: 201, body: { id, name, region, instanceUrl, apiKey } };
}
