import type { CompilerModel } from "@vibefinance/shared";
import { readLicenceState } from "./licence-cache.js";
import type { ReportTable } from "./agents.js";
import {
  cell,
  compareWith,
  label,
  type EmailLocale,
  words,
} from "./agent-email.js";

/**
 * **The AI summary — decision 0626 (Agents, slice 5).**
 *
 * A few sentences on top of a copy of an agent's report, written by the AI
 * from that copy's own table, in the reader's language (design decisions
 * 4 and 11). The numbers stay our code's: the model is given them already
 * written out, and **every number in what it writes must be one of the
 * table's**, or the summary is dropped and the copy goes without it. It is
 * never a reason not to send the report.
 *
 * Summaries a day are counted per environment against the licence's
 * `summaryLimit` (default 100, Dan, 4 October 2026). Past it, reports
 * still go, without a summary, and say why.
 */

export const DEFAULT_SUMMARY_LIMIT = 100;
/** Rows of the table the model is shown; the numbers checked are all of them. */
const PROMPT_ROWS = 40;
const SUMMARY_MAX = 700;

export type SummaryStatus =
  "written" | "off" | "mismatch" | "over_budget" | "ai_unavailable" | "no_ai";

export interface SummaryOutcome {
  status: SummaryStatus;
  text?: string;
  /** For `mismatch`: the first number that was not in the table. */
  stray?: string;
}

/** The licence's daily summaries, or the default. */
export async function summaryLimit(db: D1Database): Promise<number> {
  const state = await readLicenceState(db);
  const limit = state.known
    ? (state.claims as { summaryLimit?: unknown }).summaryLimit
    : undefined;
  return typeof limit === "number" && Number.isInteger(limit) && limit >= 0
    ? limit
    : DEFAULT_SUMMARY_LIMIT;
}

/**
 * Take one of today's summaries (UTC day), in one statement so two runs
 * at once cannot both take the last. False when the day's are used.
 */
export async function takeSummary(
  db: D1Database,
  limit: number,
  now: Date,
): Promise<boolean> {
  if (limit <= 0) return false;
  const result = await db
    .prepare(
      `INSERT INTO agent_ai_days (day, summaries) VALUES (?, 1)
       ON CONFLICT(day) DO UPDATE SET summaries = summaries + 1 WHERE summaries < ?`,
    )
    .bind(now.toISOString().slice(0, 10), limit)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/** Summaries written today, and the day's limit. */
export async function summariesToday(
  db: D1Database,
  now: Date,
): Promise<{ used: number; max: number }> {
  const row = await db
    .prepare("SELECT summaries FROM agent_ai_days WHERE day = ?")
    .bind(now.toISOString().slice(0, 10))
    .first<{ summaries: number }>();
  return { used: row?.summaries ?? 0, max: await summaryLimit(db) };
}

const NUMERIC = new Set(["money", "count", "days", "percent"]);

/** Every number a reader of this table has been shown: cells, totals, counts, changes and options. */
export function tableNumbers(table: ReportTable): number[] {
  const out: number[] = [
    table.rows.length,
    table.rows.filter((r) => r._highlight).length,
  ];
  for (const row of table.rows) {
    for (const c of table.columns) {
      const v = row[c.key];
      if (typeof v !== "number") continue;
      out.push(c.kind === "percent" ? Math.round(v * 100) : v);
    }
  }
  for (const t of table.totals) {
    out.push(t.count);
    if (t.total !== null) out.push(t.total);
    const before = table.previous?.find(
      (p) => (p.currency ?? null) === (t.currency ?? null),
    );
    if (before) {
      out.push(before.count, Math.abs(t.count - before.count));
      if (before.total !== null) out.push(before.total);
      if (t.total !== null && before.total !== null)
        out.push(Math.round(Math.abs(t.total - before.total) * 100) / 100);
    }
  }
  for (const v of Object.values(table.options ?? {}))
    if (typeof v === "number") out.push(v);
  return out.map((n) => Math.abs(n));
}

/** "1,234.56" (en) or "1.234,56" (de) as a number; null when it is not one. */
export function readNumber(said: string, locale: EmailLocale): number | null {
  const s = said.replace(/[\s  ']/g, "");
  const plain =
    locale === "de"
      ? s.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".")
      : s.replace(/,(?=\d{3}(\D|$))/g, "");
  const n = Number(plain);
  return Number.isFinite(n) ? n : null;
}

/**
 * **The check.** Words that are the table's own text (supplier and
 * organisation names, invoice numbers) are set aside first; then every
 * number left must be one of the table's, as written or rounded to a
 * whole number. Returns the first that is not, or null.
 */
export function strayNumber(
  summary: string,
  table: ReportTable,
  locale: EmailLocale,
): string | null {
  let text = summary;
  const names = new Set<string>(table.skippedOrgs);
  for (const row of table.rows)
    for (const c of table.columns) {
      const v = row[c.key];
      if (typeof v === "string" && /\d/.test(v) && !NUMERIC.has(c.kind))
        names.add(v);
    }
  for (const name of [...names].sort((a, b) => b.length - a.length))
    text = text.split(name).join(" ");
  const allowed = tableNumbers(table);
  const fits = (n: number) =>
    allowed.some((a) => Math.abs(a - n) < 0.005 || Math.round(a) === n);
  const found = text.match(/\d[\d.,  ']*/g) ?? [];
  for (const raw of found) {
    const said = raw.replace(/[.,  ']+$/, "");
    const n = readNumber(said, locale);
    if (n === null || !fits(Math.abs(n))) return said;
  }
  return null;
}

/** The prompt: the table as the reader sees it, and how to write. */
export function summaryPrompt(
  table: ReportTable,
  locale: EmailLocale,
  agentName: string,
): string {
  const cols = table.columns;
  const rows = table.rows
    .slice(0, PROMPT_ROWS)
    .map((r) =>
      Object.fromEntries([
        ...cols.map((c) => [
          label(locale, c.label),
          cell(locale, r[c.key], c.kind, c.key),
        ]),
        ...(r._highlight
          ? [[words(locale, "summary.highlightedrow"), true]]
          : []),
      ]),
    );
  const totals = table.totals.map((t) => ({
    currency: t.currency,
    total: t.total === null ? null : cell(locale, t.total, "money", "total"),
    count: t.count,
    ...(table.previous
      ? { comparedWithLast: compareWith(locale, t, table.previous) }
      : {}),
  }));
  const language = locale === "de" ? "German" : "English";
  return `You write a short summary at the top of a finance report that an accounts payable manager receives from a scheduled agent named ${JSON.stringify(agentName)}.

Write 2 to 4 sentences of plain text in ${language}. No headings, lists, markdown, greetings or sign-off.
Say what matters most: the totals, what changed since the last report, the largest or oldest items, and how many rows are highlighted.
Rules, which are checked by code before the summary is sent:
- Copy every number exactly as it is written below. Do not calculate anything new: no percentages, sums, averages or differences other than those given.
- Do not mention dates, times or years.
- Name only suppliers, organisations, people and invoices that appear below.
- Do not recommend paying, approving or rejecting anything.

Report: ${words(locale, `report.${table.report}`)}
Rows in the report: ${table.rows.length}${table.rows.length > PROMPT_ROWS ? ` (the first ${PROMPT_ROWS} are shown)` : ""}
Highlighted rows: ${table.rows.filter((r) => r._highlight).length}
Totals: ${JSON.stringify(totals)}
Rows: ${JSON.stringify(rows)}`;
}

/** Ask the model, tidy what it says, and check it. Never throws. */
export async function writeSummary(
  model: CompilerModel,
  table: ReportTable,
  locale: EmailLocale,
  agentName: string,
): Promise<SummaryOutcome> {
  let said: string;
  try {
    said = await model.compile(summaryPrompt(table, locale, agentName));
  } catch {
    return { status: "ai_unavailable" };
  }
  const text = said
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/[*#_`>]/g, "")
    .replace(/^\s*["“„]|["”“]\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text.length > SUMMARY_MAX || /https?:|@/.test(text))
    return { status: "mismatch" };
  const stray = strayNumber(text, table, locale);
  if (stray !== null) return { status: "mismatch", stray };
  return { status: "written", text };
}
