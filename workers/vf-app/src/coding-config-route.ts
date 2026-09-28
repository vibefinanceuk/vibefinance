import type { RouteResult } from "./org-route.js";

/**
 * **AP Setup's Account Coding settings — decision 0540.** One
 * customer-wide setting so far: whether a coded line carries a Cost
 * Centre or a Project, never both (`exclusive`, the default), or may
 * carry both (`both`, the behaviour before 0540).
 *
 * The operator's own reasoning: "a line item cost is either related to
 * a cost centre OR a project" — as an ERP books it, one real cost
 * object per line (a department's operating cost, or a project's). Made
 * an option because some organisations book a project line against its
 * owning department too.
 *
 * Where `exclusive` applies:
 *  - **keying** (`key-fields-route.ts`): a save that keys one of the two
 *    on a line holding the other clears the other (recorded, like any
 *    keyed change); a save keying both is refused
 *    (`cost_centre_and_project`);
 *  - **Complete at a coding stage** (`codingGapsForTask`): Cost Centre
 *    and Project together count as one requirement, "cost centre or
 *    project", and a line holding both is a gap;
 *  - **suggestions** (`coding-suggestions.ts`): earlier lines holding
 *    both are not drawn on;
 *  - **the Coding pop-out**: one card with a Cost centre | Project switch.
 */

export type CostObjectRule = "exclusive" | "both";

/**
 * The rule in force. **`both` when it cannot be read** (the table not
 * there yet, before migration `0098`): never impose a rule nobody chose.
 */
export async function getCostObjectRule(db: D1Database): Promise<CostObjectRule> {
  try {
    const row = await db.prepare("SELECT cost_object_rule FROM org_coding_config WHERE id = 1").first<{ cost_object_rule: string }>();
    return row?.cost_object_rule === "exclusive" ? "exclusive" : "both";
  } catch {
    return "both";
  }
}

export async function handleGetCodingConfig(db: D1Database): Promise<RouteResult> {
  return { status: 200, body: { costObjectRule: await getCostObjectRule(db) } };
}

/** Replace, not merge — the same discipline as `/matching-config`. */
export async function handleUpdateCodingConfig(db: D1Database, body: Record<string, unknown>): Promise<RouteResult> {
  const rule = body.costObjectRule;
  if (rule !== "exclusive" && rule !== "both") {
    return { status: 422, body: { error: 'costObjectRule must be "exclusive" or "both"' } };
  }
  await db
    .prepare("UPDATE org_coding_config SET cost_object_rule = ?, updated_at = ? WHERE id = 1")
    .bind(rule, new Date().toISOString())
    .run();
  return { status: 200, body: { costObjectRule: rule } };
}
