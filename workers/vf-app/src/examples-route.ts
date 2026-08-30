export interface RouteResult {
  status: number;
  body: Record<string, unknown>;
}

interface ExampleRow {
  id: string;
  invoice_json: string;
  expect_match: number;
  confirmed_by: string | null;
}

/** GET /rules/:ruleId/versions/:version/examples — lets the author (or
 * a future UI) see every worked example a compiled rule generated,
 * and which ones are still unconfirmed. */
export async function handleListExamples(
  db: D1Database,
  ruleId: string,
  version: number
): Promise<RouteResult> {
  const rows = await db
    .prepare(
      "SELECT id, invoice_json, expect_match, confirmed_by FROM rule_examples WHERE rule_id = ? AND rule_version = ? ORDER BY id"
    )
    .bind(ruleId, version)
    .all<ExampleRow>();

  const examples = rows.results.map((r) => ({
    id: r.id,
    invoice: JSON.parse(r.invoice_json),
    expectMatch: r.expect_match === 1,
    confirmedBy: r.confirmed_by,
  }));

  return { status: 200, body: { ruleId, version, examples } };
}

/**
 * POST /rules/examples/:exampleId/confirm — "The customer said yes,
 * this is what I meant" (Blueprint, rule_examples.confirmed_by).
 * Not nested under a rule/version in its URL — example ids are
 * globally unique (crypto.randomUUID(), see compile-route.ts), so a
 * flatter route is simpler without losing anything.
 */
export async function handleConfirmExample(
  db: D1Database,
  exampleId: string,
  confirmedBy: unknown
): Promise<RouteResult> {
  if (typeof confirmedBy !== "string" || !confirmedBy) {
    return { status: 400, body: { error: "confirmedBy (string) is required" } };
  }

  const existing = await db.prepare("SELECT id FROM rule_examples WHERE id = ?").bind(exampleId).first();
  if (!existing) {
    return { status: 404, body: { error: `example ${exampleId} does not exist` } };
  }

  await db.prepare("UPDATE rule_examples SET confirmed_by = ? WHERE id = ?").bind(confirmedBy, exampleId).run();

  return { status: 200, body: { id: exampleId, confirmedBy } };
}
