import { unitsWherePermitted } from "./enforce.js";
import type { RouteResult } from "./org-route.js";

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

/** The closed set. Migration 0056 names the same list, and a test agrees them. */
export const CARD_TYPES = [
  "waiting_for_me",
  "on_my_clock",
  "items_at_stage",
  "where_things_are",
  "done",
  "ageing",
  "exceptions_by_supplier",
  "needs_somebody",
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
  { cardType: "needs_somebody", settings: {} },
];

/**
 * Which units this person may see work in, as a clause.
 *
 * `null` from `unitsWherePermitted` means **everywhere** — a role held
 * unscoped, and every customer not using units. An **empty array means
 * nowhere**, which is a real answer and a different one (decision
 * 0199).
 */
interface Scope {
  /** Null where unrestricted. */
  units: string[] | null;
}

async function scopeFor(db: D1Database, userId: string): Promise<Scope> {
  const held = await unitsWherePermitted(db, userId, "AP.Review");
  if (held === null) return { units: null };

  /**
   * **Downward**, so a role at Acme UK covers every unit beneath it —
   * `unitsWherePermitted` already walks down, and this keeps the shape
   * it returns.
   */
  return { units: held };
}

/** The `AND` a query adds to stay inside what somebody may see. */
function unitClause(scope: Scope, column: string): { sql: string; binds: unknown[] } {
  if (scope.units === null) return { sql: "", binds: [] };
  if (scope.units.length === 0) {
    /**
     * **Nowhere, which is not "no filter"** — the difference decision
     * 0199 insisted on, and getting it wrong here shows somebody
     * everything.
     *
     * `AND 1 = 0` is belt to a brace: an empty list would produce
     * `IN ()`, which SQLite already treats as false. **Stated anyway**,
     * because a reader should not have to know that, and a later change
     * to how the clause is built could lose it silently.
     */
    return { sql: " AND 1 = 0", binds: [] };
  }
  const placeholders = scope.units.map(() => "?").join(", ");
  return { sql: ` AND ${column} IN (${placeholders})`, binds: scope.units };
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
async function waitingForMe(db: D1Database, userId: string, scope: Scope) {
  const clause = unitClause(scope, "h.org_unit_id");

  const row = await db
    .prepare(
      `SELECT count(*) AS n, count(DISTINCT t.stage_id) AS stages
       FROM tasks t
       LEFT JOIN stage_visits v ON v.id = t.stage_visit_id
       LEFT JOIN process_instances pi ON pi.id = v.process_instance_id
       LEFT JOIN invoice_headers h ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
       WHERE t.status = 'open'
         AND (
           t.owner_user_id = ?1
           OR t.claimed_by = ?1
           OR t.owner_team_id IN (SELECT team_id FROM org_team_members WHERE user_id = ?1)
         )${clause.sql}`
    )
    .bind(userId, ...clause.binds)
    .first<{ n: number; stages: number }>();

  return { count: row?.n ?? 0, stages: row?.stages ?? 0 };
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
async function itemsAtStage(db: D1Database, scope: Scope, settings: Record<string, unknown>) {
  const stageId = typeof settings.stage === "string" ? settings.stage : null;
  if (!stageId) return { count: 0, stageName: null, unconfigured: true };

  const clause = unitClause(scope, "h.org_unit_id");

  const row = await db
    .prepare(
      `SELECT s.name AS stage_name, count(*) AS n
       FROM process_instances pi
       JOIN process_stages s ON s.id = pi.current_stage_id
       LEFT JOIN invoice_headers h ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
       WHERE pi.status = ${IN_FLIGHT} AND pi.current_stage_id = ?1${clause.sql}`
    )
    .bind(stageId, ...clause.binds)
    .first<{ stage_name: string | null; n: number }>();

  /**
   * **A stage that no longer exists is a card, not an error.** A
   * customer may rename or remove one, and the card should say so
   * rather than showing nothing or a zero that looks like good news.
   */
  return { count: row?.n ?? 0, stageName: row?.stage_name ?? null, missing: !row?.stage_name };
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
   */
  return {
    buckets: [
      { label: "<1d", n: row?.d0 ?? 0 },
      { label: "1–3d", n: row?.d1 ?? 0 },
      { label: "4–7d", n: row?.d4 ?? 0 },
      { label: "8–30d", n: row?.d8 ?? 0 },
      { label: "30d+", n: row?.d31 ?? 0 },
    ],
  };
}

/** Finished today and this week, by whoever finished it. */
async function done(db: D1Database, userId: string, scope: Scope) {
  const clause = unitClause(scope, "h.org_unit_id");

  const row = await db
    .prepare(
      `SELECT
         sum(CASE WHEN date(t.completed_at) = date('now') THEN 1 ELSE 0 END) AS today,
         sum(CASE WHEN julianday('now') - julianday(t.completed_at) < 7 THEN 1 ELSE 0 END) AS week,
         sum(CASE WHEN t.completed_by = ?1
                   AND julianday('now') - julianday(t.completed_at) < 7 THEN 1 ELSE 0 END) AS mine
       FROM tasks t
       LEFT JOIN stage_visits v ON v.id = t.stage_visit_id
       LEFT JOIN process_instances pi ON pi.id = v.process_instance_id
       LEFT JOIN invoice_headers h ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
       WHERE t.completed_at IS NOT NULL${clause.sql}`
    )
    .bind(userId, ...clause.binds)
    .first<{ today: number; week: number; mine: number }>();

  return { today: row?.today ?? 0, week: row?.week ?? 0, mine: row?.mine ?? 0 };
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
 * **Things nothing else surfaces** — decision 0239.
 *
 * Each of these is a fact this system records and no screen reads: an
 * unplaced document (decision 0204), a supplier awaiting the ERP
 * (decision 0231), and a duplicate suspicion (decision 0028).
 */
async function needsSomebody(db: D1Database, scope: Scope) {
  const clause = unitClause(scope, "h.org_unit_id");

  const unplaced = await db
    .prepare(
      `SELECT count(*) AS n FROM invoice_headers h
       WHERE h.org_unit_id IS NULL
         AND json_extract(h.facts_json, '$."org.unplaced"') IS NOT NULL`
    )
    .first<{ n: number }>();

  const awaiting = await db
    .prepare(
      "SELECT count(*) AS n FROM suppliers WHERE status = 'active' AND erp_identifier IS NULL"
    )
    .first<{ n: number }>();

  const duplicates = await db
    .prepare(
      `SELECT count(*) AS n FROM invoice_headers h
       WHERE CAST(json_extract(h.facts_json, '$."invoice.duplicate_confidence"') AS REAL) >= 0.5
         ${clause.sql}`
    )
    .bind(...clause.binds)
    .first<{ n: number }>();

  return {
    unplaced: unplaced?.n ?? 0,
    awaitingErp: awaiting?.n ?? 0,
    duplicates: duplicates?.n ?? 0,
  };
}

/**
 * Every card a person has, with its data — decision 0240.
 *
 * **One route rather than one per card**, so the scope is computed once
 * and a dashboard is one round trip rather than nine.
 */
export async function handleDashboard(db: D1Database, userId: string): Promise<RouteResult> {
  const scope = await scopeFor(db, userId);

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
      data = await runCard(db, userId, scope, card.cardType, card.settings);
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
  type: CardType,
  settings: Record<string, unknown>
): Promise<unknown> {
  switch (type) {
    case "waiting_for_me":
      return waitingForMe(db, userId, scope);
    case "on_my_clock":
      return onMyClock(db, userId, scope, settings);
    case "where_things_are":
      return whereThingsAre(db, scope);
    case "items_at_stage":
      return itemsAtStage(db, scope, settings);
    case "ageing":
      return ageing(db, scope);
    case "done":
      return done(db, userId, scope);
    case "received":
      return received(db, scope);
    case "exceptions_by_supplier":
      return exceptionsBySupplier(db, scope);
    case "needs_somebody":
      return needsSomebody(db, scope);
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
