import type { RouteResult } from "./examples-route.js";

/**
 * "Add person to conversation" — decision 0468's own replacement for a
 * derived-ownership access check, built in decision 0470.
 *
 * **Explicit invitation, not derived ownership.** `invoice_collaborators`
 * (migration 0078) is what Chat/Timeline access, and now the invoice
 * itself, actually check for a `Procurement.Collaborate` holder —
 * `purchase_orders.buyer_user_id` is a sensible default to pre-fill this
 * with, never the access gate itself (decision 0468's own distinction).
 *
 * **Adding the same person twice is a no-op, not a 409** — migration
 * 0078's own design comment, and the same shape
 * `handleSetSupervisorOverride` (`approval-config-route.ts`, decision
 * 0075) already uses for its own composite-key "grant" table: an
 * `INSERT ... ON CONFLICT DO NOTHING`, 200 either way, not
 * `handleAddTeamMember`'s own 409-on-duplicate (`team-route.ts`) — a
 * different table shape, where a duplicate add is more likely a
 * mistake worth surfacing than a harmless repeat click on "Add."
 */

export async function handleAddCollaborator(
  db: D1Database,
  invoiceId: string,
  userId: unknown,
  addedBy: string
): Promise<RouteResult> {
  if (typeof userId !== "string" || !userId) {
    return { status: 400, body: { error: "userId (string) is required" } };
  }

  const invoice = await db.prepare("SELECT id FROM invoice_headers WHERE id = ?").bind(invoiceId).first();
  if (!invoice) {
    return { status: 404, body: { error: `document ${invoiceId} does not exist` } };
  }

  const userExists = await db.prepare("SELECT id FROM org_users WHERE id = ?").bind(userId).first();
  if (!userExists) {
    return { status: 404, body: { error: `user ${userId} does not exist` } };
  }

  await db
    .prepare(
      `INSERT INTO invoice_collaborators (invoice_id, user_id, added_by) VALUES (?, ?, ?)
       ON CONFLICT(invoice_id, user_id) DO NOTHING`
    )
    .bind(invoiceId, userId, addedBy)
    .run();

  return { status: 200, body: { invoiceId, userId, addedBy } };
}

/**
 * Who is already in an invoice's conversation — the "Add person" panel's
 * own list, and (once a UI needs it) who a `Procurement.Collaborate`
 * holder shares the conversation with. Ordered the same way
 * `resolveInvoiceCollaboratorIds` (`workflow-engine.ts`, decisions
 * 0469/0471) reads this table — earliest-added first — so the two stay
 * consistent about ordering, even though decision 0471 no longer
 * treats "first" as special (every Business Approver among them is
 * routed a task, not only the earliest).
 */
export async function handleListCollaborators(db: D1Database, invoiceId: string): Promise<RouteResult> {
  const invoice = await db.prepare("SELECT id FROM invoice_headers WHERE id = ?").bind(invoiceId).first();
  if (!invoice) {
    return { status: 404, body: { error: `document ${invoiceId} does not exist` } };
  }

  const rows = await db
    .prepare(
      `SELECT c.user_id AS userId, u.name AS userName, u.email AS userEmail,
              c.added_by AS addedBy, a.name AS addedByName, c.added_at AS addedAt
       FROM invoice_collaborators c
       JOIN org_users u ON u.id = c.user_id
       JOIN org_users a ON a.id = c.added_by
       WHERE c.invoice_id = ?
       ORDER BY c.added_at ASC`
    )
    .bind(invoiceId)
    .all<{
      userId: string;
      userName: string;
      userEmail: string;
      addedBy: string;
      addedByName: string;
      addedAt: string;
    }>();

  return { status: 200, body: { collaborators: rows.results } };
}

/**
 * The per-record access check this phase adds — the first of its kind
 * in this codebase (`enforce.ts`'s own `hasPermission`/
 * `requireAnyPermission` are both global, role-grant checks with no
 * per-invoice scoping). `index.ts` combines this with
 * `Procurement.Collaborate` at every route it widens: holding the
 * permission alone is not enough, and being listed here without the
 * permission is not enough either — decision 0468's own "explicit
 * invitation" is additive to the role system, not a replacement for it.
 */
export async function isInvoiceCollaborator(db: D1Database, invoiceId: string, userId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 FROM invoice_collaborators WHERE invoice_id = ? AND user_id = ?")
    .bind(invoiceId, userId)
    .first();
  return row !== null;
}

/**
 * Removing a collaborator — decision 0468's own named-but-deferred
 * gap ("a `DELETE` route is a real, separate follow-up once there is a
 * reason to ask for it"), built here in decision 0476, gated on the
 * new, deliberately narrower `AP.Manager` permission rather than the
 * `AP.Review` that can add one — the operator's own instruction.
 *
 * **A plain `DELETE FROM`, not a soft-remove or an audit-trailed
 * table.** `invoice_collaborators` has no `removed_at`/`removed_by`
 * columns and none are added here — this table is the roster *right
 * now*, the same way `org_teams`' own membership table has always
 * been a plain join table with no history of its own (`team-route.ts`'s
 * `handleRemoveTeamMember`, decision 0075). Whoever removed whom is
 * recoverable from `/documents/:id/activity` if this route's own
 * caller posts a comment noting it — nothing here does that
 * automatically, matching `handleRemoveTeamMember`'s own silence.
 *
 * **404s if the person wasn't a collaborator, matching
 * `handleRemoveTeamMember`'s own precedent exactly** (`team-route.ts`,
 * checking `result.meta.changes` after the `DELETE`) rather than
 * `handleAddCollaborator`'s own no-op-not-409 for the opposite
 * direction — removal and addition are not mirror images here: adding
 * the same person twice is a harmless repeat click, but removing
 * someone already gone is more likely the caller acting on a stale
 * roster than an intentional no-op, the same distinction this
 * codebase already draws between a composite-key "grant" table (no-op
 * on a duplicate) and a plain membership table (404 on a no-op
 * removal).
 *
 * **Does not touch any task already created.** A `Procurement.Approve`
 * task decision 0471's own `resolveNonPoApprovers` already routed to
 * this person keeps its own `assigned_to`/`required_permission`
 * exactly as created — tasks are not a live join against
 * `invoice_collaborators`, they are their own row, resolved once at
 * routing time. Removing a collaborator only affects `GET
 * /invoices/:id` (and its document/pages/progress/activity/comments
 * siblings) going forward and any *future* routing pass; it does not
 * reach back and revoke a task already assigned. Left as-is
 * deliberately — reaching into an already-created task's own
 * permission grant from an unrelated roster change is a bigger,
 * separate decision this one was not asked to make.
 */
export async function handleRemoveCollaborator(
  db: D1Database,
  invoiceId: string,
  userId: string
): Promise<RouteResult> {
  const invoice = await db.prepare("SELECT id FROM invoice_headers WHERE id = ?").bind(invoiceId).first();
  if (!invoice) {
    return { status: 404, body: { error: `document ${invoiceId} does not exist` } };
  }

  const result = await db
    .prepare("DELETE FROM invoice_collaborators WHERE invoice_id = ? AND user_id = ?")
    .bind(invoiceId, userId)
    .run();

  if (!result.meta.changes) {
    return { status: 404, body: { error: `user ${userId} is not a collaborator on invoice ${invoiceId}` } };
  }

  return { status: 200, body: { invoiceId, userId } };
}
