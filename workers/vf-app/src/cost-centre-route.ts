import type { RouteResult } from "./org-route.js";

/**
 * Minimal CRUD for a real, customer-managed cost centre list — see
 * docs/decisions/0031-cost-centre-vs-org-units.md. Deliberately
 * global, not scoped per-process the way intake_channels (decision
 * 0024) is — a cost centre is a company-wide financial construct,
 * not tied to how something enters any one specific process. No
 * authentication, matching the same "raw API for now" precedent
 * already used for /org/units and /org/teams. Deliberately not wired
 * into rule validation anywhere — this makes the cost centre list
 * manageable; it does not make a rule's BT-133 value enforced against
 * it, the same declined scope decisions 0023/0024 already established
 * for intake channels.
 */

interface CreateCostCentreBody {
  id?: unknown;
  name?: unknown;
}

export async function handleCreateCostCentre(db: D1Database, body: CreateCostCentreBody): Promise<RouteResult> {
  const { id, name } = body;
  if (typeof id !== "string" || !id || typeof name !== "string" || !name) {
    return { status: 400, body: { error: "id and name (both strings) are required" } };
  }

  const existingId = await db.prepare("SELECT id FROM cost_centres WHERE id = ?").bind(id).first();
  if (existingId) {
    return { status: 409, body: { error: `cost centre ${id} already exists` } };
  }
  const existingName = await db.prepare("SELECT id FROM cost_centres WHERE name = ?").bind(name).first();
  if (existingName) {
    return { status: 409, body: { error: `a cost centre named "${name}" already exists` } };
  }

  await db.prepare("INSERT INTO cost_centres (id, name) VALUES (?, ?)").bind(id, name).run();

  return { status: 201, body: { id, name } };
}
