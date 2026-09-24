import type { RouteResult } from "./org-route.js";
import { getOrgMatchingConfig } from "./po-matching.js";
import { stateOf } from "./rules-list-route.js";

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

/**
 * **Standard matching rules — decision 0474.** The operator's own
 * original suggestion (quoted in decision 0465): *"Perhaps we also
 * consider a check-box in the AP Setup screen to enable, or disable
 * standard matching rules?"* Settled directly, narrower than decision
 * 0465's own first reading: the checkbox **only enables/disables a
 * rule that already exists** — it does not compile or activate one.
 * Creating a standard rule for the first time is unchanged, ordinary
 * rule authoring (write the sentence, compile, confirm every generated
 * example, activate) on whichever stage's own Rules screen the
 * operator chooses — the same "never auto-promote a generated rule"
 * gate every rule in this system has always had, untouched here.
 *
 * **Identified by name, not a new column.** Decision 0465 already
 * rejected a "system rule" concept distinct from a customer-authored
 * one as a departure from decision 0031's own closed-vocabulary
 * principle. These four names are the only new "mechanism" — a
 * closed, explicit list (never `SELECT * FROM rules`, the exact
 * silent-everything shape decision 0355 already fixed once for this
 * same table) that this tab looks for by exact name, across every
 * stage in the org, since AP Setup has no single "the Matching stage"
 * of its own.
 *
 * **"PO line not found"'s own suggested sentence now guards on BT-13
 * — decision 0477, reported live.** `po.line_reference_found` is
 * `false` both for a real matching exception (a PO invoice whose line
 * genuinely could not be found) and for an ordinary, wholly non-PO
 * invoice (no BT-13 at all) — the operator's own words: *"I expect
 * that Non-PO invoice will stop in the Coding queue... [not] bypass
 * the matching queue."* Without the guard, an operator who compiled
 * the suggested sentence verbatim would route every non-PO invoice
 * into an AP Matching task instead, since `assign_task` blocks stage
 * progression. No new fact needed — `BT-13` ("purchase order
 * reference") is already a real, `is_present`-testable vocabulary
 * field; the other three suggested sentences below need no equivalent
 * fix, since their own facts (`po.line_price_matched`,
 * `po.line_quantity_matched`, `po.line_unit_mismatch`) are left
 * genuinely *absent*, not `false`, when there is no PO line to
 * compare against — `evaluateCondition`'s own `is`/`is_not` never
 * fire on an absent fact, so those three already leave a non-PO
 * invoice alone. Only `po.line_reference_found`/`po.line_matched` are
 * deliberately "false, never absent" (decision 0466's own design), the
 * one property that makes this specific ambiguity possible.
 */
export const STANDARD_MATCHING_RULES = [
  {
    key: "po_line_not_found",
    name: "Standard rule: PO line not found",
    fact: "po.line_reference_found",
    suggestedSentence:
      "If the invoice has a purchase order reference and a purchase order line cannot be found for an invoice line, assign a task to the AP Matching team requiring AP.Match.",
  },
  {
    key: "price_mismatch",
    name: "Standard rule: Price mismatch",
    fact: "po.line_price_matched",
    suggestedSentence:
      "If a line's price does not match its purchase order line, assign a task to the AP Matching team requiring AP.Match.",
  },
  {
    key: "quantity_mismatch",
    name: "Standard rule: Quantity mismatch",
    fact: "po.line_quantity_matched",
    suggestedSentence:
      "If a line's quantity does not match its purchase order line, assign a task to the AP Matching team requiring AP.Match.",
  },
  {
    key: "unit_mismatch",
    name: "Standard rule: Unit of measure mismatch",
    fact: "po.line_unit_mismatch",
    suggestedSentence:
      "If a line's unit of measure does not match its purchase order line, assign a task to the AP Matching team requiring AP.Match.",
  },
] as const;

interface StandardRuleRow {
  id: string;
  name: string;
  enabled: number;
  stage_name: string | null;
  process_name: string | null;
  approved_at: string | null;
  examples_total: number;
  examples_confirmed: number;
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

/**
 * **Every rule anywhere in the org named exactly one of
 * `STANDARD_MATCHING_RULES`'s own four names** — a closed, explicit
 * list of names, not `SELECT * FROM rules`. Usually zero or one match
 * per name; more than one (the same name authored on two different
 * stages) is shown as two separate rows rather than one silently
 * picked over the other, so the operator can see and toggle each one
 * specifically. The latest version only, the same `MAX(version)` join
 * `handleListRules` already uses, since that is what `enabled` and
 * `approved_at` actually govern.
 */
export async function handleGetStandardMatchingRules(db: D1Database): Promise<RouteResult> {
  const names = STANDARD_MATCHING_RULES.map((r) => r.name);
  const placeholders = names.map(() => "?").join(", ");

  const rows = await db
    .prepare(
      `SELECT r.id, r.name, r.enabled, s.name AS stage_name, p.name AS process_name,
              v.approved_at,
              (SELECT count(*) FROM rule_examples e
                 WHERE e.rule_id = r.id AND e.rule_version = v.version) AS examples_total,
              (SELECT count(*) FROM rule_examples e
                 WHERE e.rule_id = r.id AND e.rule_version = v.version
                   AND e.confirmed_by IS NOT NULL) AS examples_confirmed
       FROM rules r
       JOIN rule_sets rs ON rs.id = r.rule_set_id
       LEFT JOIN process_stages s ON s.rule_set_id = rs.id
       LEFT JOIN processes p ON p.id = s.process_id
       LEFT JOIN rule_versions v ON v.rule_id = r.id
         AND v.version = (SELECT MAX(v2.version) FROM rule_versions v2 WHERE v2.rule_id = r.id)
       WHERE r.name IN (${placeholders})`
    )
    .bind(...names)
    .all<StandardRuleRow>();

  const matchesByName = new Map<string, StandardRuleRow[]>();
  for (const row of rows.results) {
    const existing = matchesByName.get(row.name) ?? [];
    existing.push(row);
    matchesByName.set(row.name, existing);
  }

  return {
    status: 200,
    body: {
      standardRules: STANDARD_MATCHING_RULES.map((standard) => ({
        key: standard.key,
        name: standard.name,
        fact: standard.fact,
        suggestedSentence: standard.suggestedSentence,
        matches: (matchesByName.get(standard.name) ?? []).map((row) => ({
          ruleId: row.id,
          stageName: row.stage_name,
          processName: row.process_name,
          enabled: row.enabled === 1,
          state: stateOf({ approved_at: row.approved_at, enabled: row.enabled, examples_total: row.examples_total }),
        })),
      })),
    },
  };
}
