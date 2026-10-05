import { hasPermission, unitsWherePermitted } from "./enforce.js";
import type { Permission } from "./permissions.js";
import type { RouteResult } from "./org-route.js";
import { agentTimeZone } from "./agents.js";
import { resolveApprovalLimit } from "./approval-hierarchy.js";

/**
 * **Absence and cover — decision 0641** (Agents phase 3, slice 3, as
 * Dan asked it on 5 October 2026):
 *
 * - *"A user should be able to mark themselves as Absent, stating start
 *   and return periods."*
 * - *"An AP Manager should be able to review all users in their team and
 *   also cancel or amend an entry."*
 * - *"An absence should be able to reassign owned items to an alternate
 *   user."*
 *
 * An absence runs from its first day away to the day its person returns
 * (`starts_on <= today < returns_on`, in the organisation's time zone).
 * While it runs, the five-minute tick passes each open task the person
 * holds — a claim on a team's task, or a task named to them — to the
 * cover, **if the cover may do it**: the task's permission where the
 * invoice is, and for an approval, a limit at least the invoice's total.
 * What the cover may not do stays, and says why. On the return, or a
 * cancellation, what was passed and is still open with the cover comes
 * back. Every move is a `reassign` on the invoice's Timeline, by whoever
 * arranged the absence.
 */

export interface AbsenceRow {
  id: string;
  user_id: string;
  starts_on: string;
  returns_on: string;
  cover_user_id: string | null;
  pass_tasks: number;
  hand_back: number;
  note: string | null;
  created_by: string;
  created_at: string;
  updated_by: string | null;
  updated_at: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  ended_at: string | null;
}

const NOTE_MAX = 300;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isDate(v: unknown): v is string {
  return typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}

/** Today in the organisation's time zone, as YYYY-MM-DD. */
export async function localToday(db: D1Database, now: Date): Promise<string> {
  const zone = await agentTimeZone(db);
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export type AbsenceState = "planned" | "away" | "back" | "cancelled";

export function stateOf(a: Pick<AbsenceRow, "starts_on" | "returns_on" | "cancelled_at">, today: string): AbsenceState {
  if (a.cancelled_at) return "cancelled";
  if (today < a.starts_on) return "planned";
  if (today < a.returns_on) return "away";
  return "back";
}

/**
 * **The people an AP Manager looks after**: those who share a team with
 * them, and those who report to them. Not themselves.
 */
export async function teamOf(db: D1Database, managerId: string): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT DISTINCT m2.user_id AS id FROM org_team_members m1
         JOIN org_team_members m2 ON m2.team_id = m1.team_id
       WHERE m1.user_id = ? AND m2.user_id <> ?
       UNION
       SELECT id FROM org_users WHERE manager_id = ?`,
    )
    .bind(managerId, managerId, managerId)
    .all<{ id: string }>();
  return rows.results.map((r) => r.id);
}

/** May this person arrange, amend or cancel an absence for that one? Themselves, or an AP Manager for their team. */
async function mayArrange(db: D1Database, userId: string, forUserId: string): Promise<boolean> {
  if (userId === forUserId) return true;
  if (!(await hasPermission(db, userId, "AP.Manager"))) return false;
  return (await teamOf(db, userId)).includes(forUserId);
}

/**
 * **Who may cover**: those who share a team with the person, and their
 * manager. Where the person is in no team and has no manager, anyone who
 * works tasks. Never the person themselves.
 */
async function coverCandidates(db: D1Database, forUserId: string): Promise<{ id: string; name: string }[]> {
  const rows = await db
    .prepare(
      `SELECT DISTINCT u.id, COALESCE(u.name, u.email, u.id) AS name FROM org_users u
       WHERE u.id <> ?1 AND (
         u.id IN (SELECT m2.user_id FROM org_team_members m1 JOIN org_team_members m2 ON m2.team_id = m1.team_id WHERE m1.user_id = ?1)
         OR u.id = (SELECT manager_id FROM org_users WHERE id = ?1)
       )
       ORDER BY name`,
    )
    .bind(forUserId)
    .all<{ id: string; name: string }>();
  if (rows.results.length > 0) return rows.results;
  const everyone = await db
    .prepare(
      `SELECT DISTINCT u.id, COALESCE(u.name, u.email, u.id) AS name FROM org_users u
       JOIN org_user_roles ur ON ur.user_id = u.id JOIN org_roles r ON r.id = ur.role_id
       WHERE u.id <> ? AND r.permissions_json LIKE '%"AP.TaskView"%' ORDER BY name`,
    )
    .bind(forUserId)
    .all<{ id: string; name: string }>();
  return everyone.results;
}

async function names(db: D1Database, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await db
    .prepare(`SELECT id, COALESCE(name, email, id) AS name FROM org_users WHERE id IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify(unique))
    .all<{ id: string; name: string }>();
  return new Map(rows.results.map((r) => [r.id, r.name]));
}

async function bodyOf(db: D1Database, rows: AbsenceRow[], today: string, viewerId: string) {
  const who = await names(db, rows.flatMap((a) => [a.user_id, a.cover_user_id ?? "", a.created_by, a.updated_by ?? "", a.cancelled_by ?? ""]));
  const moves = rows.length
    ? await db
        .prepare(
          `SELECT absence_id, status, reason, count(*) AS n FROM absence_moves
           WHERE absence_id IN (SELECT value FROM json_each(?)) GROUP BY absence_id, status, reason`,
        )
        .bind(JSON.stringify(rows.map((a) => a.id)))
        .all<{ absence_id: string; status: string; reason: string | null; n: number }>()
    : { results: [] };
  const out = [];
  for (const a of rows) {
    const mine = moves.results.filter((m) => m.absence_id === a.id);
    out.push({
      id: a.id,
      userId: a.user_id,
      userName: who.get(a.user_id) ?? a.user_id,
      startsOn: a.starts_on,
      returnsOn: a.returns_on,
      coverUserId: a.cover_user_id,
      coverName: a.cover_user_id ? (who.get(a.cover_user_id) ?? a.cover_user_id) : null,
      passTasks: a.pass_tasks === 1,
      handBack: a.hand_back === 1,
      note: a.note,
      state: stateOf(a, today),
      createdBy: who.get(a.created_by) ?? a.created_by,
      updatedBy: a.updated_by ? (who.get(a.updated_by) ?? a.updated_by) : null,
      updatedAt: a.updated_at,
      cancelledBy: a.cancelled_by ? (who.get(a.cancelled_by) ?? a.cancelled_by) : null,
      // What became of their tasks: passed, kept (and why), handed back.
      tasks: {
        moved: mine.filter((m) => m.status === "moved").reduce((n, m) => n + m.n, 0),
        returned: mine.filter((m) => m.status === "returned").reduce((n, m) => n + m.n, 0),
        kept: mine.filter((m) => m.status === "kept").map((m) => ({ reason: m.reason, count: m.n })),
      },
      mayChange: a.cancelled_at === null && stateOf(a, today) !== "back" && (await mayArrange(db, viewerId, a.user_id)),
    });
  }
  return out;
}

/**
 * `GET /absences`: the person's own absences, and — for an AP Manager —
 * their team's, current and to come, with who may cover each person.
 */
export async function handleListAbsences(db: D1Database, userId: string, now = new Date()): Promise<RouteResult> {
  const today = await localToday(db, now);
  const mine = await db
    .prepare("SELECT * FROM absences WHERE user_id = ? AND returns_on > date(?, '-30 days') ORDER BY starts_on DESC LIMIT 50")
    .bind(userId, today)
    .all<AbsenceRow>();
  const isManager = await hasPermission(db, userId, "AP.Manager");
  const team = isManager ? await teamOf(db, userId) : [];
  const theirs = team.length
    ? await db
        .prepare(
          "SELECT * FROM absences WHERE user_id IN (SELECT value FROM json_each(?)) AND returns_on > ? ORDER BY starts_on, user_id LIMIT 200",
        )
        .bind(JSON.stringify(team), today)
        .all<AbsenceRow>()
    : { results: [] };
  const people = isManager ? [...(await names(db, team)).entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)) : [];
  return {
    status: 200,
    body: {
      me: userId,
      today,
      timeZone: await agentTimeZone(db),
      mine: await bodyOf(db, mine.results, today, userId),
      team: await bodyOf(db, theirs.results, today, userId),
      canManage: isManager,
      // Whom this person covers for today.
      covering: await coveringFor(db, userId, now),
      // Whom an absence may be arranged for: oneself, and one's team.
      people,
      // Who may cover each person.
      covers: Object.fromEntries(
        await Promise.all([userId, ...team].map(async (id) => [id, await coverCandidates(db, id)] as const)),
      ),
    },
  };
}

type Checked = {
  userId: string;
  startsOn: string;
  returnsOn: string;
  coverUserId: string | null;
  passTasks: boolean;
  handBack: boolean;
  note: string | null;
};

async function checkInput(
  db: D1Database,
  actorId: string,
  input: Record<string, unknown>,
  today: string,
  current?: AbsenceRow,
): Promise<Checked | { reason: string; message: string; status?: number }> {
  const userId = current?.user_id ?? (typeof input.userId === "string" && input.userId ? input.userId : actorId);
  if (!(await mayArrange(db, actorId, userId)))
    return { reason: "not_yours", message: "only the person, or an AP Manager for their team, may arrange their absence", status: 403 };
  const startsOn = input.startsOn !== undefined ? input.startsOn : current?.starts_on;
  const returnsOn = input.returnsOn !== undefined ? input.returnsOn : current?.returns_on;
  if (!isDate(startsOn) || !isDate(returnsOn)) return { reason: "dates_invalid", message: "give the first day away and the day back" };
  if (startsOn >= returnsOn) return { reason: "dates_order", message: "the day back must be after the first day away" };
  // A new absence, or a moved start, cannot begin in the past; one already running keeps its start.
  const startMoved = !current || startsOn !== current.starts_on;
  if (startMoved && startsOn < today) return { reason: "starts_in_past", message: "the first day away cannot be in the past" };
  if (returnsOn <= today && (!current || returnsOn !== current.returns_on))
    return { reason: "returns_in_past", message: "the day back must be after today" };
  const coverRaw = input.coverUserId !== undefined ? input.coverUserId : current?.cover_user_id;
  const coverUserId = typeof coverRaw === "string" && coverRaw ? coverRaw : null;
  if (coverUserId) {
    if (coverUserId === userId) return { reason: "cover_self", message: "someone else must cover" };
    const allowed = (await coverCandidates(db, userId)).map((c) => c.id);
    if (!allowed.includes(coverUserId)) return { reason: "cover_not_allowed", message: "the cover must share a team with them, or be their manager" };
    // The cover cannot be away themselves for any of it.
    const away = await db
      .prepare("SELECT 1 FROM absences WHERE user_id = ? AND cancelled_at IS NULL AND starts_on < ? AND returns_on > ? LIMIT 1")
      .bind(coverUserId, returnsOn, startsOn)
      .first();
    if (away) return { reason: "cover_away", message: "the cover is away for some of that time" };
  }
  const overlap = await db
    .prepare("SELECT 1 FROM absences WHERE user_id = ? AND cancelled_at IS NULL AND id <> ? AND starts_on < ? AND returns_on > ? LIMIT 1")
    .bind(userId, current?.id ?? "", returnsOn, startsOn)
    .first();
  if (overlap) return { reason: "overlaps", message: "they are already away for some of that time" };
  const passTasks = typeof input.passTasks === "boolean" ? input.passTasks : current ? current.pass_tasks === 1 : true;
  if (passTasks && !coverUserId) return { reason: "cover_missing", message: "choose who covers, or keep the tasks" };
  const handBack = typeof input.handBack === "boolean" ? input.handBack : current ? current.hand_back === 1 : true;
  const note =
    typeof input.note === "string" ? input.note.trim().slice(0, NOTE_MAX) || null : input.note === null ? null : (current?.note ?? null);
  return { userId, startsOn, returnsOn, coverUserId, passTasks, handBack, note };
}

/** `POST /absences`: mark oneself — or, as an AP Manager, one of one's team — absent. */
export async function handleCreateAbsence(db: D1Database, actorId: string, input: Record<string, unknown>, now = new Date()): Promise<RouteResult> {
  const today = await localToday(db, now);
  const c = await checkInput(db, actorId, input, today);
  if ("reason" in c) return { status: c.status ?? 422, body: { error: c.message, reason: c.reason } };
  const id = `abs-${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO absences (id, user_id, starts_on, returns_on, cover_user_id, pass_tasks, hand_back, note, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, c.userId, c.startsOn, c.returnsOn, c.coverUserId, c.passTasks ? 1 : 0, c.handBack ? 1 : 0, c.note, actorId, now.toISOString())
    .run();
  // Starting today: the tasks pass now, not at the next tick.
  if (c.startsOn <= today) await processAbsences(db, now);
  return { status: 201, body: { id } };
}

async function load(db: D1Database, id: string): Promise<AbsenceRow | null> {
  return db.prepare("SELECT * FROM absences WHERE id = ?").bind(id).first<AbsenceRow>();
}

/**
 * `PATCH /absences/:id`: amend the dates, the cover, or what happens to
 * the tasks. While it runs, a new cover takes over what the old one was
 * passed; an earlier return, or keeping the tasks, hands them back now.
 */
export async function handleAmendAbsence(db: D1Database, actorId: string, id: string, input: Record<string, unknown>, now = new Date()): Promise<RouteResult> {
  const current = await load(db, id);
  if (!current) return { status: 404, body: { error: "no such absence", reason: "not_found" } };
  const today = await localToday(db, now);
  if (current.cancelled_at || stateOf(current, today) === "back")
    return { status: 409, body: { error: "that absence is over", reason: "over" } };
  const c = await checkInput(db, actorId, input, today, current);
  if ("reason" in c) return { status: c.status ?? 422, body: { error: c.message, reason: c.reason } };
  const wasAway = stateOf(current, today) === "away";
  await db
    .prepare(
      `UPDATE absences SET starts_on = ?, returns_on = ?, cover_user_id = ?, pass_tasks = ?, hand_back = ?, note = ?, updated_by = ?, updated_at = ?
       WHERE id = ? AND cancelled_at IS NULL`,
    )
    .bind(c.startsOn, c.returnsOn, c.coverUserId, c.passTasks ? 1 : 0, c.handBack ? 1 : 0, c.note, actorId, now.toISOString(), id)
    .run();
  const after = (await load(db, id))!;
  // While away: a different cover, or no longer passing tasks, gives back what was passed first.
  if (wasAway && (after.cover_user_id !== current.cover_user_id || !after.pass_tasks)) {
    await giveBack(db, after, actorId, now, "amended");
  }
  await processAbsences(db, now);
  return { status: 200, body: { id } };
}

/** `POST /absences/:id/cancel`: called off. What was passed comes back now, if it was to come back. */
export async function handleCancelAbsence(db: D1Database, actorId: string, id: string, now = new Date()): Promise<RouteResult> {
  const current = await load(db, id);
  if (!current) return { status: 404, body: { error: "no such absence", reason: "not_found" } };
  if (!(await mayArrange(db, actorId, current.user_id)))
    return { status: 403, body: { error: "only the person, or an AP Manager for their team, may cancel it", reason: "not_yours" } };
  const today = await localToday(db, now);
  if (current.cancelled_at || stateOf(current, today) === "back")
    return { status: 409, body: { error: "that absence is over", reason: "over" } };
  const done = await db
    .prepare("UPDATE absences SET cancelled_by = ?, cancelled_at = ?, ended_at = ? WHERE id = ? AND cancelled_at IS NULL")
    .bind(actorId, now.toISOString(), now.toISOString(), id)
    .run();
  if ((done.meta?.changes ?? 0) !== 1) return { status: 409, body: { error: "that absence is over", reason: "over" } };
  if (current.hand_back === 1) await giveBack(db, current, actorId, now, "cancelled");
  return { status: 200, body: { id } };
}

// ---------------------------------------------------------------------------
// Passing tasks, and handing them back.
// ---------------------------------------------------------------------------

interface HeldTask {
  id: string;
  field: "claimed_by" | "owner_user_id";
  required_permission: string;
  org_unit_id: string | null;
  total: number | null;
  currency: string | null;
}

/** Why the cover may not take this task, or null when they may. */
async function whyNot(db: D1Database, coverId: string, t: HeldTask): Promise<string | null> {
  const visible = await unitsWherePermitted(db, coverId, t.required_permission as Permission);
  const covers = visible === null || (t.org_unit_id !== null ? visible.includes(t.org_unit_id) : visible.length > 0);
  if (!covers) return `permission:${t.required_permission}`;
  // An approval needs an approver whose limit covers the invoice (decision 0009, 0334).
  if (t.required_permission === "AP.Approve" && t.total !== null && t.currency) {
    const limit = await resolveApprovalLimit(db, coverId, t.org_unit_id, t.currency);
    if (limit === null || limit < t.total) return `limit:${t.currency}`;
  }
  return null;
}

function absenceWords(a: AbsenceRow): string {
  return `Away ${a.starts_on} until ${a.returns_on}`;
}

async function passTasks(db: D1Database, a: AbsenceRow, now: Date): Promise<number> {
  if (!a.pass_tasks || !a.cover_user_id) return 0;
  const held = await db
    .prepare(
      `SELECT t.id, CASE WHEN t.claimed_by = ?1 THEN 'claimed_by' ELSE 'owner_user_id' END AS field,
              t.required_permission, h.org_unit_id, h.total_with_vat AS total, h.currency
       FROM tasks t
       LEFT JOIN stage_visits v ON v.id = t.stage_visit_id
       LEFT JOIN process_instances pi ON pi.id = v.process_instance_id
       LEFT JOIN invoice_headers h ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
       WHERE t.status = 'open' AND (t.claimed_by = ?1 OR (t.owner_user_id = ?1 AND t.claimed_by IS NULL))
         AND NOT EXISTS (SELECT 1 FROM absence_moves m WHERE m.absence_id = ?2 AND m.task_id = t.id AND m.status IN ('kept', 'moved'))
       ORDER BY t.created_at`,
    )
    .bind(a.user_id, a.id)
    .all<HeldTask>();
  const at = now.toISOString();
  let moved = 0;
  for (const t of held.results) {
    const why = await whyNot(db, a.cover_user_id, t);
    if (why) {
      await db
        .prepare(
          `INSERT INTO absence_moves (absence_id, task_id, field, from_user_id, to_user_id, status, reason, at) VALUES (?, ?, ?, ?, ?, 'kept', ?, ?)
           ON CONFLICT(absence_id, task_id) DO UPDATE SET status = 'kept', reason = excluded.reason, at = excluded.at`,
        )
        .bind(a.id, t.id, t.field, a.user_id, a.cover_user_id, why, at)
        .run();
      continue;
    }
    // Only if it is still theirs, the same race-safe way a reassignment is (decision 0489).
    const done = await db
      .prepare(
        t.field === "claimed_by"
          ? "UPDATE tasks SET claimed_by = ?, claimed_at = ? WHERE id = ? AND status = 'open' AND claimed_by = ?"
          : "UPDATE tasks SET owner_user_id = ? WHERE id = ? AND status = 'open' AND owner_user_id = ? AND claimed_by IS NULL",
      )
      .bind(...(t.field === "claimed_by" ? [a.cover_user_id, at, t.id, a.user_id] : [a.cover_user_id, t.id, a.user_id]))
      .run();
    if ((done.meta?.changes ?? 0) !== 1) continue;
    await db.batch([
      db
        .prepare(
          `INSERT INTO absence_moves (absence_id, task_id, field, from_user_id, to_user_id, status, reason, at) VALUES (?, ?, ?, ?, ?, 'moved', NULL, ?)
           ON CONFLICT(absence_id, task_id) DO UPDATE SET status = 'moved', reason = NULL, to_user_id = excluded.to_user_id, at = excluded.at`,
        )
        .bind(a.id, t.id, t.field, a.user_id, a.cover_user_id, at),
      db
        .prepare(
          "INSERT INTO task_action_events (id, task_id, action, actor_id, at, comment, target_user_id) VALUES (?, ?, 'reassign', ?, ?, ?, ?)",
        )
        .bind(crypto.randomUUID(), t.id, a.updated_by ?? a.created_by, at, `${absenceWords(a)}: passed to cover`, a.cover_user_id),
    ]);
    moved += 1;
  }
  return moved;
}

/** What was passed and is still open with the cover goes back to the person. */
async function giveBack(db: D1Database, a: AbsenceRow, actorId: string, now: Date, why: "returned" | "cancelled" | "amended"): Promise<number> {
  const moves = await db
    .prepare("SELECT task_id, field, to_user_id FROM absence_moves WHERE absence_id = ? AND status = 'moved'")
    .bind(a.id)
    .all<{ task_id: string; field: "claimed_by" | "owner_user_id"; to_user_id: string }>();
  const at = now.toISOString();
  let back = 0;
  for (const m of moves.results) {
    const done = await db
      .prepare(
        m.field === "claimed_by"
          ? "UPDATE tasks SET claimed_by = ?, claimed_at = ? WHERE id = ? AND status = 'open' AND claimed_by = ?"
          : "UPDATE tasks SET owner_user_id = ? WHERE id = ? AND status = 'open' AND owner_user_id = ? AND claimed_by IS NULL",
      )
      .bind(...(m.field === "claimed_by" ? [a.user_id, at, m.task_id, m.to_user_id] : [a.user_id, m.task_id, m.to_user_id]))
      .run();
    const returned = (done.meta?.changes ?? 0) === 1;
    await db
      .prepare("UPDATE absence_moves SET status = ?, at = ? WHERE absence_id = ? AND task_id = ?")
      .bind(returned ? "returned" : "left", at, a.id, m.task_id)
      .run();
    if (!returned) continue;
    const words = why === "returned" ? "back: handed back" : why === "cancelled" ? "absence cancelled: handed back" : "cover changed: handed back";
    await db
      .prepare("INSERT INTO task_action_events (id, task_id, action, actor_id, at, comment, target_user_id) VALUES (?, ?, 'reassign', ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), m.task_id, actorId, at, `${absenceWords(a)}, ${words}`, a.user_id)
      .run();
    back += 1;
  }
  // A move given back during an amendment can be passed again to the new cover.
  if (why === "amended") {
    await db.prepare("DELETE FROM absence_moves WHERE absence_id = ? AND status IN ('returned', 'left', 'kept')").bind(a.id).run();
  }
  return back;
}

/**
 * **The five-minute tick.** Absences running today pass what their
 * people hold to the cover (new tasks too, as they arrive); absences
 * whose day back has come hand back what was passed, once.
 */
export async function processAbsences(db: D1Database, now = new Date()): Promise<{ passed: number; returned: number }> {
  const today = await localToday(db, now);
  const running = await db
    .prepare("SELECT * FROM absences WHERE cancelled_at IS NULL AND starts_on <= ? AND returns_on > ? AND pass_tasks = 1 AND cover_user_id IS NOT NULL")
    .bind(today, today)
    .all<AbsenceRow>();
  let passed = 0;
  for (const a of running.results) passed += await passTasks(db, a, now);
  const over = await db
    .prepare("SELECT * FROM absences WHERE cancelled_at IS NULL AND ended_at IS NULL AND returns_on <= ?")
    .bind(today)
    .all<AbsenceRow>();
  let returned = 0;
  for (const a of over.results) {
    const claimed = await db.prepare("UPDATE absences SET ended_at = ? WHERE id = ? AND ended_at IS NULL").bind(now.toISOString(), a.id).run();
    if ((claimed.meta?.changes ?? 0) !== 1) continue;
    if (a.hand_back === 1) returned += await giveBack(db, a, a.user_id, now, "returned");
  }
  return { passed, returned };
}

/** Decision 0641: whom this person covers for today, for the task list. */
export async function coveringFor(db: D1Database, userId: string, now = new Date()) {
  const today = await localToday(db, now);
  const rows = await db
    .prepare(
      `SELECT a.user_id, COALESCE(u.name, u.email, u.id) AS name, a.returns_on FROM absences a JOIN org_users u ON u.id = a.user_id
       WHERE a.cover_user_id = ? AND a.cancelled_at IS NULL AND a.starts_on <= ? AND a.returns_on > ? ORDER BY a.returns_on`,
    )
    .bind(userId, today, today)
    .all<{ user_id: string; name: string; returns_on: string }>();
  return rows.results.map((r) => ({ userId: r.user_id, name: r.name, returnsOn: r.returns_on }));
}

/**
 * **This person's absence state, for the button in the top bar —
 * decision 0642.** Away now (and until when), and how many people they
 * cover for today.
 */
export async function absenceStatus(db: D1Database, userId: string, now = new Date()): Promise<{ awayUntil: string | null; covering: number }> {
  const today = await localToday(db, now);
  const away = await db
    .prepare("SELECT returns_on FROM absences WHERE user_id = ? AND cancelled_at IS NULL AND starts_on <= ? AND returns_on > ? LIMIT 1")
    .bind(userId, today, today)
    .first<{ returns_on: string }>();
  const covering = await db
    .prepare("SELECT count(*) AS n FROM absences WHERE cover_user_id = ? AND cancelled_at IS NULL AND starts_on <= ? AND returns_on > ?")
    .bind(userId, today, today)
    .first<{ n: number }>();
  return { awayUntil: away?.returns_on ?? null, covering: covering?.n ?? 0 };
}
