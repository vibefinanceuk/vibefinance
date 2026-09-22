import type { RouteResult } from "./org-route.js";

/**
 * The write API for the Approval Hierarchy tab — decision 0440.
 *
 * Decision 0439 built the migration and the resolver
 * (`approval-hierarchy.ts`) and left every table it added reachable
 * only by direct SQL, deliberately, sequenced this way at the
 * operator's own instruction. This is the other half: the routes
 * `ap-setup.js`'s own Approval Hierarchy tab calls, following the same
 * "raw API, closed vocabulary, upsert on a composite key" shape
 * `org-route.ts` and `field-visibility-route.ts` already established.
 *
 * **`org_approval_config`, read and written as a singleton** — the
 * same `org_settings` shape (decision 0077) migration 0075 already
 * used to create it, row `id = 1` inserted the moment the table was.
 *
 * **The two override tables, upsert on their own composite key** —
 * the same reasoning `handleSetAuthorityLimit`'s own doc comment
 * gives for `org_authority_limits`: the key IS the identity, so
 * setting it again is a correction, not a duplicate. Unlike that
 * route, currency here is free text too — no closed ISO-4217-style
 * vocabulary exists anywhere in this codebase yet (checked directly:
 * `shared/interpreter/closed-values.ts` has none), so this matches
 * `handleSetAuthorityLimit`'s own existing precedent rather than
 * inventing validation nothing else in the system has.
 */

const MODES = ["employee_supervisor", "cost_object", "manual", "api"] as const;
type Mode = (typeof MODES)[number];

interface ApprovalConfigRow {
  mode: Mode;
  default_approver_user_id: string | null;
}

interface SupervisorOverrideRow {
  user_id: string;
  user_name: string;
  unit_id: string;
  unit_name: string;
  supervisor_id: string;
  supervisor_name: string;
}

interface LimitOverrideRow {
  user_id: string;
  user_name: string;
  unit_id: string;
  unit_name: string;
  currency: string;
  max_amount: number;
}

/**
 * Everything the tab needs, in one call — the same "one fetch, one
 * render" shape `/org/overview` already gives `access.js`.
 */
export async function handleGetApprovalConfig(db: D1Database): Promise<RouteResult> {
  const config = await db
    .prepare("SELECT mode, default_approver_user_id FROM org_approval_config WHERE id = 1")
    .first<ApprovalConfigRow>();

  // The singleton row is inserted by its own migration (0075) and
  // never removable — a missing row here would mean the migration
  // itself never ran, which every other route in this system already
  // assumes cannot happen.
  const defaultApproverName = config?.default_approver_user_id
    ? (
        await db
          .prepare("SELECT name FROM org_users WHERE id = ?")
          .bind(config.default_approver_user_id)
          .first<{ name: string }>()
      )?.name ?? null
    : null;

  const supervisorOverrides = await db
    .prepare(
      `SELECT o.user_id, u.name AS user_name, o.unit_id, n.name AS unit_name,
              o.supervisor_id, s.name AS supervisor_name
       FROM org_user_supervisor_overrides o
       JOIN org_users u ON u.id = o.user_id
       JOIN org_units n ON n.id = o.unit_id
       JOIN org_users s ON s.id = o.supervisor_id
       ORDER BY u.name, n.name`
    )
    .all<SupervisorOverrideRow>();

  const limitOverrides = await db
    .prepare(
      `SELECT o.user_id, u.name AS user_name, o.unit_id, n.name AS unit_name,
              o.currency, o.max_amount
       FROM org_authority_limit_overrides o
       JOIN org_users u ON u.id = o.user_id
       JOIN org_units n ON n.id = o.unit_id
       ORDER BY u.name, n.name, o.currency`
    )
    .all<LimitOverrideRow>();

  return {
    status: 200,
    body: {
      mode: config?.mode ?? "employee_supervisor",
      defaultApproverUserId: config?.default_approver_user_id ?? null,
      defaultApproverName,
      supervisorOverrides: supervisorOverrides.results.map((r) => ({
        userId: r.user_id,
        userName: r.user_name,
        unitId: r.unit_id,
        unitName: r.unit_name,
        supervisorId: r.supervisor_id,
        supervisorName: r.supervisor_name,
      })),
      limitOverrides: limitOverrides.results.map((r) => ({
        userId: r.user_id,
        userName: r.user_name,
        unitId: r.unit_id,
        unitName: r.unit_name,
        currency: r.currency,
        maxAmount: r.max_amount,
      })),
    },
  };
}

interface UpdateApprovalConfigBody {
  mode?: unknown;
  defaultApproverUserId?: unknown;
}

export async function handleUpdateApprovalConfig(
  db: D1Database,
  body: UpdateApprovalConfigBody
): Promise<RouteResult> {
  const { mode, defaultApproverUserId } = body;
  if (typeof mode !== "string" || !MODES.includes(mode as Mode)) {
    return { status: 422, body: { error: `mode must be one of ${MODES.join(", ")}` } };
  }
  if (defaultApproverUserId !== null && defaultApproverUserId !== undefined && typeof defaultApproverUserId !== "string") {
    return { status: 400, body: { error: "defaultApproverUserId, if provided, must be a string or null" } };
  }

  const approverId = (defaultApproverUserId as string | null | undefined) ?? null;
  if (approverId) {
    const exists = await db.prepare("SELECT id FROM org_users WHERE id = ?").bind(approverId).first();
    if (!exists) {
      return { status: 404, body: { error: `user ${approverId} does not exist` } };
    }
  }

  await db
    .prepare(
      "UPDATE org_approval_config SET mode = ?, default_approver_user_id = ?, updated_at = ? WHERE id = 1"
    )
    .bind(mode, approverId, new Date().toISOString())
    .run();

  return { status: 200, body: { mode, defaultApproverUserId: approverId } };
}

interface SetSupervisorOverrideBody {
  userId?: unknown;
  unitId?: unknown;
  supervisorId?: unknown;
}

export async function handleSetSupervisorOverride(db: D1Database, body: SetSupervisorOverrideBody): Promise<RouteResult> {
  const { userId, unitId, supervisorId } = body;
  if (typeof userId !== "string" || !userId || typeof unitId !== "string" || !unitId || typeof supervisorId !== "string" || !supervisorId) {
    return { status: 400, body: { error: "userId, unitId and supervisorId (all strings) are required" } };
  }
  if (userId === supervisorId) {
    // The same guard the migration's own CHECK constraint holds —
    // caught here first so the caller gets a real message rather than
    // a raw SQLite constraint error.
    return { status: 422, body: { error: "a person cannot be their own supervisor" } };
  }

  const [user, unit, supervisor] = await Promise.all([
    db.prepare("SELECT id FROM org_users WHERE id = ?").bind(userId).first(),
    db.prepare("SELECT id FROM org_units WHERE id = ?").bind(unitId).first(),
    db.prepare("SELECT id FROM org_users WHERE id = ?").bind(supervisorId).first(),
  ]);
  if (!user) return { status: 404, body: { error: `user ${userId} does not exist` } };
  if (!unit) return { status: 404, body: { error: `org unit ${unitId} does not exist` } };
  if (!supervisor) return { status: 404, body: { error: `user ${supervisorId} does not exist` } };

  await db
    .prepare(
      `INSERT INTO org_user_supervisor_overrides (user_id, unit_id, supervisor_id) VALUES (?, ?, ?)
       ON CONFLICT(user_id, unit_id) DO UPDATE SET supervisor_id = excluded.supervisor_id`
    )
    .bind(userId, unitId, supervisorId)
    .run();

  return { status: 200, body: { userId, unitId, supervisorId } };
}

export async function handleDeleteSupervisorOverride(db: D1Database, userId: string, unitId: string): Promise<RouteResult> {
  const result = await db
    .prepare("DELETE FROM org_user_supervisor_overrides WHERE user_id = ? AND unit_id = ?")
    .bind(userId, unitId)
    .run();

  if (!result.meta.changes) {
    return { status: 404, body: { error: "that override does not exist" } };
  }
  return { status: 200, body: { userId, unitId } };
}

interface SetLimitOverrideBody {
  userId?: unknown;
  unitId?: unknown;
  currency?: unknown;
  maxAmount?: unknown;
}

export async function handleSetLimitOverride(db: D1Database, body: SetLimitOverrideBody): Promise<RouteResult> {
  const { userId, unitId, currency, maxAmount } = body;
  if (
    typeof userId !== "string" || !userId ||
    typeof unitId !== "string" || !unitId ||
    typeof currency !== "string" || !currency ||
    typeof maxAmount !== "number"
  ) {
    return { status: 400, body: { error: "userId, unitId, currency (strings) and maxAmount (number) are required" } };
  }
  if (maxAmount < 0) {
    return { status: 400, body: { error: "maxAmount must not be negative" } };
  }

  const [user, unit] = await Promise.all([
    db.prepare("SELECT id FROM org_users WHERE id = ?").bind(userId).first(),
    db.prepare("SELECT id FROM org_units WHERE id = ?").bind(unitId).first(),
  ]);
  if (!user) return { status: 404, body: { error: `user ${userId} does not exist` } };
  if (!unit) return { status: 404, body: { error: `org unit ${unitId} does not exist` } };

  await db
    .prepare(
      `INSERT INTO org_authority_limit_overrides (user_id, unit_id, currency, max_amount) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, unit_id, currency) DO UPDATE SET max_amount = excluded.max_amount`
    )
    .bind(userId, unitId, currency, maxAmount)
    .run();

  return { status: 200, body: { userId, unitId, currency, maxAmount } };
}

export async function handleDeleteLimitOverride(
  db: D1Database,
  userId: string,
  unitId: string,
  currency: string
): Promise<RouteResult> {
  const result = await db
    .prepare("DELETE FROM org_authority_limit_overrides WHERE user_id = ? AND unit_id = ? AND currency = ?")
    .bind(userId, unitId, currency)
    .run();

  if (!result.meta.changes) {
    return { status: 404, body: { error: "that override does not exist" } };
  }
  return { status: 200, body: { userId, unitId, currency } };
}
