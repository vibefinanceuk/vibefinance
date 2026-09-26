import type { RouteResult } from "./examples-route.js";
import { mondayOfThisWeek } from "./dates.js";
import { POSSIBLE_DUPLICATE_THRESHOLD } from "./invoice-history.js";

/**
 * Every document that has arrived — decision 0164.
 *
 * **The gap this fills.** Every way into a document was a task. An
 * invoice that went straight through has no task, so it was invisible —
 * correctly processed and unreachable. The system could only show the
 * documents that went *wrong*, which is the minority if the product
 * works.
 *
 * Found the day a photographed invoice was read automatically and
 * reached payment-eligible without a person: *"I have no way to query
 * or view that document."*
 */

interface DocumentRow {
  id: string;
  facts_json: string;
  created_at: string;
  current_stage_id: string | null;
  stage_name: string | null;
  org_unit_id: string | null;
  org_unit_name: string | null;
  instance_status: string | null;
  sender: string | null;
  recipient: string | null;
  hands: number;
}

/**
 * What a person calls the state of a document.
 *
 * **Not a column.** `process_instances.status`, a stage's position and
 * whether anything could be read are three facts; *"where does this
 * stand"* is one question.
 *
 * **`returned_manually` and `archived` fell through to "waiting"/
 * "moving" until decision 0501.** This function predates decision 0055's
 * two terminal statuses by many decisions and was never taught about
 * them — `current_stage_id` is deliberately left set to wherever the
 * instance was returned from (0055's own "instance status, not process
 * structure"), which is correct for the record but meant this list kept
 * showing a returned invoice as though it were still actively moving
 * through that stage. Reported live: "I placed the Return to Supplier
 * button... the item... appears to still be in the matching Matching
 * stage." Checked before fixing: `done` (`completed`) was deliberately
 * unaffected — a completed instance genuinely finished at its own final
 * stage, so showing that stage stands; only the two statuses that leave
 * an instance sitting at a stage it no longer belongs to needed a case.
 */
function statusOf(row: DocumentRow, facts: Record<string, unknown>): string {
  if (facts["intake.structure"] === "") return "unreadable";
  if (row.instance_status === "completed") return "done";
  if (row.instance_status === "returned_manually") return "returned";
  if (row.instance_status === "archived") return "archived";
  if (row.current_stage_id === null) return "outside";
  return row.hands > 0 ? "waiting" : "moving";
}

/**
 * Real, server-side search and pagination — decision 0448.
 *
 * **The search was never actually "not expressible in SQL" — only one
 * of its four fields was.** Decision 0446 grouped Documents with Tasks
 * as both needing "a full rebuild" before this could happen; checked
 * directly rather than assumed, that turned out to be true for Tasks
 * and only partly true here. `number` (`BT-1`) and `amount` (`BT-112`)
 * have carried real, kept-in-sync columns — `invoice_number`,
 * `total_with_vat` — since migrations 0007/0014, written on every
 * `handleUpsertInvoice` call alongside `facts_json`, never drifting
 * from it (`mergeStructuredInvoiceFacts()`'s own comment in
 * `invoice-facts-route.ts` states the invariant directly). `sender`
 * was never in `facts_json` at all — it is `inbound_email_events.
 * sender`, already a real, already-joined column. Only `supplier`
 * (`BT-27`) has no mirrored column, and this file already has the
 * exact fallback shape a search needs for it — `COALESCE(sup.name,
 * json_extract(h.facts_json, '$."BT-27"'), 'Unknown')`, used a few
 * lines below for `exceptionSupplier` — matched here (without the
 * `'Unknown'` default, which exists there only to give a *label* to
 * group by, not to search).
 *
 * **This file's own numbered-placeholder convention, not
 * `purchase-order-route.ts`'s repeated-bind one.** Every other
 * optional filter in this query is `(?N IS NULL OR ...)`, bound once
 * and left `NULL` to mean "skip" — carried through here rather than
 * switching to that file's own `{ sql: "", binds: [] }` shape, which
 * would read as a second convention living inside one query. A single
 * placeholder number is reused across all four `LIKE`s, since D1 binds
 * a numbered placeholder once no matter how many times its own number
 * appears in the statement.
 *
 * `%`, `_`, and `\` in the term itself are escaped, not read as SQL
 * wildcards — the same reasoning and the same escape
 * `purchase-order-route.ts`'s own `searchClause()` already applies.
 */
function documentSearchPattern(search: string | null): string | null {
  const term = search?.trim();
  if (!term) return null;
  return `%${term.replace(/[\\%_]/g, "\\$&")}%`;
}

/** Page sizes offered in the UI dropdown — anything else is rejected back to the default, the same list `purchase-order-route.ts` already offers. */
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

export async function handleListDocuments(
  db: D1Database,
  params: URLSearchParams,
  /**
   * Which units this person may see — decision 0199.
   *
   * `null` means everywhere, which is both somebody holding the
   * permission unscoped and a customer who has never scoped anything.
   * An **empty array means nowhere**, and is a real answer.
   *
   * Optional so that a caller which has not been taught about units
   * behaves as it always did — and every caller was taught with this,
   * because decision 0192's risk is that forgetting does not fail.
   */
  visibleUnits: string[] | null = null,
  /**
   * **Who is asking**, needed only for "completed by me this week" —
   * decision 0265. Optional and defaulted to `null` so every existing
   * caller behaves as it always did; the new filter is simply inert
   * without a real id to filter by.
   */
  userId: string | null = null
): Promise<RouteResult> {
  /**
   * **Filtered in SQL now too — decision 0448.** No longer lower-cased
   * here: SQLite's own `LIKE` is already case-insensitive over ASCII,
   * the same as every other search this codebase runs, and lower-casing
   * the term would do nothing but diverge from `documentSearchPattern()`'s
   * own escaping if the two ever disagreed about casing.
   */
  const query = (params.get("q") ?? "").trim();
  const searchPattern = documentSearchPattern(query);

  /**
   * **Real pagination, decision 0448 — but only when asked for.**
   * `documents.js`'s own screen now sends `page`/`pageSize`; the AP
   * Assistant's own `invoice_search` tool (`ap-assistant.ts`) does
   * not — it still sends only `limit` (1 for "the latest," 50
   * otherwise) and was never given page controls to move through, so
   * it keeps its own existing cost profile: one bounded fetch, no
   * second `count(*)` query, exactly as before. `total`/`page`/
   * `pageSize` are simply absent from the response when nobody asked
   * for them, rather than computed and then not returned.
   */
  const pageParam = params.get("page");
  const pageSizeParam = params.get("pageSize");
  const paginating = pageParam !== null || pageSizeParam !== null;
  const page = normalizePage(pageParam);
  const pageSize = normalizePageSize(pageSizeParam);
  const limit = paginating ? pageSize : Math.min(Math.max(Number(params.get("limit") ?? "50") || 50, 1), 200);
  const offset = paginating ? (page - 1) * pageSize : 0;

  /**
   * **Unit is still filtered in SQL, as it always was** — decision
   * 0193. A unit is a real column, so this narrows the query itself: a
   * person asking for France gets France's most recent, not France's
   * share of everybody's most recent.
   */
  /**
   * **A live defect, unrelated to decision 0259** — decision 0260.
   *
   * `documents.js` has always sent `unit=` explicitly, even when
   * nothing is selected — `new URLSearchParams({ q: query, unit })`
   * includes the key regardless of whether `unit` is an empty string.
   * `params.get("unit")` then returns `""`, not `null`.
   *
   * Bound straight into `(?1 IS NULL OR h.org_unit_id = ?1)`, an empty
   * string is not `NULL` and is not equal to any real unit id or to a
   * genuinely null column — **the clause matches nothing at all**,
   * for every visit to this screen with no unit chosen, which is every
   * visit before today nobody had a reason to look closely at.
   *
   * Every existing test built its request from a query string via
   * `new URLSearchParams("")`, which omits `unit` entirely and gets a
   * real `null` — a different construction from what the real
   * frontend sends, and exactly where the fault hid.
   */
  const unit = params.get("unit") || null;

  /**
   * **Two new filters, decision 0259** — for the dashboard's
   * *Unplaced Documents* and *Possible Duplicates* cards, each of
   * which now needs somewhere real to send a click.
   *
   * **`duplicatesOnly`'s own query read the wrong place — decision
   * 0411.** It matched `json_extract(h.facts_json,
   * '$."invoice.duplicate_confidence"')`, a key decision 0410 already
   * found is never written to stored `facts_json` — it's synthesised
   * only in memory, at read time, by a different route. This route
   * wasn't touched by 0410, so the click-through was still silently
   * broken after that fix: the dashboard tile counted correctly again,
   * but clicking through to Documents kept showing nothing. Reads
   * `h.duplicate_confidence` directly now, the same column 0410
   * pointed the tile's own count at.
   *
   * **`>= 0.5` lowered to `POSSIBLE_DUPLICATE_THRESHOLD` (`0.4`) —
   * decision 0463**, imported from `invoice-history.ts` rather than
   * stated again here — see that constant's own doc comment for why.
   */
  const unplacedOnly = params.get("unplaced") === "1";
  const duplicatesOnly = params.get("duplicates") === "1";

  /**
   * **A stage, for the dashboard's own "Where things are"** — decision
   * 0264. That card counts `process_instances` at a stage with
   * `status = 'in_progress'` (`whereThingsAre()` in
   * `dashboard-route.ts`), not tasks — one row per document, which is
   * exactly what this list already shows one row per. The same status
   * restriction is applied here, so a document whose instance finished
   * at this stage long ago (if `current_stage_id` is ever left set
   * after completion) cannot appear in a list the card's own count
   * would not have included.
   */
  const stageId = params.get("stage");

  /**
   * **Several stage ids at once, by name rather than by id** — decision
   * 0430's fourth addendum, for the AP Assistant's own `invoice_search`
   * tool answering "invoices at the Validation stage." A person says a
   * stage's own *name*, and `process_stages` is customer-configurable
   * (decision 0415's own reasoning) — the same name can genuinely exist
   * on more than one process, so resolving it can mean more than one
   * real stage id. `stage` above stays a single id, unchanged, because
   * the real Documents screen has always sent exactly one (its own
   * click always knows which); this is a second, separate, additive
   * parameter so that caller is never touched. Same `IN (SELECT value
   * FROM json_each(...))` shape decision 0259 already uses for
   * `visibleUnits` above, and the same `status = 'in_progress'`
   * restriction `stage` already applies — "held at" means currently
   * there, not merely having passed through once.
   */
  const stageIdsRaw = params.get("stageIds");

  /**
   * **What I completed this week** — decision 0265, from the
   * dashboard's redefined "Done" card. Matched with the exact same
   * `mondayOfThisWeek()` the card's own query uses, so the two can
   * never quietly disagree about which day the week began.
   */
  const doneByMe = params.get("doneByMe") === "1";
  const monday = mondayOfThisWeek();

  /**
   * **A supplier's own recent exceptions — decision 0411**, from the
   * dashboard's "Exceptions by Supplier" bar list.
   *
   * **The label is the filter**, matched against the exact expression
   * `exceptionsBySupplier()` (`dashboard-route.ts`) groups by —
   * `COALESCE(sup.name, BT-27, 'Unknown')` — rather than a supplier id
   * this card was never given. "Ask the click" (decision 0368): this
   * is the same 30-day, failed-validation condition that card counts,
   * not a second, separately-maintained definition of "an exception."
   */
  const exceptionSupplier = params.get("exceptionSupplier");

  /**
   * **One aging bucket's own open work — decision 0411**, from the
   * dashboard's "Task Aging Report" bars.
   *
   * **The boundaries travel from the click, not decided again here.**
   * `ageing()` (`dashboard-route.ts`) is the one place the five
   * buckets' day ranges are chosen; this route only ever applies
   * whatever range it is given. `agingMaxDays` absent (`null`) is the
   * open-ended top of the last bucket.
   */
  const agingMinDaysRaw = params.get("agingMinDays");
  const agingMinDays = agingMinDaysRaw === null ? null : Number(agingMinDaysRaw);
  const agingMaxDaysRaw = params.get("agingMaxDays");
  const agingMaxDays = agingMaxDaysRaw === null ? null : Number(agingMaxDaysRaw);

  /**
   * **When it entered the system, at the earliest** — decision 0430's
   * second addendum, for the AP Assistant's own `invoice_search` tool
   * answering "received this month" (`firstOfThisMonth()`,
   * `dates.ts`). No screen sends this yet; it is simply inert without
   * a real value, the same "add now, wire it in when something needs
   * it" shape as every other optional filter above.
   */
  const since = params.get("since");

  /**
   * The sender and recipient come from the email that brought it —
   * decision 0147's log — because that is what a person searches by
   * when the supplier name was never extracted.
   *
   * Joined loosely: a document captured any other way has neither, and
   * that is a fact about it rather than a missing row.
   */
  const joins = `FROM invoice_headers h
       LEFT JOIN process_instances i
         ON i.subject_type = 'invoice' AND i.subject_id = h.id
       LEFT JOIN process_stages s ON s.id = i.current_stage_id
       LEFT JOIN org_units ou ON ou.id = h.org_unit_id
       LEFT JOIN suppliers sup ON sup.id = h.supplier_id
       LEFT JOIN inbound_email_events e
         ON e.id = (SELECT e2.id FROM inbound_email_events e2
                    WHERE e2.outcome = 'captured' AND e2.occurred_at <= h.created_at
                    ORDER BY e2.occurred_at DESC LIMIT 1)`;

  /**
   * **One `WHERE`, shared by the count and the page** — decision 0448,
   * the same "narrow, then count, then page, with the identical clause
   * both times" shape `purchase-order-route.ts`'s own
   * `handleListPurchaseOrders` established. Extracted to a constant
   * specifically so the two queries below cannot quietly drift apart —
   * a `total` computed against a different `WHERE` than the page itself
   * used would be a real, silent bug, not a cosmetic one.
   *
   * `?16` is the new search pattern (see `documentSearchPattern()`
   * above) — appended last, after every pre-existing filter, so every
   * `?N` below it keeps the exact number it already had.
   */
  const whereClause = `WHERE (?1 IS NULL OR h.org_unit_id = ?1)
         AND (
           ?5 = 1
           OR (?3 = 0 OR h.org_unit_id IN (SELECT value FROM json_each(?4)))
         )
         AND (?5 = 0 OR (h.org_unit_id IS NULL AND json_extract(h.facts_json, '$."org.unplaced"') IS NOT NULL))
         AND (?6 = 0 OR h.duplicate_confidence >= ${POSSIBLE_DUPLICATE_THRESHOLD})
         AND (?7 IS NULL OR (i.current_stage_id = ?7 AND i.status = 'in_progress'))
         AND (?15 IS NULL OR (i.current_stage_id IN (SELECT value FROM json_each(?15)) AND i.status = 'in_progress'))
         AND (
           ?8 = 0
           OR EXISTS (
             SELECT 1 FROM tasks dt
             JOIN stage_visits dv ON dv.id = dt.stage_visit_id
             WHERE dv.process_instance_id = i.id
               AND dt.completed_by = ?9
               AND date(dt.completed_at) >= ?10
           )
         )
         AND (
           ?11 IS NULL
           OR (
             COALESCE(sup.name, json_extract(h.facts_json, '$."BT-27"'), 'Unknown') = ?11
             AND EXISTS (
               SELECT 1 FROM stage_visits ev
               WHERE ev.process_instance_id = i.id
                 AND ev.validation_passed = 0
                 AND julianday('now') - julianday(ev.created_at) < 30
             )
           )
         )
         AND (
           ?12 IS NULL
           OR EXISTS (
             SELECT 1 FROM tasks at2
             JOIN stage_visits av ON av.id = at2.stage_visit_id
             WHERE av.process_instance_id = i.id
               AND at2.status = 'open'
               AND julianday('now') - julianday(at2.created_at) >= ?12
               AND (?13 IS NULL OR julianday('now') - julianday(at2.created_at) < ?13)
           )
         )
         AND (?14 IS NULL OR h.created_at >= ?14)
         AND (
           ?16 IS NULL
           OR (
             h.invoice_number LIKE ?16 ESCAPE '\\'
             OR CAST(h.total_with_vat AS TEXT) LIKE ?16 ESCAPE '\\'
             OR e.sender LIKE ?16 ESCAPE '\\'
             OR COALESCE(sup.name, json_extract(h.facts_json, '$."BT-27"')) LIKE ?16 ESCAPE '\\'
           )
         )`;

  /**
   * **A document with no unit is nobody's, unless somebody asked for
   * exactly that** — decision 0199, carved out by decision 0259.
   *
   * 0199's policy is right for ordinary browsing: a person restricted
   * to France should not see an unassigned document that might turn
   * out to be Germany's. But *"unplaced"* is not ordinary browsing —
   * it is the alert this same policy would otherwise hide from
   * everyone who could act on it, which is decision 0255's argument
   * in `dashboard-route.ts`'s `unplacedDocuments()`: an unplaced
   * document is not a secret from anyone, because somebody has to
   * notice it before it can be placed at all.
   *
   * Without `?5` bypassing the visibility clause here, the dashboard
   * card and this list would disagree for every scoped person on
   * earth — the card built from `unplacedDocuments()`'s unscoped
   * count, and the click landing on a list that the ordinary
   * visibility rule had just emptied to zero. Found by tracing the
   * click through rather than wiring it and trusting it.
   *
   * **And the filter matches `unplacedDocuments()`'s exact
   * definition**, not just "has no unit" — a document can have no
   * unit for reasons that are not the one this card is about (nobody
   * has run org-derivation on it yet, say), and only a null unit
   * *paired with the recorded failure reason* is what the count on
   * the card actually means. The first version of this checked the
   * unit alone and a test caught it: a document nobody had assigned
   * for any reason showed up under "unplaced" when it should not
   * have, over-counting in the list relative to what the card claims.
   */
  /**
   * **All sixteen positions, `?1` through `?16`, every time — even
   * `?2` (`limit`) here, which the count query's own text below never
   * mentions.** Numbered placeholders can have holes (SQLite allows
   * `?1`/`?3` with no `?2` in the text at all), but `.bind()` still
   * fills array position *N* into parameter index *N+1* — the
   * statement's own highest referenced index (16, from `?16`) is what
   * has to be satisfied, not which of the sixteen the text happens to
   * use. Leaving `limit` out of this array to match the count query's
   * own unused `?2` would shift every value after it by one index and
   * silently rebind the wrong filter to the wrong condition — this
   * exact array, unchanged, is what keeps both queries honest.
   */
  const whereBinds = [
    unit,
    limit,
    visibleUnits === null ? 0 : 1,
    JSON.stringify(visibleUnits ?? []),
    unplacedOnly ? 1 : 0,
    duplicatesOnly ? 1 : 0,
    stageId,
    doneByMe ? 1 : 0,
    userId ?? "",
    monday,
    exceptionSupplier,
    agingMinDays,
    agingMaxDays,
    since,
    stageIdsRaw,
    searchPattern,
  ] as const;

  /**
   * **`total`, only when a page was actually asked for.** A second,
   * real `count(*)` query against the identical `WHERE` — matching
   * `purchase-order-route.ts`'s own reasoning: a page of 50 rows says
   * nothing about how many exist in total. Skipped entirely for
   * `invoice_search`'s own `limit`-only calls, which have never needed
   * a total and would otherwise pay for one on every question asked.
   * No `hands` subquery, no `ou`/`s` name joins in the `SELECT` — the
   * count only needs whatever the `WHERE` itself reads.
   */
  const totalRow = paginating
    ? await db
        .prepare(`SELECT count(*) AS n ${joins} ${whereClause}`)
        .bind(...whereBinds)
        .first<{ n: number }>()
    : null;

  const rows = await db
    .prepare(
      `SELECT h.id, h.facts_json, h.created_at,
              i.current_stage_id, i.status AS instance_status,
              s.name AS stage_name,
              h.org_unit_id, ou.name AS org_unit_name,
              e.sender, e.recipient,
              (SELECT count(*) FROM tasks t
                 JOIN stage_visits v ON v.id = t.stage_visit_id
               WHERE v.process_instance_id = i.id) AS hands
       ${joins}
       ${whereClause}
       ORDER BY h.created_at DESC, h.rowid DESC
       LIMIT ?2 OFFSET ?17`
    )
    .bind(...whereBinds, offset)
    .all<DocumentRow>();

  const documents = rows.results.map((row) => {
    let facts: Record<string, unknown> = {};
    try {
      facts = JSON.parse(row.facts_json) as Record<string, unknown>;
    } catch {
      // A document whose facts will not parse is a document with none.
    }

    return {
      id: row.id,
      // **The supplier's own number**, which is what a person quotes
      // down a telephone. Null where nothing could be read.
      number: (facts["BT-1"] as string) ?? null,
      typeCode: (facts["BT-3"] as string) ?? null,
      supplier: (facts["BT-27"] as string) ?? null,
      amount: (facts["BT-112"] as number) ?? null,
      currency: (facts["BT-5"] as string) ?? null,
      issueDate: (facts["BT-2"] as string) ?? null,
      dueDate: (facts["BT-9"] as string) ?? null,
      receivedAt: row.created_at,
      sender: row.sender,
      recipient: row.recipient,
      /**
       * Which part of the business this belongs to — decision 0193.
       *
       * `invoice_headers.org_unit_id` has existed since decision 0036
       * and **no screen has ever shown it**. So a customer with France,
       * Germany and UK sees one undifferentiated list, and cannot tell
       * which invoices are theirs to care about.
       *
       * **Shown, not enforced.** This is a label a person can read and
       * filter by; it is not a boundary, and everybody still sees
       * everything (decision 0192 records what making it a boundary
       * would take).
       */
      orgUnitId: row.org_unit_id,
      orgUnitName: row.org_unit_name,
      stageId: row.current_stage_id,
      stageName: row.stage_name,
      status: statusOf(row, facts),
      /**
       * **How many people touched it.** *"Straight through"* is the
       * product's own claim and nothing anywhere counted it.
       */
      hands: row.hands,
    };
  });

  /**
   * **No longer filtered here — decision 0448.** The rows above are
   * already exactly the matching set, filtered in SQL by
   * `documentSearchPattern()`, appended into `whereClause`. `matched`
   * used to be the JS-side narrowing of whatever the `LIMIT` had
   * already loaded; now `rows` itself is the narrowing, so there is
   * nothing left to filter twice.
   *
   * `searched` stays in the response, kept for the one caller that
   * still reads a stable shape without reading this field itself —
   * `ap-assistant.ts`'s own `runInvoiceSearch` types it through but
   * never uses it. Its meaning has changed with the fix it reports:
   * it used to mean "how many rows were loaded before filtering,"
   * honestly admitting the search might have missed a match past the
   * load window; now that the search runs inside the same query that
   * enforces `LIMIT`, there is no window it could have missed within
   * — `documents.length` and "how many matched" are the same number.
   */
  return {
    status: 200,
    body: {
      documents,
      searched: documents.length,
      // Only when a page was actually asked for — see `paginating` above.
      ...(paginating ? { total: totalRow?.n ?? 0, page, pageSize } : {}),
    },
  };
}
