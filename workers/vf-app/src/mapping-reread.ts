import type { RouteResult } from "./org-route.js";
import { applyMapping, CSV_ROOT, decodeText, mappableXml, type MappingDefinition } from "@vibefinance/shared";
import { captureThroughMapping } from "./supplier-mapping-route.js";
import { lookupsFor } from "./lookup-lists-route.js";
import { buildIntakeEnricher } from "./source-capture-route.js";
import { addRouteEvent, setPartFormat } from "./route-messages.js";

/**
 * **Reading a captured file again with a newer mapping — decision 0566.**
 *
 * On 30 September Dan published version 2 of a CSV mapping (it added the
 * VAT total) and reprocessed the email that held 88251. Reprocess reruns
 * only the files that failed, so it never makes an invoice twice; 88251
 * had been captured with version 1 and kept its version 1 facts and the
 * broken rule they caused. There was no way to read it again short of
 * discarding it and sending the file a second time.
 *
 * **The same invoice, read again, never a second one.** Its facts and
 * lines are replaced by what the live version reads (the upsert already
 * replaces a line set whole), its open tasks are cancelled with the
 * reason, and its process instance starts again at its first stage and
 * is visited as a new invoice would be. The duplicate check compares with
 * other invoices, never with itself.
 *
 * **Only while nobody has worked on it.** A person's claim, release,
 * reassignment or completed task, an ERP export, or an instance no longer
 * in progress each mean someone has relied on what it said, and a re-read
 * would change it under them. Each is refused with its reason, in a code
 * the interface has words for.
 */

export type RereadRefusal =
  | "no_part"
  | "not_captured"
  | "not_supplier_file"
  | "no_invoice"
  | "mapping_retired"
  | "no_newer_version"
  | "not_in_progress"
  | "worked_on"
  | "exported";

interface PartRow {
  message_id: string;
  seq: number;
  filename: string;
  r2_key: string | null;
  outcome: string | null;
  format: string | null;
  xml_root: string | null;
  mapping_id: string | null;
  mapping_version: number | null;
}

interface Target {
  part: PartRow;
  invoiceId: string;
  instanceId: string;
  live: number;
  mappingName: string;
}

async function targetOf(db: D1Database, messageId: string, seq: number): Promise<Target | { refusal: RereadRefusal }> {
  const part = await db
    .prepare(
      `SELECT message_id, seq, filename, r2_key, outcome, format, xml_root, mapping_id, mapping_version
       FROM route_message_parts WHERE message_id = ? AND seq = ?`
    )
    .bind(messageId, seq)
    .first<PartRow>();
  if (!part) return { refusal: "no_part" };
  if (part.outcome !== "captured") return { refusal: "not_captured" };
  if ((part.format !== "supplier_xml" && part.format !== "supplier_csv") || !part.mapping_id || !part.xml_root) {
    return { refusal: "not_supplier_file" };
  }
  const item = await db
    .prepare("SELECT item_id FROM route_message_items WHERE message_id = ? AND item_type = 'invoice' AND part_seq = ?")
    .bind(messageId, seq)
    .first<{ item_id: string }>();
  if (!item) return { refusal: "no_invoice" };
  const mapping = await db
    .prepare(
      `SELECT m.name, m.status,
              (SELECT version FROM supplier_mapping_versions v WHERE v.mapping_id = m.id AND v.status = 'live') AS live
       FROM supplier_mappings m WHERE m.id = ?`
    )
    .bind(part.mapping_id)
    .first<{ name: string; status: string; live: number | null }>();
  if (!mapping || mapping.status !== "active" || mapping.live === null) return { refusal: "mapping_retired" };
  if (part.mapping_version !== null && mapping.live <= part.mapping_version) return { refusal: "no_newer_version" };
  const instance = await db
    .prepare(
      `SELECT id, status FROM process_instances
       WHERE subject_type = 'invoice' AND subject_id = ? ORDER BY created_at DESC LIMIT 1`
    )
    .bind(item.item_id)
    .first<{ id: string; status: string }>();
  if (!instance || instance.status !== "in_progress") return { refusal: "not_in_progress" };
  const worked = await db
    .prepare(
      `SELECT
         (SELECT count(*) FROM task_action_events e JOIN tasks t ON t.id = e.task_id
            JOIN stage_visits v ON v.id = t.stage_visit_id WHERE v.process_instance_id = ?1) +
         (SELECT count(*) FROM tasks t JOIN stage_visits v ON v.id = t.stage_visit_id
            WHERE v.process_instance_id = ?1 AND (t.completed_by IS NOT NULL OR t.ended_by IS NOT NULL OR t.claimed_by IS NOT NULL)) AS n`
    )
    .bind(instance.id)
    .first<{ n: number }>();
  if ((worked?.n ?? 0) > 0) return { refusal: "worked_on" };
  const exported = await db.prepare("SELECT 1 AS x FROM erp_export_invoices WHERE invoice_id = ?").bind(item.item_id).first();
  if (exported) return { refusal: "exported" };
  return { part, invoiceId: item.item_id, instanceId: instance.id, live: mapping.live, mappingName: mapping.name };
}

/**
 * Whether a part can be read again, for the Route monitor: the live
 * version it would be read with, or the reason it cannot. Null for a part
 * this does not apply to at all (not a captured supplier file).
 */
export async function rereadState(
  db: D1Database,
  messageId: string,
  seq: number
): Promise<{ can: true; version: number } | { can: false; reason: RereadRefusal } | null> {
  const t = await targetOf(db, messageId, seq);
  if ("refusal" in t) {
    if (t.refusal === "no_part" || t.refusal === "not_captured" || t.refusal === "not_supplier_file" || t.refusal === "no_newer_version") {
      return null;
    }
    return { can: false, reason: t.refusal };
  }
  return { can: true, version: t.live };
}

/** `POST /route-messages/:id/parts/:seq/reread` — the invoice read again with the live mapping version. */
export async function handleRereadPart(
  db: D1Database,
  bucket: R2Bucket | undefined,
  messageId: string,
  seq: number,
  actor: string
): Promise<RouteResult> {
  const t = await targetOf(db, messageId, seq);
  if ("refusal" in t) {
    const status = t.refusal === "no_part" ? 404 : 409;
    return { status, body: { error: `part ${seq} of ${messageId} cannot be read again`, reason: t.refusal } };
  }
  if (!bucket || !t.part.r2_key) return { status: 503, body: { error: "the original is not available", reason: "no_original" } };
  const object = await bucket.get(t.part.r2_key);
  if (!object) return { status: 503, body: { error: "the original is not available", reason: "no_original" } };
  const text = decodeText(new Uint8Array(await object.arrayBuffer()));

  const message = await db
    .prepare("SELECT instance_id, counterparty FROM route_messages WHERE id = ?")
    .bind(messageId)
    .first<{ instance_id: string; counterparty: string | null }>();
  const source = message
    ? await db
        .prepare("SELECT id, process_id, name, default_org_unit_id FROM sources WHERE id = ?")
        .bind(message.instance_id)
        .first<{ id: string; process_id: string; name: string; default_org_unit_id: string | null }>()
    : null;
  if (!message || !source) return { status: 409, body: { error: "the message's source no longer exists", reason: "no_source" } };
  const channel = await db
    .prepare("SELECT id FROM intake_channels WHERE process_id = ? AND structure = 'structured_xml'")
    .bind(source.process_id)
    .first<{ id: string }>();
  if (!channel) return { status: 409, body: { error: "the process has no structured-data channel", reason: "no_channel" } };

  // **Read first, change nothing until it reads.** A live version that
  // cannot read this file is refused with its problems, and the invoice
  // stays exactly as it is.
  const live = await db
    .prepare("SELECT definition_json FROM supplier_mapping_versions WHERE mapping_id = ? AND status = 'live'")
    .bind(t.part.mapping_id)
    .first<{ definition_json: string }>();
  if (!live) return { status: 409, body: { error: "the mapping has no live version", reason: "mapping_retired" } };
  try {
    const def = JSON.parse(live.definition_json) as MappingDefinition;
    const tried = applyMapping(mappableXml(text, def), def, await lookupsFor(db, def));
    if (tried.problems.length > 0) {
      return {
        status: 422,
        body: { error: `version ${t.live} cannot read this file`, reason: "read_failed", problems: tried.problems },
      };
    }
  } catch (err) {
    return { status: 422, body: { error: (err as Error).message, reason: "read_failed" } };
  }

  // The instance starts again at the first stage of the version it runs under (0150).
  const first = await db
    .prepare(
      `SELECT v.stage_id AS id FROM process_instances pi
       JOIN process_stage_versions v ON v.process_id = pi.process_id AND v.version = pi.process_version
       WHERE pi.id = ? ORDER BY v.sequence ASC LIMIT 1`
    )
    .bind(t.instanceId)
    .first<{ id: string }>();
  if (!first) return { status: 409, body: { error: "the process has no stages", reason: "no_stages" } };

  const reason = `read again with ${t.mappingName} version ${t.live}`;
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `UPDATE tasks SET status = 'cancelled', ended_at = ?, end_reason = ?
         WHERE status = 'open' AND stage_visit_id IN (SELECT id FROM stage_visits WHERE process_instance_id = ?)`
      )
      .bind(now, reason, t.instanceId),
    db.prepare("UPDATE process_instances SET current_stage_id = ?, updated_at = ? WHERE id = ?").bind(first.id, now, t.instanceId),
  ]);

  const result = await captureThroughMapping(
    db,
    source.id,
    channel.id,
    text,
    t.part.xml_root as string,
    message.counterparty ?? undefined,
    t.invoiceId,
    buildIntakeEnricher(db, source),
    t.instanceId
  );
  const read = result.body as {
    mappingId?: string | null;
    mappingVersion?: number;
    mappingMiss?: "not_for_sender" | "not_published" | null;
    format?: string;
    en16931?: { failed: Array<{ rule: string; detail?: string }> };
    error?: string;
  };
  if (result.status >= 400) {
    // Only what the preflight could not see, such as a CSV holding
    // several invoices, reaches here. Recorded, and said.
    await addRouteEvent(db, messageId, "reread_failed", { partSeq: seq, detail: read.error ?? "could not be read", actor });
    return { status: 422, body: { error: read.error ?? "could not be read", reason: "read_failed" } };
  }
  await setPartFormat(db, messageId, seq, {
    format: read.format ?? (t.part.xml_root === CSV_ROOT ? "supplier_csv" : "supplier_xml"),
    syntax: null,
    failed: read.en16931 ? read.en16931.failed : null,
    xmlRoot: t.part.xml_root,
    mappingId: read.mappingId ?? null,
    mappingVersion: read.mappingVersion ?? null,
  });
  await addRouteEvent(db, messageId, "reread", { partSeq: seq, detail: reason, actor });
  return {
    status: 200,
    body: {
      invoiceId: t.invoiceId,
      mappingId: read.mappingId,
      version: read.mappingVersion,
      en16931Failed: read.en16931?.failed ?? [],
    },
  };
}
