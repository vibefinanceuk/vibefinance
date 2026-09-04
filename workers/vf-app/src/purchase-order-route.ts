import type { RouteResult } from "./org-route.js";
import { parseUblOrder, UblOrderParseError, type ParsedOrder } from "@vibefinance/shared";

/**
 * Purchase order ingestion — decision 0081.
 *
 * Deliberately a separate path from invoice capture, not a fourth
 * structural channel. An order is not a document arriving for
 * processing: nothing extracts from it, no rule evaluates it, no person
 * approves it, and it never enters a process instance. It is
 * **reference data** that invoices are matched against.
 *
 * Routing it through `/sources/:id/capture` would mean detection,
 * intake channels, provenance and a process instance — all of which
 * describe a document with work to be done, and none of which applies.
 */

export interface StoredOrderResult {
  id: string;
  orderNumber: string;
  lines: number;
  replaced: boolean;
}

async function storeOrder(db: D1Database, parsed: ParsedOrder): Promise<StoredOrderResult> {
  const existing = await db
    .prepare("SELECT id FROM purchase_orders WHERE order_number = ?")
    .bind(parsed.orderNumber)
    .first<{ id: string }>();

  const id = existing?.id ?? crypto.randomUUID();

  if (existing) {
    // Replaced, not appended. An order number is unique by construction
    // (migration 0034), and a buyer re-sending an order means a revised
    // one — two versions in storage would make matching ambiguous in
    // the worst way: silently picking one.
    await db.prepare("DELETE FROM purchase_order_lines WHERE purchase_order_id = ?").bind(id).run();
    await db.prepare("DELETE FROM purchase_orders WHERE id = ?").bind(id).run();
  }

  await db
    .prepare(
      `INSERT INTO purchase_orders
         (id, order_number, issue_date, order_type_code, currency, seller_party_id, buyer_party_id,
          line_extension_amount, tax_exclusive_amount, tax_inclusive_amount, payable_amount,
          originator_reference)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      parsed.orderNumber,
      parsed.issueDate ?? null,
      parsed.orderTypeCode ?? null,
      parsed.currency ?? null,
      parsed.sellerPartyId ?? null,
      parsed.buyerPartyId ?? null,
      parsed.lineExtensionAmount ?? null,
      parsed.taxExclusiveAmount ?? null,
      parsed.taxInclusiveAmount ?? null,
      parsed.payableAmount ?? null,
      parsed.originatorReference ?? null
    )
    .run();

  if (parsed.lines.length > 0) {
    await db.batch(
      parsed.lines.map((line) =>
        db
          .prepare(
            `INSERT INTO purchase_order_lines
               (id, purchase_order_id, line_number, quantity, unit_code, line_extension_amount,
                item_name, item_description, sellers_item_id, standard_item_id, price_amount, base_quantity)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            crypto.randomUUID(),
            id,
            line.lineNumber,
            line.quantity ?? null,
            line.unitCode ?? null,
            line.lineExtensionAmount ?? null,
            line.itemName ?? null,
            line.itemDescription ?? null,
            line.sellersItemId ?? null,
            line.standardItemId ?? null,
            line.priceAmount ?? null,
            line.baseQuantity ?? null
          )
      )
    );
  }

  return { id, orderNumber: parsed.orderNumber, lines: parsed.lines.length, replaced: existing !== null };
}

export async function handleIngestPurchaseOrder(db: D1Database, xml: string): Promise<RouteResult> {
  if (xml.trim() === "") {
    return { status: 400, body: { error: "an order document is required" } };
  }

  let parsed: ParsedOrder;
  try {
    parsed = parseUblOrder(xml);
  } catch (err) {
    if (err instanceof UblOrderParseError) {
      // A refusal with the reason, following the compiler's own
      // discipline: never silently stored, never silently dropped.
      return { status: 422, body: { error: err.message } };
    }
    throw err;
  }

  // The spec's own line rule, enforced before the database refuses it
  // less helpfully: "each order line MUST have an item identifier
  // and/or an item name".
  const anonymous = parsed.lines.filter(
    (l) => !l.itemName?.trim() && !l.sellersItemId?.trim() && !l.standardItemId?.trim()
  );
  if (anonymous.length > 0) {
    return {
      status: 422,
      body: {
        error: `line(s) ${anonymous.map((l) => l.lineNumber).join(", ")} have neither an item name nor an identifier`,
        detail: "Peppol BIS Order Only requires each line to have an item identifier and/or an item name",
      },
    };
  }

  const result = await storeOrder(db, parsed);
  return { status: result.replaced ? 200 : 201, body: { ...result } };
}

export async function handleGetPurchaseOrder(db: D1Database, orderNumber: string): Promise<RouteResult> {
  const order = await db
    .prepare("SELECT * FROM purchase_orders WHERE order_number = ?")
    .bind(orderNumber)
    .first<Record<string, unknown>>();
  if (!order) {
    return { status: 404, body: { error: `no purchase order ${orderNumber}` } };
  }

  const lines = await db
    .prepare("SELECT * FROM purchase_order_lines WHERE purchase_order_id = ? ORDER BY line_number")
    .bind(order.id as string)
    .all<Record<string, unknown>>();

  return { status: 200, body: { order, lines: lines.results } };
}
