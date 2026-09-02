import type { InvoiceFacts } from "@vibefinance/shared";
import { parseUblInvoice, UblParseError } from "@vibefinance/shared";
import type { RouteResult } from "./org-route.js";
import { handleUpsertInvoice, mergeStructuredInvoiceFacts } from "./invoice-facts-route.js";
import { handleCreateProcessInstance, visitCurrentStage } from "./workflow-engine.js";
import { extractEmbeddedInvoiceXml, looksLikePdf, PdfExtractionError } from "./pdf-attachment.js";
import { extractInvoiceFromImage, extractInvoiceFromImages, sniffImageType, ExtractionRefusal, type ExtractionModel } from "./extraction.js";
import { loadPendingPages, markFinalised, type PendingDocumentStorage } from "./pending-document-route.js";
import { loadCustomFields } from "./custom-field-route.js";
import { resolveVocabulary } from "@vibefinance/shared";

/**
 * Document/receipt intake — see docs/decisions/0029-intake-capture.md.
 * Decisions 0013, 0015, 0019, 0023, 0024, 0025, and 0026 all flagged
 * this gap without closing it. This is the orchestration layer: store
 * facts, create a process instance for the channel's own process,
 * visit it immediately — one continuous call, reusing existing
 * storage, instance-creation, and evaluation logic exactly, never
 * reimplementing any of it.
 *
 * Deliberately narrow, the same scope boundary invoice-facts-route.ts
 * already states: this accepts already-extracted facts, the same
 * shape POST /invoices already takes. It does not parse a real UBL/
 * XML document or a PDF — that remains a separate, deferred piece,
 * explicitly real domain modeling rather than infrastructure
 * plumbing (decision 0026's own words).
 *
 * Intake stays content-agnostic on purpose: its only concern is which
 * channel something arrived through, never whether the content itself
 * is any good. A thin document (missing a required field) still
 * successfully becomes an instance and advances through Intake
 * normally — content quality is Validate's job, caught there by a
 * customer's own rule set, not here.
 */

interface CaptureIntakeBody {
  id?: unknown;
  subjectType?: unknown;
  mandateChannel?: unknown;
  facts?: unknown;
  lines?: unknown;
  [key: string]: unknown;
}

async function recordCaptureEvent(
  db: D1Database,
  channelId: string,
  outcome: "accepted" | "rejected",
  reason: string | null,
  processInstanceId: string | null
): Promise<void> {
  await db
    .prepare("INSERT INTO intake_capture_events (id, channel_id, outcome, reason, process_instance_id) VALUES (?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), channelId, outcome, reason, processInstanceId)
    .run();
}

/**
 * A single canonical line shape flows through this whole file — raw
 * BT-* fields plus lineNumber, the same shape a rule condition
 * actually checks against (BT-131, not "amount"). handleUpsertInvoice
 * and visitCurrentStage each need a DIFFERENT derived shape from it,
 * though: storage wants amount/description/costCentre as real,
 * explicit columns; evaluation wants the raw BT-* fields directly, the
 * same way header facts already work. A real gap this bundle's own
 * tests caught: passing the same raw-BT-code lines to both without
 * this conversion silently stored every line's amount as NULL, since
 * handleUpsertInvoice was never looking at "BT-131" at all.
 */
function toStorageLine(line: InvoiceFacts & { lineNumber: number }): Record<string, unknown> {
  const { lineNumber, ...rest } = line;
  return {
    lineNumber,
    amount: rest["BT-131"],
    // invoice_lines has its own description column, and leaving it
    // null while the text sat in facts_json made a stored line less
    // readable than it needed to be. Lifted out for the column;
    // deliberately left in `facts` too, so the fact set a rule sees
    // is unchanged.
    description: rest.description,
    facts: rest,
  };
}

export async function handleCaptureIntake(db: D1Database, channelId: string, body: CaptureIntakeBody): Promise<RouteResult> {
  const channel = await db
    .prepare("SELECT id, process_id, name FROM intake_channels WHERE id = ?")
    .bind(channelId)
    .first<{ id: string; process_id: string; name: string }>();
  if (!channel) {
    // Nothing to log an event against — intake_capture_events.
    // channel_id is a real foreign key, not a loosely-typed string.
    return { status: 404, body: { error: `intake channel ${channelId} does not exist` } };
  }

  const { id, subjectType, mandateChannel, facts } = body;
  if (typeof id !== "string" || !id) {
    await recordCaptureEvent(db, channelId, "rejected", "id (string) is required", null);
    return { status: 400, body: { error: "id (string) is required" } };
  }

  const canonicalLines = body.lines as Array<InvoiceFacts & { lineNumber: number }> | undefined;

  // Store facts, reusing handleUpsertInvoice's own logic exactly —
  // including duplicate-confidence scoring (decision 0028) for free.
  // mandate.channel defaults to the channel's own name, the caller
  // never needs to supply it separately, unless explicitly overridden.
  const upsertResult = await handleUpsertInvoice(db, {
    ...body,
    id,
    mandateChannel: (mandateChannel as string) ?? channel.name,
    lines: canonicalLines?.map(toStorageLine),
  });
  if (upsertResult.status >= 400) {
    const reason = (upsertResult.body as { error?: string }).error ?? "invoice facts were rejected";
    await recordCaptureEvent(db, channelId, "rejected", reason, null);
    return upsertResult;
  }

  // Create a process instance for the channel's own process — the
  // caller never needs to name a process explicitly; the channel they
  // captured through already determines it.
  const resolvedSubjectType = typeof subjectType === "string" && subjectType ? subjectType : "invoice";
  const instanceResult = await handleCreateProcessInstance(db, channel.process_id, {
    subjectType: resolvedSubjectType,
    subjectId: id,
  });
  if (instanceResult.status >= 400) {
    const reason = (instanceResult.body as { error?: string }).error ?? "could not create a process instance";
    await recordCaptureEvent(db, channelId, "rejected", reason, null);
    return instanceResult;
  }
  const instanceId = (instanceResult.body as { id: string }).id;

  // Accepted from here — a real instance now genuinely exists,
  // regardless of what the immediate visit below does with it.
  await recordCaptureEvent(db, channelId, "accepted", null, instanceId);

  // Visit immediately — the instance advances as far as it naturally
  // can in one call, exactly the same cascade every other caller of
  // visitCurrentStage already gets.
  //
  // A real bug caught by this bundle's own tests, the same class
  // decision 0028 already found once in /rules/evaluate: the
  // structured fields just stored (supplierVatId and the rest) must
  // be merged into what gets evaluated here too, under their real
  // vocabulary field names — otherwise a rule checking BT-31, say,
  // would never see a value for it even though it was genuinely just
  // stored. Built from what this call already knows, not a second
  // database round-trip.
  const resolvedFacts = (typeof facts === "object" && facts !== null && !Array.isArray(facts) ? facts : {}) as InvoiceFacts;
  const mergedFacts = mergeStructuredInvoiceFacts(resolvedFacts, {
    supplier_vat_id: (body.supplierVatId as string) ?? null,
    currency: (body.currency as string) ?? null,
    issue_date: (body.issueDate as string) ?? null,
    total_with_vat: (body.totalWithVat as number) ?? null,
    mandate_channel: (mandateChannel as string) ?? channel.name,
    invoice_number: (body.invoiceNumber as string) ?? null,
    duplicate_confidence: (upsertResult.body as { duplicateConfidence?: number }).duplicateConfidence ?? null,
  });
  const lines = canonicalLines;
  const visitResult = await visitCurrentStage(db, instanceId, mergedFacts, lines);

  // id is always echoed back — for the JSON path the caller already
  // supplied it themselves, but for handleCaptureUblXml's own
  // auto-generated id (decision 0030), this was the ONLY way to learn
  // what id actually got assigned — found live, against the real
  // deployment, when a caller had no way to look their own row back
  // up afterward except by a field like invoice_number.
  return {
    status: 201,
    body: {
      id,
      instanceId,
      channelId,
      processId: channel.process_id,
      visit: visitResult.body,
    },
  };
}

/**
 * Real document capture (decision 0030) — parses a genuine UBL 2.1
 * document (Peppol BIS Billing 3.0, or Self-Billing 3.0, the same
 * underlying shape per decision 0026) and delegates straight into
 * handleCaptureIntake, unchanged — the same store/instantiate/visit
 * orchestration, the same event logging, the same content-agnostic
 * philosophy. This function's only job is turning raw XML into the
 * facts shape that orchestration already expects.
 *
 * id defaults to a fresh, generated UUID — a real invoice number
 * (BT-1) is not safe to use directly as this system's own id, since
 * two different suppliers could coincidentally reuse the same number;
 * decision 0028's own duplicate-confidence scoring is what actually
 * detects that relationship, not id collision. A caller who wants
 * their own id can still supply one explicitly.
 */
export async function handleCaptureUblXml(
  db: D1Database,
  channelId: string,
  xml: string,
  idOverride?: string
): Promise<RouteResult> {
  let parsed: { facts: InvoiceFacts; lines: Array<InvoiceFacts & { lineNumber: number }> };
  try {
    parsed = parseUblInvoice(xml);
  } catch (err) {
    if (err instanceof UblParseError) {
      // A parse failure happens before handleCaptureIntake is ever
      // called, so none of its own rejection logging runs — logged
      // explicitly here instead. A malformed document is exactly the
      // kind of exception intake_capture_events exists to make
      // visible, not silently drop.
      const channelExists = await db.prepare("SELECT id FROM intake_channels WHERE id = ?").bind(channelId).first();
      if (channelExists) {
        await recordCaptureEvent(db, channelId, "rejected", err.message, null);
      }
      return { status: 422, body: { error: err.message } };
    }
    throw err;
  }

  const { facts, lines } = parsed;
  const id = idOverride ?? crypto.randomUUID();

  // The parser's own facts already carry the real BT-* structured
  // values (BT-1, BT-31, and the rest); handleUpsertInvoice still
  // needs them as its own explicit, structured parameters to persist
  // them as real columns, not just inside the opaque facts blob —
  // pulled back out here rather than parsed twice.
  return handleCaptureIntake(db, channelId, {
    id,
    invoiceNumber: facts["BT-1"] as string | undefined,
    issueDate: facts["BT-2"] as string | undefined,
    currency: facts["BT-5"] as string | undefined,
    supplierVatId: facts["BT-31"] as string | undefined,
    totalWithVat: facts["BT-112"] as number | undefined,
    facts,
    lines,
  });
}

export type HybridPdfFallback = "refuse" | "fallback";

export interface CapturePdfOutcome {
  /** How the document was actually handled — never inferred by the
   *  caller. A hybrid PDF's data is mandate-grade and structured; an
   *  image-only PDF's would be best-effort and inferred. Conflating
   *  the two in the response would hide exactly the distinction that
   *  matters. */
  documentPath: "hybrid-embedded-xml" | "image-only";
}

/**
 * Captures a PDF invoice — decision 0042.
 *
 * A hybrid PDF (Factur-X / ZUGFeRD) carries a complete EN 16931 XML
 * invoice as an embedded file, and that XML is the authoritative
 * data. So every PDF is checked for one FIRST, and when one is found
 * it is parsed exactly the way a directly-submitted UBL document
 * already is — the same parser, the same guarantees, no model, no
 * confidence score, no loss.
 *
 * Sending a hybrid PDF to a vision model would be a genuine
 * regression: substituting inferred data for structured data that was
 * already there and already correct. This function exists largely to
 * make sure that never happens by accident.
 *
 * What remains is the case where a PDF genuinely has no embedded
 * invoice — a scan, or a photograph. That path needs a vision model
 * and is deliberately not built yet (see docs/design/extraction.md);
 * it reports 501 rather than pretending to have handled the document.
 */
export async function handleCapturePdf(
  db: D1Database,
  channelId: string,
  bytes: Uint8Array,
  idOverride?: string
): Promise<RouteResult> {
  if (!looksLikePdf(bytes)) {
    const channelExists = await db.prepare("SELECT id FROM intake_channels WHERE id = ?").bind(channelId).first();
    if (channelExists) {
      await recordCaptureEvent(db, channelId, "rejected", "not a PDF file", null);
    }
    return { status: 422, body: { error: "not a PDF file (missing %PDF- header)" } };
  }

  const channel = await db
    .prepare("SELECT id, hybrid_pdf_fallback FROM intake_channels WHERE id = ?")
    .bind(channelId)
    .first<{ id: string; hybrid_pdf_fallback: HybridPdfFallback }>();
  if (!channel) {
    return { status: 404, body: { error: `intake channel ${channelId} does not exist` } };
  }

  let attachment: { filename: string; xml: string } | null;
  try {
    attachment = await extractEmbeddedInvoiceXml(bytes);
  } catch (err) {
    if (err instanceof PdfExtractionError) {
      // The document declares an embedded invoice and it could not be
      // read. Whether that is fatal is a real policy question with no
      // single right answer, so the channel decides (decision 0042).
      if (channel.hybrid_pdf_fallback === "refuse") {
        await recordCaptureEvent(db, channelId, "rejected", err.message, null);
        return {
          status: 422,
          body: {
            error: err.message,
            detail:
              "this channel is configured to refuse a hybrid PDF whose embedded invoice cannot be read, rather than fall back to reading the document as an image",
          },
        };
      }
      // 'fallback' — degrade to the image path, which does not exist
      // yet. Reported honestly as unimplemented rather than silently
      // succeeding with nothing extracted.
      await recordCaptureEvent(db, channelId, "rejected", `${err.message} (fallback to image extraction not yet built)`, null);
      return {
        status: 501,
        body: {
          error: err.message,
          detail: "this channel would fall back to image extraction, which is not built yet",
        },
      };
    }
    throw err;
  }

  if (attachment === null) {
    // An ordinary PDF with no embedded invoice at all — a scan or a
    // photo. It genuinely needs a vision model, but a PDF cannot be
    // rasterised to an image inside a Worker (no native renderer, and
    // PDF.js needs a canvas workerd does not provide), so the image
    // path cannot be reached from here. Reported honestly rather than
    // pretending: capture-image accepts JPEG/PNG/WebP directly today.
    await recordCaptureEvent(db, channelId, "rejected", "image-only PDF; rasterisation not available in a Worker", null);
    return {
      status: 501,
      body: {
        error:
          "this PDF carries no embedded invoice, so it would need image extraction — but a PDF cannot be converted to an image inside a Worker. Submit the page as a JPEG or PNG to /capture-image instead.",
      },
    };
  }

  // From here the document is indistinguishable from a directly
  // submitted UBL invoice, and is handled by exactly the same path —
  // never a second, parallel implementation of the same parsing.
  const result = await handleCaptureUblXml(db, channelId, attachment.xml, idOverride);
  if (result.status === 201) {
    result.body = { ...result.body, documentPath: "hybrid-embedded-xml", attachmentFilename: attachment.filename };
  }
  return result;
}

/**
 * Captures a photographed or scanned invoice — decision 0043.
 *
 * The last of the three intake paths, and the only one that infers
 * rather than parses. Deliberately a separate endpoint from
 * capture-pdf rather than a fallback inside it: a caller submitting an
 * image knows they are submitting an image, and the difference
 * between exact and best-effort data should be explicit at the point
 * of submission, not discovered afterwards.
 */
export async function handleCaptureImage(
  db: D1Database,
  channelId: string,
  bytes: Uint8Array,
  model: ExtractionModel,
  idOverride?: string
): Promise<RouteResult> {
  const channel = await db.prepare("SELECT id FROM intake_channels WHERE id = ?").bind(channelId).first();
  if (!channel) {
    return { status: 404, body: { error: `intake channel ${channelId} does not exist` } };
  }

  if (looksLikePdf(bytes)) {
    // A real mistake worth catching explicitly: a PDF sent here would
    // skip the embedded-XML check entirely and go straight to a
    // model, which for a hybrid invoice would silently substitute
    // inferred data for mandate-grade data (decision 0042).
    await recordCaptureEvent(db, channelId, "rejected", "PDF submitted to the image endpoint", null);
    return {
      status: 422,
      body: {
        error:
          "this is a PDF, not an image — submit it to /capture-pdf, which checks for an embedded invoice first rather than reading the document as a picture",
      },
    };
  }

  if (!sniffImageType(bytes)) {
    await recordCaptureEvent(db, channelId, "rejected", "unsupported image format", null);
    return { status: 422, body: { error: "unsupported image format — expected JPEG, PNG or WebP" } };
  }

  // The customer's own declared fields are asked for alongside the
  // standard ones (decision 0041) — resolved here, at the edge, the
  // same as the compile path.
  const customFields = await loadCustomFields(db);
  const vocabulary = resolveVocabulary("invoice", customFields);

  let extraction;
  try {
    extraction = await extractInvoiceFromImage(model, bytes, vocabulary);
  } catch (err) {
    if (err instanceof ExtractionRefusal) {
      // A refusal, never a half-populated invoice: the compiler's own
      // discipline, applied to extraction.
      await recordCaptureEvent(db, channelId, "rejected", err.message, null);
      return {
        status: 422,
        body: {
          error: err.message,
          // The raw model output, truncated. ExtractionRefusal has
          // always carried this and the route discarded it — which
          // meant a refusal said WHAT went wrong and never WHAT CAME
          // BACK. Diagnosing a real multi-page failure took a
          // code change purely to see the thing the error already
          // held.
          rawModelOutput: err.rawModelOutput?.slice(0, 2000),
        },
      };
    }
    throw err;
  }

  const { facts, lines: extractedLines, linesTruncated, confidence, missingFields } = extraction;
  const id = idOverride ?? crypto.randomUUID();

  const result = await handleCaptureIntake(db, channelId, {
    id,
    invoiceNumber: facts["BT-1"] as string | undefined,
    issueDate: facts["BT-2"] as string | undefined,
    currency: facts["BT-5"] as string | undefined,
    supplierVatId: facts["BT-31"] as string | undefined,
    totalWithVat: facts["BT-112"] as number | undefined,
    facts,
    // Real extracted lines, in the same canonical shape the UBL path
    // produces — which is what lets validation's line-sum check run
    // against an image-captured invoice at all.
    lines: extractedLines,
  });

  if (result.status === 201) {
    // Surfaced explicitly rather than buried in facts: a caller must
    // be able to tell at a glance that this data was inferred, how
    // confident the model was, and what it could not read.
    result.body = {
      ...result.body,
      documentPath: "image-extraction",
      confidence,
      missingFields,
      lineCount: extractedLines.length,
      // Surfaced rather than swallowed: a truncated line list would
      // make validation's line-sum check report a mismatch that says
      // nothing about the document.
      linesTruncated,
    };
  }
  return result;
}

/**
 * Finalises a multi-page document: reads every page in order,
 * extracts once across all of them, and produces a real invoice.
 *
 * Deliberately a separate step from uploading. Pages arrive when they
 * arrive; extraction happens when the operator says the document is
 * complete — because a model asked to read half an invoice reports
 * exactly what it can see and nothing about what it cannot.
 */
export async function handleFinalisePendingDocument(
  db: D1Database,
  storage: PendingDocumentStorage,
  documentId: string,
  model: ExtractionModel,
  idOverride?: string
): Promise<RouteResult> {
  // R2 reads can fail, and this runs before the extraction try/block —
  // so without its own guard a storage error escapes as a Worker
  // exception rather than a response. Same class of gap as the model
  // call: anything that can throw between the request and the
  // response has to be turned into one.
  let loaded;
  try {
    loaded = await loadPendingPages(db, storage, documentId);
  } catch (err) {
    return {
      status: 502,
      body: { error: `the document's stored pages could not be read: ${String(err).slice(0, 300)}` },
    };
  }
  if (!loaded.ok) return loaded.response;
  const { pages, channelId } = loaded.result;

  const customFields = await loadCustomFields(db);
  const vocabulary = resolveVocabulary("invoice", customFields);

  let extraction;
  try {
    extraction = await extractInvoiceFromImages(model, pages, vocabulary);
  } catch (err) {
    if (err instanceof ExtractionRefusal) {
      await recordCaptureEvent(db, channelId, "rejected", err.message, null);
      return {
        status: 422,
        body: {
          error: err.message,
          // The raw model output, truncated. ExtractionRefusal has
          // always carried this and the route discarded it — which
          // meant a refusal said WHAT went wrong and never WHAT CAME
          // BACK. Diagnosing a real multi-page failure took a
          // code change purely to see the thing the error already
          // held.
          rawModelOutput: err.rawModelOutput?.slice(0, 2000),
        },
      };
    }
    throw err;
  }

  const { facts, lines: extractedLines, linesTruncated, confidence, missingFields } = extraction;
  const id = idOverride ?? crypto.randomUUID();

  const result = await handleCaptureIntake(db, channelId, {
    id,
    invoiceNumber: facts["BT-1"] as string | undefined,
    issueDate: facts["BT-2"] as string | undefined,
    currency: facts["BT-5"] as string | undefined,
    supplierVatId: facts["BT-31"] as string | undefined,
    totalWithVat: facts["BT-112"] as number | undefined,
    facts,
    lines: extractedLines,
  });

  if (result.status === 201) {
    // Only marked finalised once an invoice genuinely exists. A
    // failed capture leaves the document open and re-finalisable,
    // rather than stranding its pages against nothing.
    await markFinalised(db, documentId, id);
    result.body = {
      ...result.body,
      documentPath: "image-extraction",
      pageCount: pages.length,
      confidence,
      missingFields,
      lineCount: extractedLines.length,
      linesTruncated,
    };
  }
  return result;
}

/**
 * Real analytics, not just "query D1 directly" — volume and exception
 * counts per channel for a process, the explicit ask this decision
 * was built around. Detailed exception reasons per event are
 * deliberately left to a direct query for now, matching the "raw API
 * for now" precedent already used throughout this project.
 */
export async function handleIntakeStats(db: D1Database, processId: string): Promise<RouteResult> {
  const processExists = await db.prepare("SELECT id FROM processes WHERE id = ?").bind(processId).first();
  if (!processExists) {
    return { status: 404, body: { error: `process ${processId} does not exist` } };
  }

  const rows = await db
    .prepare(
      `SELECT ic.id AS channel_id, ic.name AS channel_name,
              SUM(CASE WHEN ice.outcome = 'accepted' THEN 1 ELSE 0 END) AS accepted,
              SUM(CASE WHEN ice.outcome = 'rejected' THEN 1 ELSE 0 END) AS rejected
       FROM intake_channels ic
       LEFT JOIN intake_capture_events ice ON ice.channel_id = ic.id
       WHERE ic.process_id = ?
       GROUP BY ic.id, ic.name
       ORDER BY ic.name`
    )
    .bind(processId)
    .all<{ channel_id: string; channel_name: string; accepted: number; rejected: number }>();

  return {
    status: 200,
    body: {
      processId,
      channels: rows.results.map((r) => ({
        channelId: r.channel_id,
        channelName: r.channel_name,
        accepted: r.accepted,
        rejected: r.rejected,
      })),
    },
  };
}
