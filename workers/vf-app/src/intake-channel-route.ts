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

/**
 * The document structures a channel can handle — decision 0061. An
 * intake channel is a per-process handler for exactly one of these,
 * selected by detecting what a document actually is rather than by a
 * caller choosing an endpoint.
 */
export const CHANNEL_STRUCTURES = ["structured_xml", "structured_pdfa", "image"] as const;
export type ChannelStructure = (typeof CHANNEL_STRUCTURES)[number];

export function isKnownChannelStructure(value: unknown): value is ChannelStructure {
  return typeof value === "string" && (CHANNEL_STRUCTURES as readonly string[]).includes(value);
}

interface CreateIntakeChannelBody {
  id?: unknown;
  name?: unknown;
  structure?: unknown;
}

export async function handleCreateIntakeChannel(
  db: D1Database,
  processId: string,
  body: CreateIntakeChannelBody
): Promise<RouteResult> {
  const { id, name, structure } = body;
  if (typeof id !== "string" || !id || typeof name !== "string" || !name) {
    return { status: 400, body: { error: "id and name (both strings) are required" } };
  }
  // Optional, because the legacy rows predating decision 0061 have no
  // structure and creating another such row must stay possible until
  // they are retired. Anything supplied must be real, though.
  if (structure !== undefined && !isKnownChannelStructure(structure)) {
    return {
      status: 400,
      body: { error: `structure, if supplied, must be one of ${CHANNEL_STRUCTURES.join(", ")}` },
    };
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

  if (structure !== undefined) {
    // Detection depends on there being exactly one channel per
    // structure per process. The partial unique index enforces it; a
    // 409 naming the real problem beats a raw constraint error
    // reaching the caller.
    const structureTaken = await db
      .prepare("SELECT id FROM intake_channels WHERE process_id = ? AND structure = ?")
      .bind(processId, structure)
      .first<{ id: string }>();
    if (structureTaken) {
      return {
        status: 409,
        body: {
          error: `process ${processId} already has a ${structure} channel (${structureTaken.id}) — detection requires exactly one per structure`,
        },
      };
    }
  }

  await db
    .prepare("INSERT INTO intake_channels (id, process_id, name, structure) VALUES (?, ?, ?, ?)")
    .bind(id, processId, name, structure ?? null)
    .run();

  return { status: 201, body: { id, processId, name, ...(structure === undefined ? {} : { structure }) } };
}
