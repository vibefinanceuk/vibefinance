import { CREDIT_NOTE_TYPE_CODES, type PortalAccessClaims } from "@vibefinance/shared";
import type { RouteResult } from "./org-route.js";
import type { ExtractionModel } from "./extraction.js";
import { captureAttachmentPart } from "./inbound-email.js";
import { addRouteEvent, finishRouteMessage, openRouteMessage, routePartKey, storeRoutePart, type StoredPart } from "./route-messages.js";
import { MAX_UPLOAD_BYTES } from "./upload-route.js";

/**
 * **Invoice submission through the supplier network — decision 0726.**
 *
 * A supplier creates the invoice in the network as Peppol BIS Billing 3.0
 * UBL (0727); the network posts it here with the person's portal access
 * token (0714). It arrives through this customer's *Supplier network in*
 * source, as every other route's message does: a `MSG-` message, the
 * file stored before it is read, read by the ordinary capture path, into
 * the source's process.
 *
 * What the network decides, and nothing else may:
 * - **the company**: one the person's invitation covers (or a unit
 *   beneath one), that a Supplier network source accepts;
 * - **the supplier**: the record their invitation is for, never matched
 *   off the document (a seller VAT number that disagrees is flagged).
 */

const BIS3_CUSTOMIZATION = "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0";

interface NetworkSource {
  id: string;
  name: string;
  process_id: string;
  network_org_units_json: string | null;
}

/** The live Supplier network sources on invoice processes. */
async function networkSources(db: D1Database): Promise<NetworkSource[]> {
  return (
    await db
      .prepare(
        `SELECT s.id, s.name, s.process_id, s.network_org_units_json
         FROM sources s
         JOIN route_instances i ON i.source_id = s.id AND i.route_id = 'network-in'
         JOIN processes p ON p.id = s.process_id AND p.subject_type = 'invoice'
         WHERE s.status = 'active'
         ORDER BY s.created_at, s.id`
      )
      .all<NetworkSource>()
  ).results;
}

/** A unit and every unit above it. */
async function unitAndAbove(db: D1Database, unitId: string): Promise<string[]> {
  return (
    await db
      .prepare(
        `WITH RECURSIVE up(id, parent) AS (
           SELECT id, parent_unit_id FROM org_units WHERE id = ?
           UNION SELECT u.id, u.parent_unit_id FROM org_units u JOIN up ON u.id = up.parent
         ) SELECT id FROM up`
      )
      .bind(unitId)
      .all<{ id: string }>()
  ).results.map((r) => r.id);
}

/** The source that takes invoices for this company: one accepting it, or a company above it, or every company. */
export async function sourceForCompany(db: D1Database, orgUnitId: string): Promise<NetworkSource | null> {
  const lineage = new Set(await unitAndAbove(db, orgUnitId));
  for (const s of await networkSources(db)) {
    const accepted = s.network_org_units_json ? (JSON.parse(s.network_org_units_json) as string[]) : null;
    if (!accepted || accepted.some((u) => lineage.has(u))) return s;
  }
  return null;
}

/** Whether the company is one the invitation covers: named in it, or beneath one that is. */
export async function covered(db: D1Database, claims: PortalAccessClaims, orgUnitId: string): Promise<boolean> {
  const lineage = await unitAndAbove(db, orgUnitId);
  return lineage.some((u) => claims.orgUnitIds.includes(u));
}

/**
 * `GET /portal/submission-companies` — the companies this person may send
 * an invoice to: those their invitation names that a Supplier network
 * source accepts. Empty when the customer has not added one.
 */
export async function handleSubmissionCompanies(db: D1Database, claims: PortalAccessClaims): Promise<RouteResult> {
  const companies: { id: string; name: string }[] = [];
  for (const unitId of claims.orgUnitIds) {
    const unit = await db.prepare("SELECT id, name FROM org_units WHERE id = ?").bind(unitId).first<{ id: string; name: string }>();
    if (unit && (await sourceForCompany(db, unit.id))) companies.push(unit);
  }
  return { status: 200, body: { companies } };
}

/**
 * Whether the XML is a Peppol BIS Billing 3.0 invoice: a UBL Invoice
 * declaring the BIS 3.0 customization. Not a credit note, whichever
 * root it is under (decision 0730), until the network sends those.
 */
export function isBis3Invoice(xml: string): boolean {
  const head = xml.slice(0, 4000);
  const typeCode = /<(?:\w+:)?InvoiceTypeCode[^>]*>\s*([^<\s]+)\s*</.exec(xml)?.[1];
  return (
    /<(?:\w+:)?Invoice[\s>]/.test(head) &&
    head.includes("urn:oasis:names:specification:ubl:schema:xsd:Invoice-2") &&
    xml.includes(BIS3_CUSTOMIZATION) &&
    !(typeCode !== undefined && CREDIT_NOTE_TYPE_CODES.has(typeCode))
  );
}

/**
 * `POST /portal/submissions` `{ orgUnitId, filename, xml }` — one invoice,
 * created in the network. 202 with the message reference once read; 422
 * when it could not be.
 */
export async function handlePortalSubmission(
  db: D1Database,
  claims: PortalAccessClaims,
  body: Record<string, unknown>,
  deps: { model: ExtractionModel; bucket?: R2Bucket; customerId?: string }
): Promise<RouteResult> {
  const orgUnitId = typeof body.orgUnitId === "string" ? body.orgUnitId : "";
  const xml = typeof body.xml === "string" ? body.xml : "";
  const filename = (typeof body.filename === "string" && body.filename.trim() ? body.filename.trim() : "invoice.xml").replace(/[^\w.\- ]/g, "_").slice(0, 120);
  if (!orgUnitId || !(await covered(db, claims, orgUnitId))) {
    return { status: 403, body: { error: "your invitation does not cover that company", reason: "not_covered" } };
  }
  const source = await sourceForCompany(db, orgUnitId);
  if (!source) return { status: 409, body: { error: "this customer does not take invoices through the supplier network for that company", reason: "not_accepting" } };
  if (!xml.trim()) return { status: 400, body: { error: "the invoice is empty", reason: "empty" } };
  const bytes = new TextEncoder().encode(xml);
  if (bytes.length > MAX_UPLOAD_BYTES) return { status: 413, body: { error: "the invoice is too large", reason: "too_large" } };
  if (!isBis3Invoice(xml)) return { status: 415, body: { error: "only a Peppol BIS Billing 3.0 invoice is accepted", reason: "not_bis3" } };

  const receivedAt = new Date().toISOString();
  const messageId = await openRouteMessage(db, {
    instanceId: source.id,
    direction: "in",
    counterparty: claims.email,
    recipient: source.name,
    subject: filename,
    bytes: bytes.length,
    receivedAt,
  });
  if (!messageId) return { status: 500, body: { error: "the message could not be recorded; send it again" } };
  await addRouteEvent(db, messageId, "network_received", { detail: `${claims.email}, for ${orgUnitId}` });

  let stored: StoredPart | undefined;
  if (deps.bucket && deps.customerId) {
    const part = await storeRoutePart(deps.bucket, db, {
      messageId,
      seq: 1,
      role: "attachment",
      filename,
      contentType: "application/xml",
      bytes,
      key: routePartKey(deps.customerId, source.id, messageId, receivedAt, 1, filename),
    });
    if ("stored" in part) stored = part.stored;
    else await addRouteEvent(db, messageId, "attachment_not_stored", { partSeq: 1, detail: part.reason });
  }

  const outcome = await captureAttachmentPart(db, {
    messageId,
    sourceId: source.id,
    seq: 1,
    filename,
    bytes,
    stored,
    model: deps.model,
    bucket: deps.bucket,
    customerId: deps.customerId,
    sender: claims.email,
    placement: { orgUnitId, supplierId: claims.supplierId },
  });
  if (!outcome.captured) {
    await finishRouteMessage(db, messageId, { status: "failed", failedPart: "translation", errorCode: "unreadable", errorText: outcome.why ?? "the invoice could not be read" });
    return { status: 422, body: { error: outcome.why ?? "the invoice could not be read", reason: "unreadable", message: messageId } };
  }
  await finishRouteMessage(db, messageId, { status: outcome.why ? "partial" : "delivered" });
  return { status: 202, body: { message: messageId, invoiceId: outcome.invoiceId ?? null } };
}

// ---------------------------------------------------------------------------
// What the Create form fills in for the supplier — decision 0727.
// ---------------------------------------------------------------------------

interface UnitRow {
  id: string;
  name: string;
  parent_unit_id: string | null;
  vat_id: string | null;
  buyer_endpoint: string | null;
  buyer_reference: string | null;
  address_line: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
}

/** A company's legal details: its own, else the nearest company above it that has them. */
async function companyDetails(db: D1Database, orgUnitId: string) {
  const rows: UnitRow[] = [];
  let id: string | null = orgUnitId;
  for (let i = 0; id && i < 12; i++) {
    const row: UnitRow | null = await db
      .prepare("SELECT id, name, parent_unit_id, vat_id, buyer_endpoint, buyer_reference, address_line, city, postal_code, country, email, phone FROM org_units WHERE id = ?")
      .bind(id)
      .first<UnitRow>();
    if (!row) break;
    rows.push(row);
    id = row.parent_unit_id;
  }
  const first = <K extends keyof UnitRow>(k: K) => rows.find((r) => r[k])?.[k] ?? null;
  const own = rows[0];
  if (!own) return null;
  return {
    id: own.id,
    name: own.name,
    vatId: first("vat_id"),
    endpoint: first("buyer_endpoint"),
    buyerReference: first("buyer_reference"),
    addressLine: first("address_line"),
    city: first("city"),
    postalCode: first("postal_code"),
    country: first("country"),
  };
}

/**
 * `GET /portal/invoice-parties?orgUnitId=` — the seller (this customer's
 * record of the supplier: name, VAT number, address, the account it pays
 * into, its terms) and the buyer (the company's legal details). The
 * supplier cannot change either here: a change to the record, above all
 * its bank account, is the customer's.
 */
export async function handleInvoiceParties(db: D1Database, claims: PortalAccessClaims, orgUnitId: string): Promise<RouteResult> {
  if (!orgUnitId || !(await covered(db, claims, orgUnitId))) return { status: 403, body: { error: "your invitation does not cover that company", reason: "not_covered" } };
  const parties = await partiesFor(db, claims.supplierId, orgUnitId);
  if (!parties) return { status: 404, body: { error: "not found" } };
  return { status: 200, body: parties };
}

/**
 * The seller (the customer's record of the supplier, its account included)
 * and the buyer (the company's legal details). Shared by Create (0727) and
 * an invoice opened in the network (0729), as the app's own viewer takes
 * them from the record and the company rather than off the document.
 */
export async function partiesFor(db: D1Database, supplierId: string, orgUnitId: string) {
  const s = await db
    .prepare(
      `SELECT name, vat_id, erp_identifier, electronic_address, address_line, city, postal_code, country, email, phone, payment_terms,
              agreed_payment_means, agreed_account_identifier, agreed_account_name
       FROM suppliers WHERE id = ?`
    )
    .bind(supplierId)
    .first<Record<string, string | null>>();
  const buyer = await companyDetails(db, orgUnitId);
  if (!s || !buyer) return null;
  return {
    seller: {
      name: s.name,
      vatId: s.vat_id,
      reference: s.erp_identifier,
      endpoint: s.electronic_address,
      addressLine: s.address_line,
      city: s.city,
      postalCode: s.postal_code,
      country: s.country,
      email: s.email,
      phone: s.phone,
      paymentTerms: s.payment_terms,
      account: s.agreed_account_identifier ? { means: s.agreed_payment_means, identifier: s.agreed_account_identifier, name: s.agreed_account_name } : null,
    },
    buyer,
  };
}

/**
 * `GET /portal/purchase-orders?orgUnitId=` — this supplier's active
 * purchase orders for the company (and the units beneath it), with their
 * lines, newest first: what *From a PO* fills an invoice from.
 */
export async function handlePortalPurchaseOrders(db: D1Database, claims: PortalAccessClaims, orgUnitId: string): Promise<RouteResult> {
  if (!orgUnitId || !(await covered(db, claims, orgUnitId))) return { status: 403, body: { error: "your invitation does not cover that company", reason: "not_covered" } };
  const supplier = await db.prepare("SELECT vat_id, erp_identifier FROM suppliers WHERE id = ?").bind(claims.supplierId).first<{ vat_id: string | null; erp_identifier: string | null }>();
  const ids = [supplier?.vat_id, supplier?.erp_identifier].filter((x): x is string => Boolean(x));
  if (ids.length === 0) return { status: 200, body: { purchaseOrders: [] } };
  const orders = (
    await db
      .prepare(
        `SELECT po.id, po.order_number, po.issue_date, po.currency, po.tax_exclusive_amount
         FROM purchase_orders po
         WHERE po.status = 'active' AND po.seller_party_id IN (${ids.map(() => "?").join(", ")})
           AND po.org_unit_id IN (
             WITH RECURSIVE below(id) AS (SELECT ? UNION SELECT u.id FROM org_units u JOIN below b ON u.parent_unit_id = b.id)
             SELECT id FROM below)
         ORDER BY po.issue_date DESC, po.created_at DESC LIMIT 50`
      )
      .bind(...ids, orgUnitId)
      .all<{ id: string; order_number: string; issue_date: string | null; currency: string | null; tax_exclusive_amount: number | null }>()
  ).results;
  const purchaseOrders = [];
  for (const o of orders) {
    const lines = (
      await db
        .prepare("SELECT line_number, quantity, unit_code, price_amount, base_quantity, line_extension_amount, item_name, item_description, sellers_item_id FROM purchase_order_lines WHERE purchase_order_id = ? ORDER BY line_number")
        .bind(o.id)
        .all<Record<string, string | number | null>>()
    ).results;
    purchaseOrders.push({
      orderNumber: o.order_number,
      issueDate: o.issue_date,
      currency: o.currency,
      net: o.tax_exclusive_amount,
      lines: lines.map((l) => ({
        lineNumber: l.line_number,
        description: l.item_name ?? l.item_description ?? "",
        quantity: l.quantity,
        unitCode: l.unit_code ?? "C62",
        unitPrice: l.price_amount !== null && l.price_amount !== undefined ? Number(l.price_amount) / (Number(l.base_quantity) || 1) : null,
        net: l.line_extension_amount,
        sellersItemId: l.sellers_item_id,
      })),
    });
  }
  return { status: 200, body: { purchaseOrders } };
}
