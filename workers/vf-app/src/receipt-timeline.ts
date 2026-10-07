import { toIso, byTime } from "./timeline-time.js";
import type { RouteResult } from "./org-route.js";
import { hasPermission, isWithinScope, unitsWherePermitted } from "./enforce.js";
import { receiptViewScope, receiptScopeClause } from "./goods-receipts.js";
import { isReceiptCollaborator, receiptEvent } from "./receipt-collaborators.js";
import { sendEmailViaResend } from "./resend-client.js";
import { viewFor, type ReceivedFile, type ReceivedMessage } from "./received-files.js";

/**
 * **A goods receipt's Timeline and Chat — decision 0658.** Dan, 7
 * October 2026: "this UI would benefit from a Timeline / Chat, like we
 * have implemented in the Invoice viewer. This logs all decisions, and
 * changes. Also provides an opportunity for AP to add the Warehouse team
 * to the chat and resolve any discrepancy." Agreed with him:
 *
 * - **people or a whole team** can be added (`goods_receipt_collaborators`);
 *   whoever is added and holds **Warehouse.Collaborate** sees that
 *   receipt and posts to its chat, without AP.Receive or AP.Validate;
 * - **email when added, and on every new post**, to everyone in the
 *   conversation but its author, through Resend (0498), with a link that
 *   opens the receipt.
 *
 * The Timeline is read at once from three places:
 *
 * - the receipt's own columns: received (and how), registered (and by
 *   whom, or by which order's load), rejected, cancelled;
 * - its process: the task Matching raised, and every claim and release
 *   of it (`task_action_events`, 0488);
 * - `goods_receipt_events` for what the columns cannot say: lines
 *   re-pointed, corrected or rejected, lines counted when their order
 *   loaded, and people and teams added or removed; and the comments.
 */

export interface TimelineDeps {
  email: { apiKey: string; from: string } | null;
  appUrl: string | null;
  defaultLocale?: string | null;
  /** Injected in tests; Resend otherwise. */
  send?: typeof sendEmailViaResend;
}

const MAX_BODY = 4000;
const MAX_RECIPIENTS = 50;

/** SQLite's `datetime('now')` and ISO, both in the one ISO form (decision 0674). */
const iso = (at: string | null | undefined): string | null => toIso(at);

interface Access {
  receipt: { id: string; receipt_number: string; status: string; created_by: string | null; cancelled_at: string | null };
  /** Holds AP.Receive where the receipt's orders are: may add and remove people. */
  canManage: boolean;
}

/**
 * Whether the person may see a receipt: AP.Receive or AP.Validate where
 * its orders are (as the receipt's own pop-out), or Warehouse.Collaborate
 * and in its conversation. 404 otherwise, as for a receipt outside one's
 * units.
 */
export async function receiptAccess(db: D1Database, userId: string, receiptId: string): Promise<Access | null> {
  const receipt = await db
    .prepare("SELECT id, receipt_number, status, created_by, cancelled_at FROM goods_receipts WHERE id = ?")
    .bind(receiptId)
    .first<Access["receipt"]>();
  if (!receipt) return null;
  const units = (
    await db
      .prepare("SELECT DISTINCT po.org_unit_id FROM goods_receipt_lines l JOIN purchase_orders po ON po.order_number = l.order_number WHERE l.receipt_id = ?")
      .bind(receiptId)
      .all<{ org_unit_id: string | null }>()
  ).results;
  const receive = await unitsWherePermitted(db, userId, "AP.Receive");
  const canManage = units.every((u) => isWithinScope({ units: receive }, u.org_unit_id)) && (receive === null || receive.length > 0);
  if (canManage) return { receipt, canManage };
  const scope = await receiptViewScope(db, userId);
  if (scope === null || scope.length > 0) {
    const where = receiptScopeClause(scope);
    const seen = await db.prepare(`SELECT 1 FROM goods_receipts r WHERE r.id = ? ${where.sql}`).bind(receiptId, ...where.binds).first();
    if (seen) return { receipt, canManage: false };
  }
  if ((await hasPermission(db, userId, "Warehouse.Collaborate")) && (await isReceiptCollaborator(db, userId, receiptId))) return { receipt, canManage: false };
  return null;
}

const notFound: RouteResult = { status: 404, body: { error: "no such receipt", reason: "not_found" } };

/** Whether someone could open a receipt they are added to: Warehouse.Collaborate, AP.Receive or AP.Validate, anywhere. */
async function couldSee(db: D1Database, userId: string): Promise<boolean> {
  for (const p of ["Warehouse.Collaborate", "AP.Receive", "AP.Validate"] as const) if (await hasPermission(db, userId, p)) return true;
  return false;
}

// ── Reading ────────────────────────────────────────────────────────────

export interface TimelineItem {
  kind: string;
  at: string;
  by: string | null;
  lineNumber?: number | null;
  detail?: Record<string, unknown>;
  body?: string;
  mine?: boolean;
}

async function collaboratorsOf(db: D1Database, receiptId: string) {
  return (
    await db
      .prepare(
        `SELECT c.id, c.user_id, c.team_id, u.name AS user_name, u.email AS user_email, t.name AS team_name,
                (SELECT count(*) FROM org_team_members m WHERE m.team_id = c.team_id) AS members,
                ab.name AS added_by_name, c.added_at
         FROM goods_receipt_collaborators c
         LEFT JOIN org_users u ON u.id = c.user_id LEFT JOIN org_teams t ON t.id = c.team_id
         LEFT JOIN org_users ab ON ab.id = c.added_by
         WHERE c.receipt_id = ? AND c.removed_at IS NULL ORDER BY c.added_at, c.id`
      )
      .bind(receiptId)
      .all<{ id: string; user_id: string | null; team_id: string | null; user_name: string | null; user_email: string | null; team_name: string | null; members: number; added_by_name: string | null; added_at: string }>()
  ).results.map((c) =>
    c.user_id
      ? { id: c.id, kind: "user", userId: c.user_id, name: c.user_name, email: c.user_email, addedBy: c.added_by_name, addedAt: c.added_at }
      : { id: c.id, kind: "team", teamId: c.team_id, name: c.team_name, members: c.members, addedBy: c.added_by_name, addedAt: c.added_at }
  );
}

/** `GET /goods-receipts/:id/timeline` — what happened, oldest first, the conversation, and who is in it. */
export async function handleGetReceiptTimeline(db: D1Database, userId: string, receiptId: string): Promise<RouteResult> {
  const access = await receiptAccess(db, userId, receiptId);
  if (!access) return notFound;
  // 0660: reading the Timeline / Chat is catching up with it.
  await markReceiptSeen(db, userId, receiptId);
  const items: TimelineItem[] = [];
  const r = await db
    .prepare(
      `SELECT r.*, u.name AS created_by_name, ru.name AS rejected_by_name, cu.name AS cancelled_by_name,
              m.instance_id AS message_source, m.counterparty AS message_sender, s.name AS source_name
       FROM goods_receipts r LEFT JOIN org_users u ON u.id = r.created_by
       LEFT JOIN org_users ru ON ru.id = r.rejected_by LEFT JOIN org_users cu ON cu.id = r.cancelled_by
       LEFT JOIN route_messages m ON m.id = r.route_message_id LEFT JOIN sources s ON s.id = m.instance_id
       WHERE r.id = ?`
    )
    .bind(receiptId)
    .first<Record<string, string | number | null>>();
  if (!r) return notFound;

  items.push({
    kind: "received",
    at: iso(r.created_at as string)!,
    by: (r.created_by_name as string | null) ?? (r.message_sender as string | null) ?? null,
    detail: {
      source: r.source,
      messageId: r.route_message_id ?? null,
      sourceName: r.source_name ?? null,
      lines: ((await db.prepare("SELECT count(*) AS n FROM goods_receipt_lines WHERE receipt_id = ?").bind(receiptId).first<{ n: number }>())?.n ?? 0),
    },
  });

  // The process: Matching's task, and who claimed and released it.
  const tasks = (
    await db
      .prepare(
        `SELECT t.id, t.created_at, t.status, t.completed_at, t.ended_at, t.end_reason, st.name AS stage,
                cu.name AS completed_by_name, eu.name AS ended_by_name, tm.name AS team_name
         FROM tasks t JOIN stage_visits v ON v.id = t.stage_visit_id
         JOIN process_instances pi ON pi.id = v.process_instance_id
         LEFT JOIN process_stages st ON st.id = t.stage_id
         LEFT JOIN org_users cu ON cu.id = t.completed_by LEFT JOIN org_users eu ON eu.id = t.ended_by
         LEFT JOIN org_teams tm ON tm.id = t.owner_team_id
         WHERE pi.subject_type = 'goods_receipt' AND pi.subject_id = ?
         ORDER BY t.created_at`
      )
      .bind(receiptId)
      .all<{ id: string; created_at: string; status: string; completed_at: string | null; ended_at: string | null; end_reason: string | null; stage: string | null; completed_by_name: string | null; ended_by_name: string | null; team_name: string | null }>()
  ).results;
  for (const t of tasks) items.push({ kind: "stopped", at: iso(t.created_at)!, by: null, detail: { stage: t.stage, team: t.team_name } });
  if (tasks.length > 0) {
    const actions = (
      await db
        .prepare(
          `SELECT e.action, e.at, e.comment, u.name AS actor_name FROM task_action_events e LEFT JOIN org_users u ON u.id = e.actor_id
           WHERE e.task_id IN (SELECT value FROM json_each(?)) AND e.action IN ('claim', 'release', 'reassign') ORDER BY e.at`
        )
        .bind(JSON.stringify(tasks.map((t) => t.id)))
        .all<{ action: string; at: string; comment: string | null; actor_name: string | null }>()
    ).results;
    for (const a of actions) items.push({ kind: a.action === "claim" ? "claimed" : a.action === "release" ? "released" : "reassigned", at: iso(a.at)!, by: a.actor_name, ...(a.comment ? { detail: { comment: a.comment } } : {}) });
  }

  const events = (
    await db
      .prepare(
        `SELECT e.kind, e.at, e.line_number, e.detail_json, u.name AS actor_name FROM goods_receipt_events e
         LEFT JOIN org_users u ON u.id = e.actor_id WHERE e.receipt_id = ? ORDER BY e.at, e.id`
      )
      .bind(receiptId)
      .all<{ kind: string; at: string; line_number: number | null; detail_json: string | null; actor_name: string | null }>()
  ).results;
  for (const e of events) items.push({ kind: e.kind, at: iso(e.at)!, by: e.actor_name, lineNumber: e.line_number, detail: e.detail_json ? (JSON.parse(e.detail_json) as Record<string, unknown>) : {} });

  // After the events: a line counted by an order's load is written in the same moment the load registers the receipt.
  if (r.registered_at) {
    const registeredBy = tasks.find((t) => t.status === "completed" && t.completed_by_name);
    const byOrder = tasks.find((t) => t.status === "cancelled" && t.end_reason?.startsWith("po:"));
    items.push({
      kind: "registered",
      at: iso(r.registered_at as string)!,
      by: registeredBy?.completed_by_name ?? byOrder?.ended_by_name ?? null,
      detail: {
        how: registeredBy ? "register" : byOrder ? "order_loaded" : tasks.length === 0 && r.source === "screen" ? "recorded" : "matched",
        ...(byOrder ? { orders: byOrder.end_reason!.slice(3) } : {}),
        partial: r.register_partial === 1,
      },
    });
  }
  if (r.rejected_at) items.push({ kind: "rejected", at: iso(r.rejected_at as string)!, by: r.rejected_by_name as string | null, detail: { reason: r.reject_reason } });
  if (r.cancelled_at) items.push({ kind: "cancelled", at: iso(r.cancelled_at as string)!, by: r.cancelled_by_name as string | null, detail: { reason: r.cancel_reason } });

  const comments = (
    await db
      .prepare(
        `SELECT c.id, c.body, c.created_at, c.author_id, u.name AS author_name FROM goods_receipt_comments c
         LEFT JOIN org_users u ON u.id = c.author_id WHERE c.receipt_id = ? ORDER BY c.created_at, c.id`
      )
      .bind(receiptId)
      .all<{ id: string; body: string; created_at: string; author_id: string; author_name: string | null }>()
  ).results;
  for (const c of comments) items.push({ kind: "comment", at: iso(c.created_at)!, by: c.author_name, body: c.body, mine: c.author_id === userId });

  // Oldest first, as a conversation reads; at the same moment, in the order written above.
  // Ordered as time, not text (decision 0674); `sort` keeps the order written at the same moment.
  const ordered = items.slice().sort(byTime);
  return {
    status: 200,
    body: {
      receiptNumber: access.receipt.receipt_number,
      items: ordered,
      collaborators: await collaboratorsOf(db, receiptId),
      canPost: true,
      canManage: access.canManage,
    },
  };
}

// ── People ─────────────────────────────────────────────────────────────

/** `GET /goods-receipts/:id/people?q=` — people and teams to add, each person saying whether they could open it. AP.Receive. */
export async function handleSearchReceiptPeople(db: D1Database, userId: string, receiptId: string, query: string | null): Promise<RouteResult> {
  const access = await receiptAccess(db, userId, receiptId);
  if (!access) return notFound;
  if (!access.canManage) return { status: 403, body: { error: "adding people needs AP.Receive where this receipt's orders are", reason: "cannot_manage" } };
  const q = (query ?? "").trim();
  if (!q) return { status: 200, body: { users: [], teams: [] } };
  const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const users = (
    await db
      .prepare(`SELECT id, name, email FROM org_users WHERE status = 'active' AND (name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\') ORDER BY name LIMIT 10`)
      .bind(like, like)
      .all<{ id: string; name: string; email: string }>()
  ).results;
  const teams = (
    await db
      .prepare(
        `SELECT t.id, t.name, (SELECT count(*) FROM org_team_members m WHERE m.team_id = t.id) AS members
         FROM org_teams t WHERE t.name LIKE ? ESCAPE '\\' ORDER BY t.name LIMIT 10`
      )
      .bind(like)
      .all<{ id: string; name: string; members: number }>()
  ).results;
  return {
    status: 200,
    body: {
      users: await Promise.all(users.map(async (u) => ({ ...u, canSee: await couldSee(db, u.id) }))),
      teams,
    },
  };
}

/**
 * `POST /goods-receipts/:id/collaborators` — `{ userId }` or `{ teamId }`.
 * AP.Receive where the receipt's orders are. A person who could not
 * open it (none of Warehouse.Collaborate, AP.Receive, AP.Validate) is
 * refused, `cannot_see`, saying what they need. A team is added as it
 * is; those of its members who can open it are emailed. Adding someone
 * already in is no change.
 */
export async function handleAddReceiptCollaborator(
  db: D1Database,
  userId: string,
  receiptId: string,
  body: Record<string, unknown>,
  deps: TimelineDeps,
  now = new Date()
): Promise<RouteResult> {
  const access = await receiptAccess(db, userId, receiptId);
  if (!access) return notFound;
  if (!access.canManage) return { status: 403, body: { error: "adding people needs AP.Receive where this receipt's orders are", reason: "cannot_manage" } };
  const personId = typeof body.userId === "string" ? body.userId.trim() : "";
  const teamId = typeof body.teamId === "string" ? body.teamId.trim() : "";
  if (Boolean(personId) === Boolean(teamId)) return { status: 400, body: { error: "name one person (userId) or one team (teamId)", reason: "who_missing" } };

  let name: string;
  let recipients: string[];
  if (personId) {
    const person = await db.prepare("SELECT id, name FROM org_users WHERE id = ? AND status = 'active'").bind(personId).first<{ id: string; name: string }>();
    if (!person) return { status: 404, body: { error: "no such person", reason: "person_not_found" } };
    if (!(await couldSee(db, person.id)))
      return { status: 422, body: { error: `${person.name} could not open this receipt: give them Warehouse.Collaborate`, reason: "cannot_see", name: person.name } };
    const already = await db.prepare("SELECT id FROM goods_receipt_collaborators WHERE receipt_id = ? AND user_id = ? AND removed_at IS NULL").bind(receiptId, person.id).first();
    if (already) return { status: 200, body: { added: false, collaborators: await collaboratorsOf(db, receiptId) } };
    name = person.name;
    recipients = [person.id];
  } else {
    const team = await db.prepare("SELECT id, name FROM org_teams WHERE id = ?").bind(teamId).first<{ id: string; name: string }>();
    if (!team) return { status: 404, body: { error: "no such team", reason: "team_not_found" } };
    const already = await db.prepare("SELECT id FROM goods_receipt_collaborators WHERE receipt_id = ? AND team_id = ? AND removed_at IS NULL").bind(receiptId, team.id).first();
    if (already) return { status: 200, body: { added: false, collaborators: await collaboratorsOf(db, receiptId) } };
    name = team.name;
    recipients = (await db.prepare("SELECT user_id FROM org_team_members WHERE team_id = ?").bind(team.id).all<{ user_id: string }>()).results.map((m) => m.user_id);
  }

  const at = now.toISOString();
  await db.batch([
    db
      .prepare("INSERT INTO goods_receipt_collaborators (id, receipt_id, user_id, team_id, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), receiptId, personId || null, teamId || null, userId, at),
    receiptEvent(db, receiptId, "collaborator_added", userId, { kind: personId ? "user" : "team", name }, null, at),
  ]);
  const actor = await db.prepare("SELECT name FROM org_users WHERE id = ?").bind(userId).first<{ name: string }>();
  const notified = await notify(db, deps, receiptId, access.receipt.receipt_number, recipients.filter((id) => id !== userId), {
    kind: "added",
    actor: actor?.name ?? "",
    team: teamId ? name : null,
    latest: await latestComment(db, receiptId),
  });
  return { status: 201, body: { added: true, notified, collaborators: await collaboratorsOf(db, receiptId) } };
}

/** `DELETE /goods-receipts/:id/collaborators/:collaborator` — AP.Receive where the receipt's orders are. The row stays, ended. */
export async function handleRemoveReceiptCollaborator(db: D1Database, userId: string, receiptId: string, collaboratorId: string, now = new Date()): Promise<RouteResult> {
  const access = await receiptAccess(db, userId, receiptId);
  if (!access) return notFound;
  if (!access.canManage) return { status: 403, body: { error: "removing people needs AP.Receive where this receipt's orders are", reason: "cannot_manage" } };
  const row = await db
    .prepare(
      `SELECT c.id, c.user_id, u.name AS user_name, t.name AS team_name FROM goods_receipt_collaborators c
       LEFT JOIN org_users u ON u.id = c.user_id LEFT JOIN org_teams t ON t.id = c.team_id
       WHERE c.id = ? AND c.receipt_id = ? AND c.removed_at IS NULL`
    )
    .bind(collaboratorId, receiptId)
    .first<{ id: string; user_id: string | null; user_name: string | null; team_name: string | null }>();
  if (!row) return { status: 404, body: { error: "not in this receipt's conversation", reason: "collaborator_not_found" } };
  const at = now.toISOString();
  await db.batch([
    db.prepare("UPDATE goods_receipt_collaborators SET removed_at = ?, removed_by = ? WHERE id = ?").bind(at, userId, row.id),
    receiptEvent(db, receiptId, "collaborator_removed", userId, { kind: row.user_id ? "user" : "team", name: row.user_name ?? row.team_name }, null, at),
  ]);
  return { status: 200, body: { removed: true, collaborators: await collaboratorsOf(db, receiptId) } };
}

// ── The conversation ───────────────────────────────────────────────────

async function latestComment(db: D1Database, receiptId: string): Promise<{ by: string; body: string } | null> {
  const c = await db
    .prepare("SELECT c.body, u.name FROM goods_receipt_comments c LEFT JOIN org_users u ON u.id = c.author_id WHERE c.receipt_id = ? ORDER BY c.created_at DESC, c.id DESC LIMIT 1")
    .bind(receiptId)
    .first<{ body: string; name: string | null }>();
  return c ? { by: c.name ?? "", body: c.body } : null;
}

/**
 * Everyone a new post goes to: the people and members of the teams in
 * the conversation, whoever added them (0659: AP hears the Warehouse's
 * reply), whoever holds the receipt's open task, and anyone who has
 * written in it, but not its author, and only those who could
 * open it.
 */
async function conversationPeople(db: D1Database, receiptId: string, authorId: string): Promise<string[]> {
  const rows = (
    await db
      .prepare(
        `SELECT c.user_id AS id FROM goods_receipt_collaborators c WHERE c.receipt_id = ?1 AND c.removed_at IS NULL AND c.user_id IS NOT NULL
         UNION SELECT m.user_id FROM goods_receipt_collaborators c JOIN org_team_members m ON m.team_id = c.team_id WHERE c.receipt_id = ?1 AND c.removed_at IS NULL
         UNION SELECT c.added_by FROM goods_receipt_collaborators c WHERE c.receipt_id = ?1 AND c.removed_at IS NULL
         UNION SELECT t.claimed_by FROM tasks t JOIN stage_visits v ON v.id = t.stage_visit_id JOIN process_instances pi ON pi.id = v.process_instance_id
               WHERE pi.subject_type = 'goods_receipt' AND pi.subject_id = ?1 AND t.status = 'open' AND t.claimed_by IS NOT NULL
         UNION SELECT author_id FROM goods_receipt_comments WHERE receipt_id = ?1`
      )
      .bind(receiptId)
      .all<{ id: string }>()
  ).results;
  return rows.map((r) => r.id).filter((id) => id && id !== authorId);
}

/** `POST /goods-receipts/:id/comments` — `{ body }`, by whoever may see the receipt; everyone else in the conversation is emailed. */
export async function handlePostReceiptComment(
  db: D1Database,
  userId: string,
  receiptId: string,
  body: Record<string, unknown>,
  deps: TimelineDeps,
  now = new Date()
): Promise<RouteResult> {
  const access = await receiptAccess(db, userId, receiptId);
  if (!access) return notFound;
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text) return { status: 400, body: { error: "write something to post", reason: "comment_empty" } };
  if (text.length > MAX_BODY) return { status: 400, body: { error: `a message is at most ${MAX_BODY} characters`, reason: "comment_too_long" } };
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO goods_receipt_comments (id, receipt_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)").bind(id, receiptId, userId, text, now.toISOString()).run();
  const author = await db.prepare("SELECT name FROM org_users WHERE id = ?").bind(userId).first<{ name: string }>();
  const notified = await notify(db, deps, receiptId, access.receipt.receipt_number, await conversationPeople(db, receiptId, userId), {
    kind: "posted",
    actor: author?.name ?? "",
    team: null,
    latest: { by: author?.name ?? "", body: text },
  });
  return { status: 201, body: { id, notified } };
}

// ── Email ──────────────────────────────────────────────────────────────

type Locale = "en" | "de";

const WORDS: Record<Locale, Record<string, string>> = {
  en: {
    addedSubject: "Goods receipt {number}: {actor} added you to its conversation",
    addedTeamSubject: "Goods receipt {number}: {actor} added {team} to its conversation",
    addedLine: "{actor} added you to the conversation on goods receipt {number}, to help sort out what arrived.",
    addedTeamLine: "{actor} added {team}, a team you are in, to the conversation on goods receipt {number}, to help sort out what arrived.",
    postedSubject: "Goods receipt {number}: {actor} wrote",
    postedLine: "{actor} wrote on goods receipt {number}:",
    latest: "The latest message, from {by}:",
    open: "Open the receipt",
    organisation: "Organisation",
    supplier: "Supplier",
    orders: "Purchase order",
    deliveryNote: "Delivery note",
    receiptDate: "Receipt date",
    footer: "You get this because you are in this receipt's conversation in VibeFinance.",
  },
  de: {
    addedSubject: "Wareneingang {number}: {actor} hat Sie zur Unterhaltung hinzugefügt",
    addedTeamSubject: "Wareneingang {number}: {actor} hat {team} zur Unterhaltung hinzugefügt",
    addedLine: "{actor} hat Sie zur Unterhaltung über Wareneingang {number} hinzugefügt, um zu klären, was eingegangen ist.",
    addedTeamLine: "{actor} hat {team}, ein Team, in dem Sie sind, zur Unterhaltung über Wareneingang {number} hinzugefügt, um zu klären, was eingegangen ist.",
    postedSubject: "Wareneingang {number}: {actor} hat geschrieben",
    postedLine: "{actor} hat zu Wareneingang {number} geschrieben:",
    latest: "Die letzte Nachricht, von {by}:",
    open: "Wareneingang öffnen",
    organisation: "Organisation",
    supplier: "Lieferant",
    orders: "Bestellung",
    deliveryNote: "Lieferschein",
    receiptDate: "Eingangsdatum",
    footer: "Sie erhalten dies, weil Sie in der Unterhaltung zu diesem Wareneingang in VibeFinance sind.",
  },
};

function fill(s: string, values: Record<string, string>): string {
  return s.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** What the email says, in the reader's language. Exported for its test. */
/**
 * **What the receipt is, for the email — decision 0659.** Dan: the email
 * "does not specify the Organisation". The organisation is the legal
 * entity of the units its orders belong to (with the unit, where that is
 * an operating unit beneath it); with the supplier, the orders, the
 * delivery note and the date beside it, a reader knows which receipt
 * this is before opening it.
 */
export interface ReceiptContext {
  organisation: string | null;
  supplier: string | null;
  orders: string[];
  deliveryNote: string | null;
  receiptDate: string | null;
}

export async function receiptContext(db: D1Database, receiptId: string): Promise<ReceiptContext> {
  const r = await db.prepare("SELECT receipt_date, delivery_note FROM goods_receipts WHERE id = ?").bind(receiptId).first<{ receipt_date: string | null; delivery_note: string | null }>();
  const orders = (
    await db
      .prepare(
        `SELECT DISTINCT l.order_number, po.org_unit_id, s.name AS supplier
         FROM goods_receipt_lines l LEFT JOIN purchase_orders po ON po.order_number = l.order_number
         LEFT JOIN suppliers s ON s.vat_id = po.seller_party_id AND s.status = 'active'
         WHERE l.receipt_id = ? AND l.line_status = 'active' ORDER BY l.order_number`
      )
      .bind(receiptId)
      .all<{ order_number: string; org_unit_id: string | null; supplier: string | null }>()
  ).results;
  const names: string[] = [];
  for (const unitId of [...new Set(orders.map((o) => o.org_unit_id).filter((u): u is string => Boolean(u)))]) {
    // Up from the order's unit to its legal entity.
    const chain = (
      await db
        .prepare(
          `WITH RECURSIVE up(id, name, kind, parent_unit_id, depth) AS (
             SELECT id, name, kind, parent_unit_id, 0 FROM org_units WHERE id = ?
             UNION ALL SELECT u.id, u.name, u.kind, u.parent_unit_id, up.depth + 1 FROM org_units u JOIN up ON u.id = up.parent_unit_id WHERE up.depth < 20
           ) SELECT name, kind FROM up ORDER BY depth`
        )
        .bind(unitId)
        .all<{ name: string; kind: string | null }>()
    ).results;
    if (chain.length === 0) continue;
    const entity = chain.find((u) => u.kind === "legal_entity") ?? chain[chain.length - 1];
    const name = entity.name === chain[0].name ? entity.name : `${entity.name} (${chain[0].name})`;
    if (!names.includes(name)) names.push(name);
  }
  if (names.length === 0) {
    // Orders with no unit are everyone's (0375); one legal entity is still the organisation.
    const entities = (await db.prepare("SELECT name FROM org_units WHERE kind = 'legal_entity' LIMIT 2").all<{ name: string }>()).results;
    if (entities.length === 1) names.push(entities[0].name);
  }
  const suppliers = [...new Set(orders.map((o) => o.supplier).filter((x): x is string => Boolean(x)))];
  return {
    organisation: names.length ? names.join(", ") : null,
    supplier: suppliers.length ? suppliers.join(", ") : null,
    orders: orders.map((o) => o.order_number),
    deliveryNote: r?.delivery_note ?? null,
    receiptDate: r?.receipt_date ?? null,
  };
}

export function receiptEmail(
  locale: Locale,
  input: {
    kind: "added" | "posted";
    actor: string;
    team: string | null;
    number: string;
    latest: { by: string; body: string } | null;
    link: string | null;
    context?: ReceiptContext | null;
  }
): { subject: string; text: string; html: string } {
  const w = WORDS[locale];
  const c = input.context ?? null;
  const v = { actor: input.actor, number: input.number, team: input.team ?? "", by: input.latest?.by ?? "" };
  const bare = fill(input.kind === "posted" ? w.postedSubject : input.team ? w.addedTeamSubject : w.addedSubject, v);
  const subject = c?.organisation ? `[${c.organisation}] ${bare}` : bare;
  const lead = fill(input.kind === "posted" ? w.postedLine : input.team ? w.addedTeamLine : w.addedLine, v);
  const quote = input.latest ? [...(input.kind === "added" ? [fill(w.latest, v)] : []), input.latest.body] : [];
  const facts: [string, string][] = c
    ? ([
        [w.organisation, c.organisation],
        [w.supplier, c.supplier],
        [w.orders, c.orders.length ? c.orders.join(", ") : null],
        [w.deliveryNote, c.deliveryNote],
        [w.receiptDate, c.receiptDate],
      ].filter(([, value]) => value) as [string, string][])
    : [];
  const text = [
    lead,
    "",
    ...quote.flatMap((q) => [q, ""]),
    ...(facts.length ? [...facts.map(([k, value]) => `${k}: ${value}`), ""] : []),
    ...(input.link ? [`${w.open}: ${input.link}`, ""] : []),
    w.footer,
  ].join("\n");
  const factsHtml = facts.length
    ? `<table style="border-collapse:collapse;margin:0 0 12px;font-size:13px">${facts
        .map(([k, value]) => `<tr><td style="padding:2px 12px 2px 0;color:#5b6675">${escapeHtml(k)}</td><td style="padding:2px 0">${escapeHtml(value)}</td></tr>`)
        .join("")}</table>`
    : "";
  const html = `<div style="font-family:Calibri,Carlito,'Segoe UI',Arial,sans-serif;color:#121a26;font-size:14px;line-height:1.5">
<p style="margin:0 0 12px">${escapeHtml(lead)}</p>
${input.latest ? `${input.kind === "added" ? `<p style="margin:0 0 6px;color:#5b6675">${escapeHtml(fill(w.latest, v))}</p>` : ""}<blockquote style="margin:0 0 12px;padding:8px 12px;border-left:3px solid #c7d2e0;background:#f5f7fa">${escapeHtml(input.latest.body).replace(/\n/g, "<br>")}</blockquote>` : ""}
${factsHtml}
${input.link ? `<p style="margin:0 0 12px"><a href="${escapeHtml(input.link)}" style="color:#185fa5">${escapeHtml(w.open)}</a></p>` : ""}
<p style="margin:16px 0 0;color:#5b6675;font-size:12px">${escapeHtml(w.footer)}</p></div>`;
  return { subject, text, html };
}

/**
 * Emails each person who could open the receipt, in their own language.
 * One send each, never retried; a failure is counted, never fatal to
 * what was posted. Nothing is sent where Resend is not set up.
 */
async function notify(
  db: D1Database,
  deps: TimelineDeps,
  receiptId: string,
  number: string,
  userIds: string[],
  what: { kind: "added" | "posted"; actor: string; team: string | null; latest: { by: string; body: string } | null }
): Promise<{ sent: number; failed: number; emailReady: boolean }> {
  const out = { sent: 0, failed: 0, emailReady: Boolean(deps.email) };
  if (!deps.email) return out;
  const ids = [...new Set(userIds)].slice(0, MAX_RECIPIENTS);
  if (ids.length === 0) return out;
  const people = (
    await db
      .prepare("SELECT id, email, locale FROM org_users WHERE status = 'active' AND id IN (SELECT value FROM json_each(?))")
      .bind(JSON.stringify(ids))
      .all<{ id: string; email: string | null; locale: string | null }>()
  ).results;
  const link = deps.appUrl ? `${deps.appUrl}/?receipt=${encodeURIComponent(receiptId)}` : null;
  const context = await receiptContext(db, receiptId);
  const send = deps.send ?? sendEmailViaResend;
  for (const p of people) {
    if (!p.email || !(await couldSee(db, p.id))) continue;
    const locale: Locale = (p.locale ?? deps.defaultLocale ?? "en").toLowerCase().startsWith("de") ? "de" : "en";
    const mail = receiptEmail(locale, { ...what, number, link, context });
    const result = await send(deps.email.apiKey, { from: deps.email.from, to: p.email, subject: mail.subject, text: mail.text, html: mail.html });
    if (result.ok) out.sent++;
    else out.failed++;
  }
  return out;
}

// ── Attachments ────────────────────────────────────────────────────────

/**
 * **What a receipt came with — decision 0659.** Dan: "an Attachments tab
 * next to 'Timeline / Chat', with any associated attachments received
 * from the Source Route / Import." A receipt names the message it came
 * in by (`goods_receipts.route_message_id`, 0655): Create's upload (the
 * CSV as sent) or Receipts in (the CSV read from the JSON, and the JSON
 * itself, kept from this decision on). The same shapes as an invoice's
 * Attachments tab (0571), so the panel is the same panel.
 */
export async function receiptMessages(db: D1Database, receiptId: string): Promise<ReceivedMessage[]> {
  const m = await db
    .prepare(
      `SELECT m.id, s.name AS source, m.counterparty AS sender, m.subject, m.received_at
       FROM goods_receipts r JOIN route_messages m ON m.id = r.route_message_id LEFT JOIN sources s ON s.id = m.instance_id
       WHERE r.id = ?`
    )
    .bind(receiptId)
    .first<{ id: string; source: string | null; sender: string | null; subject: string | null; received_at: string }>();
  return m ? [{ id: m.id, source: m.source, sender: m.sender, subject: m.subject, receivedAt: m.received_at, partSeq: null, filename: null, keyed: false }] : [];
}

export async function receiptFiles(db: D1Database, receiptId: string): Promise<ReceivedFile[]> {
  const files: ReceivedFile[] = [];
  for (const m of await receiptMessages(db, receiptId)) {
    const parts = (
      await db
        .prepare("SELECT seq, role, filename, content_type, bytes FROM route_message_parts WHERE message_id = ? AND role IN ('original', 'attachment') ORDER BY seq")
        .bind(m.id)
        .all<{ seq: number; role: string; filename: string; content_type: string; bytes: number }>()
    ).results;
    for (const p of parts)
      files.push({ kind: "part", messageId: m.id, seq: p.seq, role: p.role, filename: p.filename, contentType: p.content_type, bytes: p.bytes, thisInvoice: false, view: viewFor(p.content_type, p.filename) });
  }
  return files;
}

/** One received part, if its message is the one this receipt came in by. */
export async function partForReceipt(db: D1Database, receiptId: string, messageId: string, seq: number): Promise<{ r2Key: string; filename: string; contentType: string } | null> {
  if (!(await receiptMessages(db, receiptId)).some((m) => m.id === messageId)) return null;
  const row = await db
    .prepare("SELECT r2_key, filename, content_type FROM route_message_parts WHERE message_id = ? AND seq = ? AND role IN ('original', 'attachment')")
    .bind(messageId, seq)
    .first<{ r2_key: string; filename: string; content_type: string }>();
  return row ? { r2Key: row.r2_key, filename: row.filename, contentType: row.content_type } : null;
}

/** `GET /goods-receipts/:id/attachments` — for whoever may see the receipt, as its Timeline. */
export async function handleReceiptAttachments(db: D1Database, userId: string, receiptId: string): Promise<RouteResult> {
  if (!(await receiptAccess(db, userId, receiptId))) return notFound;
  return { status: 200, body: { messages: await receiptMessages(db, receiptId), files: await receiptFiles(db, receiptId) } };
}

/** The subject a part token names for a receipt's file: never an invoice id, which has no `receipt:` in it. */
export const RECEIPT_TOKEN_PREFIX = "receipt:";

// ── Conversations, on Tasks ────────────────────────────────────────────

/**
 * **What a person has to catch up on — decision 0660.** Dan: added to a
 * chat, someone "would not know that they have been added" but for the
 * email; "similar behaviour to the Agents alert in the task manager".
 * Agreed against a mock-up (7 October 2026): a **Conversations** section
 * at the top of Tasks (and of Goods Receipts for the Warehouse), one row
 * per receipt with something new for this person:
 *
 * - **added**: they, or a team they are in, were added since they last
 *   caught up — by whom, through which team, when;
 * - **new messages**: others wrote since then (since they were added,
 *   where they never caught up), with the latest one quoted.
 *
 * Catching up is opening the receipt's Timeline / Chat, or **Done**
 * (`goods_receipt_reads`); both move `seen_at` on, so a row comes back
 * only when something new happens. Only receipts the person may see are
 * offered, and those of the conversation as the email reckons it: the
 * people and teams in it, whoever added them, the task's holder, and
 * anyone who wrote.
 */
export async function markReceiptSeen(db: D1Database, userId: string, receiptId: string, now = new Date()): Promise<void> {
  await db
    .prepare(
      `INSERT INTO goods_receipt_reads (receipt_id, user_id, seen_at) VALUES (?, ?, ?)
       ON CONFLICT (receipt_id, user_id) DO UPDATE SET seen_at = excluded.seen_at`
    )
    .bind(receiptId, userId, now.toISOString())
    .run();
}

const CONVERSATION_LIMIT = 50;

export async function handleListReceiptConversations(db: D1Database, userId: string): Promise<RouteResult> {
  // Every receipt this person is part of the conversation on.
  const candidates = (
    await db
      .prepare(
        `SELECT receipt_id FROM goods_receipt_collaborators WHERE removed_at IS NULL AND (user_id = ?1 OR added_by = ?1 OR team_id IN (SELECT team_id FROM org_team_members WHERE user_id = ?1))
         UNION SELECT receipt_id FROM goods_receipt_comments WHERE author_id = ?1
         UNION SELECT pi.subject_id FROM tasks t JOIN stage_visits v ON v.id = t.stage_visit_id JOIN process_instances pi ON pi.id = v.process_instance_id
               WHERE pi.subject_type = 'goods_receipt' AND t.status = 'open' AND t.claimed_by = ?1
                 AND EXISTS (SELECT 1 FROM goods_receipt_comments c WHERE c.receipt_id = pi.subject_id)`
      )
      .bind(userId)
      .all<{ receipt_id: string }>()
  ).results.map((r) => r.receipt_id);

  const out = [];
  for (const receiptId of candidates) {
    const seen = (await db.prepare("SELECT seen_at FROM goods_receipt_reads WHERE receipt_id = ? AND user_id = ?").bind(receiptId, userId).first<{ seen_at: string }>())?.seen_at ?? null;
    // Added: the latest time this person came in, by name or through a team, after they last caught up.
    const added = await db
      .prepare(
        `SELECT c.added_at, ab.name AS added_by, t.name AS team FROM goods_receipt_collaborators c
         LEFT JOIN org_users ab ON ab.id = c.added_by LEFT JOIN org_teams t ON t.id = c.team_id
         WHERE c.receipt_id = ?1 AND c.removed_at IS NULL AND c.added_by != ?2
           AND (c.user_id = ?2 OR c.team_id IN (SELECT team_id FROM org_team_members WHERE user_id = ?2))
         ORDER BY c.added_at DESC LIMIT 1`
      )
      .bind(receiptId, userId)
      .first<{ added_at: string; added_by: string | null; team: string | null }>();
    const addedNew = added && (!seen || added.added_at > seen) ? added : null;
    const since = seen ?? added?.added_at ?? null;
    const fresh = await db
      .prepare(`SELECT count(*) AS n FROM goods_receipt_comments WHERE receipt_id = ? AND author_id != ? ${since ? "AND created_at > ?" : ""}`)
      .bind(...[receiptId, userId, ...(since ? [since] : [])])
      .first<{ n: number }>();
    const newMessages = fresh?.n ?? 0;
    if (!addedNew && newMessages === 0) continue;
    const access = await receiptAccess(db, userId, receiptId);
    if (!access) continue;
    const latest = await db
      .prepare(
        `SELECT c.body, c.created_at, u.name FROM goods_receipt_comments c LEFT JOIN org_users u ON u.id = c.author_id
         WHERE c.receipt_id = ? ORDER BY c.created_at DESC, c.id DESC LIMIT 1`
      )
      .bind(receiptId)
      .first<{ body: string; created_at: string; name: string | null }>();
    const context = await receiptContext(db, receiptId);
    out.push({
      receiptId,
      receiptNumber: access.receipt.receipt_number,
      organisation: context.organisation,
      supplier: context.supplier,
      orders: context.orders,
      added: addedNew ? { by: addedNew.added_by, team: addedNew.team, at: iso(addedNew.added_at) } : null,
      newMessages,
      latest: latest ? { by: latest.name, body: latest.body.length > 280 ? `${latest.body.slice(0, 279)}…` : latest.body, at: iso(latest.created_at) } : null,
      lastAt: [iso(latest?.created_at), iso(addedNew?.added_at)].filter(Boolean).sort().at(-1) ?? null,
    });
  }
  out.sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)));
  return { status: 200, body: { conversations: out.slice(0, CONVERSATION_LIMIT) } };
}

/** `POST /receipt-conversations/:id/done` — caught up, until someone writes again or adds them again. */
export async function handleReceiptConversationDone(db: D1Database, userId: string, receiptId: string, now = new Date()): Promise<RouteResult> {
  if (!(await receiptAccess(db, userId, receiptId))) return notFound;
  await markReceiptSeen(db, userId, receiptId, now);
  return { status: 200, body: { done: true } };
}
