/**
 * A usage report for one environment, one period. Blueprint,
 * "Subsystem three", usage_periods: "invoices_processed... the billing
 * number. rules_evaluated... Load, and a proxy for how much of the
 * product they actually use. active_users... A count, never a list."
 *
 * What the payload must never contain, verbatim from the Blueprint:
 * "supplier names, invoice numbers, amounts, rule text, user
 * identities, or anything derived from them closely enough to be
 * re-identified. Counts and nothing else." Every field here is a
 * count or a period key — nothing that could re-identify a specific
 * invoice, supplier, or person. If a future field doesn't fit that
 * description, it doesn't belong in this type.
 */
export interface UsageReport {
  /**
   * The environment this usage belongs to (e.g. "Acme-production") —
   * decision 0036. Re-keyed from customerId: a customer's sandbox and
   * production deployments report their usage separately, so sandbox
   * testing volume can never inflate the figures a consumption-based
   * bill is computed from. This field is serialised directly onto the
   * wire, so its name must match what vf-licence's POST /usage
   * actually expects.
   */
  environmentId: string;
  /** Calendar month, "YYYY-MM". Composite key with environmentId on
   * the receiving side makes every push idempotent — see
   * docs/decisions/0004-usage-telemetry.md. */
  periodKey: string;
  invoicesProcessed: number;
  rulesEvaluated: number;
  /**
   * Not yet computable — vf-app has no user/auth concept at all today,
   * so there's nothing to count. `null` rather than a fabricated `0`,
   * so the payload shape is stable and ready for when user tracking
   * exists, without silently reporting a wrong number in the meantime.
   */
  activeUsers: number | null;
  /** e.g. { "matched": 12, "no_match": 3 } — whatever outcome strings
   * the interpreter actually produces, never a fixed enum here, since
   * this type must not need to change every time the interpreter's
   * vocabulary of outcomes does. */
  outcomeCounts: Record<string, number>;
}
