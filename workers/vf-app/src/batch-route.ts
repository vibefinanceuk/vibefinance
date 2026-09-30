import {
  applyMapping,
  CSV_ROOT,
  CsvError,
  decodeText,
  detectCsvOptions,
  detectDelimiter,
  mappableXml,
  MappingXmlError,
  parseCsv,
  problemsCsv,
  readInvoiceXml,
  readTemplateBatch,
  splitCsvByColumn,
  type BatchProblem,
  type MappingDefinition,
} from "@vibefinance/shared";
import type { RouteResult } from "./examples-route.js";
import type { ExtractionModel } from "./extraction.js";
import { lookupsFor } from "./lookup-lists-route.js";
import { addRouteEvent, linkRouteItem, routePartKey, setPartOutcome, storeRoutePart } from "./route-messages.js";
import { handleCaptureFromSource, type PreRead } from "./source-capture-route.js";
import { describeProblem } from "./supplier-mapping-route.js";

/**
 * **Create → Batch upload — decision 0576**, from the mock-up Dan
 * approved on 30 September: "yes this looks great - 500 seems sensible".
 *
 * - **Read before anything is made.** A CSV (the VibeFinance template, or
 *   a supplier's own layout through its mapping) or an XML invoice is
 *   read into the invoices it holds, each with what is wrong by row, and
 *   whether an invoice with its number and supplier was already received.
 *   Nothing is stored: the preview is only a reading.
 * - **Rows sharing an invoice number are one invoice.** For the template
 *   that is its rule; for a supplier's mapping, the rows are grouped by
 *   the column the mapping reads the invoice number (BT-1) from.
 * - **Made in chunks.** Creating reads the file again, the same way, and
 *   makes the ready invoices (and the possible duplicates, only if asked)
 *   a few at a time, so each request stays short and the screen shows
 *   progress. The whole file is kept once, as the upload's one part; each
 *   invoice points at it and has its own rows as its table.
 */

export type BatchLayout = { kind: "template" } | { kind: "mapping"; mappingId: string } | { kind: "xml" };

export interface BatchEntry {
  key: string;
  number: string;
  supplier: string | null;
  supplierVat: string | null;
  date: string | null;
  currency: string | null;
  total: number | null;
  rows: number[];
  lines: number;
  problems: string[];
  duplicateOf: { id: string; number: string; receivedAt: string } | null;
  /** Its own rows, as a CSV, for the viewer's table. */
  text: string;
  read: PreRead | null;
}

interface BatchReading {
  entries: BatchEntry[];
  problems: BatchProblem[];
  rows: number;
  layoutName: string;
}

/** Just these rows of a CSV, under its header, as a CSV of their own. */
function rowsOf(text: string, lineNumbers: number[]): string {
  const delimiter = detectDelimiter(text) ?? ",";
  const rows = parseCsv(text, delimiter);
  const q = (v: string) => (v.includes(delimiter) || /["\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const write = (r: string[]) => r.map(q).join(delimiter);
  return [write(rows[0] ?? []), ...lineNumbers.map((n) => write(rows[n - 1] ?? []))].join("\n") + "\n";
}

async function readTemplate(text: string): Promise<BatchReading> {
  const read = readTemplateBatch(text);
  return {
    rows: read.rows,
    problems: read.problems,
    layoutName: "VibeFinance template",
    entries: read.invoices.map((inv) => ({
      key: inv.key,
      number: inv.number,
      supplier: inv.supplier,
      supplierVat: (inv.facts["BT-31"] as string | undefined) ?? null,
      date: inv.date,
      currency: inv.currency,
      total: inv.total,
      rows: inv.rows,
      lines: inv.lines.length,
      problems: inv.problems.map((p) => p.text),
      duplicateOf: null,
      text: rowsOf(text, inv.rows),
      read:
        inv.problems.length === 0
          ? { facts: inv.facts, lines: inv.lines, format: "vibefinance_csv", en16931: inv.en16931 }
          : null,
    })),
  };
}

async function readByMapping(db: D1Database, text: string, mappingId: string): Promise<BatchReading | RouteResult> {
  const row = await db
    .prepare(
      `SELECT m.name, m.root, m.status, v.version, v.definition_json
       FROM supplier_mappings m JOIN supplier_mapping_versions v ON v.mapping_id = m.id AND v.status = 'live'
       WHERE m.id = ?`
    )
    .bind(mappingId)
    .first<{ name: string; root: string; status: string; version: number; definition_json: string }>();
  if (!row || row.status !== "active") return { status: 404, body: { error: `there is no published mapping ${mappingId}` } };
  if (row.root !== CSV_ROOT) return { status: 400, body: { error: `${row.name} reads XML, not CSV` } };
  const def = JSON.parse(row.definition_json) as MappingDefinition;
  const numberFrom = def.lines.find((l) => l.target === "BT-1")?.source ?? null;
  const layoutName = `${row.name} v${row.version}`;
  if (!numberFrom) {
    return { entries: [], rows: 0, layoutName, problems: [{ text: `${layoutName} does not read the invoice number, so its rows cannot be told apart into invoices.` }] };
  }
  const options = def.csv ?? detectCsvOptions(text);
  let groups;
  try {
    groups = splitCsvByColumn(text, options, numberFrom);
  } catch (err) {
    if (err instanceof CsvError) return { entries: [], rows: 0, layoutName, problems: [{ text: `${layoutName}: ${err.message}.` }] };
    throw err;
  }
  const ctx = await lookupsFor(db, def);
  const entries: BatchEntry[] = [];
  for (const group of groups) {
    const problems: string[] = [];
    let facts: Record<string, unknown> = {};
    let lines: PreRead["lines"] = [];
    let en16931: PreRead["en16931"] = null;
    if (group.value === "") {
      problems.push(`Row ${group.rows[0]}: no invoice number`);
    } else {
      try {
        const applied = applyMapping(mappableXml(group.text, def), def, ctx);
        facts = applied.facts;
        lines = applied.lines;
        en16931 = applied.en16931;
        problems.push(...applied.problems.map((p) => `Rows ${group.rows.join(", ")}: ${describeProblem(p)}`));
      } catch (err) {
        if (!(err instanceof MappingXmlError || err instanceof CsvError)) throw err;
        problems.push(`Rows ${group.rows.join(", ")}: ${err.message}`);
      }
    }
    const supplier = ((facts["BT-27"] ?? facts["BT-31"]) as string | undefined) ?? null;
    entries.push({
      key: `${group.value}|${String(supplier ?? "").toLowerCase().replace(/\s+/g, "")}`,
      number: group.value,
      supplier,
      supplierVat: (facts["BT-31"] as string | undefined) ?? null,
      date: (facts["BT-2"] as string | undefined) ?? null,
      currency: (facts["BT-5"] as string | undefined) ?? null,
      total: (facts["BT-112"] as number | undefined) ?? null,
      rows: group.rows,
      lines: lines.length,
      problems,
      duplicateOf: null,
      text: group.text,
      read:
        problems.length === 0
          ? { facts, lines, format: "supplier_csv", mappingId, mappingVersion: row.version, en16931 }
          : null,
    });
  }
  const problems: BatchProblem[] = [];
  if (entries.length > 500) problems.push({ text: `The file holds ${entries.length} invoices. At most 500 are read at once: split it and upload each part.` });
  return { entries, rows: groups.reduce((n, g) => n + g.rows.length, 0), layoutName, problems };
}

/** One XML invoice, for the preview. Made later as an uploaded file is, so nothing is kept from this. */
function readXml(filename: string, text: string): BatchReading {
  try {
    const read = readInvoiceXml(text);
    const f = read.facts as Record<string, unknown>;
    const supplier = ((f["BT-27"] ?? f["BT-31"]) as string | undefined) ?? null;
    return {
      rows: 1,
      problems: [],
      layoutName: read.format,
      entries: [
        {
          key: `${String(f["BT-1"] ?? filename)}|${String(supplier ?? "").toLowerCase().replace(/\s+/g, "")}`,
          number: String(f["BT-1"] ?? ""),
          supplier,
          supplierVat: (f["BT-31"] as string | undefined) ?? null,
          date: (f["BT-2"] as string | undefined) ?? null,
          currency: (f["BT-5"] as string | undefined) ?? null,
          total: (f["BT-112"] as number | undefined) ?? null,
          rows: [],
          lines: read.lines.length,
          problems: [],
          duplicateOf: null,
          text: "",
          read: null,
        },
      ],
    };
  } catch (err) {
    return {
      rows: 1,
      problems: [],
      layoutName: "XML",
      entries: [
        {
          key: `file|${filename}`,
          number: "",
          supplier: null,
          supplierVat: null,
          date: null,
          currency: null,
          total: null,
          rows: [],
          lines: 0,
          problems: [`${filename}: ${(err as Error).message}. Use Upload documents for a supplier's own XML, where its mapping reads it.`],
          duplicateOf: null,
          text: "",
          read: null,
        },
      ],
    };
  }
}

/**
 * **Possibly already received**: an invoice with the same number from the
 * same supplier (by VAT number, or by name), the one the process's own
 * duplicate check would also question.
 */
async function markDuplicates(db: D1Database, entries: BatchEntry[], madeBy: string | null): Promise<void> {
  for (const entry of entries) {
    if (entry.problems.length > 0 || entry.number === "" || (!entry.supplier && !entry.supplierVat)) continue;
    const found = await db
      .prepare(
        `SELECT id, invoice_number, created_at FROM invoice_headers
         WHERE invoice_number = ?1
           AND ((?2 IS NOT NULL AND supplier_vat_id = ?2) OR (?3 IS NOT NULL AND json_extract(facts_json, '$."BT-27"') = ?3))
           -- Not one this same upload made in an earlier chunk: the choice of
           -- what to make has to read the same on every chunk.
           AND (?4 IS NULL OR id NOT IN (SELECT item_id FROM route_message_items WHERE message_id = ?4))
         ORDER BY created_at LIMIT 1`
      )
      .bind(entry.number, entry.supplierVat, entry.supplier, madeBy)
      .first<{ id: string; invoice_number: string; created_at: string }>();
    if (found) entry.duplicateOf = { id: found.id, number: found.invoice_number, receivedAt: found.created_at };
  }
}

export function layoutFrom(params: URLSearchParams): BatchLayout | null {
  const kind = params.get("layout");
  if (kind === "template") return { kind: "template" };
  if (kind === "xml") return { kind: "xml" };
  if (kind === "mapping" && params.get("mapping")) return { kind: "mapping", mappingId: params.get("mapping") as string };
  return null;
}

async function readBatch(
  db: D1Database,
  layout: BatchLayout,
  filename: string,
  bytes: Uint8Array,
  madeBy: string | null = null
): Promise<BatchReading | RouteResult> {
  const text = decodeText(bytes);
  const reading =
    layout.kind === "template" ? await readTemplate(text) : layout.kind === "xml" ? readXml(filename, text) : await readByMapping(db, text, layout.mappingId);
  if ("status" in reading) return reading;
  await markDuplicates(db, reading.entries, madeBy);
  return reading;
}

const statusOf = (e: BatchEntry) => (e.problems.length > 0 ? "problem" : e.duplicateOf ? "duplicate" : "ready");

/** `POST /uploads/preview`: the file read, nothing kept. */
export async function handleBatchPreview(db: D1Database, layout: BatchLayout, filename: string, bytes: Uint8Array): Promise<RouteResult> {
  if (bytes.length === 0) return { status: 400, body: { error: "the file is empty" } };
  const reading = await readBatch(db, layout, filename, bytes);
  if ("status" in reading) return reading;
  const counts = { ready: 0, duplicate: 0, problem: 0 };
  for (const e of reading.entries) counts[statusOf(e)] += 1;
  return {
    status: 200,
    body: {
      filename,
      layout: reading.layoutName,
      rows: reading.rows,
      problems: reading.problems.map((p) => p.text),
      counts,
      invoices: reading.entries.map((e) => ({
        key: e.key,
        number: e.number,
        supplier: e.supplier,
        date: e.date,
        currency: e.currency,
        total: e.total,
        lines: e.lines,
        rows: e.rows,
        status: statusOf(e),
        problems: e.problems,
        duplicateOf: e.duplicateOf,
      })),
      problemsCsv: problemsCsv({
        problems: reading.problems,
        invoices: reading.entries.map((e) => ({ number: e.number, problems: e.problems.map((text) => ({ row: e.rows[0], text })) })),
      }),
    },
  };
}

/**
 * `POST /uploads/:id/batch?from=&count=&duplicates=`: the next few of a
 * batch file's invoices made. The file is read again as the preview read
 * it; which are made is decided the same way every time (the ready ones,
 * and the possible duplicates only when asked), so the chunks follow on.
 */
export async function handleBatchChunk(
  db: D1Database,
  person: { id: string; email: string },
  upload: { id: string; instance_id: string; received_at: string },
  layout: BatchLayout,
  file: { filename: string; bytes: Uint8Array },
  chunk: { from: number; count: number; duplicates: boolean },
  deps: { model: ExtractionModel; bucket?: R2Bucket; customerId?: string }
): Promise<RouteResult> {
  if (layout.kind === "xml") return { status: 400, body: { error: "XML invoices in a batch are sent one at a time, as files" } };
  const reading = await readBatch(db, layout, file.filename, file.bytes, upload.id);
  if ("status" in reading) return reading;
  if (reading.problems.length > 0) return { status: 422, body: { error: reading.problems.map((p) => p.text).join(" ") } };
  const chosen = reading.entries.filter((e) => e.read && (chunk.duplicates || !e.duplicateOf));

  // The whole file, kept once, as the upload's first part.
  const messageId = upload.id;
  let part = await db
    .prepare("SELECT seq, r2_key FROM route_message_parts WHERE message_id = ? AND seq = 1")
    .bind(messageId)
    .first<{ seq: number; r2_key: string }>();
  if (!part && deps.bucket && deps.customerId) {
    const storedPart = await storeRoutePart(deps.bucket, db, {
      messageId,
      seq: 1,
      role: "attachment",
      filename: file.filename,
      contentType: "text/csv",
      bytes: file.bytes,
      key: routePartKey(deps.customerId, upload.instance_id, messageId, upload.received_at, 1, file.filename),
    });
    if ("stored" in storedPart) {
      part = { seq: 1, r2_key: storedPart.stored.r2Key };
      await db.prepare("UPDATE route_messages SET bytes = ? WHERE id = ?").bind(file.bytes.length, messageId).run();
      await addRouteEvent(db, messageId, "batch_read", {
        partSeq: 1,
        detail: `${chosen.length} invoices to make, ${reading.layoutName}`,
        actor: person.id,
      });
    }
  }
  const stored = part ? { routeMessageId: messageId, partSeq: 1, r2Key: part.r2_key } : undefined;

  const slice = chosen.slice(Math.max(0, chunk.from), Math.max(0, chunk.from) + Math.min(Math.max(1, chunk.count), 50));
  const made: Array<{ key: string; number: string; invoiceId: string }> = [];
  const failed: Array<{ key: string; number: string; why: string }> = [];
  for (const entry of slice) {
    // A chunk sent again (the connection dropped, say) never makes an invoice twice.
    const already = await db
      .prepare(
        `SELECT h.id FROM route_message_items i JOIN invoice_headers h ON h.id = i.item_id
         WHERE i.message_id = ?1 AND h.invoice_number = ?2
           AND ((?3 IS NOT NULL AND h.supplier_vat_id = ?3) OR (?4 IS NOT NULL AND json_extract(h.facts_json, '$."BT-27"') = ?4))`
      )
      .bind(messageId, entry.number, entry.supplierVat, entry.supplier)
      .first<{ id: string }>();
    if (already) {
      made.push({ key: entry.key, number: entry.number, invoiceId: already.id });
      continue;
    }
    const result = await handleCaptureFromSource(
      db,
      upload.instance_id,
      new TextEncoder().encode(entry.text),
      deps.model,
      undefined,
      deps.bucket,
      deps.customerId,
      stored,
      person.email,
      entry.read as PreRead
    );
    const invoiceId = (result.body as { id?: string } | undefined)?.id;
    if (result.status >= 400 || !invoiceId) {
      const why = (result.body as { error?: string } | undefined)?.error ?? "the invoice could not be made";
      failed.push({ key: entry.key, number: entry.number, why });
      await addRouteEvent(db, messageId, "capture_failed", { partSeq: 1, detail: `${entry.number}: ${why}`, actor: person.id });
      continue;
    }
    await linkRouteItem(db, messageId, invoiceId, stored ? 1 : null);
    await addRouteEvent(db, messageId, "captured", { partSeq: 1, detail: invoiceId });
    made.push({ key: entry.key, number: entry.number, invoiceId });
  }
  if (stored && made.length > 0) await setPartOutcome(db, messageId, 1, "captured", null);
  return { status: 200, body: { total: chosen.length, from: chunk.from, made, failed } };
}
