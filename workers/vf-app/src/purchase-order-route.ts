import type { RouteResult } from "./org-route.js";
import { parseUblOrder, UblOrderParseError, type ParsedOrder } from "@vibefinance/shared";
import { parseCsv } from "./load-suppliers.js";

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

/**
 * Loading purchase orders from a CSV export — decision 0370.
 *
 * **CSV for the same reason decision 0211 gave suppliers one**: it is
 * what a customer can produce from any ERP without an integration, no
 * Peppol connection required. This is deliberately a second ingestion
 * path onto the exact same tables `handleIngestPurchaseOrder` already
 * writes, via the exact same `storeOrder` — a CSV row and a parsed UBL
 * order end up as the identical shape before either ever reaches
 * storage, so replace-on-resubmit, the line invariants, and everything
 * else decision 0081 already built apply here without being rebuilt.
 *
 * **One row per order line**, header columns repeated on every line
 * belonging to the same order — the shape an ERP's own PO line export
 * already has, and the same reasoning `handleLoadSuppliers` gives for
 * why a CSV format follows the source rather than the schema.
 *
 * **The accepted columns are specified once**, as `HEADER_FIELD_SPECS`
 * / `LINE_FIELD_SPECS` below, and everything else — the parser's own
 * lookup maps, and the format reference `GET /purchase-orders/csv-format`
 * hands to the screen a person prepares a file from — is derived from
 * that one list. Decision 0373's own finding: hand-maintaining a
 * second, documentation-facing copy of "what columns are accepted"
 * would drift from what the parser actually accepts the first time one
 * was updated without the other, and silently mislead exactly the
 * person the documentation exists to help.
 */
export interface CsvFieldSpec {
  /** The internal key the parser and `ParsedOrder` use — never shown to a person. */
  key: string;
  /** Every accepted spelling, lower-case, in order — the first is the recommended header for a template. */
  columns: string[];
  required: boolean;
  description: string;
}

export const HEADER_FIELD_SPECS: CsvFieldSpec[] = [
  {
    key: "order_number",
    columns: ["order_number", "order number", "po_number", "po number"],
    required: true,
    description: "The buyer's own order number — what an invoice's own purchase order reference points at.",
  },
  {
    key: "issue_date",
    columns: ["issue_date", "issue date", "order date"],
    required: false,
    description: "When the order was issued.",
  },
  {
    key: "order_type_code",
    columns: ["order_type_code", "order type"],
    required: false,
    description: "A UN/CEFACT 1001 order type code, e.g. 220 for a standard order.",
  },
  {
    key: "currency",
    columns: ["currency"],
    required: false,
    description: "The order's own currency code, e.g. EUR, GBP.",
  },
  {
    key: "seller_party_id",
    columns: ["seller_party_id", "seller vat", "seller vat id", "supplier vat", "supplier vat id"],
    required: false,
    description: "The supplier's VAT id — who the order was placed with.",
  },
  {
    key: "buyer_party_id",
    columns: ["buyer_party_id", "buyer vat", "buyer vat id"],
    required: false,
    description: "The buyer's VAT id — who placed the order.",
  },
  {
    key: "line_extension_amount",
    columns: ["order_net_amount", "order net amount"],
    required: false,
    description: "The order's own net total, before tax.",
  },
  {
    key: "tax_exclusive_amount",
    columns: ["tax_exclusive_amount", "tax exclusive amount"],
    required: false,
    description: "The order's own total excluding tax.",
  },
  {
    key: "tax_inclusive_amount",
    columns: ["tax_inclusive_amount", "tax inclusive amount"],
    required: false,
    description: "The order's own total including tax.",
  },
  {
    key: "payable_amount",
    columns: ["payable_amount", "payable amount", "order total"],
    required: false,
    description: "The order's own total amount due — what a matched invoice's own total is compared against.",
  },
  {
    key: "originator_reference",
    columns: ["originator_reference", "requisition", "requisition number"],
    required: false,
    description: "The buyer's own internal requisition reference.",
  },
];

export const LINE_FIELD_SPECS: CsvFieldSpec[] = [
  {
    key: "line_number",
    columns: ["line_number", "line number", "line", "po line"],
    required: true,
    description: "Which line of the order this is — what an invoice line's own reference points at.",
  },
  {
    key: "quantity",
    columns: ["quantity", "qty"],
    required: false,
    description: "The quantity ordered.",
  },
  {
    key: "unit_code",
    columns: ["unit_code", "unit", "uom"],
    required: false,
    description: "The unit of measure, e.g. EA, KG, HRS.",
  },
  {
    key: "line_amount",
    columns: ["amount", "line_amount", "line amount", "line total"],
    required: false,
    description: "This line's own net amount.",
  },
  {
    key: "item_name",
    columns: ["item_name", "item"],
    required: false,
    description: "The item or service name.",
  },
  {
    key: "item_description",
    columns: ["description", "item_description", "item description"],
    required: false,
    description: "A longer, free-text description of the item.",
  },
  {
    key: "sellers_item_id",
    columns: ["sellers_item_id", "seller item id", "supplier sku", "sku"],
    required: false,
    description: "The supplier's own item code.",
  },
  {
    key: "standard_item_id",
    columns: ["standard_item_id", "gtin", "ean"],
    required: false,
    description: "A standard item identifier, e.g. a GTIN or EAN.",
  },
  {
    key: "price_amount",
    columns: ["price_amount", "unit price", "price"],
    required: false,
    description: "The price per unit.",
  },
  {
    key: "base_quantity",
    columns: ["base_quantity"],
    required: false,
    description: "The quantity the unit price is based on, when not 1.",
  },
];

/** Every spec's own columns, lower-cased, mapped to its internal key — what `parseCsv`'s own header row is matched against. */
function toColumnMap(specs: CsvFieldSpec[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const spec of specs) {
    for (const column of spec.columns) map[column] = spec.key;
  }
  return map;
}

const HEADER_COLUMNS: Record<string, string> = toColumnMap(HEADER_FIELD_SPECS);
const LINE_COLUMNS: Record<string, string> = toColumnMap(LINE_FIELD_SPECS);

function num(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
}

export interface PurchaseOrderCsvLoadResult {
  loadId: string;
  ordersLoaded: number;
  ordersReplaced: number;
  linesLoaded: number;
  /**
   * Orders the load refused, with the reason — decision 0162's
   * argument, the same one `handleLoadSuppliers` already follows: a
   * customer whose export is half wrong should learn that from the
   * load rather than discover it one invoice at a time.
   */
  refused: { orderNumber: string; reason: string }[];
}

/**
 * The CSV format itself, for a person preparing a file — decision
 * 0373. Returns `HEADER_FIELD_SPECS` / `LINE_FIELD_SPECS` verbatim, so
 * what a person sees here can never say something the parser above
 * does not actually accept.
 */
export async function handleGetPurchaseOrderCsvFormat(): Promise<RouteResult> {
  return { status: 200, body: { header: HEADER_FIELD_SPECS, line: LINE_FIELD_SPECS } };
}

export async function handleLoadPurchaseOrdersCsv(db: D1Database, csv: string): Promise<RouteResult> {
  const rows = parseCsv(csv);
  if (rows.length < 2) {
    return { status: 400, body: { error: "the file needs a header row and at least one order line" } };
  }

  const headerCols = rows[0].map((h) => HEADER_COLUMNS[h.trim().toLowerCase()] ?? null);
  const lineCols = rows[0].map((h) => LINE_COLUMNS[h.trim().toLowerCase()] ?? null);

  if (!headerCols.includes("order_number")) {
    return {
      status: 400,
      body: {
        error: "the file needs an order number column — without it a line cannot be grouped into an order",
        reason: "no_order_number_column",
      },
    };
  }
  if (!lineCols.includes("line_number")) {
    return {
      status: 400,
      body: {
        error: "the file needs a line number column — without it BT-132 has nothing to reference",
        reason: "no_line_number_column",
      },
    };
  }

  // Grouped by order number, in the order first seen — a Map rather
  // than an object so an order_number that collides with a JS
  // prototype property (e.g. "constructor") can never misbehave.
  const groups = new Map<string, { row: number; values: Record<string, string> }[]>();
  const rowOrder: string[] = [];

  for (let i = 1; i < rows.length; i++) {
    const headerValues: Record<string, string> = {};
    headerCols.forEach((col, idx) => {
      if (col) headerValues[col] = (rows[i][idx] ?? "").trim();
    });
    const lineValues: Record<string, string> = {};
    lineCols.forEach((col, idx) => {
      if (col) lineValues[col] = (rows[i][idx] ?? "").trim();
    });

    const orderNumber = headerValues.order_number;
    if (!orderNumber) continue; // refused per-order below, once the group is assembled

    if (!groups.has(orderNumber)) {
      groups.set(orderNumber, []);
      rowOrder.push(orderNumber);
    }
    groups.get(orderNumber)!.push({ row: i + 1, values: { ...headerValues, ...lineValues } });
  }

  const loadId = crypto.randomUUID();
  const refused: { orderNumber: string; reason: string }[] = [];
  let ordersLoaded = 0;
  let ordersReplaced = 0;
  let linesLoaded = 0;

  for (const orderNumber of rowOrder) {
    const groupRows = groups.get(orderNumber)!;
    const first = groupRows[0].values;

    const missingLineNumber = groupRows.find((r) => !r.values.line_number);
    if (missingLineNumber) {
      refused.push({ orderNumber, reason: `row ${missingLineNumber.row} has no line number` });
      continue;
    }

    const lines = groupRows.map((r) => ({
      lineNumber: Number(r.values.line_number),
      quantity: num(r.values.quantity),
      unitCode: r.values.unit_code || undefined,
      lineExtensionAmount: num(r.values.line_amount),
      itemName: r.values.item_name || undefined,
      itemDescription: r.values.item_description || undefined,
      sellersItemId: r.values.sellers_item_id || undefined,
      standardItemId: r.values.standard_item_id || undefined,
      priceAmount: num(r.values.price_amount),
      baseQuantity: num(r.values.base_quantity),
    }));

    // The spec's own line rule (decision 0081), enforced identically
    // here rather than only on the XML path — a CSV line with neither
    // an item name nor an identifier is exactly as unmatchable as one
    // parsed from a document.
    const anonymous = lines.filter((l) => !l.itemName?.trim() && !l.sellersItemId?.trim() && !l.standardItemId?.trim());
    if (anonymous.length > 0) {
      refused.push({
        orderNumber,
        reason: `line(s) ${anonymous.map((l) => l.lineNumber).join(", ")} have neither an item name nor an identifier`,
      });
      continue;
    }
    const lineNumbers = lines.map((l) => l.lineNumber);
    if (new Set(lineNumbers).size !== lineNumbers.length) {
      refused.push({ orderNumber, reason: "line numbers must be unique within one order" });
      continue;
    }

    const parsed: ParsedOrder = {
      orderNumber,
      issueDate: first.issue_date || undefined,
      orderTypeCode: first.order_type_code || undefined,
      currency: first.currency || undefined,
      sellerPartyId: first.seller_party_id || undefined,
      buyerPartyId: first.buyer_party_id || undefined,
      lineExtensionAmount: num(first.line_extension_amount),
      taxExclusiveAmount: num(first.tax_exclusive_amount),
      taxInclusiveAmount: num(first.tax_inclusive_amount),
      payableAmount: num(first.payable_amount),
      originatorReference: first.originator_reference || undefined,
      lines,
    };

    const result = await storeOrder(db, parsed);
    ordersLoaded++;
    linesLoaded += result.lines;
    if (result.replaced) ordersReplaced++;
  }

  const body: PurchaseOrderCsvLoadResult = { loadId, ordersLoaded, ordersReplaced, linesLoaded, refused };
  return { status: 200, body: { ...body } };
}

/**
 * Listing loaded purchase orders — decision 0372.
 *
 * `AP.Validate`, not `Admin.Configure` — reusing exactly the permission
 * `handleGetPurchaseOrder` already settled for reading one back
 * (decision 0081's own reasoning: "that is who needs to see it").
 * Loading is configuration; looking at what was loaded is not, and a
 * second permission for the same kind of read would drift from the
 * one already established the moment either changed without the
 * other.
 *
 * **No pagination**, deliberately mirroring `handleListSuppliers`'
 * own choice for the same reason it gave: this is a reference set an
 * AP screen reads in full, not a growing transaction log. Worth
 * revisiting if real volume ever makes that assumption wrong, the same
 * honest limitation Suppliers' own screen states rather than hides.
 *
 * **Line count, not the lines themselves** — a list row is a summary;
 * the full line set is what the existing single-order lookup already
 * returns, and a person clicking through gets it fresh rather than
 * this route duplicating it for every row on every list load.
 *
 * **`created_at DESC, rowid DESC`, not `created_at` alone** — found
 * live, from a real screenshot: a CSV load inserts every order within
 * one request, so a whole batch shares the same second-level
 * timestamp, and ties broke in whatever order SQLite's own storage
 * happened to return them — visibly not insertion order. `id` is
 * `TEXT PRIMARY KEY`, not `INTEGER PRIMARY KEY`, so this table still
 * carries SQLite's own implicit, strictly-increasing `rowid` — a
 * reliable tiebreaker `created_at`'s own precision can't provide.
 */
export async function handleListPurchaseOrders(db: D1Database): Promise<RouteResult> {
  const rows = await db
    .prepare(
      `SELECT po.id, po.order_number, po.issue_date, po.currency, po.seller_party_id,
              po.buyer_party_id, po.payable_amount, po.created_at,
              count(pol.id) AS line_count
       FROM purchase_orders po
       LEFT JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
       GROUP BY po.id
       ORDER BY po.created_at DESC, po.rowid DESC`
    )
    .all<Record<string, unknown>>();

  return { status: 200, body: { purchaseOrders: rows.results } };
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
