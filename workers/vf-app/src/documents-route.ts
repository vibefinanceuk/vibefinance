import type { RouteResult } from "./examples-route.js";
import { mondayOfThisWeek } from "./dates.js";

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
 */
function statusOf(row: DocumentRow, facts: Record<string, unknown>): string {
  if (facts["intake.structure"] === "") return "unreadable";
  if (row.instance_status === "completed") return "done";
  if (row.current_stage_id === null) return "outside";
  return row.hands > 0 ? "waiting" : "moving";
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
  const query = (params.get("q") ?? "").trim().toLowerCase();

  /**
   * **Filtered in SQL, unlike the search** — decision 0193.
   *
   * The text search reads only what was loaded, because the facts live
   * in a JSON blob and `LIKE` would match a key as readily as a value.
   * A unit is a real column, so this narrows the query itself: a person
   * asking for France gets France's most recent, not France's share of
   * everybody's most recent.
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
  const limit = Math.min(Math.max(Number(params.get("limit") ?? "50") || 50, 1), 200);

  /**
   * **Two new filters, decision 0259** — for the dashboard's
   * *Unplaced Documents* and *Possible Duplicates* cards, each of
   * which now needs somewhere real to send a click.
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
   * **What I completed this week** — decision 0265, from the
   * dashboard's redefined "Done" card. Matched with the exact same
   * `mondayOfThisWeek()` the card's own query uses, so the two can
   * never quietly disagree about which day the week began.
   */
  const doneByMe = params.get("doneByMe") === "1";
  const monday = mondayOfThisWeek();

  /**
   * The sender and recipient come from the email that brought it —
   * decision 0147's log — because that is what a person searches by
   * when the supplier name was never extracted.
   *
   * Joined loosely: a document captured any other way has neither, and
   * that is a fact about it rather than a missing row.
   */
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
       FROM invoice_headers h
       LEFT JOIN process_instances i
         ON i.subject_type = 'invoice' AND i.subject_id = h.id
       LEFT JOIN process_stages s ON s.id = i.current_stage_id
       LEFT JOIN org_units ou ON ou.id = h.org_unit_id
       LEFT JOIN inbound_email_events e
         ON e.id = (SELECT e2.id FROM inbound_email_events e2
                    WHERE e2.outcome = 'captured' AND e2.occurred_at <= h.created_at
                    ORDER BY e2.occurred_at DESC LIMIT 1)
       WHERE (?1 IS NULL OR h.org_unit_id = ?1)
         AND (
           ?5 = 1
           OR (?3 = 0 OR h.org_unit_id IN (SELECT value FROM json_each(?4)))
         )
         AND (?5 = 0 OR (h.org_unit_id IS NULL AND json_extract(h.facts_json, '$."org.unplaced"') IS NOT NULL))
         AND (?6 = 0 OR CAST(json_extract(h.facts_json, '$."invoice.duplicate_confidence"') AS REAL) >= 0.5)
         AND (?7 IS NULL OR (i.current_stage_id = ?7 AND i.status = 'in_progress'))
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
       ORDER BY h.created_at DESC, h.rowid DESC
       LIMIT ?2`
    )
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
    .bind(
      unit,
      limit,
      visibleUnits === null ? 0 : 1,
      JSON.stringify(visibleUnits ?? []),
      unplacedOnly ? 1 : 0,
      duplicatesOnly ? 1 : 0,
      stageId,
      doneByMe ? 1 : 0,
      userId ?? "",
      monday
    )
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
   * Searched in the Worker rather than in SQL.
   *
   * **The facts live in a JSON blob**, so a supplier name is not a
   * column to match on — `LIKE` against `facts_json` would match the
   * key as readily as the value, and find `BT-27` in every row.
   *
   * That is a real limit: it searches only what was loaded. Recorded
   * rather than hidden behind a query that looks like it does more.
   */
  const matched = query
    ? documents.filter((d) =>
        [d.number, d.supplier, d.sender, d.amount === null ? null : String(d.amount)]
          .some((field) => field !== null && String(field).toLowerCase().includes(query))
      )
    : documents;

  return {
    status: 200,
    body: {
      documents: matched,
      // What was looked through, so a screen can say "50 of 512" rather
      // than implying it searched everything.
      searched: documents.length,
    },
  };
}
