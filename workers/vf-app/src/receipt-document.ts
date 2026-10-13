import { companyOf, supplierOfOrder } from "./orders-out.js";
import { receiptCsv, receiptPdf, type ReceiptDocument } from "./receipt-pdf.js";
import { receiptLines } from "./receipt-sharing.js";

/**
 * **A goods receipt as a document — decision 0773.** Dan, 13 October
 * 2026: *"can you check whether rendering is possible for goods receipt,
 * in the same way as we have achieved with purchase order?"*, then *"One
 * PDF is fine"*.
 *
 * One document for VibeFinance and the supplier network alike, built from
 * what the supplier may see of a receipt (0738) and nothing more: so what
 * staff look at is what the supplier has. The company is the one whose
 * order the receipt's first line names, filled in from its legal entity
 * as an order's letterhead is; the supplier is that order's.
 */

export type ReceiptFormat = "pdf" | "csv";

export const receiptFormat = (v: string | null): ReceiptFormat => (v === "csv" ? "csv" : "pdf");

export async function receiptDocument(db: D1Database, receiptId: string): Promise<ReceiptDocument | null> {
  const r = await db
    .prepare("SELECT receipt_number, receipt_date, delivery_note, status, cancelled_at FROM goods_receipts WHERE id = ?")
    .bind(receiptId)
    .first<{ receipt_number: string; receipt_date: string; delivery_note: string | null; status: string; cancelled_at: string | null }>();
  if (!r) return null;
  const lines = await receiptLines(db, receiptId);
  const first = lines.length ? [...lines].sort((a, b) => a.orderNumber.localeCompare(b.orderNumber))[0].orderNumber : null;
  const po = first
    ? await db.prepare("SELECT org_unit_id, seller_party_id FROM purchase_orders WHERE order_number = ?").bind(first).first<{ org_unit_id: string | null; seller_party_id: string | null }>()
    : null;
  const company = await companyOf(db, po?.org_unit_id ?? null);
  const supplier = await supplierOfOrder(db, po?.seller_party_id ?? null);
  return {
    company: { name: company.name, addressLine: company.addressLine, city: company.city, postalCode: company.postalCode, country: company.country, vatId: company.vatId },
    receipt: {
      number: r.receipt_number,
      date: r.receipt_date,
      deliveryNote: r.delivery_note,
      cancelled: Boolean(r.cancelled_at),
      status: r.status === "pending" || r.status === "rejected" ? r.status : "registered",
    },
    supplier: supplier
      ? { name: supplier.name, vatId: supplier.vat_id, addressLine: supplier.address_line, city: supplier.city, postalCode: supplier.postal_code, country: supplier.country }
      : null,
    lines,
  };
}

const safeName = (s: string) => s.replace(/[^\w.-]+/g, "_").slice(0, 80) || "receipt";

/** The receipt as a PDF or as our receipt CSV, named by its number. Null for no such receipt. */
export async function receiptFile(db: D1Database, receiptId: string, format: ReceiptFormat): Promise<{ bytes: Uint8Array; contentType: string; filename: string } | null> {
  const doc = await receiptDocument(db, receiptId);
  if (!doc) return null;
  const name = safeName(doc.receipt.number);
  if (format === "csv") return { bytes: new TextEncoder().encode(receiptCsv(doc)), contentType: "text/csv; charset=utf-8", filename: `${name}.csv` };
  return { bytes: await receiptPdf(doc), contentType: "application/pdf", filename: `${name}.pdf` };
}

/** Inline to look at, `download=1` as the file; the CSV is always a file. Never kept by a cache. */
export function receiptFileResponse(file: { bytes: Uint8Array; contentType: string; filename: string } | null, download: boolean): Response {
  if (!file) return new Response(JSON.stringify({ error: "no such receipt" }), { status: 404, headers: { "Content-Type": "application/json; charset=utf-8" } });
  return new Response(file.bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `${download || file.contentType !== "application/pdf" ? "attachment" : "inline"}; filename="${file.filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
