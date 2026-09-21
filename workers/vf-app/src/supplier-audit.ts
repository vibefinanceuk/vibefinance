/**
 * A general field-change history for suppliers — decision 0427, the
 * operator's own chosen scope, wider than the hold-history metric it
 * was built to unblock.
 *
 * **Every field any of this codebase's three supplier write paths can
 * change**, watched by one shared diff, called from all three:
 * `load-suppliers.ts`'s own CSV mirror-load upsert, `handleUpdateSupplier`
 * (the hand-edit route), and `handleSetSupplierState` (hold/release/
 * activate/deactivate). A row is written only when a field's own value
 * actually transitions — never on every touch, and never for a
 * brand-new supplier's own first-ever values, which have nothing to
 * have transitioned from.
 *
 * **A separate mechanism from decision 0350's own `detectSupplierChanges`**
 * (`supplier-maintenance.ts`). That one watches four fields to decide
 * whether to spawn a Supplier Maintenance review task — a narrow,
 * purpose-built trigger, left exactly as it is. This one is a
 * queryable historical record across every field, for a different
 * job, and neither reads from nor writes to the other.
 */

/** Every column any write path can change, in the shape a caller already has it. */
export const AUDITED_FIELDS = [
  "erp_identifier",
  "name",
  "vat_id",
  "electronic_address",
  "country",
  "payment_terms",
  "on_hold",
  "hold_reason",
  "match_option",
  "amount_tolerance_pct",
  "quantity_tolerance_pct",
  "discount_pct",
  "discount_days",
  "erp_site_identifier",
  "is_pay_site",
  "is_procurement_site",
  "address_line",
  "city",
  "postal_code",
  "email",
  "phone",
  "status",
  "org_unit_id",
] as const;

export type AuditedField = (typeof AUDITED_FIELDS)[number];

/** A caller passes only the fields its own write actually touches — the rest are left out, not compared. */
export type SupplierAuditSnapshot = Partial<Record<AuditedField, string | number | boolean | null | undefined>>;

export interface SupplierFieldChange {
  field: AuditedField;
  oldValue: string | null;
  newValue: string | null;
}

/** `0`/`1`/`true`/`false` and `""`/`null`/`undefined` all read as one comparable, storable shape — a boolean column and a text column diff the same way. */
function normalize(value: string | number | boolean | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value ? "1" : "0";
  return String(value);
}

/**
 * **Only the fields present in `after`** are compared — a write path
 * that never touches `hold_reason` (the hand-edit route, say) must
 * never manufacture a "changed" row for it just because `before`
 * carried a value `after` did not restate.
 */
export function diffSupplierFields(
  before: SupplierAuditSnapshot,
  after: SupplierAuditSnapshot
): SupplierFieldChange[] {
  const changes: SupplierFieldChange[] = [];
  for (const field of AUDITED_FIELDS) {
    if (!(field in after)) continue;
    const oldValue = normalize(before[field]);
    const newValue = normalize(after[field]);
    if (oldValue !== newValue) changes.push({ field, oldValue, newValue });
  }
  return changes;
}

/** Insert-only, batched — one write per changed field, never one per supplier touched. */
export async function recordSupplierFieldChanges(
  db: D1Database,
  supplierId: string,
  changes: SupplierFieldChange[],
  changedBy: string
): Promise<void> {
  if (changes.length === 0) return;
  await db.batch(
    changes.map((c) =>
      db
        .prepare(
          `INSERT INTO supplier_field_changes (id, supplier_id, field, old_value, new_value, changed_by)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(crypto.randomUUID(), supplierId, c.field, c.oldValue, c.newValue, changedBy)
    )
  );
}
