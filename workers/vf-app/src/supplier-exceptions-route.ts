import { unitsWherePermitted, scopedToChosenOrg, unitClause } from "./enforce.js";
import type { RouteResult } from "./org-route.js";

/**
 * Exception rate by supplier, and exception type mix — decision 0421,
 * one of the six remaining vertical slices of the Supplier Performance
 * screen (the design's own fourth bullet under "Key metrics").
 *
 * **An exception is what `stage_visits.validation_passed = 0` already
 * means** — decision 0021's own persisted verdict, the same
 * definition `dashboard-route.ts`'s own `exceptionsBySupplier` card
 * already uses ("which suppliers send invoices that need work"). Not
 * a new detection concept, reused rather than reinvented.
 *
 * **The rate's own denominator is visits where validation actually
 * ran, not every visit.** `validation_passed IS NULL` means
 * "not recorded" (decision 0021's own standing invariant) — a stage
 * with no rule set to evaluate, or one this system never checked.
 * Counting those as passes would understate a supplier's real
 * exception rate; excluding them from both sides of the fraction is
 * the honest reading.
 *
 * **Type mix reads `validation_failures`** — the named checks that
 * failed, comma-separated, matching `validation.failures` exactly
 * (decision 0021's own comment). Split and counted across every
 * exception in the scoped window, not per supplier — most suppliers
 * have too few exceptions of their own for a per-supplier breakdown to
 * mean anything; one shared ranking of "what kind of thing goes wrong"
 * is the actionable shape.
 *
 * **A 90-day window**, wider than `exceptionsBySupplier`'s own 30 —
 * that card exists to surface *recent* problems needing attention
 * today; this one is a performance metric, meant to characterise a
 * supplier's pattern over a season rather than this week alone.
 *
 * **Scoped the same way the rest of this screen already is** —
 * `AP.Supplier`, `unitsWherePermitted`, `unitClause` against the
 * supplier's own org unit.
 */

interface VisitRow {
  supplier_id: string;
  supplier_name: string;
  validation_passed: number;
  validation_failures: string | null;
}

export interface SupplierExceptionRate {
  supplierId: string;
  supplierName: string;
  exceptionCount: number;
  visitCount: number;
  exceptionRate: number;
}

export interface ExceptionType {
  type: string;
  count: number;
}

export interface SupplierExceptionsReport {
  suppliers: SupplierExceptionRate[];
  typeMix: ExceptionType[];
}

export async function handleSupplierExceptions(
  db: D1Database,
  currentOrg: string | null = null,
  userId?: string
): Promise<RouteResult> {
  const visible = userId ? await unitsWherePermitted(db, userId, "AP.Supplier") : null;
  const scopedUnits = await scopedToChosenOrg(db, visible, currentOrg);
  const clause = unitClause({ units: scopedUnits }, "sup.org_unit_id");

  const rows = await db
    .prepare(
      `SELECT h.supplier_id AS supplier_id, sup.name AS supplier_name,
              v.validation_passed AS validation_passed, v.validation_failures AS validation_failures
       FROM stage_visits v
       JOIN process_instances pi ON pi.id = v.process_instance_id
       JOIN invoice_headers h ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
       JOIN suppliers sup ON sup.id = h.supplier_id
       WHERE v.validation_passed IS NOT NULL
         AND julianday('now') - julianday(v.created_at) < 90 ${clause.sql}`
    )
    .bind(...clause.binds)
    .all<VisitRow>();

  if (rows.results.length === 0) {
    return { status: 200, body: { suppliers: [], typeMix: [] } satisfies SupplierExceptionsReport };
  }

  const bySupplier = new Map<string, { name: string; exceptions: number; visits: number }>();
  const typeCounts = new Map<string, number>();
  for (const row of rows.results) {
    const existing = bySupplier.get(row.supplier_id);
    const isException = row.validation_passed === 0;
    if (existing) {
      existing.visits += 1;
      if (isException) existing.exceptions += 1;
    } else {
      bySupplier.set(row.supplier_id, { name: row.supplier_name, exceptions: isException ? 1 : 0, visits: 1 });
    }

    if (isException && row.validation_failures) {
      for (const rawType of row.validation_failures.split(",")) {
        const type = rawType.trim();
        if (!type) continue;
        typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
      }
    }
  }

  // **Highest exception rate first** — the same "problems surface
  // first" ordering `exceptionsBySupplier` and decision 0421's own
  // cycle-time report both already give.
  const suppliers: SupplierExceptionRate[] = [...bySupplier.entries()]
    .map(([supplierId, s]) => ({
      supplierId,
      supplierName: s.name,
      exceptionCount: s.exceptions,
      visitCount: s.visits,
      exceptionRate: s.exceptions / s.visits,
    }))
    .filter((s) => s.exceptionCount > 0)
    .sort((a, b) => b.exceptionRate - a.exceptionRate);

  const typeMix: ExceptionType[] = [...typeCounts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  return { status: 200, body: { suppliers, typeMix } satisfies SupplierExceptionsReport };
}
