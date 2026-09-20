import { unitsWherePermitted, scopedToChosenOrg, unitClause, type Scope } from "./enforce.js";
import type { RouteResult } from "./org-route.js";
import { handleListMyTasks } from "./task-list-route.js";
import { mondayOfThisWeek } from "./dates.js";

/**
 * What a person should do next — decision 0240.
 *
 * **Every count here is a disclosure.** Decision 0202 made the task
 * list unit-aware so a German validator is not shown French work, and
 * *"47 items in Approval"* tells somebody there are 47 invoices they may
 * not be allowed to see.
 *
 * So the filter is computed **once** and threaded into every query,
 * rather than each card remembering — decision 0239 called that the
 * part most likely to be got wrong, *"because a count feels like less
 * than a list."*
 */

/**
 * **An instance that has not finished** — decision 0241.
 *
 * `'in_progress'`, from migration 0009's own default. Two cards were
 * written against `'active'`, which is not a value this system ever
 * writes, and **returned nothing while three tasks sat open** — a
 * count of zero being indistinguishable from a quiet queue.
 *
 * Named once so the next card cannot get it wrong differently.
 */
const IN_FLIGHT = "'in_progress'";

/** The closed set. Migration 0057 names the same list, and a test agrees them. */
export const CARD_TYPES = [
  "waiting_for_me",
  "on_my_clock",
  "items_at_stage",
  "where_things_are",
  "done",
  "ageing",
  "exceptions_by_supplier",
  "unplaced_documents",
  "suppliers_awaiting_erp",
  "possible_duplicates",
  "received",
] as const;

export type CardType = (typeof CARD_TYPES)[number];

/**
 * **What a new person sees**, in code rather than in the migration.
 *
 * A default belongs where it can change with the card types. Seeding
 * one per existing user would freeze today's idea of a good dashboard
 * into every account.
 */
export const DEFAULT_CARDS: { cardType: CardType; settings: Record<string, unknown> }[] = [
  { cardType: "waiting_for_me", settings: {} },
  { cardType: "on_my_clock", settings: { sort: "held" } },
  { cardType: "where_things_are", settings: {} },
  { cardType: "ageing", settings: {} },
  { cardType: "done", settings: {} },
  { cardType: "unplaced_documents", settings: {} },
  { cardType: "suppliers_awaiting_erp", settings: {} },
  { cardType: "possible_duplicates", settings: {} },
];

/**
 * Which units this person may see work in — moved to `enforce.ts`
 * (decision 0358), imported at the top of this file. `unitClause`
 * moved there too: reading suppliers now needs the identical logic,
 * and duplicating it risked the "unassigned stays visible" exception
 * drifting apart between two copies over time.
 */

async function scopeFor(
  db: D1Database,
  userId: string,
  currentOrg: string | null = null,
  permission: "AP.Review" | "AP.Supplier" = "AP.Review"
): Promise<Scope> {
  const held = await unitsWherePermitted(db, userId, permission);

  /**
   * **`held` is already walked downward** — a role at Acme UK covers
   * every unit beneath it, since `unitsWherePermitted` itself does
   * that walk before returning.
   *
   * **Narrowed further to the chosen org, decision 0316** — the same
   * treatment decisions 0314 and 0315 already gave Tasks and
   * Documents, applied here through the one place every card's own
   * query already reads its scope from, rather than threading a
   * second parameter through eleven separate functions.
   *
   * **A second permission, decision 0358.** Every other card's own
   * work is `AP.Review`'s own concern; a supplier's own visibility
   * has always been a different, separate permission (`AP.Supplier`,
   * decision 0276), so its own card needs its own scope computed
   * against the right one — reusing this same function rather than
   * a second, near-identical copy of it.
   */
  const scoped = await scopedToChosenOrg(db, held, currentOrg);
  return { units: scoped };
}

export interface Card {
  id: string;
  cardType: CardType;
  settings: Record<string, unknown>;
  position: number;
  /** Whatever the type produces. Null where the query failed. */
  data: unknown;
}

/**
 * **Work a person may act on**, counted.
 *
 * Assigned to them, claimed by them, or owned by a team they are in —
 * the third being *available* rather than *mine* (decision 0180), which
 * is why `on_my_clock` counts differently.
 */
/**
 * **Asks the click, decision 0368** — reported live: "the count on
 * the dashboard does not reflect the count when clicking on the
 * card. Waiting for me, shows 11 items across 4 stages. If I click on
 * the card it shows 5 items across three stages."
 *
 * `handleListMyTasks()` — the route this card's own click opens —
 * filters by each task's own required permission, walked up its
 * document's org-unit lineage (decision 0202), and separately by
 * whichever org is currently chosen (decision 0314). This card's own,
 * separate SQL query did neither: it counted every task the person
 * owned, had claimed, or whose team they were on, with no check at
 * all for whether they currently held the permission that specific
 * task actually required — so a person whose role had narrowed since
 * a task was assigned could see it counted here and correctly hidden
 * there.
 *
 * **The exact class of bug `items_at_stage` already found and fixed
 * this same way, four times over** (decisions 0252 through 0255),
 * whose own record already named it directly: "Two queries for one
 * question will drift, and the only way a card can promise to say
 * what its click shows is to ask the click."
 */
async function waitingForMe(db: D1Database, userId: string, currentOrg: string | null) {
  const listed = (
    await handleListMyTasks(db, userId, { ownership: "mine", limit: 1000, currentOrgUnitId: currentOrg })
  ).body as {
    tasks: { stageId: string; stageName: string | null }[];
    counts: { mine: number };
  };

  const byStageMap = new Map<string, { stage_id: string; stage_name: string; n: number }>();
  for (const task of listed.tasks) {
    const existing = byStageMap.get(task.stageId);
    if (existing) existing.n += 1;
    else byStageMap.set(task.stageId, { stage_id: task.stageId, stage_name: task.stageName ?? "—", n: 1 });
  }

  /**
   * **Ordered by the stage's own sequence**, the same convention
   * `whereThingsAre()` already established for "count by stage."
   * `handleListMyTasks()` orders its own rows by creation time, not
   * by stage, so the order to display this breakdown in is asked for
   * separately, against only the handful of stages actually present.
   */
  let byStage = [...byStageMap.values()];
  if (byStage.length > 0) {
    const placeholders = byStage.map(() => "?").join(", ");
    const sequences = await db
      .prepare(`SELECT id, sequence FROM process_stages WHERE id IN (${placeholders})`)
      .bind(...byStage.map((s) => s.stage_id))
      .all<{ id: string; sequence: number }>();
    const sequenceOf = new Map(sequences.results.map((s) => [s.id, s.sequence]));
    byStage = byStage.sort(
      (a, b) => (sequenceOf.get(a.stage_id) ?? Infinity) - (sequenceOf.get(b.stage_id) ?? Infinity)
    );
  }

  return { count: listed.counts.mine, stages: byStage.length, byStage };
}

/**
 * **On my clock** — decision 0239.
 *
 * Assigned to me or claimed by me, and **not a team queue**: decision
 * 0180 separated owner from claimer for this reason, and a team queue is
 * work nobody has taken. Putting it on somebody's clock would make every
 * member responsible for all of it.
 *
 * **Two clocks, both shown.** How long I have held it is my
 * responsiveness; `BT-9` is the supplier's expectation, and they
 * disagree routinely — an item held two days and due tomorrow is urgent
 * where one held thirty days and due next month is not yet costly.
 */
async function onMyClock(
  db: D1Database,
  userId: string,
  scope: Scope,
  settings: Record<string, unknown>
) {
  const clause = unitClause(scope, "h.org_unit_id");

  const order =
    settings.sort === "due"
      ? "due_date IS NULL, due_date ASC"
      : settings.sort === "value"
        ? "h.total_with_vat DESC"
        : "t.created_at ASC";

  const rows = await db
    .prepare(
      `SELECT t.id, t.stage_id, t.created_at, t.claimed_at,
              s.name AS stage_name,
              h.id AS invoice_id, h.total_with_vat, h.currency,
              json_extract(h.facts_json, '$."BT-1"') AS invoice_number,
              json_extract(h.facts_json, '$."BT-9"') AS due_date,
              COALESCE(sup.name, json_extract(h.facts_json, '$."BT-27"')) AS supplier_name
       FROM tasks t
       LEFT JOIN process_stages s ON s.id = t.stage_id
       LEFT JOIN stage_visits v ON v.id = t.stage_visit_id
       LEFT JOIN process_instances pi ON pi.id = v.process_instance_id
       LEFT JOIN invoice_headers h ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
       LEFT JOIN suppliers sup ON sup.id = h.supplier_id
       WHERE t.status = 'open'
         AND (t.owner_user_id = ?1 OR t.claimed_by = ?1)${clause.sql}
       ORDER BY ${order}
       LIMIT 25`
    )
    .bind(userId, ...clause.binds)
    .all<Record<string, unknown>>();

  return { items: rows.results };
}

/**
 * **Count by stage**, which is the parameterised card's un-parameterised
 * sibling: it names no stage and so cannot go stale (decision 0239).
 */
async function whereThingsAre(db: D1Database, scope: Scope) {
  const clause = unitClause(scope, "h.org_unit_id");

  const rows = await db
    .prepare(
      `SELECT s.id AS stage_id, s.name AS stage_name, s.sequence, count(*) AS n
       FROM process_instances pi
       JOIN process_stages s ON s.id = pi.current_stage_id
       LEFT JOIN invoice_headers h ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
       WHERE pi.status = ${IN_FLIGHT}${clause.sql}
       GROUP BY s.id
       ORDER BY s.sequence`
    )
    .bind(...clause.binds)
    .all<{ stage_id: string; stage_name: string; n: number }>();

  return { stages: rows.results };
}

/** One stage, named in the card's own settings. */
async function itemsAtStage(
  db: D1Database,
  userId: string,
  settings: Record<string, unknown>
) {
  const stageId = typeof settings.stage === "string" ? settings.stage : null;
  if (!stageId) return { count: 0, stageName: null, unconfigured: true };

  /**
   * **Does the stage exist**, asked of the stage (decision 0251). A
   * stage with nothing in it is not a deleted one.
   */
  const stage = await db
    .prepare("SELECT id, name FROM process_stages WHERE id = ?")
    .bind(stageId)
    .first<{ id: string; name: string }>();

  if (!stage) {
    return {
      count: 0,
      stageId,
      stageName: null,
      missing: true,
      held: { mine: 0, theirs: 0, unclaimed: 0 },
    };
  }

  /**
   * **The card is the list, counted** — decision 0255.
   *
   * Four records in two days (0252, 0253, 0254, and this one) each
   * found the card's own query disagreeing with the task list it links
   * to — a multiplication, a stage column, an idle instance, a missing
   * visit, and finally a scope keyed on `AP.Review` where the list keys
   * on **each task's own permission.**
   *
   * Every one was a real fault, and none was the last. **Two queries
   * for one question will drift**, and the only way a card can promise
   * to say what its click shows is to ask the click.
   *
   * So this calls `handleListMyTasks` — the route the card opens — and
   * counts what came back. Slower than a `count(*)`, and correct by
   * construction rather than by four rounds of repair.
   *
   * The names are the list's own: `mine`, `available` (nobody's — a
   * team queue), and `locked` (somebody else's). The card called the
   * last two *unclaimed* and *taken*, and keeps those words on screen.
   */
  const listed = (await handleListMyTasks(db, userId, { stageId, limit: 1000 })).body as {
    counts: { mine: number; available: number; locked: number };
  };

  const mine = listed.counts.mine;
  const unclaimed = listed.counts.available;
  const theirs = listed.counts.locked;

  return {
    count: mine + theirs + unclaimed,
    stageId,
    stageName: stage.name,
    missing: false,
    held: { mine, theirs, unclaimed },
  };
}

/** How long things have waited, in buckets rather than an average. */
async function ageing(db: D1Database, scope: Scope) {
  const clause = unitClause(scope, "h.org_unit_id");

  const row = await db
    .prepare(
      `SELECT
         sum(CASE WHEN julianday('now') - julianday(t.created_at) < 1 THEN 1 ELSE 0 END) AS d0,
         sum(CASE WHEN julianday('now') - julianday(t.created_at) >= 1
                   AND julianday('now') - julianday(t.created_at) < 4 THEN 1 ELSE 0 END) AS d1,
         sum(CASE WHEN julianday('now') - julianday(t.created_at) >= 4
                   AND julianday('now') - julianday(t.created_at) < 8 THEN 1 ELSE 0 END) AS d4,
         sum(CASE WHEN julianday('now') - julianday(t.created_at) >= 8
                   AND julianday('now') - julianday(t.created_at) < 31 THEN 1 ELSE 0 END) AS d8,
         sum(CASE WHEN julianday('now') - julianday(t.created_at) >= 31 THEN 1 ELSE 0 END) AS d31
       FROM tasks t
       LEFT JOIN stage_visits v ON v.id = t.stage_visit_id
       LEFT JOIN process_instances pi ON pi.id = v.process_instance_id
       LEFT JOIN invoice_headers h ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
       WHERE t.status = 'open'${clause.sql}`
    )
    .bind(...clause.binds)
    .first<Record<string, number>>();

  /**
   * **Buckets, not an average.** An average of 3 days hides one item
   * from August, and the one from August is the story — decision 0239's
   * argument for showing age at all.
   *
   * **`minDays`/`maxDays` travel with each bucket now** — decision
   * 0411, for the click each bucket gained through to the Documents
   * screen. The boundaries here are the only place they are decided;
   * carrying them out to the client, rather than making
   * `documents-route.ts` (or `dashboard.js`) guess the same five
   * numbers a second time, is what keeps a click from being able to
   * drift from the count beside it — the exact failure class decision
   * 0368 already named once for a different card. `maxDays: null`
   * means unbounded, the open top of the last bucket.
   */
  return {
    buckets: [
      { label: "<1d", n: row?.d0 ?? 0, minDays: 0, maxDays: 1 },
      { label: "1–3d", n: row?.d1 ?? 0, minDays: 1, maxDays: 4 },
      { label: "4–7d", n: row?.d4 ?? 0, minDays: 4, maxDays: 8 },
      { label: "8–30d", n: row?.d8 ?? 0, minDays: 8, maxDays: 31 },
      { label: "30d+", n: row?.d31 ?? 0, minDays: 31, maxDays: null },
    ],
  };
}

/**
 * **What I have personally acted on this week** — decision 0265,
 * redefined from a three-number split (today / anyone this week / me
 * this week) at the operator's own request: *"a daily count of items I
 * have acted upon."*
 *
 * **Scoped to `completed_by = userId` alone**, not to anyone else's
 * completions — which is what makes this card, unlike "Where things
 * are," able to link straight to the existing Tasks-is-mine-only
 * infrastructure without hitting the wall decision 0264 found: the
 * card was never about the team's work in the first place.
 */
async function done(db: D1Database, userId: string, scope: Scope) {
  const clause = unitClause(scope, "h.org_unit_id");
  const monday = mondayOfThisWeek();

  const rows = await db
    .prepare(
      `SELECT date(t.completed_at) AS day, count(*) AS n
       FROM tasks t
       LEFT JOIN stage_visits v ON v.id = t.stage_visit_id
       LEFT JOIN process_instances pi ON pi.id = v.process_instance_id
       LEFT JOIN invoice_headers h ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
       WHERE t.completed_by = ?1
         AND date(t.completed_at) >= ?2${clause.sql}
       GROUP BY date(t.completed_at)`
    )
    .bind(userId, monday, ...clause.binds)
    .all<{ day: string; n: number }>();

  /**
   * **Seven entries, Monday through Sunday, gaps filled with zero** —
   * the same discipline decision 0257 applied to the rolling-week
   * sparkline this replaces. `days.results` only has a row for a day
   * with at least one completion; a person who did nothing on Tuesday
   * should see a zero under Tuesday, not a Tuesday that silently is
   * not there.
   */
  const byDay = new Map(rows.results.map((r) => [r.day, r.n]));
  const mondayDate = new Date(`${monday}T00:00:00Z`);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mondayDate);
    d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    return { date: iso, n: byDay.get(iso) ?? 0 };
  });

  return {
    days,
    total: days.reduce((sum, d) => sum + d.n, 0),
  };
}

/** Invoices in, by day, for the last week. */
async function received(db: D1Database, scope: Scope) {
  const clause = unitClause(scope, "h.org_unit_id");

  const rows = await db
    .prepare(
      `SELECT date(h.created_at) AS day, count(*) AS n
       FROM invoice_headers h
       WHERE julianday('now') - julianday(h.created_at) < 7${clause.sql}
       GROUP BY date(h.created_at)
       ORDER BY day`
    )
    .bind(...clause.binds)
    .all<{ day: string; n: number }>();

  return { days: rows.results };
}

/**
 * **Which suppliers send invoices that need work** — decision 0239
 * preferred this to *most common exception by country*, on the grounds
 * that a supplier is actionable and a country is not.
 */
async function exceptionsBySupplier(db: D1Database, scope: Scope) {
  const clause = unitClause(scope, "h.org_unit_id");

  const rows = await db
    .prepare(
      `SELECT COALESCE(sup.name, json_extract(h.facts_json, '$."BT-27"'), 'Unknown') AS supplier,
              count(*) AS n
       FROM stage_visits v
       JOIN process_instances pi ON pi.id = v.process_instance_id
       JOIN invoice_headers h ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
       LEFT JOIN suppliers sup ON sup.id = h.supplier_id
       WHERE v.validation_passed = 0
         AND julianday('now') - julianday(v.created_at) < 30${clause.sql}
       GROUP BY supplier
       ORDER BY n DESC
       LIMIT 6`
    )
    .bind(...clause.binds)
    .all<{ supplier: string; n: number }>();

  return { suppliers: rows.results };
}

/**
 * **Things nothing else surfaces** — decision 0239, split into three
 * cards at decision 0259's asking.
 *
 * Each of these is a fact this system records and, until now, no
 * screen read: an unplaced document (decision 0204), a supplier
 * awaiting the ERP (decision 0231), and a duplicate suspicion
 * (decision 0028). One combined card said all three; the operator
 * asked for one each, with something to click through to — which a
 * combined count could never honestly offer, since a click needs to
 * land on one kind of thing, not three.
 */
async function unplacedDocuments(db: D1Database) {
  /**
   * **No scope clause, deliberately** — decision 0255 made
   * `unitClause` treat a null unit as visible to everyone, because a
   * document belonging to nowhere is not a secret from anyone. Adding
   * the clause here would be a no-op given that fix, so it is left off
   * rather than written and not exercised.
   */
  const row = await db
    .prepare(
      `SELECT count(*) AS n FROM invoice_headers h
       WHERE h.org_unit_id IS NULL
         AND json_extract(h.facts_json, '$."org.unplaced"') IS NOT NULL`
    )
    .first<{ n: number }>();

  return { count: row?.n ?? 0 };
}

/**
 * **Scoped, decision 0358** — reported live alongside the suppliers
 * screen itself: "We also have a supplier card on the Dashboard,
 * which I think should be filtered by org." Every other card already
 * threads `scope` through; this one and `unplacedDocuments` were the
 * two that did not. `unplacedDocuments` stays as it is — a document
 * with no unit at all is unscopable by definition, the whole reason
 * `unitClause` treats a null unit as visible to everyone. A supplier
 * is different: it can genuinely have a real `org_unit_id` now, so
 * counting it without applying scope was a real gap, not a deliberate
 * design the way the other one is.
 */
async function suppliersAwaitingErp(db: D1Database, scope: Scope) {
  const clause = unitClause(scope, "org_unit_id");
  const row = await db
    .prepare(
      `SELECT count(*) AS n FROM suppliers WHERE status = 'active' AND erp_identifier IS NULL ${clause.sql}`
    )
    .bind(...clause.binds)
    .first<{ n: number }>();

  return { count: row?.n ?? 0 };
}

async function possibleDuplicates(db: D1Database, scope: Scope) {
  const clause = unitClause(scope, "h.org_unit_id");

  /**
   * **Read the column, not a `facts_json` key nothing ever writes** —
   * decision 0410. `mergeStructuredInvoiceFacts()` (`invoice-facts-
   * route.ts`) synthesises `"invoice.duplicate_confidence"` from this
   * same column, but only in memory, for other routes to read
   * (`index.ts`) — it is never merged back into the stored `facts_json`
   * itself. This query used to read that never-written key via
   * `json_extract`, so it read NULL and counted zero for every
   * invoice, regardless of what its own `duplicate_confidence` column
   * actually held.
   */
  const row = await db
    .prepare(
      `SELECT count(*) AS n FROM invoice_headers h
       WHERE h.duplicate_confidence >= 0.5
         ${clause.sql}`
    )
    .bind(...clause.binds)
    .first<{ n: number }>();

  return { count: row?.n ?? 0 };
}

/**
 * Every card a person has, with its data — decision 0240.
 *
 * **One route rather than one per card**, so the scope is computed once
 * and a dashboard is one round trip rather than nine.
 */
export async function handleDashboard(
  db: D1Database,
  userId: string,
  currentOrg: string | null = null
): Promise<RouteResult> {
  const scope = await scopeFor(db, userId, currentOrg);
  const supplierScope = await scopeFor(db, userId, currentOrg, "AP.Supplier");

  const stored = await db
    .prepare(
      "SELECT id, card_type, settings_json, position FROM dashboard_cards WHERE user_id = ? ORDER BY position"
    )
    .bind(userId)
    .all<{ id: string; card_type: string; settings_json: string; position: number }>();

  /**
   * **A person with no dashboard gets the default**, and it is not
   * written to the database: somebody who has never opened this should
   * not have yesterday's idea of a good dashboard frozen into their
   * account before they have seen it.
   */
  const chosen =
    stored.results.length > 0
      ? stored.results.map((r) => ({
          id: r.id,
          cardType: r.card_type as CardType,
          settings: safeJson(r.settings_json),
          position: r.position,
        }))
      : DEFAULT_CARDS.map((c, i) => ({
          id: `default:${i}`,
          cardType: c.cardType,
          settings: c.settings,
          position: i,
        }));

  const cards: Card[] = [];

  for (const card of chosen) {
    /**
     * **One card failing is not the dashboard failing.** A query that
     * throws — a stage removed mid-flight, a fact that will not parse —
     * leaves that card empty and the rest standing.
     */
    let data: unknown = null;
    try {
      data = await runCard(db, userId, scope, supplierScope, currentOrg, card.cardType, card.settings);
    } catch {
      data = null;
    }
    cards.push({ ...card, data });
  }

  return { status: 200, body: { cards, usingDefault: stored.results.length === 0 } };
}

async function runCard(
  db: D1Database,
  userId: string,
  scope: Scope,
  supplierScope: Scope,
  currentOrg: string | null,
  type: CardType,
  settings: Record<string, unknown>
): Promise<unknown> {
  switch (type) {
    case "waiting_for_me":
      return waitingForMe(db, userId, currentOrg);
    case "on_my_clock":
      return onMyClock(db, userId, scope, settings);
    case "where_things_are":
      return whereThingsAre(db, scope);
    case "items_at_stage":
      return itemsAtStage(db, userId, settings);
    case "ageing":
      return ageing(db, scope);
    case "done":
      return done(db, userId, scope);
    case "received":
      return received(db, scope);
    case "exceptions_by_supplier":
      return exceptionsBySupplier(db, scope);
    case "unplaced_documents":
      return unplacedDocuments(db);
    case "suppliers_awaiting_erp":
      return suppliersAwaitingErp(db, supplierScope);
    case "possible_duplicates":
      return possibleDuplicates(db, scope);
  }
}

function safeJson(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    // Migration 0056 refuses invalid JSON; this is the belt to that
    // brace, and an empty object is a card with no settings rather than
    // a card that throws.
    return {};
  }
}

/**
 * What a person may choose from — decision 0243.
 *
 * **The catalogue, not the queries.** A picker needs to know a type
 * exists, whether it takes a setting, and what to call it — and the
 * words live in `ui_strings` where every other label does, so the list
 * is keys rather than sentences.
 */
export const CARD_CATALOGUE: {
  cardType: CardType;
  /** Which setting it takes, where it takes one. */
  parameter?: "stage";
  /** More than one is useful — `items_at_stage` is the point of it. */
  repeatable?: boolean;
}[] = [
  { cardType: "waiting_for_me" },
  { cardType: "on_my_clock" },
  { cardType: "where_things_are" },
  { cardType: "items_at_stage", parameter: "stage", repeatable: true },
  { cardType: "ageing" },
  { cardType: "done" },
  { cardType: "received" },
  { cardType: "exceptions_by_supplier" },
  { cardType: "unplaced_documents" },
  { cardType: "suppliers_awaiting_erp" },
  { cardType: "possible_duplicates" },
];

/**
 * The catalogue, and the stages a card could name.
 *
 * **Stages come from the database**, because they are customer data
 * (decision 0008) and decision 0239's whole argument was that a
 * hardcoded six would be wrong for the second customer.
 */
export async function handleCardCatalogue(db: D1Database): Promise<RouteResult> {
  const stages = await db
    .prepare(
      `SELECT s.id, s.name, p.name AS process_name
       FROM process_stages s
       JOIN processes p ON p.id = s.process_id
       ORDER BY p.name, s.sequence`
    )
    .all<{ id: string; name: string; process_name: string }>();

  return { status: 200, body: { types: CARD_CATALOGUE, stages: stages.results } };
}

/**
 * Saving a dashboard — decision 0243.
 *
 * **The whole set, not one card.** Adding, removing and reordering are
 * three verbs over one list, and three endpoints would each have to
 * renumber the positions afterwards — which is where migration 0056's
 * one-position-per-person invariant would be broken.
 *
 * So the browser sends what it wants the dashboard to be, and this
 * writes it.
 */
export async function handleSaveDashboard(
  db: D1Database,
  userId: string,
  body: unknown
): Promise<RouteResult> {
  const cards = (body as { cards?: unknown }).cards;
  if (!Array.isArray(cards)) {
    return { status: 400, body: { error: "cards (array) is required" } };
  }

  if (cards.length > 20) {
    /**
     * **A dashboard of twenty is a wall** — decision 0239 asked how
     * many before it stops helping, and this is not the answer so much
     * as a ceiling on the question.
     */
    return { status: 400, body: { error: "a dashboard holds at most 20 cards" } };
  }

  const rows: { type: CardType; settings: string }[] = [];

  for (const card of cards) {
    const type = (card as { cardType?: unknown }).cardType;
    if (typeof type !== "string" || !(CARD_TYPES as readonly string[]).includes(type)) {
      return { status: 400, body: { error: `${String(type)} is not a card type` } };
    }

    const settings = (card as { settings?: unknown }).settings ?? {};
    if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
      return { status: 400, body: { error: "settings must be an object" } };
    }

    /**
     * **A stage that does not exist is refused here**, rather than
     * saved and reported as missing on every load. The card copes with
     * a stage that disappears **later** (decision 0240) — that is a
     * different thing from one that never existed.
     */
    const wanted = (settings as { stage?: unknown }).stage;
    if (typeof wanted === "string" && wanted) {
      const stage = await db
        .prepare("SELECT id FROM process_stages WHERE id = ?")
        .bind(wanted)
        .first();
      if (!stage) {
        return { status: 404, body: { error: `stage ${wanted} does not exist` } };
      }
    }

    rows.push({ type: type as CardType, settings: JSON.stringify(settings) });
  }

  /**
   * **Replace, not merge.** Decision 0211 made the same choice for the
   * supplier load and for the same reason: a person who removed a card
   * expects it gone, and merging would make removal the one act the
   * interface could not perform.
   */
  await db.prepare("DELETE FROM dashboard_cards WHERE user_id = ?").bind(userId).run();

  for (const [index, row] of rows.entries()) {
    await db
      .prepare(
        `INSERT INTO dashboard_cards (id, user_id, card_type, settings_json, position)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(crypto.randomUUID(), userId, row.type, row.settings, index)
      .run();
  }

  return { status: 200, body: { cards: rows.length } };
}

/**
 * Back to the default — decision 0243.
 *
 * **Deleting is the reset.** Decision 0240 gives a person with no rows
 * the default set without writing it, so removing everything is exactly
 * *"start again"* — and a separate reset that wrote the default back
 * would freeze today's one into their account, which is the thing that
 * record avoided.
 */
export async function handleResetDashboard(
  db: D1Database,
  userId: string
): Promise<RouteResult> {
  await db.prepare("DELETE FROM dashboard_cards WHERE user_id = ?").bind(userId).run();
  return { status: 200, body: { reset: true } };
}
