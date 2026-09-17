import { authenticateUser, authenticateUserOrSession } from "./user-auth.js";
import type { AuthenticatedUser } from "./user-auth.js";
import type { Permission } from "./permissions.js";
import { unitLineage } from "./unit-config.js";

interface RoleRow {
  permissions_json: string;
  unit_id: string | null;
}

/**
 * Does this user hold any role granting the given permission —
 * **and, if a unit is named, do they hold it there?**
 *
 * Decision 0199 scopes an assignment to a unit. A role held at Acme
 * France covers every operating unit beneath it; a role held with no
 * unit is held **everywhere**, which is what every assignment predating
 * that record is.
 *
 * @param unitId where the permission is being exercised. **Omitted
 * means anywhere**, which answers *"could this person do this at all"*
 * — right for a route that is not about one document, and wrong for one
 * that is.
 *
 * That default is decision 0192's risk in its sharpest form: forgetting
 * the unit does not fail, it grants. Which is why every call site that
 * has a document was changed with this, rather than after it.
 */
export async function hasPermission(
  db: D1Database,
  userId: string,
  permission: Permission,
  unitId?: string | null
): Promise<boolean> {
  const rows = await db
    .prepare(
      `SELECT r.permissions_json AS permissions_json, ur.unit_id AS unit_id
       FROM org_roles r
       JOIN org_user_roles ur ON ur.role_id = r.id
       WHERE ur.user_id = ?`
    )
    .bind(userId)
    .all<RoleRow>();

  // Computed once, and only where it is needed: most calls name no unit
  // and most customers have none.
  const covering =
    unitId === undefined || unitId === null ? null : new Set(await unitLineage(db, unitId));

  for (const row of rows.results) {
    const permissions = JSON.parse(row.permissions_json) as string[];
    if (!permissions.includes(permission)) continue;

    // Held everywhere.
    if (row.unit_id === null) return true;

    // Held somewhere, and the caller did not say where — so the
    // question was *"at all"*, and the answer is yes.
    if (covering === null) return true;

    // Held at this unit, or at something above it.
    if (covering.has(row.unit_id)) return true;
  }

  return false;
}

/**
 * Which units this person may exercise a permission in — decision 0199.
 *
 * **This is the visibility half**, and the operator's own requirement:
 *
 *   Assigning AP Manager role for one org will not give a user
 *   visibility outside of that org.
 *
 * `null` means **everywhere**, which is both a person holding the role
 * unscoped and a customer who has never scoped anything. A caller
 * filtering a list treats null as *"no filter"* — so a customer not
 * using units sees exactly what they saw before.
 *
 * An empty array means **nowhere**, which is a real answer and a
 * different one: the person holds the permission in no unit at all.
 */
/**
 * **Every unit beneath one, including itself** — the same downward
 * walk `unitsWherePermitted` below already does, kept as its own
 * function for decision 0315's own narrowing: a single chosen org,
 * not a held permission, needs the identical walk from one starting
 * unit rather than a batch of them.
 *
 * **Not reused inside `unitsWherePermitted` itself.** That function
 * batches every held unit into one query per BFS level; calling this
 * once per unit instead would mean several times the queries for a
 * person holding several — kept separate on purpose, not a
 * duplication that drifted.
 *
 * A role, or a choice, at Acme France must reach every invoice in AP
 * France; stopping at Acme France itself would reach none of them.
 */
export async function unitsBeneath(db: D1Database, unitId: string): Promise<string[]> {
  const covered = new Set([unitId]);
  let frontier = [unitId];

  // Bounded by the tree's own depth, which decision 0036 keeps shallow:
  // legal entities nested, with operating units as leaves.
  for (let depth = 0; depth < 16 && frontier.length > 0; depth++) {
    const placeholders = frontier.map(() => "?").join(", ");
    const children = await db
      .prepare(`SELECT id FROM org_units WHERE parent_unit_id IN (${placeholders})`)
      .bind(...frontier)
      .all<{ id: string }>();

    frontier = children.results.map((c) => c.id).filter((id) => !covered.has(id));
    for (const id of frontier) covered.add(id);
  }

  return [...covered];
}

export async function unitsWherePermitted(
  db: D1Database,
  userId: string,
  permission: Permission
): Promise<string[] | null> {
  const rows = await db
    .prepare(
      `SELECT r.permissions_json AS permissions_json, ur.unit_id AS unit_id
       FROM org_roles r
       JOIN org_user_roles ur ON ur.role_id = r.id
       WHERE ur.user_id = ?`
    )
    .bind(userId)
    .all<RoleRow>();

  const held: string[] = [];

  for (const row of rows.results) {
    const permissions = JSON.parse(row.permissions_json) as string[];
    if (!permissions.includes(permission)) continue;
    if (row.unit_id === null) return null;
    held.push(row.unit_id);
  }

  if (held.length === 0) return [];

  /**
   * **Downward, not upward.** `hasPermission` walks up from a document
   * to see whether an assignment covers it; a filter needs the
   * opposite — everything beneath the units somebody holds.
   *
   * A role at Acme France must show every invoice in AP France, and
   * listing only Acme France would show none of them.
   *
   * **Batched across every held unit together**, one query per BFS
   * level rather than one per unit — `unitsBeneath()` above walks a
   * single unit at a time and is not reused here on purpose, since a
   * person holding several units would otherwise mean several times
   * the queries for the same answer.
   */
  const covered = new Set(held);
  let frontier = held;

  // Bounded by the tree's own depth, which decision 0036 keeps shallow:
  // legal entities nested, with operating units as leaves.
  for (let depth = 0; depth < 16 && frontier.length > 0; depth++) {
    const placeholders = frontier.map(() => "?").join(", ");
    const children = await db
      .prepare(`SELECT id FROM org_units WHERE parent_unit_id IN (${placeholders})`)
      .bind(...frontier)
      .all<{ id: string }>();

    frontier = children.results.map((c) => c.id).filter((id) => !covered.has(id));
    for (const id of frontier) covered.add(id);
  }

  return [...covered];
}

/**
 * **A visible-units list, narrowed to one chosen org** — decision
 * 0315, extending decision 0314's own treatment of Tasks to whichever
 * screen calls this. Extracted so the intersection itself is directly
 * testable, rather than only provable by simulating a full request.
 *
 * Intersected with `visible` rather than replacing it: a person
 * permitted everywhere who focuses on Finance sees exactly Finance's
 * own units; a person permitted only in Germany who somehow focuses
 * on France (a stale switch, another tab, a hand-built URL) sees
 * nothing rather than being granted France by the choice itself.
 * Narrowing can only ever reduce what `visible` already allows.
 */
export async function scopedToChosenOrg(
  db: D1Database,
  visible: string[] | null,
  currentOrg: string | null
): Promise<string[] | null> {
  if (!currentOrg) return visible;
  const beneath = await unitsBeneath(db, currentOrg);
  return visible === null ? beneath : beneath.filter((id) => visible.includes(id));
}

export type AuthorizationResult =
  | { authorized: true; user: AuthenticatedUser }
  | { authorized: false; status: 401 | 403 };

/**
 * Authenticate, then authorize — the combined check most routes
 * actually need. 401 (no valid key at all) is distinguished from 403
 * (a real, authenticated user who simply lacks this permission) —
 * different facts, worth telling apart rather than collapsing into one
 * generic "no" for whoever's debugging a client integration.
 */
/**
 * What a session needs to be verified — decision 0127.
 *
 * Passed rather than reached for, because `enforce.ts` has no business
 * knowing the shape of a Worker's environment. The caller assembles it
 * once and every route gets the same one.
 */
export interface SessionContext {
  publicKeyJwk?: JsonWebKey;
  environmentId?: string;
}

/**
 * May this caller do this?
 *
 * **Accepts a session as well as an API key** — decision 0127. It took
 * an API key only, and 25 configuration routes use it, so a signed-in
 * administrator could not reach almost anything they had been given an
 * administrator role for.
 *
 * Decision 0105 found this same gap in the task routes and fixed those
 * four; decision 0126 found it again in the configuration routes and
 * fixed two. **Fixing it two at a time is how it kept coming back.**
 *
 * The context is optional so a caller with no session support behaves
 * exactly as before — an API key still works everywhere it did, and
 * decision 0095's point stands: sessions and keys coexist deliberately,
 * because a person and a script are different callers.
 */
export async function requirePermission(
  db: D1Database,
  request: Request,
  permission: Permission,
  session?: SessionContext
): Promise<AuthorizationResult> {
  const user = session
    ? (await authenticateUserOrSession(db, request, session.publicKeyJwk, session.environmentId)).user
    : await authenticateUser(db, request);
  if (!user) {
    return { authorized: false, status: 401 };
  }
  const allowed = await hasPermission(db, user.id, permission);
  if (!allowed) {
    return { authorized: false, status: 403 };
  }
  return { authorized: true, user };
}

/**
 * Every permission this person holds, across all their roles — decision
 * 0095.
 *
 * `hasPermission` answers "may they do X". A screen needs the whole set
 * at once: which buttons to render at all, rather than discovering by
 * being refused.
 */
export async function permissionsFor(db: D1Database, userId: string): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT r.permissions_json AS permissions_json
       FROM org_user_roles ur
       JOIN org_roles r ON r.id = ur.role_id
       WHERE ur.user_id = ?`
    )
    .bind(userId)
    .all<{ permissions_json: string }>();

  const all = new Set<string>();
  for (const row of rows.results) {
    try {
      for (const p of JSON.parse(row.permissions_json) as string[]) all.add(p);
    } catch {
      // A role with unparseable permissions grants nothing rather than
      // failing the whole request — one bad row must not lock somebody
      // out of every screen.
    }
  }
  return [...all].sort();
}

/**
 * **Which orgs this person is entitled to focus on** — decision 0313,
 * the first piece of the operator's own request: "expose which orgs a
 * user belongs to... build the org switcher + current-org plumbing."
 *
 * **Not yet a filter.** This is deliberately the smaller, foundational
 * step — the frontend cannot offer a choice it does not know exists.
 * What a person's chosen org actually restricts is a separate piece of
 * work, not built here.
 *
 * **Direct assignments, plus every unit if any role is held
 * everywhere.** A role with `unit_id IS NULL` is decision 0199's own
 * "held everywhere" — every assignment predating that record, and
 * still the default for a customer that has never scoped anything.
 * Offering only the units directly assigned would leave such a person
 * with nothing to pick from at all; offering every real unit in that
 * case gives them something meaningful to focus on, consistent with
 * being entitled to all of it.
 */
export async function unitsFor(
  db: D1Database,
  userId: string
): Promise<{ units: { id: string; name: string }[]; holdsEverywhere: boolean }> {
  const assigned = await db
    .prepare(
      `SELECT DISTINCT u.id AS id, u.name AS name
       FROM org_user_roles ur
       JOIN org_units u ON u.id = ur.unit_id
       WHERE ur.user_id = ?
       ORDER BY u.name`
    )
    .bind(userId)
    .all<{ id: string; name: string }>();

  const holdsEverywhere = await db
    .prepare(`SELECT 1 FROM org_user_roles WHERE user_id = ? AND unit_id IS NULL LIMIT 1`)
    .bind(userId)
    .first();

  if (!holdsEverywhere) {
    return { units: assigned.results, holdsEverywhere: false };
  }

  // Held everywhere: every real unit is a meaningful thing to focus
  // on, not just the ones directly assigned — deduplicated against
  // `assigned`, since a person can hold both a direct and an
  // unscoped role at once.
  const all = await db.prepare(`SELECT id, name FROM org_units ORDER BY name`).all<{
    id: string;
    name: string;
  }>();

  const seen = new Set(assigned.results.map((u) => u.id));
  // Directly-assigned units come first, in their own alphabetical
  // order, followed by the rest of the catalogue — a role held
  // specifically somewhere is more relevant than one held only by
  // virtue of "everywhere," so it surfaces first rather than being
  // interleaved into one alphabetical pass.
  const merged = [...assigned.results];
  for (const u of all.results) {
    if (!seen.has(u.id)) {
      seen.add(u.id);
      merged.push(u);
    }
  }

  return { units: merged, holdsEverywhere: true };
}

/**
 * Is this instance still being set up — decision 0201.
 *
 * **Decision 0010 left the org endpoints ungated**, and gave a real
 * reason: *"creating the very first user in a brand-new instance would
 * otherwise be structurally impossible — nobody could ever be
 * authenticated to create the first account that grants
 * authentication."*
 *
 * That reason holds **only while there is nobody**. Once a person
 * exists who can be authenticated, the deadlock is gone and the
 * exception is a hole: anyone who can reach the instance may grant
 * themselves any role.
 *
 * So the exception is now **conditional on the thing that justified
 * it**, rather than permanent.
 */
export async function isUnclaimed(db: D1Database): Promise<boolean> {
  const anybody = await db.prepare("SELECT 1 FROM org_users LIMIT 1").first();
  return anybody === null;
}

/**
 * Which units this person may see work in, as a clause — moved here
 * from `dashboard-route.ts` (decision 0358), the same "one source of
 * truth" reasoning `scopedToChosenOrg` above already gets: reading
 * suppliers now needs the identical logic, and duplicating it would
 * have meant the "unassigned stays visible" exception below drifting
 * apart between two copies over time.
 *
 * `null` from `unitsWherePermitted` means **everywhere** — a role held
 * unscoped, and every customer not using units. An **empty array means
 * nowhere**, which is a real answer and a different one (decision
 * 0199).
 */
export interface Scope {
  units: string[] | null;
}

/**
 * The same visibility rule `unitClause` builds into SQL, for a single,
 * already-fetched value — decision 0375. A list query can express "is
 * null or is in (...)" as a `WHERE`; a single-record lookup has
 * already read the row and just needs the same three-way answer:
 * unrestricted, nowhere, or a real set with the identical "unassigned
 * is visible to everyone" exception unitClause already gives every
 * scoped list.
 */
export function isWithinScope(scope: Scope, value: string | null): boolean {
  if (scope.units === null) return true;
  if (value === null) return true;
  return scope.units.includes(value);
}

/** The `AND` a query adds to stay inside what somebody may see. */
export function unitClause(scope: Scope, column: string): { sql: string; binds: unknown[] } {
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

  /**
   * **A document that belongs to no unit is visible to everyone** —
   * decision 0255, matching the task list.
   *
   * The task list has said so since decision 0202: `if (!task.orgUnitId)
   * return true`. This clause said the opposite — a null unit is not
   * *in* any list — so a scoped person's card said **three** and the
   * list it opened showed **four**, the fourth being an unplaced
   * invoice.
   *
   * The task list's answer is the right one. An unplaced document is
   * exactly the thing somebody needs to notice and fix (decision 0204),
   * and hiding it from the people who would is hiding the problem
   * rather than the data. **A count is still a disclosure** — but what
   * it discloses here is that something is nobody's, and that is not a
   * secret from anyone.
   */
  return {
    sql: ` AND (${column} IS NULL OR ${column} IN (${placeholders}))`,
    binds: scope.units,
  };
}
