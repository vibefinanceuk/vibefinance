import { unitsWherePermitted, scopedToChosenOrg, unitClause } from "./enforce.js";
import type { RouteResult } from "./org-route.js";

/**
 * An exact count of invoices matching a date floor and/or a supplier,
 * plus their exact total amount by currency — decision 0430's third
 * addendum built the count, for the AP Assistant's own `invoice_search`
 * tool answering "how many"; the fourth addendum added the total, for
 * the same tool answering "what's the total invoice amount," a real
 * gap a live test surfaced directly ("total invoice amount for this
 * quarter" was refused outright — nothing summed amounts over a
 * calendar period at all).
 *
 * **Deliberately separate from `invoice_search`'s own list.** That
 * tool wraps `documents-route.ts`'s `handleListDocuments`, which is
 * capped at 50 rows and searches supplier text only over what was
 * already fetched — an honest limitation for browsing, but a real one
 * for counting or summing: an answer built from a capped, in-memory-
 * filtered list would quietly undercount, or under-total, once more
 * than 50 rows exist. This runs small, unbounded queries instead, so
 * both are always exact regardless of how many rows match.
 *
 * **Never summed across currencies** — the same discipline every other
 * money total in this app already keeps (`supplier_spend`,
 * `accrual_summary`, `spend_under_management`), because nothing here
 * converts between them; a `GBP` total and a `USD` total are two real
 * numbers, never quietly blended into one. A row missing either an
 * amount or a currency is excluded from the total rather than
 * coerced to zero or an unlabelled bucket — it still counts toward
 * `count` above, since "how many invoices" and "how much were they
 * worth" are honestly different questions with different answerable
 * sets.
 *
 * **A tighter supplier match than the Documents screen's own search**
 * — `LIKE` directly against `suppliers.name` (falling back to the raw
 * `BT-27` fact the same way `invoice-lookup-route.ts` already does),
 * not the generic multi-field `q` search `documents-route.ts` uses.
 * That is a deliberately narrower, SQL-provable match rather than a
 * force-fit of a search built for a different, broader purpose.
 *
 * **An optional stage filter, also fourth addendum** — "how many
 * invoices are at the Validation stage." Already-resolved stage ids
 * come in, not a stage name (`ap-assistant.ts`'s own job to resolve
 * one, since a name can mean more than one real stage across
 * different processes — `process_stages` is customer-configurable),
 * matched with `EXISTS` rather than a `JOIN` — a `JOIN` against
 * `process_instances` would silently inflate the count or the total
 * for any invoice that ever picked up more than one instance, nothing
 * in this schema actually forbids it, and this route's whole reason
 * to exist is staying exactly right even in a case that rare.
 *
 * Scoped by unit and chosen org exactly like `invoice_search` and the
 * real Documents screen — the same `AP.Review` permission, so this
 * can never count or total an invoice that screen itself would hide
 * from the person asking.
 *
 * **`unconfirmedCount`, decision 0430's sixth addendum.** A live test
 * pasted the assistant's own answer straight back showing why this is
 * needed: a five-row invoice list whose own visible amounts summed to
 * one number, sitting right above a total the assistant called exact
 * that was a different, smaller number — both true statements about
 * this route's own two data sources disagreeing silently. `invoice_
 * search`'s own list (`documents-route.ts`) shows whatever a document's
 * raw extracted `BT-112`/`BT-5` facts say, for every row that has them,
 * whether or not this app has ever confirmed them; this route's own
 * total only ever sums the structured, confirmed `total_with_vat`/
 * `currency` columns, exactly as it always has, on purpose — the
 * "never invent, never estimate" discipline this whole feature is
 * built on means an unconfirmed extracted figure can never be allowed
 * into a total this tool calls exact. So the total staying narrower
 * than the list is correct, not a bug — the bug was that nothing ever
 * said so. `unconfirmedCount` is how many of the matching invoices
 * were left out of the total for exactly this reason, computed
 * alongside `count` at no extra query cost, so the answer-phrasing
 * prompt can disclose the gap in plain language instead of leaving a
 * total that silently doesn't add up to a list sitting right next to
 * it.
 */

export interface InvoiceCountReport {
  count: number;
  totalByCurrency: { currency: string; total: number }[];
  unconfirmedCount: number;
}

export async function handleInvoiceCount(
  db: D1Database,
  currentOrg: string | null,
  userId: string,
  filters: {
    since?: string | null;
    supplier?: string | null;
    /**
     * Real stage ids, already resolved from whatever name the person
     * gave (`process_stages` is customer-configurable, so a name can
     * resolve to more than one real id) — decision 0430's fourth
     * addendum. `null`/absent means no stage narrowing. "Held at" means
     * currently there, not merely having passed through once — the
     * same `status = 'in_progress'` restriction `documents-route.ts`'s
     * own `stage`/`stageIds` filters already apply.
     */
    stageIds?: string[] | null;
  }
): Promise<RouteResult> {
  const visible = await unitsWherePermitted(db, userId, "AP.Review");
  const scopedUnits = await scopedToChosenOrg(db, visible, currentOrg);
  const clause = unitClause({ units: scopedUnits }, "h.org_unit_id");

  const since = filters.since ?? null;
  const supplierLike = filters.supplier ? `%${filters.supplier}%` : null;
  const stageIdsJson = filters.stageIds && filters.stageIds.length > 0 ? JSON.stringify(filters.stageIds) : null;

  // A stage filter is applied with EXISTS, never a JOIN — a JOIN
  // against process_instances would multiply a row for any invoice
  // that ever picked up more than one instance (nothing in this
  // schema actually forbids that; it just isn't meant to happen), and
  // this route's whole reason to exist is staying exactly right even
  // in a case as rare as that one. EXISTS cannot inflate the count or
  // the sum regardless.
  const stageFilterSql = `(?3 IS NULL OR EXISTS (
         SELECT 1 FROM process_instances i
         WHERE i.subject_type = 'invoice' AND i.subject_id = h.id
           AND i.current_stage_id IN (SELECT value FROM json_each(?3))
           AND i.status = 'in_progress'
       ))`;

  const countRow = await db
    .prepare(
      `SELECT count(*) AS n,
              SUM(CASE WHEN h.total_with_vat IS NULL OR h.currency IS NULL THEN 1 ELSE 0 END) AS unconfirmed
       FROM invoice_headers h
       LEFT JOIN suppliers sup ON sup.id = h.supplier_id
       WHERE (?1 IS NULL OR h.created_at >= ?1)
         AND (?2 IS NULL OR COALESCE(sup.name, json_extract(h.facts_json, '$."BT-27"')) LIKE ?2 COLLATE NOCASE)
         AND ${stageFilterSql}
         ${clause.sql}`
    )
    .bind(since, supplierLike, stageIdsJson, ...clause.binds)
    .first<{ n: number; unconfirmed: number | null }>();

  const totalRows = await db
    .prepare(
      `SELECT h.currency AS currency, SUM(h.total_with_vat) AS total
       FROM invoice_headers h
       LEFT JOIN suppliers sup ON sup.id = h.supplier_id
       WHERE (?1 IS NULL OR h.created_at >= ?1)
         AND (?2 IS NULL OR COALESCE(sup.name, json_extract(h.facts_json, '$."BT-27"')) LIKE ?2 COLLATE NOCASE)
         AND ${stageFilterSql}
         AND h.total_with_vat IS NOT NULL AND h.currency IS NOT NULL
         ${clause.sql}
       GROUP BY h.currency
       ORDER BY h.currency`
    )
    .bind(since, supplierLike, stageIdsJson, ...clause.binds)
    .all<{ currency: string; total: number }>();

  return {
    status: 200,
    body: {
      count: countRow?.n ?? 0,
      totalByCurrency: totalRows.results.map((r) => ({ currency: r.currency, total: r.total })),
      // SQLite's SUM over zero rows is NULL, not 0 — coerced here so
      // callers never have to handle a third possible value.
      unconfirmedCount: countRow?.unconfirmed ?? 0,
    } satisfies InvoiceCountReport,
  };
}
