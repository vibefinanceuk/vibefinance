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

  await db
    .prepare("INSERT INTO customers (id, name, region, instance_url) VALUES (?, ?, ?, ?)")
    .bind(id, name, region, instanceUrl)
    .run();

  return { status: 201, body: { id, name, region, instanceUrl } };
}
