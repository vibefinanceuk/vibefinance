/**
 * **Who is in a goods receipt's conversation, and what happened to it —
 * decision 0658.** Kept apart from `goods-receipts.ts` and
 * `receipt-timeline.ts` so either can use it without importing the
 * other.
 */

/** Rows of `goods_receipts r` the person was added to, by name or through a team. Binds the user's id twice. */
export const COLLABORATING_SQL = `r.id IN (
  SELECT c.receipt_id FROM goods_receipt_collaborators c
  WHERE c.removed_at IS NULL AND (c.user_id = ? OR c.team_id IN (SELECT m.team_id FROM org_team_members m WHERE m.user_id = ?)))`;

/** Whether the person is in the receipt's conversation, by name or through a team. */
export async function isReceiptCollaborator(db: D1Database, userId: string, receiptId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 FROM goods_receipt_collaborators c
       WHERE c.receipt_id = ? AND c.removed_at IS NULL
         AND (c.user_id = ? OR c.team_id IN (SELECT m.team_id FROM org_team_members m WHERE m.user_id = ?))
       LIMIT 1`
    )
    .bind(receiptId, userId, userId)
    .first();
  return row !== null;
}

/**
 * One thing that happened to a receipt that its own columns cannot say
 * (`goods_receipt_events`). Returned as a statement, for a batch.
 */
export function receiptEvent(
  db: D1Database,
  receiptId: string,
  kind: string,
  actorId: string | null,
  detail: Record<string, unknown> | null = null,
  lineNumber: number | null = null,
  at = new Date().toISOString()
): D1PreparedStatement {
  return db
    .prepare("INSERT INTO goods_receipt_events (id, receipt_id, at, actor_id, kind, line_number, detail_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), receiptId, at, actorId, kind, lineNumber, detail ? JSON.stringify(detail) : null);
}
