import type { RouteResult } from "./examples-route.js";

/**
 * Where an invoice has been, and how long it took — decision 0151.
 *
 * The operator's own idea, from the rules screen's chevrons:
 *
 * > It might be a good idea to include the very same display at the head
 * > of the invoice viewer, with the current stage highlighted... Enter
 * > and Leave timestamps, so it's clear the progression through the
 * > process, and also the duration at each stage.
 *
 * **Nothing had to be recorded for this.** `stage_visits` has held a
 * timestamp per visit since decision 0009; the *leaving* time is the
 * next visit's arrival, and the duration is the gap between them.
 *
 * So the data existed and nobody had asked it this question.
 */

interface VisitRow {
  stage_id: string;
  outcome: string;
  created_at: string;
}

/**
 * How long, in words rather than milliseconds.
 *
 * **The unit a person would use.** Four days is "4 days"; forty minutes
 * is "40m". Somebody scanning a row wants to know whether a stage took
 * a moment or a fortnight, and a precise figure in seconds answers a
 * question nobody asked.
 */
function durationBetween(from: string, to: string): string | null {
  // **Milliseconds where they exist** — decision 0152. Visits recorded
  // before this carry second resolution and parse just as well; the
  // fractional part is simply absent.
  const ms = Date.parse(to.replace(" ", "T") + "Z") - Date.parse(from.replace(" ", "T") + "Z");
  if (!Number.isFinite(ms) || ms < 0) return null;

  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;

  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export async function handleInvoiceProgress(
  db: D1Database,
  invoiceId: string
): Promise<RouteResult> {
  const instance = await db
    .prepare(
      `SELECT id, process_id, current_stage_id, status, created_at, process_version
       FROM process_instances
       WHERE subject_type = 'invoice' AND subject_id = ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .bind(invoiceId)
    .first<{
      id: string;
      process_id: string;
      current_stage_id: string;
      status: string;
      created_at: string;
      process_version: number;
    }>();

  if (!instance) {
    // **A real state, not a failure.** An invoice captured outside a
    // process has no path to show, and saying so is better than an
    // empty row of chevrons implying it has not started.
    return { status: 200, body: { inProcess: false, stages: [] } };
  }

  const stages = await db
    .prepare(
      /**
       * The stages of the version **this invoice** runs under —
       * decision 0150.
       *
       * Not the process's current shape: an invoice that started before
       * a stage was removed still passed through it, and a timeline
       * showing today's stages would lose where it has been.
       */
      `SELECT s.id, s.name, v.sequence
       FROM process_stage_versions v
       JOIN process_stages s ON s.id = v.stage_id
       WHERE v.process_id = ? AND v.version = ?
       ORDER BY v.sequence`
    )
    .bind(instance.process_id, instance.process_version)
    .all<{ id: string; name: string; sequence: number }>();

  /**
   * **Ordered by `rowid`, not by timestamp** — decision 0152.
   *
   * `created_at` defaults to `datetime('now')`, which has **one-second
   * resolution**. An invoice passing Intake and Approval automatically
   * does both within the same second, so the timestamps are equal and
   * `ORDER BY created_at, id` falls back to ordering by a **UUID** —
   * effectively at random.
   *
   * Found on a real invoice: Intake read *"here since"* and Approval
   * read *"under a minute"*, with Approval marked current. The visits
   * had been read in the wrong order, so each stage was timed against
   * the wrong neighbour.
   *
   * **`rowid` is insertion order**, which is the actual order of
   * visits. The timestamp is an approximation of it, and straight-
   * through processing is exactly where the approximation fails.
   */
  const visits = await db
    .prepare(
      `SELECT stage_id, outcome, created_at FROM stage_visits
       WHERE process_instance_id = ? ORDER BY rowid`
    )
    .bind(instance.id)
    .all<VisitRow>();

  return {
    status: 200,
    body: {
      inProcess: true,
      currentStageId: instance.current_stage_id,
      status: instance.status,
      stages: stages.results.map((stage) => {
        const own = visits.results.filter((v) => v.stage_id === stage.id);
        const isCurrent = stage.id === instance.current_stage_id;

        if (own.length === 0) {
          // Ahead of the document. Named rather than omitted, because
          // the sequence is the point: somebody needs to see what is
          // still to come.
          return { id: stage.id, name: stage.name, state: "ahead" };
        }

        /**
         * **Every visit, not the latest** — the operator's refinement:
         *
         * > If a process stage is returned to, we do not need another
         * > box in the flow — we simply add another entry and exit
         * > timestamp in the same stage box.
         *
         * One box per stage, and a stage entered twice took time twice.
         * The second time is often the interesting one: it is what
         * happened after somebody sent the document back.
         */
        const periods = own.map((visit) => {
          const next = visits.results[visits.results.indexOf(visit) + 1];
          return {
            enteredAt: visit.created_at,
            // **Null while it is still here.** Leaving is the next
            // visit's arrival, so a stage nothing followed has not been
            // left.
            leftAt: next?.created_at ?? null,
            duration: next ? durationBetween(visit.created_at, next.created_at) : null,
            outcome: visit.outcome,
          };
        });

        return {
          id: stage.id,
          name: stage.name,
          state: isCurrent ? "here" : "behind",
          periods,
          // Carried alongside because the row does not want to compute
          // it, and "2 visits" is a fact a screen may want to say
          // without reading the array.
          visitCount: periods.length,
        };
      }),
    },
  };
}
