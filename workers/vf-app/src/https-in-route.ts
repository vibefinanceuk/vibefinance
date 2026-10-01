import type { RouteResult } from "./examples-route.js";
import type { ExtractionModel } from "./extraction.js";
import { captureAttachmentPart } from "./inbound-email.js";
import {
  addRouteEvent,
  finishRouteMessage,
  openRouteMessage,
  routePartKey,
  storeRoutePart,
  type StoredPart,
} from "./route-messages.js";
import { MAX_UPLOAD_BYTES, uploadType } from "./upload-route.js";
import { generateApiKey, hashApiKey, timingSafeEqual } from "./user-auth.js";

/**
 * **HTTPS in — decision 0578**, the first of the routes Dan chose on
 * 1 October 2026 (HTTPS in, HTTPS out, then SFTP), from the mock-up he
 * approved: "Looks good, and yes that order is great."
 *
 * A supplier's system, or a portal, sends invoices to a Source instance's
 * own address:
 *
 *   POST {instance}/v1/sources/{source}/invoices
 *   Authorization: Bearer vf_in_…
 *
 * - **Keys belong to the source**, one per sender, named, shown once, kept
 *   only as a hash (as user keys are, 0006), and revocable. The key's name
 *   is who sent it, so the Route monitor and the Timeline name the sender,
 *   and a supplier mapping can be for that sender.
 * - **Each request is a route message**, read as an email attachment is
 *   (`captureAttachmentPart`): the file kept, standard formats as data,
 *   supplier mappings, AI for a picture, a CSV of several invoices split
 *   (0577), the process from its first stage.
 * - **The reply says what became of it** (delivered, partial or failed,
 *   with why and the invoice numbers) and where to ask again later:
 *   `GET {instance}/v1/sources/{source}/messages/{message}` with the same
 *   source's key.
 *
 * These two paths take no session and no user key: a source key is their
 * only authority, and it reaches only its own source's messages.
 */

export const SOURCE_KEY_PREFIX = "vf_in_";

interface SourceRow {
  id: string;
  name: string;
  mechanism: string;
  status: string;
  process_id: string;
}

export interface SourceKey {
  id: string;
  source_id: string;
  name: string;
  key_prefix: string;
}

async function httpsSource(db: D1Database, sourceId: string): Promise<SourceRow | null> {
  const source = await db
    .prepare("SELECT id, name, mechanism, status, process_id FROM sources WHERE id = ?")
    .bind(sourceId)
    .first<SourceRow>();
  return source && source.mechanism === "https" ? source : null;
}

export function sourceAddress(origin: string, sourceId: string): string {
  return `${origin}/v1/sources/${encodeURIComponent(sourceId)}/invoices`;
}

/** `GET /sources/:id/keys`: the address, and every key (never the key itself). */
export async function handleListSourceKeys(db: D1Database, sourceId: string, origin: string): Promise<RouteResult> {
  const source = await httpsSource(db, sourceId);
  if (!source) return { status: 404, body: { error: `there is no HTTPS source ${sourceId}` } };
  const keys = await db
    .prepare(
      `SELECT k.id, k.name, k.key_prefix, k.created_at, k.last_used_at, k.revoked_at, k.replaced_by, k.expires_at, u.name AS created_by_name
       FROM source_keys k LEFT JOIN org_users u ON u.id = k.created_by
       WHERE k.source_id = ?
       ORDER BY (k.revoked_at IS NOT NULL OR (k.expires_at IS NOT NULL AND k.expires_at <= ?)), lower(k.name), k.created_at DESC`
    )
    .bind(sourceId, new Date().toISOString())
    .all<{
      id: string;
      name: string;
      key_prefix: string;
      created_at: string;
      last_used_at: string | null;
      revoked_at: string | null;
      replaced_by: string | null;
      expires_at: string | null;
      created_by_name: string | null;
    }>();
  return {
    status: 200,
    body: {
      address: sourceAddress(origin, sourceId),
      keys: keys.results.map((k) => ({
        id: k.id,
        name: k.name,
        prefix: k.key_prefix,
        createdAt: k.created_at,
        createdBy: k.created_by_name,
        lastUsedAt: k.last_used_at,
        revokedAt: k.revoked_at,
        // Decision 0581: replaced by another key of the same name, and when it stops (or stopped).
        replacedBy: k.replaced_by,
        expiresAt: k.expires_at,
      })),
    },
  };
}

/** `POST /sources/:id/keys` `{ name }`: a new key, returned this once. */
export async function handleCreateSourceKey(db: D1Database, userId: string, sourceId: string, body: unknown): Promise<RouteResult> {
  const source = await httpsSource(db, sourceId);
  if (!source) return { status: 404, body: { error: `there is no HTTPS source ${sourceId}` } };
  if (source.status !== "active") return { status: 409, body: { error: `${source.name} is retired` } };
  const name = String((body as { name?: unknown } | null)?.name ?? "").trim();
  if (name === "" || name.length > 80) return { status: 400, body: { error: "a key needs a name, of at most 80 characters: who will send with it" } };
  const taken = await db
    .prepare("SELECT 1 FROM source_keys WHERE source_id = ? AND lower(name) = lower(?) AND revoked_at IS NULL AND replaced_by IS NULL")
    .bind(sourceId, name)
    .first();
  if (taken) return { status: 409, body: { error: `a key named "${name}" already sends to ${source.name}` } };
  const made = await newKey(sourceId, name, userId);
  await made.insert(db).run();
  return { status: 201, body: made.reply };
}

async function newKey(sourceId: string, name: string, userId: string) {
  const key = `${SOURCE_KEY_PREFIX}${generateApiKey()}`;
  const id = crypto.randomUUID();
  const prefix = key.slice(0, SOURCE_KEY_PREFIX.length + 4);
  const hash = await hashApiKey(key);
  return {
    reply: { id, name, prefix, key },
    insert: (db: D1Database) =>
      db
        .prepare("INSERT INTO source_keys (id, source_id, name, key_hash, key_prefix, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(id, sourceId, name, hash, prefix, new Date().toISOString(), userId),
  };
}

/** How long a replaced key keeps working, unless stopped at once — decision 0581. */
export const REPLACED_KEY_GRACE_HOURS = 24;

/**
 * `POST /sources/:id/keys/:keyId/replace` `{ stopNow? }` — decision 0581.
 * A new key with the same name, shown this once, so a mapping's Who it is
 * for still names its sender. The old key keeps working for 24 hours, so
 * the sender can switch without a gap, or stops at once when `stopNow`
 * (a key that may have leaked).
 */
export async function handleReplaceSourceKey(
  db: D1Database,
  userId: string,
  sourceId: string,
  keyId: string,
  body: unknown
): Promise<RouteResult> {
  const source = await httpsSource(db, sourceId);
  if (!source) return { status: 404, body: { error: `there is no HTTPS source ${sourceId}` } };
  if (source.status !== "active") return { status: 409, body: { error: `${source.name} is retired` } };
  const old = await db
    .prepare("SELECT id, name, revoked_at, replaced_by FROM source_keys WHERE id = ? AND source_id = ?")
    .bind(keyId, sourceId)
    .first<{ id: string; name: string; revoked_at: string | null; replaced_by: string | null }>();
  if (!old) return { status: 404, body: { error: `there is no key ${keyId} on ${sourceId}` } };
  if (old.revoked_at) return { status: 409, body: { error: "the key is revoked: make a new one instead" } };
  if (old.replaced_by) return { status: 409, body: { error: "the key has already been replaced" } };
  const stopNow = (body as { stopNow?: unknown } | null)?.stopNow === true;
  const at = new Date();
  const expires = stopNow ? at : new Date(at.getTime() + REPLACED_KEY_GRACE_HOURS * 3600_000);
  const made = await newKey(sourceId, old.name, userId);
  await db.batch([
    made.insert(db),
    stopNow
      ? db
          .prepare("UPDATE source_keys SET replaced_by = ?, expires_at = ?, revoked_at = ?, revoked_by = ? WHERE id = ?")
          .bind(made.reply.id, expires.toISOString(), at.toISOString(), userId, keyId)
      : db.prepare("UPDATE source_keys SET replaced_by = ?, expires_at = ? WHERE id = ?").bind(made.reply.id, expires.toISOString(), keyId),
  ]);
  return { status: 201, body: { ...made.reply, replaced: keyId, oldStopsAt: expires.toISOString() } };
}

/** `POST /sources/:id/keys/:keyId/revoke`: nothing sends with it again. */
export async function handleRevokeSourceKey(db: D1Database, userId: string, sourceId: string, keyId: string): Promise<RouteResult> {
  const row = await db
    .prepare("SELECT revoked_at, expires_at FROM source_keys WHERE id = ? AND source_id = ?")
    .bind(keyId, sourceId)
    .first<{ revoked_at: string | null; expires_at: string | null }>();
  if (!row) return { status: 404, body: { error: `there is no key ${keyId} on ${sourceId}` } };
  if (row.revoked_at) return { status: 409, body: { error: "the key is already revoked" } };
  // A replaced key may be stopped before its 24 hours are up — decision 0581 — but not once they are.
  if (row.expires_at && row.expires_at <= new Date().toISOString()) return { status: 409, body: { error: "the key has already stopped" } };
  await db
    .prepare("UPDATE source_keys SET revoked_at = ?, revoked_by = ? WHERE id = ?")
    .bind(new Date().toISOString(), userId, keyId)
    .run();
  return { status: 200, body: { id: keyId, revoked: true } };
}

/** The key a request carries, if it is a live key of this source. */
export async function authenticateSourceKey(db: D1Database, sourceId: string, authorization: string | null): Promise<SourceKey | null> {
  const key = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;
  if (!key || !key.startsWith(SOURCE_KEY_PREFIX)) return null;
  const hash = await hashApiKey(key);
  const row = await db
    .prepare(
      // Decision 0581: a replaced key works until it expires.
      "SELECT id, source_id, name, key_prefix, key_hash FROM source_keys WHERE key_hash = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)"
    )
    .bind(hash, new Date().toISOString())
    .first<SourceKey & { key_hash: string }>();
  if (!row || row.source_id !== sourceId || !timingSafeEqual(row.key_hash, hash)) return null;
  await db.prepare("UPDATE source_keys SET last_used_at = ? WHERE id = ?").bind(new Date().toISOString(), row.id).run();
  return { id: row.id, source_id: row.source_id, name: row.name, key_prefix: row.key_prefix };
}

function base64Bytes(text: string): Uint8Array | null {
  try {
    const binary = atob(text.replace(/\s+/g, ""));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** What a message became, as the sender is told it: now, and when they ask again. */
async function messageReport(db: D1Database, messageId: string, checkUrl: string) {
  const m = await db
    .prepare("SELECT id, status, error_text, received_at, completed_at, subject FROM route_messages WHERE id = ?")
    .bind(messageId)
    .first<{ id: string; status: string; error_text: string | null; received_at: string; completed_at: string | null; subject: string | null }>();
  const parts = await db
    .prepare("SELECT filename, outcome, reason FROM route_message_parts WHERE message_id = ? AND role = 'attachment' ORDER BY seq")
    .bind(messageId)
    .all<{ filename: string; outcome: string | null; reason: string | null }>();
  const invoices = await db
    .prepare(
      `SELECT h.invoice_number FROM route_message_items i JOIN invoice_headers h ON h.id = i.item_id
       WHERE i.message_id = ? ORDER BY h.invoice_number`
    )
    .bind(messageId)
    .all<{ invoice_number: string | null }>();
  return {
    message: m?.id ?? messageId,
    status: m?.status ?? "received",
    reference: m?.subject ?? null,
    receivedAt: m?.received_at ?? null,
    completedAt: m?.completed_at ?? null,
    ...(m?.error_text ? { error: m.error_text } : {}),
    files: parts.results.map((p) => ({ filename: p.filename, outcome: p.outcome, ...(p.reason ? { reason: p.reason } : {}) })),
    invoices: invoices.results.map((i) => i.invoice_number),
    check: checkUrl,
  };
}

/**
 * `POST /v1/sources/:id/invoices`: one invoice file, raw in the body
 * (named by `X-Filename` or `?name=`), or as JSON
 * `{ "filename", "content": base64, "reference"? }`.
 */
export async function handleHttpsInvoice(
  db: D1Database,
  key: SourceKey,
  request: Request,
  origin: string,
  deps: { model: ExtractionModel; bucket?: R2Bucket; customerId?: string }
): Promise<RouteResult> {
  const source = await httpsSource(db, key.source_id);
  if (!source) return { status: 404, body: { error: "this source no longer receives by HTTPS" } };
  if (source.status !== "active") return { status: 410, body: { error: `${source.name} is retired and no longer receives invoices` } };

  const sentType = request.headers.get("Content-Type");
  let filename = new URL(request.url).searchParams.get("name") ?? request.headers.get("X-Filename") ?? "";
  let reference: string | null = request.headers.get("X-Reference");
  let bytes: Uint8Array;
  let contentType: string | null = sentType;
  if ((sentType ?? "").toLowerCase().startsWith("application/json")) {
    let body: { filename?: unknown; content?: unknown; contentType?: unknown; reference?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return { status: 400, body: { error: "the body is not JSON" } };
    }
    const decoded = typeof body.content === "string" ? base64Bytes(body.content) : null;
    if (!decoded) return { status: 400, body: { error: "content must be the file, in base64" } };
    bytes = decoded;
    filename = typeof body.filename === "string" ? body.filename : filename;
    contentType = typeof body.contentType === "string" ? body.contentType : null;
    reference = typeof body.reference === "string" ? body.reference : reference;
  } else {
    bytes = new Uint8Array(await request.arrayBuffer());
  }
  filename = filename.trim().slice(0, 200);
  if (filename === "") return { status: 400, body: { error: "name the file: X-Filename, ?name=, or filename in JSON" } };
  if (bytes.length === 0) return { status: 400, body: { error: "the file is empty" } };
  if (bytes.length > MAX_UPLOAD_BYTES) return { status: 413, body: { error: `the file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB` } };
  const type = uploadType(filename, contentType);
  if (!type) return { status: 415, body: { error: "this is not a type an invoice arrives as: send a PDF, an image, XML or CSV" } };

  const receivedAt = new Date().toISOString();
  const messageId = await openRouteMessage(db, {
    instanceId: source.id,
    direction: "in",
    counterparty: key.name,
    recipient: source.name,
    subject: (reference ?? filename).slice(0, 300),
    bytes: bytes.length,
    receivedAt,
  });
  if (!messageId) return { status: 500, body: { error: "the message could not be recorded; send it again" } };
  await addRouteEvent(db, messageId, "https_received", { detail: `key ${key.key_prefix}… (${key.name})` });

  let stored: StoredPart | undefined;
  if (deps.bucket && deps.customerId) {
    const part = await storeRoutePart(deps.bucket, db, {
      messageId,
      seq: 1,
      role: "attachment",
      filename,
      contentType: type,
      bytes,
      key: routePartKey(deps.customerId, source.id, messageId, receivedAt, 1, filename),
    });
    if ("stored" in part) stored = part.stored;
    else await addRouteEvent(db, messageId, "attachment_not_stored", { partSeq: 1, detail: part.reason });
  }

  const outcome = await captureAttachmentPart(db, {
    messageId,
    sourceId: source.id,
    seq: 1,
    filename,
    bytes,
    stored,
    model: deps.model,
    bucket: deps.bucket,
    customerId: deps.customerId,
    sender: key.name,
  });
  if (!outcome.captured) {
    await finishRouteMessage(db, messageId, {
      status: "failed",
      failedPart: "translation",
      errorCode: "unreadable",
      errorText: outcome.why ?? "the file could not be read as an invoice",
    });
  } else {
    await finishRouteMessage(db, messageId, { status: outcome.why ? "partial" : "delivered" });
  }
  const check = `${origin}/v1/sources/${encodeURIComponent(source.id)}/messages/${encodeURIComponent(messageId)}`;
  return { status: outcome.captured ? 202 : 422, body: await messageReport(db, messageId, check) };
}

/** `GET /v1/sources/:id/messages/:message`: what became of one, for this source's keys only. */
export async function handleHttpsMessageStatus(db: D1Database, key: SourceKey, messageId: string, origin: string): Promise<RouteResult> {
  const m = await db
    .prepare("SELECT instance_id FROM route_messages WHERE id = ? AND direction = 'in'")
    .bind(messageId)
    .first<{ instance_id: string | null }>();
  if (!m || m.instance_id !== key.source_id) return { status: 404, body: { error: `there is no message ${messageId} for this source` } };
  const check = `${origin}/v1/sources/${encodeURIComponent(key.source_id)}/messages/${encodeURIComponent(messageId)}`;
  return { status: 200, body: await messageReport(db, messageId, check) };
}
