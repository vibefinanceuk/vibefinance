import type { InvoiceFacts } from "@vibefinance/shared";
import type { RouteResult } from "./org-route.js";

/**
 * **What a Project's budget has used — decision 0542.** The operator's
 * choice: warn and let rules act, never block a save.
 *
 * A project's spend is the net amount (BT-131) of every invoice line
 * coded to it, the same way PO consumption counts (0533): an invoice
 * that was discarded or returned to its supplier will never be paid,
 * so it never counts. Computed, never stored, so a budget changed in AP
 * Setup applies at once.
 *
 * Amounts are added as they stand, whatever their invoice's currency;
 * a budget is read as being in the same currency as its invoices.
 */

/** The instance states whose invoice will never be paid (as `po-matching.ts`). */
const UNPAID = ["archived", "returned_manually"];

export interface ProjectBudget {
  id: string;
  name: string;
  status: string;
  budget: number | null;
}

export async function loadProject(db: D1Database, projectId: string): Promise<ProjectBudget | null> {
  const row = await db
    .prepare("SELECT id, name, status, budget_amount FROM coding_list_entries WHERE list_type_id = 'project' AND id = ?")
    .bind(projectId)
    .first<{ id: string; name: string; status: string; budget_amount: number | null }>();
  return row ? { id: row.id, name: row.name, status: row.status, budget: row.budget_amount } : null;
}

/** Net amount coded to `projectId` on every paid-to-be invoice but `excludeInvoiceId`. */
export async function projectSpendByOthers(db: D1Database, projectId: string, excludeInvoiceId: string | null): Promise<number> {
  const row = await db
    .prepare(
      `SELECT coalesce(sum(CAST(json_extract(il.facts_json, '$."BT-131"') AS REAL)), 0) AS spent
       FROM invoice_lines il
       WHERE json_valid(il.facts_json) AND json_extract(il.facts_json, '$."coding.project"') = ?
         AND il.invoice_id != ?
         AND NOT EXISTS (
           SELECT 1 FROM process_instances pi
           WHERE pi.subject_type = 'invoice' AND pi.subject_id = il.invoice_id
             AND pi.status IN (${UNPAID.map(() => "?").join(", ")})
         )`
    )
    .bind(projectId, excludeInvoiceId ?? "", ...UNPAID)
    .first<{ spent: number }>();
  return row?.spent ?? 0;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/**
 * `project.over_budget` and `project.budget_used_pct` on each line coded
 * to a project that has a budget, for rules to act on (for example,
 * route to the project's approver). Used = other invoices' lines plus
 * every line of this invoice on the same project. Absent on every other
 * line, so no rule fires for it.
 */
export async function mergeProjectBudgetFacts<L extends InvoiceFacts>(db: D1Database, invoiceId: string, lines: L[]): Promise<L[]> {
  const ids = [...new Set(lines.map((l) => String(l["coding.project"] ?? "").trim()).filter(Boolean))];
  if (ids.length === 0) return lines;
  const used = new Map<string, { budget: number; total: number }>();
  for (const id of ids) {
    const project = await loadProject(db, id);
    if (!project || project.budget === null) continue;
    const mine = lines.filter((l) => String(l["coding.project"] ?? "").trim() === id).reduce((s, l) => s + num(l["BT-131"]), 0);
    used.set(id, { budget: project.budget, total: (await projectSpendByOthers(db, id, invoiceId)) + mine });
  }
  return lines.map((line) => {
    const u = used.get(String(line["coding.project"] ?? "").trim());
    if (!u) return line;
    return {
      ...line,
      "project.over_budget": u.total > u.budget,
      "project.budget_used_pct": u.budget > 0 ? Math.round((u.total / u.budget) * 10000) / 100 : u.total > 0 ? 100 : 0,
    } as L;
  });
}

/**
 * `GET /invoices/:id/project-usage?project=<id>` — the Coding pop-out's
 * budget bar. What other invoices have used; the pop-out adds this
 * invoice's own lines as they stand on screen, saved or not.
 */
export async function handleProjectUsage(db: D1Database, invoiceId: string, projectId: string | null): Promise<RouteResult> {
  if (!projectId) return { status: 400, body: { error: "project is required" } };
  const project = await loadProject(db, projectId);
  if (!project) return { status: 404, body: { error: `project ${projectId} does not exist` } };
  return {
    status: 200,
    body: {
      projectId: project.id,
      name: project.name,
      status: project.status,
      budget: project.budget,
      usedByOthers: project.budget === null ? null : await projectSpendByOthers(db, project.id, invoiceId),
    },
  };
}
