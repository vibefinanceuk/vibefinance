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
    "report.event_stuck": "Invoices stuck at a stage",
    "report.returned_no_reply": "Returned to the supplier, no corrected invoice yet",
    "col.returned": "Returned",
    "col.dayssince": "Days since",
    "col.returnreason": "Why returned",
    "report.event_duplicate": "New possible duplicates",
    "report.event_unapproved_supplier": "Invoices from unapproved suppliers",
    "report.event_file_failed": "Supplier files that could not be read",
    "col.daysatstage": "Days at stage",
    "col.reason": "Why",
    "col.received": "Received",
    "col.from": "From",
    "col.subject": "Subject",
    "col.problem": "What went wrong",
    "reason.notonfile": "Supplier not on file",
    "reason.onhold": "Supplier on hold",
    "summary.highlightedrow": "highlighted",
    // Decision 0633: the agent's own question.
    "report.query": "Your own question",
    cutshort: "Only the first {n} rows are here. Narrow the question to see the rest.",
    "col.country": "Supplier country",
    "col.net": "Net",
    "col.vat": "VAT",
    "col.buyerref": "Buyer reference",
    "col.ponumber": "Purchase order",
    "col.status": "Status",
    "col.delivered": "At the ERP",
    "col.team": "Team",
    "col.taskstatus": "Task status",
    "col.created": "Created",
    "col.agedays": "Age, days",
    "col.claimed": "Claimed",
    "col.ended": "Ended",
    "col.m.count": "Count",
    "col.m.sum": "{field}, added up",
    "col.m.avg": "{field}, average",
    "col.m.min": "{field}, lowest",
    "col.m.max": "{field}, highest",
    "col.m.first": "{field}, earliest",
    "col.m.last": "{field}, latest",
    "qstatus.in_progress": "In process",
    "qstatus.completed": "Through the process",
    "qstatus.returned_manually": "Returned to the supplier",
    "qstatus.archived": "Archived",
    "qstatus.none": "Not in a process",
    "qtaskstatus.open": "Open",
    "qtaskstatus.completed": "Completed",
    "qtaskstatus.returned": "Returned",
    "qtaskstatus.cancelled": "Cancelled",
    "qyesno.yes": "Yes",
    "qyesno.no": "No",
    // Decision 0637: the other datasets' columns and values.
    "col.description": "Description",
    "col.item": "Item",
    "col.amount": "Amount",
    "col.vatrate": "VAT rate",
    "col.costcentre": "Cost centre",
    "col.glcode": "GL code",
    "col.project": "Project",
    "col.visitstage": "Stage",
    "col.entered": "Reached",
    "col.left": "Moved on",
    "col.daysspent": "Days there",
    "col.outcome": "Outcome",
    "col.comment": "Comment",
    "col.replyarrived": "Corrected invoice arrived",
    "col.erpid": "ERP identifier",
    "col.vatid": "VAT number",
    "col.city": "City",
    "col.onhold": "On hold",
    "col.holdreason": "Why on hold",
    "col.paymentterms": "Payment terms",
    "col.matchoption": "Matching",
    "col.ordered": "Ordered",
    "col.invoiced": "Invoiced",
    "col.destination": "Destination",
    "col.deliverystatus": "Delivery",
    "col.queued": "Queued",
    "col.deliveredat": "Delivered",
    "col.failedat": "Failed at",
    "qsupplierstatus.active": "Active",
    "qsupplierstatus.inactive": "Inactive",
    "qmatch.two_way": "Two-way",
    "qmatch.three_way": "Receipting required",
    "qmatch.none": "None",
    "qpostatus.active": "Active",
    "qpostatus.on_hold": "On hold",
    "qpostatus.closed": "Closed",
    "qdelivery.pending": "Waiting",
    "qdelivery.retrying": "Retrying",
    "qdelivery.delivered": "Delivered",
    "qdelivery.failed": "Failed",
    "qdelivery.skipped": "Skipped",
    "qfile.received": "Received",
    "qfile.delivered": "Read and passed on",
    "qfile.partial": "Partly read",
    "qfile.failed": "Could not be read",
    "qfile.dismissed": "Dismissed",
    // Decision 0656: goods receipts.
    "report.waiting_on_receipt": "Invoices waiting on goods received",
    "report.received_not_invoiced": "Received, not invoiced",
    "report.credit_still_owed": "Credit still owed for goods returned",
    "col.dayswaiting": "Days waiting",
    "col.orderline": "Order line",
    "col.notinvoiced": "Not invoiced",
    "col.oldestreceipt": "Oldest receipt",
    "col.value": "Value",
    "col.creditqty": "Credit expected",
    "col.lastreturn": "Last return",
    "col.receiptstate": "Received",
    "col.receipt": "Receipt",
    "col.receiptdate": "Receipt date",
    "col.dayssincereceipt": "Days since receipt",
    "col.movement": "Movement",
    "col.receiptstatus": "Receipt status",
    "col.linestatus": "Line",
    "col.deliverynote": "Delivery note",
    "col.recordedby": "Recorded by",
    "qreceipt.not_received": "Not received",
    "qreceipt.partially_received": "Partially received",
    "qreceipt.fully_received": "Fully received",
    "qreceipt.over_received": "Over-received",
    "qmovement.received": "Received",
    "qmovement.returned": "Returned",
    "qreceiptstatus.registered": "Registered",
    "qreceiptstatus.pending": "Pending",
    "qreceiptstatus.rejected": "Rejected",
    "qreceiptstatus.cancelled": "Cancelled",
    "qreceiptline.counted": "Counted",
    "qreceiptline.waiting": "Waiting for its order",
    "qreceiptline.needs_attention": "Needs attention",
    "qreceiptline.rejected": "Rejected",
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
    "report.event_stuck": "Rechnungen, die in einem Schritt festhängen",
    "report.returned_no_reply": "An den Lieferanten zurückgesandt, noch keine korrigierte Rechnung",
    "col.returned": "Zurückgesandt",
    "col.dayssince": "Tage seither",
    "col.returnreason": "Grund der Rücksendung",
    "report.event_duplicate": "Neue mögliche Duplikate",
    "report.event_unapproved_supplier": "Rechnungen von nicht freigegebenen Lieferanten",
    "report.event_file_failed": "Lieferantendateien, die nicht gelesen werden konnten",
    "col.daysatstage": "Tage im Schritt",
    "col.reason": "Grund",
    "col.received": "Eingegangen",
    "col.from": "Von",
    "col.subject": "Betreff",
    "col.problem": "Was schiefging",
    "reason.notonfile": "Lieferant nicht angelegt",
    "reason.onhold": "Lieferant gesperrt",
    "summary.highlightedrow": "hervorgehoben",
    // Entscheidung 0633: die eigene Abfrage des Agenten.
    "report.query": "Ihre eigene Abfrage",
    cutshort: "Hier stehen nur die ersten {n} Zeilen. Grenzen Sie die Abfrage ein, um den Rest zu sehen.",
    "col.country": "Land des Lieferanten",
    "col.net": "Netto",
    "col.vat": "USt.",
    "col.buyerref": "Käuferreferenz",
    "col.ponumber": "Bestellung",
    "col.status": "Status",
    "col.delivered": "Im ERP",
    "col.team": "Team",
    "col.taskstatus": "Aufgabenstatus",
    "col.created": "Erstellt",
    "col.agedays": "Alter, Tage",
    "col.claimed": "Übernommen",
    "col.ended": "Beendet",
    "col.m.count": "Anzahl",
    "col.m.sum": "{field}, zusammen",
    "col.m.avg": "{field}, Durchschnitt",
    "col.m.min": "{field}, kleinster Wert",
    "col.m.max": "{field}, größter Wert",
    "col.m.first": "{field}, frühestens",
    "col.m.last": "{field}, spätestens",
    "qstatus.in_progress": "In Bearbeitung",
    "qstatus.completed": "Prozess durchlaufen",
    "qstatus.returned_manually": "An den Lieferanten zurückgesandt",
    "qstatus.archived": "Archiviert",
    "qstatus.none": "In keinem Prozess",
    "qtaskstatus.open": "Offen",
    "qtaskstatus.completed": "Erledigt",
    "qtaskstatus.returned": "Zurückgegeben",
    "qtaskstatus.cancelled": "Abgebrochen",
    "qyesno.yes": "Ja",
    "qyesno.no": "Nein",
    // Entscheidung 0637: Spalten und Werte der weiteren Datensätze.
    "col.description": "Beschreibung",
    "col.item": "Artikel",
    "col.amount": "Betrag",
    "col.vatrate": "USt.-Satz",
    "col.costcentre": "Kostenstelle",
    "col.glcode": "Sachkonto",
    "col.project": "Projekt",
    "col.visitstage": "Schritt",
    "col.entered": "Erreicht",
    "col.left": "Weitergeleitet",
    "col.daysspent": "Tage dort",
    "col.outcome": "Ergebnis",
    "col.comment": "Kommentar",
    "col.replyarrived": "Korrigierte Rechnung eingegangen",
    "col.erpid": "ERP-Kennung",
    "col.vatid": "USt.-IdNr.",
    "col.city": "Ort",
    "col.onhold": "Gesperrt",
    "col.holdreason": "Sperrgrund",
    "col.paymentterms": "Zahlungsbedingungen",
    "col.matchoption": "Abgleich",
    "col.ordered": "Bestellt",
    "col.invoiced": "Berechnet",
    "col.destination": "Ziel",
    "col.deliverystatus": "Übermittlung",
    "col.queued": "Eingereiht",
    "col.deliveredat": "Übermittelt",
    "col.failedat": "Fehlgeschlagen bei",
    "qsupplierstatus.active": "Aktiv",
    "qsupplierstatus.inactive": "Inaktiv",
    "qmatch.two_way": "Zweifach",
    "qmatch.three_way": "Wareneingang erforderlich",
    "qmatch.none": "Keiner",
    "qpostatus.active": "Aktiv",
    "qpostatus.on_hold": "Gesperrt",
    "qpostatus.closed": "Geschlossen",
    "qdelivery.pending": "Wartend",
    "qdelivery.retrying": "Wird wiederholt",
    "qdelivery.delivered": "Übermittelt",
    "qdelivery.failed": "Fehlgeschlagen",
    "qdelivery.skipped": "Übersprungen",
    "qfile.received": "Empfangen",
    "qfile.delivered": "Gelesen und weitergegeben",
    "qfile.partial": "Teilweise gelesen",
    "qfile.failed": "Nicht lesbar",
    "qfile.dismissed": "Verworfen",
    // Decision 0656: Wareneingänge.
    "report.waiting_on_receipt": "Rechnungen, die auf den Wareneingang warten",
    "report.received_not_invoiced": "Wareneingang ohne Rechnung",
    "report.credit_still_owed": "Ausstehende Gutschriften für Rücksendungen",
    "col.dayswaiting": "Tage wartend",
    "col.orderline": "Bestellposition",
    "col.notinvoiced": "Nicht berechnet",
    "col.oldestreceipt": "Ältester Eingang",
    "col.value": "Wert",
    "col.creditqty": "Erwartete Gutschrift",
    "col.lastreturn": "Letzte Rücksendung",
    "col.receiptstate": "Eingang",
    "col.receipt": "Wareneingang",
    "col.receiptdate": "Eingangsdatum",
    "col.dayssincereceipt": "Tage seit Eingang",
    "col.movement": "Bewegung",
    "col.receiptstatus": "Status des Eingangs",
    "col.linestatus": "Position",
    "col.deliverynote": "Lieferschein",
    "col.recordedby": "Erfasst von",
    "qreceipt.not_received": "Nicht eingegangen",
    "qreceipt.partially_received": "Teilweise eingegangen",
    "qreceipt.fully_received": "Vollständig eingegangen",
    "qreceipt.over_received": "Mehr eingegangen als bestellt",
    "qmovement.received": "Eingang",
    "qmovement.returned": "Rücksendung",
    "qreceiptstatus.registered": "Erfasst",
    "qreceiptstatus.pending": "Ausstehend",
    "qreceiptstatus.rejected": "Abgelehnt",
    "qreceiptstatus.cancelled": "Storniert",
    "qreceiptline.counted": "Gezählt",
    "qreceiptline.waiting": "Wartet auf Bestellung",
    "qreceiptline.needs_attention": "Zu prüfen",
    "qreceiptline.rejected": "Abgelehnt",
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
  // Decision 0633: a measure's label says it of its field ("Sum of {field}").
  const [own, field] = key.split("|");
  const words = w(locale, own.replace(/^agents\./, ""));
  return field ? words.replace("{field}", label(locale, field)) : words;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const NUMERIC = new Set(["money", "count", "days", "percent"]);

export function cell(locale: EmailLocale, value: string | number | null | undefined, kind: string, key: string, enumKey?: string): string {
  if (key === "person" && (value === null || value === undefined)) return w(locale, "unclaimed");
  // Decision 0633: a value from a closed set, in words.
  if (enumKey && typeof value === "string") return w(locale, `${enumKey.replace(/^agents\./, "")}.${value}`);
  if (key === "reason" && typeof value === "string") return w(locale, `reason.${value}`);
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
          if (c.key === "reason" && typeof v === "string") return quote(w(locale, `reason.${v}`));
          if (c.enumKey && typeof v === "string") return quote(cell(locale, v, c.kind, c.key, c.enumKey));
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
  // Decision 0633: a question cut short says so.
  if (table.cutShort) lines.push(w(locale, "cutshort").replace("{n}", String(table.cutShort)));
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
  const widths = table.columns.map((c) => Math.min(28, Math.max(label(locale, c.label).length, ...shown.map((r) => cell(locale, r[c.key], c.kind, c.key, c.enumKey).length))));
  const pad = (s: string, n: number, right: boolean) => (s.length > n ? `${s.slice(0, n - 1)}…` : right ? s.padStart(n) : s.padEnd(n));
  const textRows = [
    table.columns.map((c, i) => pad(label(locale, c.label), widths[i], NUMERIC.has(c.kind))).join("  "),
    ...shown.map((r) => table.columns.map((c, i) => pad(cell(locale, r[c.key], c.kind, c.key, c.enumKey), widths[i], NUMERIC.has(c.kind))).join("  ")),
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
    `<td style="text-align:${NUMERIC.has(c.kind) ? "right" : "left"};padding:6px 10px;border-bottom:1px solid #e3e9f1;white-space:nowrap${r._highlight ? ";color:#9c2b1f;font-weight:700" : ""}">${esc(cell(locale, r[c.key], c.kind, c.key, c.enumKey))}</td>`;
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

/**
 * **A reminder to whoever holds a stuck task — decision 0631.** Sent once
 * a person approved what an agent prepared, in the holder's language,
 * naming who asked, the invoice, the stage and how long it has waited.
 */
const REMINDER_WORDS: Record<EmailLocale, Record<string, string>> = {
  en: {
    subject: "A reminder about invoice {invoice}",
    body: "{approver} asks you to look at invoice {invoice} from {supplier}, which has been with you at {stage} for {days} days.",
    note: "Their note: {note}",
    open: "Open VibeFinance",
    why: "This reminder was prepared by an agent and approved by {approver}.",
    unknown: "an unnamed supplier",
  },
  de: {
    subject: "Erinnerung zur Rechnung {invoice}",
    body: "{approver} bittet Sie, sich die Rechnung {invoice} von {supplier} anzusehen, die seit {days} Tagen im Schritt {stage} bei Ihnen liegt.",
    note: "Hinweis: {note}",
    open: "VibeFinance öffnen",
    why: "Diese Erinnerung hat ein Agent vorbereitet, {approver} hat sie freigegeben.",
    unknown: "einem unbenannten Lieferanten",
  },
};

export function buildReminderEmail(input: {
  locale: EmailLocale;
  approverName: string;
  holderName: string;
  invoiceNumber: string | null;
  supplier: string | null;
  stage: string;
  days: number;
  note: string | null;
  appUrl: string | null;
}): { subject: string; text: string; html: string } {
  const words = REMINDER_WORDS[input.locale];
  const fill = (s: string) =>
    s
      .replace(/\{approver\}/g, input.approverName)
      .replace(/\{invoice\}/g, input.invoiceNumber ?? "—")
      .replace(/\{supplier\}/g, input.supplier ?? words.unknown)
      .replace(/\{stage\}/g, input.stage)
      .replace(/\{days\}/g, String(input.days))
      .replace(/\{note\}/g, input.note ?? "");
  const lines = [
    fill(words.body),
    ...(input.note ? [fill(words.note)] : []),
    ...(input.appUrl ? [`${words.open}: ${input.appUrl}`] : []),
    "",
    fill(words.why),
  ];
  const html = `<div style="font-family:Calibri,Carlito,'Segoe UI',Arial,sans-serif;color:#121a26;font-size:14px;line-height:1.45">
<p style="margin:0 0 10px">${esc(fill(words.body))}</p>
${input.note ? `<p style="margin:0 0 10px;padding:8px 12px;border-left:3px solid #378add;background:#e6f1fb">${esc(fill(words.note))}</p>` : ""}
${input.appUrl ? `<p style="margin:12px 0 0"><a href="${esc(input.appUrl)}" style="color:#185fa5">${esc(words.open)}</a></p>` : ""}
<p style="margin:20px 0 0;color:#7b8798;font-size:12px">${esc(fill(words.why))}</p>
</div>`;
  return { subject: fill(words.subject), text: lines.join("\n"), html };
}
