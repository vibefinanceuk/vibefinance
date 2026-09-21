import { mondayOfThisWeek } from "./dates.js";
import type { RouteResult } from "./org-route.js";

/**
 * Cross-entity exception and fraud-signal trend — decision 0431, the
 * Multi-Enterprise CFO View's fourth real metric (the design's own
 * fifth bullet under Screen 5 — Multi-Enterprise View (Office of the
 * CFO)'s key metrics): *"Cross-entity exception and fraud-signal trend
 * (Screen 3's own metrics, compared across entities)."*
 *
 * **Reuses decision 0423's own exception definition and trend window
 * unchanged** — `stage_visits.validation_passed = 0`, eight
 * Monday-anchored calendar weeks — grouped by the invoice's own
 * recorded `org_unit_id` instead of by supplier, user, or type. Not a
 * new detection concept, the same discipline decision 0423's own doc
 * comment already establishes for why it is not a re-listing of
 * decision 0421's card: this is a genuinely different breakdown of the
 * same underlying event.
 *
 * **Same scoping decision as the rest of this screen**: no
 * `currentOrg` narrowing, `AP.Analysis` + `holdsEverywhere` gated in
 * `index.ts` — not `AP.FraudReview`, even though the metric this rolls
 * up lives behind that permission on Fraud Prevention itself. The tab
 * this card lives on gates once, on `AP.Analysis` + `holdsEverywhere`
 * (`ap-analytics.js`'s own `TABS` table), the same "no new
 * access-control concept" decision 0425 already made explicit for this
 * screen — a second gate on one card of five would mean the same
 * person sees four cards and a mysterious gap on the fifth, worse than
 * either granting or withholding the whole tab. An invoice with no
 * recorded org unit is excluded, not guessed into a bucket, the same
 * reasoning `executive-consolidated-spend-route.ts` already gives.
 *
 * **Uncapped, unlike decision 0423's own top-8/top-8/top-6 breakdowns.**
 * The org-unit hierarchy this reads is the enterprise's own structure —
 * a handful to a few dozen entities — and the entire point of this
 * screen, the same reasoning `executive-consolidated-spend-route.ts`
 * already gives for its own uncapped ranking, is comparing every one of
 * them.
 */

const TREND_WEEKS = 8;

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
  org_unit_id: string;
  org_unit_name: string;
  org_unit_kind: string;
}

export interface EntityExceptionTrend {
  orgUnitId: string;
  orgUnitName: string;
  orgUnitKind: "legal_entity" | "operating_unit";
  total: number;
  weeklyCounts: number[];
}

export interface ExecutiveExceptionTrendsReport {
  weekStartDates: string[];
  byEntity: EntityExceptionTrend[];
}

function bump(counts: number[], idx: number): number[] {
  const next = [...counts];
  next[idx] += 1;
  return next;
}

export async function handleExecutiveExceptionTrends(
  db: D1Database,
  now: Date = new Date()
): Promise<RouteResult> {
  const starts = weekStarts(now);

  const rows = await db
    .prepare(
      `SELECT v.created_at AS created_at, h.org_unit_id AS org_unit_id,
              u.name AS org_unit_name, u.kind AS org_unit_kind
       FROM stage_visits v
       JOIN process_instances pi ON pi.id = v.process_instance_id
       JOIN invoice_headers h ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
       JOIN org_units u ON u.id = h.org_unit_id
       WHERE v.validation_passed = 0
         AND date(v.created_at) >= ?1`
    )
    .bind(starts[0])
    .all<ExceptionRow>();

  const byEntity = new Map<string, { name: string; kind: string; weeklyCounts: number[] }>();
  for (const row of rows.results) {
    const idx = weekIndexFor(row.created_at.slice(0, 10), starts);
    const existing = byEntity.get(row.org_unit_id);
    if (existing) {
      existing.weeklyCounts = bump(existing.weeklyCounts, idx);
    } else {
      byEntity.set(row.org_unit_id, {
        name: row.org_unit_name,
        kind: row.org_unit_kind,
        weeklyCounts: bump(new Array(TREND_WEEKS).fill(0), idx),
      });
    }
  }

  const total = (counts: number[]) => counts.reduce((sum, n) => sum + n, 0);

  const byEntityList: EntityExceptionTrend[] = [...byEntity.entries()]
    .map(([orgUnitId, v]) => ({
      orgUnitId,
      orgUnitName: v.name,
      orgUnitKind: v.kind as "legal_entity" | "operating_unit",
      total: total(v.weeklyCounts),
      weeklyCounts: v.weeklyCounts,
    }))
    .sort((a, b) => b.total - a.total);

  return {
    status: 200,
    body: { weekStartDates: starts, byEntity: byEntityList } satisfies ExecutiveExceptionTrendsReport,
  };
}
