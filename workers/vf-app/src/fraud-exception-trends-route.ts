import { unitsWherePermitted, scopedToChosenOrg, unitClause } from "./enforce.js";
import { mondayOfThisWeek } from "./dates.js";
import type { RouteResult } from "./org-route.js";

/**
 * Exceptions by type, by user, by supplier — trended — decision 0423,
 * Fraud Prevention's third real metric (the design's own fifth bullet
 * under Screen 3 — Fraud & Risk Detection's key metrics: *"Exceptions
 * by type, by user, by supplier — trended, so a rising exception rate
 * from one supplier or one user is visible before it is a pattern."*).
 *
 * **An exception is what `stage_visits.validation_passed = 0` already
 * means** — decision 0021's own persisted verdict, the same
 * definition `dashboard-route.ts`'s `exceptionsBySupplier` card and
 * decision 0421's own `supplier-exceptions-route.ts` already use. Not
 * a new detection concept.
 *
 * **This is a genuinely new metric, not a re-listing of decision
 * 0421's own supplier-exceptions card.** That one lives on Supplier
 * Performance, gated `AP.Supplier`, scoped by the supplier's own org
 * unit, and reports one aggregate rate per supplier over 90 days. This
 * one lives on Fraud Prevention, gated `AP.FraudReview`, scoped by the
 * invoice's own org unit (the same rule decision 0420's duplicates
 * route already established — the only one available here, since an
 * unmatched invoice has no `supplier_id`), and its entire point is the
 * trend: a per-week count so a reviewer can *see* a supplier, a type,
 * or a user rising, rather than reading one static number. It also
 * adds a breakdown 0421 never attempted — by user.
 *
 * **Trended as weekly counts, not weekly rates.** A rate computed on a
 * single week's small denominator (a handful of visits) would be
 * noisy enough to mislead — one exception out of one visit reads as
 * "100% this week." A plain count avoids inventing a threshold or
 * smoothing this data does not honestly support; the design's own
 * words ask only that a rise be *visible*, which a rising bar in a
 * sparkline already shows without this route deciding for the viewer
 * what counts as "rising."
 *
 * **Eight calendar weeks, Monday-anchored** — `dates.ts`'s own
 * `mondayOfThisWeek()`, the same "calendar week, not a rolling seven
 * days" convention decision 0265 already established, stepped back
 * seven times. Long enough to show a real trend, the same "a season,
 * not a week" reasoning decision 0421 gave its own 90-day window;
 * short enough that eight points make a legible sparkline.
 *
 * **`charts.js`'s own `sparkline()`, its first real caller.** Built by
 * decisions 0242/0265 and left deliberately unused since — "it stays
 * in `charts.js`, tested, for whichever card next has a real trend and
 * no room to show it plainly." This is that card.
 *
 * **By supplier and by type count the exception itself, once per
 * visit — by user counts completed review tasks, not exceptions.** A
 * failing visit can spawn more than one task, one per matching line,
 * `workflow-engine.ts`'s own documented behaviour ("different lines
 * can genuinely need different approvers"). Crediting each completed
 * task to whoever completed it is the identical unit
 * `workload-route.ts`'s own throughput already counts by — so a visit
 * with three line-level tasks finished by three different people
 * credits each of them once. That means `byUser`'s own totals answer
 * "how much exception-handling work has this person done," not "how
 * many exceptions," and can legitimately exceed the exception count a
 * supplier or type breakdown would show for the same window — a real
 * difference in what each breakdown measures, not a double-count bug.
 * An exception whose task nobody has completed yet — including one
 * still open — carries no user credit at all; `bySupplier`/`byType`
 * still count it.
 *
 * **Supplier grouping keeps the unmatched bucket honest rather than
 * fragmenting it.** An invoice with no matched supplier
 * (`supplier_id IS NULL`) groups into one shared entry
 * (`supplierId: null`) rather than one entry per printed name — the
 * same reasoning decision 0420 already gives for treating a printed
 * name as a raw fallback, not a stable identity to group or trend by.
 * The UI names that entry, this route only reports it.
 */

const TREND_WEEKS = 8;
const TOP_SUPPLIERS = 8;
const TOP_USERS = 8;
const TOP_TYPES = 6;

/** The Monday of each of the last `TREND_WEEKS` calendar weeks, oldest first, ending at the current week. */
function weekStarts(now: Date = new Date()): string[] {
  const thisMonday = mondayOfThisWeek(now);
  const anchor = new Date(`${thisMonday}T00:00:00Z`);
  return Array.from({ length: TREND_WEEKS }, (_, i) => {
    const d = new Date(anchor);
    d.setUTCDate(d.getUTCDate() - (TREND_WEEKS - 1 - i) * 7);
    return d.toISOString().slice(0, 10);
  });
}

/** Which bucket a timestamp's own date falls into, clamped to the window — the SQL side already excludes anything earlier. */
function weekIndexFor(day: string, starts: string[]): number {
  const first = new Date(`${starts[0]}T00:00:00Z`).getTime();
  const at = new Date(`${day}T00:00:00Z`).getTime();
  const idx = Math.floor((at - first) / (7 * 86400000));
  return Math.min(Math.max(idx, 0), starts.length - 1);
}

interface ExceptionRow {
  created_at: string;
  validation_failures: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
}

interface UserRow {
  created_at: string;
  user_id: string;
  user_name: string | null;
}

export interface SupplierExceptionTrend {
  supplierId: string | null;
  supplierName: string | null;
  total: number;
  weeklyCounts: number[];
}

export interface UserExceptionTrend {
  userId: string;
  userName: string | null;
  total: number;
  weeklyCounts: number[];
}

export interface TypeExceptionTrend {
  type: string;
  total: number;
  weeklyCounts: number[];
}

export interface FraudExceptionTrendsReport {
  weekStartDates: string[];
  bySupplier: SupplierExceptionTrend[];
  byUser: UserExceptionTrend[];
  byType: TypeExceptionTrend[];
}

function bump(counts: number[], idx: number): number[] {
  const next = [...counts];
  next[idx] += 1;
  return next;
}

export async function handleFraudExceptionTrends(
  db: D1Database,
  currentOrg: string | null = null,
  userId?: string,
  now: Date = new Date()
): Promise<RouteResult> {
  const visible = userId ? await unitsWherePermitted(db, userId, "AP.FraudReview") : null;
  const scopedUnits = await scopedToChosenOrg(db, visible, currentOrg);
  const clause = unitClause({ units: scopedUnits }, "h.org_unit_id");
  const starts = weekStarts(now);

  const exceptionRows = await db
    .prepare(
      `SELECT v.created_at AS created_at, v.validation_failures AS validation_failures,
              h.supplier_id AS supplier_id,
              COALESCE(sup.name, json_extract(h.facts_json, '$."BT-27"')) AS supplier_name
       FROM stage_visits v
       JOIN process_instances pi ON pi.id = v.process_instance_id
       JOIN invoice_headers h ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
       LEFT JOIN suppliers sup ON sup.id = h.supplier_id
       WHERE v.validation_passed = 0
         AND date(v.created_at) >= ?1 ${clause.sql}`
    )
    .bind(starts[0], ...clause.binds)
    .all<ExceptionRow>();

  const userRows = await db
    .prepare(
      `SELECT v.created_at AS created_at, t.completed_by AS user_id, u.name AS user_name
       FROM stage_visits v
       JOIN process_instances pi ON pi.id = v.process_instance_id
       JOIN invoice_headers h ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
       JOIN tasks t ON t.stage_visit_id = v.id
       LEFT JOIN org_users u ON u.id = t.completed_by
       WHERE v.validation_passed = 0
         AND t.status = 'completed'
         AND t.completed_by IS NOT NULL
         AND date(v.created_at) >= ?1 ${clause.sql}`
    )
    .bind(starts[0], ...clause.binds)
    .all<UserRow>();

  const bySupplier = new Map<string, { name: string | null; weeklyCounts: number[] }>();
  const byType = new Map<string, number[]>();

  for (const row of exceptionRows.results) {
    const idx = weekIndexFor(row.created_at.slice(0, 10), starts);
    const supplierKey = row.supplier_id ?? "__unmatched__";
    const existing = bySupplier.get(supplierKey);
    if (existing) {
      existing.weeklyCounts = bump(existing.weeklyCounts, idx);
    } else {
      bySupplier.set(supplierKey, {
        name: row.supplier_id ? row.supplier_name : null,
        weeklyCounts: bump(new Array(TREND_WEEKS).fill(0), idx),
      });
    }

    if (row.validation_failures) {
      for (const rawType of row.validation_failures.split(",")) {
        const type = rawType.trim();
        if (!type) continue;
        const counts = byType.get(type) ?? new Array(TREND_WEEKS).fill(0);
        byType.set(type, bump(counts, idx));
      }
    }
  }

  const byUser = new Map<string, { name: string | null; weeklyCounts: number[] }>();
  for (const row of userRows.results) {
    const idx = weekIndexFor(row.created_at.slice(0, 10), starts);
    const existing = byUser.get(row.user_id);
    if (existing) {
      existing.weeklyCounts = bump(existing.weeklyCounts, idx);
    } else {
      byUser.set(row.user_id, { name: row.user_name, weeklyCounts: bump(new Array(TREND_WEEKS).fill(0), idx) });
    }
  }

  const total = (counts: number[]) => counts.reduce((sum, n) => sum + n, 0);

  const supplierEntries: SupplierExceptionTrend[] = [...bySupplier.entries()]
    .map(([key, v]) => ({
      supplierId: key === "__unmatched__" ? null : key,
      supplierName: v.name,
      total: total(v.weeklyCounts),
      weeklyCounts: v.weeklyCounts,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, TOP_SUPPLIERS);

  const userEntries: UserExceptionTrend[] = [...byUser.entries()]
    .map(([userId, v]) => ({ userId, userName: v.name, total: total(v.weeklyCounts), weeklyCounts: v.weeklyCounts }))
    .sort((a, b) => b.total - a.total)
    .slice(0, TOP_USERS);

  const typeEntries: TypeExceptionTrend[] = [...byType.entries()]
    .map(([type, weeklyCounts]) => ({ type, total: total(weeklyCounts), weeklyCounts }))
    .sort((a, b) => b.total - a.total)
    .slice(0, TOP_TYPES);

  return {
    status: 200,
    body: {
      weekStartDates: starts,
      bySupplier: supplierEntries,
      byUser: userEntries,
      byType: typeEntries,
    } satisfies FraudExceptionTrendsReport,
  };
}
