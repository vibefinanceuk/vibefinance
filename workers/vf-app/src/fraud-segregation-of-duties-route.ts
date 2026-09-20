import { unitsWherePermitted, scopedToChosenOrg, unitClause } from "./enforce.js";
import type { RouteResult } from "./org-route.js";

/**
 * Segregation-of-duties flags — decision 0424, Fraud Prevention's fifth
 * real metric (the design's own sixth bullet under Screen 3 — Fraud &
 * Risk Detection's key metrics: *"Segregation-of-duties flags — the
 * same person claiming and approving where the process should prevent
 * it."*).
 *
 * **Anchored on `AP.Approve`, the design's own named action — not a
 * fully generic "any two permissions."** The design speaks
 * specifically about *approving*; a rule that fired for, say, the same
 * person completing both Validation and Coding would be answering a
 * question nobody asked and would be far noisier than the one real
 * control this metric exists to check. So one side of the pair is
 * fixed: a completed task whose stage declared `required_permission =
 * 'AP.Approve'` (`process_stages.required_permission`, decision 0048's
 * own "a stage declares its own permission," not a hardcoded stage id
 * — `ap-live-approval`'s stage is found by what it requires, the same
 * way `workflow-engine.ts` itself checks a rule's `assign_task` against
 * its own stage).
 *
 * **The other side is generic on purpose.** Rather than naming a
 * second specific permission (which would silently stop working the
 * day a process is reshaped), the flag fires when that same person also
 * completed *any other task on the same invoice whose stage required a
 * different, non-null permission* — claiming and approving, in the
 * design's own words, without deciding for the operator which earlier
 * stage counts as "claiming." A stage with no declared permission at
 * all (Matching, Coding, Review on `ap-live` — decision 0080's own
 * pass-through stages) never contributes the other half; there is
 * nothing to segregate from a stage nobody had to be permitted for.
 *
 * **`completed_by`, not `claimed_by`, on both sides.** Consistent with
 * `workload-route.ts`'s and decision 0423's own "credit the work
 * actually finished" convention — a task claimed and then reassigned or
 * returned was not, in the end, that person's decision.
 *
 * **One flag per invoice, not per pair of tasks.** An invoice either
 * has this problem or it doesn't; a person who touched three
 * non-approval stages before approving is one finding, not three. The
 * flagged invoice lists every stage that person completed on it, so
 * the reviewer can see the whole picture at once.
 *
 * **Gated `AP.FraudReview`, scoped by the invoice's own org unit** —
 * the same gate and scoping column every other Fraud Prevention route
 * already uses.
 *
 * **A worklist, not a top-N ranking** — the same shape
 * `/fraud/duplicates`, `/fraud/unapproved-suppliers`, and
 * `/fraud/statistical-outliers` already use: every invoice that
 * matches is returned, nothing capped. Sorted by invoice id for a
 * stable order — there is no severity scale here, only a yes/no per
 * invoice.
 */

interface FlagRow {
  invoice_id: string;
  invoice_number: string | null;
  user_id: string;
  user_name: string | null;
  required_permission: string;
  stage_name: string | null;
  completed_at: string;
}

export interface SegregationOfDutiesStage {
  requiredPermission: string;
  stageName: string | null;
  completedAt: string;
}

export interface SegregationOfDutiesInvoice {
  invoiceId: string;
  invoiceNumber: string | null;
  userId: string;
  userName: string | null;
  stages: SegregationOfDutiesStage[];
}

export interface SegregationOfDutiesReport {
  invoices: SegregationOfDutiesInvoice[];
}

export async function handleSegregationOfDuties(
  db: D1Database,
  currentOrg: string | null = null,
  userId?: string
): Promise<RouteResult> {
  const visible = userId ? await unitsWherePermitted(db, userId, "AP.FraudReview") : null;
  const scopedUnits = await scopedToChosenOrg(db, visible, currentOrg);
  const clause = unitClause({ units: scopedUnits }, "h.org_unit_id");

  const rows = await db
    .prepare(
      `SELECT h.id AS invoice_id, h.invoice_number AS invoice_number,
              t.completed_by AS user_id, u.name AS user_name,
              ps.required_permission AS required_permission, ps.name AS stage_name,
              t.completed_at AS completed_at
       FROM tasks t
       JOIN process_stages ps ON ps.id = t.stage_id
       JOIN stage_visits v ON v.id = t.stage_visit_id
       JOIN process_instances pi ON pi.id = v.process_instance_id
       JOIN invoice_headers h ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
       LEFT JOIN org_users u ON u.id = t.completed_by
       WHERE t.status = 'completed' AND t.completed_by IS NOT NULL
             AND ps.required_permission IS NOT NULL ${clause.sql}`
    )
    .bind(...clause.binds)
    .all<FlagRow>();

  const byInvoiceUser = new Map<string, FlagRow[]>();
  for (const row of rows.results) {
    const key = `${row.invoice_id}::${row.user_id}`;
    const group = byInvoiceUser.get(key);
    if (group) group.push(row);
    else byInvoiceUser.set(key, [row]);
  }

  const invoices: SegregationOfDutiesInvoice[] = [];
  for (const group of byInvoiceUser.values()) {
    const approvals = group.filter((r) => r.required_permission === "AP.Approve");
    const others = group.filter((r) => r.required_permission !== "AP.Approve");
    if (approvals.length === 0 || others.length === 0) continue;

    const first = group[0];
    const stages = [...group]
      .sort((a, b) => a.completed_at.localeCompare(b.completed_at))
      .map((r) => ({
        requiredPermission: r.required_permission,
        stageName: r.stage_name,
        completedAt: r.completed_at,
      }));

    invoices.push({
      invoiceId: first.invoice_id,
      invoiceNumber: first.invoice_number,
      userId: first.user_id,
      userName: first.user_name,
      stages,
    });
  }

  invoices.sort((a, b) => a.invoiceId.localeCompare(b.invoiceId));

  return { status: 200, body: { invoices } satisfies SegregationOfDutiesReport };
}
