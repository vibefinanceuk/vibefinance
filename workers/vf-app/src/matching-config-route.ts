import type { RouteResult } from "./org-route.js";
import { getOrgMatchingConfig } from "./po-matching.js";

/**
 * The write API for AP Setup's own Matching tab — decision 0472.
 *
 * `po-matching.ts`'s `getOrgMatchingConfig`/`org_matching_config` have
 * existed since migration `0078` (decisions 0465/0468/0469), read on
 * every `mergePoMatchFacts` call — but until now the singleton row was
 * reachable only by direct SQL, the same "schema and resolver first,
 * routes later" sequencing decision 0439 already used for Approval
 * Hierarchy. This is that other half for Matching, following the exact
 * same shape `approval-config-route.ts` already established: a
 * singleton config, read whole and written whole.
 *
 * **`handleGetMatchingConfig` reuses `getOrgMatchingConfig` directly**
 * rather than re-querying — one real reader of the row, not two that
 * could drift; its already-camelCased, already-boolean-coerced shape
 * is exactly what the tab's own form needs, with no reshaping here.
 *
 * **No supplier-specific override here.** `supplier.amountTolerancePct`/
 * `supplier.quantityTolerancePct` (decision 0209) still supersede this
 * org-wide default when a supplier has its own — that part of
 * `po-matching.ts` is unchanged by this route existing. This tab
 * configures the fallback only, per decision 0468's own scoping.
 */

interface UpdateMatchingConfigBody {
  amountTolerancePct?: unknown;
  quantityTolerancePct?: unknown;
  quantityMatchingEnabled?: unknown;
}

export async function handleGetMatchingConfig(db: D1Database): Promise<RouteResult> {
  const config = await getOrgMatchingConfig(db);
  return { status: 200, body: { ...config } };
}

/**
 * **Replace, not merge — the same discipline `handleUpdateApprovalConfig`
 * already holds for its own singleton.** All three fields are required
 * on every write, so a caller can never silently leave one field's old
 * value in place while believing it sent a complete picture.
 */
export async function handleUpdateMatchingConfig(
  db: D1Database,
  body: UpdateMatchingConfigBody
): Promise<RouteResult> {
  const { amountTolerancePct, quantityTolerancePct, quantityMatchingEnabled } = body;

  if (typeof amountTolerancePct !== "number" || !Number.isFinite(amountTolerancePct) || amountTolerancePct < 0) {
    return { status: 422, body: { error: "amountTolerancePct must be a number, 0 or greater" } };
  }
  if (typeof quantityTolerancePct !== "number" || !Number.isFinite(quantityTolerancePct) || quantityTolerancePct < 0) {
    return { status: 422, body: { error: "quantityTolerancePct must be a number, 0 or greater" } };
  }
  if (typeof quantityMatchingEnabled !== "boolean") {
    return { status: 422, body: { error: "quantityMatchingEnabled must be true or false" } };
  }

  await db
    .prepare(
      "UPDATE org_matching_config SET amount_tolerance_pct = ?, quantity_tolerance_pct = ?, quantity_matching_enabled = ?, updated_at = ? WHERE id = 1"
    )
    .bind(amountTolerancePct, quantityTolerancePct, quantityMatchingEnabled ? 1 : 0, new Date().toISOString())
    .run();

  return { status: 200, body: { amountTolerancePct, quantityTolerancePct, quantityMatchingEnabled } };
}
