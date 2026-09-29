import { SPLIT_FIELDS, checkSplits, loadSplits, type CodingSplit } from "./coding-splits.js";
import { supplierProjectOnly } from "./supplier-project-only.js";
import type { InvoiceFacts } from "@vibefinance/shared";
import { mergeProjectBudgetFacts } from "./project-budget.js";
import { getCostObjectRule } from "./coding-config-route.js";
import { isPoInvoice, nonPoLines } from "./po-pairings.js";
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

/**
 * `closed` — decision 0542: the entry is on its list but no longer in use.
 * `wrong_cost_centre` — decision 0543: a GL code the line's cost centre
 * is not linked to, where that cost centre has links.
 */
export type CodingProblemReason = "not_on_list" | "wrong_company" | "wrong_commodity" | "closed" | "wrong_cost_centre";

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
    // Decision 0542 — a closed entry (a finished project) takes no new cost.
    if ((await cache.status(listType, value)) === "closed") {
      problems.push({ field, value, reason: "closed" });
      continue;
    }
    // Decision 0543 — a GL code the line's cost centre may be charged with, where it has links.
    if (listType === "gl_code") {
      const cc = String(lineFacts["BT-133"] ?? "").trim();
      if (cc) {
        const allowed = await cache.glCodesFor(cc);
        if (allowed.length > 0 && !allowed.includes(value)) {
          problems.push({ field, value, reason: "wrong_cost_centre" });
          continue;
        }
      }
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
  lines: L[],
  /**
   * **Decision 0537.** On a PO invoice only a Non-PO line is coded by
   * hand; every other line takes its coding from the PO line it matches,
   * so whatever coding it carries (a supplier's own BT-133 included) is
   * never checked and never flagged.
   */
  options: {
    poInvoice?: boolean;
    /** Decision 0548 — each split line's rows, by line number; a row's bad value flags the line as `coding.split`. */
    splits?: ReadonlyMap<number, CodingSplit[]>;
  } = {}
): Promise<(L & { "coding.line_invalid": string })[]> {
  const cache = new CodingLookupCache(db);
  return Promise.all(
    lines.map(async (line, index) => {
      if (options.poInvoice && line["po.line_non_po"] !== true) return { ...line, "coding.line_invalid": "" };
      const problems = await checkLineCoding(db, orgUnitId, line as Record<string, unknown>, undefined, cache);
      const fields = problems.map((p) => p.field);
      const lineNumber = Number((line as Record<string, unknown>).lineNumber) || index + 1;
      const rows = options.splits?.get(lineNumber);
      if (rows && rows.length > 0 && (await checkSplits(db, orgUnitId, line as Record<string, unknown>, rows, cache)).length > 0) {
        fields.push("coding.split");
      }
      return { ...line, "coding.line_invalid": fields.join(",") };
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
  private readonly statusMemo = new Map<string, Promise<string | null>>();
  private readonly glMemo = new Map<string, Promise<string[]>>();

  /** The GL codes a cost centre is linked to — decision 0543. Empty: it takes any. */
  glCodesFor(costCentreId: string): Promise<string[]> {
    let hit = this.glMemo.get(costCentreId);
    if (!hit) {
      hit = this.db
        .prepare("SELECT gl_code_id FROM cost_centre_gl_codes WHERE cost_centre_id = ?")
        .bind(costCentreId)
        .all<{ gl_code_id: string }>()
        .then((r) => r.results.map((x) => x.gl_code_id));
      this.glMemo.set(costCentreId, hit);
    }
    return hit;
  }
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

  /** An entry's status — decision 0542. Cost Centres have none, so always `active`. */
  status(listType: string, id: string): Promise<string | null> {
    if (listType === "cost_centre") return Promise.resolve("active");
    const key = `${listType}\u0000${id}`;
    let hit = this.statusMemo.get(key);
    if (!hit) {
      hit = this.db
        .prepare("SELECT status FROM coding_list_entries WHERE list_type_id = ? AND id = ?")
        .bind(listType, id)
        .first<{ status: string }>()
        .then((row) => row?.status ?? null);
      this.statusMemo.set(key, hit);
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
    .prepare("SELECT org_unit_id, facts_json FROM invoice_headers WHERE id = ?")
    .bind(invoiceId)
    .first<{ org_unit_id: string | null; facts_json: string | null }>();
  let header: Record<string, unknown> = {};
  try {
    header = JSON.parse(row?.facts_json || "{}") as Record<string, unknown>;
  } catch {
    // Unparseable header facts carry no order reference.
  }
  const splits = await loadSplits(db, invoiceId);
  const merged = await mergeCodingValidityFacts(db, row?.org_unit_id ?? null, lines, { poInvoice: isPoInvoice(header), splits });
  // Decision 0542 — a project's budget, for rules (project.over_budget, project.budget_used_pct).
  return mergeProjectBudgetFacts(db, invoiceId, merged, splits);
}

export interface CodingGap {
  line: number;
  field: string;
  /**
   * `missing`, or one of `checkLineCoding`'s own reasons. Decision 0540:
   * `field` is `cost_object` ("cost centre or project") when the
   * either/or rule is on, and `both` says a line holds the two together.
   */
  reason: "missing" | "both" | "project_required" | "project_only" | CodingProblemReason;
  /** Decision 0548 — which row of a split line, from 1, when the gap is in one. */
  split?: number;
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
      `SELECT t.stage_id, pi.subject_id, h.org_unit_id, h.facts_json, s.offer_field_restrictions
       FROM tasks t
       JOIN process_stages s ON s.id = t.stage_id
       JOIN stage_visits v ON v.id = t.stage_visit_id
       JOIN process_instances pi ON pi.id = v.process_instance_id
       JOIN invoice_headers h ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
       WHERE t.id = ?`
    )
    .bind(taskId)
    .first<{
      stage_id: string;
      subject_id: string;
      org_unit_id: string | null;
      facts_json: string | null;
      offer_field_restrictions: number | null;
    }>();
  if (!task) return [];

  /**
   * **Only at a stage offered Account Coding restrictions — decision
   * 0514.** Reported live: Validation demanded coding although it is
   * not configured to "Offer Account Coding restrictions for this
   * stage". That flag (decision 0485) marks the stages where coding is
   * configured at all. A stage without it is not a coding stage, and
   * its fields fall back to the customer-wide default, which is
   * usually `edit`. 0513 read that default as "required", so a stage
   * nobody could restrict demanded coding nobody meant to do there.
   * `NULL` reads as offered, the column's own default.
   */
  if (task.offer_field_restrictions === 0) return [];

  /**
   * **On a PO invoice, only its Non-PO lines — decision 0537**, which
   * narrows 0514 below. A line matched to a PO line takes its coding
   * from the PO; a line marked Non-PO at Matching (freight, carriage)
   * has none to take, so it is coded here like any Non-PO line.
   *
   * **Never on a PO invoice — decision 0514.** Reported live: a PO
   * invoice was asked for Account Coding. Its lines are charged through
   * the order it references, so there is nothing for a person to code.
   * "PO invoice" means one carrying an order reference (BT-13), the
   * same test Non-PO approval routing already uses (`poReferenced`,
   * decisions 0469/0471), so the two can never disagree about which
   * invoices are PO ones.
   */
  let header: Record<string, unknown> = {};
  try {
    header = JSON.parse(task.facts_json || "{}") as Record<string, unknown>;
  } catch {
    // Unparseable header facts carry no order reference.
  }
  const onlyLines = isPoInvoice(header) ? await nonPoLines(db, task.subject_id, header as InvoiceFacts) : null;
  if (onlyLines && onlyLines.size === 0) return [];

  const visibility = await resolveFieldVisibility(db, task.stage_id, task.org_unit_id);
  let required = visibility
    .filter((f) => f.visibility === "edit" && f.field in CODING_FIELD_LISTS)
    .map((f) => f.field);
  if (required.length === 0) return [];

  /**
   * **Cost Centre OR Project — decision 0540.** With AP Setup's
   * either/or rule on, the two count as one requirement wherever either
   * is editable here: one of them, never both. Each is still checked
   * against its list (0511) when present.
   */
  const COST_OBJECTS = ["BT-133", "coding.project"];
  // Decision 0548 — what each row of a split line must carry, before the either/or rule folds the two together.
  const editableCoding = [...required];
  const eitherOr =
    (await getCostObjectRule(db)) === "exclusive" && required.some((f) => COST_OBJECTS.includes(f));
  if (eitherOr) required = required.filter((f) => !COST_OBJECTS.includes(f));

  /**
   * **A project-only supplier site — decision 0547.** Where this stage
   * lets a person set the project, every coded line needs one. Under
   * "one or the other" a cost centre is not the other half of the
   * choice for this supplier: a line holding one is told to use a
   * project instead (`project_only`), and one holding neither needs a
   * project (`project_required`), not "cost centre or project". Under
   * "both allowed" the project is already required wherever it is
   * editable (0513), and a cost centre stays optional.
   */
  const projectOnly =
    eitherOr &&
    visibility.some((f) => f.field === "coding.project" && f.visibility === "edit") &&
    (await supplierProjectOnly(db, task.subject_id)) === true;

  const lines = await db
    .prepare("SELECT line_number, facts_json FROM invoice_lines WHERE invoice_id = ? ORDER BY line_number")
    .bind(task.subject_id)
    .all<{ line_number: number; facts_json: string | null }>();

  const cache = new CodingLookupCache(db);
  const gaps: CodingGap[] = [];
  const splits = await loadSplits(db, task.subject_id);
  for (const row of lines.results) {
    if (onlyLines && !onlyLines.has(row.line_number)) continue;
    let facts: Record<string, unknown> = {};
    try {
      facts = JSON.parse(row.facts_json || "{}") as Record<string, unknown>;
    } catch {
      // Unparseable facts are treated as no coding at all.
    }
    const blank = (field: string) => {
      const value = facts[field];
      return value === undefined || value === null || String(value).trim() === "";
    };

    /**
     * **A split line — decision 0548.** Each row stands in for the line's
     * cost centre, project and GL code, and is held to what the line
     * would be: a cost object (one of the two under "one or the other",
     * a project for a project-only supplier, 0547), a GL code where the
     * stage makes it editable, and every value on its list. The line's
     * other coding (the Commodity Code) is checked on the line as usual.
     */
    const rows = splits.get(row.line_number);
    if (rows && rows.length > 0) {
      const lineOnly = required.filter((f) => !(SPLIT_FIELDS as readonly string[]).includes(f));
      for (const field of lineOnly) {
        if (blank(field)) gaps.push({ line: row.line_number, field, reason: "missing" });
      }
      for (const problem of await checkLineCoding(db, task.org_unit_id, facts, new Set(lineOnly), cache)) {
        gaps.push({ line: row.line_number, field: problem.field, reason: problem.reason });
      }
      const objects = editableCoding.filter((f) => COST_OBJECTS.includes(f));
      for (const [i, r] of rows.entries()) {
        const split = i + 1;
        const push = (field: string, reason: CodingGap["reason"]) => gaps.push({ line: row.line_number, field, reason, split });
        if (objects.length > 0) {
          if (projectOnly) {
            if (!r.project) push("coding.project", "project_required");
            if (r.costCentre) push("BT-133", "project_only");
          } else if (eitherOr) {
            if (!r.costCentre && !r.project) push("cost_object", "missing");
            if (r.costCentre && r.project) push("cost_object", "both");
          } else {
            if (objects.includes("BT-133") && !r.costCentre) push("BT-133", "missing");
            if (objects.includes("coding.project") && !r.project) push("coding.project", "missing");
          }
        }
        if (editableCoding.includes("coding.gl_code") && !r.glCode) push("coding.gl_code", "missing");
      }
      for (const p of await checkSplits(db, task.org_unit_id, facts, rows, cache)) {
        gaps.push({ line: row.line_number, field: p.field, reason: p.reason, split: p.split });
      }
      continue;
    }
    for (const field of required) {
      if (blank(field)) gaps.push({ line: row.line_number, field, reason: "missing" });
    }
    const checked = new Set(required);
    if (projectOnly) {
      if (blank("coding.project")) gaps.push({ line: row.line_number, field: "coding.project", reason: "project_required" });
      else checked.add("coding.project");
      if (!blank("BT-133")) gaps.push({ line: row.line_number, field: "BT-133", reason: "project_only" });
    } else if (eitherOr) {
      const held = COST_OBJECTS.filter((f) => !blank(f));
      if (held.length === 0) gaps.push({ line: row.line_number, field: "cost_object", reason: "missing" });
      if (held.length === 2) gaps.push({ line: row.line_number, field: "cost_object", reason: "both" });
      for (const f of held) checked.add(f);
    }
    for (const problem of await checkLineCoding(db, task.org_unit_id, facts, checked, cache)) {
      gaps.push({ line: row.line_number, field: problem.field, reason: problem.reason });
    }
  }
  return gaps;
}
