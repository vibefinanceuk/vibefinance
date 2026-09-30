import type { RouteResult } from "./examples-route.js";
import type { ExtractionModel } from "./extraction.js";
import { captureAttachmentPart } from "./inbound-email.js";
import { captureKeyedInvoice } from "./source-capture-route.js";
import { handleBatchChunk, type BatchLayout } from "./batch-route.js";
import {
  addRouteEvent,
  finishRouteMessage,
  linkRouteItem,
  openRouteMessage,
  routePartKey,
  storeRoutePart,
  type StoredPart,
} from "./route-messages.js";

/**
 * **Create → Upload documents — decision 0573.**
 *
 * The AP team brings invoices in themselves: PDFs, images, XML, CSV, one
 * invoice per file. Asked for live on 30 September, with the design Dan
 * approved from a mock-up the same day:
 *
 * - **One way in, the same as email.** The upload is a route message on
 *   an *AP upload* source (the standard *File import* route, made live
 *   and renamed). Every file is a part of it, stored before it is read,
 *   and read by exactly the path an email attachment takes
 *   (`captureAttachmentPart`): standard formats as data, supplier
 *   mappings, AI for a picture or a PDF, then the process from its first
 *   stage. So the upload has a MSG reference, shows in the Route monitor
 *   and on Process routes, and each invoice's Timeline and Attachments
 *   tab say where it came from (0571).
 * - **One file per request.** The browser opens the upload, sends each
 *   file on its own, then closes it. Reading a PDF by AI takes seconds,
 *   and thirty of them in one request would be a long wait with nothing
 *   to show; file by file, the screen shows each one as it lands.
 * - **Who sent it** is the person, as the message's counterparty and as
 *   the actor on its history. Only they add files to it, and only while
 *   it is open.
 */

/** The types an invoice arrives as, as email accepts them (0147, 0565). */
const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  xml: "application/xml",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  tif: "image/tiff",
  tiff: "image/tiff",
  csv: "text/csv",
};
const ACCEPTED = new Set(["application/pdf", "application/xml", "text/xml", "image/jpeg", "image/png", "image/tiff", "text/csv"]);

/** As email: 15 MB a file. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
/** Files in one upload. */
export const MAX_UPLOAD_FILES = 50;
/** Files in one batch upload (decision 0576): as many XML invoices as a batch may hold. */
export const BATCH_MAX_FILES = 500;

/**
 * What a file is, from its name first and then what the browser said.
 * A browser often sends an XML or CSV file as `application/octet-stream`
 * or nothing; the name is the more reliable of the two.
 */
export function uploadType(filename: string, sent: string | null): string | null {
  const ext = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  if (TYPES[ext]) return TYPES[ext];
  const type = (sent ?? "").split(";")[0].trim().toLowerCase();
  if (type === "text/xml") return "application/xml";
  if (type === "application/csv" || type === "text/comma-separated-values") return "text/csv";
  return ACCEPTED.has(type) ? type : null;
}

interface Person {
  id: string;
  name: string;
  email: string;
}

/** Where an upload can go: every active AP upload source, with its process and company. */
export async function handleUploadTargets(db: D1Database): Promise<RouteResult> {
  const rows = await db
    .prepare(
      `SELECT s.id, s.name, p.id AS process_id, p.name AS process_name, o.name AS org_name
       FROM sources s
       JOIN processes p ON p.id = s.process_id
       LEFT JOIN org_units o ON o.id = s.default_org_unit_id
       WHERE s.mechanism = 'file_import' AND s.status = 'active'
       ORDER BY p.name, s.name`
    )
    .all<{ id: string; name: string; process_id: string; process_name: string; org_name: string | null }>();
  return {
    status: 200,
    body: {
      targets: rows.results.map((r) => ({
        id: r.id,
        name: r.name,
        processId: r.process_id,
        processName: r.process_name,
        orgName: r.org_name,
      })),
      maxFiles: MAX_UPLOAD_FILES,
      maxBytes: MAX_UPLOAD_BYTES,
    },
  };
}

/** Opens an upload: a route message on the source, from this person. */
export async function handleOpenUpload(db: D1Database, person: Person, body: unknown): Promise<RouteResult> {
  const { sourceId, files, kind } = (body ?? {}) as { sourceId?: unknown; files?: unknown; kind?: unknown };
  if (typeof sourceId !== "string" || sourceId === "") return { status: 400, body: { error: "sourceId is required" } };
  // Decision 0575: one invoice keyed by hand, with a file or none.
  const keyed = kind === "keyed";
  // Decision 0576: a batch, one CSV or up to 500 XML invoices.
  const batch = kind === "batch";
  const count = keyed ? Number(files ?? 0) : Number(files);
  if (!Number.isInteger(count) || count < (keyed ? 0 : 1) || (keyed && count > 1)) {
    return { status: 400, body: { error: keyed ? "an invoice keyed by hand has one file or none" : "files must be a whole number, at least 1" } };
  }
  const most = batch ? BATCH_MAX_FILES : MAX_UPLOAD_FILES;
  if (count > most) return { status: 400, body: { error: `at most ${most} files can be uploaded at once` } };
  const source = await db
    .prepare("SELECT id, name, mechanism, status FROM sources WHERE id = ?")
    .bind(sourceId)
    .first<{ id: string; name: string; mechanism: string; status: string }>();
  if (!source || source.mechanism !== "file_import") return { status: 404, body: { error: `there is no upload source ${sourceId}` } };
  if (source.status !== "active") return { status: 409, body: { error: `${source.name} is retired and no longer receives invoices` } };

  const receivedAt = new Date().toISOString();
  const messageId = await openRouteMessage(db, {
    instanceId: source.id,
    direction: "in",
    counterparty: `${person.name} <${person.email}>`,
    recipient: source.name,
    subject: keyed
      ? "Invoice keyed by hand"
      : `${batch ? "Batch upload" : "Upload"} of ${count} ${count === 1 ? "file" : "files"}`,
    bytes: 0,
    receivedAt,
  });
  if (!messageId) return { status: 500, body: { error: "the upload could not be recorded" } };
  await addRouteEvent(db, messageId, "upload_opened", {
    actor: person.id,
    detail: keyed ? "keyed by hand" : batch ? `batch of ${count} files` : `${count} files`,
  });
  return { status: 201, body: { messageId, receivedAt } };
}

interface OpenUpload {
  id: string;
  instance_id: string;
  status: string;
  received_at: string;
  actor: string | null;
}

/** The upload, if it is this person's and still open. */
async function openUploadOf(db: D1Database, messageId: string, person: Person): Promise<OpenUpload | RouteResult> {
  const row = await db
    .prepare(
      `SELECT m.id, m.instance_id, m.status, m.received_at,
              (SELECT e.actor FROM route_message_events e WHERE e.message_id = m.id AND e.event = 'upload_opened' LIMIT 1) AS actor
       FROM route_messages m
       JOIN sources s ON s.id = m.instance_id AND s.mechanism = 'file_import'
       WHERE m.id = ? AND m.direction = 'in'`
    )
    .bind(messageId)
    .first<OpenUpload>();
  if (!row || row.actor !== person.id) return { status: 404, body: { error: `there is no upload ${messageId} of yours` } };
  if (row.status !== "received") return { status: 409, body: { error: `upload ${messageId} is already finished` } };
  return row;
}

/** One file's invoice, as the screen shows it: number, supplier, total, stage, and its task to open. */
async function invoiceSummary(db: D1Database, invoiceId: string) {
  const row = await db
    .prepare(
      `SELECT h.invoice_number, json_extract(h.facts_json, '$."BT-27"') AS seller, h.total_with_vat, h.currency,
              st.name AS stage_name,
              (SELECT t.id FROM tasks t JOIN stage_visits v ON v.id = t.stage_visit_id
                 WHERE v.process_instance_id = pi.id AND t.status = 'open' ORDER BY t.created_at DESC LIMIT 1) AS task_id,
              (SELECT t.stage_id FROM tasks t JOIN stage_visits v ON v.id = t.stage_visit_id
                 WHERE v.process_instance_id = pi.id AND t.status = 'open' ORDER BY t.created_at DESC LIMIT 1) AS task_stage_id
       FROM invoice_headers h
       LEFT JOIN process_instances pi ON pi.subject_type = 'invoice' AND pi.subject_id = h.id
       LEFT JOIN process_stages st ON st.id = pi.current_stage_id
       WHERE h.id = ?`
    )
    .bind(invoiceId)
    .first<{
      invoice_number: string | null;
      seller: string | null;
      total_with_vat: number | null;
      currency: string | null;
      stage_name: string | null;
      task_id: string | null;
      task_stage_id: string | null;
    }>();
  return {
    id: invoiceId,
    number: row?.invoice_number ?? null,
    seller: row?.seller ?? null,
    total: row?.total_with_vat ?? null,
    currency: row?.currency ?? null,
    stage: row?.stage_name ?? null,
    taskId: row?.task_id ?? null,
    taskStageId: row?.task_stage_id ?? null,
  };
}

/**
 * One file into the upload: stored as the next part, then read as an
 * email attachment is. A type an invoice does not arrive as is recorded
 * and skipped, with the reason, rather than refused silently.
 */
export async function handleUploadFile(
  db: D1Database,
  person: Person,
  messageId: string,
  file: { filename: string; contentType: string | null; bytes: Uint8Array; selfBilled?: boolean },
  deps: { model: ExtractionModel; bucket?: R2Bucket; customerId?: string }
): Promise<RouteResult> {
  const upload = await openUploadOf(db, messageId, person);
  if ("status" in upload && "body" in upload) return upload;
  const { instance_id: sourceId, received_at: receivedAt } = upload as OpenUpload;
  const filename = file.filename.trim() || "file";

  const last = await db
    .prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM route_message_parts WHERE message_id = ?")
    .bind(messageId)
    .first<{ seq: number }>();
  const seq = (last?.seq ?? 0) + 1;

  const type = uploadType(filename, file.contentType);
  const refuse = async (why: string) => {
    await addRouteEvent(db, messageId, "upload_refused", { partSeq: seq, detail: `${filename}: ${why}`, actor: person.id });
    return { status: 200, body: { seq, filename, captured: false, why } };
  };
  if (file.bytes.length === 0) return refuse("the file is empty");
  if (file.bytes.length > MAX_UPLOAD_BYTES) return refuse(`the file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
  if (!type) return refuse("this is not a type an invoice arrives as: send a PDF, an image, XML or CSV");

  let stored: StoredPart | undefined;
  if (deps.bucket && deps.customerId) {
    const part = await storeRoutePart(deps.bucket, db, {
      messageId,
      seq,
      role: "attachment",
      filename,
      contentType: type,
      bytes: file.bytes,
      key: routePartKey(deps.customerId, sourceId, messageId, receivedAt, seq, filename),
    });
    if ("stored" in part) stored = part.stored;
    else await addRouteEvent(db, messageId, "attachment_not_stored", { partSeq: seq, detail: part.reason });
  }
  await db.prepare("UPDATE route_messages SET bytes = bytes + ? WHERE id = ?").bind(file.bytes.length, messageId).run();

  const outcome = await captureAttachmentPart(db, {
    messageId,
    sourceId,
    seq,
    filename,
    bytes: file.bytes,
    stored,
    model: deps.model,
    bucket: deps.bucket,
    customerId: deps.customerId,
    actor: person.id,
    sender: person.email,
  });
  if (!outcome.captured) return { status: 200, body: { seq, filename, captured: false, why: outcome.why ?? "the file could not be read as an invoice" } };
  if (file.selfBilled && outcome.invoiceId) await markSelfBilled(db, outcome.invoiceId);
  return {
    status: 200,
    body: { seq, filename, captured: true, invoice: outcome.invoiceId ? await invoiceSummary(db, outcome.invoiceId) : null },
  };
}

/**
 * **Self-billed — decision 0575.** Invoice type code 389 (BT-3), EN
 * 16931's code for a self-billed invoice, and a fact a rule can test.
 * Set on the invoice as made, whatever its file said.
 */
export const SELF_BILLED_FACTS = { "BT-3": "389", "invoice.selfBilled": 1 } as const;

async function markSelfBilled(db: D1Database, invoiceId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE invoice_headers
       SET facts_json = json_set(json_set(facts_json, '$."BT-3"', '389'), '$."invoice.selfBilled"', 1)
       WHERE id = ?`
    )
    .bind(invoiceId)
    .run();
}

/**
 * **An invoice keyed by hand, with no file — decision 0575.** Made into
 * this upload's message as its one item, so the monitor, the Timeline
 * and the Attachments tab tell where it came from, and started in the
 * process as any other (`captureKeyedInvoice`). The person then keys it
 * in the viewer.
 */
export async function handleKeyedInvoice(db: D1Database, person: Person, messageId: string, body: unknown): Promise<RouteResult> {
  const upload = await openUploadOf(db, messageId, person);
  if ("status" in upload && "body" in upload) return upload;
  const { instance_id: sourceId } = upload as OpenUpload;
  const made = await db
    .prepare("SELECT count(*) AS n FROM route_message_items WHERE message_id = ?")
    .bind(messageId)
    .first<{ n: number }>();
  if ((made?.n ?? 0) > 0) return { status: 409, body: { error: `upload ${messageId} has already made its invoice` } };

  const selfBilled = (body as { selfBilled?: unknown } | null)?.selfBilled === true;
  const result = await captureKeyedInvoice(db, sourceId, selfBilled ? { ...SELF_BILLED_FACTS } : {});
  const invoiceId = (result.body as { id?: string } | undefined)?.id;
  if (result.status >= 400 || !invoiceId) {
    const why = (result.body as { error?: string } | undefined)?.error ?? "the invoice could not be made";
    await addRouteEvent(db, messageId, "capture_failed", { detail: why, actor: person.id });
    return { status: 200, body: { captured: false, why } };
  }
  await linkRouteItem(db, messageId, invoiceId, null);
  await addRouteEvent(db, messageId, "invoice_keyed", { detail: invoiceId, actor: person.id });
  return { status: 200, body: { captured: true, invoice: await invoiceSummary(db, invoiceId) } };
}

/**
 * Closes the upload, as email closes a message: delivered when every
 * file became an invoice, partial when some did, failed when none did.
 */
export async function handleFinishUpload(db: D1Database, person: Person, messageId: string): Promise<RouteResult> {
  const upload = await openUploadOf(db, messageId, person);
  if ("status" in upload && "body" in upload) return upload;
  const counts = await db
    .prepare(
      `SELECT
         (SELECT count(*) FROM route_message_items WHERE message_id = ?1) AS captured,
         (SELECT count(*) FROM route_message_events WHERE message_id = ?1 AND event IN ('capture_failed', 'upload_refused')) AS failed`
    )
    .bind(messageId)
    .first<{ captured: number; failed: number }>();
  const captured = counts?.captured ?? 0;
  const failed = counts?.failed ?? 0;
  if (captured === 0) {
    await finishRouteMessage(db, messageId, {
      status: "failed",
      failedPart: failed > 0 ? "translation" : "format",
      errorCode: failed > 0 ? "unreadable" : "no_attachment",
      errorText: failed > 0 ? "No uploaded file could be read as an invoice." : "No file was uploaded.",
    });
  } else {
    await finishRouteMessage(db, messageId, { status: failed > 0 ? "partial" : "delivered" });
  }
  await addRouteEvent(db, messageId, "upload_finished", { actor: person.id, detail: `${captured} created, ${failed} not` });
  return { status: 200, body: { messageId, captured, failed } };
}

/** One chunk of a batch file into this person's open upload — decision 0576. */
export async function handleUploadBatchChunk(
  db: D1Database,
  person: Person,
  messageId: string,
  layout: BatchLayout,
  file: { filename: string; bytes: Uint8Array },
  chunk: { from: number; count: number; duplicates: boolean },
  deps: { model: ExtractionModel; bucket?: R2Bucket; customerId?: string }
): Promise<RouteResult> {
  const upload = await openUploadOf(db, messageId, person);
  if ("status" in upload && "body" in upload) return upload;
  const result = await handleBatchChunk(db, person, upload as OpenUpload, layout, file, chunk, deps);
  if (result.status >= 400) return result;
  // Each invoice made, as the screen shows it: number, supplier, total, stage, and its task to open.
  const body = result.body as { made: Array<{ key: string; number: string; invoiceId: string }> };
  const made = [];
  for (const m of body.made) made.push({ ...m, invoice: await invoiceSummary(db, m.invoiceId) });
  return { status: 200, body: { ...body, made } };
}

/** The supplier layouts a batch can be read by: every published CSV mapping — decision 0576. */
export async function handleBatchMappings(db: D1Database): Promise<RouteResult> {
  const rows = await db
    .prepare(
      `SELECT m.id, m.name, v.version FROM supplier_mappings m
       JOIN supplier_mapping_versions v ON v.mapping_id = m.id AND v.status = 'live'
       WHERE m.root = 'CSV' AND m.status = 'active'
       ORDER BY m.name`
    )
    .all<{ id: string; name: string; version: number }>();
  return { status: 200, body: { mappings: rows.results } };
}
