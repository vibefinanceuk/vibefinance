import { unitsBeneath } from "./enforce.js";
import type { RouteResult } from "./org-route.js";
import { nextStageInSequence } from "./workflow-engine.js";
import { loadApprovalConfig } from "./approval-hierarchy.js";

/**
 * Listing a person's tasks — decision 0103.
 *
 * **The first read-oriented endpoint in a system that has been entirely
 * write-oriented.** A task could be created, claimed, completed,
 * returned and discarded — every verb — and nothing answered *"what is
 * waiting for me?"* Every task so far was found by querying D1
 * directly.
 *
 * One table, filtered by stage. Adding a stage adds no table, no column
 * and no branch here: a task appears because it is a task, and its
 * `required_permission` decides who sees it.
 */

/**
 * Why a task is in somebody's list, and what they may do with it.
 *
 * Three cases rather than three lists — the difference between *my
 * work* and *work I could take* is the difference between a to-do list
 * and a pool, and one column carries it.
 */
export type Ownership =
  /** Assigned to me directly, or claimed by me. Nobody else can act. */
  | "mine"
  /** My team's, unclaimed. I can take it; so can a colleague. */
  | "available"
  /** My team's, claimed by a colleague. Visible, not actionable by me. */
  | "locked";

/**
 * What this person may do with this task, right now.
 *
 * **Computed by the server, not inferred by the interface.** Every one
 * of these is already enforced somewhere — `AP.Return` plus the stage's
 * own permission plus holding the task (decision 0075), `AP.Discard`
 * likewise, `AP.Validate` for keying. A client that re-derived them
 * would drift: a permission changes and a button lingers, or vanishes
 * while the action still works.
 *
 * So the task reports its own actions, from the same rules that refuse
 * them. **A button that appears is one the server will honour.**
 *
 * > **This is presentation, not security.** A client can still call
 * > anything; hiding a button withholds nothing. Enforcement stays
 * > where it is, and this only stops somebody being offered an action
 * > that would then be refused.
 */
export type TaskAction =
  | "key"
  | "return"
  | "return_to_supplier"
  | "discard"
  | "claim"
  | "complete"
  | "release"
  | "reassign"
  /**
   * Complete, but pick who it goes to — decision 0495. Offered
   * INSTEAD OF `complete`, never alongside it, and only when
   * completing this exact task would cascade into a stage that
   * resolves through Approval Hierarchy while the org is configured
   * for Manual mode — see `routeToApproverOffered` below. Every other
   * task keeps seeing plain `complete`, unchanged.
   */
  | "route_to_approver";

export interface TaskRow {
  id: string;
  stageId: string;
  stageName: string | null;
  processId: string | null;
  requiredPermission: string;
  /** The unit of the document this is about — decision 0202. */
  orgUnitId: string | null;
  ownership: Ownership;
  /** What this person may do with it — see `TaskAction`. */
  actions: TaskAction[];
  /** Set only when `locked` — who holds it, and since when. */
  /** Which invoice line, where a stage is scoped per line (0027, 0183). */
  lineNumber: number | null;
  /** Who it belongs to — decision 0180. Not the same as who has it. */
  ownedBy?: { id: string; name: string; email: string | null };
  lockedBy?: { id: string; name: string; email: string | null; since: string | null };
  createdAt: string;
  instanceId: string | null;
  /**
   * Populated for an invoice, **absent for anything else**.
   *
   * The workflow engine is deliberately generic (decision 0018): it
   * knows a subject has an id, not what an invoice is. So this join is
   * invoice-specific and an expense would need its own — stated by the
   * shape rather than pretended away.
   *
   * Joined here rather than fetched per row, because forty rows would
   * otherwise be forty round trips for one screen.
   */
  subject?: {
    type: string;
    id: string;
    supplierVatId: string | null;
    /** The seller's name, where the document gave one (decision 0112). */
    supplierName: string | null;
    currency: string | null;
    issueDate: string | null;
    totalWithVat: number | null;
  };
}

interface Raw {
  id: string;
  stage_id: string;
  stage_name: string | null;
  process_id: string | null;
  required_permission: string;
  /** The unit of the document this task is about — decision 0202. */
  org_unit_id: string | null;
  owner_user_id: string | null;
  owner_team_id: string | null;
  line_number: number | null;
  claimed_by: string | null;
  claimed_at: string | null;
  claimed_by_name: string | null;
  claimed_by_email: string | null;
  owner_email: string | null;
  owner_name: string | null;
  created_at: string;
  instance_id: string | null;
  /**
   * This task's own stage sequence and process version — decision
   * 0495. Only fetched for the `routeToApproverOffered` lookahead
   * below, alongside `process_id` above; `null` for anything not part
   * of a real process instance (nothing today, but `s`/`pi` are both
   * LEFT JOINs).
   */
  stage_sequence: number | null;
  process_version: number | null;
  subject_type: string | null;
  subject_id: string | null;
  supplier_vat_id: string | null;
  facts_json: string | null;
  currency: string | null;
  issue_date: string | null;
  total_with_vat: number | null;
}

/**
 * The seller's name from a line's stored facts.
 *
 * There is no `supplier_name` column, and adding one would be a third
 * place the same value lives — after the document and `facts_json`.
 * Read rather than duplicated.
 */
function sellerNameOf(factsJson: string | null): string | null {
  if (!factsJson) return null;
  try {
    const facts = JSON.parse(factsJson) as Record<string, unknown>;
    const name = facts["BT-27"];
    return typeof name === "string" && name.trim() !== "" ? name : null;
  } catch {
    return null;
  }
}

function ownershipOf(row: Raw, userId: string): Ownership {
  // Assigned to me directly, or claimed by me. A task assigned to a
  // PERSON needs no claim — it is already theirs, and migration 0008's
  // invariant says a claim only exists on a team task.
  if (row.owner_user_id === userId || row.claimed_by === userId) return "mine";
  if (row.claimed_by) return "locked";
  return "available";
}

/**
 * Tasks this person may see: their own, and their teams'.
 *
 * Ordered oldest first. **Age costs money in accounts payable**, so the
 * thing that has waited longest is the thing to look at, and any other
 * default would have to justify itself.
 */
/**
 * The actions available on one task, for one person.
 *
 * Mirrors what the routes themselves check, and the mirroring is the
 * point: these are the same three conditions `checkStanding` applies —
 * the capability, the stage's own permission, and holding the task.
 */
function actionsFor(
  row: Raw,
  ownership: Ownership,
  permissions: Set<string>,
  /**
   * **Decision 0495.** `true` only when completing THIS task cascades
   * into a stage that resolves through Approval Hierarchy while the
   * org is configured for Manual mode — computed by
   * `routeToApproverOffered` below, once per distinct (process,
   * stage, version) rather than re-derived per row. Swaps `complete`
   * for `route_to_approver`; every other action is unaffected.
   */
  offerRouteToApprover = false
): TaskAction[] {
  // Locked by somebody else, or belonging to a team but not yet taken:
  // nothing can be acted on until it is this person's.
  if (ownership === "locked") {
    // Nothing can be done to somebody else's work — except released,
    // by a manager (decision 0104), or handed directly to somebody
    // else, by the same manager permission (decision 0489: reassign
    // is the same shape of act as release, just to a named person
    // instead of back to the pool).
    return permissions.has("AP.TaskManage") ? ["release", "reassign"] : [];
  }
  if (ownership === "available") {
    // The one thing an ordinary person can do with a task they have
    // not taken is claim it. A manager can additionally hand it
    // straight to somebody specific without claiming it themselves
    // first — decision 0489.
    const actions: TaskAction[] = [];
    if (permissions.has(row.required_permission)) actions.push("claim");
    if (permissions.has("AP.TaskManage")) actions.push("reassign");
    return actions;
  }

  // Theirs. Every action below additionally requires the stage's own
  // permission, which is what the task itself demands.
  if (!permissions.has(row.required_permission)) return [];

  const actions: TaskAction[] = [offerRouteToApprover ? "route_to_approver" : "complete"];
  // Only a CLAIM can be released, or reassigned (decision 0489, the
  // same guard as release for the same reason) — a task assigned to a
  // person directly has neither: it is theirs by assignment, and
  // handing it elsewhere would mean assigning somebody else's task.
  if (row.claimed_by) {
    actions.push("release");
    actions.push("reassign");
  }
  // Keying belongs to Validation, and is gated on AP.Validate
  // (decision 0071) rather than on the stage's name.
  if (permissions.has("AP.Validate")) actions.push("key");
  if (permissions.has("AP.Return")) actions.push("return");
  if (permissions.has("AP.ReturnToSupplier")) actions.push("return_to_supplier");
  if (permissions.has("AP.Discard")) actions.push("discard");
  return actions;
}

/**
 * Whether completing a task should offer Route To Approver instead of
 * plain Complete — decision 0495.
 *
 * **Cached by the caller, not by this function.** Every task on the
 * same stage, in the same process version, gets the identical
 * answer — a list can easily hold forty rows on three or four
 * distinct stages between them, and asking `nextStageInSequence`
 * forty times for what is at most four real questions would be the
 * same "computed once, and only where it is needed" waste
 * `visitCurrentStage`'s own `collaboratorUserIds` comment already
 * warns against.
 */
async function routeToApproverOffered(
  db: D1Database,
  processId: string,
  stageSequence: number,
  processVersion: number
): Promise<boolean> {
  const next = await nextStageInSequence(db, processId, stageSequence, processVersion);
  return Boolean(next?.uses_approval_hierarchy);
}

export interface TaskListOptions {
  includeCompleted?: boolean;
  /** One stage, by id. Absent means every stage. */
  stageId?: string;
  /**
   * **The one org a person has chosen to focus on** — decision 0314,
   * reported live, following directly from decision 0313's own
   * switcher: "let me pick one org to focus on, seeing only that
   * org's work until I switch." Narrows what is shown; grants
   * nothing of its own. A person still sees only what they are
   * already permitted to see everywhere else in this function —
   * choosing an org they hold no role in simply empties the list,
   * the same as any other filter with nothing to match.
   */
  currentOrgUnitId?: string | null;
  /**
   * One ownership kind.
   *
   * **Filtered in SQL now, decision 0449** — see `ownershipClause`
   * below. Not stored on the row, but fully expressible as a `CASE`
   * over columns the row already has (`owner_user_id`, `claimed_by`),
   * so there is no second, drifting definition the way there would be
   * for something genuinely computed client-side.
   */
  ownership?: Ownership;
  /**
   * Free-text search — decision 0449, the same `documents-route.ts`/
   * `coding-list-route.ts` shape: matched against the stage name, the
   * supplier name, and the amount — the three things a row actually
   * shows a person besides how long it has waited and who holds it.
   */
  search?: string;
  /**
   * How many rows to return. Bounded, because an unbounded list is a
   * screen that works for one customer and not the next.
   */
  limit?: number;
  offset?: number;
  /**
   * Real, page-based pagination — decision 0449, the same
   * `ALLOWED_PAGE_SIZES`/`page`/`pageSize` shape `documents-route.ts`,
   * `purchase-order-route.ts`, and `coding-list-route.ts` already use.
   * **Wins over `limit`/`offset` when given.** Left absent, `limit`/
   * `offset` behave exactly as before — the shape `dashboard-route.ts`'s
   * own two internal callers still rely on (`limit: 1000`, no page
   * controls of their own), so neither needed to change for this.
   */
  page?: number;
  pageSize?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Page sizes offered in the UI dropdown — the same list every other paginated screen offers. */
const ALLOWED_PAGE_SIZES = [25, 50, 100, 200] as const;
const DEFAULT_PAGE_SIZE = 50;

function normalizePageSize(requested: number | undefined): number {
  return requested !== undefined && (ALLOWED_PAGE_SIZES as readonly number[]).includes(requested)
    ? requested
    : DEFAULT_PAGE_SIZE;
}

function normalizePage(requested: number | undefined): number {
  return requested !== undefined && Number.isInteger(requested) && requested >= 1 ? requested : 1;
}

/**
 * Real, server-side search — decision 0449, the same `%`/`_`/`\`
 * escaping `documents-route.ts`'s own `documentSearchPattern()`
 * already applies, kept local rather than shared (this codebase's own
 * established precedent — `purchase-order-route.ts`'s `searchClause()`,
 * `documents-route.ts`'s `documentSearchPattern()`, and
 * `coding-list-route.ts`'s `codingListSearchClause()` are each their
 * own copy too).
 */
function taskSearchPattern(search: string | null | undefined): string | null {
  const term = search?.trim();
  if (!term) return null;
  return `%${term.replace(/[\\%_]/g, "\\$&")}%`;
}

export async function handleListMyTasks(
  db: D1Database,
  userId: string,
  options: TaskListOptions = {}
): Promise<RouteResult> {
  // Read once for the whole list rather than per row. Forty tasks would
  // otherwise mean forty identical permission queries.
  const permissionRows = await db
    .prepare(
      `SELECT r.permissions_json AS permissions_json, ur.unit_id AS unit_id
       FROM org_user_roles ur JOIN org_roles r ON r.id = ur.role_id
       WHERE ur.user_id = ?`
    )
    .bind(userId)
    .all<{ permissions_json: string; unit_id: string | null }>();

  /**
   * **Where each permission is held** — decision 0202.
   *
   * A flat set answered *"may this person validate"*, which was the
   * whole question until decision 0199 let a role be held somewhere.
   * Now a German validator holds `AP.Validate` and must not be shown
   * French work — the operator's own requirement, and decision 0199's
   * largest recorded gap.
   *
   * `null` against a permission means **everywhere**, which is every
   * assignment predating that record and every customer not using
   * units.
   */
  const heldIn = new Map<string, string[] | null>();

  const permissions = new Set<string>();
  for (const role of permissionRows.results) {
    try {
      for (const p of JSON.parse(role.permissions_json) as string[]) {
        permissions.add(p);

        if (role.unit_id === null) {
          heldIn.set(p, null);
        } else if (heldIn.get(p) !== null) {
          heldIn.set(p, [...(heldIn.get(p) ?? []), role.unit_id]);
        }
      }
    } catch {
      // A role with unparseable permissions grants nothing rather than
      // failing the list — one bad row must not empty somebody's queue.
    }
  }

  /**
   * **Real, SQL-pushed visibility — decision 0449**, replacing the old
   * per-row, async `maySee()` walk (kept below only in this comment's
   * own memory of it) that decision 0446 named as the reason Tasks
   * could not take the same search-and-pagination treatment Account
   * Coding got: *"not expressible as a SQL `WHERE` clause without a
   * much larger change."*
   *
   * **The insight that makes it expressible**: `maySee()`'s own
   * permission check — "is some unit this permission is held in an
   * ancestor of the task's own unit" — is exactly `unitsWherePermitted()`'s
   * job, just asked in the opposite direction and one row at a time.
   * `unitsBeneath()` (`enforce.ts`) already computes, for one starting
   * unit, every unit downward-reachable from it — the exact set whose
   * membership test is equivalent to "is this held unit an ancestor of
   * mine," just phrased as a precomputed lookup instead of a per-row
   * upward walk. Computed once here, per **held** unit (there are
   * rarely more than one or two — most roles are held everywhere,
   * which needs no computation at all), rather than once per task.
   *
   * **`scopedPermissions`** — every permission this user's roles hold
   * in **specific** units rather than everywhere (`heldIn`'s own
   * non-null entries). A permission absent from this list imposes no
   * restriction here, matching `maySee()`'s own `held === undefined`
   * (not held via any role at all) and `held === null` (held
   * everywhere) cases, which the old code folded into one "no
   * restriction" branch — this list folds them the same way, by
   * simply not appearing in it.
   *
   * **`reachablePairs`** — one `"<permission>|<unit>"` string per
   * (scoped permission, downward-reachable unit) combination. A task
   * is visible on this ground when its own `required_permission` is
   * not in `scopedPermissions` at all (no restriction), **or** the
   * pair of its own permission and its own unit is in this list (some
   * held unit reaches it). Flat strings, not a nested JSON structure
   * keyed by permission — `IN (SELECT value FROM json_each(?))` is
   * the one pattern this whole codebase already uses everywhere else
   * for exactly this "match against a precomputed set" shape, and
   * building a two-column match out of it needs nothing more exotic
   * than concatenating the pair into one string on both sides.
   */
  const scopedPermissions: string[] = [];
  const reachablePairs: string[] = [];
  for (const [permission, units] of heldIn) {
    if (units === null) continue; // Held everywhere — nothing to restrict.
    scopedPermissions.push(permission);
    const reachable = new Set<string>();
    for (const unit of units) {
      for (const id of await unitsBeneath(db, unit)) reachable.add(id);
    }
    for (const unit of reachable) reachablePairs.push(`${permission}|${unit}`);
  }

  /**
   * **The org-focus narrowing, decision 0314/0315 — the same
   * downward-reachable-set shape, for one chosen org rather than a
   * held permission.** `scopedToChosenOrg()` (`enforce.ts`) does the
   * identical thing for Documents/Purchase Orders by intersecting a
   * `visibleUnits` list; here there is no single `visibleUnits` list
   * to intersect (visibility is per-permission, not per-query), so the
   * reachable set is computed once and applied as its own, separate
   * `AND` — matching `maySee()`'s own two-separate-checks structure,
   * both of which had to pass.
   */
  const orgFocusActive = options.currentOrgUnitId ? 1 : 0;
  const orgFocusReachable = options.currentOrgUnitId ? await unitsBeneath(db, options.currentOrgUnitId) : [];

  const searchPattern = taskSearchPattern(options.search);

  /**
   * **Real pagination, decision 0449** — `page`/`pageSize` win when
   * given; `limit`/`offset` behave exactly as before when they are
   * not, which is what `dashboard-route.ts`'s own two internal callers
   * (`limit: 1000`, no page controls) still rely on. `page`/`pageSize`
   * are always returned in the body regardless of which path was
   * taken — derived from whichever `limit`/`offset` actually applied,
   * for a caller using the old shape, rather than only present when
   * the new one was used. Unlike `documents-route.ts`'s own
   * `paginating` flag, there is no extra query to gate here: `total`
   * and `counts` were already computed unconditionally before this
   * decision, over a full in-Worker scan that was strictly more
   * expensive than the SQL this replaces it with.
   */
  const usingPageParams = options.page !== undefined || options.pageSize !== undefined;
  const pageSize = usingPageParams
    ? normalizePageSize(options.pageSize)
    : Math.min(Math.max(1, options.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const limit = pageSize;
  const page = usingPageParams
    ? normalizePage(options.page)
    : Math.floor(Math.max(0, options.offset ?? 0) / limit) + 1;
  const offset = usingPageParams ? (page - 1) * pageSize : Math.max(0, options.offset ?? 0);

  const joins = `FROM tasks t
       LEFT JOIN org_users claimer ON claimer.id = t.claimed_by
       LEFT JOIN org_users owner ON owner.id = t.owner_user_id
       LEFT JOIN process_stages s ON s.id = t.stage_id
       LEFT JOIN stage_visits v ON v.id = t.stage_visit_id
       LEFT JOIN process_instances pi ON pi.id = v.process_instance_id
       -- Invoice-specific, and only where the subject says so. A
       -- subject of another type simply yields nulls here.
       LEFT JOIN invoice_headers h
         ON pi.subject_type = 'invoice' AND h.id = pi.subject_id`;

  /**
   * **One `WHERE`, shared by the counts query, the total query, and
   * the page itself** — the same "narrow once, reuse the identical
   * clause everywhere" shape `documents-route.ts` established for
   * decision 0448, for the same reason: a count computed against a
   * different `WHERE` than the rows themselves used would be a real,
   * silent bug.
   *
   * **This file's own numbered-placeholder convention, adopted here
   * for the first time** — the single `?`/`?`/`?` positional style
   * this query used before decision 0449 repeated `userId` twice by
   * passing it twice to `.bind()`; now that `userId` (`?2`) is reused
   * across the team-membership subquery *and* the ownership `CASE`
   * below, and several more optional filters exist besides `stageId`,
   * numbered placeholders are what keeps a growing bind array
   * expressing each value once rather than by how many times its own
   * placeholder happens to appear in the text.
   *
   * Ownership is **not** part of this shared clause — it is the one
   * filter the counts query must NOT apply, since the counts describe
   * every kind the person could switch to, not only the one currently
   * chosen (see `ownershipClause` below).
   */
  const baseWhereClause = `WHERE t.status = ?1
         AND (
           t.owner_user_id = ?2
           OR t.owner_team_id IN (SELECT team_id FROM org_team_members WHERE user_id = ?2)
         )
         -- One stage, or every stage.
         AND (?3 IS NULL OR t.stage_id = ?3)
         -- The permission-scoped visibility computed above.
         AND (
           h.org_unit_id IS NULL
           OR t.required_permission NOT IN (SELECT value FROM json_each(?4))
           OR (t.required_permission || '|' || h.org_unit_id) IN (SELECT value FROM json_each(?5))
         )
         -- The org-focus narrowing computed above.
         AND (h.org_unit_id IS NULL OR ?6 = 0 OR h.org_unit_id IN (SELECT value FROM json_each(?7)))
         -- Free-text search, decision 0449: stage name, supplier name
         -- (the same BT-27 fact the row itself displays via
         -- sellerNameOf() below — no supplier-table join needed, since
         -- nothing shown here comes from one), and amount.
         AND (
           ?8 IS NULL
           OR (
             s.name LIKE ?8 ESCAPE '\\'
             OR json_extract(h.facts_json, '$."BT-27"') LIKE ?8 ESCAPE '\\'
             OR CAST(h.total_with_vat AS TEXT) LIKE ?8 ESCAPE '\\'
           )
         )`;

  const baseBinds = [
    options.includeCompleted ? "completed" : "open",
    userId,
    options.stageId ?? null,
    JSON.stringify(scopedPermissions),
    JSON.stringify(reachablePairs),
    orgFocusActive,
    JSON.stringify(orgFocusReachable),
    searchPattern,
  ] as const;

  /**
   * **The same three-way split `ownershipOf()` computes per row,
   * expressed once as SQL** — `?2` (`userId`) is reused from the base
   * clause above rather than bound again, the same numbered-placeholder
   * reuse the rest of this query now relies on.
   */
  const ownershipCase = `CASE
           WHEN (t.owner_user_id = ?2 OR t.claimed_by = ?2) THEN 'mine'
           WHEN t.claimed_by IS NOT NULL THEN 'locked'
           ELSE 'available'
         END`;
  const ownershipClause = ` AND (?9 IS NULL OR (${ownershipCase}) = ?9)`;

  /**
   * **Counted over what the person may see, decision 0255 — still
   * true, now computed in SQL rather than over a full in-Worker
   * scan.** Deliberately excludes `ownershipClause`: these describe
   * every kind the person could switch to, not only the one page is
   * currently narrowed to — the same reason a Validation-filtered view
   * must not report an Approval count, but must still say how many of
   * each ownership kind exist within Validation.
   *
   * **Built on `ownershipCase`, not on its own `NOT (...)` restated —
   * that was tried first and was wrong.** SQL's three-valued logic
   * bites exactly here: for an unclaimed team task, `owner_user_id`
   * and `claimed_by` are both `NULL`, so `owner_user_id = ?2 OR
   * claimed_by = ?2` is `NULL` rather than `FALSE`, and `NOT NULL` is
   * `NULL` again — a `CASE WHEN … AND NOT (…)` built that way silently
   * drops the row from *every* branch instead of landing in
   * `available`. `ownershipCase`'s sequential `CASE … WHEN … ELSE`
   * has no such gap: each `WHEN` only has to be `TRUE` to match, `NULL`
   * falls through to the next `WHEN` exactly like `FALSE` does, and the
   * final `ELSE` catches everything else — the same reasoning that
   * already made `ownershipClause` safe to compare with `= ?9`.
   */
  const groupCountsRow = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN (${ownershipCase}) = 'mine' THEN 1 ELSE 0 END) AS mine,
         SUM(CASE WHEN (${ownershipCase}) = 'locked' THEN 1 ELSE 0 END) AS locked,
         SUM(CASE WHEN (${ownershipCase}) = 'available' THEN 1 ELSE 0 END) AS available
       ${joins}
       ${baseWhereClause}`
    )
    .bind(...baseBinds)
    .first<{ mine: number | null; locked: number | null; available: number | null }>();

  /**
   * **`total`, over the identical `WHERE` the page itself uses** —
   * including `ownershipClause` this time, since this is the count
   * behind the page a person is actually paging through.
   */
  const totalRow = await db
    .prepare(`SELECT count(*) AS n ${joins} ${baseWhereClause}${ownershipClause}`)
    .bind(...baseBinds, options.ownership ?? null)
    .first<{ n: number }>();

  const rows = await db
    .prepare(
      `SELECT
         t.id, t.stage_id, t.required_permission, t.owner_user_id, t.owner_team_id,
         t.line_number,
         t.claimed_by, t.claimed_at, t.created_at,
         claimer.name AS claimed_by_name,
         claimer.email AS claimed_by_email,
         owner.email AS owner_email,
         owner.name AS owner_name,
         s.name AS stage_name, s.process_id, s.sequence AS stage_sequence,
         v.process_instance_id AS instance_id,
         pi.subject_type, pi.subject_id, pi.process_version,
         h.supplier_vat_id, h.currency, h.issue_date, h.total_with_vat, h.facts_json,
         h.org_unit_id
       ${joins}
       ${baseWhereClause}${ownershipClause}
       ORDER BY t.created_at ASC
       LIMIT ?10 OFFSET ?11`
    )
    // Open only, by default. A completed task is history rather than
    // work, and a queue that showed both would need the person to
    // filter before it was useful.
    .bind(...baseBinds, options.ownership ?? null, limit, offset)
    .all<Raw>();

  /**
   * **Read once, only if it could possibly matter — decision 0495.**
   * Route To Approver never applies at all unless the org is
   * configured for Manual mode, so a customer on Employee-Supervisor
   * or Cost-Object (every customer today) pays no extra query here.
   * Further narrowed to "at least one row this person could complete"
   * before it is even considered — a manager looking only at Locked
   * or Available work triggers nothing further.
   */
  const anyMine = rows.results.some((row) => ownershipOf(row, userId) === "mine");
  const approvalMode = anyMine ? (await loadApprovalConfig(db)).mode : null;
  const routeToApproverCache = new Map<string, boolean>();

  const tasks: TaskRow[] = [];
  for (const row of rows.results) {
    const ownership = ownershipOf(row, userId);

    let offerRouteToApprover = false;
    if (approvalMode === "manual" && ownership === "mine" && row.process_id && row.stage_sequence !== null && row.process_version !== null) {
      const cacheKey = `${row.process_id}|${row.stage_sequence}|${row.process_version}`;
      if (!routeToApproverCache.has(cacheKey)) {
        routeToApproverCache.set(
          cacheKey,
          await routeToApproverOffered(db, row.process_id, row.stage_sequence, row.process_version)
        );
      }
      offerRouteToApprover = routeToApproverCache.get(cacheKey) ?? false;
    }

    const task: TaskRow = {
      id: row.id,
      stageId: row.stage_id,
      stageName: row.stage_name,
      processId: row.process_id,
      requiredPermission: row.required_permission,
      orgUnitId: row.org_unit_id,
      ownership,
      actions: actionsFor(row, ownership, permissions, offerRouteToApprover),
      createdAt: row.created_at,
      instanceId: row.instance_id,
      /**
       * Which line this task is about — decision 0183.
       *
       * A stage scoped `per_line` (decision 0027) evaluates its rules
       * once per invoice line, so an eight-line invoice raises **eight
       * tasks**. `assign_task` has carried the line number since, and
       * the list never reported it.
       *
       * **Eight identical rows teach somebody the list is broken.**
       * Same invoice, same supplier, same amount, same stage, and
       * nothing to tell them apart or to work through in order.
       *
       * Null on a header-scoped task, which is most of them, and means
       * *"this is about the whole document"*.
       */
      lineNumber: row.line_number,
    };

    /**
     * Who a task belongs to — decision 0180.
     *
     * **Claiming is how a team task becomes somebody's**, and the
     * system has always said so: `ownershipOf` returns `"mine"` for
     * either an assignment or a claim, and migration 0008's invariant
     * means **a claim only exists on a team task** — a task assigned to
     * a person needs none, because it is already theirs.
     *
     * So there is one owner, not two facts about one. Resolved in the
     * order a person would: whoever took it, else whoever it was given
     * to, else the team it is waiting in.
     *
     * The first version of this reported the **team** for a task
     * somebody had claimed, which is the opposite of useful — the
     * claim is precisely the news.
     */
    if (row.claimed_by) {
      task.ownedBy = {
        id: row.claimed_by,
        name: row.claimed_by_name ?? row.claimed_by,
        email: row.claimed_by_email,
      };
    } else if (row.owner_user_id) {
      task.ownedBy = {
        id: row.owner_user_id,
        name: row.owner_name ?? row.owner_user_id,
        email: row.owner_email,
      };
    } else if (row.owner_team_id) {
      // Nobody in particular, and the team is still the answer:
      // *"the AP team"* tells somebody whether it is theirs to take.
      task.ownedBy = { id: row.owner_team_id, name: row.owner_team_id, email: null };
    }

    if (ownership === "locked" && row.claimed_by) {
      // Who and since when. "Locked" alone cannot distinguish five
      // minutes ago from since Tuesday, and those mean very different
      // things to somebody deciding whether to ask.
      task.lockedBy = {
        id: row.claimed_by,
        name: row.claimed_by_name ?? row.claimed_by,
        /**
         * **The address, not just the name** — decision 0175.
         *
         * The viewer said *"Owner: Mine"*, which tells the person
         * holding a task the one thing they already know and tells
         * everybody else nothing. An address is who to ask.
         */
        email: row.claimed_by_email,
        since: row.claimed_at,
      };
    }

    if (row.subject_type && row.subject_id) {
      task.subject = {
        type: row.subject_type,
        id: row.subject_id,
        supplierVatId: row.supplier_vat_id,
        // BT-27, read from the facts because there is no column for it.
        // **A person expects a company, not a tax number** — and until
        // decision 0112 the seller's name was not read at all.
        supplierName: sellerNameOf(row.facts_json),
        currency: row.currency,
        issueDate: row.issue_date,
        totalWithVat: row.total_with_vat,
      };
    }

    tasks.push(task);
  }

  /**
   * **Work somebody may not do is work they should not be shown** —
   * decision 0202, now pushed into SQL by decision 0449.
   *
   * The permission-visibility check (a German validator correctly
   * refused on a French invoice) and the org-focus narrowing (decision
   * 0314) are both computed above, in `reachablePairs` and
   * `orgFocusReachable`, and applied inside `baseWhereClause`. See the
   * proof in decision 0449: "is the task's unit in the
   * downward-reachable set from some held unit" is exactly equivalent
   * to the old per-row "is some held unit an ancestor of the task's
   * unit" — verified case-by-case for a task with no org unit, a
   * permission held nowhere, held everywhere, and held in specific
   * units.
   */

  return {
    status: 200,
    body: {
      tasks,
      // **Counted over everything the person can see at this stage**,
      // not over the page returned. A count that changed as somebody
      // paged would be telling them about the page rather than about
      // their work.
      /**
       * **Counted over what the person may see** — decision 0255, now a
       * SQL `SUM`/`CASE` over `baseWhereClause` (decision 0449) rather
       * than a JS `.filter().length` over an in-Worker array — same
       * rule, same scope, computed where the row set already lives.
       */
      counts: {
        mine: groupCountsRow?.mine ?? 0,
        available: groupCountsRow?.available ?? 0,
        locked: groupCountsRow?.locked ?? 0,
      },
      total: totalRow?.n ?? 0,
      limit,
      offset,
      page,
      pageSize,
    },
  };
}
