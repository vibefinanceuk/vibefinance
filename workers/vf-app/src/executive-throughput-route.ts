import type { RouteResult } from "./org-route.js";

/**
 * Cross-org throughput/workload comparison — decision 0431, the
 * Multi-Enterprise CFO View's fifth and last data-buildable metric (the
 * design's own sixth bullet under Screen 5 — Multi-Enterprise View
 * (Office of the CFO)'s key metrics): *"Cross-org throughput/workload
 * comparison (Screen 2's own metrics, compared across entities)."*
 *
 * **Reuses `workload-route.ts`'s own throughput definition** — a task
 * with `status = 'completed'` and `julianday('now') -
 * julianday(t.completed_at) < 7` — grouped by the invoice's own
 * recorded `org_unit_id` instead of by `completed_by`.
 *
 * **Deliberately not the stage-bucketed chart Workload's own card
 * builds.** `workload-route.ts`'s `bucketOf`/`labelFor` fold each
 * customer's own real process stages onto a fixed 5-colour chart
 * budget, per user — real complexity earned by a screen showing one
 * team's own work broken down by where in the process it sits. This
 * screen compares entities against each other, not stages within one;
 * a stage-by-stage breakdown for each of a few dozen entities is
 * exactly the wall-of-numbers the design's own "roll up rather than
 * viewed one org at a time" language asks this screen to avoid — the
 * same call `executive-liabilities-by-entity-route.ts` already makes
 * for the identical reason. A single completed-count per entity is the
 * figure a CFO compares; the stage breakdown for any one entity stays
 * one click away on Operational Performance, scoped to whichever org
 * the switcher is set to.
 *
 * **Same scoping decision as the rest of this screen**: no
 * `currentOrg` narrowing, `AP.Analysis` + `holdsEverywhere` gated in
 * `index.ts`, an invoice with no recorded org unit excluded rather than
 * guessed, uncapped rather than top-N — see
 * `executive-consolidated-spend-route.ts`'s own doc comment for the
 * full reasoning behind each, unrepeated here.
 */

interface ThroughputRow {
  org_unit_id: string;
  org_unit_name: string;
  org_unit_kind: string;
  n: number;
}

export interface EntityThroughput {
  orgUnitId: string;
  orgUnitName: string;
  orgUnitKind: "legal_entity" | "operating_unit";
  completedCount: number;
}

export interface ExecutiveThroughputReport {
  entities: EntityThroughput[];
}

export async function handleExecutiveThroughput(db: D1Database): Promise<RouteResult> {
  const rows = await db
    .prepare(
      `SELECT h.org_unit_id AS org_unit_id, u.name AS org_unit_name, u.kind AS org_unit_kind,
              count(*) AS n
       FROM tasks t
       JOIN stage_visits v ON v.id = t.stage_visit_id
       JOIN process_instances pi ON pi.id = v.process_instance_id
       JOIN invoice_headers h ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
       JOIN org_units u ON u.id = h.org_unit_id
       WHERE t.status = 'completed'
         AND t.completed_by IS NOT NULL
         AND julianday('now') - julianday(t.completed_at) < 7
       GROUP BY h.org_unit_id`
    )
    .all<ThroughputRow>();

  const entities: EntityThroughput[] = rows.results
    .map((row) => ({
      orgUnitId: row.org_unit_id,
      orgUnitName: row.org_unit_name,
      orgUnitKind: row.org_unit_kind as "legal_entity" | "operating_unit",
      completedCount: row.n,
    }))
    .sort((a, b) => b.completedCount - a.completedCount);

  return { status: 200, body: { entities } satisfies ExecutiveThroughputReport };
}
