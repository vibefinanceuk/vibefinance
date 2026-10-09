import type { ExtractionModel } from "./extraction.js";
import type { PageShrinker } from "./page-shrink.js";
import {
  captureAttachmentPart,
  markReceiving,
  recordArrival,
} from "./inbound-email.js";
import {
  addRouteEvent,
  setPartOutcome,
  type StoredPart,
} from "./route-messages.js";
import { settleInbound } from "./route-reprocess.js";

/**
 * **Reading what was accepted — decision 0687.**
 *
 * An emailed message is stored and accepted at once (`readLater`), and
 * its attachments are read here, on the five-minute cron, where a run
 * may take minutes rather than the sender's patience. Reading five
 * scanned PDFs inside the email handler took longer than the sending
 * server waited, so it sent the same email again every five minutes,
 * and each copy made the same invoices again.
 *
 * - **One reader at a time.** A message is claimed with a lease
 *   (`reading_until`), renewed before each attachment, so two runs never
 *   read the same message at once.
 * - **Picks up where it stopped.** Only attachments with no outcome, and
 *   none that already made an invoice, are read; a run cut short leaves
 *   the rest to the next.
 * - **Gives up honestly.** A message claimed `MAX_READS` times without
 *   finishing has its unread attachments failed, with why, and is settled
 *   like any other — partly delivered or failed, and so alerted (0559)
 *   and open to Reprocess. Nothing is retried forever.
 */
export interface ReadLaterDeps {
  model: ExtractionModel;
  bucket?: R2Bucket;
  customerId?: string;
  onFinished?: (messageId: string) => Promise<void>;
  /** Decision 0690: makes a scan's pages smaller before reading. */
  shrink?: PageShrinker;
}

/** How long a claim holds without being renewed: longer than one attachment can take. */
const LEASE_MS = 10 * 60 * 1000;
/** A run starts no new attachment after this long, so it ends well inside the cron's 15 minutes. */
const RUN_BUDGET_MS = 6 * 60 * 1000;
/** Decision 0696: a message waiting for the AI allowance is tried again this long after 00:00 UTC. */
const RESUME_AFTER_RESET_MS = 5 * 60 * 1000;

/** The next 00:00 UTC after `at`, in milliseconds. */
export function nextUtcMidnight(at: number): number {
  const d = new Date(at);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

/** Claims before a message's unread attachments are failed. */
export const MAX_READS = 3;

export async function readQueuedInbound(
  db: D1Database,
  deps: ReadLaterDeps,
  opts: { budgetMs?: number; now?: () => number } = {},
): Promise<{ read: string[]; settled: string[] }> {
  const now = opts.now ?? (() => Date.now());
  const deadline = now() + (opts.budgetMs ?? RUN_BUDGET_MS);
  const read: string[] = [];
  const settled: string[] = [];
  if (!deps.bucket) return { read, settled };

  const queued = (
    await db
      .prepare(
        `SELECT id FROM route_messages
         WHERE direction = 'in' AND status = 'received' AND read_queued_at IS NOT NULL
           AND (reading_until IS NULL OR reading_until < ?)
         ORDER BY received_at LIMIT 20`,
      )
      .bind(new Date(now()).toISOString())
      .all<{ id: string }>()
  ).results;

  for (const { id } of queued) {
    if (now() >= deadline) break;
    // The claim: only one run's UPDATE finds the lease free.
    const claim = await db
      .prepare(
        `UPDATE route_messages SET reading_until = ?, read_count = read_count + 1
         WHERE id = ? AND status = 'received' AND (reading_until IS NULL OR reading_until < ?)`,
      )
      .bind(
        new Date(now() + LEASE_MS).toISOString(),
        id,
        new Date(now()).toISOString(),
      )
      .run();
    if ((claim.meta?.changes ?? 0) !== 1) continue;
    read.push(id);
    const done = await readOne(db, id, deps, deadline, now);
    if (done === "settled") settled.push(id);
    // Decision 0696: no allowance left, so nothing else can be read this run either.
    if (done === "deferred") break;
  }
  return { read, settled };
}

async function readOne(
  db: D1Database,
  id: string,
  deps: ReadLaterDeps,
  deadline: number,
  now: () => number,
): Promise<"settled" | "stopped" | "deferred"> {
  const m = await db
    .prepare(
      "SELECT instance_id, counterparty, recipient, read_count FROM route_messages WHERE id = ?",
    )
    .bind(id)
    .first<{
      instance_id: string;
      counterparty: string | null;
      recipient: string | null;
      read_count: number;
    }>();
  if (!m) return "stopped";
  const parts = (
    await db
      .prepare(
        "SELECT seq, filename, r2_key, outcome FROM route_message_parts WHERE message_id = ? AND role = 'attachment' ORDER BY seq",
      )
      .bind(id)
      .all<{
        seq: number;
        filename: string;
        r2_key: string;
        outcome: string | null;
      }>()
  ).results;
  const alreadyMade = new Set(
    (
      await db
        .prepare(
          "SELECT part_seq FROM route_message_items WHERE message_id = ? AND part_seq IS NOT NULL",
        )
        .bind(id)
        .all<{ part_seq: number }>()
    ).results.map((r) => r.part_seq),
  );
  const toRead = parts.filter(
    (p) => p.outcome === null && !alreadyMade.has(p.seq),
  );
  const giveUp = m.read_count > MAX_READS;
  if (m.read_count > 1) {
    await addRouteEvent(db, id, giveUp ? "read_given_up" : "read_resumed", {
      detail: `${toRead.length} of ${parts.length} attachments left`,
    });
  }

  for (const part of toRead) {
    if (giveUp) {
      await setPartOutcome(
        db,
        id,
        part.seq,
        "failed",
        `not read after ${MAX_READS} tries`,
      );
      continue;
    }
    if (now() >= deadline) {
      // Stopped for time: the lease is let go, and the next run carries on.
      await db
        .prepare("UPDATE route_messages SET reading_until = NULL WHERE id = ?")
        .bind(id)
        .run();
      return "stopped";
    }
    await db
      .prepare("UPDATE route_messages SET reading_until = ? WHERE id = ?")
      .bind(new Date(now() + LEASE_MS).toISOString(), id)
      .run();
    const object = await deps.bucket!.get(part.r2_key);
    if (!object) {
      await setPartOutcome(
        db,
        id,
        part.seq,
        "failed",
        "the stored file is missing",
      );
      continue;
    }
    const stored: StoredPart = {
      routeMessageId: id,
      partSeq: part.seq,
      r2Key: part.r2_key,
    };
    try {
      const outcome = await captureAttachmentPart(db, {
        messageId: id,
        sourceId: m.instance_id,
        seq: part.seq,
        filename: part.filename,
        bytes: new Uint8Array(await object.arrayBuffer()),
        stored,
        model: deps.model,
        bucket: deps.bucket,
        customerId: deps.customerId,
        sender: m.counterparty ?? undefined,
        shrink: deps.shrink,
      });
      /**
       * **Waiting for the AI allowance — decision 0696.** Nothing more can
       * be read today, here or in any other message. This one is held
       * until just after 00:00 UTC (the lease), its read does not count
       * towards MAX_READS, and the run stops.
       */
      if (outcome.deferred) {
        const resume = nextUtcMidnight(now()) + RESUME_AFTER_RESET_MS;
        await db
          .prepare("UPDATE route_messages SET reading_until = ?, read_count = max(0, read_count - 1) WHERE id = ?")
          .bind(new Date(resume).toISOString(), id)
          .run();
        await addRouteEvent(db, id, "read_deferred", { detail: `${outcome.why ?? "the AI allowance for today is used up"}`.slice(0, 300) });
        return "deferred";
      }
    } catch (err) {
      // An attachment that throws is failed with why, rather than tried again every five minutes.
      await setPartOutcome(
        db,
        id,
        part.seq,
        "failed",
        String(err).slice(0, 300),
      );
    }
  }

  // Every attachment has an outcome: the message is settled as receiving would have settled it.
  const outcomes = (
    await db
      .prepare(
        "SELECT filename, outcome, reason FROM route_message_parts WHERE message_id = ? AND role = 'attachment' ORDER BY seq",
      )
      .bind(id)
      .all<{
        filename: string;
        outcome: string | null;
        reason: string | null;
      }>()
  ).results;
  const reasons = outcomes
    .filter((o) => o.outcome !== "captured")
    .map((o) => (o.reason ? `${o.filename}: ${o.reason}` : o.filename));
  const status = await settleInbound(db, id, outcomes.length, reasons);
  await db
    .prepare("UPDATE route_messages SET reading_until = NULL WHERE id = ?")
    .bind(id)
    .run();
  const captured = outcomes.length - reasons.length;
  await recordArrival(db, {
    sender: m.counterparty ?? "",
    recipient: m.recipient ?? "",
    sourceId: m.instance_id,
    outcome: captured > 0 ? "captured" : "rejected",
    reason:
      captured > 0 ? null : reasons.join(" · ").slice(0, 500) || "unreadable",
    attachments: outcomes.length,
    captured,
  });
  if (captured > 0) await markReceiving(db, m.instance_id);
  if (deps.onFinished) {
    try {
      await deps.onFinished(id);
    } catch {
      // Deliberately silent, as when receiving.
    }
  }
  return status !== "received" ? "settled" : "stopped";
}
