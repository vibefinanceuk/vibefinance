import type { RouteResult } from "./org-route.js";
import { handleCreateProcessInstance, visitCurrentStage } from "./workflow-engine.js";
import { isWithinScope, unitsWherePermitted } from "./enforce.js";
import type { ReceiptStatus } from "./goods-receipts.js";

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
      db.prepare("INSERT INTO process_stages (id, process_id, name, sequence, rule_set_id, evaluation_scope) VALUES (?, ?, ?, ?, NULL, 'header')").bind(s.id, p, stageName(s), s.sequence)
    ),
    ...STAGES.map((s) => db.prepare("INSERT INTO process_stage_versions (process_id, version, stage_id, sequence) VALUES (?, 1, ?, ?)").bind(p, s.id, s.sequence)),
    db.prepare("UPDATE processes SET entry_stage_id = ?, exit_stage_id = ? WHERE id = ?").bind(STAGES[0].id, STAGES[2].id, p),
  ]);
  return { status: 201, body: { process: await warehouseProcess(db), created: true } };
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
         FROM goods_receipt_lines l JOIN goods_receipts r ON r.id = l.receipt_id WHERE r.id = ?`
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
