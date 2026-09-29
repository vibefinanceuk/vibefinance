import { supplierProjectOnly } from "./supplier-project-only.js";
import type { InvoiceFacts } from "@vibefinance/shared";
import { getCostObjectRule } from "./coding-config-route.js";
import type { RouteResult } from "./org-route.js";
import { CODING_FIELD_LISTS, checkLineCoding } from "./coding-validation.js";
import { isPoInvoice, nonPoLines } from "./po-pairings.js";
import { dice, words } from "./po-suggest.js";

/**
 * **Account Coding suggestions, per line — decision 0539**, replacing
 * the per-supplier defaults of decisions 0456/0457.
 *
 * **Why it was replaced.** 0457 read `keyed_fields` for rows whose
 * `field` was `BT-133` (and the other three coding fields) on a line.
 * Keying has always recorded a line's field as `line.<n>.<field>`
 * (`key-fields-route.ts`, since 0109), so on real data it never found a
 * single row and never suggested anything. Its tests seeded the same
 * wrong name, which is how it passed. It also suggested the same coding
 * for every line of an invoice, so a supplier's freight line and goods
 * line got the same answer.
 *
 * **What a suggestion is now:** for one line, the whole coding set (the
 * four fields together, so a General Ledger Code stays consistent with
 * its Commodity Code) that this supplier's earlier lines were coded to
 * by a person:
 *  1. **Similar lines first.** Earlier lines whose description shares
 *     enough words with this one (the PO line suggester's own Dice
 *     measure, `po-suggest.ts`, at 0.5 or more). The set most of them
 *     got is offered when at least half of them agree.
 *  2. **Otherwise the supplier's usual coding**: the set most of its
 *     coded lines got, once there are at least `MIN_SUPPLIER_LINES` of
 *     them and at least half agree.
 * Each comes with how many lines it is drawn from and one or two of
 * their descriptions, so a person can see why before accepting.
 *
 * **"Coded by a person"** means a line with a coding field in
 * `keyed_fields` (under its real `line.<n>.<field>` name, never the
 * value 0537 writes when it clears coding), read from the line's own
 * facts as they stand now: the coding it ended with, not every value
 * typed on the way.
 *
 * **Advisory only.** Nothing is written here or pre-filled on screen:
 * the pop-out shows the suggestion and a person presses Accept all
 * (the operator's choice, the same as PO line suggestions, 0534).
 * Never suggested: a value the save would refuse (decision 0511's
 * checks, run as one line), or a line on a PO invoice that is not
 * marked Non-PO (0537: its coding comes from the PO).
 */

/** Below this many coded lines, a supplier has no "usual" coding yet. */
const MIN_SUPPLIER_LINES = 3;
/** The share of the lines drawn on that must agree. */
const MIN_AGREEMENT = 0.5;
/** Description similarity for "a line like this one" — the PO line suggester's own bar. */
const SIMILAR = 0.5;
/** How far back to look: the supplier's most recent coded lines. */
const HISTORY_LIMIT = 500;

const CODING_FIELDS = Object.keys(CODING_FIELD_LISTS);

export interface LineCodingSuggestion {
  /** Field → id, only the fields the set carries. */
  values: Record<string, string>;
  /** Field → the entry's name, for showing it. */
  labels: Record<string, string>;
  /** `invoice` — decision 0543: the invoice's own project reference (BT-11) names a project. */
  basis: "similar" | "supplier" | "invoice";
  /** Lines with this set, and lines drawn on (similar ones, or all the supplier's coded lines). */
  count: number;
  total: number;
  confidence: number;
  /** One or two of those lines' descriptions. */
  examples: string[];
  /** Decision 0543 — what the invoice printed as its project reference, when that is the basis. */
  projectReference?: string;
}

/**
 * **The project the invoice names — decision 0543.** Its project
 * reference (BT-11) matched against Account Coding's projects by id,
 * then by name, ignoring case; only a project still in use.
 */
async function projectNamedByInvoice(db: D1Database, reference: string | null): Promise<string | null> {
  if (!reference) return null;
  const row = await db
    .prepare(
      `SELECT id FROM coding_list_entries
       WHERE list_type_id = 'project' AND status = 'active' AND (lower(id) = lower(?1) OR lower(name) = lower(?1))
       ORDER BY lower(id) = lower(?1) DESC LIMIT 1`
    )
    .bind(reference)
    .first<{ id: string }>();
  return row?.id ?? null;
}

export interface HistoryLine {
  description: string | null;
  words: Set<string>;
  key: string;
  values: Record<string, string>;
}

function text(v: unknown): string | null {
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (typeof v === "number") return String(v);
  return null;
}

function codingOf(facts: Record<string, unknown>): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of CODING_FIELDS) {
    const v = text(facts[field]);
    if (v) values[field] = v;
  }
  return values;
}

function describe(facts: Record<string, unknown>, column: string | null): string | null {
  return text(facts["BT-153"]) ?? column ?? text(facts["BT-154"]);
}

async function supplierHistory(db: D1Database, supplierVatId: string, invoiceId: string): Promise<HistoryLine[]> {
  const rows = (
    await db
      .prepare(
        `SELECT il.line_number, il.description, il.facts_json
         FROM invoice_lines il
         JOIN invoice_headers ih ON ih.id = il.invoice_id
         WHERE ih.supplier_vat_id = ? AND ih.id != ?
           AND EXISTS (
             SELECT 1 FROM keyed_fields kf
             WHERE kf.invoice_id = il.invoice_id AND kf.line_number = il.line_number
               AND kf.field IN (${CODING_FIELDS.map(() => "'line.' || il.line_number || '.' || ?").join(", ")})
               AND kf.new_value != 'null'
           )
         ORDER BY ih.created_at DESC, il.line_number
         LIMIT ${HISTORY_LIMIT}`
      )
      .bind(supplierVatId, invoiceId, ...CODING_FIELDS)
      .all<{ line_number: number; description: string | null; facts_json: string | null }>()
  ).results;

  const history: HistoryLine[] = [];
  for (const row of rows) {
    let facts: Record<string, unknown> = {};
    try {
      facts = JSON.parse(row.facts_json || "{}") as Record<string, unknown>;
    } catch {
      continue;
    }
    const values = codingOf(facts);
    if (Object.keys(values).length === 0) continue;
    const description = describe(facts, row.description);
    history.push({
      description,
      words: words(description, text(facts["BT-154"])),
      key: JSON.stringify(CODING_FIELDS.map((f) => values[f] ?? null)),
      values,
    });
  }
  return history;
}

/** The coding set most of `lines` got, or null when fewer than half agree. */
function mostAgreed(lines: HistoryLine[]): { set: HistoryLine; count: number; members: HistoryLine[] } | null {
  const groups = new Map<string, HistoryLine[]>();
  for (const l of lines) groups.set(l.key, [...(groups.get(l.key) ?? []), l]);
  let best: HistoryLine[] | null = null;
  for (const g of groups.values()) if (!best || g.length > best.length) best = g;
  if (!best || best.length / lines.length < MIN_AGREEMENT) return null;
  return { set: best[0], count: best.length, members: best };
}

/** One line's suggestion from the supplier's history, before the 0511 checks. */
export function suggestFromHistory(
  description: string | null,
  extra: string | null,
  history: HistoryLine[]
): Omit<LineCodingSuggestion, "labels"> | null {
  const mine = words(description, extra);
  const scored = history.map((h) => ({ h, sim: dice(mine, h.words) }));
  const similar = scored.filter((s) => s.sim >= SIMILAR).sort((a, b) => b.sim - a.sim);

  if (similar.length > 0) {
    const agreed = mostAgreed(similar.map((s) => s.h));
    if (agreed) {
      return {
        values: agreed.set.values,
        basis: "similar",
        count: agreed.count,
        total: similar.length,
        confidence: agreed.count / similar.length,
        examples: examplesOf(agreed.members),
      };
    }
  }

  if (history.length < MIN_SUPPLIER_LINES) return null;
  const agreed = mostAgreed(history);
  if (!agreed) return null;
  return {
    values: agreed.set.values,
    basis: "supplier",
    count: agreed.count,
    total: history.length,
    confidence: agreed.count / history.length,
    examples: examplesOf(agreed.members),
  };
}

function examplesOf(members: HistoryLine[]): string[] {
  return [...new Set(members.map((m) => m.description).filter((d): d is string => !!d))].slice(0, 2);
}

/** Each suggested value's own name, for showing it. */
async function labelsFor(db: D1Database, values: Record<string, string>): Promise<Record<string, string>> {
  const labels: Record<string, string> = {};
  for (const [field, id] of Object.entries(values)) {
    const listType = CODING_FIELD_LISTS[field];
    const row =
      listType === "cost_centre"
        ? await db.prepare("SELECT name FROM cost_centres WHERE id = ?").bind(id).first<{ name: string }>()
        : await db
            .prepare("SELECT name FROM coding_list_entries WHERE list_type_id = ? AND id = ?")
            .bind(listType, id)
            .first<{ name: string }>();
    if (row?.name) labels[field] = row.name;
  }
  return labels;
}

/**
 * `GET /invoices/:id/coding-suggestions` → `{ lines: { "<n>": LineCodingSuggestion } }`,
 * one entry per line that has a suggestion.
 */
export async function handleCodingSuggestions(db: D1Database, invoiceId: string): Promise<RouteResult> {
  const header = await db
    .prepare("SELECT supplier_vat_id, org_unit_id, facts_json FROM invoice_headers WHERE id = ?")
    .bind(invoiceId)
    .first<{ supplier_vat_id: string | null; org_unit_id: string | null; facts_json: string | null }>();
  if (!header) {
    return { status: 404, body: { error: `invoice ${invoiceId} does not exist` } };
  }
  let headerFacts: Record<string, unknown> = {};
  try {
    headerFacts = JSON.parse(header.facts_json || "{}") as Record<string, unknown>;
  } catch {
    // Unparseable header facts carry no order reference.
  }
  // Decision 0537 — on a PO invoice only a Non-PO line is coded by hand.
  const onlyLines = isPoInvoice(headerFacts) ? await nonPoLines(db, invoiceId, headerFacts as InvoiceFacts) : null;

  // Decision 0540 — with the either/or rule on, a line that held both is no example to follow.
  const eitherOr = (await getCostObjectRule(db)) === "exclusive";
  // No identified supplier: no history to draw on. Not an error.
  /**
   * **A project-only supplier site — decision 0547.** Under the either/or
   * rule its lines are coded to a project, so only earlier lines that
   * carried a project are examples to follow, and a cost centre is never
   * suggested (the pop-out does not offer one).
   */
  const projectOnly = eitherOr && (await supplierProjectOnly(db, invoiceId)) === true;
  const history = header.supplier_vat_id
    ? (await supplierHistory(db, header.supplier_vat_id, invoiceId)).filter(
        (h) =>
          (!eitherOr || !(h.values["BT-133"] && h.values["coding.project"])) &&
          (!projectOnly || !!h.values["coding.project"])
      )
    : [];
  const projectReference = text(headerFacts["BT-11"]);
  const namedProject = await projectNamedByInvoice(db, projectReference);
  if (history.length === 0 && !namedProject) return { status: 200, body: { lines: {} } };

  const lines = (
    await db
      .prepare("SELECT line_number, description, facts_json FROM invoice_lines WHERE invoice_id = ? ORDER BY line_number")
      .bind(invoiceId)
      .all<{ line_number: number; description: string | null; facts_json: string | null }>()
  ).results;

  const out: Record<string, LineCodingSuggestion> = {};
  for (const line of lines) {
    if (onlyLines && !onlyLines.has(line.line_number)) continue;
    let facts: Record<string, unknown> = {};
    try {
      facts = JSON.parse(line.facts_json || "{}") as Record<string, unknown>;
    } catch {
      // A line whose facts will not parse is matched on its description column alone.
    }
    let found = history.length > 0 ? suggestFromHistory(describe(facts, line.description), text(facts["BT-154"]), history) : null;
    /**
     * **The invoice names its project — decision 0543.** That project
     * wins over whatever project history would pick, and under the
     * either/or rule (0540) replaces a suggested cost centre. The rest of
     * the history's set (commodity, GL code) is kept when there is one.
     */
    if (namedProject) {
      const values = { ...(found?.values ?? {}) };
      if (eitherOr) delete values["BT-133"];
      values["coding.project"] = namedProject;
      found = {
        values,
        basis: "invoice",
        count: found?.count ?? 0,
        total: found?.total ?? 0,
        confidence: 1,
        examples: found?.examples ?? [],
        projectReference: projectReference ?? undefined,
      };
    }
    if (!found) continue;

    /**
     * **Never suggest what the save would refuse — decision 0511.**
     * Checked as one line, so a General Ledger Code is tested against
     * the Commodity Code beside it; a value no longer on a list, or
     * linked to another company, is dropped rather than offered.
     */
    const values = { ...found.values };
    if (projectOnly) delete values["BT-133"];
    for (const problem of await checkLineCoding(db, header.org_unit_id, values)) delete values[problem.field];
    if (Object.keys(values).length === 0) continue;

    out[String(line.line_number)] = { ...found, values, labels: await labelsFor(db, values) };
  }
  return { status: 200, body: { lines: out } };
}
