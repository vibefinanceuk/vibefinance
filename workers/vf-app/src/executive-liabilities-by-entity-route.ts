import type { RouteResult } from "./org-route.js";

/**
 * Liabilities and accruals by entity — decision 0431, the Multi-
 * Enterprise CFO View's second real metric (the design's own second
 * bullet under Screen 5 — Multi-Enterprise View (Office of the CFO)'s
 * key metrics): *"Liabilities and accruals by entity (Screen 4's own
 * metrics, rolled up and compared across entities)."*
 *
 * **Screen 4 has one real metric today — accruals (decision 0417's own
 * follow-on)** — so "Screen 4's own metrics" means that one, read back
 * per entity instead of per scoped org. The accrual definition itself
 * is unchanged from `accruals-route.ts`: an invoice whose process
 * instance is still in flight (`process_instances.status =
 * 'in_progress'`) and whose current stage is not that process's own
 * final one (computed the same `MAX(sequence)` way).
 *
 * **The same scoping decision decision 0425 already made for this
 * screen, applied again**: no `currentOrg` narrowing, `AP.Analysis` +
 * `holdsEverywhere` gated in `index.ts`, grouped by the invoice's own
 * recorded `org_unit_id` (excluded, not guessed, when unrecorded),
 * never summed across currencies, uncapped and ranked within each
 * currency — see `executive-consolidated-spend-route.ts`'s own doc
 * comment for the full reasoning behind each of those, unrepeated here
 * since nothing about entity-scoped liabilities changes any of it.
 *
 * **One total plus one count per entity, not a further stage
 * breakdown.** `accruals-route.ts`'s own scoped, single-org report
 * breaks a liability out by stage, because a manager narrowed to one
 * org wants to know *where in the process* the money is sitting. This
 * screen's whole point is comparing entities against each other, so a
 * stage-by-stage table for each of a few dozen entities would be the
 * wall-of-numbers the design's own "roll up rather than viewed one
 * org at a time" language explicitly asks this screen to avoid — the
 * total is the figure a CFO compares across entities; the stage
 * breakdown stays one click away, on Financial Performance's own
 * accruals card, scoped to whichever org the switcher is set to.
 */

interface LiabilityRow {
  org_unit_id: string;
  org_unit_name: string;
  org_unit_kind: string;
  currency: string;
  total_with_vat: number;
}

interface MaxSequenceRow {
  process_id: string;
  max_seq: number;
}

interface LiabilityAccrualRow extends LiabilityRow {
  sequence: number;
  process_id: string;
}

export interface LiabilityEntity {
  orgUnitId: string;
  orgUnitName: string;
  orgUnitKind: "legal_entity" | "operating_unit";
  total: number;
  count: number;
}

export interface LiabilityByCurrency {
  currency: string;
  total: number;
  entities: LiabilityEntity[];
}

export interface ExecutiveLiabilitiesReport {
  currencies: LiabilityByCurrency[];
}

export async function handleExecutiveLiabilitiesByEntity(db: D1Database): Promise<RouteResult> {
  const rows = await db
    .prepare(
      `SELECT h.org_unit_id AS org_unit_id, u.name AS org_unit_name, u.kind AS org_unit_kind,
              h.currency AS currency, h.total_with_vat AS total_with_vat,
              s.sequence AS sequence, s.process_id AS process_id
       FROM process_instances pi
       JOIN process_stages s ON s.id = pi.current_stage_id
       JOIN invoice_headers h ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
       JOIN org_units u ON u.id = h.org_unit_id
       WHERE pi.status = 'in_progress'
         AND h.total_with_vat IS NOT NULL AND h.currency IS NOT NULL`
    )
    .all<LiabilityAccrualRow>();

  if (rows.results.length === 0) return { status: 200, body: { currencies: [] } satisfies ExecutiveLiabilitiesReport };

  const processIds = [...new Set(rows.results.map((r) => r.process_id))];
  const placeholders = processIds.map(() => "?").join(", ");
  const maxSeqRows = await db
    .prepare(`SELECT process_id, max(sequence) AS max_seq FROM process_stages WHERE process_id IN (${placeholders}) GROUP BY process_id`)
    .bind(...processIds)
    .all<MaxSequenceRow>();
  const finalSequenceByProcess = new Map(maxSeqRows.results.map((r) => [r.process_id, r.max_seq]));

  // The same exclusion `accruals-route.ts` already makes: an invoice
  // sitting at its own process's last stage has reached
  // payment-eligibility, so it has stopped being accrued.
  const accruing = rows.results.filter((row) => row.sequence !== finalSequenceByProcess.get(row.process_id));

  const byCurrency = new Map<string, Map<string, { name: string; kind: string; total: number; count: number }>>();
  for (const row of accruing) {
    if (!byCurrency.has(row.currency)) byCurrency.set(row.currency, new Map());
    const entities = byCurrency.get(row.currency)!;
    const existing = entities.get(row.org_unit_id);
    if (existing) {
      existing.total += row.total_with_vat;
      existing.count += 1;
    } else {
      entities.set(row.org_unit_id, { name: row.org_unit_name, kind: row.org_unit_kind, total: row.total_with_vat, count: 1 });
    }
  }

  const currencies: LiabilityByCurrency[] = [...byCurrency.entries()]
    .map(([currency, entities]) => {
      const entityList: LiabilityEntity[] = [...entities.entries()]
        .map(([orgUnitId, e]) => ({
          orgUnitId,
          orgUnitName: e.name,
          orgUnitKind: e.kind as "legal_entity" | "operating_unit",
          total: e.total,
          count: e.count,
        }))
        .sort((a, b) => b.total - a.total);
      return { currency, total: entityList.reduce((sum, e) => sum + e.total, 0), entities: entityList };
    })
    .sort((a, b) => b.total - a.total);

  return { status: 200, body: { currencies } satisfies ExecutiveLiabilitiesReport };
}
