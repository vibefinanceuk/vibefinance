import type { RouteResult } from "./org-route.js";
import {
  FUNCTION_NAMES,
  OUTBOUND_SOURCES,
  STANDARD_CONNECTORS,
  applyOutboundMapping,
  compileFunction,
  connectorOfInstance,
  listsInOutbound,
  outboundSamples,
  sourceLevel,
  standardOutboundMapping,
  validateOutboundMapping,
  type CompilerModel,
  type ConnectorDefinition,
  type OutboundMapping,
} from "@vibefinance/shared";
import { candidatesOf, destinationPayable, problemWords, settingsOf, vfInvoiceOf, HTTPS_OUT } from "./destination-delivery.js";
import { allLookups, loadLookups } from "./lookup-lists-route.js";

/**
 * **Outbound mapping — decision 0591**, slice 3 of the connector framework.
 *
 * A Destination sends the standard VibeFinance invoice JSON until it has
 * its own mapping. **Make my own copy** starts one from the standard
 * layout, as a draft. The draft is edited, tried on a real
 * payment-eligible invoice, and published: the live version is what the
 * Destination then sends (its format becomes `mapped`). Publishing again
 * retires the version before. Going back to the standard is the format
 * setting, which keeps the mapping.
 *
 * Under `Admin.Configure`, as the Destination's other settings.
 */

interface VersionRow {
  version: number;
  status: "draft" | "live" | "retired";
  definition_json: string;
  copied_from: string | null;
  sample_invoice_id: string | null;
  saved_at: string;
  published_at: string | null;
}

interface InstanceRow {
  id: string;
  route_id: string;
  process_id: string;
  name: string | null;
  status: string | null;
  settings_json: string | null;
  connector_id: string | null;
  connector_version: number | null;
}

const now = () => new Date().toISOString();

async function destination(db: D1Database, id: string): Promise<InstanceRow | RouteResult> {
  const row = await db
    .prepare("SELECT id, route_id, process_id, name, status, settings_json, connector_id, connector_version FROM route_instances WHERE id = ? AND source_id IS NULL")
    .bind(id)
    .first<InstanceRow>();
  if (!row) return { status: 404, body: { error: `destination ${id} does not exist` } };
  if (row.route_id !== HTTPS_OUT) return { status: 409, body: { error: "only an HTTPS out Destination has an outbound mapping", reason: "not_https_out" } };
  return row;
}
const isResult = (x: InstanceRow | RouteResult): x is RouteResult => "status" in x && "body" in x;

async function versionsOf(db: D1Database, id: string): Promise<VersionRow[]> {
  return (
    await db
      .prepare(
        "SELECT version, status, definition_json, copied_from, sample_invoice_id, saved_at, published_at FROM outbound_mapping_versions WHERE instance_id = ? ORDER BY version DESC"
      )
      .bind(id)
      .all<VersionRow>()
  ).results;
}

/** Whether its connector keeps the format fixed (an automation webhook sends the standard JSON). */
function formatFixed(instance: InstanceRow, library: ConnectorDefinition[]): boolean {
  return connectorOfInstance(library, instance)?.settings?.fixed.includes("format") ?? false;
}

/** `GET /route-instances/:id/mapping` — the standard layout, its own versions, what a field can read, and invoices to try. */
export async function handleGetOutboundMapping(db: D1Database, id: string, library: ConnectorDefinition[] = STANDARD_CONNECTORS): Promise<RouteResult> {
  const instance = await destination(db, id);
  if (isResult(instance)) return instance;
  const versions = await versionsOf(db, id);
  const editing = versions.find((v) => v.status === "draft") ?? versions.find((v) => v.status === "live") ?? null;
  const payable = await destinationPayable(db, instance.id, instance.process_id);
  const { lists } = await allLookups(db);
  const candidates = await candidatesOf(db, payable);
  // The invoice its values are shown from: the one it was last tried on, else the latest.
  const sampleId = editing?.sample_invoice_id ?? candidates[0]?.id ?? null;
  const sample = sampleId ? await vfInvoiceOf(db, sampleId) : null;
  return {
    status: 200,
    body: {
      instance: { id: instance.id, name: instance.name, processId: instance.process_id },
      using: settingsOf(instance).format === "mapped",
      formatFixed: formatFixed(instance, library),
      standard: standardOutboundMapping(),
      versions: versions.map((v) => ({ version: v.version, status: v.status, copiedFrom: v.copied_from, savedAt: v.saved_at, publishedAt: v.published_at })),
      editing: editing
        ? { version: editing.version, status: editing.status, definition: JSON.parse(editing.definition_json) as OutboundMapping, sampleInvoiceId: editing.sample_invoice_id }
        : null,
      sources: OUTBOUND_SOURCES,
      functions: FUNCTION_NAMES,
      lists: lists.map((l) => ({ id: l.id, name: l.name })),
      candidates,
      sample: sample ? { invoiceId: sampleId, invoice: sample } : null,
    },
  };
}

/** `POST /route-instances/:id/mapping/copy` — **Make my own copy**: a draft, version 1, of the standard layout. */
export async function handleCopyOutboundMapping(db: D1Database, userId: string, id: string, library: ConnectorDefinition[] = STANDARD_CONNECTORS): Promise<RouteResult> {
  const instance = await destination(db, id);
  if (isResult(instance)) return instance;
  if (instance.status === "retired") return { status: 409, body: { error: "the Destination is retired", reason: "retired" } };
  if (formatFixed(instance, library)) return { status: 409, body: { error: "this connector keeps its layout", reason: "format_fixed" } };
  if ((await versionsOf(db, id)).length > 0) return { status: 409, body: { error: "this Destination already has its own mapping", reason: "already_copied" } };
  const connector = connectorOfInstance(library, instance);
  await db
    .prepare(
      "INSERT INTO outbound_mapping_versions (instance_id, version, status, definition_json, copied_from, saved_at, saved_by) VALUES (?, 1, 'draft', ?, ?, ?, ?)"
    )
    .bind(id, JSON.stringify(standardOutboundMapping()), `${connector?.id ?? HTTPS_OUT}@${instance.connector_version ?? 1}`, now(), userId)
    .run();
  return { status: 201, body: { version: 1, status: "draft" } };
}

/** Lists the mapping names that are not active look-up lists. */
async function unknownLists(db: D1Database, def: OutboundMapping): Promise<string[]> {
  const ctx = await loadLookups(db, listsInOutbound(def));
  return listsInOutbound(def).filter((l) => !ctx.lookups?.[l]);
}

/** `PUT /route-instances/:id/mapping` `{ definition }` — save the draft, made from the live version where there is none. */
export async function handleSaveOutboundMapping(db: D1Database, userId: string, id: string, body: unknown): Promise<RouteResult> {
  const instance = await destination(db, id);
  if (isResult(instance)) return instance;
  if (instance.status === "retired") return { status: 409, body: { error: "the Destination is retired", reason: "retired" } };
  const def = (body as { definition?: unknown } | null)?.definition;
  const invalid = validateOutboundMapping(def);
  if (invalid) return { status: 422, body: { error: invalid, reason: "invalid" } };
  const missing = await unknownLists(db, def as OutboundMapping);
  if (missing.length > 0) return { status: 422, body: { error: `there is no look-up list ${missing.join(", ")}`, reason: "unknown_list" } };
  const versions = await versionsOf(db, id);
  if (versions.length === 0) return { status: 409, body: { error: "make your own copy first", reason: "no_mapping" } };
  const draft = versions.find((v) => v.status === "draft");
  const json = JSON.stringify(def);
  if (draft) {
    await db
      .prepare("UPDATE outbound_mapping_versions SET definition_json = ?, saved_at = ?, saved_by = ? WHERE instance_id = ? AND version = ?")
      .bind(json, now(), userId, id, draft.version)
      .run();
    return { status: 200, body: { version: draft.version, status: "draft" } };
  }
  const next = versions[0].version + 1;
  const from = versions.find((v) => v.status === "live");
  await db
    .prepare(
      "INSERT INTO outbound_mapping_versions (instance_id, version, status, definition_json, copied_from, sample_invoice_id, saved_at, saved_by) VALUES (?, ?, 'draft', ?, ?, ?, ?, ?)"
    )
    .bind(id, next, json, from?.copied_from ?? null, from?.sample_invoice_id ?? null, now(), userId)
    .run();
  return { status: 200, body: { version: next, status: "draft" } };
}

/** The draft, or the live version where there is no draft. */
async function editingOf(db: D1Database, id: string): Promise<VersionRow | null> {
  const versions = await versionsOf(db, id);
  return versions.find((v) => v.status === "draft") ?? versions.find((v) => v.status === "live") ?? null;
}

async function tryOn(db: D1Database, def: OutboundMapping, invoiceId: string) {
  const invoice = await vfInvoiceOf(db, invoiceId);
  if (!invoice) return null;
  const applied = applyOutboundMapping(def, invoice, await loadLookups(db, listsInOutbound(def)));
  return { invoiceId, invoice, body: applied.body, problems: applied.problems.map((p) => ({ ...p, words: problemWords(p) })) };
}

/** `POST /route-instances/:id/mapping/try` `{ invoiceId }` — the draft on a real invoice. Nothing is sent. */
export async function handleTryOutboundMapping(db: D1Database, id: string, body: unknown): Promise<RouteResult> {
  const instance = await destination(db, id);
  if (isResult(instance)) return instance;
  const editing = await editingOf(db, id);
  if (!editing) return { status: 409, body: { error: "make your own copy first", reason: "no_mapping" } };
  const invoiceId = (body as { invoiceId?: unknown } | null)?.invoiceId;
  if (typeof invoiceId !== "string") return { status: 400, body: { error: "name the invoice to try it on" } };
  const tried = await tryOn(db, JSON.parse(editing.definition_json) as OutboundMapping, invoiceId);
  if (!tried) return { status: 404, body: { error: `invoice ${invoiceId} could not be read` } };
  if (editing.status === "draft") {
    await db.prepare("UPDATE outbound_mapping_versions SET sample_invoice_id = ? WHERE instance_id = ? AND version = ?").bind(invoiceId, id, editing.version).run();
  }
  return { status: 200, body: { version: editing.version, ...tried } };
}

/**
 * `POST /route-instances/:id/mapping/publish` `{ invoiceId? }` — the draft
 * becomes live, once it lays out a real invoice without a problem (the one
 * named, or the one it was last tried on). The Destination then sends it.
 */
export async function handlePublishOutboundMapping(db: D1Database, userId: string, id: string, body: unknown): Promise<RouteResult> {
  const instance = await destination(db, id);
  if (isResult(instance)) return instance;
  if (instance.status === "retired") return { status: 409, body: { error: "the Destination is retired", reason: "retired" } };
  const versions = await versionsOf(db, id);
  const draft = versions.find((v) => v.status === "draft");
  if (!draft) return { status: 409, body: { error: "there is no draft to publish", reason: "no_draft" } };
  const named = (body as { invoiceId?: unknown } | null)?.invoiceId;
  const invoiceId = typeof named === "string" ? named : draft.sample_invoice_id;
  if (!invoiceId) return { status: 409, body: { error: "try it on an invoice first", reason: "not_tried" } };
  const tried = await tryOn(db, JSON.parse(draft.definition_json) as OutboundMapping, invoiceId);
  if (!tried) return { status: 404, body: { error: `invoice ${invoiceId} could not be read` } };
  if (tried.problems.length > 0) return { status: 422, body: { error: "the draft cannot lay out the invoice it was tried on", reason: "sample_problems", ...tried } };
  const at = now();
  await db.batch([
    db.prepare("UPDATE outbound_mapping_versions SET status = 'retired' WHERE instance_id = ? AND status = 'live'").bind(id),
    db
      .prepare("UPDATE outbound_mapping_versions SET status = 'live', published_at = ?, published_by = ?, sample_invoice_id = ? WHERE instance_id = ? AND version = ?")
      .bind(at, userId, invoiceId, id, draft.version),
  ]);
  // It is what the Destination sends from now on.
  const settings = settingsOf(instance);
  await db.prepare("UPDATE route_instances SET settings_json = ? WHERE id = ?").bind(JSON.stringify({ ...settings, format: "mapped" }), id).run();
  return { status: 200, body: { version: draft.version, status: "live", using: true } };
}

/**
 * `POST /route-instances/:id/mapping/compile` `{ target, source, say, invoiceId? }`
 * — a function from plain words for one field (0561's compiler), with
 * worked examples from every value the source holds in the invoice
 * tried. Nothing is saved: the person accepts it.
 */
export async function handleCompileOutboundFunction(db: D1Database, model: CompilerModel, id: string, body: unknown): Promise<RouteResult> {
  const instance = await destination(db, id);
  if (isResult(instance)) return instance;
  const b = (body ?? {}) as Record<string, unknown>;
  const target = typeof b.target === "string" ? b.target : "";
  if (!target) return { status: 400, body: { error: "name the field" } };
  const source = typeof b.source === "string" && sourceLevel(b.source) ? b.source : null;
  const editing = await editingOf(db, id);
  const invoiceId = typeof b.invoiceId === "string" ? b.invoiceId : editing?.sample_invoice_id;
  const invoice = invoiceId ? await vfInvoiceOf(db, invoiceId) : null;
  const { lists, ctx } = await allLookups(db);
  const outcome = await compileFunction(model, String(b.say ?? ""), {
    target,
    targetName: `a field ${instance.name ?? "the Destination"} sends`,
    kind: "any",
    samples: invoice && source ? outboundSamples(invoice, source) : [],
    lists,
    ctx,
  });
  return { status: 200, body: outcome };
}
