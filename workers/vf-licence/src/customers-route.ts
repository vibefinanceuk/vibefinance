export interface CreateCustomerBody {
  id?: unknown;
  name?: unknown;
}

export interface RouteResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * A customer is now genuinely just identity — id and name. Everything
 * that used to be created in the same call (region, instanceUrl, the
 * API key, fleet metadata) is a property of one specific *environment*
 * now (decision 0036) — a customer can have a sandbox and a production
 * environment, each with its own real deployment and its own real
 * licence. See environment-route.ts's own handleCreateEnvironment for
 * that half of what this route used to do in one call.
 */
export async function handleCreateCustomer(db: D1Database, body: CreateCustomerBody): Promise<RouteResult> {
  const { id, name } = body;
  if (typeof id !== "string" || !id || typeof name !== "string" || !name) {
    return { status: 400, body: { error: "id and name (both strings) are required" } };
  }

  const existing = await db.prepare("SELECT id FROM customers WHERE id = ?").bind(id).first();
  if (existing) {
    return { status: 409, body: { error: `customer ${id} already exists` } };
  }

  await db.prepare("INSERT INTO customers (id, name) VALUES (?, ?)").bind(id, name).run();

  return { status: 201, body: { id, name } };
}
