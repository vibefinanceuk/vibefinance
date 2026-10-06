import { checkTaskRule } from "./stage-actions-route.js";
import { onTaskCompleted } from "./workflow-engine.js";

/**
 * **The re-check when goods arrive — decision 0648**, the last part of
 * Stage 2 of the Goods Receipts proposal (0643). Without it, every
 * *Awaiting receipt* task would be cleared by hand each time the
 * warehouse loaded a file.
 *
 * When a receipt, a return or a cancellation is saved, each invoice
 * naming that order (BT-13) whose instance is in progress is looked at.
 * Every open task at its current stage that a **receipt rule** raised —
 * a rule reading `po.line_receipt_matched`,
 * `po.line_receipt_shortfall_pct` or `po.line_credit_expected` — is
 * checked against the invoice's live facts, with the rule version that
 * raised it (`checkTaskRule`, 0487's own check):
 *
 * - **no longer fires** → the task is closed (`cancelled`, as a task
 *   made moot is), ended by whoever recorded the receipt, with
 *   `end_reason` `receipt:<number>`; the Timeline says so. If it was the
 *   stage's last open task, the instance moves on exactly as when a
 *   person completes the last one (`onTaskCompleted`, then the
 *   caller's follow-up visit);
 * - **still fires** → left open; the PO matching panel shows the new
 *   figures;
 * - **cannot be told** → left alone.
 *
 * **Only receipt-rule tasks.** A price, quantity or approval task is
 * never touched, however its rule would read now. A return can make a
 * *Credit expected* rule fire where it did not; that new task arrives
 * the next time the stage is evaluated, as any rule's does — this
 * re-check only ever closes.
 */

const RECEIPT_FACTS = ["po.line_receipt_matched", "po.line_receipt_shortfall_pct", "po.line_credit_expected"];

export function readsReceiptFacts(compiledJson: string | null): boolean {
  return !!compiledJson && RECEIPT_FACTS.some((f) => compiledJson.includes(`"${f}"`));
}

export interface ReceiptRecheckResult {
  closed: { taskId: string; invoiceId: string; orderNumber: string }[];
  stillOpen: number;
}

export async function recheckReceiptTasks(
  db: D1Database,
  touched: { orderNumber: string; receiptNumber: string }[],
  actorUserId: string | null,
  /** Visits the instance's new stage after the last task closed — the same follow-up a person's Complete gets. */
  followUp: (instanceId: string) => Promise<void>,
  now = new Date()
): Promise<ReceiptRecheckResult> {
  const result: ReceiptRecheckResult = { closed: [], stillOpen: 0 };
  const byOrder = new Map<string, string>();
  for (const t of touched) byOrder.set(t.orderNumber, t.receiptNumber);

  for (const [orderNumber, receiptNumber] of byOrder) {
    const tasks = (
      await db
        .prepare(
          `SELECT t.id AS task_id, pi.id AS instance_id, pi.subject_id AS invoice_id
           FROM tasks t
           JOIN stage_visits v ON v.id = t.stage_visit_id
           JOIN process_instances pi ON pi.id = v.process_instance_id
           JOIN invoice_headers h ON h.id = pi.subject_id
           WHERE pi.subject_type = 'invoice' AND pi.status = 'in_progress'
             AND v.stage_id = pi.current_stage_id
             AND t.status = 'open' AND t.rule_id IS NOT NULL
             AND json_extract(h.facts_json, '$."BT-13"') = ?
           ORDER BY t.created_at, t.id`
        )
        .bind(orderNumber)
        .all<{ task_id: string; instance_id: string; invoice_id: string }>()
    ).results;

    for (const task of tasks) {
      const check = await checkTaskRule(db, task.task_id);
      if (!readsReceiptFacts(check.compiledJson)) continue;
      if (check.state !== "cleared") {
        if (check.state === "fires") result.stillOpen++;
        continue;
      }
      const ended = await db
        .prepare("UPDATE tasks SET status = 'cancelled', ended_by = ?, ended_at = ?, end_reason = ? WHERE id = ? AND status = 'open'")
        .bind(actorUserId, now.toISOString(), `receipt:${receiptNumber}`, task.task_id)
        .run();
      if (ended.meta.changes === 0) continue;
      result.closed.push({ taskId: task.task_id, invoiceId: task.invoice_id, orderNumber });
      const cascade = await onTaskCompleted(db, task.task_id);
      if (cascade.needsEvaluationAt) await followUp(cascade.needsEvaluationAt.instanceId);
    }
  }
  return result;
}
