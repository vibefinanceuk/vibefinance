import {
  applyMapping,
  compileFunction,
  compileDocumentRule,
  proposeMapping,
  CSV_ROOT,
  CsvError,
  decodeText,
  csvToXml,
  describeXml,
  detectCsvOptions,
  distinctInColumn,
  mappableXml,
  FIELD_DESCRIPTIONS,
  isLineTarget,
  MAPPING_TARGETS,
  MappingXmlError,
  validateMapping,
  valuesAt,
  type AppliedMapping,
  type CompilerModel,
  type MappingDefinition,
} from "@vibefinance/shared";
import type { RouteResult } from "./org-route.js";
import { allLookups, lookupsFor, unknownLists } from "./lookup-lists-route.js";
import { handleCaptureIntake, type CaptureIntakeBody } from "./intake-capture-route.js";

/**
 * **Supplier mappings — decision 0561**, Routes phase 2 slice 2 (with the
 * editor's basics, as Dan chose on 30 September 2026).
 *
 * A supplier who sends its own XML is read through a mapping: which
 * element becomes which Business Term, and what function changes the
 * value on the way (`shared/ingestion/mapping-engine.ts`). Here:
 *
 * - **At intake**, `mappingFor` finds the live mapping on the receiving
 *   route for the document's root element (and sender, where the mapping
 *   names them), and `captureThroughMapping` reads the document through
 *   it. No mapping, or a value it cannot read, fails the attachment at
 *   translation with the reason in words; the message part keeps the root
 *   element, so the monitor can offer to map it.
 * - **For the editor** (`Admin.Configure`, like Routes): list, create from
 *   a kept message, read with the sample described, save the draft,
 *   compile a function from plain words, try the draft on the sample, and
 *   publish it — refused while the draft cannot read its own sample.
 *
 * Versions: one draft and one live at most. Saving edits the draft (made
 * from the live version when there is none); publishing retires the live
 * one and makes the draft live. What a message was read with is recorded
 * on its part, by mapping and version.
 */

export const SUPPLIER_ROOTS_NOT_MAPPED = new Set(["Invoice", "CrossIndustryInvoice", "CreditNote", "CrossIndustryDocument"]);

interface MappingRow {
  id: string;
  route_id: string;
  name: string;
  root: string;
  senders: string | null;
  status: string;
  created_at: string;
}

interface VersionRow {
  mapping_id: string;
  version: number;
  status: "draft" | "live" | "retired";
  definition_json: string;
  sample_message_id: string | null;
  sample_part_seq: number | null;
  created_at: string;
  published_at: string | null;
  published_by_name?: string | null;
}

const now = () => new Date().toISOString();

function newMappingId(): string {
  const hex = [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `MAP-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

function sendersOf(row: MappingRow): string[] | null {
  if (!row.senders) return null;
  try {
    const list = JSON.parse(row.senders) as unknown;
    return Array.isArray(list) ? list.map((s) => String(s).toLowerCase()) : null;
  } catch {
    return null;
  }
}

/** Whether every column a CSV mapping reads is in this file. */
function csvFits(text: string, definitionJson: string): boolean {
  try {
    const def = JSON.parse(definitionJson) as MappingDefinition;
    const present = new Set(csvToXml(text, def.csv ?? detectCsvOptions(text)).columns.map((c) => c.element));
    return def.lines.every((l) => l.source === null || present.has(l.source.split("/").pop() ?? ""));
  } catch {
    return false;
  }
}

/** An address matches `anna@munch.de` exactly, or `@munch.de` by its domain. */
export function senderMatches(senders: string[] | null, sender: string | undefined): boolean {
  if (senders === null) return true;
  if (!sender) return false;
  const address = sender.toLowerCase().replace(/^.*<([^>]+)>.*$/, "$1").trim();
  return senders.some((s) => (s.startsWith("@") ? address.endsWith(s) : address === s));
}

/** The domain of an address, as a sender a new mapping is for: `@munch.de`. */
export function domainOf(address: string | null): string | null {
  if (!address) return null;
  const bare = address.toLowerCase().replace(/^.*<([^>]+)>.*$/, "$1").trim();
  const at = bare.lastIndexOf("@");
  return at > 0 && at < bare.length - 1 ? bare.slice(at) : null;
}

/**
 * The live mapping that reads this document on this Source's route: the
 * same root element, and a sender it names — one that names the sender
 * before one for anyone, then the most recently published.
 */
export async function mappingFor(
  db: D1Database,
  sourceId: string,
  root: string,
  sender: string | undefined,
  text?: string
): Promise<{ mapping: MappingRow; version: VersionRow } | null> {
  const rows = await db
    .prepare(
      `SELECT m.*, v.version, v.status AS v_status, v.definition_json, v.published_at
       FROM supplier_mappings m
       JOIN route_instances i ON i.route_id = m.route_id AND i.source_id = ?
       JOIN supplier_mapping_versions v ON v.mapping_id = m.id AND v.status = 'live'
       WHERE m.root = ? AND m.status = 'active'
       ORDER BY v.published_at DESC`
    )
    .bind(sourceId, root)
    .all<MappingRow & { version: number; v_status: string; definition_json: string; published_at: string }>();
  const candidates = rows.results.filter((r) => senderMatches(sendersOf(r), sender));
  /**
   * **Every CSV has the same root — decision 0565.** Where one sender has
   * several CSV mappings (an invoice file and a credit file, say), the one
   * whose columns are all in this file comes first; where none fits, the
   * usual order stands, and the mapping says what it could not read.
   */
  const fitting = root === CSV_ROOT && text !== undefined ? candidates.filter((r) => csvFits(text, r.definition_json)) : [];
  const pool = fitting.length > 0 ? fitting : candidates;
  const best = pool.find((r) => sendersOf(r) !== null) ?? pool[0];
  if (!best) return null;
  return {
    mapping: best,
    version: {
      mapping_id: best.id,
      version: best.version,
      status: "live",
      definition_json: best.definition_json,
      sample_message_id: null,
      sample_part_seq: null,
      created_at: best.created_at,
      published_at: best.published_at,
    },
  };
}

/**
 * **Why no mapping read it, where one came close — decision 0563.** On
 * 30 September Dan's invoice failed six times with "no mapping on this
 * route reads it yet" while a live mapping for `<Rechnung>` sat on the
 * route: it was for another sender. Two near misses are named:
 *
 * - `not_published`: a mapping for this root and this sender exists, but
 *   has never been published. Drafts never read real invoices.
 * - `not_for_sender`: a live mapping reads this root, but "Who it is for"
 *   does not include this sender.
 *
 * The first comes first: it is the closer of the two, and publishing is
 * what fixes it. Null where nothing on the route came close.
 */
export async function nearMiss(
  db: D1Database,
  sourceId: string,
  root: string,
  sender: string | undefined
): Promise<{ id: string; name: string; miss: "not_published" | "not_for_sender" } | null> {
  const rows = (
    await db
      .prepare(
        `SELECT m.*,
                (SELECT version FROM supplier_mapping_versions v WHERE v.mapping_id = m.id AND v.status = 'live') AS live_version
         FROM supplier_mappings m
         JOIN route_instances i ON i.route_id = m.route_id AND i.source_id = ?
         WHERE m.root = ? AND m.status = 'active'
         ORDER BY m.created_at DESC`
      )
      .bind(sourceId, root)
      .all<MappingRow & { live_version: number | null }>()
  ).results;
  const unpublished = rows.filter((r) => r.live_version === null && senderMatches(sendersOf(r), sender));
  const draft = unpublished.find((r) => sendersOf(r) !== null) ?? unpublished[0];
  if (draft) return { id: draft.id, name: draft.name, miss: "not_published" };
  const live = rows.find((r) => r.live_version !== null && !senderMatches(sendersOf(r), sender));
  if (live) return { id: live.id, name: live.name, miss: "not_for_sender" };
  return null;
}

/** A problem, in words, for the message part's reason. */
function describeProblem(p: AppliedMapping["problems"][number]): string {
  const where = p.line !== undefined ? ` on line ${p.line}` : "";
  return `${p.target}${where} (from ${p.source ?? "a fixed value"}): ${p.reason}`;
}

/**
 * Reads a supplier's own XML through its live mapping and captures the
 * invoice. The response carries `format: "supplier_xml"`, the root, and the
 * mapping and version used (or `mappingId: null` where none reads it), so
 * the route records them on the message part either way.
 */
export async function captureThroughMapping(
  db: D1Database,
  sourceId: string,
  channelId: string,
  /** The file's text: a supplier's XML, or (decision 0565) its CSV. */
  text: string,
  root: string,
  sender: string | undefined,
  idOverride: string | undefined,
  enrichFacts: CaptureIntakeBody["enrichFacts"],
  /** Decision 0566: read again into this invoice's own instance, rather than a new one. */
  existingInstanceId?: string
): Promise<RouteResult> {
  const found = await mappingFor(db, sourceId, root, sender, text);
  const isCsv = root === CSV_ROOT;
  const base = { format: isCsv ? "supplier_csv" : "supplier_xml", syntax: null, xmlRoot: root };
  const what = isCsv ? "this is a CSV file" : `this is <${root}>, a supplier's own XML`;
  if (!found) {
    const near = await nearMiss(db, sourceId, root, sender);
    const from = sender ? sender.toLowerCase().replace(/^.*<([^>]+)>.*$/, "$1").trim() : "an unknown sender";
    const kind = isCsv ? "CSV files" : `<${root}>`;
    const error =
      near?.miss === "not_published"
        ? `${what}; the mapping "${near.name}" would read it, but has not been published`
        : near?.miss === "not_for_sender"
          ? `${what}; the mapping "${near.name}" reads ${kind} on this route, but is not for ${from}`
          : `${what}, and no mapping on this route reads it yet`;
    return {
      status: 422,
      body: { ...base, mappingId: near?.id ?? null, mappingMiss: near?.miss ?? null, error },
    };
  }
  const where = { mappingId: found.mapping.id, mappingVersion: found.version.version };
  const definition = JSON.parse(found.version.definition_json) as MappingDefinition;
  let applied: AppliedMapping;
  try {
    applied = applyMapping(mappableXml(text, definition), definition, await lookupsFor(db, definition));
  } catch (err) {
    if (err instanceof MappingXmlError || err instanceof CsvError) return { status: 422, body: { ...base, ...where, error: err.message } };
    throw err;
  }
  /**
   * **One invoice per file — decision 0565.** A CSV whose invoice numbers
   * differ between rows holds several invoices; reading it as one would
   * make an invoice nobody sent. Refused in words, with the numbers.
   */
  const numberFrom = definition.lines.find((l) => l.target === "BT-1")?.source ?? null;
  if (isCsv && numberFrom) {
    const numbers = distinctInColumn(text, definition.csv ?? detectCsvOptions(text), numberFrom);
    if (numbers.length > 1) {
      const shown = numbers.slice(0, 5).join(", ") + (numbers.length > 5 ? ", ..." : "");
      return {
        status: 422,
        body: {
          ...base,
          ...where,
          error: `${found.mapping.name} v${found.version.version}: the file holds ${numbers.length} invoices (${shown}). One invoice per file is read`,
        },
      };
    }
  }
  if (applied.problems.length > 0) {
    return {
      status: 422,
      body: {
        ...base,
        ...where,
        problems: applied.problems,
        error: `${found.mapping.name} v${found.version.version} could not read it: ${applied.problems.map(describeProblem).join("; ")}`,
      },
    };
  }
  const facts: Record<string, unknown> = {
    ...applied.facts,
    "intake.format": base.format,
    "en16931.checked": true,
    "en16931.failures": applied.en16931.failed.map((f) => f.rule).join(","),
  };
  const result = await handleCaptureIntake(db, channelId, {
    id: idOverride ?? crypto.randomUUID(),
    invoiceNumber: facts["BT-1"] as string | undefined,
    issueDate: facts["BT-2"] as string | undefined,
    currency: facts["BT-5"] as string | undefined,
    supplierVatId: facts["BT-31"] as string | undefined,
    totalWithVat: facts["BT-112"] as number | undefined,
    facts,
    lines: applied.lines,
    enrichFacts,
    ...(existingInstanceId ? { existingInstanceId } : {}),
  });
  if (result.status >= 400) return { status: result.status, body: { ...(result.body as object), ...base, ...where } };
  return {
    status: result.status,
    body: {
      ...(result.body as Record<string, unknown>),
      ...base,
      ...where,
      en16931: { checked: applied.en16931.checked.length, failed: applied.en16931.failed },
    },
  };
}

// ---------------------------------------------------------------- the editor

async function samplePart(
  db: D1Database,
  bucket: R2Bucket | undefined,
  messageId: string | null,
  seq: number | null
): Promise<{ text: string; filename: string; root: string | null } | null> {
  if (!bucket || !messageId || seq === null) return null;
  const part = await db
    .prepare("SELECT r2_key, filename, xml_root FROM route_message_parts WHERE message_id = ? AND seq = ?")
    .bind(messageId, seq)
    .first<{ r2_key: string; filename: string; xml_root: string | null }>();
  if (!part) return null;
  const object = await bucket.get(part.r2_key);
  if (!object) return null;
  // Decision 0565: a CSV may be Windows-1252, as Excel saves it.
  return { text: decodeText(new Uint8Array(await object.arrayBuffer())), filename: part.filename, root: part.xml_root };
}

/** The Business Terms a mapping can fill, in words, with what EN 16931 requires. */
export const REQUIRED_TARGETS = new Set([
  "BT-1", "BT-2", "BT-3", "BT-5", "BT-27", "BT-40", "BT-44", "BT-55", "BT-106", "BT-109", "BT-112", "BT-115",
  "BT-126", "BT-129", "BT-130", "BT-131", "BT-146", "BT-153",
]);

function targets() {
  return Object.entries(MAPPING_TARGETS).map(([id, kind]) => ({
    id,
    kind,
    line: isLineTarget(id),
    required: REQUIRED_TARGETS.has(id),
    description: (FIELD_DESCRIPTIONS as Record<string, string>)[id] ?? id,
  }));
}

async function versionsOf(db: D1Database, id: string): Promise<VersionRow[]> {
  return (
    await db
      .prepare(
        `SELECT v.*, u.name AS published_by_name FROM supplier_mapping_versions v
         LEFT JOIN org_users u ON u.id = v.published_by
         WHERE v.mapping_id = ? ORDER BY v.version DESC`
      )
      .bind(id)
      .all<VersionRow>()
  ).results;
}

/**
 * Messages on this route whose supplier XML with this root no mapping
 * read, or one failed to: what publishing may fix. **Only those from a
 * sender this mapping is for — decision 0563**: a message it would never
 * read is not waiting for it, and offering to reprocess it only fails
 * again.
 */
async function waitingFor(db: D1Database, mapping: MappingRow): Promise<string[]> {
  const senders = sendersOf(mapping);
  return (
    await db
      .prepare(
        `SELECT DISTINCT m.id, m.counterparty, m.received_at FROM route_message_parts p
         JOIN route_messages m ON m.id = p.message_id
         JOIN route_instances i ON i.source_id = m.instance_id AND i.route_id = ?
         WHERE p.xml_root = ? AND p.outcome = 'failed' AND m.status IN ('failed', 'partial')
         ORDER BY m.received_at DESC LIMIT 200`
      )
      .bind(mapping.route_id, mapping.root)
      .all<{ id: string; counterparty: string | null }>()
  ).results
    .filter((r) => senderMatches(senders, r.counterparty ?? undefined))
    .slice(0, 50)
    .map((r) => r.id);
}

export async function handleListMappings(db: D1Database, params: URLSearchParams): Promise<RouteResult> {
  const route = params.get("route");
  const rows = await db
    .prepare(
      `SELECT m.*,
              (SELECT version FROM supplier_mapping_versions v WHERE v.mapping_id = m.id AND v.status = 'live') AS live_version,
              (SELECT version FROM supplier_mapping_versions v WHERE v.mapping_id = m.id AND v.status = 'draft') AS draft_version,
              (SELECT count(*) FROM route_message_parts p JOIN route_messages rm ON rm.id = p.message_id
                 WHERE p.mapping_id = m.id AND p.outcome = 'captured'
                   AND rm.received_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')) AS read_30d
       FROM supplier_mappings m
       WHERE m.status = 'active' ${route ? "AND m.route_id = ?" : ""}
       ORDER BY m.name`
    )
    .bind(...(route ? [route] : []))
    .all<MappingRow & { live_version: number | null; draft_version: number | null; read_30d: number }>();
  const mappings = [];
  for (const r of rows.results) {
    mappings.push({
      id: r.id,
      routeId: r.route_id,
      name: r.name,
      root: r.root,
      senders: sendersOf(r),
      liveVersion: r.live_version,
      draftVersion: r.draft_version,
      read30d: r.read_30d,
      waiting: (await waitingFor(db, r)).length,
    });
  }
  return { status: 200, body: { mappings } };
}

/**
 * `POST /supplier-mappings` — a new mapping, drawn from a kept message
 * part: its route, its root element, the lines' group, and the sender's
 * domain as who it is for. An empty draft; lines are drawn in the editor.
 */
export async function handleCreateMapping(
  db: D1Database,
  bucket: R2Bucket | undefined,
  userId: string,
  body: Record<string, unknown>
): Promise<RouteResult> {
  const messageId = typeof body.messageId === "string" ? body.messageId : null;
  const seq = typeof body.partSeq === "number" ? body.partSeq : null;
  if (!messageId || seq === null) return { status: 400, body: { error: "a kept message and part to draw from are required", reason: "no_sample" } };
  const message = await db
    .prepare(
      `SELECT m.id, m.counterparty, i.route_id FROM route_messages m
       JOIN route_instances i ON i.source_id = m.instance_id WHERE m.id = ? AND m.direction = 'in'`
    )
    .bind(messageId)
    .first<{ id: string; counterparty: string | null; route_id: string }>();
  if (!message) return { status: 404, body: { error: `message ${messageId} did not arrive on a Source route`, reason: "no_message" } };
  const sample = await samplePart(db, bucket, messageId, seq);
  if (!sample) return { status: 404, body: { error: "that part is not kept", reason: "no_sample" } };

  // Decision 0565: a CSV is described as the document its mapping reads,
  // with the separator and column names guessed from the file.
  const csv = sample.root === CSV_ROOT ? detectCsvOptions(sample.text) : undefined;
  let described;
  try {
    described = describeXml(csv ? csvToXml(sample.text, csv).xml : sample.text);
  } catch (err) {
    return { status: 422, body: { error: (err as Error).message, reason: csv ? "not_csv" : "not_xml" } };
  }
  if (SUPPLIER_ROOTS_NOT_MAPPED.has(described.root)) {
    return { status: 422, body: { error: `<${described.root}> is read by a standard mapping`, reason: "standard_format" } };
  }

  const id = newMappingId();
  const domain = domainOf(message.counterparty);
  const name =
    typeof body.name === "string" && body.name.trim() !== ""
      ? body.name.trim().slice(0, 80)
      : `${domain ? domain.slice(1) : "Supplier"} ${csv ? "CSV" : `<${described.root}>`}`;
  const definition: MappingDefinition = { root: described.root, linesPath: described.repeating[0] ?? null, lines: [], ...(csv ? { csv } : {}) };
  await db.batch([
    db
      .prepare("INSERT INTO supplier_mappings (id, route_id, name, root, senders, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(id, message.route_id, name, described.root, domain ? JSON.stringify([domain]) : null, now(), userId),
    db
      .prepare(
        `INSERT INTO supplier_mapping_versions (mapping_id, version, status, definition_json, sample_message_id, sample_part_seq, created_at, created_by)
         VALUES (?, 1, 'draft', ?, ?, ?, ?, ?)`
      )
      .bind(id, JSON.stringify(definition), messageId, seq, now(), userId),
  ]);
  return { status: 201, body: { id, name, root: described.root } };
}

/**
 * `GET /supplier-mappings/:id` — the mapping, its versions, the one being
 * edited (the draft, else the live one), and its sample described: every
 * element with a value, and the groups that repeat.
 */
export async function handleGetMapping(db: D1Database, bucket: R2Bucket | undefined, id: string): Promise<RouteResult> {
  const mapping = await db.prepare("SELECT * FROM supplier_mappings WHERE id = ?").bind(id).first<MappingRow>();
  if (!mapping) return { status: 404, body: { error: `mapping ${id} does not exist` } };
  const versions = await versionsOf(db, id);
  const editing = versions.find((v) => v.status === "draft") ?? versions.find((v) => v.status === "live") ?? versions[0];
  const sample = await samplePart(db, bucket, editing?.sample_message_id ?? null, editing?.sample_part_seq ?? null);
  let described = null;
  let columns: Array<{ name: string; element: string }> | null = null;
  if (sample) {
    try {
      const def = editing ? (JSON.parse(editing.definition_json) as MappingDefinition) : { root: mapping.root, linesPath: null, lines: [] };
      described = describeXml(mappableXml(sample.text, def));
      // Decision 0565: a CSV's columns as written, beside their names in the paths.
      if (def.root === CSV_ROOT) columns = csvToXml(sample.text, def.csv ?? detectCsvOptions(sample.text)).columns;
    } catch {
      described = null;
    }
  }
  return {
    status: 200,
    body: {
      mapping: {
        id: mapping.id,
        routeId: mapping.route_id,
        name: mapping.name,
        root: mapping.root,
        senders: sendersOf(mapping),
        status: mapping.status,
      },
      versions: versions.map((v) => ({
        version: v.version,
        status: v.status,
        createdAt: v.created_at,
        publishedAt: v.published_at,
        publishedBy: v.published_by_name ?? null,
      })),
      editing: editing
        ? {
            version: editing.version,
            status: editing.status,
            definition: JSON.parse(editing.definition_json) as MappingDefinition,
            sample: sample ? { messageId: editing.sample_message_id, partSeq: editing.sample_part_seq, filename: sample.filename } : null,
          }
        : null,
      described,
      columns,
      // Decision 0568: the look-up lists, by id and name, for showing a function's list.
      lists: (await allLookups(db)).lists.map((l) => ({ id: l.id, name: l.name })),
      targets: targets(),
      waiting: (await waitingFor(db, mapping)).length,
    },
  };
}

async function draftOf(db: D1Database, id: string, userId: string): Promise<VersionRow | null> {
  const versions = await versionsOf(db, id);
  const draft = versions.find((v) => v.status === "draft");
  if (draft) return draft;
  const from = versions.find((v) => v.status === "live") ?? versions[0];
  if (!from) return null;
  const version = Math.max(...versions.map((v) => v.version)) + 1;
  await db
    .prepare(
      `INSERT INTO supplier_mapping_versions (mapping_id, version, status, definition_json, sample_message_id, sample_part_seq, created_at, created_by)
       VALUES (?, ?, 'draft', ?, ?, ?, ?, ?)`
    )
    .bind(id, version, from.definition_json, from.sample_message_id, from.sample_part_seq, now(), userId)
    .run();
  return { ...from, version, status: "draft", published_at: null };
}

/** `PUT /supplier-mappings/:id/draft` — the draft's lines, its lines' group, and who it is for. */
export async function handleSaveDraft(db: D1Database, userId: string, id: string, body: Record<string, unknown>): Promise<RouteResult> {
  const mapping = await db.prepare("SELECT * FROM supplier_mappings WHERE id = ?").bind(id).first<MappingRow>();
  if (!mapping) return { status: 404, body: { error: `mapping ${id} does not exist` } };
  if (mapping.status === "retired") return { status: 409, body: { error: "the mapping is retired", reason: "retired" } };
  const definition = { ...(body.definition as MappingDefinition), root: mapping.root };
  const invalid = validateMapping(definition);
  if (invalid) return { status: 422, body: { error: invalid, reason: "invalid_mapping" } };
  // Decision 0568: a look-up names a list that exists and is not retired.
  const missing = await unknownLists(db, definition);
  if (missing.length > 0) {
    return { status: 422, body: { error: `there is no look-up list ${missing.join(", ")}, or it is retired`, reason: "unknown_list" } };
  }
  const draft = await draftOf(db, id, userId);
  if (!draft) return { status: 404, body: { error: "the mapping has no version" } };
  await db
    .prepare("UPDATE supplier_mapping_versions SET definition_json = ? WHERE mapping_id = ? AND version = ?")
    .bind(JSON.stringify(definition), id, draft.version)
    .run();
  if (Array.isArray(body.senders) || body.senders === null || typeof body.name === "string") {
    const senders = Array.isArray(body.senders)
      ? (body.senders as unknown[]).map((s) => String(s).trim().toLowerCase()).filter((s) => /^@?[^@\s]+(@[^@\s]+)?$/.test(s))
      : body.senders === null
        ? null
        : sendersOf(mapping);
    const name = typeof body.name === "string" && body.name.trim() !== "" ? body.name.trim().slice(0, 80) : mapping.name;
    await db
      .prepare("UPDATE supplier_mappings SET senders = ?, name = ? WHERE id = ?")
      .bind(senders && senders.length > 0 ? JSON.stringify(senders) : null, name, id)
      .run();
  }
  return { status: 200, body: { id, version: draft.version, status: "draft" } };
}

/**
 * `POST /supplier-mappings/:id/compile` — a function from plain words for
 * one line, with worked examples from every value the element holds in
 * the sample. Nothing is saved: the person accepts it, and the draft is
 * saved with it.
 */
export async function handleCompileFunction(
  db: D1Database,
  bucket: R2Bucket | undefined,
  model: CompilerModel,
  id: string,
  body: Record<string, unknown>
): Promise<RouteResult> {
  const target = String(body.target ?? "");
  if (!(target in MAPPING_TARGETS)) return { status: 422, body: { error: `"${target}" is not a Business Term a mapping can fill` } };
  const versions = await versionsOf(db, id);
  const editing = versions.find((v) => v.status === "draft") ?? versions.find((v) => v.status === "live");
  if (!editing) return { status: 404, body: { error: `mapping ${id} does not exist` } };
  const sample = await samplePart(db, bucket, editing.sample_message_id, editing.sample_part_seq);
  const source = typeof body.source === "string" ? body.source : null;
  let samples: string[] = [];
  if (sample && source) {
    try {
      samples = valuesAt(mappableXml(sample.text, JSON.parse(editing.definition_json) as MappingDefinition), source);
    } catch {
      samples = [];
    }
  }
  // Decision 0568: the customer's look-up lists, for "look it up in Units".
  const { lists, ctx } = await allLookups(db);
  const outcome = await compileFunction(model, String(body.say ?? ""), {
    target,
    targetName: (FIELD_DESCRIPTIONS as Record<string, string>)[target] ?? target,
    kind: MAPPING_TARGETS[target],
    samples,
    lists,
    ctx,
  });
  return { status: 200, body: outcome };
}

/**
 * `POST /supplier-mappings/:id/compile-rule` — **a rule for the whole
 * invoice, from plain words — decision 0569.** Compiled against what the
 * draft reads from its own sample now, with the term before and after as
 * the worked example. Nothing is saved: the person accepts it, and the
 * draft is saved with it.
 */
export async function handleCompileRule(
  db: D1Database,
  bucket: R2Bucket | undefined,
  model: CompilerModel,
  id: string,
  body: Record<string, unknown>
): Promise<RouteResult> {
  const versions = await versionsOf(db, id);
  const editing = versions.find((v) => v.status === "draft") ?? versions.find((v) => v.status === "live");
  if (!editing) return { status: 404, body: { error: `mapping ${id} does not exist` } };
  const tried = await tryVersion(db, bucket, editing);
  const def = JSON.parse(editing.definition_json) as MappingDefinition;
  const terms = Object.entries(MAPPING_TARGETS)
    .filter(([t]) => !isLineTarget(t))
    .map(([t, kind]) => ({ id: t, name: (FIELD_DESCRIPTIONS as Record<string, string>)[t] ?? t, kind }));
  const { lists, ctx } = await allLookups(db);
  const outcome = await compileDocumentRule(model, String(body.say ?? ""), {
    terms,
    facts: "applied" in tried && tried.applied ? tried.applied.facts : {},
    lines: def.lines,
    lists,
    ctx,
  });
  return { status: 200, body: outcome };
}

/**
 * `POST /supplier-mappings/:id/propose` — **AI proposes the lines —
 * decision 0570.** The model proposes which element becomes which term,
 * for the terms not yet mapped; our code checks each proposal and scores
 * it on names, values and whether the invoice adds up. Nothing is saved:
 * the person applies proposals, and the draft is saved with them.
 */
export async function handleProposeMapping(
  db: D1Database,
  bucket: R2Bucket | undefined,
  model: CompilerModel,
  id: string
): Promise<RouteResult> {
  const mapping = await db.prepare("SELECT * FROM supplier_mappings WHERE id = ?").bind(id).first<MappingRow>();
  if (!mapping) return { status: 404, body: { error: `mapping ${id} does not exist` } };
  if (mapping.status === "retired") return { status: 409, body: { error: "the mapping is retired", reason: "retired" } };
  const versions = await versionsOf(db, id);
  const editing = versions.find((v) => v.status === "draft") ?? versions.find((v) => v.status === "live");
  if (!editing) return { status: 404, body: { error: `mapping ${id} has no version` } };
  const sample = await samplePart(db, bucket, editing.sample_message_id, editing.sample_part_seq);
  if (!sample) return { status: 409, body: { error: "the sample is no longer kept", reason: "no_sample" } };
  const def = JSON.parse(editing.definition_json) as MappingDefinition;
  let xml: string;
  let columns: Array<{ name: string; element: string }> | null = null;
  try {
    xml = mappableXml(sample.text, def);
    if (def.root === CSV_ROOT) columns = csvToXml(sample.text, def.csv ?? detectCsvOptions(sample.text)).columns;
  } catch (err) {
    return { status: 422, body: { error: (err as Error).message, reason: "unreadable_sample" } };
  }
  const { lists, ctx } = await allLookups(db);
  const result = await proposeMapping(model, {
    described: describeXml(xml),
    xml,
    def,
    targets: targets().map((t) => ({ id: t.id, name: t.description, kind: t.kind, line: t.line, required: t.required })),
    lists,
    ctx,
    columns,
  });
  return { status: 200, body: result };
}

/** Applies a version to its own sample. */
async function tryVersion(db: D1Database, bucket: R2Bucket | undefined, version: VersionRow) {
  const sample = await samplePart(db, bucket, version.sample_message_id, version.sample_part_seq);
  if (!sample) return { error: "the sample is no longer kept" as const };
  try {
    const def = JSON.parse(version.definition_json) as MappingDefinition;
    return { applied: applyMapping(mappableXml(sample.text, def), def, await lookupsFor(db, def)), filename: sample.filename };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/** `POST /supplier-mappings/:id/try` — what the draft makes of its sample: facts, lines, problems, EN 16931. */
export async function handleTryMapping(db: D1Database, bucket: R2Bucket | undefined, id: string): Promise<RouteResult> {
  const versions = await versionsOf(db, id);
  const editing = versions.find((v) => v.status === "draft") ?? versions.find((v) => v.status === "live");
  if (!editing) return { status: 404, body: { error: `mapping ${id} does not exist` } };
  const tried = await tryVersion(db, bucket, editing);
  if ("error" in tried) return { status: 422, body: { error: tried.error } };
  return {
    status: 200,
    body: {
      version: editing.version,
      filename: tried.filename,
      facts: tried.applied.facts,
      lines: tried.applied.lines,
      problems: tried.applied.problems,
      en16931: { checked: tried.applied.en16931.checked.length, failed: tried.applied.en16931.failed },
    },
  };
}

/**
 * `POST /supplier-mappings/:id/publish` — the draft becomes the live
 * version, and the one before it is retired. Refused while the draft
 * cannot read its own sample, or maps nothing. The response lists the
 * failed messages on the route it may now read, to reprocess.
 */
export async function handlePublishMapping(db: D1Database, bucket: R2Bucket | undefined, userId: string, id: string): Promise<RouteResult> {
  const mapping = await db.prepare("SELECT * FROM supplier_mappings WHERE id = ?").bind(id).first<MappingRow>();
  if (!mapping) return { status: 404, body: { error: `mapping ${id} does not exist` } };
  if (mapping.status === "retired") return { status: 409, body: { error: "the mapping is retired", reason: "retired" } };
  const draft = (await versionsOf(db, id)).find((v) => v.status === "draft");
  if (!draft) return { status: 409, body: { error: "there is no draft to publish", reason: "no_draft" } };
  const definition = JSON.parse(draft.definition_json) as MappingDefinition;
  if (definition.lines.length === 0) return { status: 422, body: { error: "the draft maps nothing yet", reason: "empty" } };
  const invalid = validateMapping(definition);
  if (invalid) return { status: 422, body: { error: invalid, reason: "invalid_mapping" } };
  const tried = await tryVersion(db, bucket, draft);
  if ("error" in tried) return { status: 422, body: { error: tried.error, reason: "no_sample" } };
  if (tried.applied.problems.length > 0) {
    return {
      status: 422,
      body: { error: "the draft cannot read its own sample", reason: "sample_problems", problems: tried.applied.problems },
    };
  }
  await db.batch([
    db.prepare("UPDATE supplier_mapping_versions SET status = 'retired' WHERE mapping_id = ? AND status = 'live'").bind(id),
    db
      .prepare("UPDATE supplier_mapping_versions SET status = 'live', published_at = ?, published_by = ? WHERE mapping_id = ? AND version = ?")
      .bind(now(), userId, id, draft.version),
  ]);
  return { status: 200, body: { id, version: draft.version, status: "live", waiting: await waitingFor(db, mapping) } };
}

/**
 * `POST /supplier-mappings/:id/retire` — **decision 0563.** The mapping
 * stops reading anything, and leaves the Routes screen's list. Its
 * versions are kept as they were, as history, and the message parts it
 * read still name it. Retiring one that is live is allowed: the response
 * says it was, so the editor can have said what that means first.
 */
export async function handleRetireMapping(db: D1Database, userId: string, id: string): Promise<RouteResult> {
  const mapping = await db.prepare("SELECT * FROM supplier_mappings WHERE id = ?").bind(id).first<MappingRow>();
  if (!mapping) return { status: 404, body: { error: `mapping ${id} does not exist` } };
  if (mapping.status === "retired") return { status: 409, body: { error: "the mapping is already retired", reason: "retired" } };
  const live = await db
    .prepare("SELECT version FROM supplier_mapping_versions WHERE mapping_id = ? AND status = 'live'")
    .bind(id)
    .first<{ version: number }>();
  await db
    .prepare("UPDATE supplier_mappings SET status = 'retired', retired_at = ?, retired_by = ? WHERE id = ?")
    .bind(now(), userId, id)
    .run();
  return { status: 200, body: { id, status: "retired", wasLive: live !== null } };
}
