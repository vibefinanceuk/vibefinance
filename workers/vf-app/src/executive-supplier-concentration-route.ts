import type { RouteResult } from "./org-route.js";

/**
 * Cross-entity supplier concentration — decision 0431, the Multi-
 * Enterprise CFO View's third real metric (the design's own fourth
 * bullet under Screen 5 — Multi-Enterprise View (Office of the CFO)'s
 * key metrics): *"Cross-entity supplier concentration — the same
 * supplier appearing as a top vendor in several entities, a real
 * negotiation and risk signal."*
 *
 * **What "a top vendor" means, and how many entities flag it — asked
 * directly, not picked unilaterally.** The design leaves both open; the
 * operator chose *top 5 suppliers by spend within each entity (each
 * currency ranked separately, the same discipline every other monetary
 * metric on this screen already follows), flagged once a supplier
 * appears in that top 5 for 2 or more distinct entities.* A supplier
 * ranking top-5 in two different currencies for the *same* entity
 * still counts as one entity, not two — concentration is about how
 * many separate parts of the enterprise depend on this supplier, which
 * a single entity billing them in two currencies does not multiply.
 *
 * **Same scoping decision as the rest of this screen**: no
 * `currentOrg` narrowing, `AP.Analysis` + `holdsEverywhere` gated in
 * `index.ts`, an invoice with no recorded org unit excluded rather than
 * guessed — see `executive-consolidated-spend-route.ts`'s own doc
 * comment for the full reasoning, unrepeated here.
 *
 * **An invoice naming no supplier we recognise (`supplier_id IS NULL`)
 * cannot be ranked by supplier identity at all**, the same reasoning
 * `supplier-performance-route.ts` already gives for excluding an
 * unpriced invoice — there is no stable identity here to concentrate
 * on, unlike `fraud-exception-trends-route.ts`'s own `bySupplier`
 * breakdown, which groups an unmatched invoice into one shared,
 * explicitly-unmatched bucket because *any* activity from an unnamed
 * source is still worth trending. Concentration is a statement about a
 * *named* supplier's reach across the enterprise, so an unmatched
 * invoice is excluded here rather than folded into a bucket that could
 * never itself be "the same supplier."
 *
 * **Only flagged suppliers are returned** — the top-5-per-entity
 * working set itself is not the deliverable the design asks for; the
 * signal is the overlap. A supplier appearing in only one entity's top
 * 5, however large that one entity's spend with them, is exactly what
 * this metric is not about and is left out rather than padding the
 * response with noise a reader would have to filter themselves.
 */

const TOP_N_PER_ENTITY = 5;
const FLAG_AT_ENTITIES = 2;

interface SupplierSpendRow {
  org_unit_id: string;
  org_unit_name: string;
  org_unit_kind: string;
  currency: string;
  supplier_id: string;
  supplier_name: string;
  total: number;
}

export interface SupplierEntityAppearance {
  orgUnitId: string;
  orgUnitName: string;
  orgUnitKind: "legal_entity" | "operating_unit";
  currency: string;
  rank: number;
  total: number;
}

export interface SupplierConcentrationEntry {
  supplierId: string;
  supplierName: string;
  entityCount: number;
  appearances: SupplierEntityAppearance[];
}

export interface SupplierConcentrationReport {
  suppliers: SupplierConcentrationEntry[];
}

export async function handleExecutiveSupplierConcentration(db: D1Database): Promise<RouteResult> {
  const rows = await db
    .prepare(
      `SELECT h.org_unit_id AS org_unit_id, u.name AS org_unit_name, u.kind AS org_unit_kind,
              h.currency AS currency, s.id AS supplier_id, s.name AS supplier_name,
              SUM(h.total_with_vat) AS total
       FROM invoice_headers h
       JOIN org_units u ON u.id = h.org_unit_id
       JOIN suppliers s ON s.id = h.supplier_id
       WHERE h.total_with_vat IS NOT NULL AND h.currency IS NOT NULL
       GROUP BY h.org_unit_id, h.currency, s.id`
    )
    .all<SupplierSpendRow>();

  // One top-`TOP_N_PER_ENTITY` ranking per (entity, currency) — the
  // same "never blended across currencies" ranking
  // `supplier-performance-route.ts` already gives a single entity;
  // applied here once per entity instead of once overall.
  const byEntityCurrency = new Map<string, SupplierSpendRow[]>();
  for (const row of rows.results) {
    const key = `${row.org_unit_id}\u0000${row.currency}`;
    const list = byEntityCurrency.get(key) ?? [];
    list.push(row);
    byEntityCurrency.set(key, list);
  }

  const appearancesBySupplier = new Map<
    string,
    { name: string; entities: Map<string, SupplierEntityAppearance> }
  >();

  for (const list of byEntityCurrency.values()) {
    const top = [...list].sort((a, b) => b.total - a.total).slice(0, TOP_N_PER_ENTITY);
    top.forEach((row, i) => {
      const entry = appearancesBySupplier.get(row.supplier_id) ?? { name: row.supplier_name, entities: new Map() };
      // The same entity in two currencies keeps its earlier (higher-
      // ranked) appearance rather than being overwritten by a later,
      // lower-ranked one — a supplier's own strongest showing in that
      // entity is the one worth reporting.
      const existing = entry.entities.get(row.org_unit_id);
      if (!existing || row.total > existing.total) {
        entry.entities.set(row.org_unit_id, {
          orgUnitId: row.org_unit_id,
          orgUnitName: row.org_unit_name,
          orgUnitKind: row.org_unit_kind as "legal_entity" | "operating_unit",
          currency: row.currency,
          rank: i + 1,
          total: row.total,
        });
      }
      appearancesBySupplier.set(row.supplier_id, entry);
    });
  }

  const suppliers: SupplierConcentrationEntry[] = [...appearancesBySupplier.entries()]
    .map(([supplierId, entry]) => ({
      supplierId,
      supplierName: entry.name,
      entityCount: entry.entities.size,
      appearances: [...entry.entities.values()].sort((a, b) => b.total - a.total),
    }))
    .filter((entry) => entry.entityCount >= FLAG_AT_ENTITIES)
    .sort((a, b) => {
      if (b.entityCount !== a.entityCount) return b.entityCount - a.entityCount;
      const aTotal = a.appearances.reduce((sum, x) => sum + x.total, 0);
      const bTotal = b.appearances.reduce((sum, x) => sum + x.total, 0);
      return bTotal - aTotal;
    });

  return { status: 200, body: { suppliers } satisfies SupplierConcentrationReport };
}
