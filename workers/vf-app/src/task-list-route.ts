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
export type TaskAction = "key" | "return" | "return_to_supplier" | "discard" | "claim" | "complete";

export interface TaskRow {
  id: string;
  stageId: string;
  stageName: string | null;
  processId: string | null;
  requiredPermission: string;
  ownership: Ownership;
  /** What this person may do with it — see `TaskAction`. */
  actions: TaskAction[];
  /** Set only when `locked` — who holds it, and since when. */
  lockedBy?: { id: string; name: string; since: string | null };
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
  owner_user_id: string | null;
  owner_team_id: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  claimed_by_name: string | null;
  created_at: string;
  instance_id: string | null;
  subject_type: string | null;
  subject_id: string | null;
  supplier_vat_id: string | null;
  currency: string | null;
  issue_date: string | null;
  total_with_vat: number | null;
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
  if (ownership === "locked") return [];
  if (ownership === "available") {
    // The one thing a person can do with a task they have not taken.
    return permissions.has(row.required_permission) ? ["claim"] : [];
  }

  // Theirs. Every action below additionally requires the stage's own
  // permission, which is what the task itself demands.
  if (!permissions.has(row.required_permission)) return [];

  const actions: TaskAction[] = ["complete"];
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
      `SELECT r.permissions_json AS permissions_json
       FROM org_user_roles ur JOIN org_roles r ON r.id = ur.role_id
       WHERE ur.user_id = ?`
    )
    .bind(userId)
    .all<{ permissions_json: string }>();

  const permissions = new Set<string>();
  for (const role of permissionRows.results) {
    try {
      for (const p of JSON.parse(role.permissions_json) as string[]) permissions.add(p);
    } catch {
      // A role with unparseable permissions grants nothing rather than
      // failing the list — one bad row must not empty somebody's queue.
    }
  }

  const rows = await db
    .prepare(
      `SELECT
         t.id, t.stage_id, t.required_permission, t.owner_user_id, t.owner_team_id,
         t.claimed_by, t.claimed_at, t.created_at,
         claimer.name AS claimed_by_name,
         s.name AS stage_name, s.process_id,
         v.process_instance_id AS instance_id,
         pi.subject_type, pi.subject_id,
         h.supplier_vat_id, h.currency, h.issue_date, h.total_with_vat
       FROM tasks t
       LEFT JOIN org_users claimer ON claimer.id = t.claimed_by
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
      ownership,
      actions: actionsFor(row, ownership, permissions),
      createdAt: row.created_at,
      instanceId: row.instance_id,
    };

    if (ownership === "locked" && row.claimed_by) {
      // Who and since when. "Locked" alone cannot distinguish five
      // minutes ago from since Tuesday, and those mean very different
      // things to somebody deciding whether to ask.
      task.lockedBy = {
        id: row.claimed_by,
        name: row.claimed_by_name ?? row.claimed_by,
        since: row.claimed_at,
      };
    }

    if (row.subject_type && row.subject_id) {
      task.subject = {
        type: row.subject_type,
        id: row.subject_id,
        supplierVatId: row.supplier_vat_id,
        currency: row.currency,
        issueDate: row.issue_date,
        totalWithVat: row.total_with_vat,
      };
    }

    return task;
  });

  const filtered = options.ownership
    ? all.filter((t) => t.ownership === options.ownership)
    : all;

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
      counts: {
        mine: all.filter((t) => t.ownership === "mine").length,
        available: all.filter((t) => t.ownership === "available").length,
        locked: all.filter((t) => t.ownership === "locked").length,
      },
      total: filtered.length,
      limit,
      offset,
    },
  };
}
