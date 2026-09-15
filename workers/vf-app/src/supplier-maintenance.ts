import { handleCreateProcessInstance, visitCurrentStage } from "./workflow-engine.js";

/**
 * A new or changed supplier record spawns its own "Supplier
 * Maintenance" process instance — decision 0350. Reported live: "a
 * new Supplier Maintenance process... identify that a new supplier
 * invoice has been received, or maybe some information has changed."
 *
 * **A separate process, not a stage on the existing AP one** — the
 * operator's own reasoning: "a separate process flow would be more
 * efficient for monitoring and reporting." A changed supplier is not
 * really about any one invoice, and tying maintenance work to
 * whichever invoice happened to arrive first would be an odd fit
 * once the ERP catches up and later invoices stop needing it at all.
 *
 * **A known, fixed id, seeded once.** This is not looked up by name:
 * `processes.id` is an opaque, customer-chosen string like any other,
 * and this is the one this deployment's own seed data uses.
 */
export const SUPPLIER_MAINTENANCE_PROCESS_ID = "supplier-maintenance";

export type SupplierMaintenanceReason = "new_supplier" | "changed";

/**
 * **Fails soft, not loud.** Not every deployment has seeded this
 * process — a fresh test database, or a customer who has not yet
 * adopted this feature — and a supplier being created or loaded
 * must never fail because an optional, later-added maintenance
 * process doesn't exist yet. `null` means "nothing to report,"
 * distinct from a real instance id.
 */
export async function spawnSupplierMaintenanceInstance(
  db: D1Database,
  supplierId: string,
  supplierName: string,
  reason: SupplierMaintenanceReason,
  changedFields: readonly string[] = []
): Promise<string | null> {
  const process = await db
    .prepare("SELECT id FROM processes WHERE id = ?")
    .bind(SUPPLIER_MAINTENANCE_PROCESS_ID)
    .first();
  if (!process) return null;

  const instanceResult = await handleCreateProcessInstance(db, SUPPLIER_MAINTENANCE_PROCESS_ID, {
    subjectType: "supplier",
    subjectId: supplierId,
  });
  if (instanceResult.status >= 400) return null;
  const instanceId = (instanceResult.body as { id: string }).id;

  await visitCurrentStage(db, instanceId, {
    id: supplierId,
    name: supplierName,
    reason,
    // Comma-separated, matching intake.attempted's own established
    // shape (decision 0169) — so the existing `contains` operator
    // already applies to it, rather than a new operator invented for
    // this one field.
    changed_fields: changedFields.join(","),
  });

  return instanceId;
}

/**
 * **Which of a supplier's own fields differ from what was on file** —
 * the change-detection decision 0208 never built, because a load was
 * always meant to replace rather than merge. This compares, but still
 * never blocks or alters the replace itself: the load always writes
 * the new values; this only says which ones were different, so a
 * maintenance task can be raised alongside it.
 *
 * Scoped deliberately narrow: name, VAT id, electronic address, and
 * payment terms are the fields worth a human's own attention. There
 * is no bank or payment-account field in this schema at all today —
 * worth knowing, not something this quietly works around.
 */
const WATCHED_FIELDS = ["name", "vat_id", "electronic_address", "payment_terms"] as const;

export interface SupplierComparable {
  name: string | null;
  vat_id: string | null;
  electronic_address: string | null;
  payment_terms: string | null;
}

export function detectSupplierChanges(existing: SupplierComparable, incoming: SupplierComparable): string[] {
  return WATCHED_FIELDS.filter((field) => (existing[field] ?? null) !== (incoming[field] ?? null));
}
