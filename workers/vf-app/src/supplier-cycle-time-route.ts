import { unitsWherePermitted, scopedToChosenOrg, unitClause } from "./enforce.js";
import type { RouteResult } from "./org-route.js";

/**
 * Average cycle time by supplier — decision 0421, one of the six
 * remaining vertical slices of the Supplier Performance screen (the
 * design's own third bullet under "Key metrics": *"Average cycle time
 * by supplier (receipt → payment-eligible)"*).
 *
 * **"Payment-eligible" is the same final stage decision 0418 already
 * defined for accruals** — computed per process from
 * `process_stages.sequence`, the same `MAX(sequence)` concept
 * `accruals-route.ts` and `workload-route.ts` both already read for
 * their own reasons. "Receipt" is `process_instances.created_at` —
 * when the invoice's own process instance began — and reaching
 * payment-eligible is the *first* `stage_visits` row recorded at that
 * process's own final stage (`MIN`, since decision 0025's own
 * revalidation can revisit a stage more than once; only the first
 * arrival is the cycle this metric measures).
 *
 * **Only invoices whose process instance has actually reached that
 * stage are counted** — the same "a completed thing has a duration,
 * an in-flight one does not yet" reasoning accruals uses in reverse:
 * accruals counts what has NOT yet reached the final stage; this
 * counts only what HAS.
 *
 * **Scoped and joined the same way decision 0416 already established
 * for this screen** — `AP.Supplier`, `unitsWherePermitted`, and
 * `unitClause` against the *supplier's* own org unit
 * (`sup.org_unit_id`), not the invoice's — one scoping rule for the
 * whole screen, not a different one per metric.
 *
 * **Days, computed in SQL with `julianday()`**, the same idiom
 * `dashboard-route.ts`'s own `received()` already uses for date
 * arithmetic, rather than parsing two differently-formatted timestamp
 * strings (`process_instances.created_at` from SQLite's own
 * `datetime('now')`, `stage_visits.created_at` from
 * `strftime('%Y-%m-%d %H:%M:%f', 'now')`) in JavaScript.
 */

interface CycleRow {
  supplier_id: string;
  supplier_name: string;
  cycle_days: number;
}

export interface SupplierCycleTime {
  supplierId: string;
  supplierName: string;
  averageDays: number;
  invoiceCount: number;
}

export interface SupplierCycleTimeReport {
  suppliers: SupplierCycleTime[];
}

export async function handleSupplierCycleTime(
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
              julianday(MIN(v.created_at)) - julianday(pi.created_at) AS cycle_days
       FROM process_instances pi
       JOIN invoice_headers h ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
       JOIN suppliers sup ON sup.id = h.supplier_id
       JOIN process_stages ps ON ps.process_id = pi.process_id
       JOIN stage_visits v ON v.process_instance_id = pi.id AND v.stage_id = ps.id
       WHERE ps.sequence = (SELECT max(sequence) FROM process_stages WHERE process_id = pi.process_id) ${clause.sql}
       GROUP BY pi.id, h.supplier_id, sup.name`
    )
    .bind(...clause.binds)
    .all<CycleRow>();

  if (rows.results.length === 0) return { status: 200, body: { suppliers: [] } satisfies SupplierCycleTimeReport };

  const bySupplier = new Map<string, { name: string; totalDays: number; count: number }>();
  for (const row of rows.results) {
    const existing = bySupplier.get(row.supplier_id);
    if (existing) {
      existing.totalDays += row.cycle_days;
      existing.count += 1;
    } else {
      bySupplier.set(row.supplier_id, { name: row.supplier_name, totalDays: row.cycle_days, count: 1 });
    }
  }

  // **Slowest first** — the same "problems surface first" ordering
  // `dashboard-route.ts`'s own `exceptionsBySupplier` already gives
  // its own ranking, applied here to cycle time instead of exception
  // count.
  const suppliers: SupplierCycleTime[] = [...bySupplier.entries()]
    .map(([supplierId, s]) => ({
      supplierId,
      supplierName: s.name,
      averageDays: s.totalDays / s.count,
      invoiceCount: s.count,
    }))
    .sort((a, b) => b.averageDays - a.averageDays);

  return { status: 200, body: { suppliers } satisfies SupplierCycleTimeReport };
}
