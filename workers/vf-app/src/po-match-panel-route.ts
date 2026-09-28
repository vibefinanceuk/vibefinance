import type { InvoiceFacts } from "@vibefinance/shared";
import type { RouteResult } from "./org-route.js";
import { computePoLineMatch, computePoMatch, getOrgMatchingConfig, loadPoConsumption, type PoConsumption } from "./po-matching.js";
import { unitsWherePermitted, isWithinScope, unitClause } from "./enforce.js";
import { handleKeyInvoiceFields } from "./key-fields-route.js";
import { activePairings, loadPairings } from "./po-pairings.js";

/**
 * The Matching stage's PO matching panel, phase 1 — decision 0530.
 *
 * The operator's own request: *"In the matching stage I would like to
 * make available a UI, within which a user can view any automatic
 * matching that has taken place with an existing purchase order, and
 * furthermore correct, or search for a match purchase order from the
 * information stored in the system. The UI should also indicate how
 * much of a PO is used up / consumed."* A mock-up was agreed, then split
 * into four phases; this is the first, built only on data that already
 * exists:
 *
 * - **What was matched** (`handleGetPoMatchView`): the PO the invoice's
 *   BT-13 names, and each invoice line against the PO line its BT-132
 *   names. Every verdict comes from `computePoMatch` /
 *   `computePoLineMatch`, the same functions the Matching rules read, so
 *   the panel can never disagree with the rules.
 * - **How much of the PO is used**, at PO level only: the sum of BT-112
 *   over every *other* invoice naming this PO, the same sum the Purchase
 *   Orders screen's "Invoiced (Part/Full)" status already uses (0377).
 *   Per-line consumption is phase 3.
 * - **Search** (`handlePoCandidates`): the POs held in VibeFinance, with
 *   why each might fit.
 * - **Re-link** (`handleLinkPo`): sets the invoice's BT-13 through the
 *   ordinary keying route, so every rule keying already enforces (a
 *   claimed task, the field editable at this stage, the keying trail)
 *   applies unchanged, and records a `po_link` Timeline event.
 *
 * Not in phase 1: saving a person's line pairing (phase 2), per-line
 * consumption (phase 3), and suggestions for lines with no BT-132
 * (phase 4). Unlinking an invoice from every PO is not offered: keying
 * refuses an empty value by design (decision 0071), and an invoice
 * wrongly carrying a PO number is rare enough to be its own decision.
 */

/**
 * Who may open the panel: the Matching stage's own permission,
 * Validation's, or AP Review's. **AP Review added by decision 0531**: a
 * task returned from AP Review to Matching keeps `AP.Review` (see
 * `task-list-route.ts`), so its holder is the person working the
 * Matching task and needs the panel.
 */
export const PO_PANEL_PERMISSIONS = ["AP.Match", "AP.Validate", "AP.Review"] as const;

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

/** Everything a person may see under either panel permission, `null` meaning unrestricted. */
async function panelScope(db: D1Database, userId: string): Promise<string[] | null> {
  const lists = await Promise.all(PO_PANEL_PERMISSIONS.map((p) => unitsWherePermitted(db, userId, p)));
  if (lists.some((l) => l === null)) return null;
  return [...new Set(lists.flatMap((l) => l ?? []))];
}

interface InvoiceRow {
  id: string;
  facts_json: string;
  supplier_id: string | null;
  org_unit_id: string | null;
}

async function loadInvoice(db: D1Database, invoiceId: string) {
  const row = await db
    .prepare("SELECT id, facts_json, supplier_id, org_unit_id FROM invoice_headers WHERE id = ?")
    .bind(invoiceId)
    .first<InvoiceRow>();
  if (!row) return null;
  const facts = JSON.parse(row.facts_json || "{}") as InvoiceFacts;

  /**
   * **The supplier's own tolerance, read the way evaluation reads it** —
   * `supplier.amountTolerancePct` is merged onto the facts from the
   * supplier record at capture (`source-capture-route.ts`), and read
   * fresh here from the same columns so the panel matches what the
   * rules see today, not what was true when the invoice arrived.
   */
  const supplier = row.supplier_id
    ? await db
        .prepare("SELECT name, amount_tolerance_pct, quantity_tolerance_pct FROM suppliers WHERE id = ?")
        .bind(row.supplier_id)
        .first<{ name: string; amount_tolerance_pct: number | null; quantity_tolerance_pct: number | null }>()
    : null;
  const headerFacts: InvoiceFacts = {
    ...facts,
    "supplier.amountTolerancePct": supplier?.amount_tolerance_pct ?? null,
    "supplier.quantityTolerancePct": supplier?.quantity_tolerance_pct ?? null,
  } as InvoiceFacts;

  return { row, facts, headerFacts, supplier };
}

interface PoRow {
  id: string;
  order_number: string;
  issue_date: string | null;
  currency: string | null;
  seller_party_id: string | null;
  payable_amount: number | null;
  status: string;
  org_unit_id: string | null;
  buyer_name: string | null;
  supplier_name: string | null;
}

const PO_SELECT = `
  SELECT po.id, po.order_number, po.issue_date, po.currency, po.seller_party_id,
         po.payable_amount, po.status, po.org_unit_id,
         b.name AS buyer_name,
         (SELECT s.name FROM suppliers s WHERE s.vat_id = po.seller_party_id LIMIT 1) AS supplier_name
  FROM purchase_orders po
  LEFT JOIN org_users b ON b.id = po.buyer_user_id`;

/**
 * **Invoiced by other invoices** — BT-112 over every other invoice whose
 * BT-13 names the order, never this one, so "already invoiced" and
 * "this invoice" never count the same money twice. **Decision 0533**:
 * a discarded or returned invoice no longer counts (it will never be
 * paid), the same rule `loadPoConsumption` and the Purchase Orders
 * screen's status now follow.
 */
async function invoicedByOthers(db: D1Database, orderNumber: string, invoiceId: string) {
  const rows = await db
    .prepare(
      `SELECT h.id, json_extract(h.facts_json, '$."BT-1"') AS number,
              CAST(json_extract(h.facts_json, '$."BT-112"') AS REAL) AS amount
       FROM invoice_headers h
       WHERE json_extract(h.facts_json, '$."BT-13"') = ? AND h.id != ?
         AND NOT EXISTS (
           SELECT 1 FROM process_instances pi
           WHERE pi.subject_type = 'invoice' AND pi.subject_id = h.id AND pi.status IN ('archived', 'returned_manually')
         )
       ORDER BY h.created_at`
    )
    .bind(orderNumber, invoiceId)
    .all<{ id: string; number: string | null; amount: number | null }>();
  return rows.results.map((r) => ({ id: r.id, number: r.number, amount: r.amount ?? 0 }));
}

/**
 * **How much of one PO line is used — decision 0533.** Ordered, taken
 * by other invoices (`consumption`), taken by this one, and what is
 * left after both. Quantities and amounts both, since a service line
 * may carry only an amount.
 */
function lineUse(
  poLine: { line_number: number; quantity: number | null; line_extension_amount: number | null },
  consumption: PoConsumption,
  thisInvoice: { quantity: number; amount: number } | undefined
) {
  const before = consumption.byLine.get(poLine.line_number) ?? { quantity: 0, amount: 0 };
  const mine = thisInvoice ?? { quantity: 0, amount: 0 };
  return {
    orderedQuantity: poLine.quantity,
    orderedAmount: poLine.line_extension_amount,
    beforeQuantity: before.quantity,
    beforeAmount: before.amount,
    thisQuantity: mine.quantity,
    thisAmount: mine.amount,
    leftQuantity: poLine.quantity === null ? null : poLine.quantity - before.quantity - mine.quantity,
    leftAmount: poLine.line_extension_amount === null ? null : poLine.line_extension_amount - before.amount - mine.amount,
  };
}

function poStatus(row: PoRow, used: number): string {
  if (row.status === "closed" || row.status === "on_hold") return row.status;
  if (row.payable_amount !== null && used >= row.payable_amount && used > 0) return "invoiced_full";
  if (used > 0) return "invoiced_part";
  return "active";
}

/**
 * Whether this person could re-link right now: an open task at the
 * invoice's current stage that is theirs. The keying route enforces the
 * same thing on save; this only decides whether the panel offers it.
 */
async function ownOpenTask(db: D1Database, invoiceId: string, userId: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT t.id FROM tasks t
       JOIN stage_visits v ON v.id = t.stage_visit_id
       JOIN process_instances pi ON pi.id = v.process_instance_id
       WHERE pi.subject_type = 'invoice' AND pi.subject_id = ? AND pi.status = 'in_progress'
         AND pi.current_stage_id = t.stage_id AND t.status = 'open'
         AND (t.owner_user_id = ? OR t.claimed_by = ?)
       LIMIT 1`
    )
    .bind(invoiceId, userId, userId)
    .first<{ id: string }>();
  return row?.id ?? null;
}

export async function handleGetPoMatchView(db: D1Database, invoiceId: string, userId: string): Promise<RouteResult> {
  const invoice = await loadInvoice(db, invoiceId);
  if (!invoice) return { status: 404, body: { error: `invoice ${invoiceId} does not exist` } };
  const { facts, headerFacts, supplier } = invoice;

  const orgConfig = await getOrgMatchingConfig(db);
  const supplierAmountTol = num(headerFacts["supplier.amountTolerancePct"]);
  const supplierQuantityTol = num(headerFacts["supplier.quantityTolerancePct"]);

  const orderNumber = text(facts["BT-13"]);
  const scope = await panelScope(db, userId);
  let po: PoRow | null = orderNumber
    ? await db.prepare(`${PO_SELECT} WHERE po.order_number = ?`).bind(orderNumber).first<PoRow>()
    : null;
  // An order out of this person's scope reads as none on file, the same
  // as the Purchase Orders screen's own detail route (decision 0375).
  if (po && !isWithinScope({ units: scope }, po.org_unit_id)) po = null;

  const poLines = po
    ? (
        await db
          .prepare(
            `SELECT line_number, item_name, item_description, quantity, unit_code, price_amount, line_extension_amount
             FROM purchase_order_lines WHERE purchase_order_id = ? ORDER BY line_number`
          )
          .bind(po.id)
          .all<{
            line_number: number;
            item_name: string | null;
            item_description: string | null;
            quantity: number | null;
            unit_code: string | null;
            price_amount: number | null;
            line_extension_amount: number | null;
          }>()
      ).results
    : [];

  const invoiceLines = (
    await db
      .prepare("SELECT line_number, description, amount, facts_json FROM invoice_lines WHERE invoice_id = ? ORDER BY line_number")
      .bind(invoiceId)
      .all<{ line_number: number; description: string | null; amount: number | null; facts_json: string | null }>()
  ).results;

  // Decision 0532 — a person's saved pairing wins over the supplier's
  // BT-132, exactly as it does at evaluation (`applySavedPairings`).
  const pairings = po ? activePairings(await loadPairings(db, invoiceId), facts) : new Map();

  // What other invoices have taken, counted exactly as the rules count it (decision 0533).
  const consumption = po ? await loadPoConsumption(db, po.order_number, invoiceId) : null;
  // What this invoice's own lines take from each PO line, by the reference in force.
  const thisByLine = new Map<number, { quantity: number; amount: number }>();
  for (const l of invoiceLines) {
    const stored = JSON.parse(l.facts_json || "{}") as InvoiceFacts;
    const ref = Number(pairings.get(l.line_number)?.poLineNumber ?? text(stored["BT-132"]));
    if (!Number.isFinite(ref)) continue;
    const t = thisByLine.get(ref) ?? { quantity: 0, amount: 0 };
    t.quantity += num(stored["BT-129"]) ?? 0;
    t.amount += num(stored["BT-131"]) ?? 0;
    thisByLine.set(ref, t);
  }

  const lines = await Promise.all(
    invoiceLines.map(async (l) => {
      const stored = JSON.parse(l.facts_json || "{}") as InvoiceFacts;
      const supplierReference = text(stored["BT-132"]);
      const pairing = pairings.get(l.line_number) ?? null;
      const lf = pairing ? ({ ...stored, "BT-132": String(pairing.poLineNumber) } as InvoiceFacts) : stored;
      const ref = text(lf["BT-132"]);
      const poLine = ref ? poLines.find((p) => String(p.line_number) === ref) ?? null : null;
      const match = await computePoLineMatch(db, headerFacts, lf, orgConfig, consumption ?? undefined);
      return {
        lineNumber: l.line_number,
        name: text(lf["BT-153"]) ?? l.description,
        quantity: num(lf["BT-129"]),
        unit: text(lf["BT-130"]),
        price: num(lf["BT-146"]),
        amount: num(lf["BT-131"]) ?? l.amount,
        orderLineReference: supplierReference,
        pairing: pairing
          ? { poLineNumber: pairing.poLineNumber, pairedByName: pairing.pairedByName, pairedAt: pairing.pairedAt }
          : null,
        poLine: poLine
          ? {
              lineNumber: poLine.line_number,
              name: poLine.item_name ?? poLine.item_description,
              quantity: poLine.quantity,
              unit: poLine.unit_code,
              price: poLine.price_amount,
              amount: poLine.line_extension_amount,
              use: consumption ? lineUse(poLine, consumption, thisByLine.get(poLine.line_number)) : null,
            }
          : null,
        result: {
          matched: match.matched,
          referenceFound: match.referenceFound,
          priceMatched: match.priceMatched ?? null,
          quantityMatched: match.quantityMatched ?? null,
          unitMismatch: match.unitMismatch,
          variancePct: match.variancePct ?? null,
          quantityVariancePct: match.quantityVariancePct ?? null,
        },
      };
    })
  );

  const referenced = new Set(lines.map((l) => l.poLine?.lineNumber).filter((n) => n !== undefined));
  const header = po && consumption ? await computePoMatch(db, headerFacts, orgConfig, consumption) : { matched: false, variancePct: undefined };
  const others = consumption?.invoices ?? [];
  const byOthers = consumption?.headerAmount ?? 0;
  const thisInvoice = num(facts["BT-112"]) ?? 0;

  return {
    status: 200,
    body: {
      invoice: {
        id: invoiceId,
        number: text(facts["BT-1"]),
        supplierName: supplier?.name ?? text(facts["BT-27"]),
        currency: text(facts["BT-5"]),
        total: num(facts["BT-112"]),
        orderReference: orderNumber,
      },
      tolerance: {
        amountPct: supplierAmountTol ?? orgConfig.amountTolerancePct,
        quantityPct: supplierQuantityTol ?? orgConfig.quantityTolerancePct,
        quantityMatchingEnabled: orgConfig.quantityMatchingEnabled,
        source: supplierAmountTol !== null ? "supplier" : "org",
      },
      /**
       * `referenceNotFound` tells "the invoice names a PO we do not hold"
       * apart from "the invoice names no PO at all" — the panel says
       * different things for each.
       */
      referenceNotFound: orderNumber !== null && po === null,
      po: po
        ? {
            orderNumber: po.order_number,
            issueDate: po.issue_date,
            currency: po.currency,
            sellerPartyId: po.seller_party_id,
            supplierName: po.supplier_name,
            buyerName: po.buyer_name,
            payableAmount: po.payable_amount,
            status: poStatus(po, byOthers + thisInvoice),
          }
        : null,
      header: { matched: header.matched, variancePct: header.variancePct ?? null },
      usage: po
        ? {
            poTotal: po.payable_amount,
            invoicedByOthers: byOthers,
            otherInvoices: others,
            thisInvoice,
            left: po.payable_amount === null ? null : po.payable_amount - byOthers - thisInvoice,
          }
        : null,
      lines,
      // Every PO line, for the panel's per-line picker (decision 0532).
      poLineOptions: poLines.map((p) => ({
        lineNumber: p.line_number,
        name: p.item_name ?? p.item_description,
        quantity: p.quantity,
        unit: p.unit_code,
        price: p.price_amount,
      })),
      unusedPoLines: poLines
        .filter((p) => !referenced.has(p.line_number))
        .map((p) => ({
          lineNumber: p.line_number,
          name: p.item_name ?? p.item_description,
          quantity: p.quantity,
          unit: p.unit_code,
          price: p.price_amount,
          amount: p.line_extension_amount,
          use: consumption ? lineUse(p, consumption, undefined) : null,
        })),
      canRelink: (await ownOpenTask(db, invoiceId, userId)) !== null,
    },
  };
}

const CANDIDATE_LIMIT = 25;

/**
 * **Search the POs held here** — decision 0530. The same order-number,
 * seller-VAT and item search the Purchase Orders screen uses (0376),
 * with three filters the panel starts switched on or off:
 * `supplierOnly` (the PO's seller VAT is the invoice's BT-31),
 * `activeOnly` (not on hold or closed), and `coversInvoice` (enough left
 * for this invoice's total). Each result says why it might fit.
 */
export async function handlePoCandidates(
  db: D1Database,
  invoiceId: string,
  userId: string,
  params: { search: string | null; supplierOnly: boolean; activeOnly: boolean; coversInvoice: boolean }
): Promise<RouteResult> {
  const invoice = await loadInvoice(db, invoiceId);
  if (!invoice) return { status: 404, body: { error: `invoice ${invoiceId} does not exist` } };
  const { facts } = invoice;
  const sellerVat = text(facts["BT-31"]);
  const total = num(facts["BT-112"]) ?? 0;
  const currency = text(facts["BT-5"]);
  const current = text(facts["BT-13"]);

  const scope = await panelScope(db, userId);
  const org = unitClause({ units: scope }, "po.org_unit_id");
  const where: string[] = [];
  const binds: unknown[] = [];
  const term = params.search?.trim();
  if (term) {
    const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
    where.push(`(po.order_number LIKE ? ESCAPE '\\'
      OR po.seller_party_id LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM purchase_order_lines l WHERE l.purchase_order_id = po.id
                 AND (l.item_name LIKE ? ESCAPE '\\' OR l.item_description LIKE ? ESCAPE '\\')))`);
    binds.push(pattern, pattern, pattern, pattern);
  }
  if (params.supplierOnly) {
    // No seller VAT on the invoice means nothing can be "this supplier".
    where.push(sellerVat ? "po.seller_party_id = ?" : "1 = 0");
    if (sellerVat) binds.push(sellerVat);
  }
  if (params.activeOnly) where.push("po.status = 'active'");

  const rows = (
    await db
      .prepare(
        `${PO_SELECT}
         WHERE 1 = 1 ${org.sql} ${where.map((w) => ` AND ${w}`).join("")}
         ORDER BY po.issue_date DESC, po.created_at DESC
         LIMIT ?`
      )
      .bind(...org.binds, ...binds, CANDIDATE_LIMIT * 4)
      .all<PoRow>()
  ).results;

  const candidates = [];
  for (const po of rows) {
    const others = await invoicedByOthers(db, po.order_number, invoiceId);
    const used = others.reduce((s, o) => s + o.amount, 0);
    const left = po.payable_amount === null ? null : po.payable_amount - used;
    const coversInvoice = left !== null && left >= total;
    if (params.coversInvoice && !coversInvoice) continue;
    candidates.push({
      orderNumber: po.order_number,
      issueDate: po.issue_date,
      currency: po.currency,
      supplierName: po.supplier_name,
      sellerPartyId: po.seller_party_id,
      payableAmount: po.payable_amount,
      invoicedByOthers: used,
      left,
      status: poStatus(po, used),
      current: po.order_number === current,
      reasons: {
        sameSupplier: !!sellerVat && po.seller_party_id === sellerVat,
        coversInvoice,
        sameCurrency: !!currency && po.currency === currency,
      },
    });
    if (candidates.length >= CANDIDATE_LIMIT) break;
  }
  return { status: 200, body: { candidates } };
}

/**
 * **Re-link the invoice to a different PO** — decision 0530.
 *
 * Goes through `handleKeyInvoiceFields`, the route every other edit to an
 * invoice's facts uses, so nothing about who may change BT-13 is decided
 * twice: the task must be this person's, and BT-13 must be editable at
 * this stage (0144, 0486). What it adds is the check that the PO is one
 * this person can see and is not closed, and a `po_link` Timeline event.
 */
export async function handleLinkPo(
  db: D1Database,
  invoiceId: string,
  userId: string,
  body: { orderNumber?: unknown }
): Promise<RouteResult> {
  const orderNumber = text(body.orderNumber);
  if (!orderNumber) return { status: 400, body: { error: "orderNumber is required", reason: "order_number_required" } };

  const scope = await panelScope(db, userId);
  const po = await db
    .prepare("SELECT id, status, org_unit_id FROM purchase_orders WHERE order_number = ?")
    .bind(orderNumber)
    .first<{ id: string; status: string; org_unit_id: string | null }>();
  if (!po || !isWithinScope({ units: scope }, po.org_unit_id)) {
    return { status: 404, body: { error: `no purchase order ${orderNumber}`, reason: "po_not_found" } };
  }
  if (po.status === "closed") {
    return { status: 422, body: { error: `purchase order ${orderNumber} is closed`, reason: "po_closed" } };
  }

  /**
   * **Only from a task that is this person's.** Keying on its own also
   * lets an edit through when no task is open at all (the Documents
   * screen's read path, 0486); re-linking is Matching-stage work, so it
   * needs the task, and the task is where the Timeline event hangs.
   */
  const taskId = await ownOpenTask(db, invoiceId, userId);
  if (!taskId) return { status: 403, body: { error: "this task is not claimed by you", reason: "not_claimed" } };

  const keyed = await handleKeyInvoiceFields(db, invoiceId, { facts: { "BT-13": orderNumber } }, userId);
  if (keyed.status !== 200) return keyed;

  await db
    .prepare("INSERT INTO task_action_events (id, task_id, action, actor_id, at, comment) VALUES (?, ?, 'po_link', ?, ?, ?)")
    .bind(crypto.randomUUID(), taskId, userId, new Date().toISOString(), orderNumber)
    .run();
  return { status: 200, body: { orderNumber } };
}

/**
 * **Pair an invoice line with a PO line by hand — decision 0532.**
 *
 * `poLineNumber: null` clears the pairing, so the line falls back to
 * the supplier's own BT-132. Needs the same things re-linking does: an
 * open task at the current stage that is the caller's, and an invoice
 * linked to a PO held here. The pairing is recorded against that PO's
 * order number (see `po-pairings.ts`) and in the Timeline as `po_pair`.
 */
export async function handlePairLine(
  db: D1Database,
  invoiceId: string,
  userId: string,
  body: { lineNumber?: unknown; poLineNumber?: unknown }
): Promise<RouteResult> {
  const lineNumber = num(body.lineNumber);
  const clearing = body.poLineNumber === null;
  const poLineNumber = clearing ? null : num(body.poLineNumber);
  if (lineNumber === null || (!clearing && poLineNumber === null)) {
    return { status: 400, body: { error: "lineNumber and poLineNumber (or null) are required", reason: "bad_request" } };
  }

  const invoice = await loadInvoice(db, invoiceId);
  if (!invoice) return { status: 404, body: { error: `invoice ${invoiceId} does not exist` } };

  const taskId = await ownOpenTask(db, invoiceId, userId);
  if (!taskId) return { status: 403, body: { error: "this task is not claimed by you", reason: "not_claimed" } };

  const line = await db
    .prepare("SELECT 1 FROM invoice_lines WHERE invoice_id = ? AND line_number = ?")
    .bind(invoiceId, lineNumber)
    .first();
  if (!line) return { status: 404, body: { error: `invoice line ${lineNumber} does not exist`, reason: "line_not_found" } };

  const orderNumber = text(invoice.facts["BT-13"]);
  const scope = await panelScope(db, userId);
  const po = orderNumber
    ? await db
        .prepare("SELECT id, org_unit_id FROM purchase_orders WHERE order_number = ?")
        .bind(orderNumber)
        .first<{ id: string; org_unit_id: string | null }>()
    : null;
  if (!orderNumber || !po || !isWithinScope({ units: scope }, po.org_unit_id)) {
    return { status: 422, body: { error: "the invoice is not linked to a purchase order held here", reason: "no_po" } };
  }

  if (clearing) {
    await db.prepare("DELETE FROM invoice_line_po_pairings WHERE invoice_id = ? AND line_number = ?").bind(invoiceId, lineNumber).run();
  } else {
    const poLine = await db
      .prepare("SELECT 1 FROM purchase_order_lines WHERE purchase_order_id = ? AND line_number = ?")
      .bind(po.id, poLineNumber)
      .first();
    if (!poLine) {
      return { status: 404, body: { error: `purchase order ${orderNumber} has no line ${poLineNumber}`, reason: "po_line_not_found" } };
    }
    await db
      .prepare(
        `INSERT INTO invoice_line_po_pairings (invoice_id, line_number, order_number, po_line_number, paired_by, paired_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (invoice_id, line_number) DO UPDATE SET
           order_number = excluded.order_number, po_line_number = excluded.po_line_number,
           paired_by = excluded.paired_by, paired_at = excluded.paired_at`
      )
      .bind(invoiceId, lineNumber, orderNumber, poLineNumber, userId, new Date().toISOString())
      .run();
  }

  await db
    .prepare("INSERT INTO task_action_events (id, task_id, action, actor_id, at, comment) VALUES (?, ?, 'po_pair', ?, ?, ?)")
    .bind(crypto.randomUUID(), taskId, userId, new Date().toISOString(), `${lineNumber}:${poLineNumber ?? ""}`)
    .run();
  return { status: 200, body: { lineNumber, poLineNumber } };
}
