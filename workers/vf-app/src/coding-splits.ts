import { CodingLookupCache, checkLineCoding, type CodingProblemReason } from "./coding-validation.js";

/**
 * **Split coding — decision 0548.** One invoice line's cost shared across
 * several cost centres or projects, each with its own General Ledger
 * Code, by percentage or by amount. The line's Commodity Code stays on
 * the line: it describes what was bought, not who pays for it (the
 * operator's choice, from the mock-up).
 *
 * Held in `invoice_line_coding_splits` (migration 0102), not in the
 * line's facts: every reader of `BT-133`, `coding.project` and
 * `coding.gl_code` treats them as one value, and a list there would have
 * read as `"[object Object]"` everywhere. A split line's own three are
 * left blank, so nothing reads a stale single value beside the split.
 */
export interface CodingSplit {
  costCentre: string | null;
  project: string | null;
  glCode: string | null;
  /** What the person typed when splitting by percentage; null when split by amount. */
  sharePct: number | null;
  /** The net amount this split takes. The rows add up to the line's BT-131. */
  amount: number;
}

/** The operator's choice: up to ten rows a line. Two is the least a split can be. */
export const MAX_SPLITS = 10;
export const MIN_SPLITS = 2;

/** A penny either way, for amounts typed or rounded to two places. */
const TOLERANCE = 0.005;

/** The three fields a split row carries. The Commodity Code stays on the line. */
export const SPLIT_FIELDS = ["BT-133", "coding.project", "coding.gl_code"] as const;

function text(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Every split held for an invoice, by line number, in row order. */
export async function loadSplits(db: D1Database, invoiceId: string): Promise<Map<number, CodingSplit[]>> {
  const out = new Map<number, CodingSplit[]>();
  let rows: {
    line_number: number;
    cost_centre: string | null;
    project: string | null;
    gl_code: string | null;
    share_pct: number | null;
    amount: number;
  }[];
  try {
    rows = (
      await db
        .prepare(
          `SELECT line_number, cost_centre, project, gl_code, share_pct, amount
           FROM invoice_line_coding_splits WHERE invoice_id = ? ORDER BY line_number, seq`
        )
        .bind(invoiceId)
        .all<(typeof rows)[number]>()
    ).results;
  } catch {
    // Before migration 0102: no line is split.
    return out;
  }
  for (const r of rows) {
    const list = out.get(r.line_number) ?? [];
    list.push({ costCentre: r.cost_centre, project: r.project, glCode: r.gl_code, sharePct: r.share_pct, amount: r.amount });
    out.set(r.line_number, list);
  }
  return out;
}

/** Replaces one line's split. An empty list removes it: the line is coded as one again. */
export function saveSplitStatements(db: D1Database, invoiceId: string, lineNumber: number, splits: CodingSplit[]): D1PreparedStatement[] {
  return [
    db.prepare("DELETE FROM invoice_line_coding_splits WHERE invoice_id = ? AND line_number = ?").bind(invoiceId, lineNumber),
    ...splits.map((s, i) =>
      db
        .prepare(
          `INSERT INTO invoice_line_coding_splits (invoice_id, line_number, seq, cost_centre, project, gl_code, share_pct, amount)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(invoiceId, lineNumber, i + 1, s.costCentre, s.project, s.glCode, s.sharePct, round2(s.amount))
    ),
  ];
}

/**
 * Reads a split as sent by the viewer. `[]` or `null` removes the split.
 * Refuses a shape it cannot store, with the reason a person can act on.
 */
export function parseSplits(raw: unknown): { ok: true; splits: CodingSplit[] } | { ok: false; error: string } {
  if (raw === null) return { ok: true, splits: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "splits must be a list, or null to remove the split" };
  const splits: CodingSplit[] = [];
  for (const [i, row] of raw.entries()) {
    if (row === null || typeof row !== "object" || Array.isArray(row)) return { ok: false, error: `split ${i + 1} must be an object` };
    const r = row as Record<string, unknown>;
    for (const key of ["costCentre", "project", "glCode"]) {
      if (r[key] !== undefined && r[key] !== null && typeof r[key] !== "string") {
        return { ok: false, error: `split ${i + 1}: ${key} must be text or null` };
      }
    }
    const amount = num(r.amount);
    if (amount === null) return { ok: false, error: `split ${i + 1}: amount must be a number` };
    const sharePct = r.sharePct === undefined || r.sharePct === null ? null : num(r.sharePct);
    if (r.sharePct !== undefined && r.sharePct !== null && (sharePct === null || sharePct <= 0 || sharePct > 100)) {
      return { ok: false, error: `split ${i + 1}: sharePct must be more than 0 and at most 100` };
    }
    splits.push({ costCentre: text(r.costCentre), project: text(r.project), glCode: text(r.glCode), sharePct, amount });
  }
  return { ok: true, splits };
}

export type SplitShapeProblem = "too_few" | "too_many" | "not_positive" | "unbalanced" | "no_net";

/**
 * **A split adds up to its line**, has two to ten rows, and gives each
 * a positive amount. `null` when it does. A credit note's negative line
 * splits into negative amounts, all the same sign as the line.
 */
export function splitShapeProblem(lineNet: unknown, splits: CodingSplit[]): SplitShapeProblem | null {
  if (splits.length === 0) return null;
  if (splits.length < MIN_SPLITS) return "too_few";
  if (splits.length > MAX_SPLITS) return "too_many";
  const net = num(lineNet);
  if (net === null || net === 0) return "no_net";
  if (splits.some((s) => s.amount === 0 || Math.sign(s.amount) !== Math.sign(net))) return "not_positive";
  const total = splits.reduce((sum, s) => sum + s.amount, 0);
  if (Math.abs(total - net) > TOLERANCE) return "unbalanced";
  return null;
}

export interface SplitProblem {
  /** The row, from 1. */
  split: number;
  field: string;
  value: string;
  reason: CodingProblemReason;
}

/**
 * **Each row's values, against the lists** — the same checks a line's
 * own coding gets (0511, 0542, 0543), run on the row as though it were
 * the line: its cost centre and project must exist and be open, its GL
 * code must be allowed for its cost centre, and linked to the line's
 * Commodity Code. Only values present: a blank is a gap for Complete to
 * report, not a refusal.
 */
export async function checkSplits(
  db: D1Database,
  orgUnitId: string | null,
  lineFacts: Record<string, unknown>,
  splits: CodingSplit[],
  cache: CodingLookupCache = new CodingLookupCache(db)
): Promise<SplitProblem[]> {
  const problems: SplitProblem[] = [];
  const only = new Set<string>(SPLIT_FIELDS);
  for (const [i, s] of splits.entries()) {
    const facts = {
      ...lineFacts,
      "BT-133": s.costCentre ?? "",
      "coding.project": s.project ?? "",
      "coding.gl_code": s.glCode ?? "",
    };
    for (const p of await checkLineCoding(db, orgUnitId, facts, only, cache)) {
      problems.push({ split: i + 1, field: p.field, value: p.value, reason: p.reason });
    }
  }
  return problems;
}

/** A split as the facts a rule or an approval would read for that row. */
export function splitAsLineFacts(lineFacts: Record<string, unknown>, s: CodingSplit): Record<string, unknown> {
  return {
    ...lineFacts,
    "BT-133": s.costCentre ?? "",
    "coding.project": s.project ?? "",
    "coding.gl_code": s.glCode ?? "",
    "BT-131": s.amount,
  };
}
