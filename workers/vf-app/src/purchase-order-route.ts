import type { RouteResult } from "./org-route.js";
import { parseUblOrder, UblOrderParseError, type ParsedOrder } from "@vibefinance/shared";
import { parseCsv } from "./load-suppliers.js";
import { matchLegalEntity } from "./derive-org.js";
import { scopedToChosenOrg, unitClause, unitsWherePermitted, isWithinScope } from "./enforce.js";

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

/**
 * Which legal entity a purchase order belongs to — decision 0374.
 *
 * **Refused, never stored unassigned.** Unlike invoices
 * (`deriveOrgUnit`), an unmatched or missing buyer tax reference is not
 * left as a null for a person to notice later — the operator's own
 * words were "this should always be known," since a purchase order
 * describes the buyer's own purchasing system to itself, not a
 * document a third party could genuinely misaddress. So this returns
 * a refusal reason instead of a nullable result, and neither caller
 * below ever calls `storeOrder` without a real, matched org unit id.
 */
async function deriveOrgForOrder(
  db: D1Database,
  buyerPartyId: string | undefined
): Promise<{ orgUnitId: string } | { refusalReason: string }> {
  const value = buyerPartyId?.trim();
  if (!value) {
    return {
      refusalReason:
        "no buyer tax reference — the legal entity this order belongs to cannot be determined",
    };
  }

  const orgUnitId = await matchLegalEntity(db, "vat_id", value);
  if (!orgUnitId) {
    return { refusalReason: `buyer tax reference ${value} does not match any known legal entity` };
  }

  return { orgUnitId };
}

/**
 * A CSV's own "status" column, normalised — decision 0377. Generous
 * aliasing on purpose: this is a spreadsheet an ERP exports, not a
 * closed vocabulary a customer is expected to already know the exact
 * spelling of.
 */
const STATUS_ALIASES: Record<string, "active" | "on_hold" | "closed"> = {
  active: "active",
  open: "active",
  on_hold: "on_hold",
  "on hold": "on_hold",
  hold: "on_hold",
  held: "on_hold",
  closed: "closed",
  close: "closed",
};

function normalizeStatus(raw: string | undefined): { status: "active" | "on_hold" | "closed" } | { refusalReason: string } | null {
  const value = raw?.trim();
  if (!value) return null; // Absent — storeOrder() preserves whatever the order already had.
  const normalized = STATUS_ALIASES[value.toLowerCase()];
  if (!normalized) {
    return { refusalReason: `status "${value}" is not recognised — use Active, On Hold, or Closed` };
  }
  return { status: normalized };
}

async function storeOrder(
  db: D1Database,
  parsed: ParsedOrder,
  orgUnitId: string,
  statusOverride?: { status: "active" | "on_hold" | "closed"; holdReason: string | null }
): Promise<StoredOrderResult> {
  const existing = await db
    .prepare("SELECT id, status, hold_reason FROM purchase_orders WHERE order_number = ?")
    .bind(parsed.orderNumber)
    .first<{ id: string; status: string; hold_reason: string | null }>();

  const id = existing?.id ?? crypto.randomUUID();

  /**
   * **The ERP wins, deliberately unlike Suppliers.** Suppliers' own
   * `on_hold` flag survives its next load — only a `PUT`'s own fields
   * are overwritten (decision 0230). The operator's own words for
   * purchase orders were the opposite: "I would expect these status
   * to be overridden by uploading a spreadsheet from the ERP, as the
   * ERP is the system of truth." So an explicit status in this load
   * replaces whatever was there, even a closed order — "terminal" is
   * a rule for the manual Hold/Release/Close actions below, not a
   * rule this load path is bound by. Absent from this load entirely,
   * the existing status is preserved rather than silently reset to
   * Active just because a re-upload happened to say nothing about it.
   */
  const status = statusOverride?.status ?? (existing?.status as "active" | "on_hold" | "closed" | undefined) ?? "active";
  const rawHoldReason = statusOverride ? statusOverride.holdReason : (existing?.hold_reason ?? null);
  // The standing invariant migration 0069 declares: a hold reason
  // exists only while genuinely on hold.
  const holdReason = status === "on_hold" ? rawHoldReason : null;

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
          originator_reference, org_unit_id, status, hold_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      parsed.originatorReference ?? null,
      orgUnitId,
      status,
      holdReason
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

  const result = await deriveOrgForOrder(db, parsed.buyerPartyId);
  if ("refusalReason" in result) {
    return { status: 422, body: { error: result.refusalReason } };
  }

  const stored = await storeOrder(db, parsed, result.orgUnitId);
  return { status: stored.replaced ? 200 : 201, body: { ...stored } };
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
    required: true,
    description:
      "The buyer's VAT id — which legal entity placed this order. Must match an org unit already configured with this VAT id, or the order is refused.",
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
  {
    key: "status",
    columns: ["status", "po status"],
    required: false,
    description:
      "Active, On Hold, or Closed. Overrides whatever status this order already has, since the ERP is the system of truth — left blank on a re-upload, the existing status is kept rather than reset.",
  },
  {
    key: "hold_reason",
    columns: ["hold_reason", "hold reason"],
    required: false,
    description: "Why the order is on hold, when status is On Hold.",
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

    // Refused per order, not the whole file — decision 0374. Every
    // other order in the same CSV still loads; only the ones whose
    // buyer tax reference is missing or unmatched are skipped, each
    // with its own reason in the same refused[] a person already sees
    // for a missing line number or a duplicate one.
    const orgResult = await deriveOrgForOrder(db, parsed.buyerPartyId);
    if ("refusalReason" in orgResult) {
      refused.push({ orderNumber, reason: orgResult.refusalReason });
      continue;
    }

    // Decision 0377 — an unrecognised status refuses the order, the
    // same discipline as every other CSV validation failure; absent
    // entirely, storeOrder() itself decides (preserve on a replace,
    // Active on a new order).
    const statusResult = normalizeStatus(first.status);
    if (statusResult && "refusalReason" in statusResult) {
      refused.push({ orderNumber, reason: statusResult.refusalReason });
      continue;
    }

    const result = await storeOrder(
      db,
      parsed,
      orgResult.orgUnitId,
      statusResult ? { status: statusResult.status, holdReason: first.hold_reason || null } : undefined
    );
    ordersLoaded++;
    linesLoaded += result.lines;
    if (result.replaced) ordersReplaced++;
  }

  const body: PurchaseOrderCsvLoadResult = { loadId, ordersLoaded, ordersReplaced, linesLoaded, refused };
  return { status: 200, body: { ...body } };
}

/**
 * How much has actually been invoiced against a given order, and the
 * five-value status a person actually sees on top of it — decision
 * 0377. A single, shared derived table and `CASE` expression, reused
 * identically by the list's own optional status filter and the
 * status-counts chart, so the two can never disagree about what
 * "Invoiced (Part)" means.
 *
 * **`json_extract` against `facts_json`, not a new column on
 * `invoice_headers`.** The same, already-proven pattern
 * `dashboard-route.ts` and `documents-route.ts` already use for BT-1,
 * BT-9, and BT-27 — BT-13 (an invoice's own purchase order reference)
 * has never been a structured column either, and did not need to
 * become one just for this.
 *
 * **A derived table, joined once, not the same subquery repeated in
 * every branch of the `CASE`** — computed a single time per order,
 * not three times per row.
 *
 * **Only `active` orders are refined into Invoiced (Part)/(Full).**
 * `on_hold` and `closed` are the real, assignable lifecycle the
 * operator asked for; invoicing progress is a fact about an *active*
 * order specifically; an order already on hold or closed keeps that
 * status regardless of how much of it has been invoiced.
 */
const INVOICED_AMOUNTS_JOIN = `
  LEFT JOIN (
    SELECT json_extract(facts_json, '$."BT-13"') AS order_number,
           SUM(CAST(json_extract(facts_json, '$."BT-112"') AS REAL)) AS invoiced_amount
    FROM invoice_headers
    WHERE json_extract(facts_json, '$."BT-13"') IS NOT NULL
    GROUP BY json_extract(facts_json, '$."BT-13"')
  ) inv ON inv.order_number = po.order_number
`;

const EFFECTIVE_STATUS_CASE = `
  CASE
    WHEN po.status = 'closed' THEN 'closed'
    WHEN po.status = 'on_hold' THEN 'on_hold'
    WHEN po.payable_amount IS NOT NULL AND COALESCE(inv.invoiced_amount, 0) >= po.payable_amount AND COALESCE(inv.invoiced_amount, 0) > 0 THEN 'invoiced_full'
    WHEN COALESCE(inv.invoiced_amount, 0) > 0 THEN 'invoiced_part'
    ELSE 'active'
  END
`;

const EFFECTIVE_STATUSES = ["active", "on_hold", "closed", "invoiced_part", "invoiced_full"] as const;

/** The chart's own click-to-filter, and the list's optional `?status=` — the same five values either way. */
function statusClause(status: string | null): { sql: string; binds: unknown[] } {
  if (!status) return { sql: "", binds: [] };
  if (!(EFFECTIVE_STATUSES as readonly string[]).includes(status)) return { sql: " AND 1 = 0", binds: [] };
  return { sql: ` AND (${EFFECTIVE_STATUS_CASE}) = ?`, binds: [status] };
}

/**
 * The chart itself — decision 0377. Org-wide, deliberately independent
 * of the list's own search term: the operator's own words were "the
 * chart should show Org wide values," a fixed overview a person can
 * click into, not a count that shifts under them every time they type
 * in the search box beside it. Still respects the chosen org and the
 * real permission scope, both genuine visibility boundaries rather
 * than a filter the person applied themselves.
 */
export async function handleGetPurchaseOrderStatusCounts(
  db: D1Database,
  currentOrg: string | null = null,
  userId?: string
): Promise<RouteResult> {
  const visible = userId ? await unitsWherePermitted(db, userId, "AP.Validate") : null;
  const scopedUnits = await scopedToChosenOrg(db, visible, currentOrg);
  const orgClause = unitClause({ units: scopedUnits }, "po.org_unit_id");

  const rows = await db
    .prepare(
      `SELECT (${EFFECTIVE_STATUS_CASE}) AS status, count(*) AS n
       FROM purchase_orders po
       ${INVOICED_AMOUNTS_JOIN}
       WHERE 1 = 1 ${orgClause.sql}
       GROUP BY (${EFFECTIVE_STATUS_CASE})`
    )
    .bind(...orgClause.binds)
    .all<{ status: string; n: number }>();

  const counts = Object.fromEntries(EFFECTIVE_STATUSES.map((s) => [s, 0]));
  for (const row of rows.results) counts[row.status] = row.n;

  return { status: 200, body: { counts } };
}

/**
 * Hold, Release Hold, Close — decision 0377, mirroring Suppliers' own
 * hold mechanism (decision 0230) on the operator's own request: "a
 * Hold and Release Hold button on the pop-out, similar to viewing
 * supplier records." `Admin.Configure`, the same permission that
 * mechanism uses — "changing a record by hand."
 *
 * **Closed is terminal — through this route.** Once closed, no
 * further call here may change it; the ERP re-upload path is the one
 * exception, on the operator's own reasoning that the ERP is the
 * system of truth and terminal is a rule for a person clicking a
 * button, not a rule the source of record is bound by.
 *
 * **A hold needs a reason, the same requirement migration 0049
 * already placed on a supplier's own hold** — mirrored, not
 * reinvented. Release and Close carry no reason of their own; a
 * reason explains why something is being held, not why it stopped
 * being held or was closed out.
 */
export async function handleSetPurchaseOrderStatus(
  db: D1Database,
  orderNumber: string,
  body: { status?: unknown; holdReason?: unknown }
): Promise<RouteResult> {
  const requested = typeof body.status === "string" ? body.status : "";
  if (!["active", "on_hold", "closed"].includes(requested)) {
    return { status: 400, body: { error: "status must be active, on_hold, or closed" } };
  }
  if (requested === "on_hold" && !(typeof body.holdReason === "string" && body.holdReason.trim() !== "")) {
    return { status: 400, body: { error: "a reason is required to place an order on hold" } };
  }

  const existing = await db
    .prepare("SELECT id, status FROM purchase_orders WHERE order_number = ?")
    .bind(orderNumber)
    .first<{ id: string; status: string }>();
  if (!existing) {
    return { status: 404, body: { error: `no purchase order ${orderNumber}` } };
  }
  if (existing.status === "closed") {
    return { status: 422, body: { error: `${orderNumber} is closed, which is permanent — it cannot be changed by hand` } };
  }

  const holdReason = requested === "on_hold" ? (body.holdReason as string).trim() : null;
  await db
    .prepare("UPDATE purchase_orders SET status = ?, hold_reason = ? WHERE id = ?")
    .bind(requested, holdReason, existing.id)
    .run();

  return { status: 200, body: { orderNumber, status: requested, holdReason } };
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
/** Page sizes offered in the UI dropdown — anything else is rejected back to the default. */
const ALLOWED_PAGE_SIZES = [25, 50, 100, 200] as const;
const DEFAULT_PAGE_SIZE = 50;

function normalizePageSize(requested: string | null): number {
  const n = requested ? Number(requested) : NaN;
  return (ALLOWED_PAGE_SIZES as readonly number[]).includes(n) ? n : DEFAULT_PAGE_SIZE;
}

function normalizePage(requested: string | null): number {
  const n = requested ? Number(requested) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/**
 * The search clause — decision 0376. Order number and seller VAT are
 * header fields; item name and description are line fields, so a
 * plain `WHERE` on them would need the header/line join `line_count`
 * already depends on, and would double-count a header whose several
 * lines all matched. An `EXISTS` subquery instead: "does at least one
 * line match," entirely independent of the header join and its own
 * `GROUP BY`.
 *
 * **`%`, `_`, and `\` in the term itself are escaped**, not treated as
 * SQL wildcards — a search for an order number containing a real
 * underscore should match that underscore literally, not "any single
 * character."
 */
function searchClause(search: string | null): { sql: string; binds: unknown[] } {
  const term = search?.trim();
  if (!term) return { sql: "", binds: [] };

  const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
  return {
    sql: ` AND (
      po.order_number LIKE ? ESCAPE '\\'
      OR po.seller_party_id LIKE ? ESCAPE '\\'
      OR EXISTS (
        SELECT 1 FROM purchase_order_lines l
        WHERE l.purchase_order_id = po.id
          AND (l.item_name LIKE ? ESCAPE '\\' OR l.item_description LIKE ? ESCAPE '\\')
      )
    )`,
    binds: [pattern, pattern, pattern, pattern],
  };
}

/**
 * The chosen org narrows the list — decisions 0374 and 0375. `userId`
 * now computes a real, permission-based scope from `AP.Validate` —
 * walked down through the org tree the same way `AP.Supplier` already
 * is for Suppliers (decision 0358) — and the chosen org only ever
 * narrows *further* within it, never replaces it: "intersect, never
 * replace," the same shape Tasks, Documents, and Suppliers already
 * guarantee. `userId` stays optional, defaulting to unrestricted, so
 * a caller with no real person behind it (a scheduled job, a script)
 * is unaffected, the same as every other screen that gained this.
 *
 * **Search and real pagination — decision 0376.** Loading everything
 * and filtering or paging client-side was never viable once a real
 * customer's own count reaches the thousands the operator described —
 * both are pushed to the database itself. `total` is a second, real
 * count query rather than derived from the page returned, since a
 * page of 50 rows says nothing about how many exist in total.
 */
export async function handleListPurchaseOrders(
  db: D1Database,
  currentOrg: string | null = null,
  userId?: string,
  search: string | null = null,
  pageParam: string | null = null,
  pageSizeParam: string | null = null,
  statusParam: string | null = null
): Promise<RouteResult> {
  const visible = userId ? await unitsWherePermitted(db, userId, "AP.Validate") : null;
  const scopedUnits = await scopedToChosenOrg(db, visible, currentOrg);
  const orgClause = unitClause({ units: scopedUnits }, "po.org_unit_id");
  const search_ = searchClause(search);
  const status_ = statusClause(statusParam);
  const page = normalizePage(pageParam);
  const pageSize = normalizePageSize(pageSizeParam);
  const offset = (page - 1) * pageSize;

  const totalRow = await db
    .prepare(
      `SELECT count(*) AS n FROM purchase_orders po
       ${INVOICED_AMOUNTS_JOIN}
       WHERE 1 = 1 ${orgClause.sql} ${search_.sql} ${status_.sql}`
    )
    .bind(...orgClause.binds, ...search_.binds, ...status_.binds)
    .first<{ n: number }>();

  const rows = await db
    .prepare(
      `SELECT po.id, po.order_number, po.issue_date, po.currency, po.seller_party_id,
              po.buyer_party_id, po.payable_amount, po.created_at,
              po.org_unit_id, u.name AS org_unit_name, po.status, po.hold_reason,
              (${EFFECTIVE_STATUS_CASE}) AS effective_status,
              count(pol.id) AS line_count
       FROM purchase_orders po
       LEFT JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
       LEFT JOIN org_units u ON u.id = po.org_unit_id
       ${INVOICED_AMOUNTS_JOIN}
       WHERE 1 = 1 ${orgClause.sql} ${search_.sql} ${status_.sql}
       GROUP BY po.id
       ORDER BY po.created_at DESC, po.rowid DESC
       LIMIT ? OFFSET ?`
    )
    .bind(...orgClause.binds, ...search_.binds, ...status_.binds, pageSize, offset)
    .all<Record<string, unknown>>();

  return {
    status: 200,
    body: { purchaseOrders: rows.results, total: totalRow?.n ?? 0, page, pageSize },
  };
}

/**
 * Reading one order back — decision 0375 adds the same real scope the
 * list now has. Without it, the list could hide an order from someone
 * while this route still handed over its full detail to anyone who
 * knew or guessed its order number — a restriction that only worked
 * as long as nobody tried the direct route.
 *
 * **Only the real, permission-based scope — deliberately not also the
 * chosen org.** The org switcher is a personal view preference for
 * the list, not a second access boundary: someone permitted to see
 * every legal entity, who has simply narrowed their own current view
 * to Acme UK, must still be able to open an Acme France order they
 * were sent a real, direct link to. Intersecting with the chosen org
 * here as well would silently turn a browsing convenience into a
 * second lock nobody asked for.
 *
 * **A 404, not a 403, when the order is real but out of scope** — the
 * same reasoning any access check that can distinguish "does not
 * exist" from "exists, but not for you" should apply: the second is a
 * disclosure the first is not, so it reads identically to genuinely
 * nothing on file.
 */
export async function handleGetPurchaseOrder(db: D1Database, orderNumber: string, userId?: string): Promise<RouteResult> {
  const order = await db
    .prepare(
      `SELECT po.*, u.name AS org_unit_name, (${EFFECTIVE_STATUS_CASE}) AS effective_status
       FROM purchase_orders po
       LEFT JOIN org_units u ON u.id = po.org_unit_id
       ${INVOICED_AMOUNTS_JOIN}
       WHERE po.order_number = ?`
    )
    .bind(orderNumber)
    .first<Record<string, unknown>>();
  if (!order) {
    return { status: 404, body: { error: `no purchase order ${orderNumber}` } };
  }

  const visible = userId ? await unitsWherePermitted(db, userId, "AP.Validate") : null;
  if (!isWithinScope({ units: visible }, (order.org_unit_id as string | null) ?? null)) {
    // Identical to the not-found response above — an order somebody
    // is not permitted to see must not be distinguishable from one
    // that never existed.
    return { status: 404, body: { error: `no purchase order ${orderNumber}` } };
  }

  const lines = await db
    .prepare("SELECT * FROM purchase_order_lines WHERE purchase_order_id = ? ORDER BY line_number")
    .bind(order.id as string)
    .all<Record<string, unknown>>();

  return { status: 200, body: { order, lines: lines.results } };
}
