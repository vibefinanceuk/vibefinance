import type { RouteResult } from "./org-route.js";

/**
 * Consolidated spend across org units / legal entities — decision
 * 0425, the Multi-Enterprise CFO View's first real metric (the
 * design's own first bullet under Screen 5 — Multi-Enterprise View
 * (Office of the CFO)'s key metrics): *"Consolidated spend across org
 * units / legal entities."*
 *
 * **The scoping decision the design itself flagged, made:
 * `holdsEverywhere` reused as-is, `GROUP BY org_unit_id` for the
 * aggregation — the design's own recommended "Option 1," not the
 * "genuinely new compare-selected-orgs scope" it also describes and
 * explicitly defers ("flagged here as a decision for a future design
 * pass, not assumed solved by this document").** No new access-control
 * concept: this route requires exactly what `ap-analytics.js`'s own
 * `executiveiq` tab already gates on — `AP.Analysis` and
 * `me.holdsEverywhere` — checked again here, server-side, since a tab
 * being hidden is not the same thing as a route being closed.
 *
 * **Enterprise-wide by definition — no `currentOrg` narrowing, on
 * purpose.** Every other analysis route in this codebase takes a
 * chosen org and narrows to it (`scopedToChosenOrg`); this one
 * deliberately does not. The entire point of this screen is seeing
 * every entity a CFO is responsible for, broken out and compared in
 * one place — narrowing to a single chosen org would collapse the
 * comparison this metric exists to show into the same one-org-at-a-
 * time view the design's own "real gap" section names as the problem
 * (*"seeing the whole enterprise means opening each org one at a
 * time and holding the comparison in your head"*). A person who does
 * not hold `holdsEverywhere` cannot reach this route at all, so there
 * is no narrower, permission-restricted view to also support here.
 *
 * **Grouped by the invoice's own recorded `org_unit_id`, exactly as
 * the design's own "Option 1" says — no invented rollup from an
 * operating unit up to its parent legal entity.** An invoice's
 * `org_unit_id` may name either kind (decision 0226's own deliberate
 * choice not to assume every customer has legal entities configured:
 * *"what matters is that the header names the company where one is
 * known, not that it never names anything else"*) — this route reports
 * each recorded unit exactly as named, carrying its own `kind` so a
 * reader can tell a legal entity from an operating unit rather than
 * this route silently blending the two. Building a further rollup
 * (operating units folded up into their own parent legal entity) is
 * real, additional work the design does not ask this route for, and
 * is left for a later decision should a real customer's own data need
 * it.
 *
 * **Never summed across currencies** — the same discipline every
 * monetary screen in this arc already follows (decisions 0416, 0418,
 * 0419, 0421). Grouped by `(org_unit_id, currency)`; the response
 * carries one ranked breakdown per currency actually present, plus
 * that currency's own enterprise-wide total, rather than one blended
 * figure nobody could trust.
 *
 * **An invoice with no recorded org unit is excluded, not guessed
 * into a bucket.** `org_unit_id IS NULL` means the invoice has not yet
 * been placed at all (decision 0111 makes Validation the point at
 * which an org must be known, not capture) — there is no entity for
 * it to roll up under, honestly. `docs/PROGRESS.md`'s own "Not built"
 * section already names the dedicated screen this belongs to
 * (`org.unplaced`), which this route does not attempt to be.
 *
 * **Uncapped, ranked within each currency — not a top-N list.**
 * Unlike Supplier Performance's own top-N ranking (a real customer can
 * have hundreds of suppliers), the org-unit hierarchy this reads is
 * the enterprise's own structure — a handful to a few dozen entities
 * in practice — and the entire point of this screen is comparing every
 * one of them, not the biggest few.
 */

interface SpendRow {
  org_unit_id: string;
  org_unit_name: string;
  org_unit_kind: string;
  currency: string;
  total: number;
}

export interface ConsolidatedSpendEntity {
  orgUnitId: string;
  orgUnitName: string;
  orgUnitKind: "legal_entity" | "operating_unit";
  total: number;
}

export interface ConsolidatedSpendByCurrency {
  currency: string;
  total: number;
  entities: ConsolidatedSpendEntity[];
}

export interface ConsolidatedSpendReport {
  currencies: ConsolidatedSpendByCurrency[];
}

export async function handleExecutiveConsolidatedSpend(db: D1Database): Promise<RouteResult> {
  const rows = await db
    .prepare(
      `SELECT h.org_unit_id AS org_unit_id, u.name AS org_unit_name, u.kind AS org_unit_kind,
              h.currency AS currency, SUM(h.total_with_vat) AS total
       FROM invoice_headers h
       JOIN org_units u ON u.id = h.org_unit_id
       WHERE h.total_with_vat IS NOT NULL AND h.currency IS NOT NULL
       GROUP BY h.org_unit_id, h.currency`
    )
    .all<SpendRow>();

  const byCurrency = new Map<string, ConsolidatedSpendEntity[]>();
  for (const row of rows.results) {
    const entities = byCurrency.get(row.currency) ?? [];
    entities.push({
      orgUnitId: row.org_unit_id,
      orgUnitName: row.org_unit_name,
      orgUnitKind: row.org_unit_kind as "legal_entity" | "operating_unit",
      total: row.total,
    });
    byCurrency.set(row.currency, entities);
  }

  const currencies: ConsolidatedSpendByCurrency[] = [...byCurrency.entries()]
    .map(([currency, entities]) => ({
      currency,
      total: entities.reduce((sum, e) => sum + e.total, 0),
      entities: entities.sort((a, b) => b.total - a.total),
    }))
    .sort((a, b) => b.total - a.total);

  return { status: 200, body: { currencies } satisfies ConsolidatedSpendReport };
}
