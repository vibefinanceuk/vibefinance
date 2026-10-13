import type { ParsedOrder } from "@vibefinance/shared";
import { toIso, byTime } from "./timeline-time.js";
import type { RouteResult } from "./org-route.js";
import { hasPermission, isWithinScope, unitsWherePermitted } from "./enforce.js";
import { sendEmailViaResend } from "./resend-client.js";
import { viewFor, type ReceivedFile, type ReceivedMessage } from "./received-files.js";
import { creditSignSql, poOfSql } from "./credit-notes.js";
import { diffOrders, isOrderCollaborator, orderEvent, snapshotOfParsed } from "./order-history.js";
import { markOrderSeen, orderOf } from "./order-messages.js";

/**
 * **A purchase order's Timeline and Chat, and its Attachments — decision
 * 0754**, as a goods receipt's (0658, 0659). Dan, 13 October 2026: "The
 * Timeline / Chat should make note of PO changes, modifications, and
 * history."
 *
 * The Timeline is read at once from where each thing is kept:
 *
 * - **the order on its way in** (`purchase_order_intake`, 0749/0750): each
 *   order, change and cancellation that arrived, by which route and from
 *   whom; Checking's task and who claimed it; released (and what the
 *   release changed) or rejected;
 * - **`purchase_order_events`**: what a load or change did to the order,
 *   field by field and line by line (`order-history.ts`); Hold, Release
 *   hold and Close by hand; people and teams added or removed;
 * - **goods received and returned** against it, and **invoices and credit
 *   notes** that name it;
 * - **the supplier**: when they first opened it in the network, and what
 *   was written to them and what they answered (the words are on the
 *   Supplier tab);
 * - the conversation here.
 *
 * Whoever may open the order reads and writes in it; Purchasing (where the
 * order is) and Admin.Configure add people and teams. Anyone added who
 * reads orders, receives goods or collaborates with the warehouse may
 * open that order.
 */

export interface TimelineDeps {
  email: { apiKey: string; from: string } | null;
  appUrl: string | null;
  defaultLocale?: string | null;
  send?: typeof sendEmailViaResend;
}

const MAX_BODY = 4000;
const MAX_RECIPIENTS = 50;
const iso = (at: string | null | undefined): string | null => toIso(at);

interface Access {
  order: { id: string; order_number: string; org_unit_id: string | null; status: string; created_at: string };
  canManage: boolean;
}

/** The permissions under which someone added to an order's conversation may open it. */
const MAY_OPEN = ["AP.Validate", "AP.Purchasing", "AP.Receive", "Warehouse.Collaborate"] as const;

async function couldSee(db: D1Database, userId: string): Promise<boolean> {
  for (const p of MAY_OPEN) if (await hasPermission(db, userId, p)) return true;
  return false;
}

/**
 * Whether the person may open an order: AP.Validate or AP.Purchasing where
 * it is (as the order itself, 0752), Admin.Configure, or in its
 * conversation and able to open one at all. 404 otherwise.
 */
export async function orderAccess(db: D1Database, userId: string, orderNumber: string): Promise<Access | null> {
  const order = await db
    .prepare("SELECT id, order_number, org_unit_id, status, created_at FROM purchase_orders WHERE order_number = ?")
    .bind(orderNumber)
    .first<Access["order"]>();
  if (!order) return null;
  const inScope = (units: string[] | null) => isWithinScope({ units }, order.org_unit_id) && (units === null || units.length > 0);
  const purchasing = await unitsWherePermitted(db, userId, "AP.Purchasing");
  const canManage = inScope(purchasing) || (await hasPermission(db, userId, "Admin.Configure"));
  if (canManage) return { order, canManage };
  if (inScope(await unitsWherePermitted(db, userId, "AP.Validate"))) return { order, canManage: false };
  if ((await isOrderCollaborator(db, userId, orderNumber)) && (await couldSee(db, userId))) return { order, canManage: false };
  return null;
}

const notFound: RouteResult = { status: 404, body: { error: "no such purchase order", reason: "not_found" } };

// ── Reading ────────────────────────────────────────────────────────────

export interface TimelineItem {
  kind: string;
  at: string;
  by: string | null;
  detail?: Record<string, unknown>;
  body?: string;
  mine?: boolean;
}

async function collaboratorsOf(db: D1Database, orderNumber: string) {
  return (
    await db
      .prepare(
        `SELECT c.id, c.user_id, c.team_id, u.name AS user_name, u.email AS user_email, t.name AS team_name,
                (SELECT count(*) FROM org_team_members m WHERE m.team_id = c.team_id) AS members,
                ab.name AS added_by_name, c.added_at
         FROM purchase_order_collaborators c
         LEFT JOIN org_users u ON u.id = c.user_id LEFT JOIN org_teams t ON t.id = c.team_id
         LEFT JOIN org_users ab ON ab.id = c.added_by
         WHERE c.order_number = ? AND c.removed_at IS NULL ORDER BY c.added_at, c.id`
      )
      .bind(orderNumber)
      .all<{ id: string; user_id: string | null; team_id: string | null; user_name: string | null; user_email: string | null; team_name: string | null; members: number; added_by_name: string | null; added_at: string }>()
  ).results.map((c) =>
    c.user_id
      ? { id: c.id, kind: "user", userId: c.user_id, name: c.user_name, email: c.user_email, addedBy: c.added_by_name, addedAt: c.added_at }
      : { id: c.id, kind: "team", teamId: c.team_id, name: c.team_name, members: c.members, addedBy: c.added_by_name, addedAt: c.added_at }
  );
}

interface IntakeRead {
  id: string;
  kind: string;
  status: string;
  order_json: string;
  route_message_id: string | null;
  release_override: number;
  change_reference: string | null;
  note: string | null;
  created_at: string;
  released_at: string | null;
  rejected_at: string | null;
  reject_reason: string | null;
  source_name: string | null;
  sender: string | null;
  created_by_name: string | null;
  released_by_name: string | null;
  rejected_by_name: string | null;
}

const parse = <T>(s: string | null): T | null => {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
};

/** Checking's task for an order on its way in, and who claimed and released it (as a receipt's, 0658). */
async function taskItems(db: D1Database, intakeId: string): Promise<TimelineItem[]> {
  const items: TimelineItem[] = [];
  const tasks = (
    await db
      .prepare(
        `SELECT t.id, t.created_at, st.name AS stage, tm.name AS team_name
         FROM tasks t JOIN stage_visits v ON v.id = t.stage_visit_id
         JOIN process_instances pi ON pi.id = v.process_instance_id
         LEFT JOIN process_stages st ON st.id = t.stage_id
         LEFT JOIN org_teams tm ON tm.id = t.owner_team_id
         WHERE pi.subject_type = 'purchase_order' AND pi.subject_id = ?
         ORDER BY t.created_at`
      )
      .bind(intakeId)
      .all<{ id: string; created_at: string; stage: string | null; team_name: string | null }>()
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
  return items;
}

/** `GET /purchase-orders/:number/timeline` — what happened, oldest first, the conversation, and who is in it. */
export async function handleGetOrderTimeline(db: D1Database, userId: string, orderNumber: string): Promise<RouteResult> {
  const access = await orderAccess(db, userId, orderNumber);
  if (!access) return notFound;
  // Reading the Timeline / Chat is catching up with it (Conversations, 0660).
  await markOrderSeen(db, userId, orderNumber);
  const items: TimelineItem[] = [];

  // What the order's loads and changes did, and what was done to it by hand.
  const events = (
    await db
      .prepare(
        `SELECT e.kind, e.at, e.intake_id, e.detail_json, u.name AS actor_name FROM purchase_order_events e
         LEFT JOIN org_users u ON u.id = e.actor_id WHERE e.order_number = ? ORDER BY e.at, e.rowid`
      )
      .bind(orderNumber)
      .all<{ kind: string; at: string; intake_id: string | null; detail_json: string | null; actor_name: string | null }>()
  ).results;
  const byIntake = new Map(events.filter((e) => e.intake_id).map((e) => [e.intake_id!, e]));

  // The order on its way in: each order, change and cancellation that arrived.
  const intakes = (
    await db
      .prepare(
        `SELECT i.id, i.kind, i.status, i.order_json, i.route_message_id, i.release_override, i.change_reference, i.note,
                i.created_at, i.released_at, i.rejected_at, i.reject_reason,
                s.name AS source_name, m.counterparty AS sender,
                cu.name AS created_by_name, ru.name AS released_by_name, xu.name AS rejected_by_name
         FROM purchase_order_intake i
         LEFT JOIN route_messages m ON m.id = i.route_message_id LEFT JOIN sources s ON s.id = m.instance_id
         LEFT JOIN org_users cu ON cu.id = i.created_by LEFT JOIN org_users ru ON ru.id = i.released_by LEFT JOIN org_users xu ON xu.id = i.rejected_by
         WHERE i.order_number = ? ORDER BY i.created_at, i.rowid`
      )
      .bind(orderNumber)
      .all<IntakeRead>()
  ).results;
  let previous: ParsedOrder | null = null;
  for (const i of intakes) {
    const parsed = parse<ParsedOrder>(i.order_json);
    items.push({
      kind: "order_arrived",
      at: iso(i.created_at)!,
      by: i.created_by_name ?? i.sender ?? null,
      detail: {
        orderKind: i.kind,
        source: i.source_name,
        sender: i.sender,
        messageId: i.route_message_id,
        uploaded: Boolean(i.created_by_name),
        lines: parsed?.lines.length ?? 0,
        changeReference: i.change_reference,
        note: i.note,
      },
    });
    items.push(...(await taskItems(db, i.id)));
    if (i.released_at) {
      const event = byIntake.get(i.id);
      // Decision 0768: what a release changed, never a first load's summary of what was loaded (`lines: 4`), which is no diff.
      let changes = event && event.kind !== "loaded" ? parse<Record<string, unknown>>(event.detail_json) : null;
      // Released before this decision: what changed, from the version released before it.
      if (!event && i.kind === "change" && previous && parsed) changes = { ...diffOrders(snapshotOfParsed(previous), snapshotOfParsed(parsed)), reconstructed: true };
      items.push({
        kind: "order_released",
        at: iso(i.released_at)!,
        by: i.released_by_name,
        detail: { orderKind: i.kind, first: event?.kind === "loaded" || (!event && i.kind === "order" && !previous), override: i.release_override === 1, ...(changes ? { changes } : {}) },
      });
      if (i.kind !== "cancellation" && parsed) previous = parsed;
    }
    if (i.rejected_at) items.push({ kind: "order_rejected", at: iso(i.rejected_at)!, by: i.rejected_by_name, detail: { orderKind: i.kind, reason: i.reject_reason } });
  }

  let loadedSeen = intakes.some((i) => i.released_at);
  for (const e of events) {
    if (e.intake_id) continue; // Said with the release it came by, above.
    const detail = parse<Record<string, unknown>>(e.detail_json) ?? {};
    if (e.kind === "loaded" || e.kind === "changed") {
      loadedSeen = true;
      items.push({ kind: e.kind === "loaded" ? "order_loaded" : "order_changed", at: iso(e.at)!, by: e.actor_name, detail: e.kind === "changed" ? { changes: detail } : detail });
    } else {
      items.push({ kind: e.kind === "cancelled" ? "order_cancelled" : e.kind === "closed" ? "order_closed" : e.kind === "held" ? "order_held" : e.kind === "hold_released" ? "order_hold_released" : e.kind, at: iso(e.at)!, by: e.actor_name, detail });
    }
  }
  // Loaded before any of this was kept: when, as the order's own row says.
  if (!loadedSeen) items.push({ kind: "order_loaded", at: iso(access.order.created_at)!, by: null, detail: { earlier: true } });

  // Goods received and returned against it, a receipt at a time.
  const movements = (
    await db
      .prepare(
        `SELECT r.id, r.receipt_number, r.status, r.created_at, r.registered_at, r.cancelled_at, u.name AS by_name,
                l.movement, sum(l.quantity) AS quantity, group_concat(DISTINCT l.order_line_number) AS lines
         FROM goods_receipt_lines l JOIN goods_receipts r ON r.id = l.receipt_id LEFT JOIN org_users u ON u.id = r.created_by
         WHERE l.order_number = ? AND r.status != 'rejected' AND l.line_status != 'rejected'
         GROUP BY r.id, l.movement ORDER BY r.created_at`
      )
      .bind(orderNumber)
      .all<{ id: string; receipt_number: string; status: string; created_at: string; registered_at: string | null; cancelled_at: string | null; by_name: string | null; movement: string; quantity: number; lines: string | null }>()
  ).results;
  for (const m of movements) {
    items.push({
      kind: m.movement === "returned" ? "goods_returned" : "goods_received",
      at: iso(m.registered_at ?? m.created_at)!,
      by: m.by_name,
      detail: {
        receiptId: m.id,
        receiptNumber: m.receipt_number,
        quantity: Math.round(m.quantity * 1e6) / 1e6,
        lines: (m.lines ?? "").split(",").filter(Boolean).map(Number).sort((a, b) => a - b),
        pending: m.status === "pending",
        cancelled: m.cancelled_at !== null,
      },
    });
  }

  // Invoices and credit notes that name it.
  const invoices = (
    await db
      .prepare(
        `SELECT h.id, h.created_at, json_extract(h.facts_json, '$."BT-1"') AS number, json_extract(h.facts_json, '$."BT-5"') AS currency,
                json_extract(h.facts_json, '$."BT-112"') AS total, ${creditSignSql("h.id")} AS sign, h.document_kind
         FROM invoice_headers h WHERE ${poOfSql("h")} = ? ORDER BY h.created_at`
      )
      .bind(orderNumber)
      .all<{ id: string; created_at: string; number: string | null; currency: string | null; total: number | string | null; sign: number | null; document_kind: string | null }>()
  ).results;
  for (const h of invoices) {
    const total = h.total === null || h.total === undefined || h.total === "" ? null : Number(h.total);
    items.push({
      kind: h.document_kind === "credit_note" ? "order_credited" : "order_invoiced",
      at: iso(h.created_at)!,
      by: null,
      detail: { invoiceId: h.id, number: h.number, currency: h.currency, total: Number.isFinite(total) ? total : null },
    });
  }

  // The supplier: first opened in the network, and the conversation with them (its words on the Supplier tab).
  const opened = await db.prepare("SELECT min(read_at) AS at FROM portal_order_reads WHERE order_number = ?").bind(orderNumber).first<{ at: string | null }>();
  if (opened?.at) items.push({ kind: "supplier_opened", at: iso(opened.at)!, by: null });
  const supplierMessages = (
    await db
      .prepare("SELECT direction, kind, author_name, created_at FROM purchase_order_messages WHERE order_number = ? ORDER BY created_at, rowid")
      .bind(orderNumber)
      .all<{ direction: string; kind: string; author_name: string; created_at: string }>()
  ).results;
  for (const m of supplierMessages) {
    items.push({ kind: m.direction === "from_supplier" ? "supplier_replied" : m.kind === "question" ? "supplier_asked" : "supplier_written", at: iso(m.created_at)!, by: m.author_name });
  }

  const comments = (
    await db
      .prepare(
        `SELECT c.id, c.body, c.created_at, c.author_id, u.name AS author_name FROM purchase_order_comments c
         LEFT JOIN org_users u ON u.id = c.author_id WHERE c.order_number = ? ORDER BY c.created_at, c.id`
      )
      .bind(orderNumber)
      .all<{ id: string; body: string; created_at: string; author_id: string; author_name: string | null }>()
  ).results;
  for (const c of comments) items.push({ kind: "comment", at: iso(c.created_at)!, by: c.author_name, body: c.body, mine: c.author_id === userId });

  return {
    status: 200,
    body: {
      orderNumber,
      items: items.slice().sort(byTime),
      collaborators: await collaboratorsOf(db, orderNumber),
      canPost: true,
      canManage: access.canManage,
    },
  };
}

// ── People ─────────────────────────────────────────────────────────────

const cannotManage: RouteResult = { status: 403, body: { error: "adding people needs AP.Purchasing where this order is, or Admin.Configure", reason: "cannot_manage" } };

/** `GET /purchase-orders/:number/people?q=` — people and teams to add, each person saying whether they could open it. */
export async function handleSearchOrderPeople(db: D1Database, userId: string, orderNumber: string, query: string | null): Promise<RouteResult> {
  const access = await orderAccess(db, userId, orderNumber);
  if (!access) return notFound;
  if (!access.canManage) return cannotManage;
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
      .prepare(`SELECT t.id, t.name, (SELECT count(*) FROM org_team_members m WHERE m.team_id = t.id) AS members FROM org_teams t WHERE t.name LIKE ? ESCAPE '\\' ORDER BY t.name LIMIT 10`)
      .bind(like)
      .all<{ id: string; name: string; members: number }>()
  ).results;
  return { status: 200, body: { users: await Promise.all(users.map(async (u) => ({ ...u, canSee: await couldSee(db, u.id) }))), teams } };
}

/** `POST /purchase-orders/:number/collaborators` — `{ userId }` or `{ teamId }`; whoever is added is emailed. */
export async function handleAddOrderCollaborator(
  db: D1Database,
  userId: string,
  orderNumber: string,
  body: Record<string, unknown>,
  deps: TimelineDeps,
  now = new Date()
): Promise<RouteResult> {
  const access = await orderAccess(db, userId, orderNumber);
  if (!access) return notFound;
  if (!access.canManage) return cannotManage;
  const personId = typeof body.userId === "string" ? body.userId.trim() : "";
  const teamId = typeof body.teamId === "string" ? body.teamId.trim() : "";
  if (Boolean(personId) === Boolean(teamId)) return { status: 400, body: { error: "name one person (userId) or one team (teamId)", reason: "who_missing" } };

  let name: string;
  let recipients: string[];
  if (personId) {
    const person = await db.prepare("SELECT id, name FROM org_users WHERE id = ? AND status = 'active'").bind(personId).first<{ id: string; name: string }>();
    if (!person) return { status: 404, body: { error: "no such person", reason: "person_not_found" } };
    if (!(await couldSee(db, person.id)))
      return { status: 422, body: { error: `${person.name} could not open this order: give them AP.Validate, AP.Purchasing, AP.Receive or Warehouse.Collaborate`, reason: "cannot_see", name: person.name } };
    const already = await db.prepare("SELECT id FROM purchase_order_collaborators WHERE order_number = ? AND user_id = ? AND removed_at IS NULL").bind(orderNumber, person.id).first();
    if (already) return { status: 200, body: { added: false, collaborators: await collaboratorsOf(db, orderNumber) } };
    name = person.name;
    recipients = [person.id];
  } else {
    const team = await db.prepare("SELECT id, name FROM org_teams WHERE id = ?").bind(teamId).first<{ id: string; name: string }>();
    if (!team) return { status: 404, body: { error: "no such team", reason: "team_not_found" } };
    const already = await db.prepare("SELECT id FROM purchase_order_collaborators WHERE order_number = ? AND team_id = ? AND removed_at IS NULL").bind(orderNumber, team.id).first();
    if (already) return { status: 200, body: { added: false, collaborators: await collaboratorsOf(db, orderNumber) } };
    name = team.name;
    recipients = (await db.prepare("SELECT user_id FROM org_team_members WHERE team_id = ?").bind(team.id).all<{ user_id: string }>()).results.map((m) => m.user_id);
  }

  const at = now.toISOString();
  await db.batch([
    db
      .prepare("INSERT INTO purchase_order_collaborators (id, order_number, user_id, team_id, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), orderNumber, personId || null, teamId || null, userId, at),
    orderEvent(db, orderNumber, "collaborator_added", userId, { kind: personId ? "user" : "team", name }, at),
  ]);
  const actor = await db.prepare("SELECT name FROM org_users WHERE id = ?").bind(userId).first<{ name: string }>();
  const notified = await notify(db, deps, orderNumber, recipients.filter((id) => id !== userId), {
    kind: "added",
    actor: actor?.name ?? "",
    team: teamId ? name : null,
    latest: await latestComment(db, orderNumber),
  });
  return { status: 201, body: { added: true, notified, collaborators: await collaboratorsOf(db, orderNumber) } };
}

/** `DELETE /purchase-orders/:number/collaborators/:id` — the row stays, ended. */
export async function handleRemoveOrderCollaborator(db: D1Database, userId: string, orderNumber: string, collaboratorId: string, now = new Date()): Promise<RouteResult> {
  const access = await orderAccess(db, userId, orderNumber);
  if (!access) return notFound;
  if (!access.canManage) return cannotManage;
  const row = await db
    .prepare(
      `SELECT c.id, c.user_id, u.name AS user_name, t.name AS team_name FROM purchase_order_collaborators c
       LEFT JOIN org_users u ON u.id = c.user_id LEFT JOIN org_teams t ON t.id = c.team_id
       WHERE c.id = ? AND c.order_number = ? AND c.removed_at IS NULL`
    )
    .bind(collaboratorId, orderNumber)
    .first<{ id: string; user_id: string | null; user_name: string | null; team_name: string | null }>();
  if (!row) return { status: 404, body: { error: "not in this order's conversation", reason: "collaborator_not_found" } };
  const at = now.toISOString();
  await db.batch([
    db.prepare("UPDATE purchase_order_collaborators SET removed_at = ?, removed_by = ? WHERE id = ?").bind(at, userId, row.id),
    orderEvent(db, orderNumber, "collaborator_removed", userId, { kind: row.user_id ? "user" : "team", name: row.user_name ?? row.team_name }, at),
  ]);
  return { status: 200, body: { removed: true, collaborators: await collaboratorsOf(db, orderNumber) } };
}

// ── The conversation ───────────────────────────────────────────────────

async function latestComment(db: D1Database, orderNumber: string): Promise<{ by: string; body: string } | null> {
  const c = await db
    .prepare("SELECT c.body, u.name FROM purchase_order_comments c LEFT JOIN org_users u ON u.id = c.author_id WHERE c.order_number = ? ORDER BY c.created_at DESC, c.id DESC LIMIT 1")
    .bind(orderNumber)
    .first<{ body: string; name: string | null }>();
  return c ? { by: c.name ?? "", body: c.body } : null;
}

/** Everyone a new post goes to: the people and team members in it, whoever added them, and anyone who has written in it — not its author. */
async function conversationPeople(db: D1Database, orderNumber: string, authorId: string): Promise<string[]> {
  const rows = (
    await db
      .prepare(
        `SELECT c.user_id AS id FROM purchase_order_collaborators c WHERE c.order_number = ?1 AND c.removed_at IS NULL AND c.user_id IS NOT NULL
         UNION SELECT m.user_id FROM purchase_order_collaborators c JOIN org_team_members m ON m.team_id = c.team_id WHERE c.order_number = ?1 AND c.removed_at IS NULL
         UNION SELECT c.added_by FROM purchase_order_collaborators c WHERE c.order_number = ?1 AND c.removed_at IS NULL
         UNION SELECT author_id FROM purchase_order_comments WHERE order_number = ?1`
      )
      .bind(orderNumber)
      .all<{ id: string }>()
  ).results;
  return rows.map((r) => r.id).filter((id) => id && id !== authorId);
}

/** `POST /purchase-orders/:number/comments` — `{ body }`; everyone else in the conversation is emailed. */
export async function handlePostOrderComment(
  db: D1Database,
  userId: string,
  orderNumber: string,
  body: Record<string, unknown>,
  deps: TimelineDeps,
  now = new Date()
): Promise<RouteResult> {
  const access = await orderAccess(db, userId, orderNumber);
  if (!access) return notFound;
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text) return { status: 400, body: { error: "write something to post", reason: "comment_empty" } };
  if (text.length > MAX_BODY) return { status: 400, body: { error: `a message is at most ${MAX_BODY} characters`, reason: "comment_too_long" } };
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO purchase_order_comments (id, order_number, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)").bind(id, orderNumber, userId, text, now.toISOString()).run();
  await markOrderSeen(db, userId, orderNumber, now);
  const author = await db.prepare("SELECT name FROM org_users WHERE id = ?").bind(userId).first<{ name: string }>();
  const notified = await notify(db, deps, orderNumber, await conversationPeople(db, orderNumber, userId), {
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
    addedSubject: "Purchase order {number}: {actor} added you to its conversation",
    addedTeamSubject: "Purchase order {number}: {actor} added {team} to its conversation",
    addedLine: "{actor} added you to the conversation on purchase order {number}.",
    addedTeamLine: "{actor} added {team}, a team you are in, to the conversation on purchase order {number}.",
    postedSubject: "Purchase order {number}: {actor} wrote",
    postedLine: "{actor} wrote on purchase order {number}:",
    latest: "The latest message, from {by}:",
    open: "Open the order",
    organisation: "Organisation",
    supplier: "Supplier",
    issueDate: "Order date",
    footer: "You get this because you are in this order's conversation in VibeFinance.",
  },
  de: {
    addedSubject: "Bestellung {number}: {actor} hat Sie zur Unterhaltung hinzugefügt",
    addedTeamSubject: "Bestellung {number}: {actor} hat {team} zur Unterhaltung hinzugefügt",
    addedLine: "{actor} hat Sie zur Unterhaltung über Bestellung {number} hinzugefügt.",
    addedTeamLine: "{actor} hat {team}, ein Team, in dem Sie sind, zur Unterhaltung über Bestellung {number} hinzugefügt.",
    postedSubject: "Bestellung {number}: {actor} hat geschrieben",
    postedLine: "{actor} hat zu Bestellung {number} geschrieben:",
    latest: "Die letzte Nachricht, von {by}:",
    open: "Bestellung öffnen",
    organisation: "Organisation",
    supplier: "Lieferant",
    issueDate: "Bestelldatum",
    footer: "Sie erhalten dies, weil Sie in der Unterhaltung zu dieser Bestellung in VibeFinance sind.",
  },
};

const fill = (s: string, values: Record<string, string>) => s.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m);
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface OrderContext {
  organisation: string | null;
  supplier: string | null;
  issueDate: string | null;
}

/** What the email says, in the reader's language. Exported for its test. */
export function orderEmail(
  locale: Locale,
  input: { kind: "added" | "posted"; actor: string; team: string | null; number: string; latest: { by: string; body: string } | null; link: string | null; context?: OrderContext | null }
): { subject: string; text: string; html: string } {
  const w = WORDS[locale];
  const c = input.context ?? null;
  const v = { actor: input.actor, number: input.number, team: input.team ?? "", by: input.latest?.by ?? "" };
  const bare = fill(input.kind === "posted" ? w.postedSubject : input.team ? w.addedTeamSubject : w.addedSubject, v);
  const subject = c?.organisation ? `[${c.organisation}] ${bare}` : bare;
  const lead = fill(input.kind === "posted" ? w.postedLine : input.team ? w.addedTeamLine : w.addedLine, v);
  const quote = input.latest ? [...(input.kind === "added" ? [fill(w.latest, v)] : []), input.latest.body] : [];
  const facts = (c
    ? [
        [w.organisation, c.organisation],
        [w.supplier, c.supplier],
        [w.issueDate, c.issueDate],
      ]
    : []
  ).filter(([, value]) => value) as [string, string][];
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

/** Emails each person who could open the order, in their own language; one send each, never retried, never fatal. */
async function notify(
  db: D1Database,
  deps: TimelineDeps,
  orderNumber: string,
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
  const link = deps.appUrl ? `${deps.appUrl}/?order=${encodeURIComponent(orderNumber)}` : null;
  const order = await orderOf(db, orderNumber);
  const context: OrderContext = { organisation: order?.company_name ?? null, supplier: order?.supplier_name ?? null, issueDate: order?.issue_date ?? null };
  const send = deps.send ?? sendEmailViaResend;
  for (const p of people) {
    if (!p.email || !(await couldSee(db, p.id))) continue;
    const locale: Locale = (p.locale ?? deps.defaultLocale ?? "en").toLowerCase().startsWith("de") ? "de" : "en";
    const mail = orderEmail(locale, { ...what, number: orderNumber, link, context });
    const result = await send(deps.email.apiKey, { from: deps.email.from, to: p.email, subject: mail.subject, text: mail.text, html: mail.html });
    if (result.ok) out.sent++;
    else out.failed++;
  }
  return out;
}

// ── Attachments ────────────────────────────────────────────────────────

/**
 * **What an order came with — decision 0754**, as a receipt's (0659):
 * every message an order, change or cancellation of this number arrived
 * in by a Source Route or Purchase Orders' upload (0749), oldest first,
 * and the files each kept. The same shapes as an invoice's Attachments
 * tab (0571), so the panel is the same panel.
 */
export async function orderMessages(db: D1Database, orderNumber: string): Promise<ReceivedMessage[]> {
  const rows = (
    await db
      .prepare(
        `SELECT m.id, s.name AS source, m.counterparty AS sender, m.subject, m.received_at
         FROM route_messages m LEFT JOIN sources s ON s.id = m.instance_id
         WHERE m.id IN (SELECT route_message_id FROM purchase_order_intake WHERE order_number = ?1 AND route_message_id IS NOT NULL)
            -- Decision 0759: and what was emailed to the supplier.
            OR m.id IN (SELECT message_id FROM purchase_order_sends WHERE order_number = ?1 AND message_id IS NOT NULL)
         ORDER BY m.received_at, m.id`
      )
      .bind(orderNumber)
      .all<{ id: string; source: string | null; sender: string | null; subject: string | null; received_at: string }>()
  ).results;
  return rows.map((m) => ({ id: m.id, source: m.source, sender: m.sender, subject: m.subject, receivedAt: m.received_at, partSeq: null, filename: null, keyed: false }));
}

export async function orderFiles(db: D1Database, orderNumber: string): Promise<ReceivedFile[]> {
  const files: ReceivedFile[] = [];
  for (const m of await orderMessages(db, orderNumber)) {
    const parts = (
      await db
        .prepare("SELECT seq, role, filename, content_type, bytes FROM route_message_parts WHERE message_id = ? AND role IN ('original', 'attachment', 'sent') ORDER BY seq")
        .bind(m.id)
        .all<{ seq: number; role: string; filename: string; content_type: string; bytes: number }>()
    ).results;
    for (const p of parts)
      files.push({ kind: "part", messageId: m.id, seq: p.seq, role: p.role, filename: p.filename, contentType: p.content_type, bytes: p.bytes, thisInvoice: false, view: viewFor(p.content_type, p.filename) });
  }
  return files;
}

/** One received or sent part, if its message is one this order came in or went out by. */
export async function partForOrder(db: D1Database, orderNumber: string, messageId: string, seq: number): Promise<{ r2Key: string; filename: string; contentType: string } | null> {
  if (!(await orderMessages(db, orderNumber)).some((m) => m.id === messageId)) return null;
  const row = await db
    .prepare("SELECT r2_key, filename, content_type FROM route_message_parts WHERE message_id = ? AND seq = ? AND role IN ('original', 'attachment', 'sent')")
    .bind(messageId, seq)
    .first<{ r2_key: string; filename: string; content_type: string }>();
  return row ? { r2Key: row.r2_key, filename: row.filename, contentType: row.content_type } : null;
}

/** `GET /purchase-orders/:number/attachments` — for whoever may open the order. */
export async function handleOrderAttachments(db: D1Database, userId: string, orderNumber: string): Promise<RouteResult> {
  if (!(await orderAccess(db, userId, orderNumber))) return notFound;
  return { status: 200, body: { messages: await orderMessages(db, orderNumber), files: await orderFiles(db, orderNumber) } };
}

/** The subject a part token names for an order's file: never an invoice id, nor a receipt's. */
export const ORDER_TOKEN_PREFIX = "order:";

// ── Conversations, on Tasks ────────────────────────────────────────────

/**
 * **The conversation here, in Conversations — decision 0754**, as a
 * receipt's (0660): orders whose conversation this person is part of
 * (in it by name or team, added someone, or wrote) where they were added,
 * or others wrote, since they last caught up. Merged with what the
 * supplier wrote (0752) by order-messages.ts.
 */
export async function orderChatNews(db: D1Database, userId: string): Promise<Map<string, { added: { by: string | null; team: string | null; at: string } | null; fresh: number; latest: { by: string | null; body: string; at: string } | null }>> {
  const candidates = (
    await db
      .prepare(
        `SELECT order_number FROM purchase_order_collaborators WHERE removed_at IS NULL AND (user_id = ?1 OR added_by = ?1 OR team_id IN (SELECT team_id FROM org_team_members WHERE user_id = ?1))
         UNION SELECT order_number FROM purchase_order_comments WHERE author_id = ?1`
      )
      .bind(userId)
      .all<{ order_number: string }>()
  ).results.map((r) => r.order_number);
  const out = new Map();
  for (const orderNumber of candidates) {
    const seen = (await db.prepare("SELECT seen_at FROM purchase_order_reads WHERE order_number = ? AND user_id = ?").bind(orderNumber, userId).first<{ seen_at: string }>())?.seen_at ?? null;
    const added = await db
      .prepare(
        `SELECT c.added_at, ab.name AS added_by, t.name AS team FROM purchase_order_collaborators c
         LEFT JOIN org_users ab ON ab.id = c.added_by LEFT JOIN org_teams t ON t.id = c.team_id
         WHERE c.order_number = ?1 AND c.removed_at IS NULL AND c.added_by != ?2
           AND (c.user_id = ?2 OR c.team_id IN (SELECT team_id FROM org_team_members WHERE user_id = ?2))
         ORDER BY c.added_at DESC LIMIT 1`
      )
      .bind(orderNumber, userId)
      .first<{ added_at: string; added_by: string | null; team: string | null }>();
    const addedNew = added && (!seen || added.added_at > seen) ? added : null;
    const since = seen ?? added?.added_at ?? null;
    const fresh = await db
      .prepare(`SELECT count(*) AS n FROM purchase_order_comments WHERE order_number = ? AND author_id != ? ${since ? "AND created_at > ?" : ""}`)
      .bind(...[orderNumber, userId, ...(since ? [since] : [])])
      .first<{ n: number }>();
    if (!addedNew && !(fresh?.n ?? 0)) continue;
    if (!(await orderAccess(db, userId, orderNumber))) continue;
    const latest = await db
      .prepare("SELECT c.body, c.created_at, u.name FROM purchase_order_comments c LEFT JOIN org_users u ON u.id = c.author_id WHERE c.order_number = ? ORDER BY c.created_at DESC, c.id DESC LIMIT 1")
      .bind(orderNumber)
      .first<{ body: string; created_at: string; name: string | null }>();
    out.set(orderNumber, {
      added: addedNew ? { by: addedNew.added_by, team: addedNew.team, at: iso(addedNew.added_at)! } : null,
      fresh: fresh?.n ?? 0,
      latest: latest ? { by: latest.name, body: latest.body, at: iso(latest.created_at)! } : null,
    });
  }
  return out;
}
