import type { ReportTable } from "./agents.js";

/**
 * **An agent's report as an email — decision 0623.**
 *
 * Each recipient gets their own copy in their own language (English or
 * German today): a short heading, the table (at most `EMAIL_ROWS` rows,
 * the rest in the CSV), the totals, a link into VibeFinance, and why
 * they get it with a link to stop. The numbers are the report's own;
 * nothing here works anything out.
 *
 * The words live here rather than in the interface's strings, because
 * the email is written by the Worker on a schedule, with nobody's
 * browser to fetch them.
 */

export const EMAIL_ROWS = 200;

export type EmailLocale = "en" | "de";

const WORDS: Record<EmailLocale, Record<string, string>> = {
  en: {
    "report.outstanding_payables": "Outstanding payables",
    "report.overdue_not_eligible": "Past due, not yet payment-eligible",
    "report.accruals": "Accruals by stage",
    "report.open_tasks": "Open tasks by person",
    "report.possible_duplicates": "Possible duplicates",
    "report.due_soon_not_eligible": "Due soon, not yet payment-eligible",
    "report.stuck_work": "Stuck work",
    "col.notdue": "Not yet due",
    "col.d30": "1–30 days",
    "col.d60": "31–60 days",
    "col.d90": "61–90 days",
    "col.d90plus": "Over 90 days",
    "col.due": "Due",
    "col.daystodue": "Days to due",
    "col.stuck": "Open tasks",
    "col.oldestdays": "Oldest, days",
    up: "up {n} since the last report",
    down: "down {n} since the last report",
    same: "no change since the last report",
    first: "the first report",
    mintotal: "Only suppliers owing at least {n}.",
    highlighted: "Highlighted: {why}.",
    "why.outstanding_payables": "oldest more than {n} days past due",
    "why.due_soon_not_eligible": "due within two days",
    "why.stuck_work": "open {n} days or more",
    "col.org": "Organisation",
    "col.supplier": "Supplier",
    "col.invoices": "Invoices",
    "col.total": "Total",
    "col.currency": "Currency",
    "col.oldestdue": "Oldest due",
    "col.dayspastdue": "Days past due",
    "col.stage": "Stage",
    "col.person": "Person",
    "col.open": "Open tasks",
    "col.invoice": "Invoice",
    "col.issued": "Issued",
    "col.confidence": "Likeness",
    unclaimed: "Unclaimed, waiting",
    asat: "As at {when}",
    total: "Total",
    invoices: "{n} invoices",
    items: "{n} in all",
    more: "{n} more rows are in the attached CSV.",
    skipped: "Left out, as the agent's author can no longer see them: {orgs}.",
    filtered: "Filtered to the organisations you can see.",
    open: "Open VibeFinance",
    opendocs: "Open these invoices in Documents",
    why: "You get this because {author} set up the agent “{name}”.",
    stop: "Stop sending me this",
    "summary.label": "Summary, written by AI from the table below",
    "summary.highlightedrow": "highlighted",
  },
  de: {
    "report.outstanding_payables": "Offene Verbindlichkeiten",
    "report.overdue_not_eligible": "Überfällig, noch nicht zahlungsbereit",
    "report.accruals": "Abgrenzungen nach Stufe",
    "report.open_tasks": "Offene Aufgaben nach Person",
    "report.possible_duplicates": "Mögliche Duplikate",
    "report.due_soon_not_eligible": "Bald fällig, noch nicht zahlungsbereit",
    "report.stuck_work": "Festhängende Arbeit",
    "col.notdue": "Noch nicht fällig",
    "col.d30": "1–30 Tage",
    "col.d60": "31–60 Tage",
    "col.d90": "61–90 Tage",
    "col.d90plus": "Über 90 Tage",
    "col.due": "Fällig",
    "col.daystodue": "Tage bis fällig",
    "col.stuck": "Offene Aufgaben",
    "col.oldestdays": "Älteste, Tage",
    up: "{n} mehr als im letzten Bericht",
    down: "{n} weniger als im letzten Bericht",
    same: "unverändert seit dem letzten Bericht",
    first: "der erste Bericht",
    mintotal: "Nur Lieferanten mit offenen Beträgen ab {n}.",
    highlighted: "Hervorgehoben: {why}.",
    "why.outstanding_payables": "älteste mehr als {n} Tage überfällig",
    "why.due_soon_not_eligible": "fällig innerhalb von zwei Tagen",
    "why.stuck_work": "seit {n} Tagen oder länger offen",
    "col.org": "Organisation",
    "col.supplier": "Lieferant",
    "col.invoices": "Rechnungen",
    "col.total": "Summe",
    "col.currency": "Währung",
    "col.oldestdue": "Älteste Fälligkeit",
    "col.dayspastdue": "Tage überfällig",
    "col.stage": "Stufe",
    "col.person": "Person",
    "col.open": "Offene Aufgaben",
    "col.invoice": "Rechnung",
    "col.issued": "Ausgestellt",
    "col.confidence": "Ähnlichkeit",
    unclaimed: "Ungeclaimt, wartend",
    asat: "Stand {when}",
    total: "Summe",
    invoices: "{n} Rechnungen",
    items: "{n} insgesamt",
    more: "{n} weitere Zeilen stehen in der angehängten CSV-Datei.",
    skipped: "Ausgelassen, da der Autor des Agenten sie nicht mehr sehen darf: {orgs}.",
    filtered: "Auf die Organisationen beschränkt, die Sie sehen dürfen.",
    open: "VibeFinance öffnen",
    opendocs: "Diese Rechnungen in Dokumente öffnen",
    why: "Sie erhalten dies, weil {author} den Agenten „{name}“ eingerichtet hat.",
    stop: "Nicht mehr an mich senden",
    "summary.label": "Zusammenfassung, von KI aus der Tabelle unten geschrieben",
    "summary.highlightedrow": "hervorgehoben",
  },
};

export function emailLocale(raw: unknown): EmailLocale {
  return raw === "de" ? "de" : "en";
}

export function words(locale: EmailLocale, key: string): string {
  return w(locale, key);
}

function w(locale: EmailLocale, key: string): string {
  return WORDS[locale][key] ?? WORDS.en[key] ?? key;
}

/** A column's label key (`agents.col.supplier`) in the language. */
export function label(locale: EmailLocale, key: string): string {
  return w(locale, key.replace(/^agents\./, ""));
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const NUMERIC = new Set(["money", "count", "days", "percent"]);

export function cell(locale: EmailLocale, value: string | number | null | undefined, kind: string, key: string): string {
  if (key === "person" && (value === null || value === undefined)) return w(locale, "unclaimed");
  if (value === null || value === undefined || value === "") return "—";
  const tag = locale === "de" ? "de-DE" : "en-GB";
  if (kind === "money") return Number(value).toLocaleString(tag, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (kind === "percent") return `${Math.round(Number(value) * 100)}%`;
  return String(value);
}

/** The CSV attached: every row, numbers plain, headings in the language. */
export function reportCsv(locale: EmailLocale, table: ReportTable): string {
  const quote = (v: string) => {
    // A cell that a spreadsheet would read as a formula is written as text.
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [table.columns.map((c) => quote(label(locale, c.label))).join(",")];
  for (const row of table.rows) {
    lines.push(
      table.columns
        .map((c) => {
          const v = row[c.key];
          if (c.key === "person" && (v === null || v === undefined)) return quote(w(locale, "unclaimed"));
          if (v === null || v === undefined) return "";
          return typeof v === "number" ? String(v) : quote(String(v));
        })
        .join(",")
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

export interface AgentEmailInput {
  locale: EmailLocale;
  agentName: string;
  authorName: string;
  table: ReportTable;
  timeZone: string;
  appUrl: string | null;
  stopUrl: string | null;
  /** Whether organisations were left out because this recipient may not see them. */
  filtered: boolean;
  /** Decision 0626: the AI summary, already checked against the table; none when null. */
  summary?: string | null;
  /** Decision 0629: Documents at this copy's invoices; the app's own address when null. */
  documentsUrl?: string | null;
}

/** "120.00 GBP (1 invoices), up 20.00 since the last report" — decision 0624's comparison. */
export function compareWith(locale: EmailLocale, t: ReportTable["totals"][number], previous: ReportTable["previous"]): string {
  if (!previous) return "";
  const before = previous.find((p) => (p.currency ?? null) === (t.currency ?? null));
  const now = t.currency ? (t.total ?? 0) : t.count;
  const then = before ? (t.currency ? (before.total ?? 0) : before.count) : 0;
  const diff = Math.round((now - then) * 100) / 100;
  if (diff === 0) return w(locale, "same");
  const n = t.currency ? cell(locale, Math.abs(diff), "money", "total") : String(Math.abs(diff));
  return w(locale, diff > 0 ? "up" : "down").replace("{n}", n);
}

function totalsLine(locale: EmailLocale, table: ReportTable): string {
  return table.totals
    .map((t) => {
      const base = t.currency
        ? `${cell(locale, t.total, "money", "total")} ${t.currency} (${w(locale, "invoices").replace("{n}", String(t.count))})`
        : w(locale, "items").replace("{n}", String(t.count));
      const change = compareWith(locale, t, table.previous);
      return change ? `${base}, ${change}` : base;
    })
    .join(" · ");
}

/** What narrowed it, and what a highlight means. */
function optionLines(locale: EmailLocale, table: ReportTable): string[] {
  const o = table.options ?? {};
  const lines: string[] = [];
  if (o.minTotal !== undefined) lines.push(w(locale, "mintotal").replace("{n}", cell(locale, o.minTotal, "money", "total")));
  const n = table.report === "outstanding_payables" ? o.highlightDays : table.report === "stuck_work" ? (o.olderThanDays ?? 5) * 2 : undefined;
  if (table.rows.some((r) => r._highlight)) lines.push(w(locale, "highlighted").replace("{why}", w(locale, `why.${table.report}`).replace("{n}", String(n ?? ""))));
  return lines;
}

export function buildAgentEmail(input: AgentEmailInput): { subject: string; text: string; html: string; csv: string; filename: string } {
  const { locale, table } = input;
  const tag = locale === "de" ? "de-DE" : "en-GB";
  const asAt = new Date(table.asAt).toLocaleString(tag, { timeZone: input.timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const day = new Date(table.asAt).toLocaleDateString(tag, { timeZone: input.timeZone, weekday: "short", day: "numeric", month: "short" });
  const subject = `${input.agentName} · ${day}`;
  const reportName = w(locale, `report.${table.report}`);
  const shown = table.rows.slice(0, EMAIL_ROWS);
  const more = table.rows.length - shown.length;
  const notes = [
    ...(table.skippedOrgs.length ? [w(locale, "skipped").replace("{orgs}", table.skippedOrgs.join(", "))] : []),
    ...(input.filtered ? [w(locale, "filtered")] : []),
    ...optionLines(locale, table),
  ];
  const why = w(locale, "why").replace("{author}", input.authorName).replace("{name}", input.agentName);
  const totals = table.totals.length ? `${w(locale, "total")}: ${totalsLine(locale, table)}` : "";

  // Text, for a reader that shows no HTML.
  const widths = table.columns.map((c) => Math.min(28, Math.max(label(locale, c.label).length, ...shown.map((r) => cell(locale, r[c.key], c.kind, c.key).length))));
  const pad = (s: string, n: number, right: boolean) => (s.length > n ? `${s.slice(0, n - 1)}…` : right ? s.padStart(n) : s.padEnd(n));
  const textRows = [
    table.columns.map((c, i) => pad(label(locale, c.label), widths[i], NUMERIC.has(c.kind))).join("  "),
    ...shown.map((r) => table.columns.map((c, i) => pad(cell(locale, r[c.key], c.kind, c.key), widths[i], NUMERIC.has(c.kind))).join("  ")),
  ];
  const summary = input.summary ?? null;
  const text = [
    input.agentName,
    `${reportName} · ${w(locale, "asat").replace("{when}", asAt)}`,
    "",
    ...(summary ? [`${w(locale, "summary.label")}:`, summary, ""] : []),
    ...notes,
    ...(notes.length ? [""] : []),
    ...textRows,
    "",
    ...(totals ? [totals] : []),
    ...(more > 0 ? [w(locale, "more").replace("{n}", String(more))] : []),
    "",
    ...(input.documentsUrl
      ? [`${w(locale, "opendocs")}: ${input.documentsUrl}`]
      : input.appUrl
        ? [`${w(locale, "open")}: ${input.appUrl}`]
        : []),
    "",
    why,
    ...(input.stopUrl ? [`${w(locale, "stop")}: ${input.stopUrl}`] : []),
  ].join("\n");

  const th = (c: ReportTable["columns"][number]) =>
    `<th style="text-align:${NUMERIC.has(c.kind) ? "right" : "left"};padding:6px 10px;border-bottom:2px solid #c9d3e0;font-size:12px;color:#4a5768">${esc(label(locale, c.label))}</th>`;
  const td = (r: ReportTable["rows"][number], c: ReportTable["columns"][number]) =>
    `<td style="text-align:${NUMERIC.has(c.kind) ? "right" : "left"};padding:6px 10px;border-bottom:1px solid #e3e9f1;white-space:nowrap${r._highlight ? ";color:#9c2b1f;font-weight:700" : ""}">${esc(cell(locale, r[c.key], c.kind, c.key))}</td>`;
  const html = `<div style="font-family:Calibri,Carlito,'Segoe UI',Arial,sans-serif;color:#121a26;font-size:14px;line-height:1.45">
<h2 style="margin:0 0 4px;color:#854f0b;font-size:20px">${esc(input.agentName)}</h2>
<p style="margin:0 0 12px;color:#4a5768">${esc(reportName)} · ${esc(w(locale, "asat").replace("{when}", asAt))}</p>
${summary ? `<div style="margin:0 0 14px;padding:10px 12px;border:1px dashed #378add;border-radius:6px;background:#e6f1fb"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;font-weight:700;color:#185fa5;margin-bottom:4px">${esc(w(locale, "summary.label"))}</div>${esc(summary)}</div>` : ""}
${notes.map((n) => `<p style="margin:0 0 8px;color:#4a5768">${esc(n)}</p>`).join("\n")}
<table style="border-collapse:collapse;font-size:13px"><thead><tr>${table.columns.map(th).join("")}</tr></thead>
<tbody>${shown.map((r) => `<tr>${table.columns.map((c) => td(r, c)).join("")}</tr>`).join("")}</tbody></table>
${totals ? `<p style="margin:10px 0 0">${esc(totals)}</p>` : ""}
${more > 0 ? `<p style="margin:6px 0 0;color:#4a5768">${esc(w(locale, "more").replace("{n}", String(more)))}</p>` : ""}
${input.documentsUrl ? `<p style="margin:16px 0 0"><a href="${esc(input.documentsUrl)}" style="color:#185fa5">${esc(w(locale, "opendocs"))}</a></p>` : input.appUrl ? `<p style="margin:16px 0 0"><a href="${esc(input.appUrl)}" style="color:#185fa5">${esc(w(locale, "open"))}</a></p>` : ""}
<p style="margin:20px 0 0;color:#7b8798;font-size:12px">${esc(why)}${input.stopUrl ? ` <a href="${esc(input.stopUrl)}" style="color:#7b8798">${esc(w(locale, "stop"))}</a>` : ""}</p>
</div>`;

  const filename = `${input.agentName.replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-") || "agent"}-${table.asAt.slice(0, 10)}.csv`;
  return { subject, text, html, csv: reportCsv(locale, table), filename };
}
