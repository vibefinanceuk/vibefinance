import type { RouteResult } from "./org-route.js";

/**
 * Sources — decision 0060.
 *
 * A source is a configured connection through which documents arrive:
 * a mailbox, an HTTPS endpoint, an SFTP drop. It records HOW a document
 * arrived and makes no claim about WHAT it is — structure is determined
 * at intake, from the document itself (decision 0055 section 6).
 *
 * Each mechanism type can be instantiated more than once: two
 * mailboxes, or two tax authority APIs for two jurisdictions, are two
 * source instances of one mechanism. The name is the instance's, not
 * the mechanism's, because a report collapsing "AP mailbox" and "AR
 * mailbox" to "email" answers nothing useful.
 *
 * Not a stage. A source runs before any process instance exists, so
 * there are no facts to evaluate and no rule could fire on it —
 * modelling it as a stage would mean the workflow engine growing a
 * special case that skips evaluation entirely (decision 0055
 * section 3).
 */

export const SOURCE_MECHANISMS = ["email", "https", "sftp", "file_import", "edi"] as const;
export type SourceMechanism = (typeof SOURCE_MECHANISMS)[number];

export function isKnownSourceMechanism(value: unknown): value is SourceMechanism {
  return typeof value === "string" && (SOURCE_MECHANISMS as readonly string[]).includes(value);
}

interface SourceRow {
  id: string;
  process_id: string;
  name: string;
  mechanism: string;
  legacy_channel_id: string | null;
  created_at: string;
}

function toBody(row: SourceRow) {
  return {
    id: row.id,
    processId: row.process_id,
    name: row.name,
    mechanism: row.mechanism,
    // Present only on a source backfilled from an intake channel.
    // Surfaced rather than hidden so an operator can see which arrival
    // points predate the split, and so historical mandate.channel
    // values remain traceable.
    ...(row.legacy_channel_id === null ? {} : { legacyChannelId: row.legacy_channel_id }),
    createdAt: row.created_at,
  };
}

export async function handleCreateSource(
  db: D1Database,
  processId: string,
  body: Record<string, unknown>
): Promise<RouteResult> {
  const process = await db.prepare("SELECT id FROM processes WHERE id = ?").bind(processId).first();
  if (!process) {
    return { status: 404, body: { error: `process ${processId} does not exist` } };
  }

  const { id, name, mechanism } = body;
  if (typeof id !== "string" || id.trim() === "") {
    return { status: 400, body: { error: "id (non-empty string) is required" } };
  }
  if (typeof name !== "string" || name.trim() === "") {
    // An unnamed arrival point cannot be reported on, which is most of
    // what a source is for.
    return { status: 400, body: { error: "name (non-empty string) is required" } };
  }
  if (!isKnownSourceMechanism(mechanism)) {
    return {
      status: 400,
      body: { error: `mechanism must be one of ${SOURCE_MECHANISMS.join(", ")}` },
    };
  }

  const existing = await db.prepare("SELECT id FROM sources WHERE id = ?").bind(id).first();
  if (existing) {
    return { status: 409, body: { error: `source ${id} already exists` } };
  }
  const duplicateName = await db
    .prepare("SELECT id FROM sources WHERE process_id = ? AND name = ?")
    .bind(processId, name)
    .first();
  if (duplicateName) {
    // The UNIQUE constraint would catch this, but a 409 naming the real
    // problem beats a raw constraint error reaching the caller.
    return { status: 409, body: { error: `process ${processId} already has a source named "${name}"` } };
  }

  await db
    .prepare("INSERT INTO sources (id, process_id, name, mechanism) VALUES (?, ?, ?, ?)")
    .bind(id, processId, name, mechanism)
    .run();

  const row = await db.prepare("SELECT * FROM sources WHERE id = ?").bind(id).first<SourceRow>();
  return { status: 201, body: toBody(row as SourceRow) };
}

export async function handleListSources(db: D1Database, processId: string): Promise<RouteResult> {
  const process = await db.prepare("SELECT id FROM processes WHERE id = ?").bind(processId).first();
  if (!process) {
    return { status: 404, body: { error: `process ${processId} does not exist` } };
  }

  const rows = await db
    .prepare("SELECT * FROM sources WHERE process_id = ? ORDER BY name")
    .bind(processId)
    .all<SourceRow>();

  return {
    status: 200,
    body: {
      processId,
      sources: rows.results.map(toBody),
      // A process with no sources is inert rather than broken: nothing
      // can arrive. Said plainly here rather than leaving someone to
      // wonder why (decision 0055 section 4).
      ...(rows.results.length === 0
        ? { note: "this process has no sources, so no document can reach it" }
        : {}),
    },
  };
}
