import { unitLineage } from "./unit-config.js";
import type { RouteResult } from "./org-route.js";

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
  | "release";

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
  permissions: Set<string>
): TaskAction[] {
  // Locked by somebody else, or belonging to a team but not yet taken:
  // nothing can be acted on until it is this person's.
  if (ownership === "locked") {
    // Nothing can be done to somebody else's work — except released,
    // by a manager (decision 0104). That is the whole recovery path
    // for a lock that never expires.
    return permissions.has("AP.TaskManage") ? ["release"] : [];
  }
  if (ownership === "available") {
    // The one thing a person can do with a task they have not taken.
    return permissions.has(row.required_permission) ? ["claim"] : [];
  }

  // Theirs. Every action below additionally requires the stage's own
  // permission, which is what the task itself demands.
  if (!permissions.has(row.required_permission)) return [];

  const actions: TaskAction[] = ["complete"];
  // Only a CLAIM can be released. A task assigned to a person directly
  // has none — it is theirs by assignment, and putting it back would
  // mean returning it to nobody.
  if (row.claimed_by) actions.push("release");
  // Keying belongs to Validation, and is gated on AP.Validate
  // (decision 0071) rather than on the stage's name.
  if (permissions.has("AP.Validate")) actions.push("key");
  if (permissions.has("AP.Return")) actions.push("return");
  if (permissions.has("AP.ReturnToSupplier")) actions.push("return_to_supplier");
  if (permissions.has("AP.Discard")) actions.push("discard");
  return actions;
}

export interface TaskListOptions {
  includeCompleted?: boolean;
  /** One stage, by id. Absent means every stage. */
  stageId?: string;
  /**
   * One ownership kind.
   *
   * Applied **after** the rows are read, unlike `stageId`, because
   * ownership is derived from a comparison rather than stored — a task
   * is "mine" or "locked" depending on who is asking. Filtering it in
   * SQL would mean expressing that comparison twice, in two languages,
   * and the two would drift.
   */
  ownership?: Ownership;
  /**
   * How many rows to return. Bounded, because an unbounded list is a
   * screen that works for one customer and not the next.
   */
  limit?: number;
  offset?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

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
         s.name AS stage_name, s.process_id,
         v.process_instance_id AS instance_id,
         pi.subject_type, pi.subject_id,
         h.supplier_vat_id, h.currency, h.issue_date, h.total_with_vat, h.facts_json,
         h.org_unit_id
       FROM tasks t
       LEFT JOIN org_users claimer ON claimer.id = t.claimed_by
       LEFT JOIN org_users owner ON owner.id = t.owner_user_id
       LEFT JOIN process_stages s ON s.id = t.stage_id
       LEFT JOIN stage_visits v ON v.id = t.stage_visit_id
       LEFT JOIN process_instances pi ON pi.id = v.process_instance_id
       -- Invoice-specific, and only where the subject says so. A
       -- subject of another type simply yields nulls here.
       LEFT JOIN invoice_headers h
         ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
       WHERE t.status = ?
         AND (
           t.owner_user_id = ?
           OR t.owner_team_id IN (SELECT team_id FROM org_team_members WHERE user_id = ?)
         )
         -- One stage, or every stage. Filtered in SQL because a stage
         -- is stored on the row; ownership is not, and is applied
         -- afterwards.
         AND (? IS NULL OR t.stage_id = ?)
       ORDER BY t.created_at ASC`
    )
    // Open only, by default. A completed task is history rather than
    // work, and a queue that showed both would need the person to
    // filter before it was useful.
    .bind(
      options.includeCompleted ? "completed" : "open",
      userId,
      userId,
      options.stageId ?? null,
      options.stageId ?? null
    )
    .all<Raw>();

  const all: TaskRow[] = rows.results.map((row) => {
    const ownership = ownershipOf(row, userId);

    const task: TaskRow = {
      id: row.id,
      stageId: row.stage_id,
      stageName: row.stage_name,
      processId: row.process_id,
      requiredPermission: row.required_permission,
      orgUnitId: row.org_unit_id,
      ownership,
      actions: actionsFor(row, ownership, permissions),
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

    return task;
  });

  /**
   * **Work somebody may not do is work they should not be shown** —
   * decision 0202.
   *
   * A German validator holds `AP.Validate` and would correctly be
   * refused on a French invoice; until now the list showed it to them
   * anyway. Decision 0199 recorded that as its largest gap: *"a person
   * is correctly denied acting and still shown the work."*
   *
   * Resolved against the **document's** unit, walking up from it, so a
   * role held at Acme France covers AP France beneath it.
   */
  const lineageCache = new Map<string, Set<string>>();

  async function maySee(task: TaskRow): Promise<boolean> {
    const held = heldIn.get(task.requiredPermission);

    /**
     * **Held everywhere, or not held at all — unchanged either way.**
     *
     * A permission the person does not hold has never hidden a task:
     * `required_permission` decided which **actions** were offered, and
     * ownership decided what was listed. Twenty-two tests depend on
     * that, and changing it is a separate decision from the one asked
     * for.
     *
     * **The question here is where, not whether.** What was asked is
     * that a German validator not be shown French work — and that only
     * bites where the permission is held in specific units.
     */
    if (held === undefined || held === null) return true;

    /**
     * **A task about a document in no unit** stays visible, for the
     * same reason: it is not French, so a German validator being shown
     * it is not the fault being fixed.
     */
    if (!task.orgUnitId) return true;

    let lineage = lineageCache.get(task.orgUnitId);
    if (!lineage) {
      lineage = new Set(await unitLineage(db, task.orgUnitId));
      lineageCache.set(task.orgUnitId, lineage);
    }

    return held.some((unit) => lineage.has(unit));
  }

  const visible: TaskRow[] = [];
  for (const task of all) {
    if (await maySee(task)) visible.push(task);
  }

  const filtered = options.ownership
    ? visible.filter((t) => t.ownership === options.ownership)
    : visible;

  const limit = Math.min(Math.max(1, options.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const offset = Math.max(0, options.offset ?? 0);

  return {
    status: 200,
    body: {
      tasks: filtered.slice(offset, offset + limit),
      // **Counted over everything the person can see at this stage**,
      // not over the page returned. A count that changed as somebody
      // paged would be telling them about the page rather than about
      // their work.
      /**
       * **Counted over what the person may see** — decision 0255.
       *
       * These were counted over `all`, before `maySee` ran, so the
       * numbers under the table could include tasks the table would
       * never show — a German validator's summary counting French work
       * that decision 0202 had just hidden from the rows.
       *
       * Found because the dashboard's stage card now reads these, and a
       * card that links to a list must say what the list shows.
       */
      counts: {
        mine: visible.filter((t) => t.ownership === "mine").length,
        available: visible.filter((t) => t.ownership === "available").length,
        locked: visible.filter((t) => t.ownership === "locked").length,
      },
      total: filtered.length,
      limit,
      offset,
    },
  };
}
