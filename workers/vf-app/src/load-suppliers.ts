import { matchSupplier } from "./match-supplier.js";
import type { RouteResult } from "./org-route.js";

/**
 * Loading the customer's supplier master file — decision 0211.
 *
 * **The mirror existed and could not be filled.** Decision 0209 built
 * the table and the matching; the only way to put a supplier in it was
 * an `INSERT`.
 *
 * **CSV, because that is what a customer can produce from any ERP**
 * without an integration. *Save as CSV* is one menu item in every
 * spreadsheet, and a format nobody has to be taught.
 */

/** The columns a load may carry, named as a person would name them. */
const COLUMNS: Record<string, string> = {
  erp_identifier: "erp_identifier",
  erpidentifier: "erp_identifier",
  "erp id": "erp_identifier",
  "supplier number": "erp_identifier",
  name: "name",
  "supplier name": "name",
  vat_id: "vat_id",
  vat: "vat_id",
  "vat number": "vat_id",
  electronic_address: "electronic_address",
  endpoint: "electronic_address",
  "peppol id": "electronic_address",
  country: "country",
  payment_terms: "payment_terms",
  terms: "payment_terms",
  on_hold: "on_hold",
  hold: "on_hold",
  hold_reason: "hold_reason",
  match_option: "match_option",
  amount_tolerance_pct: "amount_tolerance_pct",
  quantity_tolerance_pct: "quantity_tolerance_pct",
  erp_site_identifier: "erp_site_identifier",
  site: "erp_site_identifier",
  // What a site is for, and where it is — decision 0218.
  is_pay_site: "is_pay_site",
  "pay site": "is_pay_site",
  pay: "is_pay_site",
  is_procurement_site: "is_procurement_site",
  "procurement site": "is_procurement_site",
  purchasing: "is_procurement_site",
  address_line: "address_line",
  address: "address_line",
  street: "address_line",
  city: "city",
  town: "city",
  postal_code: "postal_code",
  postcode: "postal_code",
  // Where a person writes to this supplier — decision 0219.
  email: "email",
  "email address": "email",
  "supplier email": "email",
  // A number to ring — decision 0221.
  phone: "phone",
  telephone: "phone",
  "phone number": "phone",
  tel: "phone",
};

/** A spreadsheet's idea of true. */
function flag(value: string | undefined): boolean {
  return ["1", "y", "yes", "true", "x"].includes((value ?? "").trim().toLowerCase());
}

export interface LoadResult {
  loadId: string;
  loaded: number;
  /**
   * **Rows the load refused, with the reason and the row number.**
   *
   * A customer whose export is half wrong should learn that from the
   * load rather than discover it one invoice at a time — decision
   * 0162's argument that a system which knows something should say so.
   */
  refused: { row: number; reason: string }[];
  /** Suppliers absent from this load, now inactive rather than deleted. */
  deactivated: number;
  /**
   * Invoices that were unmatched and now are not — decision 0208 called
   * this **part of the feature rather than a refinement**.
   */
  rematched: number;
}

/**
 * A CSV reader that handles quoted fields.
 *
 * A supplier named `Smith, Jones & Co` is ordinary, and splitting on
 * commas would make two suppliers of it — one called `Smith` with an
 * ERP identifier of ` Jones & Co`.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one quote.
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export async function handleLoadSuppliers(
  db: D1Database,
  csv: string,
  loadedBy: string
): Promise<RouteResult> {
  const rows = parseCsv(csv);
  if (rows.length < 2) {
    return {
      status: 400,
      body: { error: "the file needs a header row and at least one supplier" },
    };
  }

  const header = rows[0].map((h) => COLUMNS[h.trim().toLowerCase()] ?? null);

  if (!header.includes("erp_identifier")) {
    /**
     * **The one column that is not optional** — decision 0209.
     *
     * A load without it produces suppliers we cannot name to the ERP,
     * which is not a mirror. Refused as a whole rather than row by row,
     * because every row would fail for the same reason and a hundred
     * identical errors tell somebody less than one.
     */
    return {
      status: 400,
      body: {
        error: "the file needs an ERP identifier column — without it a supplier cannot be paid against",
        reason: "no_erp_identifier_column",
      },
    };
  }

  const loadId = crypto.randomUUID();
  const refused: { row: number; reason: string }[] = [];
  const seen: string[] = [];
  let loaded = 0;

  for (let i = 1; i < rows.length; i++) {
    const values: Record<string, string> = {};
    header.forEach((column, index) => {
      if (column) values[column] = (rows[i][index] ?? "").trim();
    });

    if (!values.erp_identifier) {
      refused.push({ row: i + 1, reason: "no ERP identifier" });
      continue;
    }
    if (!values.name) {
      // A supplier nobody can recognise on a screen is one nobody can
      // check a match against.
      refused.push({ row: i + 1, reason: "no name" });
      continue;
    }

    const onHold = flag(values.on_hold);
    if (onHold && !values.hold_reason) {
      /**
       * **A held supplier nobody can explain** is a payment stopped for
       * no stated cause, which is worse than one stopped for a bad one.
       * Migration 0049 refuses it as a standing invariant; this refuses
       * the row with the row number, which is what a person can act on.
       */
      refused.push({ row: i + 1, reason: "on hold with no reason given" });
      continue;
    }

    const matchOption = (values.match_option ?? "").toLowerCase().replace(/[\s-]/g, "_");
    if (matchOption && !["two_way", "three_way", "none"].includes(matchOption)) {
      refused.push({ row: i + 1, reason: `match option "${values.match_option}" is not recognised` });
      continue;
    }

    /**
     * **Found by what the ERP calls it, not by what we would call it** —
     * decision 0217.
     *
     * The loader used to construct an id and `ON CONFLICT(id)` against
     * it — which catches a row it created before and **not** a row
     * already there under a different id. The live database had exactly
     * that: a supplier inserted by hand as `northwind`, carrying ERP
     * identifier `40118`, against which the loader's own `40118` row
     * conflicted on the unique index rather than on the key.
     *
     * SQLite refused, the Worker threw, and Cloudflare returned a 1101
     * page — which is how a constraint doing its job reaches somebody
     * as *"Unexpected token 'e'"*.
     *
     * **The ERP identifier is the identity** (decision 0209). Looking a
     * row up by it is the only way that stays true for data this loader
     * did not create.
     */
    const existing = await db
      .prepare(
        `SELECT id FROM suppliers
         WHERE erp_identifier = ?
           AND ((erp_site_identifier IS NULL AND ?2 IS NULL) OR erp_site_identifier = ?2)`
      )
      .bind(values.erp_identifier, values.erp_site_identifier || null)
      .first<{ id: string }>();

    const id =
      existing?.id ??
      `${values.erp_identifier}${values.erp_site_identifier ? `:${values.erp_site_identifier}` : ""}`;
    seen.push(id);

    /**
     * **Replace rather than merge** — decision 0208. A load is the
     * ERP's current truth, and reconciling row by row invents a
     * conflict resolution nobody asked for.
     *
     * A supplier that was inactive and appears again is active again,
     * which is the ERP saying so.
     */
    await db
      .prepare(
        `INSERT INTO suppliers (id, erp_identifier, name, vat_id, electronic_address, country,
                                payment_terms, on_hold, hold_reason, match_option,
                                amount_tolerance_pct, quantity_tolerance_pct,
                                erp_site_identifier, is_pay_site, is_procurement_site,
                                address_line, city, postal_code, email, phone, status, loaded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           vat_id = excluded.vat_id,
           electronic_address = excluded.electronic_address,
           country = excluded.country,
           payment_terms = excluded.payment_terms,
           on_hold = excluded.on_hold,
           hold_reason = excluded.hold_reason,
           match_option = excluded.match_option,
           amount_tolerance_pct = excluded.amount_tolerance_pct,
           quantity_tolerance_pct = excluded.quantity_tolerance_pct,
           is_pay_site = excluded.is_pay_site,
           is_procurement_site = excluded.is_procurement_site,
           address_line = excluded.address_line,
           city = excluded.city,
           postal_code = excluded.postal_code,
           email = excluded.email,
           phone = excluded.phone,
           status = 'active',
           loaded_at = datetime('now')`
      )
      .bind(
        id,
        values.erp_identifier,
        values.name,
        values.vat_id || null,
        values.electronic_address || null,
        values.country || null,
        values.payment_terms || null,
        onHold ? 1 : 0,
        values.hold_reason || null,
        matchOption || null,
        values.amount_tolerance_pct ? Number(values.amount_tolerance_pct) : null,
        values.quantity_tolerance_pct ? Number(values.quantity_tolerance_pct) : null,
        values.erp_site_identifier || null,
        flag(values.is_pay_site) ? 1 : 0,
        flag(values.is_procurement_site) ? 1 : 0,
        values.address_line || null,
        values.city || null,
        values.postal_code || null,
        values.email || null,
        values.phone || null
      )
      .run();

    loaded++;
  }

  if (loaded === 0) {
    /**
     * **A load that put nothing in is not a load**, and recording it
     * would move the *"last loaded"* date on a mirror that learned
     * nothing — which is the stale-mirror trap (decision 0208) with the
     * evidence removed.
     */
    return {
      status: 400,
      body: {
        error: "no supplier in this file could be loaded",
        reason: "nothing_loaded",
        refused,
      },
    };
  }

  /**
   * **Absent means inactive, never deleted** — decision 0208. An
   * invoice already pointing at a supplier must still be able to say
   * who it was.
   */
  const placeholders = seen.map(() => "?").join(", ");
  const deactivated = await db
    .prepare(
      `UPDATE suppliers SET status = 'inactive'
       WHERE status = 'active' AND id NOT IN (${placeholders})`
    )
    .bind(...seen)
    .run();

  await db
    .prepare(
      `INSERT INTO supplier_loads (id, loaded_by, row_count, refused_count)
       VALUES (?, ?, ?, ?)`
    )
    .bind(loadId, loadedBy, loaded, refused.length)
    .run();

  const rematched = await rematchUnmatchedInvoices(db);

  return {
    status: 200,
    body: {
      loadId,
      loaded,
      refused,
      deactivated: deactivated.meta?.changes ?? 0,
      rematched,
    },
  };
}

/**
 * Look again at every invoice that had no supplier — decision 0211.
 *
 * **Decision 0208 called this part of the feature rather than a
 * refinement**, and it is the difference between a queue that clears
 * and one that only grows:
 *
 *   An invoice sitting in AP Review because its supplier was unknown
 *   stays there after the supplier is loaded. The fact that sent it
 *   there is no longer true, and nothing looks again.
 *
 * **What this does not do is move the invoice.** It corrects the fact;
 * where that invoice now belongs is a process question, and a rule that
 * routed it on `supplier.matched` should be the thing that routes it
 * back — not a loader reaching into somebody's queue.
 */
export async function rematchUnmatchedInvoices(db: D1Database): Promise<number> {
  const unmatched = await db
    .prepare(
      `SELECT id, facts_json FROM invoice_headers
       WHERE supplier_id IS NULL
         AND json_extract(facts_json, '$."supplier.matched"') = 0`
    )
    .all<{ id: string; facts_json: string }>();

  let rematched = 0;

  for (const invoice of unmatched.results) {
    let facts: Record<string, unknown> = {};
    try {
      facts = JSON.parse(invoice.facts_json) as Record<string, unknown>;
    } catch {
      continue;
    }

    const matched = await matchSupplier(db, facts);
    if (!matched.supplierId) continue;

    await db
      .prepare(
        `UPDATE invoice_headers
         SET supplier_id = ?,
             facts_json = json_remove(
               json_set(facts_json, '$."supplier.matched"', 1),
               '$."supplier.unmatchedReason"')
         WHERE id = ?`
      )
      .bind(matched.supplierId, invoice.id)
      .run();

    rematched++;
  }

  return rematched;
}

/**
 * The supplier list, and how old it is — decision 0213.
 *
 * **The load date travels with the list**, because a person judging
 * whether a supplier is missing needs to know when we were last told
 * (decision 0208). Two calls would let a screen show one without the
 * other.
 */
export async function handleListSuppliers(db: D1Database): Promise<RouteResult> {
  const rows = await db
    .prepare(
      `SELECT id, erp_identifier, erp_site_identifier, name, vat_id, electronic_address,
              country, payment_terms, on_hold, hold_reason, match_option, status,
              is_pay_site, is_procurement_site, address_line, city, postal_code, email, phone
       FROM suppliers
       ORDER BY status, name`
    )
    .all<{
      id: string;
      erp_identifier: string;
      erp_site_identifier: string | null;
      name: string;
      vat_id: string | null;
      electronic_address: string | null;
      country: string | null;
      payment_terms: string | null;
      on_hold: number;
      hold_reason: string | null;
      match_option: string | null;
      status: string;
      is_pay_site: number;
      is_procurement_site: number;
      address_line: string | null;
      city: string | null;
      postal_code: string | null;
      email: string | null;
      phone: string | null;
    }>();

  const load = await db
    .prepare("SELECT loaded_at, loaded_by, row_count, refused_count FROM supplier_loads ORDER BY loaded_at DESC LIMIT 1")
    .first<{ loaded_at: string; loaded_by: string; row_count: number; refused_count: number }>();

  return {
    status: 200,
    body: {
      suppliers: rows.results.map((r) => ({
        id: r.id,
        erpIdentifier: r.erp_identifier,
        erpSiteIdentifier: r.erp_site_identifier,
        name: r.name,
        vatId: r.vat_id,
        electronicAddress: r.electronic_address,
        country: r.country,
        paymentTerms: r.payment_terms,
        onHold: r.on_hold === 1,
        holdReason: r.hold_reason,
        matchOption: r.match_option,
        status: r.status,
        isPaySite: r.is_pay_site === 1,
        isProcurementSite: r.is_procurement_site === 1,
        addressLine: r.address_line,
        city: r.city,
        postalCode: r.postal_code,
        email: r.email,
        phone: r.phone,
      })),
      /**
       * **Null where nothing was ever loaded**, which a screen must say
       * differently from *"loaded a long time ago"* — one is fixed by
       * asking for a file and the other by asking for a newer one.
       */
      lastLoad: load
        ? {
            loadedAt: load.loaded_at,
            loadedBy: load.loaded_by,
            rowCount: load.row_count,
            refusedCount: load.refused_count,
          }
        : null,
    },
  };
}

/**
 * Finding a supplier by whatever a person has to hand — decision 0222.
 *
 * **One box, not a form.** Somebody looking at an invoice has a name, or
 * a VAT number, or an address on the page — and does not know which of
 * those we hold. Asking them to pick a field first is asking them to
 * guess what we stored.
 *
 * So the search is across every identifying field at once, and the
 * caller types what they can see.
 */
export async function handleSearchSuppliers(
  db: D1Database,
  query: string
): Promise<RouteResult> {
  const q = query.trim();
  if (q.length < 2) {
    // One character matches most of a supplier list, which is the same
    // as no help at all.
    return { status: 200, body: { suppliers: [] } };
  }

  const like = `%${q.replace(/[%_]/g, "")}%`;

  const rows = await db
    .prepare(
      `SELECT id, erp_identifier, erp_site_identifier, name, vat_id, electronic_address,
              email, phone, address_line, city, postal_code, country,
              is_pay_site, is_procurement_site, on_hold, hold_reason, payment_terms
       FROM suppliers
       WHERE status = 'active'
         AND (
           name LIKE ?1
           OR erp_identifier LIKE ?1
           OR vat_id LIKE ?1
           OR replace(vat_id, ' ', '') LIKE ?1
           OR electronic_address LIKE ?1
           OR email LIKE ?1
           OR address_line LIKE ?1
           OR city LIKE ?1
           OR postal_code LIKE ?1
         )
       ORDER BY
         /**
          * **Pay sites first.** An invoice goes to one (decision 0218),
          * so a person choosing by hand is usually choosing one — and
          * the list should not make them scroll past two procurement
          * sites to reach it.
          */
         is_pay_site DESC, name
       LIMIT 25`
    )
    .bind(like)
    .all<Record<string, unknown>>();

  return { status: 200, body: { suppliers: rows.results } };
}

/**
 * Attaching an invoice to a supplier by hand — decision 0222.
 *
 * **Recorded as a person's choice, not as a match.** Decision 0209's
 * matching writes `supplier.matched`; this writes it too, and adds who
 * decided — because *"we found this"* and *"somebody said so"* are
 * different claims and only one of them can be wrong in a way a rule
 * could have prevented.
 */
export async function handleSetInvoiceSupplier(
  db: D1Database,
  invoiceId: string,
  supplierId: unknown,
  chosenBy: string
): Promise<RouteResult> {
  if (typeof supplierId !== "string" || !supplierId) {
    return { status: 400, body: { error: "supplierId (string) is required" } };
  }

  const invoice = await db
    .prepare("SELECT id FROM invoice_headers WHERE id = ?")
    .bind(invoiceId)
    .first();
  if (!invoice) return { status: 404, body: { error: `invoice ${invoiceId} does not exist` } };

  const supplier = await db
    .prepare("SELECT id, status FROM suppliers WHERE id = ?")
    .bind(supplierId)
    .first<{ id: string; status: string }>();
  if (!supplier) {
    return { status: 404, body: { error: `supplier ${supplierId} does not exist` } };
  }

  if (supplier.status !== "active") {
    /**
     * **An inactive supplier is one the ERP no longer has** (decision
     * 0208), and attaching an invoice to it would produce a payment
     * instruction the ERP refuses. Refused here with a reason rather
     * than discovered at payment.
     */
    return {
      status: 409,
      body: { error: "that supplier is no longer active", reason: "supplier_inactive" },
    };
  }

  await db
    .prepare(
      `UPDATE invoice_headers
       SET supplier_id = ?,
           facts_json = json_remove(
             json_set(
               json_set(facts_json, '$."supplier.matched"', 1),
               '$."supplier.chosenBy"', ?),
             '$."supplier.unmatchedReason"')
       WHERE id = ?`
    )
    .bind(supplierId, chosenBy, invoiceId)
    .run();

  return { status: 200, body: { invoiceId, supplierId } };
}
