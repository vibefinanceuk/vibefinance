import { unitsWherePermitted, scopedToChosenOrg, unitClause, type Scope } from "./enforce.js";
import type { RouteResult } from "./org-route.js";

/**
 * Team throughput by stage — decision 0415, the first route to read
 * back `AP.Analysis` (`permissions.ts`), reserved since before this
 * bundle and never previously read by anything.
 *
 * **What "throughput" means here.** Not the current queue (that is
 * `dashboard-route.ts`'s `where_things_are`), but work actually
 * finished — `status = 'completed'` — in the last 7 days, credited to
 * whoever completed it (`completed_by`) and to the stage the task sat
 * at. The same shape `dashboard-route.ts`'s `done()` already uses for
 * one person's own week, widened here to every user the caller may
 * see, because this is a manager's screen, not a personal one.
 *
 * **Scoped the same way as every other analysis query** — `unitClause`
 * against the invoice's own org unit, computed from `AP.Analysis`
 * rather than `AP.Review`. A manager sees throughput only for the
 * units their role actually covers.
 */

const MAX_CHART_COLOURS = 5;

interface StageRow {
  user_id: string;
  user_name: string | null;
  stage_id: string;
  stage_name: string;
  sequence: number;
  process_id: string;
  n: number;
}

interface StageCount {
  process_id: string;
  n: number;
}

/**
 * **Any number of real stages folded onto a fixed chart budget.**
 *
 * `tokens.css` caps categorical chart colours at 5 — "a chart needing
 * a sixth is a chart needing a table" — but `process_stages` is
 * customer data (decision 0008): one customer's process can have any
 * number of stages, and this route cannot hardcode a particular
 * customer's stage names.
 *
 * So the merge is positional, not nominal: a stage's `sequence` within
 * its own process maps onto one of 5 buckets by where it falls
 * proportionally — `ceil(sequence * 5 / totalStages)`. A process with
 * 5 or fewer stages gets one bucket per stage (the formula is
 * strictly increasing for `sequence <= totalStages <= 5`, so nothing
 * merges that does not have to). A process with more — the seeded
 * `ap-live` process has 7 (`docs/operations/ap-live-process-
 * definition.sql`) — folds proportionally: for 7 stages this puts
 * Matching (3) and Coding (4) in one bucket and Review (6) and
 * Payment-eligible (7) in another, which is also the natural reading
 * of those stages ("both booking-adjacent", "both after the money is
 * committed") rather than an arbitrary cut.
 */
function bucketOf(sequence: number, totalStages: number): number {
  const raw = Math.ceil((sequence * MAX_CHART_COLOURS) / Math.max(totalStages, 1));
  return Math.min(Math.max(raw, 1), MAX_CHART_COLOURS);
}

/**
 * **A bucket's label is built from the real stage names it holds**,
 * never a hardcoded merge — the same reason the bucketing itself is
 * positional. One stage keeps its own name; two join with "&"; more
 * than two join with commas so the label stays readable rather than
 * growing without bound.
 */
function labelFor(stageNames: string[]): string {
  if (stageNames.length === 1) return stageNames[0];
  if (stageNames.length === 2) return stageNames.join(" & ");
  return `${stageNames.slice(0, -1).join(", ")} & ${stageNames[stageNames.length - 1]}`;
}

async function scopeFor(db: D1Database, userId: string, currentOrg: string | null): Promise<Scope> {
  const held = await unitsWherePermitted(db, userId, "AP.Analysis");
  const scoped = await scopedToChosenOrg(db, held, currentOrg);
  return { units: scoped };
}

export interface WorkloadBucket {
  bucket: number;
  label: string;
  n: number;
}

export interface WorkloadUser {
  userId: string;
  userName: string;
  total: number;
  buckets: WorkloadBucket[];
}

export interface WorkloadThroughput {
  users: WorkloadUser[];
  legend: WorkloadBucket[];
}

/**
 * **Team throughput, by user, stacked by stage** — the first real
 * caller of `AP.Analysis`, and the data behind the Workload screen's
 * "Throughput by user" chart.
 *
 * `limit` bounds how many users come back, ranked by total completed
 * — the same "top N, not everyone" shape the design's mock-up used,
 * so a large team does not return hundreds of near-empty bars.
 */
export async function handleWorkloadThroughput(
  db: D1Database,
  userId: string,
  currentOrg: string | null = null,
  limit = 10
): Promise<RouteResult> {
  const scope = await scopeFor(db, userId, currentOrg);
  const clause = unitClause(scope, "h.org_unit_id");

  const rows = await db
    .prepare(
      `SELECT t.completed_by AS user_id, u.name AS user_name,
              s.id AS stage_id, s.name AS stage_name, s.sequence, s.process_id,
              count(*) AS n
       FROM tasks t
       JOIN process_stages s ON s.id = t.stage_id
       LEFT JOIN org_users u ON u.id = t.completed_by
       LEFT JOIN stage_visits v ON v.id = t.stage_visit_id
       LEFT JOIN process_instances pi ON pi.id = v.process_instance_id
       LEFT JOIN invoice_headers h ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
       WHERE t.status = 'completed'
         AND t.completed_by IS NOT NULL
         AND julianday('now') - julianday(t.completed_at) < 7
         ${clause.sql}
       GROUP BY t.completed_by, s.id`
    )
    .bind(...clause.binds)
    .all<StageRow>();

  if (rows.results.length === 0) {
    return { status: 200, body: { users: [], legend: [] } };
  }

  const processIds = [...new Set(rows.results.map((r) => r.process_id))];
  const placeholders = processIds.map(() => "?").join(", ");
  const stageCounts = await db
    .prepare(`SELECT process_id, count(*) AS n FROM process_stages WHERE process_id IN (${placeholders}) GROUP BY process_id`)
    .bind(...processIds)
    .all<StageCount>();
  const totalStagesByProcess = new Map(stageCounts.results.map((r) => [r.process_id, r.n]));

  /**
   * `bucketStageNames`: which real stage names fell into each bucket
   * number, across every process seen, each kept beside the sequence
   * it arrived at — used only to build the legend's labels
   * (`labelFor`), never to decide the bucketing itself.
   *
   * **Ordered by sequence, not by arrival.** The first version kept a
   * `Set<string>` and relied on insertion order, which was really SQL
   * row order — `GROUP BY t.completed_by, s.id` groups by the stage's
   * own id, alphabetically, not by where it falls in the process. For
   * `ap-live`'s own bucket 3 that read "Coding & Matching" — arriving
   * in `id` order — rather than "Matching & Coding," the process's
   * own order and the only one `labelFor`'s doc comment ever promised.
   */
  const bucketStageNames = new Map<number, Map<string, number>>();
  const bucketMinSequence = new Map<number, number>();
  const byUser = new Map<string, { userName: string; buckets: Map<number, number> }>();

  for (const row of rows.results) {
    const totalStages = totalStagesByProcess.get(row.process_id) ?? row.sequence;
    const bucket = bucketOf(row.sequence, totalStages);

    if (!bucketStageNames.has(bucket)) bucketStageNames.set(bucket, new Map());
    bucketStageNames.get(bucket)!.set(row.stage_name, row.sequence);
    bucketMinSequence.set(bucket, Math.min(bucketMinSequence.get(bucket) ?? Infinity, row.sequence));

    if (!byUser.has(row.user_id)) {
      byUser.set(row.user_id, { userName: row.user_name ?? row.user_id, buckets: new Map() });
    }
    const user = byUser.get(row.user_id)!;
    user.buckets.set(bucket, (user.buckets.get(bucket) ?? 0) + row.n);
  }

  const bucketOrder = [...bucketMinSequence.entries()].sort((a, b) => a[1] - b[1]).map(([bucket]) => bucket);

  function stageNamesInOrder(bucket: number): string[] {
    const named = bucketStageNames.get(bucket);
    if (!named) return [];
    return [...named.entries()].sort((a, b) => a[1] - b[1]).map(([name]) => name);
  }

  const legend: WorkloadBucket[] = bucketOrder.map((bucket) => ({
    bucket,
    label: labelFor(stageNamesInOrder(bucket)),
    n: [...byUser.values()].reduce((sum, u) => sum + (u.buckets.get(bucket) ?? 0), 0),
  }));

  const users: WorkloadUser[] = [...byUser.entries()]
    .map(([userId, u]) => {
      const buckets = bucketOrder
        .map((bucket) => ({
          bucket,
          label: labelFor(stageNamesInOrder(bucket)),
          n: u.buckets.get(bucket) ?? 0,
        }))
        .filter((b) => b.n > 0);
      return {
        userId,
        userName: u.userName,
        total: buckets.reduce((sum, b) => sum + b.n, 0),
        buckets,
      };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);

  return { status: 200, body: { users, legend } satisfies WorkloadThroughput };
}
