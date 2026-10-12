import type { RouteResult } from "./org-route.js";
import type { ParsedOrder } from "@vibefinance/shared";
import { FIELD_CODE_LISTS } from "@vibefinance/shared";
import { visitCurrentStage } from "./workflow-engine.js";
import { heldByLine } from "./goods-receipts.js";
import { poOfSql } from "./credit-notes.js";

/**
 * **Checking, in the Purchase Orders process — decision 0750**, slice 2
 * of the purchase orders proposal (0749).
 *
 * The stage's own check (`process_stages.builtin_check = 'order_checking'`)
 * looks at each order before it is released:
 *
 * - **its company** is known (a procurement system's order for a company
 *   not set up waits here now, rather than being refused);
 * - **its supplier** is named, known (VAT number however written, or ERP
 *   number) and active;
 * - **its currency** is an ISO 4217 code;
 * - **every line** has a quantity, a unit and a price;
 * - **a change** takes no line below what has already been received
 *   (0646), nor removes one with goods received;
 * - **a cancellation** has an order to cancel, and says so where goods
 *   were received or invoices name the order.
 *
 * All well: on it goes and is released. Otherwise it stops here with
 * **one task for the order**, for the Purchasing team, needing
 * AP.Purchasing. Whoever claims it may set the company or the supplier
 * (and the check runs again), **release it anyway** having seen what was
 * found (not where the company is unknown, or there is nothing to
 * cancel), or **reject** it with a reason.
 */

export const ORDER_CHECKING_CHECK = "order_checking";
export const PURCHASING_TEAM_ID = "purchasing";
export const PURCHASING_PERMISSION = "AP.Purchasing";

export type ProblemCode =
  | "company_unknown"
  | "supplier_missing"
  | "supplier_unknown"
  | "supplier_inactive"
  | "currency_missing"
  | "currency_unknown"
  | "line_incomplete"
  | "below_received"
  | "line_removed_received"
  | "nothing_to_cancel"
  | "cancel_received"
  | "cancel_invoiced";

export interface Problem {
  code: ProblemCode;
  lines?: number[];
  detail?: string;
}

/** What cannot be released anyway: an order with no company cannot be stored; a cancellation of nothing cancels nothing. */
export const BLOCKING: ProblemCode[] = ["company_unknown", "nothing_to_cancel"];

export interface IntakeRow {
  id: string;
  order_number: string;
  order_json: string;
  status_json: string | null;
  org_unit_id: string | null;
  status: "pending" | "released" | "rejected";
  kind: "order" | "change" | "cancellation";
  is_change: number;
  check_json: string | null;
  release_override: number;
  route_message_id: string | null;
  created_by: string | null;
  created_at: string;
  released_at: string | null;
  released_by: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
  reject_reason: string | null;
  note: string | null;
  change_reference: string | null;
  sequence_number: string | null;
  purchase_order_id: string | null;
}

const BARE = (col: string) =>
  `(CASE WHEN upper(replace(replace(${col}, ' ', ''), '.', '')) GLOB '[A-Z][A-Z][0-9]*' THEN substr(upper(replace(replace(${col}, ' ', ''), '.', '')), 3) ELSE upper(replace(replace(${col}, ' ', ''), '.', '')) END)`;

/** The supplier an order names, by VAT number however written or ERP number, an active one first. */
export async function supplierOfParty(db: D1Database, partyId: string | undefined | null): Promise<{ id: string; name: string; status: string } | null> {
  if (!partyId?.trim()) return null;
  return db
    .prepare(
      `SELECT id, name, status FROM suppliers
       WHERE (vat_id IS NOT NULL AND ${BARE("vat_id")} = ${BARE("?1")}) OR erp_identifier = ?1
       ORDER BY status = 'active' DESC, name LIMIT 1`
    )
    .bind(partyId.trim())
    .first<{ id: string; name: string; status: string }>();
}

const CURRENCIES = new Set((FIELD_CODE_LISTS["BT-5"]?.codes ?? []).map(([code]) => code));

/** **What Checking finds** on one order on its way in. Empty when all is well. */
export async function checkOrder(db: D1Database, row: IntakeRow): Promise<Problem[]> {
  const parsed = JSON.parse(row.order_json) as ParsedOrder;
  const problems: Problem[] = [];
  if (!row.org_unit_id) problems.push({ code: "company_unknown", ...(parsed.buyerPartyId ? { detail: parsed.buyerPartyId } : {}) });

  if (row.kind === "cancellation") {
    const inForce = await db.prepare("SELECT 1 FROM purchase_orders WHERE order_number = ?").bind(row.order_number).first();
    if (!inForce) return [...problems, { code: "nothing_to_cancel" }];
    const held = await heldByLine(db, row.order_number);
    const received = [...held].filter(([, h]) => h.received - h.returned > 1e-9).map(([line]) => line);
    if (received.length) problems.push({ code: "cancel_received", lines: received.sort((a, b) => a - b) });
    const invoiced = await db
      .prepare(
        `SELECT count(*) AS n FROM invoice_headers h WHERE ${poOfSql("h")} = ?
           AND NOT EXISTS (SELECT 1 FROM process_instances pi WHERE pi.subject_type = 'invoice' AND pi.subject_id = h.id AND pi.status IN ('archived', 'returned_manually', 'credited'))`
      )
      .bind(row.order_number)
      .first<{ n: number }>();
    if ((invoiced?.n ?? 0) > 0) problems.push({ code: "cancel_invoiced", detail: String(invoiced!.n) });
    return problems;
  }

  if (!parsed.sellerPartyId?.trim()) problems.push({ code: "supplier_missing" });
  else {
    const supplier = await supplierOfParty(db, parsed.sellerPartyId);
    if (!supplier) problems.push({ code: "supplier_unknown", detail: parsed.sellerPartyId });
    else if (supplier.status !== "active") problems.push({ code: "supplier_inactive", detail: supplier.name });
  }
  if (!parsed.currency?.trim()) problems.push({ code: "currency_missing" });
  else if (CURRENCIES.size > 0 && !CURRENCIES.has(parsed.currency.trim().toUpperCase())) problems.push({ code: "currency_unknown", detail: parsed.currency });

  const incomplete = parsed.lines.filter((l) => l.quantity === undefined || l.quantity === null || !l.unitCode?.trim() || l.priceAmount === undefined || l.priceAmount === null).map((l) => l.lineNumber);
  if (incomplete.length) problems.push({ code: "line_incomplete", lines: incomplete });

  // A change against goods already received (0646), judged before it is in force.
  const held = await heldByLine(db, row.order_number);
  const below: number[] = [];
  const removed: number[] = [];
  for (const [line, h] of held) {
    const net = h.received - h.returned;
    const now = parsed.lines.find((l) => l.lineNumber === line);
    if (!now) {
      if (h.received > 0) removed.push(line);
    } else if (now.quantity !== undefined && net > now.quantity + 1e-9) below.push(line);
  }
  if (below.length) problems.push({ code: "below_received", lines: below.sort((a, b) => a - b) });
  if (removed.length) problems.push({ code: "line_removed_received", lines: removed.sort((a, b) => a - b) });
  return problems;
}

/** **The Purchasing team**, made if it is not there (in the AP team's unit, else the top unit), and everyone holding AP.Purchasing in it. */
export async function ensurePurchasingTeam(db: D1Database, name = "Purchasing"): Promise<{ id: string; name: string; members: number } | null> {
  const existing = await db.prepare("SELECT id, name FROM org_teams WHERE id = ?").bind(PURCHASING_TEAM_ID).first<{ id: string; name: string }>();
  if (!existing) {
    const unit =
      (await db.prepare("SELECT unit_id AS id FROM org_teams WHERE id = 'ap-team'").first<{ id: string }>()) ??
      (await db.prepare("SELECT id FROM org_units WHERE parent_unit_id IS NULL ORDER BY created_at, id LIMIT 1").first<{ id: string }>());
    if (!unit) return null;
    await db.prepare("INSERT INTO org_teams (id, name, unit_id) VALUES (?, ?, ?)").bind(PURCHASING_TEAM_ID, name, unit.id).run();
  }
  /**
   * **Everyone holding AP.Purchasing is in it**, each time: someone given
   * the permission after the team was made would otherwise never see
   * its tasks. Nobody is taken out here; that stays a person's choice.
   */
  await db
    .prepare(
      `INSERT OR IGNORE INTO org_team_members (team_id, user_id)
       SELECT DISTINCT ?, ur.user_id FROM org_user_roles ur JOIN org_roles r ON r.id = ur.role_id
       JOIN org_users u ON u.id = ur.user_id AND u.status = 'active'
       WHERE EXISTS (SELECT 1 FROM json_each(r.permissions_json) p WHERE p.value = ?)`
    )
    .bind(PURCHASING_TEAM_ID, PURCHASING_PERMISSION)
    .run();
  const members = (await db.prepare("SELECT count(*) AS n FROM org_team_members WHERE team_id = ?").bind(PURCHASING_TEAM_ID).first<{ n: number }>())?.n ?? 0;
  return { id: PURCHASING_TEAM_ID, name: existing?.name ?? name, members };
}

/**
 * **Checking's built-in check, run by the engine** at a stage marked
 * `order_checking` for a purchase order. What it found is kept on the
 * order (`check_json`). Nothing found, or released anyway by a person:
 * on it goes. Otherwise it stops here with one task, for Purchasing.
 */
export async function orderCheckingGuard(db: D1Database, stage: { id: string; required_permission: string | null }, intakeId: string, visitId: string): Promise<{ stop: boolean; tasksCreated: number }> {
  const row = await db.prepare("SELECT * FROM purchase_order_intake WHERE id = ?").bind(intakeId).first<IntakeRow>();
  if (!row) return { stop: false, tasksCreated: 0 };
  const problems = await checkOrder(db, row);
  await db.prepare("UPDATE purchase_order_intake SET check_json = ? WHERE id = ?").bind(JSON.stringify(problems), intakeId).run();
  if (problems.length === 0) return { stop: false, tasksCreated: 0 };
  if (row.release_override === 1 && !problems.some((p) => BLOCKING.includes(p.code))) return { stop: false, tasksCreated: 0 };
  const team = await ensurePurchasingTeam(db);
  if (!team) return { stop: true, tasksCreated: 0 };
  await db
    .prepare(
      // No rule raised it: the stage's own check did.
      `INSERT INTO tasks (id, stage_id, owner_team_id, required_permission, stage_visit_id, created_at)
       VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'))`
    )
    .bind(crypto.randomUUID(), stage.id, team.id, stage.required_permission ?? PURCHASING_PERMISSION, visitId)
    .run();
  return { stop: true, tasksCreated: 1 };
}

/** Whether a task is Checking's own order task: it is done by Release or Reject, not Complete. */
export async function isOrderCheckingTask(db: D1Database, taskId: string): Promise<boolean> {
  return (
    (await db
      .prepare("SELECT 1 FROM tasks t JOIN process_stages s ON s.id = t.stage_id WHERE t.id = ? AND t.rule_id IS NULL AND s.builtin_check = ?")
      .bind(taskId, ORDER_CHECKING_CHECK)
      .first()) !== null
  );
}

// ── Working an order held at Checking ─────────────────────────────────

/** The open task on an order's instance in progress, with who holds it. */
export async function openOrderTask(db: D1Database, intakeId: string) {
  return db
    .prepare(
      `SELECT t.id, t.owner_user_id, t.owner_team_id, t.claimed_by, cu.name AS claimed_by_name, t.claimed_at, t.required_permission
       FROM tasks t JOIN stage_visits v ON v.id = t.stage_visit_id
       JOIN process_instances pi ON pi.id = v.process_instance_id
       LEFT JOIN org_users cu ON cu.id = t.claimed_by
       WHERE pi.subject_type = 'purchase_order' AND pi.subject_id = ? AND pi.status = 'in_progress' AND t.status = 'open'
       ORDER BY t.created_at LIMIT 1`
    )
    .bind(intakeId)
    .first<{ id: string; owner_user_id: string | null; owner_team_id: string | null; claimed_by: string | null; claimed_by_name: string | null; claimed_at: string | null; required_permission: string | null }>();
}

/** **Claim before acting**, as a receipt's task (0657): a named person's task is theirs; a team's must be claimed by this person. */
export async function orderTaskRefusal(db: D1Database, userId: string, intakeId: string): Promise<RouteResult | null> {
  const task = await openOrderTask(db, intakeId);
  if (!task) return null;
  if (task.owner_user_id) return task.owner_user_id === userId ? null : { status: 403, body: { error: "this order's task is assigned to someone else", reason: "task_not_yours", taskId: task.id } };
  if (!task.claimed_by) return { status: 409, body: { error: "claim the order's task before acting on it", reason: "task_not_claimed", taskId: task.id } };
  if (task.claimed_by !== userId)
    return { status: 403, body: { error: `${task.claimed_by_name ?? "someone else"} has claimed this order's task`, reason: "task_claimed_by_other", taskId: task.id, claimedBy: task.claimed_by_name } };
  return null;
}

const notFound: RouteResult = { status: 404, body: { error: "no such order on its way in", reason: "not_found" } };

async function intakeOf(db: D1Database, id: string): Promise<IntakeRow | null> {
  return db.prepare("SELECT * FROM purchase_order_intake WHERE id = ?").bind(id).first<IntakeRow>();
}

async function pendingRow(db: D1Database, userId: string, id: string): Promise<IntakeRow | RouteResult> {
  const row = await intakeOf(db, id);
  if (!row) return notFound;
  if (row.status !== "pending") return { status: 409, body: { error: `that order is ${row.status}`, reason: `order_${row.status}` } };
  const refusal = await orderTaskRefusal(db, userId, id);
  return refusal ?? row;
}

/**
 * **One order on its way in, as the screen shows it**: what was sent,
 * what Checking found, where it waits, its task, and (for a change or a
 * cancellation) the order in force it would replace.
 */
export async function intakeView(db: D1Database, id: string, userId: string | null = null) {
  const row = await intakeOf(db, id);
  if (!row) return null;
  const parsed = JSON.parse(row.order_json) as ParsedOrder;
  const company = row.org_unit_id ? await db.prepare("SELECT id, name FROM org_units WHERE id = ?").bind(row.org_unit_id).first<{ id: string; name: string }>() : null;
  const supplier = await supplierOfParty(db, parsed.sellerPartyId);
  const stage = await db
    .prepare(
      `SELECT pi.id AS instance_id, pi.status, st.name AS stage, p.name AS process FROM process_instances pi
       LEFT JOIN process_stages st ON st.id = pi.current_stage_id JOIN processes p ON p.id = pi.process_id
       WHERE pi.subject_type = 'purchase_order' AND pi.subject_id = ? ORDER BY pi.created_at DESC LIMIT 1`
    )
    .bind(id)
    .first<{ instance_id: string; status: string; stage: string | null; process: string }>();
  const task = await openOrderTask(db, id);
  const inForce = row.kind !== "order" || row.is_change === 1
    ? await db
        .prepare(
          `SELECT po.id, po.status, po.currency, po.payable_amount,
                  (SELECT json_group_array(json_object('lineNumber', l.line_number, 'quantity', l.quantity, 'unitCode', l.unit_code, 'priceAmount', l.price_amount, 'itemName', l.item_name, 'lineExtensionAmount', l.line_extension_amount))
                   FROM (SELECT * FROM purchase_order_lines WHERE purchase_order_id = po.id ORDER BY line_number) l) AS lines_json
           FROM purchase_orders po WHERE po.order_number = ?`
        )
        .bind(row.order_number)
        .first<{ id: string; status: string; currency: string | null; payable_amount: number | null; lines_json: string }>()
    : null;
  const sender = row.route_message_id
    ? await db
        .prepare("SELECT m.counterparty, s.name AS source FROM route_messages m LEFT JOIN sources s ON s.id = m.instance_id WHERE m.id = ?")
        .bind(row.route_message_id)
        .first<{ counterparty: string | null; source: string | null }>()
    : null;
  const names = async (uid: string | null) => (uid ? ((await db.prepare("SELECT name FROM org_users WHERE id = ?").bind(uid).first<{ name: string }>())?.name ?? null) : null);
  const problems = row.check_json ? (JSON.parse(row.check_json) as Problem[]) : [];
  return {
    id: row.id,
    orderNumber: row.order_number,
    kind: row.kind,
    status: row.status,
    receivedAt: row.created_at,
    from: { source: sender?.source ?? null, sender: sender?.counterparty ?? null, messageId: row.route_message_id },
    company,
    buyerPartyId: parsed.buyerPartyId ?? null,
    supplier,
    sellerPartyId: parsed.sellerPartyId ?? null,
    issueDate: parsed.issueDate ?? null,
    currency: parsed.currency ?? null,
    totals: { lineExtensionAmount: parsed.lineExtensionAmount ?? null, payableAmount: parsed.payableAmount ?? null },
    note: row.note,
    changeReference: row.change_reference,
    sequenceNumber: row.sequence_number,
    lines: row.kind === "cancellation" ? [] : parsed.lines,
    problems,
    blocked: problems.some((p) => BLOCKING.includes(p.code)),
    process: stage ? { status: stage.status, stage: stage.stage, name: stage.process } : null,
    task: task
      ? {
          id: task.id,
          claimedBy: task.claimed_by_name,
          mine: userId !== null && (task.claimed_by === userId || task.owner_user_id === userId),
          canClaim: !task.claimed_by && !task.owner_user_id,
          canRelease: userId !== null && task.claimed_by === userId,
        }
      : null,
    // The companies an order may be for (legal entities), for the person to choose from.
    companies: (await db.prepare("SELECT id, name FROM org_units WHERE kind = 'legal_entity' ORDER BY name").all<{ id: string; name: string }>()).results,
    inForce: inForce ? { status: inForce.status, currency: inForce.currency, payableAmount: inForce.payable_amount, lines: JSON.parse(inForce.lines_json) as unknown[] } : null,
    released: row.status === "released" ? { at: row.released_at, by: await names(row.released_by), anyway: row.release_override === 1 } : null,
    rejected: row.status === "rejected" ? { at: row.rejected_at, by: await names(row.rejected_by), reason: row.reject_reason } : null,
  };
}

/** `GET /purchase-orders/intake/:id`. */
export async function handleGetIntake(db: D1Database, userId: string, id: string): Promise<RouteResult> {
  const view = await intakeView(db, id, userId);
  return view ? { status: 200, body: { order: view } } : notFound;
}

/** `GET /purchase-orders/intake?status=pending` — orders on their way in, newest first (at most 200). */
export async function handleListIntake(db: D1Database, status: string | null): Promise<RouteResult> {
  const wanted = status === "released" || status === "rejected" ? status : "pending";
  const rows = (
    await db
      .prepare(
        `SELECT i.id, i.order_number, i.kind, i.created_at, i.check_json, ou.name AS company,
                json_extract(i.order_json, '$.sellerPartyId') AS seller,
                (SELECT st.name FROM process_instances pi JOIN process_stages st ON st.id = pi.current_stage_id
                 WHERE pi.subject_type = 'purchase_order' AND pi.subject_id = i.id AND pi.status = 'in_progress' LIMIT 1) AS stage,
                (SELECT cu.name FROM tasks t JOIN stage_visits v ON v.id = t.stage_visit_id JOIN process_instances pi ON pi.id = v.process_instance_id
                 LEFT JOIN org_users cu ON cu.id = t.claimed_by
                 WHERE pi.subject_type = 'purchase_order' AND pi.subject_id = i.id AND t.status = 'open' LIMIT 1) AS claimed_by
         FROM purchase_order_intake i LEFT JOIN org_units ou ON ou.id = i.org_unit_id
         WHERE i.status = ? ORDER BY i.created_at DESC, i.rowid DESC LIMIT 200`
      )
      .bind(wanted)
      .all<{ id: string; order_number: string; kind: string; created_at: string; check_json: string | null; company: string | null; seller: string | null; stage: string | null; claimed_by: string | null }>()
  ).results;
  const orders = [];
  for (const r of rows) {
    const supplier = await supplierOfParty(db, r.seller);
    orders.push({
      id: r.id,
      orderNumber: r.order_number,
      kind: r.kind,
      receivedAt: r.created_at,
      company: r.company,
      supplier: supplier?.name ?? r.seller,
      stage: r.stage,
      claimedBy: r.claimed_by,
      problems: r.check_json ? (JSON.parse(r.check_json) as Problem[]).map((p) => p.code) : [],
    });
  }
  return { status: 200, body: { orders } };
}

/**
 * `POST /purchase-orders/intake/:id/fix` `{ orgUnitId?, supplierId? }` —
 * the company the order is for, or the supplier it is with (written into
 * the order as that supplier's VAT number, else its ERP number). Checked
 * again; the order stays where it is until released.
 */
export async function handleFixIntake(db: D1Database, userId: string, id: string, body: Record<string, unknown>): Promise<RouteResult> {
  const found = await pendingRow(db, userId, id);
  if ("status" in found && "body" in found) return found as RouteResult;
  const row = found as IntakeRow;
  const parsed = JSON.parse(row.order_json) as ParsedOrder;
  let orgUnitId = row.org_unit_id;
  if (typeof body.orgUnitId === "string" && body.orgUnitId) {
    const unit = await db.prepare("SELECT id FROM org_units WHERE id = ?").bind(body.orgUnitId).first();
    if (!unit) return { status: 400, body: { error: "no such company", reason: "no_such_company" } };
    orgUnitId = body.orgUnitId;
  }
  if (typeof body.supplierId === "string" && body.supplierId) {
    const s = await db.prepare("SELECT vat_id, erp_identifier FROM suppliers WHERE id = ?").bind(body.supplierId).first<{ vat_id: string | null; erp_identifier: string | null }>();
    const party = s?.vat_id ?? s?.erp_identifier;
    if (!party) return { status: 400, body: { error: "no such supplier, or it has neither a VAT nor an ERP number", reason: "no_such_supplier" } };
    parsed.sellerPartyId = party;
  }
  await db.prepare("UPDATE purchase_order_intake SET org_unit_id = ?, order_json = ? WHERE id = ?").bind(orgUnitId, JSON.stringify(parsed), id).run();
  const updated = (await intakeOf(db, id))!;
  await db.prepare("UPDATE purchase_order_intake SET check_json = ? WHERE id = ?").bind(JSON.stringify(await checkOrder(db, updated)), id).run();
  return { status: 200, body: { order: await intakeView(db, id, userId) } };
}

export interface ContinuedOrder {
  status: "pending" | "released" | "rejected";
  stage: string | null;
  orderNumber: string;
  released: boolean;
}

/**
 * Continues an order's instance after its task is done: visit where it
 * stands, then settle (`settle` is purchase-orders-in's `settleOrderInstance`,
 * passed in to keep the two modules from importing each other).
 */
export async function continueOrderInstance(
  db: D1Database,
  instanceId: string,
  settle: (db: D1Database, instanceId: string) => Promise<{ status: "pending" | "released" | "rejected"; stage: string | null; released: { orderNumber: string } | null }>
): Promise<{ status: "pending" | "released" | "rejected"; stage: string | null; released: { orderNumber: string } | null }> {
  const instance = await db.prepare("SELECT subject_id, status FROM process_instances WHERE id = ? AND subject_type = 'purchase_order'").bind(instanceId).first<{ subject_id: string; status: string }>();
  if (!instance) return { status: "pending", stage: null, released: null };
  if (instance.status === "in_progress") {
    const row = await intakeOf(db, instance.subject_id);
    if (row) {
      const parsed = JSON.parse(row.order_json) as ParsedOrder;
      await visitCurrentStage(db, instanceId, { id: row.id, order_number: row.order_number, org_unit_id: row.org_unit_id, lines: parsed.lines.length, kind: row.kind });
    }
  }
  return settle(db, instanceId);
}

/**
 * `POST /purchase-orders/intake/:id/release` `{ anyway? }` — the task is
 * done and the order goes on. Checked again first: where something is
 * still found it is refused unless `anyway` (the person has seen it),
 * and never where the company is unknown or there is nothing to cancel.
 */
export async function handleReleaseIntake(
  db: D1Database,
  userId: string,
  id: string,
  body: Record<string, unknown>,
  settle: Parameters<typeof continueOrderInstance>[2],
  now = new Date()
): Promise<RouteResult & { released?: string[] }> {
  const found = await pendingRow(db, userId, id);
  if ("status" in found && "body" in found) return found as RouteResult;
  const row = found as IntakeRow;
  const problems = await checkOrder(db, row);
  await db.prepare("UPDATE purchase_order_intake SET check_json = ? WHERE id = ?").bind(JSON.stringify(problems), id).run();
  if (problems.some((p) => BLOCKING.includes(p.code))) return { status: 409, body: { error: "this order cannot be released as it is: fix it or reject it", reason: "order_blocked", problems } };
  if (problems.length > 0 && body.anyway !== true) return { status: 409, body: { error: "Checking still finds something: release it anyway, or fix it", reason: "order_has_problems", problems } };
  const instance = await db
    .prepare("SELECT id FROM process_instances WHERE subject_type = 'purchase_order' AND subject_id = ? AND status = 'in_progress' ORDER BY created_at DESC LIMIT 1")
    .bind(id)
    .first<{ id: string }>();
  if (!instance) return { status: 409, body: { error: "the order is not waiting in the process", reason: "no_instance" } };
  const at = now.toISOString();
  await db.batch([
    db.prepare("UPDATE purchase_order_intake SET release_override = ?, released_by = ? WHERE id = ?").bind(problems.length > 0 ? 1 : 0, userId, id),
    db
      .prepare(
        `UPDATE tasks SET status = 'completed', completed_by = ?, completed_at = ?
         WHERE status = 'open' AND stage_visit_id IN (SELECT id FROM stage_visits WHERE process_instance_id = ?)`
      )
      .bind(userId, at, instance.id),
  ]);
  const outcome = await continueOrderInstance(db, instance.id, settle);
  return {
    status: 200,
    body: { order: await intakeView(db, id, userId), status: outcome.status, stage: outcome.stage },
    released: outcome.released ? [outcome.released.orderNumber] : [],
  };
}

/**
 * `POST /purchase-orders/intake/:id/reject` `{ reason }` — the order is
 * never released; its instance ends as rejected and its task is
 * cancelled. A reason is required.
 */
export async function handleRejectIntake(db: D1Database, userId: string, id: string, body: Record<string, unknown>, now = new Date()): Promise<RouteResult> {
  const found = await pendingRow(db, userId, id);
  if ("status" in found && "body" in found) return found as RouteResult;
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  if (!reason) return { status: 400, body: { error: "say why it is rejected", reason: "reject_reason_missing" } };
  const at = now.toISOString();
  const instances = (await db.prepare("SELECT id FROM process_instances WHERE subject_type = 'purchase_order' AND subject_id = ? AND status = 'in_progress'").bind(id).all<{ id: string }>()).results;
  await db.batch([
    db.prepare("UPDATE purchase_order_intake SET status = 'rejected', rejected_at = ?, rejected_by = ?, reject_reason = ? WHERE id = ? AND status = 'pending'").bind(at, userId, reason, id),
    ...instances.flatMap((i) => [
      db.prepare("UPDATE process_instances SET status = 'rejected', updated_at = ? WHERE id = ?").bind(at, i.id),
      db
        .prepare(
          `UPDATE tasks SET status = 'cancelled', ended_by = ?, ended_at = ?, end_reason = 'order_rejected'
           WHERE status = 'open' AND stage_visit_id IN (SELECT id FROM stage_visits WHERE process_instance_id = ?)`
        )
        .bind(userId, at, i.id),
    ]),
  ]);
  return { status: 200, body: { order: await intakeView(db, id, userId) } };
}

/**
 * `GET /purchase-orders/intake/:id/suppliers?q=` — suppliers to choose
 * from for an order held at Checking, by name, VAT or ERP number, at most
 * 20, active first. Whoever works the order may not hold AP.Supplier.
 */
export async function handleIntakeSuppliers(db: D1Database, q: string): Promise<RouteResult> {
  const like = `%${q.trim().replace(/[%_]/g, "")}%`;
  const rows = (
    await db
      .prepare(
        `SELECT id, name, vat_id, erp_identifier, status FROM suppliers
         WHERE (vat_id IS NOT NULL OR erp_identifier IS NOT NULL) AND (name LIKE ?1 OR vat_id LIKE ?1 OR erp_identifier LIKE ?1)
         ORDER BY status = 'active' DESC, name LIMIT 20`
      )
      .bind(like)
      .all<{ id: string; name: string; vat_id: string | null; erp_identifier: string | null; status: string }>()
  ).results;
  return { status: 200, body: { suppliers: rows.map((r) => ({ id: r.id, name: r.name, vatId: r.vat_id, erpIdentifier: r.erp_identifier, status: r.status })) } };
}
