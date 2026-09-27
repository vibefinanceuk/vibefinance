import type { InvoiceFacts } from "@vibefinance/shared";
import { declaredFiltersFor } from "./coding-list-route.js";
import { resolveFieldVisibility } from "./field-visibility-route.js";

/**
 * Coding values checked against Account Coding's own lists — decision
 * 0511.
 *
 * Until now a line's coding was free text as far as the server knew.
 * The Coding pop-out (decisions 0453–0462) only ever *offered* real
 * entries, narrowed by the invoice's company code and, for General
 * Ledger Code, by the line's Commodity Code — but `POST
 * /invoices/:id/key` accepted whatever it was sent, and a UBL
 * invoice's own `cbc:AccountingCost` reached BT-133 unchecked.
 *
 * **Where that bit**: `approval-hierarchy.ts`'s `resolveChainFor` looked
 * the value up, found nothing, and reported *"the chain ran out
 * uncovered"* — sending the line to the Default Approver as though the
 * amount were beyond every limit, with nothing saying the real reason
 * was a code nobody configured.
 *
 * **One check, two callers**, so the save route and the facts a rule
 * sees can never disagree about what "valid" means:
 *
 * - `key-fields-route.ts` **refuses** a keyed value that fails
 *   (the operator's own choice: refuse, not save-and-flag).
 * - `mergeCodingValidityFacts` below **flags** a stored value that
 *   fails — a supplier-supplied BT-133 is what the document said, so
 *   the invoice is captured as ever and the line carries
 *   `coding.line_invalid` for a rule, the viewer and routing to read.
 *
 * **Mirrors the picker exactly, not a stricter reading of it.** A value
 * the pop-out would offer must pass here, or a person could choose one
 * and have it refused. So a filter is applied only where the picker
 * applies one: company code only when the invoice has an org, and
 * Commodity Code only when the line carries one.
 *
 * **Strict for General Ledger Code, lenient for Cost Centre** — the
 * operator's own choice. General Ledger Code keeps the picker's
 * existing reading (`codingListFilterClause`): an entry with no filter
 * row for a dimension being filtered on does not match. Cost Centre is
 * newly narrowed by company code here (0453 said it was; its picker
 * never actually was), so a cost centre with **no** company code set
 * at all stays valid for every company — live cost centres loaded
 * before anybody linked them to a company must not suddenly vanish
 * from the picker or fail every save. One set carries that, read by
 * both this module and `ledger-route.ts`'s own picker query.
 */

/** Lists where "no filter row for this dimension" means "applies to all". */
export const LENIENT_FILTER_LISTS: ReadonlySet<string> = new Set(["cost_centre"]);

/** Line fields holding an Account Coding value, and the list each draws from. */
export const CODING_FIELD_LISTS: Readonly<Record<string, string>> = {
  "BT-133": "cost_centre",
  "coding.project": "project",
  "coding.commodity_code": "commodity_code",
  "coding.gl_code": "gl_code",
};

export type CodingProblemReason = "not_on_list" | "wrong_company" | "wrong_commodity";

export interface CodingProblem {
  field: string;
  value: string;
  reason: CodingProblemReason;
}

/** Which filter dimension a failed filter maps to, as a reason. */
const FILTER_REASON: Record<string, CodingProblemReason> = {
  company_code: "wrong_company",
  commodity_code: "wrong_commodity",
};

/**
 * Checks one line's coding. Only the fields named in `only` are
 * checked when it is given — the save route's own use, so an
 * untouched, already-flagged supplier value never blocks somebody
 * saving an unrelated change on the same line.
 */
export async function checkLineCoding(
  db: D1Database,
  orgUnitId: string | null,
  lineFacts: Record<string, unknown>,
  only?: ReadonlySet<string>,
  cache: CodingLookupCache = new CodingLookupCache(db)
): Promise<CodingProblem[]> {
  const problems: CodingProblem[] = [];

  for (const [field, listType] of Object.entries(CODING_FIELD_LISTS)) {
    if (only && !only.has(field)) continue;
    const raw = lineFacts[field];
    // Nothing coded is not a coding problem — the same "not applicable
    // to this line" reading `resolveCostObjects` gives an uncoded
    // dimension.
    if (raw === undefined || raw === null) continue;
    const value = String(raw).trim();
    if (value === "") continue;

    if (!(await cache.exists(listType, value))) {
      problems.push({ field, value, reason: "not_on_list" });
      continue;
    }

    for (const filterType of await cache.declaredFilters(listType)) {
      const context = filterType === "company_code" ? orgUnitId : lineFacts[`coding.${filterType}`];
      if (context === undefined || context === null || String(context).trim() === "") continue;
      const lenient = LENIENT_FILTER_LISTS.has(listType);
      if (!(await cache.hasFilter(listType, value, filterType, String(context).trim(), lenient))) {
        problems.push({ field, value, reason: FILTER_REASON[filterType] ?? "not_on_list" });
        break;
      }
    }
  }

  return problems;
}

/**
 * `coding.line_invalid` on every line — the flag half of decision 0511.
 *
 * Computed fresh, never stored, exactly as `mergePoMatchFacts` computes
 * `po.line_*`: an Account Coding list can gain the missing entry after
 * the invoice arrived, and a rule at the Approval stage needs today's
 * answer. A comma-separated list of the failing fields, the same shape
 * `validation.failures` uses, so `contains` applies; set to `""` on a
 * line whose coding is all valid, so a rule can tell "checked and
 * clean" from a line nothing looked at.
 */
export async function mergeCodingValidityFacts<L extends InvoiceFacts>(
  db: D1Database,
  orgUnitId: string | null,
  lines: L[]
): Promise<(L & { "coding.line_invalid": string })[]> {
  const cache = new CodingLookupCache(db);
  return Promise.all(
    lines.map(async (line) => {
      const problems = await checkLineCoding(db, orgUnitId, line as Record<string, unknown>, undefined, cache);
      return { ...line, "coding.line_invalid": problems.map((p) => p.field).join(",") };
    })
  );
}

/**
 * One lookup per distinct question per call — an invoice of forty lines
 * all coded to the same cost centre asks the database once, not forty
 * times.
 */
export class CodingLookupCache {
  private readonly existsMemo = new Map<string, Promise<boolean>>();
  private readonly declaredMemo = new Map<string, Promise<string[]>>();
  private readonly filterMemo = new Map<string, Promise<boolean>>();

  constructor(private readonly db: D1Database) {}

  exists(listType: string, id: string): Promise<boolean> {
    const key = `${listType}\u0000${id}`;
    let hit = this.existsMemo.get(key);
    if (!hit) {
      // Cost Centre keeps its own table (decision 0016, restated by
      // 0444); the other three share `coding_list_entries`.
      const query =
        listType === "cost_centre"
          ? this.db.prepare("SELECT 1 AS found FROM cost_centres WHERE id = ?").bind(id)
          : this.db
              .prepare("SELECT 1 AS found FROM coding_list_entries WHERE list_type_id = ? AND id = ?")
              .bind(listType, id);
      hit = query.first().then((row) => !!row);
      this.existsMemo.set(key, hit);
    }
    return hit;
  }

  declaredFilters(listType: string): Promise<string[]> {
    let hit = this.declaredMemo.get(listType);
    if (!hit) {
      hit = declaredFiltersFor(this.db, listType);
      this.declaredMemo.set(listType, hit);
    }
    return hit;
  }

  /**
   * Whether `id` is linked to `filterValue` on `filterType`. `lenient`:
   * an entry with no link on that dimension at all also passes.
   */
  hasFilter(listType: string, id: string, filterType: string, filterValue: string, lenient = false): Promise<boolean> {
    const key = [listType, id, filterType, filterValue, lenient ? "1" : "0"].join("\u0000");
    let hit = this.filterMemo.get(key);
    if (!hit) {
      hit = this.db
        .prepare(
          `SELECT
             EXISTS (SELECT 1 FROM coding_list_entry_filters
                     WHERE owner_list_type_id = ?1 AND owner_entry_id = ?2
                       AND filter_list_type_id = ?3 AND filter_entry_id = ?4) AS linked,
             EXISTS (SELECT 1 FROM coding_list_entry_filters
                     WHERE owner_list_type_id = ?1 AND owner_entry_id = ?2
                       AND filter_list_type_id = ?3) AS anyLink`
        )
        .bind(listType, id, filterType, filterValue)
        .first<{ linked: number; anyLink: number }>()
        .then((row) => row?.linked === 1 || (lenient && row?.anyLink === 0));
      this.filterMemo.set(key, hit);
    }
    return hit;
  }
}

/**
 * `mergeCodingValidityFacts` for a stored invoice — its company code
 * read from `invoice_headers.org_unit_id`, the same value the Coding
 * pop-out filters by (`stored.orgUnitId`, decision 0198). Read at call
 * time, not passed in, because at intake the org is placed by the
 * capture path's own `enrichFacts` hook only moments before.
 */
export async function mergeCodingValidityForInvoice<L extends InvoiceFacts>(
  db: D1Database,
  invoiceId: string,
  lines: L[]
): Promise<(L & { "coding.line_invalid": string })[]> {
  if (lines.length === 0) return [];
  const row = await db
    .prepare("SELECT org_unit_id FROM invoice_headers WHERE id = ?")
    .bind(invoiceId)
    .first<{ org_unit_id: string | null }>();
  return mergeCodingValidityFacts(db, row?.org_unit_id ?? null, lines);
}

export interface CodingGap {
  line: number;
  field: string;
  /** `missing`, or one of `checkLineCoding`'s own reasons. */
  reason: "missing" | CodingProblemReason;
}

/**
 * **Coding must be done before the task completes — decision 0513.**
 *
 * Reported live: an invoice left Coding by Route To Approver with no
 * Account Coding keyed on its line, and nothing stopped it. Stage
 * Restrictions (decision 0483) only said which coding fields a stage
 * may *edit*. The operator's answer: **every coding field a stage lets
 * a person edit must hold a value on every line** before Complete (and
 * so Route To Approver, which is Complete) is allowed. There is nothing
 * new to configure. Each value must also pass `checkLineCoding`, so a
 * supplier's own invalid BT-133 (decision 0511) has to be corrected
 * here too, not carried past the stage built to fix it.
 *
 * A stage where no coding field is editable (Validation, once
 * restricted as 0483 intends; Approval) is never affected. Neither is a
 * task about no invoice, or an invoice with no lines, because there is
 * nothing to code.
 */
export async function codingGapsForTask(db: D1Database, taskId: string): Promise<CodingGap[]> {
  const task = await db
    .prepare(
      `SELECT t.stage_id, pi.subject_id, h.org_unit_id
       FROM tasks t
       JOIN stage_visits v ON v.id = t.stage_visit_id
       JOIN process_instances pi ON pi.id = v.process_instance_id
       JOIN invoice_headers h ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
       WHERE t.id = ?`
    )
    .bind(taskId)
    .first<{ stage_id: string; subject_id: string; org_unit_id: string | null }>();
  if (!task) return [];

  const visibility = await resolveFieldVisibility(db, task.stage_id, task.org_unit_id);
  const required = visibility
    .filter((f) => f.visibility === "edit" && f.field in CODING_FIELD_LISTS)
    .map((f) => f.field);
  if (required.length === 0) return [];

  const lines = await db
    .prepare("SELECT line_number, facts_json FROM invoice_lines WHERE invoice_id = ? ORDER BY line_number")
    .bind(task.subject_id)
    .all<{ line_number: number; facts_json: string | null }>();

  const cache = new CodingLookupCache(db);
  const gaps: CodingGap[] = [];
  for (const row of lines.results) {
    let facts: Record<string, unknown> = {};
    try {
      facts = JSON.parse(row.facts_json || "{}") as Record<string, unknown>;
    } catch {
      // Unparseable facts are treated as no coding at all.
    }
    for (const field of required) {
      const value = facts[field];
      if (value === undefined || value === null || String(value).trim() === "") {
        gaps.push({ line: row.line_number, field, reason: "missing" });
      }
    }
    for (const problem of await checkLineCoding(db, task.org_unit_id, facts, new Set(required), cache)) {
      gaps.push({ line: row.line_number, field: problem.field, reason: problem.reason });
    }
  }
  return gaps;
}
