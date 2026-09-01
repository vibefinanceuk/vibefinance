import type { InvoiceFacts } from "@vibefinance/shared";
import type { RouteResult } from "./org-route.js";
import { handleUpsertInvoice, mergeStructuredInvoiceFacts } from "./invoice-facts-route.js";
import { handleCreateProcessInstance, visitCurrentStage } from "./workflow-engine.js";

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

  // Store facts, reusing handleUpsertInvoice's own logic exactly —
  // including duplicate-confidence scoring (decision 0028) for free.
  // mandate.channel defaults to the channel's own name, the caller
  // never needs to supply it separately, unless explicitly overridden.
  const upsertResult = await handleUpsertInvoice(db, {
    ...body,
    id,
    mandateChannel: (mandateChannel as string) ?? channel.name,
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
  const lines = body.lines as Array<InvoiceFacts & { lineNumber: number }> | undefined;
  const visitResult = await visitCurrentStage(db, instanceId, mergedFacts, lines);

  return {
    status: 201,
    body: {
      instanceId,
      channelId,
      processId: channel.process_id,
      visit: visitResult.body,
    },
  };
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
