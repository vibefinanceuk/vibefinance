import { supplierProjectOnly } from "./supplier-project-only.js";
import type { InvoiceFacts } from "@vibefinance/shared";

/**
 * Computing po.matched / po.variance_pct and their line-level siblings —
 * decision 0370.
 *
 * **Recomputed at every evaluation, never stored.** Decision 0081 named
 * this tension directly: "at capture it is a fact about the moment, at
 * evaluation it changes as orders arrive." A purchase order can land
 * after the invoice that references it — this is reference data loaded
 * on its own schedule, not something that arrives with the invoice — so
 * a value computed once at capture and never revisited would be wrong
 * for exactly the invoices this feature exists to help: the ones whose
 * order shows up later. Every caller assembling facts for evaluation is
 * expected to call this fresh, the same way mergeStructuredInvoiceFacts
 * already re-derives supplier.* facts rather than trusting a stored
 * copy.
 *
 * **Tolerance is not invented here.** supplier.amountTolerancePct and
 * supplier.quantityTolerancePct already exist (decision 0209) and are
 * already merged onto every invoice's own facts before this runs. This
 * module reads them rather than asking for a new setting — the same
 * "how far before the match fails" the schema's own comment already
 * describes.
 *
 * **An org-wide default, superseded by the supplier-specific figure
 * when set — decisions 0465/0468, migration 0078.** Before this, an
 * absent supplier tolerance fell back to a hard-coded `?? 0` (exact
 * match) — a real, silent gap: a supplier with no tolerance configured
 * got zero tolerance whether that was ever decided or not.
 * `org_matching_config` gives every org a configurable default instead,
 * itself defaulting to `0` so nothing changes for any org or supplier
 * until an operator sets it deliberately. Read once per
 * mergePoMatchFacts call via getOrgMatchingConfig, not per line — the
 * same "fetched once, threaded through" shape supplier.* facts already
 * get from their own caller.
 */

interface PurchaseOrderRow {
  id: string;
  payable_amount: number | null;
}

interface PurchaseOrderLineRow {
  line_extension_amount: number | null;
  quantity: number | null;
  unit_code: string | null;
  price_amount: number | null;
  base_quantity: number | null;
}

/**
 * **What other invoices have already taken from a PO — decision 0533,
 * phase 3 of the PO matching panel.**
 *
 * Every other invoice whose BT-13 names the order, **except** one whose
 * process ended without being paid: discarded (`archived`, decision
 * 0078) or returned to the supplier (`returned_manually`). Their BT-112
 * sums to `headerAmount`; their lines, each counted against the PO line
 * it points at (a saved pairing, decision 0532, before the supplier's
 * own BT-132), sum per PO line into `byLine`.
 */
export interface PoConsumption {
  headerAmount: number;
  invoices: { id: string; number: string | null; amount: number }[];
  byLine: Map<number, { quantity: number; amount: number }>;
}

/** The instance states whose invoice will never be paid, so never counts as having used a PO. */
const UNPAID_INSTANCE_STATUSES = ["archived", "returned_manually"];

/**
 * **What an invoice takes from its PO — decision 0544.** Its total
 * (BT-112) less its Non-PO lines (0537: freight, carriage, anything the
 * order never covered). The operator: a large freight line must not
 * push the invoice-level PO check over tolerance.
 *
 * A Non-PO line carries a net amount (BT-131) and the total is gross, so
 * the line is grossed up by the invoice's own gross-to-net ratio (BT-112
 * over BT-106, or over the sum of its line nets when BT-106 is absent),
 * taking its VAT with it. With no net to scale by, the net is taken as
 * it is. This function and `PO_SHARE_SQL` below are the one definition,
 * in code and in SQL; a test holds them to the same answer.
 */
export function poShareOfTotal(total: number, net: number | undefined, nonPoNet: number): number {
  if (nonPoNet === 0) return total;
  return total - (net !== undefined && net > 0 ? (nonPoNet * total) / net : nonPoNet);
}

/** `poShareOfTotal` in SQL, for invoice header alias `h`. */
export function poShareSql(h = "h"): string {
  const total = `CAST(json_extract(${h}.facts_json, '$."BT-112"') AS REAL)`;
  const net = `COALESCE(NULLIF(CAST(json_extract(${h}.facts_json, '$."BT-106"') AS REAL), 0),
      (SELECT SUM(CAST(json_extract(l2.facts_json, '$."BT-131"') AS REAL)) FROM invoice_lines l2 WHERE l2.invoice_id = ${h}.id))`;
  const nonPo = `COALESCE((SELECT SUM(CAST(json_extract(np.facts_json, '$."BT-131"') AS REAL))
      FROM invoice_lines np JOIN invoice_line_po_pairings pp ON pp.invoice_id = np.invoice_id AND pp.line_number = np.line_number
      WHERE np.invoice_id = ${h}.id AND pp.kind = 'non_po' AND pp.order_number = json_extract(${h}.facts_json, '$."BT-13"')), 0)`;
  return `(${total} - CASE WHEN ${nonPo} = 0 THEN 0 WHEN ${net} > 0 THEN ${nonPo} * ${total} / ${net} ELSE ${nonPo} END)`;
}

export async function loadPoConsumption(
  db: D1Database,
  orderNumber: string,
  excludeInvoiceId: string | null
): Promise<PoConsumption> {
  const invoices = (
    await db
      .prepare(
        `SELECT h.id, json_extract(h.facts_json, '$."BT-1"') AS number,
                ${poShareSql("h")} AS amount
         FROM invoice_headers h
         WHERE json_extract(h.facts_json, '$."BT-13"') = ? AND h.id != ?
           AND NOT EXISTS (
             SELECT 1 FROM process_instances pi
             WHERE pi.subject_type = 'invoice' AND pi.subject_id = h.id
               AND pi.status IN (${UNPAID_INSTANCE_STATUSES.map(() => "?").join(", ")})
           )
         ORDER BY h.created_at, h.id`
      )
      .bind(orderNumber, excludeInvoiceId ?? "", ...UNPAID_INSTANCE_STATUSES)
      .all<{ id: string; number: string | null; amount: number | null }>()
  ).results;

  const byLine = new Map<number, { quantity: number; amount: number }>();
  if (invoices.length > 0) {
    const ids = invoices.map((i) => i.id);
    const marks = ids.map(() => "?").join(", ");
    const lines = (
      await db
        .prepare(`SELECT invoice_id, line_number, facts_json FROM invoice_lines WHERE invoice_id IN (${marks})`)
        .bind(...ids)
        .all<{ invoice_id: string; line_number: number; facts_json: string | null }>()
    ).results;
    const pairings = (
      await db
        .prepare(
          `SELECT invoice_id, line_number, po_line_number, kind FROM invoice_line_po_pairings
           WHERE order_number = ? AND invoice_id IN (${marks})`
        )
        .bind(orderNumber, ...ids)
        .all<{ invoice_id: string; line_number: number; po_line_number: number | null; kind: string }>()
    ).results;
    // A Non-PO line (decision 0537) takes nothing from the PO, whatever its BT-132 says: NaN below skips it.
    const paired = new Map(
      pairings.map((p) => [`${p.invoice_id}|${p.line_number}`, p.kind === "non_po" ? Number.NaN : (p.po_line_number as number)])
    );
    for (const line of lines) {
      let facts: InvoiceFacts = {};
      try {
        facts = JSON.parse(line.facts_json || "{}") as InvoiceFacts;
      } catch {
        // A line whose facts will not parse has used nothing we can count.
      }
      const ref = paired.get(`${line.invoice_id}|${line.line_number}`) ?? Number(toText(facts["BT-132"]));
      if (!Number.isFinite(ref)) continue;
      const used = byLine.get(ref) ?? { quantity: 0, amount: 0 };
      used.quantity += toNumber(facts["BT-129"]) ?? 0;
      used.amount += toNumber(facts["BT-131"]) ?? 0;
      byLine.set(ref, used);
    }
  }

  return {
    headerAmount: invoices.reduce((s, i) => s + (i.amount ?? 0), 0),
    invoices: invoices.map((i) => ({ id: i.id, number: i.number, amount: i.amount ?? 0 })),
    byLine,
  };
}

const NO_CONSUMPTION: PoConsumption = { headerAmount: 0, invoices: [], byLine: new Map() };

/**
 * How far `actual` goes **over** `allowed`, as a percentage of `base` —
 * decision 0533. 0 at or under; undefined when there is nothing to
 * measure against. Only over-billing is a mismatch: an invoice for part
 * of what is left is a partial delivery, not a disagreement.
 */
function excessPct(actual: number | undefined, allowed: number | undefined, base: number | undefined): number | undefined {
  if (actual === undefined || allowed === undefined || base === undefined || base === 0) return undefined;
  return (Math.max(0, actual - allowed) / Math.abs(base)) * 100;
}

export interface OrgMatchingConfig {
  amountTolerancePct: number;
  quantityTolerancePct: number;
  quantityMatchingEnabled: boolean;
}

/**
 * The zero-behaviour-preserving default — exactly what every caller got
 * before migration 0078 existed (`?? 0` on either tolerance, quantity
 * always compared when both sides carry one). Used when no
 * `org_matching_config` row can be read, so a caller that has not
 * applied the migration yet — or a direct unit test of computePoMatch/
 * computePoLineMatch that does not pass one — sees unchanged behaviour.
 */
const DEFAULT_ORG_MATCHING_CONFIG: OrgMatchingConfig = {
  amountTolerancePct: 0,
  quantityTolerancePct: 0,
  quantityMatchingEnabled: true,
};

interface OrgMatchingConfigRow {
  amount_tolerance_pct: number;
  quantity_tolerance_pct: number;
  quantity_matching_enabled: number;
}

/**
 * Reads the org-wide matching defaults — decisions 0465/0468. Falls
 * back to DEFAULT_ORG_MATCHING_CONFIG if the singleton row is somehow
 * absent, rather than throwing: matching should degrade to today's
 * exact-match behaviour, never fail an invoice outright over a missing
 * settings row.
 */
export async function getOrgMatchingConfig(db: D1Database): Promise<OrgMatchingConfig> {
  const row = await db
    .prepare("SELECT amount_tolerance_pct, quantity_tolerance_pct, quantity_matching_enabled FROM org_matching_config WHERE id = 1")
    .first<OrgMatchingConfigRow>();
  if (!row) return DEFAULT_ORG_MATCHING_CONFIG;
  return {
    amountTolerancePct: row.amount_tolerance_pct,
    quantityTolerancePct: row.quantity_tolerance_pct,
    quantityMatchingEnabled: row.quantity_matching_enabled === 1,
  };
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function toText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (typeof value === "number") return String(value);
  return undefined;
}


export interface PoHeaderMatch {
  matched: boolean;
  variancePct: number | undefined;
  /** Decision 0545 — the PO's own status, when one is held: active, on_hold or closed. */
  status?: string;
  holdReason?: string | null;
}

export interface PoLineMatch {
  matched: boolean;
  variancePct: number | undefined;
  quantityVariancePct: number | undefined;
  /**
   * True once BT-132 points at a purchase order line that actually
   * exists — false whenever `matched` is false for lack of anything to
   * compare against, so a rule can tell "not found at all" apart from
   * "found and disagreed" (decisions 0464/0466).
   */
  referenceFound: boolean;
  /** Undefined exactly when referenceFound is false — nothing to price against. */
  priceMatched: boolean | undefined;
  /** Undefined exactly when referenceFound is false. True when quantity was not comparable, disabled, or agreed. */
  quantityMatched: boolean | undefined;
  /** True only when both sides carry a unit code and they disagree — decision 0466. */
  unitMismatch: boolean;
}

/**
 * Header-level match — decision 0081's original po.matched, finally
 * computed. Joins on BT-13 (the invoice's own purchase order
 * reference) against purchase_orders.order_number.
 *
 * No PO reference, or a referenced PO that does not exist in storage
 * yet, both read as **not matched** — the same state, deliberately.
 * A rule cannot usefully act differently on "no order was ever named"
 * versus "an order was named but has not arrived here yet"; both mean
 * the same thing today: there is nothing to check this invoice
 * against.
 */
export async function computePoMatch(
  db: D1Database,
  headerFacts: InvoiceFacts,
  orgConfig: OrgMatchingConfig = DEFAULT_ORG_MATCHING_CONFIG,
  consumption: PoConsumption = NO_CONSUMPTION,
  /** Decision 0544 — this invoice's total less its Non-PO lines (`poShareOfTotal`); BT-112 when absent. */
  poTotal?: number
): Promise<PoHeaderMatch> {
  const orderNumber = toText(headerFacts["BT-13"]);
  if (!orderNumber) return { matched: false, variancePct: undefined };

  const order = await db
    .prepare("SELECT id, payable_amount, status, hold_reason FROM purchase_orders WHERE order_number = ?")
    .bind(orderNumber)
    .first<PurchaseOrderRow & { status: string; hold_reason: string | null }>();
  if (!order) return { matched: false, variancePct: undefined };

  /**
   * **Only an active PO can be matched — decision 0545.** Reported from
   * the PO matching test pack: a closed or on-hold PO still matched when
   * the amounts agreed. On hold means "don't pay against this yet",
   * closed means "no more invoices against this order"; either way the
   * invoice needs a person, so neither counts as a match (the operator's
   * choice), whatever the amounts say. `status` goes out as `po.status`
   * for rules to route on.
   */
  const active = order.status === "active";
  const statusOf = { status: order.status, holdReason: order.status === "on_hold" ? order.hold_reason : null };

  /**
   * **Against what is left, and only over — decision 0533.** Before, the
   * invoice total had to equal the PO total, so an invoice for part of
   * an order never matched. Now it may not exceed the PO's total less
   * what other invoices have already taken (`consumption`), by more
   * than the tolerance; less is a partial invoice, not a mismatch.
   */
  const invoiceTotal = poTotal ?? toNumber(headerFacts["BT-112"]);
  const payable = order.payable_amount ?? undefined;
  const variance = excessPct(invoiceTotal, payable === undefined ? undefined : payable - consumption.headerAmount, payable);
  if (variance === undefined) return { matched: false, variancePct: undefined, ...statusOf };

  const tolerance = toNumber(headerFacts["supplier.amountTolerancePct"]) ?? orgConfig.amountTolerancePct;
  return { matched: active && variance <= tolerance, variancePct: variance, ...statusOf };
}

/**
 * Line-level match — decision 0370. Joins on BT-13 (which order) and
 * BT-132 (which line of that order), the standard's own mechanism:
 * `InvoiceLine/OrderLineReference/LineID`.
 *
 * **BT-132 absent means not matched, never a positional guess.** The
 * EN 16931 reference guidance is explicit that "order line and invoice
 * line do not always have a one-to-one relation" even when BT-13 is
 * present — falling back to "invoice line N is order line N" would
 * report a match that might not be real, which is worse than reporting
 * none. The same standard applies as po.matched's own header-level
 * absence: refused rather than guessed.
 *
 * **Quantity is checked independently of amount, and its own absence
 * does not fail the line.** A quantity-less line (a service, a flat
 * fee) is not thereby a bad match on price; the two tolerances already
 * exist as separate settings for exactly this reason. A unit mismatch
 * between the two sides (the order says EA, the invoice says BOX) is
 * treated the same way — comparing raw numbers across units would be a
 * meaningless variance, not a real one, so quantity is left out of the
 * verdict rather than reported wrong.
 */
export async function computePoLineMatch(
  db: D1Database,
  headerFacts: InvoiceFacts,
  lineFacts: InvoiceFacts,
  orgConfig: OrgMatchingConfig = DEFAULT_ORG_MATCHING_CONFIG,
  consumption: PoConsumption = NO_CONSUMPTION
): Promise<PoLineMatch> {
  const orderNumber = toText(headerFacts["BT-13"]);
  const lineRef = toText(lineFacts["BT-132"]);
  const notFound: PoLineMatch = {
    matched: false,
    variancePct: undefined,
    quantityVariancePct: undefined,
    referenceFound: false,
    priceMatched: undefined,
    quantityMatched: undefined,
    unitMismatch: false,
  };
  if (!orderNumber || !lineRef) return notFound;

  const lineNumber = Number(lineRef);
  if (!Number.isFinite(lineNumber)) return notFound;

  const order = await db
    .prepare("SELECT id, payable_amount FROM purchase_orders WHERE order_number = ?")
    .bind(orderNumber)
    .first<PurchaseOrderRow>();
  if (!order) return notFound;

  const poLine = await db
    .prepare(
      "SELECT line_extension_amount, quantity, unit_code, price_amount, base_quantity FROM purchase_order_lines WHERE purchase_order_id = ? AND line_number = ?"
    )
    .bind(order.id, lineNumber)
    .first<PurchaseOrderLineRow>();
  if (!poLine) return notFound;

  // From here on, a real order line was found — po.line_reference_found
  // is true regardless of how the amount/quantity comparison goes.
  const used = consumption.byLine.get(lineNumber) ?? { quantity: 0, amount: 0 };

  // Units first: a price per EA and a price per BOX are not comparable.
  const invoiceUnitEarly = toText(lineFacts["BT-130"]);
  const poUnitEarly = toText(poLine.unit_code ?? undefined);
  const unitsAgree = !invoiceUnitEarly || !poUnitEarly || invoiceUnitEarly === poUnitEarly;

  /**
   * **Price: never over what is left, never over the PO's unit price —
   * decision 0533.** Before, the line's amount had to equal the whole PO
   * line's amount, so a line invoicing 10 of 20 read as a 50% price
   * difference. Now two checks, both only against over-billing:
   *  - the line's amount may not exceed the PO line's amount less what
   *    other invoices have already taken from it;
   *  - where both sides give a unit price (BT-146, or amount ÷ quantity;
   *    the PO's price, or its amount ÷ quantity) and the units agree,
   *    the invoice's may not exceed the PO's.
   * `variancePct` is the larger of the two excesses; 0 means neither.
   */
  const invoiceLineAmount = toNumber(lineFacts["BT-131"]);
  const poLineAmount = poLine.line_extension_amount ?? undefined;
  const amountExcess = excessPct(
    invoiceLineAmount,
    poLineAmount === undefined ? undefined : poLineAmount - used.amount,
    poLineAmount
  );
  const invoiceQuantityEarly = toNumber(lineFacts["BT-129"]);
  const invoiceBase = toNumber(lineFacts["BT-149"]) ?? 1;
  const invoiceUnitPrice =
    toNumber(lineFacts["BT-146"]) !== undefined
      ? (toNumber(lineFacts["BT-146"]) as number) / (invoiceBase || 1)
      : invoiceLineAmount !== undefined && invoiceQuantityEarly
        ? invoiceLineAmount / invoiceQuantityEarly
        : undefined;
  const poUnitPrice =
    poLine.price_amount !== null
      ? poLine.price_amount / (poLine.base_quantity || 1)
      : poLineAmount !== undefined && poLine.quantity
        ? poLineAmount / poLine.quantity
        : undefined;
  const priceExcess = unitsAgree ? excessPct(invoiceUnitPrice, poUnitPrice, poUnitPrice) : undefined;
  const amountVariance =
    amountExcess === undefined && priceExcess === undefined ? undefined : Math.max(amountExcess ?? 0, priceExcess ?? 0);
  if (amountVariance === undefined) {
    return {
      matched: false,
      variancePct: undefined,
      quantityVariancePct: undefined,
      referenceFound: true,
      priceMatched: undefined,
      quantityMatched: undefined,
      unitMismatch: false,
    };
  }

  const amountTolerance = toNumber(headerFacts["supplier.amountTolerancePct"]) ?? orgConfig.amountTolerancePct;
  const amountOk = amountVariance <= amountTolerance;

  // Quantity: independent check, and its own absence never fails the
  // line — see the function's own comment above. Also skipped
  // outright when quantity_matching_enabled is off org-wide.
  const invoiceQuantity = toNumber(lineFacts["BT-129"]);
  const invoiceUnit = toText(lineFacts["BT-130"]);
  const poUnit = toText(poLine.unit_code ?? undefined);
  // **decision 0466's own gap**: a real disagreement between the two
  // units, surfaced as its own fact rather than silently read the same
  // as "quantity agreed" by anything testing po.line_quantity_matched.
  const unitMismatch = !!invoiceUnit && !!poUnit && invoiceUnit !== poUnit;
  const unitsComparable = !invoiceUnit || !poUnit || invoiceUnit === poUnit;

  let quantityVariance: number | undefined;
  let quantityOk = true;
  if (orgConfig.quantityMatchingEnabled && unitsComparable) {
    // Never over what is left on the line — decision 0533. Less is a partial delivery.
    const ordered = poLine.quantity ?? undefined;
    quantityVariance = excessPct(invoiceQuantity, ordered === undefined ? undefined : ordered - used.quantity, ordered);
    if (quantityVariance !== undefined) {
      const quantityTolerance = toNumber(headerFacts["supplier.quantityTolerancePct"]) ?? orgConfig.quantityTolerancePct;
      quantityOk = quantityVariance <= quantityTolerance;
    }
  }

  return {
    matched: amountOk && quantityOk,
    variancePct: amountVariance,
    quantityVariancePct: quantityVariance,
    referenceFound: true,
    priceMatched: amountOk,
    quantityMatched: quantityOk,
    unitMismatch,
  };
}

/**
 * This invoice's `poShareOfTotal` from its lines as they stand, the Non-PO
 * ones marked `po.line_non_po` by `applySavedPairings` — decision 0544.
 * `undefined` when it has no total, or no Non-PO lines.
 */
export function invoicePoTotal(headerFacts: InvoiceFacts, lines: InvoiceFacts[]): number | undefined {
  const total = toNumber(headerFacts["BT-112"]);
  if (total === undefined) return undefined;
  const nonPoNet = lines.filter((l) => l["po.line_non_po"] === true).reduce((s, l) => s + (toNumber(l["BT-131"]) ?? 0), 0);
  if (nonPoNet === 0) return undefined;
  const net = toNumber(headerFacts["BT-106"]) || lines.reduce((s, l) => s + (toNumber(l["BT-131"]) ?? 0), 0) || undefined;
  return poShareOfTotal(total, net, nonPoNet);
}

/**
 * Merges header-level po.* facts into `headerFacts`, and line-level
 * po.line_* facts into every entry of `lines`, computed fresh against
 * whatever purchase order data exists right now.
 *
 * A single entry point for every caller that assembles facts before
 * evaluation, so the header and line computations can never drift out
 * of sync with each other or be wired into one call site and forgotten
 * in another.
 */
export async function mergePoMatchFacts(
  db: D1Database,
  headerFacts: InvoiceFacts,
  lines: (InvoiceFacts & { lineNumber: number })[],
  /**
   * **Which invoice this is — decision 0533.** Lets matching count what
   * *other* invoices have already taken from the PO. Every caller that
   * knows it passes it; without it nothing is counted as taken, which
   * is only right for an invoice not yet stored.
   */
  options: { invoiceId?: string } = {}
): Promise<{ headerFacts: InvoiceFacts; lines: (InvoiceFacts & { lineNumber: number })[] }> {
  // Fetched once per call, not once per line — the same "read once,
  // thread through" shape the header facts this function also builds
  // already get from their own caller.
  const orgConfig = await getOrgMatchingConfig(db);
  const orderNumber = toText(headerFacts["BT-13"]);
  const consumption =
    orderNumber && options.invoiceId ? await loadPoConsumption(db, orderNumber, options.invoiceId) : NO_CONSUMPTION;

  const header = await computePoMatch(db, headerFacts, orgConfig, consumption, invoicePoTotal(headerFacts, lines));
  const mergedHeaderFacts: InvoiceFacts = {
    ...headerFacts,
    "po.matched": header.matched,
    ...(header.variancePct !== undefined ? { "po.variance_pct": header.variancePct } : {}),
    // Decision 0545 — absent when the invoice names no PO held here.
    ...(header.status !== undefined ? { "po.status": header.status } : {}),
    ...(header.holdReason ? { "po.hold_reason": header.holdReason } : {}),
  };
  /**
   * Decision 0547 — `supplier.projectOnly`, read live. Here because this
   * is the header merge every evaluation path already runs with the
   * invoice's id; absent when no supplier is attached.
   */
  if (options.invoiceId) {
    const projectOnly = await supplierProjectOnly(db, options.invoiceId);
    if (projectOnly !== null) mergedHeaderFacts["supplier.projectOnly"] = projectOnly;
  }

  const mergedLines = await Promise.all(
    lines.map(async (line) => {
      // Decision 0537 — a Non-PO line is resolved, not a matching failure: no po.line_* fact but its own.
      if (line["po.line_non_po"] === true) return { ...line };
      const lineMatch = await computePoLineMatch(db, mergedHeaderFacts, line, orgConfig, consumption);
      return {
        ...line,
        "po.line_matched": lineMatch.matched,
        ...(lineMatch.variancePct !== undefined ? { "po.line_variance_pct": lineMatch.variancePct } : {}),
        ...(lineMatch.quantityVariancePct !== undefined
          ? { "po.line_quantity_variance_pct": lineMatch.quantityVariancePct }
          : {}),
        "po.line_reference_found": lineMatch.referenceFound,
        ...(lineMatch.priceMatched !== undefined ? { "po.line_price_matched": lineMatch.priceMatched } : {}),
        ...(lineMatch.quantityMatched !== undefined ? { "po.line_quantity_matched": lineMatch.quantityMatched } : {}),
        "po.line_unit_mismatch": lineMatch.unitMismatch,
      };
    })
  );

  if (orderNumber) await mergeReceiptFacts(db, mergedHeaderFacts, mergedLines, orderNumber, orgConfig, consumption, options.invoiceId);

  return { headerFacts: mergedHeaderFacts, lines: mergedLines };
}

/**
 * Whether the invoice's supplier is **Receipting required** — decision
 * 0647: `match_option = 'three_way'` (shown so since 0643). Read live
 * from the invoice's supplier, like `supplier.projectOnly`, so marking a
 * supplier takes effect on invoices already in hand; else the
 * `supplier.matchOption` captured with the invoice.
 */
export async function receiptingRequired(db: D1Database, invoiceId: string | undefined, headerFacts: InvoiceFacts): Promise<boolean> {
  if (invoiceId) {
    try {
      const row = await db
        .prepare("SELECT s.match_option FROM invoice_headers h JOIN suppliers s ON s.id = h.supplier_id WHERE h.id = ?")
        .bind(invoiceId)
        .first<{ match_option: string | null }>();
      if (row) return row.match_option === "three_way";
    } catch {
      // No supplier table to read: fall back to what was captured.
    }
  }
  return toText(headerFacts["supplier.matchOption"]) === "three_way";
}

/**
 * **The receipt facts once the supplier is known — decision 0649.** At
 * intake the PO facts are merged before the supplier is matched (the
 * enricher runs after), so the first pass cannot know the supplier is
 * Receipting required and leaves the receipt facts out. This second
 * pass, given the enriched header facts (`supplier.matchOption`,
 * `supplier.quantityTolerancePct`), adds them. Lines are changed in
 * place; a line that already has them is worked out again, the same way.
 */
export async function mergeReceiptFactsForInvoice(
  db: D1Database,
  headerFacts: InvoiceFacts,
  lines: (InvoiceFacts & { lineNumber: number })[],
  invoiceId: string
): Promise<void> {
  const orderNumber = toText(headerFacts["BT-13"]);
  if (!orderNumber || lines.length === 0) return;
  const orgConfig = await getOrgMatchingConfig(db);
  const consumption = await loadPoConsumption(db, orderNumber, invoiceId);
  await mergeReceiptFacts(db, headerFacts, lines, orderNumber, orgConfig, consumption, invoiceId);
}

/**
 * **Three-way matching: the receipt facts — decision 0647**, Stage 2 of
 * the Goods Receipts proposal (0643). For an invoice whose supplier is
 * Receipting required, each line that found its PO line gets:
 *
 * - `po.line_receipt_matched` — everything invoiced against the PO line
 *   so far (other invoices, as two-way matching counts them, plus this
 *   invoice's lines on it up to this one) is within what is held: net
 *   received (received less returned, receipts not cancelled), allowing
 *   the supplier's quantity tolerance, or the organisation's;
 * - `po.line_receipt_shortfall_pct` — how far it goes beyond what is
 *   held, as a percentage of the quantity ordered; 0 when it does not;
 * - `po.line_credit_expected` — goods were returned from that line and
 *   what is invoiced goes beyond what was kept: a credit note is owed.
 *
 * **Absent, not false**, for any other supplier, a Non-PO line, a line
 * whose PO line was not found, or one with no quantity — so a receipt
 * rule can never fire on a two-way supplier, whatever its sentence
 * says (the same convention 0466 set for the line facts). Computed
 * fresh each time: a receipt recorded since changes the answer.
 */
export async function mergeReceiptFacts(
  db: D1Database,
  headerFacts: InvoiceFacts,
  lines: (InvoiceFacts & { lineNumber: number })[],
  orderNumber: string,
  orgConfig: OrgMatchingConfig,
  consumption: PoConsumption,
  invoiceId: string | undefined
): Promise<void> {
  if (!(await receiptingRequired(db, invoiceId, headerFacts))) return;
  let heldRows: { line: number; movement: string; qty: number }[];
  let orderedRows: { line_number: number; quantity: number | null }[];
  try {
    heldRows = (
      await db
        .prepare(
          `SELECT l.order_line_number AS line, l.movement, SUM(l.quantity) AS qty
           FROM goods_receipt_lines l JOIN goods_receipts r ON r.id = l.receipt_id
           WHERE l.order_number = ? AND r.cancelled_at IS NULL
           GROUP BY l.order_line_number, l.movement`
        )
        .bind(orderNumber)
        .all<{ line: number; movement: string; qty: number }>()
    ).results;
    orderedRows = (
      await db
        .prepare(
          `SELECT pl.line_number, pl.quantity FROM purchase_order_lines pl
           JOIN purchase_orders po ON po.id = pl.purchase_order_id WHERE po.order_number = ?`
        )
        .bind(orderNumber)
        .all<{ line_number: number; quantity: number | null }>()
    ).results;
  } catch {
    // Before migration 0140: no receipts to judge by.
    return;
  }
  const held = new Map<number, { received: number; returned: number }>();
  for (const r of heldRows) {
    const h = held.get(r.line) ?? { received: 0, returned: 0 };
    if (r.movement === "returned") h.returned += r.qty;
    else h.received += r.qty;
    held.set(r.line, h);
  }
  const ordered = new Map(orderedRows.map((r) => [r.line_number, r.quantity]));
  const tolerancePct = toNumber(headerFacts["supplier.quantityTolerancePct"]) ?? orgConfig.quantityTolerancePct ?? 0;
  const thisInvoice = new Map<number, number>();
  const EPS = 1e-9;

  for (const line of [...lines].sort((a, b) => a.lineNumber - b.lineNumber)) {
    if (line["po.line_non_po"] === true || line["po.line_reference_found"] !== true) continue;
    const ref = Number(toText(line["BT-132"]));
    const quantity = toNumber(line["BT-129"]);
    if (!Number.isFinite(ref) || quantity === undefined) continue;
    const before = thisInvoice.get(ref) ?? 0;
    thisInvoice.set(ref, before + quantity);
    const soFar = (consumption.byLine.get(ref)?.quantity ?? 0) + before + quantity;
    const h = held.get(ref) ?? { received: 0, returned: 0 };
    const net = h.received - h.returned;
    const orderedQty = ordered.get(ref) ?? null;
    const slack = orderedQty ? (orderedQty * tolerancePct) / 100 : 0;
    const beyond = soFar > net + slack + EPS;
    line["po.line_receipt_matched"] = !beyond;
    if (orderedQty) line["po.line_receipt_shortfall_pct"] = Math.round((Math.max(0, soFar - net) / orderedQty) * 10000) / 100;
    line["po.line_credit_expected"] = h.returned > EPS && beyond;
  }
}
