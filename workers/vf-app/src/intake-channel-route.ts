import type { RouteResult } from "./org-route.js";

/**
 * Minimal CRUD for intake channels — see docs/decisions/
 * 0024-intake-channels.md. A real, per-process, customer-managed
 * list — adding a new channel is an ordinary API call, not a code
 * change or a deployment. Deliberately no authentication, matching
 * /processes and /processes/:id/stages (decision 0010's own
 * administrative-setup reasoning): this is definition-time
 * configuration, not gated product usage. Deliberately not wired
 * into rule validation or evaluation anywhere — decision 0023
 * explicitly declined closed-value enforcement, and this file
 * doesn't reopen that; it only makes the list itself manageable.
 */

interface CreateIntakeChannelBody {
  id?: unknown;
  name?: unknown;
}

export async function handleCreateIntakeChannel(
  db: D1Database,
  processId: string,
  body: CreateIntakeChannelBody
): Promise<RouteResult> {
  const { id, name } = body;
  if (typeof id !== "string" || !id || typeof name !== "string" || !name) {
    return { status: 400, body: { error: "id and name (both strings) are required" } };
  }

  const processExists = await db.prepare("SELECT id FROM processes WHERE id = ?").bind(processId).first();
  if (!processExists) {
    return { status: 404, body: { error: `process ${processId} does not exist` } };
  }

  const existing = await db.prepare("SELECT id FROM intake_channels WHERE id = ?").bind(id).first();
  if (existing) {
    return { status: 409, body: { error: `intake channel ${id} already exists` } };
  }
  const nameTaken = await db
    .prepare("SELECT id FROM intake_channels WHERE process_id = ? AND name = ?")
    .bind(processId, name)
    .first();
  if (nameTaken) {
    return { status: 409, body: { error: `a channel named "${name}" already exists for process ${processId}` } };
  }

  await db
    .prepare("INSERT INTO intake_channels (id, process_id, name) VALUES (?, ?, ?)")
    .bind(id, processId, name)
    .run();

  return { status: 201, body: { id, processId, name } };
}
