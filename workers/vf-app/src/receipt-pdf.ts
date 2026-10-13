import { PDFDocument, StandardFonts } from "pdf-lib";
import { A4, BAD, INK, M, MUTED, TINT, WARN, Writer, wrap, type Column, type Fonts } from "./order-pdf.js";

/**
 * **A goods receipt as a PDF — decision 0773.** The same page the
 * customer and the supplier both see, built from what the supplier may see
 * of a receipt (0738): what arrived and what went back. Its number, date
 * and delivery note; the supplier; and per line the order and order line,
 * the item, what was ordered, received, rejected and returned, and the
 * return reason as the customer's list names it. **Never** its notes, who
 * recorded it, or why a line was rejected in checking. No money: a receipt
 * carries none.
 */

export interface ReceiptDocument {
  company: { name: string | null; addressLine: string | null; city: string | null; postalCode: string | null; country: string | null; vatId: string | null };
  receipt: { number: string; date: string; deliveryNote: string | null; cancelled: boolean; status: "registered" | "pending" | "rejected" };
  supplier: { name: string | null; vatId: string | null; addressLine: string | null; city: string | null; postalCode: string | null; country: string | null } | null;
  lines: {
    lineNumber: number;
    orderNumber: string;
    orderLine: number;
    item: string | null;
    unitCode: string | null;
    ordered: number | null;
    received: number;
    rejected: number;
    returned: number;
    reason: string | null;
  }[];
}

const WORDS = {
  title: "Goods receipt",
  number: "Receipt number",
  date: "Received on",
  deliveryNote: "Delivery note",
  supplier: "Supplier",
  receivedBy: "Received by",
  vat: "VAT",
  line: "Line",
  order: "Order",
  item: "Item",
  unit: "Unit",
  ordered: "Ordered",
  received: "Received",
  rejected: "Rejected",
  returned: "Returned",
  reason: "Reason",
  cancelled: "This receipt was cancelled. Nothing on it counts as received.",
  totals: "In all",
  page: "Page {n} of {of}",
  footer: "Goods receipt {number} · {company} · VibeFinance",
};

const qty = (n: number | null | undefined) => (typeof n === "number" ? (Number.isInteger(n) ? String(n) : String(Math.round(n * 1e6) / 1e6)) : "—");
const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (m, k: string) => v[k] ?? m);

export async function receiptPdf(doc: ReceiptDocument): Promise<Uint8Array> {
  const w = WORDS;
  const pdf = await PDFDocument.create();
  const fonts: Fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
  pdf.setTitle(`${w.title} ${doc.receipt.number}`);
  pdf.setAuthor(doc.company.name ?? "VibeFinance");
  pdf.setProducer("VibeFinance");
  pdf.setCreator("VibeFinance");

  const width = A4[0] - 2 * M;
  const cols: Column[] = [
    { key: "line", label: w.line, width: 30 },
    { key: "order", label: w.order, width: 92 },
    { key: "item", label: w.item, width: 0 },
    { key: "ordered", label: w.ordered, width: 50, right: true },
    { key: "received", label: w.received, width: 54, right: true },
    { key: "rejected", label: w.rejected, width: 50, right: true },
    { key: "returned", label: w.returned, width: 52, right: true },
  ];
  cols[2].width = width - cols.reduce((sum, c) => sum + c.width, 0);

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
    next.text(`${w.title} ${doc.receipt.number}`, M, next.y - 10, { size: 9, bold: true });
    next.text(doc.company.name ?? "", M, next.y - 10, { size: 9, color: MUTED, right: A4[0] - M });
    next.y -= 24;
    if (inTable) tableHead(next);
  });

  // The letterhead: the company that received the goods, and what this is.
  const c = doc.company;
  const companyLines = [c.addressLine, [c.postalCode, c.city].filter(Boolean).join(" "), c.country, c.vatId ? `${w.vat} ${c.vatId}` : null].filter((l): l is string => Boolean(l));
  wr.text(c.name ?? "", M, wr.y - 14, { size: 15, bold: true });
  let ly = wr.y - 30;
  for (const l of companyLines) {
    wr.text(l, M, ly, { size: 9, color: MUTED });
    ly -= 12;
  }
  wr.text(w.title, 0, wr.y - 14, { size: 15, bold: true, right: A4[0] - M });
  const orders = [...new Set(doc.lines.map((l) => l.orderNumber))];
  const facts = ([
    [w.number, doc.receipt.number],
    [w.date, doc.receipt.date],
    [w.deliveryNote, doc.receipt.deliveryNote],
    [orders.length > 1 ? "Orders" : w.order, orders.join(", ")],
  ] as [string, string | null][]).filter((f): f is [string, string] => Boolean(f[1]));
  let fy = wr.y - 32;
  for (const [k, v] of facts) {
    wr.text(k, 0, fy, { size: 9, color: MUTED, right: A4[0] - M - 110 });
    wr.text(v, 0, fy, { size: 9, bold: true, right: A4[0] - M });
    fy -= 13;
  }
  wr.y = Math.min(ly, fy) - 14;

  // A cancelled receipt says so across the page.
  if (doc.receipt.cancelled) {
    const banner = wrap(fonts.bold, 10, w.cancelled, width - 20);
    const h = banner.length * 13 + 14;
    wr.need(h);
    wr.box(M, wr.y - h, width, h, BAD);
    let by = wr.y - 17;
    for (const l of banner) {
      wr.text(l, M + 10, by, { size: 10, bold: true });
      by -= 13;
    }
    wr.y -= h + 14;
  }

  // The supplier, and who received the goods.
  const block = (label: string, lines: string[], x: number, colWidth: number) => {
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
  const s = doc.supplier;
  const supplierLines = s
    ? [s.name ?? "—", s.addressLine, [s.postalCode, s.city].filter(Boolean).join(" "), s.country, s.vatId ? `${w.vat} ${s.vatId}` : null].filter((l): l is string => Boolean(l))
    : ["—"];
  const half = (width - 20) / 2;
  wr.need(80);
  const endA = block(w.supplier, supplierLines, M, half);
  const endB = block(w.receivedBy, [c.name ?? "—"], M + half + 20, half);
  wr.y = Math.min(endA, endB) - 16;

  // The lines: what arrived and what went back.
  inTable = true;
  tableHead(wr);
  for (const l of doc.lines) {
    const itemLines = [
      ...wrap(fonts.bold, 9, l.item ?? "—", cols[2].width - 8).map((t) => ({ t, bold: true, muted: false })),
      ...(l.reason ? wrap(fonts.regular, 8, `${w.reason}: ${l.reason}`, cols[2].width - 8).map((t) => ({ t, bold: false, muted: true })) : []),
    ];
    const h = itemLines.length * 11 + 8;
    wr.need(h);
    if (l.returned > 0 || l.rejected > 0) wr.box(M, wr.y - h + 2, width, h, WARN);
    const top = wr.y - 10;
    let x = M;
    for (const col of cols) {
      const value =
        col.key === "line" ? String(l.lineNumber)
        : col.key === "order" ? `${l.orderNumber} / ${l.orderLine}`
        : col.key === "ordered" ? `${qty(l.ordered)}${l.unitCode ? ` ${l.unitCode}` : ""}`
        : col.key === "received" ? (l.received ? qty(l.received) : "—")
        : col.key === "rejected" ? (l.rejected ? qty(l.rejected) : "—")
        : col.key === "returned" ? (l.returned ? qty(l.returned) : "—")
        : null;
      if (value !== null) wr.text(value, x + 4, top, { size: 9, ...(col.right ? { right: x + col.width - 4 } : {}) });
      else itemLines.forEach((il, i) => wr.text(il.t, x + 4, top - i * 11, { size: il.bold ? 9 : 8, bold: il.bold, color: il.muted ? MUTED : INK }));
      x += col.width;
    }
    wr.y -= h;
    wr.rule(wr.y + 2);
  }
  inTable = false;

  // In all, beneath the table.
  const sum = (k: "received" | "rejected" | "returned") => doc.lines.reduce((acc, l) => acc + l[k], 0);
  wr.y -= 10;
  wr.need(20);
  wr.text(w.totals, 0, wr.y, { size: 9, bold: true, right: M + width - 160 - 8 });
  const totalsX = [
    ["received", cols.slice(0, 5).reduce((a, col) => a + col.width, M)],
    ["rejected", cols.slice(0, 6).reduce((a, col) => a + col.width, M)],
    ["returned", cols.slice(0, 7).reduce((a, col) => a + col.width, M)],
  ] as const;
  for (const [k, right] of totalsX) wr.text(qty(sum(k)), 0, wr.y, { size: 9, bold: true, right: right - 4 });

  // Each page: which of how many, and what it is.
  const of = String(wr.pages.length);
  wr.pages.forEach((p, i) => {
    const foot = fill(w.footer, { number: doc.receipt.number, company: c.name ?? "" });
    const pg = fill(w.page, { n: String(i + 1), of });
    p.drawLine({ start: { x: M, y: M + 14 }, end: { x: A4[0] - M, y: M + 14 }, thickness: 0.5, color: MUTED });
    p.drawText(foot.replace(/·/g, "-"), { x: M, y: M, size: 7.5, font: fonts.regular, color: MUTED });
    p.drawText(pg, { x: A4[0] - M - fonts.regular.widthOfTextAtSize(pg, 7.5), y: M, size: 7.5, font: fonts.regular, color: MUTED });
  });
  return pdf.save();
}

const CSV_COLUMNS = ["receipt_number", "receipt_line", "receipt_date", "order_number", "order_line", "quantity", "movement", "return_reason", "unit_code", "delivery_note", "note"];

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // A cell a spreadsheet would run as a formula is kept as text.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * The receipt in the columns our receipt CSV reads (0644), so a download
 * loads back as the same movements. A line rejected in checking was a
 * delivery all the same, so it is a `received` line; the note column is
 * left empty, as notes are never shared.
 */
export function receiptCsv(doc: ReceiptDocument): string {
  const rows = [CSV_COLUMNS.join(",")];
  for (const l of doc.lines) {
    const returned = l.returned > 0;
    rows.push(
      [doc.receipt.number, l.lineNumber, doc.receipt.date, l.orderNumber, l.orderLine, returned ? l.returned : l.received || l.rejected, returned ? "returned" : "received", returned ? l.reason : null, l.unitCode, doc.receipt.deliveryNote, null]
        .map(csvCell)
        .join(",")
    );
  }
  return rows.join("\n") + "\n";
}
