import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { OrderDocument, OrderKind } from "./orders-out.js";
import type { OrderDiff } from "./order-history.js";
import { HEADER_FIELD_SPECS, LINE_FIELD_SPECS } from "./purchase-order-route.js";

/**
 * **A purchase order as a PDF — decision 0760**, slice 4b of purchase
 * orders. Dan, 13 October 2026, agreeing the approach: *"A PDF library
 * running inside our own code (pdf-lib)"* — nothing leaves the platform,
 * no Cloudflare service beyond the Worker, and the layout is ours.
 *
 * A4, in the supplier's language (as the email, 0759): the customer's
 * company as the letterhead; what it is (an order, a change, a
 * cancellation) and its facts; the supplier and the buyer; the lines,
 * across as many pages as they need with their heading on each; the
 * totals. A change marks its new and changed lines and lists those it
 * removed, with what changed beneath (0754's comparison); a cancellation
 * says so across the top, with its note. Each page says which page of how
 * many.
 *
 * pdf-lib's standard fonts (Helvetica) write Windows-1252: anything
 * outside it is written as its nearest plain form, never dropped silently.
 */

type Locale = "en" | "de";

const WORDS: Record<Locale, Record<string, string>> = {
  en: {
    "title.order": "Purchase order",
    "title.change": "Change to purchase order",
    "title.cancellation": "Cancellation of purchase order",
    number: "Order number",
    date: "Order date",
    currency: "Currency",
    requisition: "Requisition",
    supplier: "Supplier",
    buyer: "Buyer",
    vat: "VAT",
    youritem: "Your item no.",
    line: "Line",
    item: "Item",
    quantity: "Quantity",
    unit: "Unit",
    price: "Price",
    amount: "Amount",
    change: "Change",
    "change.added": "New",
    "change.changed": "Changed",
    net: "Net",
    tax: "VAT",
    contact: "Contact",
    taxexcl: "Total excluding tax",
    taxincl: "Total including tax",
    payable: "Total",
    "banner.change": "This replaces the order sent before. New and changed lines are marked.",
    "banner.cancellation": "This order is cancelled. Please do not deliver or invoice it.",
    removed: "Removed lines",
    whatchanged: "What changed",
    note: "Note",
    page: "Page {n} of {of}",
    footer: "{title} {number} · {company} · sent by VibeFinance",
    "f.issueDate": "Order date",
    "f.currency": "Currency",
    "f.seller": "Supplier",
    "f.buyer": "Buyer",
    "f.requisition": "Requisition",
    "f.orderType": "Order type",
    "f.netAmount": "Net",
    "f.payable": "Total",
    "f.item": "Item",
    "f.description": "Description",
    "f.sellersItem": "Your item no.",
    "f.quantity": "Quantity",
    "f.unit": "Unit",
    "f.price": "Price",
    "f.amount": "Amount",
  },
  de: {
    "title.order": "Bestellung",
    "title.change": "Änderung der Bestellung",
    "title.cancellation": "Stornierung der Bestellung",
    number: "Bestellnummer",
    date: "Bestelldatum",
    currency: "Währung",
    requisition: "Bedarfsanforderung",
    supplier: "Lieferant",
    buyer: "Besteller",
    vat: "USt-IdNr.",
    youritem: "Ihre Art.-Nr.",
    line: "Pos.",
    item: "Artikel",
    quantity: "Menge",
    unit: "Einheit",
    price: "Preis",
    amount: "Betrag",
    change: "Änderung",
    "change.added": "Neu",
    "change.changed": "Geändert",
    net: "Netto",
    tax: "MwSt.",
    contact: "Ansprechpartner",
    taxexcl: "Summe ohne Steuer",
    taxincl: "Summe mit Steuer",
    payable: "Summe",
    "banner.change": "Diese ersetzt die zuvor gesendete Bestellung. Neue und geänderte Positionen sind markiert.",
    "banner.cancellation": "Diese Bestellung ist storniert. Bitte weder liefern noch fakturieren.",
    removed: "Entfernte Positionen",
    whatchanged: "Was sich geändert hat",
    note: "Hinweis",
    page: "Seite {n} von {of}",
    footer: "{title} {number} · {company} · gesendet von VibeFinance",
    "f.issueDate": "Bestelldatum",
    "f.currency": "Währung",
    "f.seller": "Lieferant",
    "f.buyer": "Besteller",
    "f.requisition": "Bedarfsanforderung",
    "f.orderType": "Bestellart",
    "f.netAmount": "Netto",
    "f.payable": "Summe",
    "f.item": "Artikel",
    "f.description": "Beschreibung",
    "f.sellersItem": "Ihre Art.-Nr.",
    "f.quantity": "Menge",
    "f.unit": "Einheit",
    "f.price": "Preis",
    "f.amount": "Betrag",
  },
};

const GERMAN = new Set(["DE", "AT", "CH", "LI"]);
export const localeOf = (country: string | null | undefined): Locale => (GERMAN.has((country ?? "").toUpperCase()) ? "de" : "en");
const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (m, k: string) => v[k] ?? m);

function money(n: number | null | undefined, currency: string | null, locale: Locale): string {
  if (typeof n !== "number") return "";
  try {
    return new Intl.NumberFormat(locale === "de" ? "de-DE" : "en-GB", { style: "currency", currency: currency || "EUR" }).format(n);
  } catch {
    return n.toFixed(2);
  }
}
const qty = (n: number | null | undefined) => (typeof n === "number" ? (Number.isInteger(n) ? String(n) : String(Math.round(n * 1e6) / 1e6)) : "");
const num = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "number" ? qty(v) : String(v));

// ── Layout ─────────────────────────────────────────────────────────────

const A4: [number, number] = [595.28, 841.89];
const M = 40; // margin
const INK = rgb(0.07, 0.1, 0.15);
const MUTED = rgb(0.36, 0.4, 0.46);
const RULE = rgb(0.78, 0.82, 0.88);
const TINT = rgb(0.95, 0.96, 0.98);
const WARN = rgb(0.99, 0.95, 0.88);
const BAD = rgb(0.99, 0.91, 0.91);

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

/** Text the standard fonts can write: Windows-1252, with the commonest others in their plain form. */
function writable(font: PDFFont, s: string): string {
  const plain = s
    .replace(/[→➔⟶]/g, "->")
    .replace(/[←]/g, "<-")
    .replace(/[    ]/g, " ")
    .replace(/[‐‑‒]/g, "-");
  let out = "";
  for (const ch of plain) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += ch.normalize("NFD").replace(/[̀-ͯ]/g, "") || "?";
    }
  }
  // A decomposed character that still cannot be written is a question mark.
  return [...out].map((ch) => {
    try {
      font.encodeText(ch);
      return ch;
    } catch {
      return "?";
    }
  }).join("");
}

/** Words broken into lines no wider than `width`; a word wider than that is broken where it must be. */
function wrap(font: PDFFont, size: number, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const para of writable(font, text).split(/\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const tryLine = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(tryLine, size) <= width) {
        line = tryLine;
        continue;
      }
      if (line) lines.push(line);
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines.length ? lines : [""];
}

class Writer {
  pages: PDFPage[] = [];
  page!: PDFPage;
  y = 0;
  constructor(private pdf: PDFDocument, private f: Fonts, private onNewPage: (w: Writer) => void) {
    this.newPage();
  }
  newPage() {
    this.page = this.pdf.addPage(A4);
    this.pages.push(this.page);
    this.y = A4[1] - M;
    if (this.pages.length > 1) this.onNewPage(this);
  }
  /** Room for `h` more points above the footer, or a new page. */
  need(h: number) {
    if (this.y - h < M + 28) this.newPage();
  }
  text(s: string, x: number, y: number, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; right?: number } = {}) {
    const font = opts.bold ? this.f.bold : this.f.regular;
    const size = opts.size ?? 9;
    const t = writable(font, s);
    const at = opts.right !== undefined ? opts.right - font.widthOfTextAtSize(t, size) : x;
    this.page.drawText(t, { x: at, y, size, font, color: opts.color ?? INK });
  }
  rule(y: number, x1 = M, x2 = A4[0] - M, color = RULE) {
    this.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: 0.6, color });
  }
  box(x: number, y: number, w: number, h: number, color: ReturnType<typeof rgb>) {
    this.page.drawRectangle({ x, y, width: w, height: h, color });
  }
}

interface Column {
  key: string;
  label: string;
  width: number;
  right?: boolean;
}

export interface PdfOptions {
  kind: OrderKind;
  /** What a change changed (0754), to mark and list. */
  changes?: OrderDiff | null;
  /** A change's reference, or a cancellation's note. */
  note?: string | null;
  changeReference?: string | null;
  locale?: Locale;
  /**
   * Where the supplier's questions go when the order names no buyer: the
   * Destination's reply-to mailbox — decision 0761.
   */
  replyTo?: string | null;
}

/** The order as a PDF. */
export async function orderPdf(doc: OrderDocument, opts: PdfOptions): Promise<Uint8Array> {
  const locale = opts.locale ?? localeOf(doc.supplier?.country);
  const w = WORDS[locale];
  const pdf = await PDFDocument.create();
  const fonts: Fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
  const title = `${w[`title.${opts.kind}`]}`;
  pdf.setTitle(`${title} ${doc.order.order_number}`);
  pdf.setAuthor(doc.company.name ?? "VibeFinance");
  pdf.setProducer("VibeFinance");
  pdf.setCreator("VibeFinance");
  pdf.setLanguage(locale === "de" ? "de-DE" : "en-GB");

  const cur = doc.order.currency;
  const changed = new Map((opts.changes?.lines ?? []).filter((l) => l.change !== "removed").map((l) => [l.line, l]));
  const marking = opts.kind === "change" && changed.size > 0;
  const width = A4[0] - 2 * M;
  const cols: Column[] = [
    { key: "line", label: w.line, width: 32 },
    { key: "item", label: w.item, width: 0 },
    { key: "quantity", label: w.quantity, width: 52, right: true },
    { key: "unit", label: w.unit, width: 38 },
    { key: "price", label: w.price, width: 70, right: true },
    { key: "amount", label: w.amount, width: 78, right: true },
    ...(marking ? [{ key: "change", label: w.change, width: 52 }] : []),
  ];
  cols[1].width = width - cols.reduce((s, c) => s + c.width, 0);

  const tableHead = (wr: Writer) => {
    wr.need(22);
    wr.box(M, wr.y - 16, width, 18, TINT);
    let x = M;
    for (const c of cols) {
      wr.text(c.label, x + 4, wr.y - 11, { size: 8, bold: true, color: MUTED, ...(c.right ? { right: x + c.width - 4 } : {}) });
      x += c.width;
    }
    wr.y -= 20;
  };
  let inTable = false;
  const wr = new Writer(pdf, fonts, (next) => {
    // A continued page: who and what, small, then the table's heading again.
    next.text(`${title} ${doc.order.order_number}`, M, next.y - 10, { size: 9, bold: true });
    next.text(doc.company.name ?? "", M, next.y - 10, { size: 9, color: MUTED, right: A4[0] - M });
    next.y -= 24;
    if (inTable) tableHead(next);
  });

  // The letterhead: the company, and what this is.
  const companyLines = [
    doc.company.addressLine,
    [doc.company.postalCode, doc.company.city].filter(Boolean).join(" "),
    doc.company.country,
    doc.company.vatId ? `${w.vat} ${doc.company.vatId}` : null,
  ].filter((l): l is string => Boolean(l));
  wr.text(doc.company.name ?? "", M, wr.y - 14, { size: 15, bold: true });
  let ly = wr.y - 30;
  for (const l of companyLines) {
    wr.text(l, M, ly, { size: 9, color: MUTED });
    ly -= 12;
  }
  wr.text(title, 0, wr.y - 14, { size: 15, bold: true, right: A4[0] - M });
  const facts: [string, string][] = (
    [
      [w.number, doc.order.order_number],
      [w.date, doc.order.issue_date],
      [w.currency, cur],
      [w.requisition, doc.order.originator_reference],
      ...(opts.changeReference ? [[w.change, opts.changeReference]] : []),
    ] as [string, string | null][]
  ).filter((f): f is [string, string] => Boolean(f[1]));
  let fy = wr.y - 32;
  for (const [k, v] of facts) {
    wr.text(k, 0, fy, { size: 9, color: MUTED, right: A4[0] - M - 110 });
    wr.text(v, 0, fy, { size: 9, bold: true, right: A4[0] - M });
    fy -= 13;
  }
  wr.y = Math.min(ly, fy) - 14;

  // A change or a cancellation says so across the page.
  if (opts.kind !== "order") {
    const banner = wrap(fonts.bold, 10, w[`banner.${opts.kind}`], width - 20);
    const note = opts.note ? wrap(fonts.regular, 9, `${w.note}: ${opts.note}`, width - 20) : [];
    const h = banner.length * 13 + note.length * 12 + 14;
    wr.need(h);
    wr.box(M, wr.y - h, width, h, opts.kind === "cancellation" ? BAD : WARN);
    let by = wr.y - 17;
    for (const l of banner) {
      wr.text(l, M + 10, by, { size: 10, bold: true });
      by -= 13;
    }
    for (const l of note) {
      wr.text(l, M + 10, by, { size: 9 });
      by -= 12;
    }
    wr.y -= h + 14;
  }

  // The supplier and the buyer.
  const s = doc.supplier;
  const partyBlock = (label: string, lines: string[], x: number, colWidth: number) => {
    wr.text(label.toUpperCase(), x, wr.y, { size: 7.5, bold: true, color: MUTED });
    let py = wr.y - 13;
    lines.forEach((l, i) => {
      for (const part of wrap(i === 0 ? fonts.bold : fonts.regular, 9, l, colWidth)) {
        wr.text(part, x, py, { size: 9, bold: i === 0 });
        py -= 12;
      }
    });
    return py;
  };
  const supplierLines = [
    s?.name ?? doc.order.seller_party_id ?? "—",
    s?.address_line,
    [s?.postal_code, s?.city].filter(Boolean).join(" "),
    s?.country,
    s?.vat_id ? `${w.vat} ${s.vat_id}` : doc.order.seller_party_id ? `${w.vat} ${doc.order.seller_party_id}` : null,
    doc.order.supplier_email,
  ].filter((l): l is string => Boolean(l));
  // Decision 0761: who at the company to talk to, not just its name. The
  // order's buyer where it names one; else the Destination's reply-to
  // mailbox; and the company's own email and phone.
  const c = doc.company;
  const contactEmail = doc.buyer?.email ?? opts.replyTo ?? null;
  const buyerLines = [
    c.name ?? doc.buyer?.name ?? "—",
    doc.buyer?.name && c.name ? `${w.contact}: ${doc.buyer.name}` : null,
    contactEmail,
    c.email && c.email.toLowerCase() !== contactEmail?.toLowerCase() ? c.email : null,
    c.phone,
  ].filter((l): l is string => Boolean(l));
  wr.need(80);
  const half = (width - 20) / 2;
  const endA = partyBlock(w.supplier, supplierLines, M, half);
  const endB = partyBlock(w.buyer, buyerLines, M + half + 20, half);
  wr.y = Math.min(endA, endB) - 16;

  // The lines.
  inTable = true;
  tableHead(wr);
  for (const l of doc.lines) {
    const mark = changed.get(l.line_number);
    const itemLines = [
      ...wrap(fonts.bold, 9, l.item_name ?? l.item_description ?? `${w.line} ${l.line_number}`, cols[1].width - 8).map((t) => ({ t, bold: true, muted: false })),
      ...(l.item_name && l.item_description ? wrap(fonts.regular, 8, l.item_description, cols[1].width - 8).map((t) => ({ t, bold: false, muted: true })) : []),
      ...(l.sellers_item_id ? [{ t: `${w.youritem} ${l.sellers_item_id}`, bold: false, muted: true }] : []),
      ...(mark && mark.change === "changed"
        ? wrap(fonts.regular, 8, mark.fields.map((f) => `${w[`f.${f.field}`] ?? f.field}: ${num(f.from)} -> ${num(f.to)}`).join("; "), cols[1].width - 8).map((t) => ({ t, bold: false, muted: true }))
        : []),
    ];
    const h = itemLines.length * 11 + 8;
    wr.need(h);
    if (mark) wr.box(M, wr.y - h + 2, width, h, WARN);
    const top = wr.y - 10;
    let x = M;
    for (const c of cols) {
      const value =
        c.key === "line" ? String(l.line_number)
        : c.key === "quantity" ? qty(l.quantity)
        : c.key === "unit" ? (l.unit_code ?? "")
        : c.key === "price" ? money(l.price_amount, cur, locale)
        : c.key === "amount" ? money(l.line_extension_amount, cur, locale)
        : c.key === "change" ? (mark ? w[`change.${mark.change}`] : "")
        : null;
      if (value !== null) wr.text(value, x + 4, top, { size: 9, bold: c.key === "change", ...(c.right ? { right: x + c.width - 4 } : {}) });
      else itemLines.forEach((il, i) => wr.text(il.t, x + 4, top - i * 11, { size: il.bold ? 9 : 8, bold: il.bold, color: il.muted ? MUTED : INK }));
      x += c.width;
    }
    wr.y -= h;
    wr.rule(wr.y + 2);
  }
  inTable = false;

  // Lines a change removed.
  const removed = (opts.changes?.lines ?? []).filter((l) => l.change === "removed");
  if (opts.kind === "change" && removed.length) {
    wr.y -= 8;
    wr.need(16 + removed.length * 12);
    wr.text(w.removed, M, wr.y, { size: 9, bold: true });
    wr.y -= 13;
    for (const r of removed) {
      wr.text(`${w.line} ${r.line}: ${r.item ?? ""}`, M + 8, wr.y, { size: 9, color: MUTED });
      wr.y -= 12;
    }
  }
  // Header facts a change changed.
  if (opts.kind === "change" && opts.changes?.header.length) {
    wr.y -= 6;
    wr.need(16 + opts.changes.header.length * 12);
    wr.text(w.whatchanged, M, wr.y, { size: 9, bold: true });
    wr.y -= 13;
    for (const h of opts.changes.header) {
      wr.text(`${w[`f.${h.field}`] ?? h.field}: ${num(h.from)} -> ${num(h.to)}`, M + 8, wr.y, { size: 9, color: MUTED });
      wr.y -= 12;
    }
  }

  // The totals.
  // Decision 0761: the tax is its own line, so the totals add up on the page.
  const o = doc.order;
  const net = o.line_extension_amount;
  const excl = o.tax_exclusive_amount ?? net;
  // An order that gives no tax totals: what lies between its net and its
  // total is its tax.
  const incl = o.tax_inclusive_amount ?? o.payable_amount;
  const tax = typeof excl === "number" && typeof incl === "number" ? Math.round((incl - excl) * 100) / 100 : null;
  const totals = ([
    [w.net, net, false],
    [w.taxexcl, typeof excl === "number" && excl !== net ? excl : null, false],
    [w.tax, tax, false],
    [w.taxincl, typeof incl === "number" && incl !== o.payable_amount ? incl : null, false],
    [w.payable, o.payable_amount, true],
  ] as [string, number | null, boolean][]).filter(([, v]) => typeof v === "number");
  if (totals.length) {
    wr.y -= 10;
    wr.need(totals.length * 15 + 6);
    for (const [k, v, strong] of totals) {
      if (strong) wr.rule(wr.y + 11, A4[0] - M - 220, A4[0] - M, INK);
      wr.text(k, 0, wr.y, { size: strong ? 10 : 9, bold: strong, color: strong ? INK : MUTED, right: A4[0] - M - 100 });
      wr.text(money(v, cur, locale), 0, wr.y, { size: strong ? 10 : 9, bold: strong, right: A4[0] - M });
      wr.y -= 15;
    }
  }

  // Each page: which of how many, and what it is.
  const of = String(wr.pages.length);
  wr.pages.forEach((p, i) => {
    const foot = writable(fonts.regular, fill(w.footer, { title, number: doc.order.order_number, company: doc.company.name ?? "" }));
    const pg = writable(fonts.regular, fill(w.page, { n: String(i + 1), of }));
    p.drawLine({ start: { x: M, y: M + 14 }, end: { x: A4[0] - M, y: M + 14 }, thickness: 0.5, color: RULE });
    p.drawText(foot, { x: M, y: M, size: 7.5, font: fonts.regular, color: MUTED });
    p.drawText(pg, { x: A4[0] - M - fonts.regular.widthOfTextAtSize(pg, 7.5), y: M, size: 7.5, font: fonts.regular, color: MUTED });
  });
  return pdf.save();
}

// ── The order as our CSV ───────────────────────────────────────────────

const cell = (v: unknown) => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * **The order as Purchase Orders' own CSV** (0372/0373): a row a line,
 * the order's facts on each, under the first name each column is known
 * by — so the file loads back as the same order.
 */
export function orderCsv(doc: OrderDocument): string {
  const header = HEADER_FIELD_SPECS.filter((s) => s.key !== "status" && s.key !== "hold_reason");
  const head: Record<string, unknown> = {
    order_number: doc.order.order_number,
    issue_date: doc.order.issue_date,
    order_type_code: doc.order.order_type_code,
    currency: doc.order.currency,
    seller_party_id: doc.order.seller_party_id,
    supplier_email: doc.order.supplier_email,
    buyer_party_id: doc.order.buyer_party_id,
    line_extension_amount: doc.order.line_extension_amount,
    tax_exclusive_amount: doc.order.tax_exclusive_amount,
    tax_inclusive_amount: doc.order.tax_inclusive_amount,
    payable_amount: doc.order.payable_amount,
    originator_reference: doc.order.originator_reference,
  };
  const lineValue = (l: OrderDocument["lines"][number], key: string): unknown =>
    key === "line_amount" ? l.line_extension_amount : (l as unknown as Record<string, unknown>)[key];
  const rows = [
    [...header.map((s) => s.columns[0]), ...LINE_FIELD_SPECS.map((s) => s.columns[0])].join(","),
    ...doc.lines.map((l) => [...header.map((s) => cell(head[s.key])), ...LINE_FIELD_SPECS.map((s) => cell(lineValue(l, s.key)))].join(",")),
  ];
  return `${rows.join("\r\n")}\r\n`;
}
