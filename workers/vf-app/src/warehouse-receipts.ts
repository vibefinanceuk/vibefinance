import type { RouteResult } from "./org-route.js";
import { handleCreateProcessInstance, visitCurrentStage } from "./workflow-engine.js";
import { isWithinScope, unitsWherePermitted } from "./enforce.js";
import { Checker, type ReceiptStatus } from "./goods-receipts.js";

/**
 * **The Warehouse Receipts process — decision 0651**, slice 2 of the
 * Warehouse Receipts proposal (Goods Receipts level 3, agreed with Dan
 * 6 October 2026).
 *
 * A process like the invoice one, with a **goods receipt** as its
 * subject: Intake (where routes will deliver, slice 5), Matching (the
 * built-in check and the AP Receiving task, slice 3), Complete. One
 * instance per receipt.
 *
 * **A receipt counts only once registered.** One sent through the
 * process is pending until the process completes; completing registers
 * it. A person may reject a pending one, with a reason, and it never
 * counts. Keying a receipt on the screen registers it at once.
 *
 * **Set up when asked, with a known id**, as Supplier Maintenance is
 * (0350): `warehouse-receipts`. Until it is set up, receipts register
 * at once, as before, so nothing changes for anyone who does not want
 * it.
 */
export const WAREHOUSE_RECEIPTS_PROCESS_ID = "warehouse-receipts";

/**
 * **The AP Receiving team — decision 0652**, offered when the process is
 * set up (Dan agreed, question 3): Matching's task is owned by it and
 * needs AP.Receive. Where it is missing, the AP team (0480's) stands in.
 */
export const AP_RECEIVING_TEAM_ID = "ap-receiving";

/** What Matching's built-in check is called on a stage (`process_stages.builtin_check`). */
export const RECEIPT_MATCHING_CHECK = "receipt_matching";

const STAGES = [
  { id: "warehouse-receipts-intake", name: "Intake", sequence: 1 },
  { id: "warehouse-receipts-matching", name: "Matching", sequence: 2 },
  { id: "warehouse-receipts-complete", name: "Complete", sequence: 3 },
] as const;

export interface WarehouseProcess {
  id: string;
  name: string;
  stages: { id: string; name: string }[];
}

/** The process, when it is set up and moves goods receipts; otherwise `null`. */
export async function warehouseProcess(db: D1Database): Promise<WarehouseProcess | null> {
  const process = await db
    .prepare("SELECT id, name, version FROM processes WHERE id = ? AND subject_type = 'goods_receipt'")
    .bind(WAREHOUSE_RECEIPTS_PROCESS_ID)
    .first<{ id: string; name: string; version: number }>();
  if (!process) return null;
  const stages = (
    await db
      .prepare(
        `SELECT s.id, s.name FROM process_stage_versions v JOIN process_stages s ON s.id = v.stage_id
         WHERE v.process_id = ? AND v.version = ? ORDER BY v.sequence`
      )
      .bind(process.id, process.version)
      .all<{ id: string; name: string }>()
  ).results;
  return { id: process.id, name: process.name, stages };
}

/** `GET /goods-receipts/process` — whether it is set up, for the screen and AP Setup. */
export async function handleGetWarehouseProcess(db: D1Database): Promise<RouteResult> {
  return { status: 200, body: { process: await warehouseProcess(db) } };
}

/**
 * `POST /goods-receipts/process` — sets it up: the process, its three
 * stages in version 1, Intake as its entry and Complete as its exit.
 * Asking again when it is there changes nothing. `name` is the
 * process's name in the person's words (the screen sends it in their
 * language); "Warehouse Receipts" otherwise.
 */
export async function handleSetUpWarehouseProcess(db: D1Database, body: Record<string, unknown>): Promise<RouteResult> {
  const existing = await warehouseProcess(db);
  if (existing) return { status: 200, body: { process: existing, created: false } };
  const taken = await db.prepare("SELECT subject_type FROM processes WHERE id = ?").bind(WAREHOUSE_RECEIPTS_PROCESS_ID).first();
  if (taken) return { status: 409, body: { error: `a process with id ${WAREHOUSE_RECEIPTS_PROCESS_ID} already moves something else`, reason: "process_id_taken" } };
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 80) : "Warehouse Receipts";
  const stageNames = (body.stageNames ?? {}) as Record<string, unknown>;
  const stageName = (s: (typeof STAGES)[number]) => {
    const given = stageNames[s.name.toLowerCase()];
    return typeof given === "string" && given.trim() ? given.trim().slice(0, 60) : s.name;
  };
  const p = WAREHOUSE_RECEIPTS_PROCESS_ID;
  await db.batch([
    db.prepare("INSERT INTO processes (id, name, subject_type) VALUES (?, ?, 'goods_receipt')").bind(p, name),
    ...STAGES.map((s) =>
      db
        .prepare("INSERT INTO process_stages (id, process_id, name, sequence, rule_set_id, evaluation_scope, required_permission, builtin_check) VALUES (?, ?, ?, ?, NULL, 'header', ?, ?)")
        .bind(s.id, p, stageName(s), s.sequence, s.sequence === 2 ? "AP.Receive" : null, s.sequence === 2 ? RECEIPT_MATCHING_CHECK : null)
    ),
    ...STAGES.map((s) => db.prepare("INSERT INTO process_stage_versions (process_id, version, stage_id, sequence) VALUES (?, 1, ?, ?)").bind(p, s.id, s.sequence)),
    db.prepare("UPDATE processes SET entry_stage_id = ?, exit_stage_id = ? WHERE id = ?").bind(STAGES[0].id, STAGES[2].id, p),
  ]);
  const team = await ensureReceivingTeam(db, typeof body.teamName === "string" && body.teamName.trim() ? body.teamName.trim().slice(0, 60) : "AP Receiving");
  return { status: 201, body: { process: await warehouseProcess(db), created: true, team } };
}

/**
 * **The AP Receiving team**, made with the process if it is not there:
 * in the AP team's unit (else the top unit), with everyone who holds
 * AP.Receive as a member. `null` when there is no unit to put it in.
 */
async function ensureReceivingTeam(db: D1Database, name: string): Promise<{ id: string; name: string; members: number } | null> {
  const existing = await db.prepare("SELECT id, name FROM org_teams WHERE id = ?").bind(AP_RECEIVING_TEAM_ID).first<{ id: string; name: string }>();
  if (!existing) {
    const unit =
      (await db.prepare("SELECT unit_id AS id FROM org_teams WHERE id = 'ap-team'").first<{ id: string }>()) ??
      (await db.prepare("SELECT id FROM org_units WHERE parent_unit_id IS NULL ORDER BY created_at, id LIMIT 1").first<{ id: string }>());
    if (!unit) return null;
    await db.prepare("INSERT INTO org_teams (id, name, unit_id) VALUES (?, ?, ?)").bind(AP_RECEIVING_TEAM_ID, name, unit.id).run();
    await db
      .prepare(
        `INSERT OR IGNORE INTO org_team_members (team_id, user_id)
         SELECT DISTINCT ?, ur.user_id FROM org_user_roles ur JOIN org_roles r ON r.id = ur.role_id
         WHERE EXISTS (SELECT 1 FROM json_each(r.permissions_json) p WHERE p.value = 'AP.Receive')`
      )
      .bind(AP_RECEIVING_TEAM_ID)
      .run();
  }
  const members = (await db.prepare("SELECT count(*) AS n FROM org_team_members WHERE team_id = ?").bind(AP_RECEIVING_TEAM_ID).first<{ n: number }>())?.n ?? 0;
  return { id: AP_RECEIVING_TEAM_ID, name: existing?.name ?? name, members };
}

// ── Matching's check ───────────────────────────────────────────────────

export interface CheckedLine {
  lineNumber: number;
  status: "active" | "rejected";
  reason: string | null;
  message: string | null;
  over: { ordered: number; netAfter: number } | null;
  /** 0654: its order is not loaded yet, or it was held back when the receipt registered; since when. */
  waitingSince: string | null;
}

export interface CheckedReceipt {
  lines: CheckedLine[];
  /** Lines a person must fix or reject (not those only waiting for their order). */
  attention: number;
  /** Lines waiting for their order (0654). */
  waiting: number;
  /** Lines that match now. */
  matched: number;
  active: number;
  /** On a registered receipt: orders of lines that waited and now match, so now count. */
  released: string[];
}

/**
 * **Each line of a receipt checked against its order — decision 0652**,
 * as the screen checks (`Checker`), in the scope of whoever sent it,
 * lines in order so a receipt that receives then returns is judged as
 * it reads. A rejected line is left out. What it finds is stored on
 * each line (`check_reason`), for the pop-out and the task.
 *
 * **Waiting — decision 0654.** A line whose order is not loaded waits
 * (`waiting_since`, kept from when it started). On a **registered**
 * receipt only its held-back lines are checked (the rest already
 * count, so are in what is held): one that now matches stops waiting
 * and counts; one that still does not stays held back, whatever the
 * reason now is.
 */
export async function checkReceiptLines(db: D1Database, receiptId: string, now = new Date()): Promise<CheckedReceipt> {
  const receipt = await db.prepare("SELECT created_by, status FROM goods_receipts WHERE id = ?").bind(receiptId).first<{ created_by: string | null; status: ReceiptStatus }>();
  const registered = receipt?.status === "registered";
  const scope = receipt?.created_by ? await unitsWherePermitted(db, receipt.created_by, "AP.Receive") : null;
  const checker = new Checker(db, scope);
  const rows = (
    await db
      .prepare(
        `SELECT line_number, order_number, order_line_number, movement, quantity, unit_code, return_reason_id, line_status, waiting_since
         FROM goods_receipt_lines WHERE receipt_id = ? ORDER BY line_number`
      )
      .bind(receiptId)
      .all<{ line_number: number; order_number: string; order_line_number: number; movement: string; quantity: number; unit_code: string | null; return_reason_id: string | null; line_status: "active" | "rejected"; waiting_since: string | null }>()
  ).results;
  const at = now.toISOString();
  const lines: CheckedLine[] = [];
  const updates = [];
  const released = new Set<string>();
  for (const r of rows) {
    if (r.line_status === "rejected") {
      lines.push({ lineNumber: r.line_number, status: "rejected", reason: null, message: null, over: null, waitingSince: null });
      continue;
    }
    if (registered && !r.waiting_since) {
      // Already counted: it is in what is held, and is not judged again.
      lines.push({ lineNumber: r.line_number, status: "active", reason: null, message: null, over: null, waitingSince: null });
      continue;
    }
    const result = await checker.checkLenient({
      orderNumber: r.order_number,
      orderLine: r.order_line_number,
      quantity: r.quantity,
      movement: r.movement,
      returnReason: r.return_reason_id,
      unitCode: r.unit_code,
    });
    const found = "refused" in result ? result.refused : result.attention;
    if (!found && !("refused" in result)) checker.commit(result.line.orderNumber, result.line.orderLine, result.line.movement, result.line.quantity);
    const over = !("refused" in result) && result.over ? { ordered: result.over.ordered, netAfter: result.over.netAfter } : null;
    const waitingSince = registered ? (found ? r.waiting_since : null) : found?.reason === "order_not_loaded" ? r.waiting_since ?? at : null;
    if (registered && r.waiting_since && !waitingSince) released.add(r.order_number);
    lines.push({ lineNumber: r.line_number, status: "active", reason: found?.reason ?? null, message: found?.message ?? null, over, waitingSince });
    updates.push(
      db.prepare("UPDATE goods_receipt_lines SET check_reason = ?, waiting_since = ? WHERE receipt_id = ? AND line_number = ?").bind(found?.reason ?? null, waitingSince, receiptId, r.line_number)
    );
  }
  if (updates.length > 0) await db.batch(updates);
  const active = lines.filter((l) => l.status === "active");
  const waiting = active.filter((l) => l.waitingSince).length;
  return {
    lines,
    attention: active.filter((l) => l.reason && l.reason !== "order_not_loaded").length,
    waiting,
    matched: active.filter((l) => !l.reason && !l.waitingSince).length,
    active: active.length,
    released: [...released],
  };
}

/**
 * **Matching's built-in check, run by the engine** at a stage marked
 * `receipt_matching` for a goods receipt. Every line matched: on it
 * goes. Otherwise it stops here with **one task for the receipt** (Dan:
 * one task per receipt) for AP Receiving, needing AP.Receive, or for the
 * AP team where AP Receiving is missing; with neither it still stops,
 * and the receipt's pop-out is where it is worked.
 */
export async function receiptMatchingGuard(db: D1Database, stage: { id: string; required_permission: string | null }, receiptId: string, visitId: string): Promise<{ stop: boolean; tasksCreated: number }> {
  const checked = await checkReceiptLines(db, receiptId);
  // 0654: lines only waiting for their order pass when Register asked for the rest (they stay held back).
  const partial = (await db.prepare("SELECT register_partial FROM goods_receipts WHERE id = ?").bind(receiptId).first<{ register_partial: number }>())?.register_partial === 1;
  if (checked.attention === 0 && (checked.waiting === 0 || partial)) return { stop: false, tasksCreated: 0 };
  const team =
    (await db.prepare("SELECT id FROM org_teams WHERE id = ?").bind(AP_RECEIVING_TEAM_ID).first<{ id: string }>()) ??
    (await db.prepare("SELECT id FROM org_teams WHERE id = 'ap-team'").first<{ id: string }>());
  if (!team) return { stop: true, tasksCreated: 0 };
  const taskId = crypto.randomUUID();
  await db
    .prepare(
      // No rule raised it: the stage's own check did (tasks.system_reason's list is closed, 0080).
      `INSERT INTO tasks (id, stage_id, owner_team_id, required_permission, stage_visit_id, created_at)
       VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'))`
    )
    .bind(taskId, stage.id, team.id, stage.required_permission ?? "AP.Receive", visitId)
    .run();
  return { stop: true, tasksCreated: 1 };
}

export interface Touched {
  orderNumber: string;
  receiptNumber: string;
}

async function touchedBy(db: D1Database, receiptId: string): Promise<Touched[]> {
  return (
    await db
      .prepare(
        `SELECT DISTINCT l.order_number AS orderNumber, r.receipt_number AS receiptNumber
         FROM goods_receipt_lines l JOIN goods_receipts r ON r.id = l.receipt_id WHERE r.id = ? AND l.line_status = 'active' AND l.waiting_since IS NULL`
      )
      .bind(receiptId)
      .all<Touched>()
  ).results;
}

/**
 * **Registering** — the process has completed. Only a pending receipt
 * moves; the orders it names are returned for the re-check of invoices
 * waiting on these goods (0648).
 */
export async function registerReceipt(db: D1Database, receiptId: string, now = new Date()): Promise<Touched[]> {
  const done = await db
    .prepare("UPDATE goods_receipts SET status = 'registered', registered_at = ? WHERE id = ? AND status = 'pending'")
    .bind(now.toISOString(), receiptId)
    .run();
  return done.meta.changes > 0 ? touchedBy(db, receiptId) : [];
}

async function receiptFacts(db: D1Database, receiptId: string): Promise<Record<string, unknown> | null> {
  const r = await db
    .prepare(
      `SELECT r.id, r.receipt_number, r.receipt_date, r.source, r.delivery_note,
              (SELECT count(*) FROM goods_receipt_lines l WHERE l.receipt_id = r.id) AS lines
       FROM goods_receipts r WHERE r.id = ?`
    )
    .bind(receiptId)
    .first<{ id: string; receipt_number: string; receipt_date: string; source: string; delivery_note: string | null; lines: number }>();
  if (!r) return null;
  return { id: r.id, receipt_number: r.receipt_number, receipt_date: r.receipt_date, source: r.source, delivery_note: r.delivery_note, lines: r.lines };
}

export interface SentReceipt {
  receiptId: string;
  instanceId: string | null;
  status: ReceiptStatus;
  stage: string | null;
}

/**
 * **Sending pending receipts through the process.** Each gets its own
 * instance and visits Intake, then on. One that reaches the end is
 * registered there and then; one stopped on the way stays pending at
 * that stage. A receipt the process cannot take (no process, or a
 * stage refusing) also stays pending, and says so.
 */
export async function sendReceiptsThroughProcess(
  db: D1Database,
  receiptIds: string[],
  now = new Date()
): Promise<{ sent: SentReceipt[]; touched: Touched[] }> {
  const sent: SentReceipt[] = [];
  const touched: Touched[] = [];
  const process = await warehouseProcess(db);
  for (const receiptId of receiptIds) {
    const facts = await receiptFacts(db, receiptId);
    if (!process || !facts) {
      sent.push({ receiptId, instanceId: null, status: "pending", stage: null });
      continue;
    }
    const created = await handleCreateProcessInstance(db, process.id, { subjectType: "goods_receipt", subjectId: receiptId });
    if (created.status >= 400) {
      sent.push({ receiptId, instanceId: null, status: "pending", stage: null });
      continue;
    }
    const instanceId = (created.body as { id: string }).id;
    const visit = await visitCurrentStage(db, instanceId, facts);
    const outcome = await settleReceiptInstance(db, instanceId, now);
    touched.push(...outcome.touched);
    sent.push({ receiptId, instanceId, status: outcome.status, stage: visit.status >= 400 ? null : outcome.stage });
  }
  return { sent, touched };
}

/**
 * **Where a receipt's instance has got to**, after any visit: completed
 * means registered. Called after sending, and after a task on it is
 * completed (index.ts `followUpAfterTaskCompletion`).
 */
export async function settleReceiptInstance(
  db: D1Database,
  instanceId: string,
  now = new Date()
): Promise<{ status: ReceiptStatus; stage: string | null; touched: Touched[] }> {
  const row = await db
    .prepare(
      `SELECT pi.subject_id, pi.status, st.name AS stage, r.status AS receipt_status
       FROM process_instances pi LEFT JOIN process_stages st ON st.id = pi.current_stage_id
       JOIN goods_receipts r ON r.id = pi.subject_id
       WHERE pi.id = ? AND pi.subject_type = 'goods_receipt'`
    )
    .bind(instanceId)
    .first<{ subject_id: string; status: string; stage: string | null; receipt_status: ReceiptStatus }>();
  if (!row) return { status: "pending", stage: null, touched: [] };
  if (row.status === "completed" && row.receipt_status === "pending") {
    return { status: "registered", stage: null, touched: await registerReceipt(db, row.subject_id, now) };
  }
  return { status: row.receipt_status, stage: row.status === "in_progress" ? row.stage : null, touched: [] };
}

/** Continues a receipt's instance after a task on it is completed: visit where it stands, then settle. */
export async function continueReceiptInstance(db: D1Database, instanceId: string, now = new Date()): Promise<Touched[]> {
  const instance = await db
    .prepare("SELECT subject_id, status FROM process_instances WHERE id = ? AND subject_type = 'goods_receipt'")
    .bind(instanceId)
    .first<{ subject_id: string; status: string }>();
  if (!instance) return [];
  if (instance.status === "in_progress") {
    const facts = await receiptFacts(db, instance.subject_id);
    if (facts) await visitCurrentStage(db, instanceId, facts);
  }
  return (await settleReceiptInstance(db, instanceId, now)).touched;
}

/**
 * `POST /goods-receipts/:id/reject` — a pending receipt is rejected,
 * with a reason, and never counts. Its instance ends as rejected, and
 * any task open on it is cancelled. AP.Receive, in the units of the
 * orders it names (404 outside them, as for cancelling). A registered
 * receipt is cancelled instead, as before.
 */
export async function handleRejectGoodsReceipt(db: D1Database, userId: string, id: string, body: Record<string, unknown>, now = new Date()): Promise<RouteResult> {
  const notFound = { status: 404, body: { error: "no such receipt", reason: "not_found" } };
  const receipt = await db.prepare("SELECT id, receipt_number, status FROM goods_receipts WHERE id = ?").bind(id).first<{ id: string; receipt_number: string; status: ReceiptStatus }>();
  if (!receipt) return notFound;
  const scope = await unitsWherePermitted(db, userId, "AP.Receive");
  const orders = (
    await db
      .prepare("SELECT DISTINCT po.org_unit_id FROM goods_receipt_lines l JOIN purchase_orders po ON po.order_number = l.order_number WHERE l.receipt_id = ?")
      .bind(id)
      .all<{ org_unit_id: string | null }>()
  ).results;
  if (orders.some((o) => !isWithinScope({ units: scope }, o.org_unit_id))) return notFound;
  if (receipt.status === "registered") return { status: 409, body: { error: "that receipt is registered: cancel it instead", reason: "receipt_registered" } };
  if (receipt.status === "rejected") return { status: 409, body: { error: "that receipt is already rejected", reason: "already_rejected" } };
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) return { status: 400, body: { error: "say why it is rejected", reason: "reject_reason_missing" } };

  const at = now.toISOString();
  const instances = (
    await db
      .prepare("SELECT id FROM process_instances WHERE subject_type = 'goods_receipt' AND subject_id = ? AND status = 'in_progress'")
      .bind(id)
      .all<{ id: string }>()
  ).results;
  await db.batch([
    db
      .prepare("UPDATE goods_receipts SET status = 'rejected', rejected_at = ?, rejected_by = ?, reject_reason = ? WHERE id = ? AND status = 'pending'")
      .bind(at, userId, reason, id),
    ...instances.flatMap((i) => [
      db.prepare("UPDATE process_instances SET status = 'rejected', updated_at = ? WHERE id = ?").bind(at, i.id),
      db
        .prepare(
          `UPDATE tasks SET status = 'cancelled', ended_by = ?, ended_at = ?, end_reason = 'receipt_rejected'
           WHERE status = 'open' AND stage_visit_id IN (SELECT id FROM stage_visits WHERE process_instance_id = ?)`
        )
        .bind(userId, at, i.id),
    ]),
  ]);
  return { status: 200, body: { id, receiptNumber: receipt.receipt_number, status: "rejected" } };
}

// ── Working a receipt at Matching ──────────────────────────────────────

async function pendingInScope(db: D1Database, userId: string, id: string, waitingLine: number | null = null): Promise<RouteResult | { receipt: { id: string; receipt_number: string; status: ReceiptStatus }; scope: string[] | null }> {
  const notFound = { status: 404, body: { error: "no such receipt", reason: "not_found" } };
  const receipt = await db.prepare("SELECT id, receipt_number, status FROM goods_receipts WHERE id = ?").bind(id).first<{ id: string; receipt_number: string; status: ReceiptStatus }>();
  if (!receipt) return notFound;
  const scope = await unitsWherePermitted(db, userId, "AP.Receive");
  const units = (
    await db
      .prepare("SELECT DISTINCT po.org_unit_id FROM goods_receipt_lines l JOIN purchase_orders po ON po.order_number = l.order_number WHERE l.receipt_id = ?")
      .bind(id)
      .all<{ org_unit_id: string | null }>()
  ).results;
  if (units.some((o) => !isWithinScope({ units: scope }, o.org_unit_id))) return notFound;
  // 0654: a line held back on a registered receipt is still worked, until it counts.
  const heldBack =
    receipt.status === "registered" &&
    waitingLine !== null &&
    (await db.prepare("SELECT 1 FROM goods_receipt_lines WHERE receipt_id = ? AND line_number = ? AND waiting_since IS NOT NULL AND line_status = 'active'").bind(id, waitingLine).first()) !== null;
  if (receipt.status !== "pending" && !heldBack) return { status: 409, body: { error: `that receipt is ${receipt.status}`, reason: `receipt_${receipt.status}` } };
  return { receipt, scope };
}

/**
 * `POST /goods-receipts/:id/lines/:line` — **fixing one line of a pending
 * receipt**: `{ orderNumber, orderLine }` points it at another order or
 * order line (one in the person's scope), or `{ reject: true, reason }`
 * rejects that line alone, so it never counts. Then every line is
 * checked again and returned. AP.Receive.
 */
export async function handleFixReceiptLine(db: D1Database, userId: string, id: string, lineNumber: number, body: Record<string, unknown>): Promise<RouteResult> {
  const found = await pendingInScope(db, userId, id, lineNumber);
  if ("status" in found) return found;
  const line = await db.prepare("SELECT line_status FROM goods_receipt_lines WHERE receipt_id = ? AND line_number = ?").bind(id, lineNumber).first<{ line_status: string }>();
  if (!line) return { status: 404, body: { error: `the receipt has no line ${lineNumber}`, reason: "line_not_found" } };

  if (body.reject === true) {
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) return { status: 400, body: { error: "say why the line is rejected", reason: "reject_reason_missing" } };
    await db.prepare("UPDATE goods_receipt_lines SET line_status = 'rejected', reject_reason = ?, check_reason = NULL WHERE receipt_id = ? AND line_number = ?").bind(reason, id, lineNumber).run();
  } else {
    if (line.line_status === "rejected") return { status: 409, body: { error: "that line is rejected", reason: "line_rejected" } };
    const orderNumber = typeof body.orderNumber === "string" ? body.orderNumber.trim() : "";
    const orderLine = Number(body.orderLine);
    if (!orderNumber || !Number.isInteger(orderLine) || orderLine < 1) return { status: 400, body: { error: "an order number and order line are needed", reason: "order_line_missing" } };
    const order = await db.prepare("SELECT org_unit_id FROM purchase_orders WHERE order_number = ?").bind(orderNumber).first<{ org_unit_id: string | null }>();
    if (!order || !isWithinScope({ units: found.scope }, order.org_unit_id)) return { status: 422, body: { error: `no purchase order ${orderNumber}`, reason: "order_not_found" } };
    await db.prepare("UPDATE goods_receipt_lines SET order_number = ?, order_line_number = ? WHERE receipt_id = ? AND line_number = ?").bind(orderNumber, orderLine, id, lineNumber).run();
  }
  const checked = await checkReceiptLines(db, id);
  // 0654: a held-back line that now matches counts, so invoices waiting on it are checked again.
  const touched = checked.released.map((orderNumber) => ({ orderNumber, receiptNumber: found.receipt.receipt_number }));
  return { status: 200, body: { id, ...checked, touched } };
}

/**
 * `POST /goods-receipts/:id/register` — **Register**, from the receipt's
 * pop-out. Every line still in it is checked again; any needing
 * attention refuses, saying which. Otherwise the task on it is done (by
 * this person), the receipt goes on through the process, and on
 * reaching the end is registered; the orders it names are returned for
 * the re-check of invoices (0648). A receipt with every line rejected
 * is rejected instead.
 */
export async function handleRegisterGoodsReceipt(db: D1Database, userId: string, id: string, now = new Date()): Promise<RouteResult> {
  const found = await pendingInScope(db, userId, id);
  if ("status" in found) return found;
  const checked = await checkReceiptLines(db, id);
  if (checked.active === 0) return { status: 409, body: { error: "every line is rejected: reject the receipt instead", reason: "no_lines_left" } };
  if (checked.attention > 0) return { status: 409, body: { error: "some lines still need attention", reason: "lines_need_attention", lines: checked.lines } };
  /**
   * **Matched lines while one waits — decision 0654** (Dan agreed,
   * question 4). Those waiting for their order are held back on the
   * receipt and count once it is loaded; with none matched yet there is
   * nothing to register.
   */
  if (checked.matched === 0) return { status: 409, body: { error: "every line still waits for its purchase order", reason: "all_waiting" } };
  if (checked.waiting > 0) await db.prepare("UPDATE goods_receipts SET register_partial = 1 WHERE id = ?").bind(id).run();

  const instance = await db
    .prepare("SELECT id FROM process_instances WHERE subject_type = 'goods_receipt' AND subject_id = ? AND status = 'in_progress' ORDER BY created_at DESC LIMIT 1")
    .bind(id)
    .first<{ id: string }>();
  if (!instance) {
    // Pending with no process to finish (it was never sent): registered here.
    return { status: 200, body: { id, receiptNumber: found.receipt.receipt_number, status: "registered", touched: await registerReceipt(db, id, now) } };
  }
  const at = now.toISOString();
  await db
    .prepare(
      `UPDATE tasks SET status = 'completed', completed_by = ?, completed_at = ?, claimed_by = COALESCE(claimed_by, ?), claimed_at = COALESCE(claimed_at, ?)
       WHERE status = 'open' AND stage_visit_id IN (SELECT id FROM stage_visits WHERE process_instance_id = ?)`
    )
    .bind(userId, at, userId, at, instance.id)
    .run();
  const touched = await continueReceiptInstance(db, instance.id, now);
  const after = await db.prepare("SELECT status FROM goods_receipts WHERE id = ?").bind(id).first<{ status: ReceiptStatus }>();
  return { status: 200, body: { id, receiptNumber: found.receipt.receipt_number, status: after?.status ?? "pending", touched } };
}

/** Whether a task is Matching's own receipt task (raised by the check, not a rule): it is done by Register, not Complete. */
export async function isReceiptMatchingTask(db: D1Database, taskId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 FROM tasks t JOIN process_stages s ON s.id = t.stage_id WHERE t.id = ? AND t.rule_id IS NULL AND s.builtin_check = ?")
    .bind(taskId, RECEIPT_MATCHING_CHECK)
    .first();
  return row !== null;
}

/**
 * **Loading a purchase order checks the receipts waiting for it —
 * decision 0654**, as goods arriving checks invoices (0648). For each
 * receipt with a line waiting on one of these orders:
 *
 * - **pending at Matching**: every line is checked again. Nothing left
 *   to fix or wait for: its task closes itself (ended by whoever loaded
 *   the order, `po:<order>`) and it goes on to be registered;
 * - **registered with lines held back**: each that now matches counts.
 *
 * Returns how many receipts registered, how many lines now count, and
 * the orders they touch, for the re-check of invoices.
 */
export async function releaseWaitingReceipts(
  db: D1Database,
  orderNumbers: string[],
  actorUserId: string,
  now = new Date()
): Promise<{ registered: number; linesReleased: number; stillWaiting: number; touched: Touched[] }> {
  const out = { registered: 0, linesReleased: 0, stillWaiting: 0, touched: [] as Touched[] };
  const orders = [...new Set(orderNumbers.filter(Boolean))];
  if (orders.length === 0) return out;
  const receipts = (
    await db
      .prepare(
        `SELECT DISTINCT r.id, r.receipt_number, r.status FROM goods_receipt_lines l JOIN goods_receipts r ON r.id = l.receipt_id
         WHERE l.waiting_since IS NOT NULL AND l.line_status = 'active' AND r.status IN ('pending', 'registered')
           AND l.order_number IN (SELECT value FROM json_each(?))`
      )
      .bind(JSON.stringify(orders))
      .all<{ id: string; receipt_number: string; status: ReceiptStatus }>()
  ).results;
  const at = now.toISOString();
  for (const r of receipts) {
    if (r.status === "registered") {
      const before = (await db.prepare("SELECT count(*) AS n FROM goods_receipt_lines WHERE receipt_id = ? AND waiting_since IS NOT NULL").bind(r.id).first<{ n: number }>())?.n ?? 0;
      const checked = await checkReceiptLines(db, r.id, now);
      out.linesReleased += before - checked.waiting;
      if (checked.waiting > 0) out.stillWaiting++;
      out.touched.push(...checked.released.map((orderNumber) => ({ orderNumber, receiptNumber: r.receipt_number })));
      continue;
    }
    const checked = await checkReceiptLines(db, r.id, now);
    if (checked.attention > 0 || checked.waiting > 0) {
      out.stillWaiting++;
      continue;
    }
    const instance = await db
      .prepare("SELECT id FROM process_instances WHERE subject_type = 'goods_receipt' AND subject_id = ? AND status = 'in_progress' ORDER BY created_at DESC LIMIT 1")
      .bind(r.id)
      .first<{ id: string }>();
    if (!instance) continue;
    await db
      .prepare(
        `UPDATE tasks SET status = 'cancelled', ended_by = ?, ended_at = ?, end_reason = ?
         WHERE status = 'open' AND stage_visit_id IN (SELECT id FROM stage_visits WHERE process_instance_id = ?)`
      )
      .bind(actorUserId, at, `po:${orders.join(",")}`.slice(0, 200), instance.id)
      .run();
    const touched = await continueReceiptInstance(db, instance.id, now);
    const after = await db.prepare("SELECT status FROM goods_receipts WHERE id = ?").bind(r.id).first<{ status: ReceiptStatus }>();
    if (after?.status === "registered") out.registered++;
    out.touched.push(...touched);
  }
  return out;
}

