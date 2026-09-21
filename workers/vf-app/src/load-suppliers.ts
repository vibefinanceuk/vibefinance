import { matchSupplier } from "./match-supplier.js";
import type { RouteResult } from "./org-route.js";
import { unitsWherePermitted, scopedToChosenOrg, unitClause } from "./enforce.js";
import { spawnSupplierMaintenanceInstance, detectSupplierChanges } from "./supplier-maintenance.js";
import {
  AUDITED_FIELDS,
  diffSupplierFields,
  recordSupplierFieldChanges,
  type AuditedField,
  type SupplierAuditSnapshot,
} from "./supplier-audit.js";

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
  // Early-payment / dynamic-discount terms — decision 0427. Structured,
  // unlike `payment_terms`, so this metric can be computed honestly
  // rather than parsed out of free text.
  discount_pct: "discount_pct",
  "discount %": "discount_pct",
  "early payment discount": "discount_pct",
  discount_days: "discount_days",
  "discount window": "discount_days",
  "discount days": "discount_days",
  // **The agreed side of a payment-means comparison — decision 0429,
  // a placeholder.** Loaded exactly like `discount_pct`/`discount_days`
  // above — a customer's own CSV export, never guessed — and, on
  // purpose, read nowhere else yet: no route, no report, no hand-edit
  // form. See migration 0073 for the full reasoning, including why the
  // "invoiced" side this would eventually compare against does not
  // exist in this codebase either.
  agreed_payment_means: "agreed_payment_means",
  "payment means": "agreed_payment_means",
  "agreed payment means": "agreed_payment_means",
  agreed_account_identifier: "agreed_account_identifier",
  iban: "agreed_account_identifier",
  "account number": "agreed_account_identifier",
  "agreed iban": "agreed_account_identifier",
  agreed_account_name: "agreed_account_name",
  "account name": "agreed_account_name",
  "agreed account name": "agreed_account_name",
  erp_site_identifier: "erp_site_identifier",
  site: "erp_site_identifier",
  /**
   * **The ERP's own site code, and this system's own org unit, are
   * two different things** — decision 0317. `site` above is a free
   * string with no relationship to `org_units`; this names one of
   * them directly, by the name already shown throughout this app
   * (`documents.js`'s own unit picker, the org switcher itself), not
   * by an internal id nobody outside this codebase has ever seen.
   */
  org_unit: "org_unit_name",
  "org unit": "org_unit_name",
  org: "org_unit_name",
  organisation: "org_unit_name",
  organization: "org_unit_name",
  "legal entity": "org_unit_name",
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
  /**
   * Suppliers recorded here before the ERP had them, which this load
   * has now given an identifier — decision 0233.
   */
  adopted: number;
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
  /** Locally recorded suppliers the ERP has now caught up with. */
  let adoptedCount = 0;

  /**
   * **Every real org unit, by its own lowercased name** — one query
   * for the whole load rather than one per row, the same reasoning
   * decision 0314's own `unitsBeneath` batching already gives.
   */
  const unitsByName = new Map<string, string>();
  const unitRows = await db.prepare("SELECT id, name FROM org_units").all<{ id: string; name: string }>();
  for (const u of unitRows.results) unitsByName.set(u.name.toLowerCase(), u.id);

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
     * **A name resolved against real units, not accepted as-is** — a
     * misspelled or retired org name would otherwise silently leave a
     * row unassigned rather than telling anybody it tried and failed.
     * Left blank means genuinely unassigned, the same "not yet
     * assigned" every other org-scoped column in this system already
     * allows; named but not found is refused instead.
     */
    let orgUnitId: string | null = null;
    if (values.org_unit_name) {
      orgUnitId = unitsByName.get(values.org_unit_name.toLowerCase()) ?? null;
      if (!orgUnitId) {
        refused.push({ row: i + 1, reason: `org unit "${values.org_unit_name}" is not recognised` });
        continue;
      }
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
        `SELECT id, ${AUDITED_FIELDS.join(", ")} FROM suppliers
         WHERE erp_identifier = ?
           AND ((erp_site_identifier IS NULL AND ?2 IS NULL) OR erp_site_identifier = ?2)`
      )
      .bind(values.erp_identifier, values.erp_site_identifier || null)
      .first<{ id: string } & Record<AuditedField, string | number | null>>();

    /**
     * **Adopting a supplier somebody recorded before the ERP had one** —
     * decision 0233.
     *
     * The operator's own sequence: *"the new supplier would be created
     * and the record here updated to include the ERP Identifier
     * retroactively."*
     *
     * Without this the load **creates a second row** for a company we
     * already know, and every invoice matched to the first keeps
     * pointing at a supplier the ERP still cannot name. Decision 0231
     * recorded that as the largest hole in it, and this is the hole.
     *
     * **Matched on what both rows carry** — the VAT id or the
     * electronic address — because a local row has no ERP identifier by
     * definition, which is the whole reason it exists.
     */
    const adopted = existing
      ? null
      : await db
          .prepare(
            `SELECT id, ${AUDITED_FIELDS.join(", ")} FROM suppliers
             WHERE erp_identifier IS NULL
               AND (
                 (?1 != '' AND upper(replace(vat_id, ' ', '')) = upper(replace(?1, ' ', '')))
                 OR (?2 != '' AND electronic_address = ?2)
               )
             LIMIT 1`
          )
          .bind(values.vat_id ?? "", values.electronic_address ?? "")
          .first<{ id: string } & Record<AuditedField, string | number | null>>();

    /**
     * **An adopted row keeps its own id**, like any existing one
     * (decision 0217). Invoices matched to it yesterday still mean that
     * supplier, and a new id would orphan them — which is the entire
     * point of adopting rather than inserting.
     */
    const id =
      existing?.id ??
      adopted?.id ??
      `${values.erp_identifier}${values.erp_site_identifier ? `:${values.erp_site_identifier}` : ""}`;
    seen.push(id);

    if (adopted) adoptedCount++;

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
                                discount_pct, discount_days,
                                agreed_payment_means, agreed_account_identifier, agreed_account_name,
                                erp_site_identifier, is_pay_site, is_procurement_site,
                                address_line, city, postal_code, email, phone, status, loaded_at,
                                org_unit_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'), ?)
         ON CONFLICT(id) DO UPDATE SET
           -- **The retroactive part.** An adopted row had none.
           erp_identifier = excluded.erp_identifier,
           erp_site_identifier = excluded.erp_site_identifier,
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
           discount_pct = excluded.discount_pct,
           discount_days = excluded.discount_days,
           agreed_payment_means = excluded.agreed_payment_means,
           agreed_account_identifier = excluded.agreed_account_identifier,
           agreed_account_name = excluded.agreed_account_name,
           is_pay_site = excluded.is_pay_site,
           is_procurement_site = excluded.is_procurement_site,
           address_line = excluded.address_line,
           city = excluded.city,
           postal_code = excluded.postal_code,
           email = excluded.email,
           phone = excluded.phone,
           status = 'active',
           loaded_at = datetime('now'),
           org_unit_id = excluded.org_unit_id`
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
        values.discount_pct ? Number(values.discount_pct) : null,
        values.discount_days ? Number(values.discount_days) : null,
        values.agreed_payment_means || null,
        values.agreed_account_identifier || null,
        values.agreed_account_name || null,
        values.erp_site_identifier || null,
        flag(values.is_pay_site) ? 1 : 0,
        flag(values.is_procurement_site) ? 1 : 0,
        values.address_line || null,
        values.city || null,
        values.postal_code || null,
        values.email || null,
        values.phone || null,
        orgUnitId
      )
      .run();

    /**
     * **The "changed" half — decision 0350.** Only for a supplier the
     * ERP already named (`existing`), never a brand-new or newly-
     * adopted row: those are the "new supplier" half, already handled
     * by `handleCreateSupplier`, and comparing a row against itself on
     * its first-ever load would flag every field as "changed." Left
     * exactly as it is — a narrow, purpose-built trigger for the
     * Supplier Maintenance workflow, decision 0427 built a separate,
     * general mechanism beside it rather than replacing it.
     */
    if (existing) {
      const changedFields = detectSupplierChanges(
        {
          name: existing.name as string,
          vat_id: existing.vat_id as string | null,
          electronic_address: existing.electronic_address as string | null,
          payment_terms: existing.payment_terms as string | null,
        },
        {
          name: values.name,
          vat_id: values.vat_id || null,
          electronic_address: values.electronic_address || null,
          payment_terms: values.payment_terms || null,
        }
      );
      if (changedFields.length > 0) {
        await spawnSupplierMaintenanceInstance(db, id, values.name, "changed", changedFields);
      }
    }

    /**
     * **The general field-change history — decision 0427.** Against
     * `existing` when the ERP already named this row, or `adopted`'s
     * own prior values when a local record just gained its ERP
     * identifier retroactively (decision 0233) — both are real "before"
     * states. A genuinely brand-new row (neither) has nothing to have
     * transitioned from, so nothing is recorded for it.
     */
    const before = existing ?? adopted;
    if (before) {
      const after: SupplierAuditSnapshot = {
        erp_identifier: values.erp_identifier,
        name: values.name,
        vat_id: values.vat_id || null,
        electronic_address: values.electronic_address || null,
        country: values.country || null,
        payment_terms: values.payment_terms || null,
        on_hold: onHold,
        hold_reason: values.hold_reason || null,
        match_option: matchOption || null,
        amount_tolerance_pct: values.amount_tolerance_pct ? Number(values.amount_tolerance_pct) : null,
        quantity_tolerance_pct: values.quantity_tolerance_pct ? Number(values.quantity_tolerance_pct) : null,
        discount_pct: values.discount_pct ? Number(values.discount_pct) : null,
        discount_days: values.discount_days ? Number(values.discount_days) : null,
        agreed_payment_means: values.agreed_payment_means || null,
        agreed_account_identifier: values.agreed_account_identifier || null,
        agreed_account_name: values.agreed_account_name || null,
        erp_site_identifier: values.erp_site_identifier || null,
        is_pay_site: flag(values.is_pay_site),
        is_procurement_site: flag(values.is_procurement_site),
        address_line: values.address_line || null,
        city: values.city || null,
        postal_code: values.postal_code || null,
        email: values.email || null,
        phone: values.phone || null,
        status: "active",
        org_unit_id: orgUnitId,
      };
      await recordSupplierFieldChanges(db, id, diffSupplierFields(before, after), loadedBy);
    }

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
      adopted: adoptedCount,
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
      `SELECT id, facts_json, org_unit_id FROM invoice_headers
       WHERE supplier_id IS NULL
         AND json_extract(facts_json, '$."supplier.matched"') = 0`
    )
    .all<{ id: string; facts_json: string; org_unit_id: string | null }>();

  let rematched = 0;

  for (const invoice of unmatched.results) {
    let facts: Record<string, unknown> = {};
    try {
      facts = JSON.parse(invoice.facts_json) as Record<string, unknown>;
    } catch {
      continue;
    }

    const matched = await matchSupplier(db, facts, invoice.org_unit_id);
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
/** Page sizes offered in the UI dropdown — anything else is rejected back to the default, the same discipline decision 0376 established for Purchase Orders. */
const SUPPLIER_PAGE_SIZES = [25, 50, 100, 200] as const;
const SUPPLIER_DEFAULT_PAGE_SIZE = 50;

function normalizeSupplierPageSize(requested: string | null): number {
  const n = requested ? Number(requested) : NaN;
  return (SUPPLIER_PAGE_SIZES as readonly number[]).includes(n) ? n : SUPPLIER_DEFAULT_PAGE_SIZE;
}

function normalizeSupplierPage(requested: string | null): number {
  const n = requested ? Number(requested) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/**
 * The search clause — the same broad, "one box, not a form" field set
 * decision 0222's own `handleSearchSuppliers` already searches
 * ("somebody looking at an invoice has a name, or a VAT number, or an
 * address on the page"), reused here rather than a narrower set
 * invented fresh for the list. Deliberately without that function's
 * own `status = 'active'` restriction or `LIMIT 25` — this is the
 * full list a person browses, not a quick picker.
 */
function supplierSearchClause(search: string | null): { sql: string; binds: unknown[] } {
  const term = search?.trim();
  if (!term) return { sql: "", binds: [] };

  const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
  return {
    sql: ` AND (
      s.name LIKE ? ESCAPE '\\'
      OR s.erp_identifier LIKE ? ESCAPE '\\'
      OR s.vat_id LIKE ? ESCAPE '\\'
      OR s.electronic_address LIKE ? ESCAPE '\\'
      OR s.email LIKE ? ESCAPE '\\'
      OR s.address_line LIKE ? ESCAPE '\\'
      OR s.city LIKE ? ESCAPE '\\'
      OR s.postal_code LIKE ? ESCAPE '\\'
    )`,
    binds: [pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern],
  };
}

/**
 * The same four-bucket status the donut chart and its own
 * `supplierBucket()` already compute client-side — mirrored here in
 * SQL so the list can filter by it directly. Needed the moment real
 * pagination arrived: `supplierBucket()`'s own filter ran over the
 * fully-loaded array, which real pagination silently breaks — a
 * "held" filter would only ever see whichever held suppliers happened
 * to land on the current page, not the true, full set. `awaitingerp`
 * checked first, matching `supplierBucket()`'s own priority exactly.
 */
const SUPPLIER_STATUS_CASE = `
  CASE
    WHEN s.erp_identifier IS NULL OR s.erp_identifier = '' THEN 'awaitingerp'
    WHEN s.on_hold = 1 THEN 'onhold'
    WHEN s.status = 'inactive' THEN 'inactive'
    ELSE 'active'
  END
`;
const SUPPLIER_STATUSES = ["active", "onhold", "inactive", "awaitingerp"] as const;

function supplierStatusClause(status: string | null): { sql: string; binds: unknown[] } {
  if (!status) return { sql: "", binds: [] };
  if (!(SUPPLIER_STATUSES as readonly string[]).includes(status)) return { sql: " AND 1 = 0", binds: [] };
  return { sql: ` AND (${SUPPLIER_STATUS_CASE}) = ?`, binds: [status] };
}

/**
 * The status ring's own counts, org-wide and permission-scoped but
 * never page-limited — decision 0378, mirroring
 * `handleGetPurchaseOrderStatusCounts` exactly (decision 0377).
 *
 * **Needed the moment real pagination arrived**, for the same reason
 * the list's own status filter did: `supplierStatusCard()`'s own ring
 * used to count the fully-loaded `suppliers` array in the browser,
 * which real, server-side pagination breaks the same way — a ring
 * built from whichever 50 suppliers happen to be on the current page
 * is not the true, full count.
 */
export async function handleGetSupplierStatusCounts(
  db: D1Database,
  currentOrg: string | null = null,
  userId?: string
): Promise<RouteResult> {
  const visible = userId ? await unitsWherePermitted(db, userId, "AP.Supplier") : null;
  const scopedUnits = await scopedToChosenOrg(db, visible, currentOrg);
  const clause = unitClause({ units: scopedUnits }, "s.org_unit_id");

  const rows = await db
    .prepare(
      `SELECT (${SUPPLIER_STATUS_CASE}) AS status, count(*) AS n
       FROM suppliers s
       WHERE 1 = 1 ${clause.sql}
       GROUP BY (${SUPPLIER_STATUS_CASE})`
    )
    .bind(...clause.binds)
    .all<{ status: string; n: number }>();

  const counts: Record<string, number> = { active: 0, onhold: 0, inactive: 0, awaitingerp: 0 };
  for (const row of rows.results) counts[row.status] = row.n;

  return { status: 200, body: { counts } };
}

export async function handleListSuppliers(
  db: D1Database,
  currentOrg: string | null = null,
  userId?: string,
  search: string | null = null,
  pageParam: string | null = null,
  pageSizeParam: string | null = null,
  statusParam: string | null = null
): Promise<RouteResult> {
  /**
   * **Real, permission-based scoping — decision 0358.** Reported
   * live: "we recently added the org unit, at supplier site level.
   * would it be possible to filter the supplier by org permissions."
   * Decision 0317 named this gap directly: reading the supplier list
   * had never been unit-scoped at all, so the chosen org was the
   * first restriction of any kind, not a narrowing of an existing
   * one. `AP.Supplier` can now be granted scoped to a unit the same
   * way `AP.Review` already can; `visible` is that real scope,
   * computed from the caller's own role assignments — the chosen org
   * only ever narrows further within it, the same "intersect, never
   * replace" shape `scopedToChosenOrg` already guarantees for Tasks,
   * Documents, and the dashboard.
   *
   * `userId` stays optional, defaulting to unrestricted: a caller
   * with no real person behind it (a scheduled job, a script) gets
   * every supplier, the same as before this existed, rather than a
   * parameter every existing caller would otherwise be forced to
   * thread through immediately.
   *
   * **An unassigned supplier always stays visible**, regardless of
   * scope or which org is chosen — `unitClause` already gives every
   * other screen this exact exception (decision 0255), and the
   * reasoning is identical here: an unassigned supplier is exactly
   * the thing somebody needs to notice and fix, not something hiding
   * it helps.
   */
  const visible = userId ? await unitsWherePermitted(db, userId, "AP.Supplier") : null;
  const scopedUnits = await scopedToChosenOrg(db, visible, currentOrg);
  const clause = unitClause({ units: scopedUnits }, "s.org_unit_id");
  const search_ = supplierSearchClause(search);
  const status_ = supplierStatusClause(statusParam);
  const page = normalizeSupplierPage(pageParam);
  const pageSize = normalizeSupplierPageSize(pageSizeParam);
  const offset = (page - 1) * pageSize;

  const totalRow = await db
    .prepare(`SELECT count(*) AS n FROM suppliers s WHERE 1 = 1 ${clause.sql} ${search_.sql} ${status_.sql}`)
    .bind(...clause.binds, ...search_.binds, ...status_.binds)
    .first<{ n: number }>();

  const rows = await db
    .prepare(
      `SELECT s.id, s.erp_identifier, s.erp_site_identifier, s.name, s.vat_id, s.electronic_address,
              s.country, s.payment_terms, s.on_hold, s.hold_reason, s.match_option, s.status,
              s.is_pay_site, s.is_procurement_site, s.address_line, s.city, s.postal_code, s.email, s.phone,
              s.org_unit_id, u.name AS org_unit_name
       FROM suppliers s
       LEFT JOIN org_units u ON u.id = s.org_unit_id
       WHERE 1 = 1 ${clause.sql} ${search_.sql} ${status_.sql}
       ORDER BY s.status, s.name
       LIMIT ? OFFSET ?`
    )
    .bind(...clause.binds, ...search_.binds, ...status_.binds, pageSize, offset)
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
      org_unit_id: string | null;
      org_unit_name: string | null;
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
        orgUnitId: r.org_unit_id,
        orgUnitName: r.org_unit_name,
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
      total: totalRow?.n ?? 0,
      page,
      pageSize,
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
  query: string,
  /**
   * **The invoice's own buying entity, to rank by — decision 0433.**
   *
   * Found live: an invoice whose seller matched several sites sharing
   * one VAT number, none tagged as a pay site, reached this same
   * unscoped search for a person to resolve by hand — and every
   * candidate looked equally plausible, because nothing here knew
   * which of them actually does business with *this* buying entity.
   * `matchSupplier`'s own automatic tiebreak already narrows exactly
   * this way (decision 0317's own words: "the supplier might have a
   * different ERP Identifier per Org") — this gives the manual search
   * the same signal, one step later, for the case the automatic
   * tiebreak still could not resolve alone.
   *
   * **Ranks, never filters.** A `LEFT JOIN` on `org_unit_id`, not a
   * `WHERE`: org tagging on the supplier master file is something a
   * customer fills in over time, never a promise it is complete, and a
   * site nobody has tagged yet has not thereby said it is *not* the
   * right one — the same reasoning `match-supplier.ts` already gives
   * its own org tiebreak. Optional and defaulted to `null` so every
   * existing caller, and every existing test, keeps searching exactly
   * as it did.
   */
  orgUnitId: string | null = null
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
              is_pay_site, is_procurement_site, on_hold, hold_reason, payment_terms,
              (org_unit_id IS NOT NULL AND org_unit_id = ?2) AS org_match
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
          * **The invoice's own org first, then pay sites, decision
          * 0433 ahead of decision 0218's own tiebreak.** Both answer
          * "which of these is most likely right", and org is the
          * stronger claim: a pay site is a guess at which of a
          * supplier's *own* sites gets paid, where an org match says
          * this site has *already done business* with this exact
          * buying entity. Neither hides the other's candidates — this
          * only decides who is on screen first.
          */
         org_match DESC, is_pay_site DESC, name
       LIMIT 25`
    )
    .bind(like, orgUnitId)
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

/**
 * Recording a supplier the ERP does not have yet — decision 0231.
 *
 * **The precursor to a new-supplier process**, in the operator's own
 * words: an invoice turns up, somebody writes down who sent it, and a
 * team creates the ERP record afterwards **from exactly these
 * details**.
 *
 * Decision 0208 said we are the mirror and there is no create here.
 * That is still true of a supplier the ERP **has** — this creates one
 * it does not, which is the opposite act: not overriding a master, but
 * telling it what is missing.
 */
export async function handleCreateSupplier(
  db: D1Database,
  body: Record<string, unknown>,
  createdBy: string
): Promise<RouteResult> {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    // A supplier nobody can recognise is one nobody can check against.
    return { status: 400, body: { error: "a supplier needs a name" } };
  }

  const erp = typeof body.erpIdentifier === "string" ? body.erpIdentifier.trim() : "";

  if (erp) {
    /**
     * **Somebody typing an identifier the ERP already uses** is
     * describing a supplier we have, not a new one — and the unique
     * index would refuse it as a constraint error rather than as an
     * explanation.
     */
    const clash = await db
      .prepare("SELECT id FROM suppliers WHERE erp_identifier = ?")
      .bind(erp)
      .first();
    if (clash) {
      return {
        status: 409,
        body: { error: `a supplier with ERP identifier ${erp} already exists`, reason: "erp_exists" },
      };
    }
  }

  /**
   * **An id of our own**, because there is no ERP identifier to build
   * one from. Decision 0217's lookup finds a supplier by what the ERP
   * calls it, so a later load naming this one will find it by VAT id
   * rather than by this.
   */
  const id = `local:${crypto.randomUUID()}`;

  await db
    .prepare(
      `INSERT INTO suppliers (id, erp_identifier, name, vat_id, electronic_address, country,
                              email, phone, address_line, city, postal_code, payment_terms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      erp || null,
      name,
      text(body.vatId),
      text(body.electronicAddress),
      text(body.country),
      text(body.email),
      text(body.phone),
      text(body.addressLine),
      text(body.city),
      text(body.postalCode),
      text(body.paymentTerms)
    )
    .run();

  /**
   * **The "new supplier" half — decision 0350.** `!erp` is exactly
   * decision 0231's own `supplier.awaitingErp`: a record made before
   * the ERP has one. Fails soft by design; a supplier record must
   * never fail to be created because an optional maintenance process
   * hasn't been seeded.
   */
  if (!erp) {
    await spawnSupplierMaintenanceInstance(db, id, name, "new_supplier");
  }

  return { status: 201, body: { id, createdBy, awaitingErp: !erp } };
}

/** A trimmed string, or null — an empty box is not an answer. */
function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Everything a person may change about a supplier by hand. */
const EDITABLE = [
  /**
   * **Editable since decision 0231**, because that is how a supplier
   * awaiting the ERP stops awaiting it: the team creates the record and
   * somebody writes the number down.
   *
   * Decision 0218 called it not editable, on the argument that changing
   * it could point our record at a different supplier than the ERP has.
   * **That argument holds for a row the ERP owns and not for one it
   * does not** — and filling in a blank is not the same act as
   * overwriting a value.
   */
  "erp_identifier",
  "name",
  "vat_id",
  "electronic_address",
  "email",
  "phone",
  "address_line",
  "city",
  "postal_code",
  "country",
  "payment_terms",
] as const;

/**
 * Changing a supplier by hand — decision 0230.
 *
 * **We are the mirror** (decision 0208), and this does not stop being
 * true because somebody edited a row. A change made here is **overwritten
 * by the next load**, which is not a bug: the ERP is the master, and a
 * mirror that defended its own edits would be a master pretending to be
 * a mirror.
 *
 * So the route saves, and the screen says what will happen to it.
 */
export async function handleUpdateSupplier(
  db: D1Database,
  supplierId: string,
  body: Record<string, unknown>,
  changedBy: string
): Promise<RouteResult> {
  const supplier = await db
    .prepare(`SELECT id, ${EDITABLE.join(", ")} FROM suppliers WHERE id = ?`)
    .bind(supplierId)
    .first<{ id: string; erp_identifier: string | null } & Record<(typeof EDITABLE)[number], string | null>>();
  if (!supplier) return { status: 404, body: { error: `supplier ${supplierId} does not exist` } };

  /**
   * **Filling in a blank is not overwriting a value** — decision 0231.
   *
   * A supplier awaiting the ERP gains its identifier when the team
   * creates the record; a supplier that has one keeps it, because
   * decision 0218's argument holds there: changing it would point our
   * record at a different supplier than the ERP has, silently, with
   * invoices already attached.
   */
  if ("erpIdentifier" in body && supplier.erp_identifier) {
    const wanted = typeof body.erpIdentifier === "string" ? body.erpIdentifier.trim() : "";
    if (wanted !== supplier.erp_identifier) {
      return {
        status: 409,
        body: {
          error: "this supplier already has an ERP identifier — change it in the ERP",
          reason: "erp_already_set",
        },
      };
    }
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  const touched: SupplierAuditSnapshot = {};

  for (const column of EDITABLE) {
    const key = column.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (!(key in body)) continue;

    const value = body[key];
    if (value !== null && typeof value !== "string") {
      return { status: 400, body: { error: `${key} must be text, or null to clear it` } };
    }

    /**
     * **The name is the one thing that cannot be cleared.** A supplier
     * nobody can recognise on a screen is one nobody can check a match
     * against — the same argument the loader makes when it refuses a
     * row with no name.
     */
    if (column === "name" && (value === null || value.trim() === "")) {
      return { status: 400, body: { error: "a supplier needs a name" } };
    }

    const stored = value === null || value === "" ? null : value;
    sets.push(`${column} = ?`);
    values.push(stored);
    touched[column as AuditedField] = stored;
  }

  if (sets.length === 0) return { status: 400, body: { error: "nothing to change" } };

  await db
    .prepare(`UPDATE suppliers SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values, supplierId)
    .run();

  await recordSupplierFieldChanges(db, supplierId, diffSupplierFields(supplier, touched), changedBy);

  return { status: 200, body: { id: supplierId, changedBy } };
}

/**
 * Holding, releasing, activating and deactivating — decision 0230.
 *
 * **Four acts, one route**, because they are the same act: setting a
 * flag the ERP also sets. Splitting them into four endpoints would make
 * *hold* and *deactivate* look like different kinds of thing, and they
 * are not — **one stops payment and the other stops matching**, and
 * both are reversed by doing the opposite.
 */
export async function handleSetSupplierState(
  db: D1Database,
  supplierId: string,
  body: Record<string, unknown>,
  changedBy: string
): Promise<RouteResult> {
  const supplier = await db
    .prepare("SELECT id, on_hold, hold_reason, status FROM suppliers WHERE id = ?")
    .bind(supplierId)
    .first<{ id: string; on_hold: number; hold_reason: string | null; status: string }>();
  if (!supplier) return { status: 404, body: { error: `supplier ${supplierId} does not exist` } };

  const sets: string[] = [];
  const values: unknown[] = [];
  const touched: SupplierAuditSnapshot = {};

  if ("onHold" in body) {
    const hold = body.onHold === true;
    const reason = typeof body.holdReason === "string" ? body.holdReason.trim() : "";

    if (hold && !reason) {
      /**
       * **A payment stopped for no stated cause** is worse than one
       * stopped for a bad one — migration 0049 refuses it as a standing
       * invariant, and this refuses it with something a person can act
       * on.
       */
      return {
        status: 400,
        body: { error: "a hold needs a reason", reason: "hold_without_reason" },
      };
    }

    sets.push("on_hold = ?", "hold_reason = ?");
    values.push(hold ? 1 : 0, hold ? reason : null);
    touched.on_hold = hold;
    touched.hold_reason = hold ? reason : null;
  }

  if ("status" in body) {
    if (body.status !== "active" && body.status !== "inactive") {
      return { status: 400, body: { error: "status must be 'active' or 'inactive'" } };
    }
    sets.push("status = ?");
    values.push(body.status);
    touched.status = body.status;
  }

  if (sets.length === 0) return { status: 400, body: { error: "nothing to change" } };

  await db
    .prepare(`UPDATE suppliers SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values, supplierId)
    .run();

  await recordSupplierFieldChanges(
    db,
    supplierId,
    diffSupplierFields({ on_hold: supplier.on_hold, hold_reason: supplier.hold_reason, status: supplier.status }, touched),
    changedBy
  );

  /**
   * **Invoices already matched to this supplier keep their flag**, and
   * that is deliberate. `supplier.onHold` is recorded at capture, so an
   * invoice assessed yesterday was assessed against yesterday's truth.
   *
   * Re-assessing every invoice in flight is a real feature and a
   * different one — decision 0211's re-match is the same argument, and
   * this is recorded rather than done.
   */
  return { status: 200, body: { id: supplierId } };
}

/**
 * Is an ERP the master here — decision 0230.
 *
 * **A fact about the customer, not about a supplier row.**
 *
 * The operator asked to warn on save *"IF the ERP Identifier is
 * populated"* — which is always, because decision 0209 made it `NOT
 * NULL` and a standing invariant says so. **Every supplier has one by
 * definition.**
 *
 * What the question really asks is whether an ERP feeds this list, and
 * a load having happened is the honest answer: before the first one,
 * every row was typed here and a warning would be telling somebody off
 * for the only thing they can do.
 */
export async function isFedByLoad(db: D1Database): Promise<boolean> {
  const load = await db.prepare("SELECT 1 FROM supplier_loads LIMIT 1").first();
  return load !== null;
}
