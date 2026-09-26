import type { RouteResult } from "./org-route.js";

/**
 * Return reasons — decision 0498, point 1 of five: *"Need a set of
 * return reasons, so that they can be audited, and available via
 * drop-down in the button."*
 *
 * A flat, customer-editable vocabulary (migration 0087) — deliberately
 * not the Account Coding framework's hierarchy, which this has no use
 * for. `Admin.Configure` gates every write here, the same permission
 * `/sources/:id/org` already uses for an administrative/setup action
 * with no per-invoice consequence of its own.
 *
 * **Deactivated, never deleted** — a reason already recorded on a past
 * return (`process_instances.return_reason_id`) must keep resolving,
 * so there is no DELETE route here at all, only the active flag.
 */

export interface ReturnReason {
  id: string;
  label: string;
  active: boolean;
  sortOrder: number;
}

interface ReturnReasonRow {
  id: string;
  label: string;
  active: number;
  sort_order: number;
}

function toReturnReason(r: ReturnReasonRow): ReturnReason {
  return { id: r.id, label: r.label, active: r.active === 1, sortOrder: r.sort_order };
}

/**
 * The active list, ordered for a dropdown — what the picker in
 * `viewer.js` actually fetches. Everyone who can reach the button at
 * all may read this; it names no supplier, no amount, nothing
 * sensitive.
 */
export async function handleListActiveReturnReasons(db: D1Database): Promise<RouteResult> {
  const rows = await db
    .prepare("SELECT id, label, active, sort_order FROM supplier_return_reasons WHERE active = 1 ORDER BY sort_order, label")
    .all<ReturnReasonRow>();
  return { status: 200, body: { reasons: rows.results.map(toReturnReason) } };
}

/** Every reason, active or not — the admin screen's own list. */
export async function handleListAllReturnReasons(db: D1Database): Promise<RouteResult> {
  const rows = await db
    .prepare("SELECT id, label, active, sort_order FROM supplier_return_reasons ORDER BY sort_order, label")
    .all<ReturnReasonRow>();
  return { status: 200, body: { reasons: rows.results.map(toReturnReason) } };
}

export interface CreateReturnReasonBody {
  id?: unknown;
  label?: unknown;
  sortOrder?: unknown;
}

export async function handleCreateReturnReason(db: D1Database, body: CreateReturnReasonBody): Promise<RouteResult> {
  const { id, label, sortOrder } = body;
  if (typeof id !== "string" || !id || typeof label !== "string" || !label.trim()) {
    return { status: 400, body: { error: "id and label (both non-empty strings) are required" } };
  }
  if (sortOrder !== undefined && (typeof sortOrder !== "number" || !Number.isInteger(sortOrder))) {
    return { status: 400, body: { error: "sortOrder, if present, must be a whole number" } };
  }

  const existing = await db.prepare("SELECT id FROM supplier_return_reasons WHERE id = ?").bind(id).first();
  if (existing) {
    return { status: 409, body: { error: `return reason ${id} already exists` } };
  }

  await db
    .prepare("INSERT INTO supplier_return_reasons (id, label, sort_order) VALUES (?, ?, ?)")
    .bind(id, label.trim(), sortOrder ?? 0)
    .run();

  return { status: 201, body: { id, label: label.trim(), active: true, sortOrder: sortOrder ?? 0 } };
}

export interface UpdateReturnReasonBody {
  label?: unknown;
  active?: unknown;
  sortOrder?: unknown;
}

/**
 * **Renaming, retiring, and reordering — never resurrecting a deleted
 * id, because there is nothing to resurrect.** A partial update: any
 * of the three fields may be sent alone, unlike `handleUpdateTeam`'s
 * own all-required shape — retiring a reason (`active: false`) has no
 * reason to also demand its label be retyped.
 */
export async function handleUpdateReturnReason(
  db: D1Database,
  reasonId: string,
  body: UpdateReturnReasonBody
): Promise<RouteResult> {
  const existing = await db
    .prepare("SELECT id, label, active, sort_order FROM supplier_return_reasons WHERE id = ?")
    .bind(reasonId)
    .first<ReturnReasonRow>();
  if (!existing) {
    return { status: 404, body: { error: `return reason ${reasonId} does not exist` } };
  }

  const { label, active, sortOrder } = body;
  if (label !== undefined && (typeof label !== "string" || !label.trim())) {
    return { status: 400, body: { error: "label, if present, must be a non-empty string" } };
  }
  if (active !== undefined && typeof active !== "boolean") {
    return { status: 400, body: { error: "active, if present, must be a boolean" } };
  }
  if (sortOrder !== undefined && (typeof sortOrder !== "number" || !Number.isInteger(sortOrder))) {
    return { status: 400, body: { error: "sortOrder, if present, must be a whole number" } };
  }

  const newLabel = typeof label === "string" ? label.trim() : existing.label;
  const newActive = typeof active === "boolean" ? active : existing.active === 1;
  const newSortOrder = typeof sortOrder === "number" ? sortOrder : existing.sort_order;

  await db
    .prepare("UPDATE supplier_return_reasons SET label = ?, active = ?, sort_order = ? WHERE id = ?")
    .bind(newLabel, newActive ? 1 : 0, newSortOrder, reasonId)
    .run();

  return { status: 200, body: { id: reasonId, label: newLabel, active: newActive, sortOrder: newSortOrder } };
}
