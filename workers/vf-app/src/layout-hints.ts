/**
 * **Telling the reader what it should expect — decision 0703.**
 *
 * Step 3b of `docs/design/supplier-layout-learning.md`. When an invoice
 * arrives from a supplier whose layout has been learned (0702), the
 * extraction prompt says where that supplier prints each value and what it
 * calls it: *"the total with VAT follows the label 'gesamtbetrag', near the
 * bottom right"*. Labels more than positions: the vision model reads labels
 * far better than it measures.
 *
 * **The supplier has to be known before reading**, and it is matched only
 * after (on what the reading found). So it is worked out from the one thing
 * known on arrival: **who sent it**.
 *
 *   1. The sender is a supplier's own email address, and only one supplier's.
 *   2. Invoices from this sender have, before now, turned out to be from one
 *      supplier: at least two, and at least four in five of them.
 *
 * Otherwise nothing is said, and the invoice is read as it always was. A
 * hint never overrides the document: the prompt says the document wins.
 */
import { supplierLayouts, type Layout } from "./supplier-layouts.js";

/** How a field is named in a hint. The header fields learned first (design §5, decision 1). */
const FIELD_NAMES: Record<string, string> = {
  "BT-1": "the invoice number",
  "BT-2": "the invoice date",
  "BT-9": "the payment due date",
  "BT-13": "the purchase order reference",
  "BT-31": "the supplier's VAT number",
  "BT-106": "the sum of the line amounts",
  "BT-109": "the total without VAT",
  "BT-110": "the total VAT",
  "BT-112": "the total with VAT",
  "BT-115": "the amount due for payment",
};

/** Agreeing invoices needed before a sender is taken to mean one supplier. */
export const SENDER_INVOICES = 2;
/** The share of a sender's invoices that must be from that one supplier. */
export const SENDER_SHARE = 0.8;

/** The address in a sender: `"Lager Nord <billing@lager-nord.de>"` is `billing@lager-nord.de`. */
export function senderAddress(sender: string | null | undefined): string | null {
  const raw = String(sender ?? "").trim();
  const inAngles = raw.match(/<([^>]+)>/);
  const address = (inAngles ? inAngles[1] : raw).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+$/.test(address) ? address : null;
}

export interface KnownSupplier {
  supplierId: string;
  name: string;
  how: "supplier_email" | "sender_history";
}

/** Which supplier a sender is, where that is already clear. */
export async function supplierForSender(db: D1Database, sender: string | null | undefined): Promise<KnownSupplier | null> {
  const address = senderAddress(sender);
  if (!address) return null;

  const byEmail = await db
    .prepare("SELECT id, name FROM suppliers WHERE lower(trim(email)) = ? LIMIT 2")
    .bind(address)
    .all<{ id: string; name: string }>();
  if (byEmail.results.length === 1) {
    return { supplierId: byEmail.results[0].id, name: byEmail.results[0].name, how: "supplier_email" };
  }

  const history = await db
    .prepare(
      `SELECT h.supplier_id, s.name, count(DISTINCT h.id) AS n
       FROM route_messages m
       JOIN invoice_documents d ON d.route_message_id = m.id
       JOIN invoice_headers h ON h.id = d.invoice_id
       LEFT JOIN suppliers s ON s.id = h.supplier_id
       WHERE lower(m.counterparty) = ?1 AND h.supplier_id IS NOT NULL
       GROUP BY h.supplier_id
       ORDER BY n DESC`
    )
    .bind(address)
    .all<{ supplier_id: string; name: string | null; n: number }>();
  const total = history.results.reduce((sum, r) => sum + r.n, 0);
  const top = history.results[0];
  if (top && top.n >= SENDER_INVOICES && top.n / total >= SENDER_SHARE) {
    return { supplierId: top.supplier_id, name: top.name ?? top.supplier_id, how: "sender_history" };
  }
  return null;
}

function whereOnPage(box: { x: number; y: number; w: number; h: number }): string {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const v = cy < 0.33 ? "top" : cy < 0.66 ? "middle" : "bottom";
  const h = cx < 0.33 ? "left" : cx < 0.66 ? "centre" : "right";
  return v === "middle" && h === "centre" ? "the middle" : `the ${v} ${h}`;
}

export interface LayoutHint {
  text: string;
  fields: string[];
}

/**
 * The paragraph for the prompt, from a supplier's layouts. With one layout,
 * or one used on at least two in three of its invoices, each field with its
 * label and where it is. With several and none clearly usual, only the
 * labels each field is printed beside (where on the page varies). Null when
 * nothing useful is known.
 */
export function layoutHint(layouts: readonly Layout[], supplierName: string): LayoutHint | null {
  if (!layouts.length) return null;
  const invoices = layouts.reduce((n, l) => n + l.invoices, 0);
  const usual = layouts.length === 1 || layouts[0].invoices / invoices >= 2 / 3 ? layouts[0] : null;
  const multiPage = layouts.some((l) => l.fields.some((f) => f.pageNumber > 1));

  const lines: string[] = [];
  const fields: string[] = [];
  if (usual) {
    for (const f of usual.fields) {
      const name = FIELD_NAMES[f.field];
      if (!name) continue;
      const label = f.label ? `follows the label "${f.label}"` : "is printed";
      lines.push(`- ${name} ${label}, near ${whereOnPage(f.box)}${multiPage ? ` of page ${f.pageNumber}` : ""}.`);
      fields.push(f.field);
    }
  } else {
    const labels = new Map<string, Set<string>>();
    for (const l of layouts) for (const f of l.fields) if (FIELD_NAMES[f.field] && f.label) (labels.get(f.field) ?? labels.set(f.field, new Set()).get(f.field)!).add(f.label);
    for (const [field, set] of [...labels.entries()].sort()) {
      lines.push(`- ${FIELD_NAMES[field]} follows the label ${[...set].map((l) => `"${l}"`).join(" or ")}.`);
      fields.push(field);
    }
  }
  if (!lines.length) return null;
  return {
    fields,
    text: [
      `This invoice is very likely from ${supplierName}, whose invoices have been read before. On their invoices:`,
      ...lines,
      `Labels are given in lower case without spaces or punctuation; on the page they may read "Rechnungs-Nr." for "rechnungsnr". Use this to find each value, but report only what this document shows: where it differs, the document is right.`,
    ].join("\n"),
  };
}

/** What the extraction prompt should be told about a document from `sender`, if anything. */
export async function hintBeforeReading(
  db: D1Database,
  sender: string | null | undefined
): Promise<(LayoutHint & { supplierId: string; supplierName: string; how: KnownSupplier["how"] }) | null> {
  const supplier = await supplierForSender(db, sender);
  if (!supplier) return null;
  const { layouts } = await supplierLayouts(db, supplier.supplierId);
  const hint = layoutHint(layouts, supplier.name);
  return hint ? { ...hint, supplierId: supplier.supplierId, supplierName: supplier.name, how: supplier.how } : null;
}
