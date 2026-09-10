import type { RouteResult } from "./examples-route.js";

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
  params: URLSearchParams
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
  const unit = params.get("unit");
  const limit = Math.min(Math.max(Number(params.get("limit") ?? "50") || 50, 1), 200);

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
       ORDER BY h.created_at DESC, h.rowid DESC
       LIMIT ?2`
    )
    .bind(unit, limit)
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
