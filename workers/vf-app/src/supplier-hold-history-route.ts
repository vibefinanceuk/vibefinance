import { unitsWherePermitted, scopedToChosenOrg, unitClause } from "./enforce.js";
import type { RouteResult } from "./org-route.js";

/**
 * Hold history — how often and for how long a supplier has been
 * placed on hold, and why — decision 0427, the last of Supplier
 * Performance's eight key metrics. `GET /suppliers/hold-history`.
 *
 * **Built on the general field-change history decision 0427 added**
 * (`supplier_field_changes`, migration 0072), not a hold-specific
 * table — the operator's own chosen scope, wider than this metric
 * alone needed. This route reads only the `on_hold` and `hold_reason`
 * rows out of it.
 *
 * **A period, not a state.** `on_hold`/`hold_reason` (migration 0049)
 * have always been current state only; this pairs consecutive `on_hold`
 * transitions per supplier — a `0 → 1` row opens a period, the next
 * `1 → 0` row for that supplier closes it — to recover discrete hold
 * periods a plain `UPDATE` never kept. An opened period with no closing
 * row yet is **ongoing**, its own duration measured through now rather
 * than left out.
 *
 * **The reason is read off the paired `hold_reason` row at the same
 * moment**, not off `suppliers.hold_reason` today — today's value is
 * whatever the *most recent* hold said, which is the wrong reason for
 * every period before it.
 *
 * **Forward-looking only, honestly — the same caveat migration 0072
 * states for the new discount columns.** A hold already in place the
 * first time a supplier's own row was ever written (no `existing` or
 * `adopted` row existed to diff against) has no recorded transition,
 * so a supplier held since its very first load will not show that
 * first period here — only holds and releases that happened after
 * this history began recording.
 *
 * **No suggested visualization in the design** — every other Screen 1
 * bullet has one in the document's own Report Catalog; this one does
 * not. A table, one row per hold period rather than per supplier,
 * follows this screen's own established practice for a metric with
 * more than one number per row (Fraud Prevention's duplicate and
 * segregation-of-duties tables) instead of inventing a single ranked
 * value this metric does not honestly reduce to.
 *
 * **Scoped the same way the rest of this screen already is.**
 */

interface ChangeRow {
  supplier_id: string;
  supplier_name: string;
  field: "on_hold" | "hold_reason";
  old_value: string | null;
  new_value: string | null;
  changed_at: string;
}

export interface HoldPeriod {
  supplierId: string;
  supplierName: string;
  startedAt: string;
  endedAt: string | null;
  days: number;
  reason: string | null;
}

export interface HoldHistoryReport {
  periods: HoldPeriod[];
}

export async function handleSupplierHoldHistory(
  db: D1Database,
  currentOrg: string | null = null,
  userId?: string
): Promise<RouteResult> {
  const visible = userId ? await unitsWherePermitted(db, userId, "AP.Supplier") : null;
  const scopedUnits = await scopedToChosenOrg(db, visible, currentOrg);
  const clause = unitClause({ units: scopedUnits }, "sup.org_unit_id");

  const rows = await db
    .prepare(
      `SELECT c.supplier_id AS supplier_id, sup.name AS supplier_name, c.field AS field,
              c.old_value AS old_value, c.new_value AS new_value, c.changed_at AS changed_at
       FROM supplier_field_changes c
       JOIN suppliers sup ON sup.id = c.supplier_id
       WHERE c.field IN ('on_hold', 'hold_reason') ${clause.sql}
       ORDER BY c.supplier_id, c.changed_at`
    )
    .bind(...clause.binds)
    .all<ChangeRow>();

  const bySupplier = new Map<string, { name: string; rows: ChangeRow[] }>();
  for (const row of rows.results) {
    if (!bySupplier.has(row.supplier_id)) bySupplier.set(row.supplier_id, { name: row.supplier_name, rows: [] });
    bySupplier.get(row.supplier_id)!.rows.push(row);
  }

  const now = Date.now();
  const periods: HoldPeriod[] = [];

  for (const [supplierId, { name, rows: changeRows }] of bySupplier) {
    const reasonAt = new Map<string, string | null>();
    for (const r of changeRows) if (r.field === "hold_reason") reasonAt.set(r.changed_at, r.new_value);

    let openStart: { at: string; reason: string | null } | null = null;

    for (const r of changeRows.filter((r) => r.field === "on_hold")) {
      const wasHeld = r.old_value === "1";
      const isHeld = r.new_value === "1";

      if (!wasHeld && isHeld) {
        openStart = { at: r.changed_at, reason: reasonAt.get(r.changed_at) ?? null };
      } else if (wasHeld && !isHeld && openStart) {
        periods.push({
          supplierId,
          supplierName: name,
          startedAt: openStart.at,
          endedAt: r.changed_at,
          days: (Date.parse(r.changed_at) - Date.parse(openStart.at)) / 86_400_000,
          reason: openStart.reason,
        });
        openStart = null;
      }
    }

    if (openStart) {
      periods.push({
        supplierId,
        supplierName: name,
        startedAt: openStart.at,
        endedAt: null,
        days: (now - Date.parse(openStart.at)) / 86_400_000,
        reason: openStart.reason,
      });
    }
  }

  // Most recently started first — the same "problems surface first"
  // ordering every other new report on this screen already gives.
  periods.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));

  return { status: 200, body: { periods } satisfies HoldHistoryReport };
}
