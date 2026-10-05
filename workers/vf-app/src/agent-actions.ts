import { unitsWherePermitted } from "./enforce.js";
import { readLicenceState } from "./licence-cache.js";
import type { Permission } from "./permissions.js";
import type { RouteResult } from "./org-route.js";
import { sendEmailViaResend } from "./resend-client.js";
import { buildReminderEmail, emailLocale } from "./agent-email.js";
import {
  REPLY_ARRIVED_SQL,
  tableInvoiceIds,
  type AgentDeps,
} from "./agents.js";
import {
  chaseLocale,
  chaseTemplate,
  chaseWording,
  strayInChase,
  type ChaseFacts,
} from "./agent-chase.js";
import { summaryLimit, takeSummary } from "./agent-summary.js";

/**
 * **Prepared actions — decision 0631 (Agents phase 3, slice 1).**
 *
 * An agent may also get something ready to do. It waits on the Tasks
 * screen ("For your approval") for a person who holds the action's own
 * permission where the invoice is: the agent's author or anyone else
 * (Dan, 4 October 2026). Approved, VibeFinance first checks nothing has
 * changed, then does it as that person, and keeps what happened.
 * Rejected, or unapproved after 5 working days, nothing is done.
 *
 * The first action: **remind whoever holds a stuck task**. It changes
 * nothing about the invoice; the holder is emailed in their own
 * language, and the invoice's Timeline says who reminded whom.
 */

export type AgentActionKind = "remind_holder" | "chase_supplier";

export const AGENT_ACTIONS: Record<
  AgentActionKind,
  {
    permission: Permission;
    reports: string[];
    /** Decision 0638: the datasets whose questions can prepare it, by the invoices in their rows. */
    datasets: string[];
  }
> = {
  remind_holder: {
    permission: "AP.TaskManage",
    reports: ["stuck_work", "event_stuck"],
    datasets: ["invoices", "tasks", "stage_visits"],
  },
  // Decision 0632: as for Return To Supplier itself.
  chase_supplier: {
    permission: "AP.ReturnToSupplier",
    reports: ["returned_no_reply"],
    datasets: ["returns"],
  },
};

/** A prepared action lapses after this many working days. */
export const ACTION_WAIT_WORKING_DAYS = 5;
/** The same task is not reminded about again within this many days. */
export const REMIND_AGAIN_DAYS = 7;
const NOTE_MAX = 500;

/** `n` working days (Monday to Friday) after `from`, at the same time. */
export function addWorkingDays(from: Date, n: number): Date {
  const d = new Date(from.getTime());
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) left -= 1;
  }
  return d;
}

/** Whether prepared actions are on: the environment's switch, and the licence. */
export async function actionsEnabled(
  db: D1Database,
): Promise<{ environment: boolean; licence: boolean }> {
  const row = await db
    .prepare("SELECT agent_actions FROM org_settings WHERE id = 1")
    .first<{ agent_actions: number | null }>();
  const state = await readLicenceState(db);
  const claim = state.known
    ? (state.claims as { agentActions?: unknown }).agentActions
    : undefined;
  return {
    environment: row ? row.agent_actions !== 0 : true,
    licence: claim !== false,
  };
}

/** An agent's action as sent, checked against its report. */
export function checkAction(
  reportId: string,
  input: unknown,
  dataset?: string | null,
): { action: AgentActionKind | null } | { reason: string } {
  if (input === undefined || input === null || input === "")
    return { action: null };
  if (typeof input !== "string" || !(input in AGENT_ACTIONS))
    return { reason: "action_unknown" };
  const kind = input as AgentActionKind;
  const fits =
    reportId === "query"
      ? Boolean(dataset) && AGENT_ACTIONS[kind].datasets.includes(dataset!)
      : AGENT_ACTIONS[kind].reports.includes(reportId);
  if (!fits) return { reason: "action_not_for_report" };
  return { action: kind };
}

/** Decision 0638: the actions a question of this dataset can prepare. */
export function actionsForDataset(dataset: string): AgentActionKind[] {
  return (Object.keys(AGENT_ACTIONS) as AgentActionKind[]).filter((k) => AGENT_ACTIONS[k].datasets.includes(dataset));
}

/** The actions a report can prepare, for the form. */
export function actionsForReport(reportId: string): AgentActionKind[] {
  return (Object.keys(AGENT_ACTIONS) as AgentActionKind[]).filter((k) =>
    AGENT_ACTIONS[k].reports.includes(reportId),
  );
}

interface ReminderPayload {
  taskId: string;
  holderId: string;
  holderName: string;
  invoiceId: string;
  invoiceNumber: string | null;
  supplier: string | null;
  stage: string;
  days: number;
}

/**
 * After a run: prepare the agent's action from the author's own copy, so
 * nothing is prepared about an invoice the author may not see. For each
 * invoice in it, each open task held by someone and older than the
 * report's own days: one reminder, unless one waits or one was prepared
 * in the last `REMIND_AGAIN_DAYS` days. Returns how many were prepared.
 */
export async function prepareActions(
  db: D1Database,
  agent: { id: string; action?: string | null },
  table: {
    rows: Record<string, unknown>[];
    options?: { olderThanDays?: number; stageDays?: number };
  } | null,
  runId: string,
  now: Date,
  deps: Pick<AgentDeps, "model"> = {},
): Promise<number> {
  if (!agent.action || !table || table.rows.length === 0) return 0;
  const on = await actionsEnabled(db);
  if (!on.environment || !on.licence) return 0;
  if (agent.action === "chase_supplier")
    return prepareChasers(db, agent, table, runId, now, deps);
  if (agent.action !== "remind_holder") return 0;
  const ids = tableInvoiceIds(table);
  if (ids.length === 0) return 0;
  const days = table.options?.olderThanDays ?? table.options?.stageDays ?? 3;
  const before = new Date(now.getTime() - days * 86_400_000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
  const tasks = await db
    .prepare(
      `SELECT t.id AS task_id, t.created_at AS created_at, COALESCE(t.owner_user_id, t.claimed_by) AS holder_id,
              COALESCE(u.name, u.email, u.id) AS holder_name, s.name AS stage_name, h.id AS invoice_id, h.org_unit_id AS org_unit_id,
              COALESCE(h.invoice_number, json_extract(h.facts_json, '$."BT-1"')) AS number,
              COALESCE(sup.name, json_extract(h.facts_json, '$."BT-27"')) AS supplier_name
       FROM tasks t
       JOIN process_stages s ON s.id = t.stage_id
       JOIN stage_visits v ON v.id = t.stage_visit_id
       JOIN process_instances pi ON pi.id = v.process_instance_id
       JOIN invoice_headers h ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
       JOIN org_users u ON u.id = COALESCE(t.owner_user_id, t.claimed_by)
       LEFT JOIN suppliers sup ON sup.id = h.supplier_id
       WHERE t.status = 'open' AND h.id IN (SELECT value FROM json_each(?)) AND replace(t.created_at, 'T', ' ') < ?
       ORDER BY t.created_at`,
    )
    .bind(JSON.stringify(ids), before)
    .all<{
      task_id: string;
      created_at: string;
      holder_id: string;
      holder_name: string;
      stage_name: string;
      invoice_id: string;
      org_unit_id: string | null;
      number: string | null;
      supplier_name: string | null;
    }>();
  const since = new Date(
    now.getTime() - REMIND_AGAIN_DAYS * 86_400_000,
  ).toISOString();
  const expires = addWorkingDays(now, ACTION_WAIT_WORKING_DAYS).toISOString();
  let prepared = 0;
  for (const t of tasks.results) {
    const key = `task:${t.task_id}`;
    const recent = await db
      .prepare(
        "SELECT 1 FROM agent_actions WHERE agent_id = ? AND kind = 'remind_holder' AND subject_key = ? AND (status = 'waiting' OR prepared_at >= ?) LIMIT 1",
      )
      .bind(agent.id, key, since)
      .first();
    if (recent) continue;
    const payload: ReminderPayload = {
      taskId: t.task_id,
      holderId: t.holder_id,
      holderName: t.holder_name,
      invoiceId: t.invoice_id,
      invoiceNumber: t.number,
      supplier: t.supplier_name,
      stage: t.stage_name,
      days: Math.floor(
        (now.getTime() -
          Date.parse(
            t.created_at.replace(" ", "T") +
              (t.created_at.endsWith("Z") ? "" : "Z"),
          )) /
          86_400_000,
      ),
    };
    await db
      .prepare(
        `INSERT INTO agent_actions (id, agent_id, run_id, kind, subject_key, invoice_id, org_unit_id, permission, payload_json, status, prepared_at, expires_at)
         VALUES (?, ?, ?, 'remind_holder', ?, ?, ?, ?, ?, 'waiting', ?, ?)`,
      )
      .bind(
        `act-${crypto.randomUUID()}`,
        agent.id,
        runId,
        key,
        t.invoice_id,
        t.org_unit_id,
        AGENT_ACTIONS.remind_holder.permission,
        JSON.stringify(payload),
        now.toISOString(),
        expires,
      )
      .run();
    prepared += 1;
  }
  return prepared;
}

/** Prepared actions nobody approved in time lapse. */
export async function expireAgentActions(
  db: D1Database,
  now: Date,
): Promise<number> {
  const r = await db
    .prepare(
      "UPDATE agent_actions SET status = 'expired' WHERE status = 'waiting' AND decided_at IS NULL AND expires_at <= ?",
    )
    .bind(now.toISOString())
    .run();
  return r.meta?.changes ?? 0;
}

async function mayApprove(
  db: D1Database,
  userId: string,
  permission: string,
  orgUnitId: string | null,
): Promise<boolean> {
  const visible = await unitsWherePermitted(
    db,
    userId,
    permission as Permission,
  );
  if (visible === null) return true;
  return orgUnitId ? visible.includes(orgUnitId) : visible.length > 0;
}

interface ActionRow {
  id: string;
  agent_id: string;
  agent_name: string;
  author_name: string;
  kind: AgentActionKind;
  invoice_id: string | null;
  org_unit_id: string | null;
  permission: string;
  payload_json: string;
  status: string;
  prepared_at: string;
  expires_at: string;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  note: string | null;
  reason: string | null;
  result_json: string | null;
}

const ACTION_SELECT = `SELECT x.*, a.name AS agent_name, COALESCE(au.name, au.email, a.author_id) AS author_name, COALESCE(du.name, du.email, x.decided_by) AS decided_by_name
  FROM agent_actions x JOIN agents a ON a.id = x.agent_id
  LEFT JOIN org_users au ON au.id = a.author_id
  LEFT JOIN org_users du ON du.id = x.decided_by`;

export function actionBody(r: ActionRow) {
  return {
    id: r.id,
    kind: r.kind,
    agentId: r.agent_id,
    agentName: r.agent_name,
    authorName: r.author_name,
    invoiceId: r.invoice_id,
    status: r.status,
    preparedAt: r.prepared_at,
    expiresAt: r.expires_at,
    decidedBy: r.decided_by_name,
    decidedAt: r.decided_at,
    note: r.note,
    reason: r.reason,
    result: r.result_json
      ? (JSON.parse(r.result_json) as Record<string, unknown>)
      : null,
    payload: JSON.parse(r.payload_json) as Record<string, unknown>,
  };
}

/** The actions an agent prepared, newest first, for its own page. */
export async function actionsOfAgent(db: D1Database, agentId: string) {
  const rows = await db
    .prepare(
      `${ACTION_SELECT} WHERE x.agent_id = ? ORDER BY x.prepared_at DESC, x.rowid DESC LIMIT 100`,
    )
    .bind(agentId)
    .all<ActionRow>();
  return rows.results.map(actionBody);
}

/** `GET /agent-actions` — what waits for this person's approval: actions whose permission they hold where the invoice is. */
export async function handleListAgentActions(
  db: D1Database,
  userId: string,
  now = new Date(),
): Promise<RouteResult> {
  const on = await actionsEnabled(db);
  if (!on.environment || !on.licence)
    return { status: 200, body: { actions: [] } };
  const rows = await db
    .prepare(
      `${ACTION_SELECT} WHERE x.status = 'waiting' AND x.decided_at IS NULL AND x.expires_at > ? ORDER BY x.prepared_at, x.rowid LIMIT 200`,
    )
    .bind(now.toISOString())
    .all<ActionRow>();
  const byPermission = new Map<string, string[] | null>();
  const out = [];
  for (const r of rows.results) {
    if (!byPermission.has(r.permission))
      byPermission.set(
        r.permission,
        await unitsWherePermitted(db, userId, r.permission as Permission),
      );
    const visible = byPermission.get(r.permission)!;
    if (
      visible !== null &&
      !(r.org_unit_id ? visible.includes(r.org_unit_id) : visible.length > 0)
    )
      continue;
    out.push(actionBody(r));
  }
  return { status: 200, body: { actions: out } };
}

/**
 * `POST /agent-actions/:id/approve` or `/reject`. Approving checks the
 * person may, that it still waits and has not lapsed, that actions are
 * on, and that nothing it rests on has changed; then does it as them.
 */
export async function handleDecideAgentAction(
  db: D1Database,
  userId: string,
  id: string,
  decision: "approve" | "reject",
  input: Record<string, unknown>,
  deps: AgentDeps,
  now = new Date(),
): Promise<RouteResult> {
  const row = await db
    .prepare(`${ACTION_SELECT} WHERE x.id = ?`)
    .bind(id)
    .first<ActionRow>();
  if (!row)
    return {
      status: 404,
      body: { error: `action ${id} does not exist`, reason: "not_found" },
    };
  if (!(await mayApprove(db, userId, row.permission, row.org_unit_id)))
    return {
      status: 403,
      body: { error: "you cannot decide this action", reason: "not_permitted" },
    };
  if (row.status !== "waiting")
    return {
      status: 409,
      body: {
        error: `this action is already ${row.status}`,
        reason: `already_${row.status}`,
      },
    };
  if (row.expires_at <= now.toISOString()) {
    await expireAgentActions(db, now);
    return {
      status: 409,
      body: { error: "this action lapsed", reason: "already_expired" },
    };
  }
  const on = await actionsEnabled(db);
  if (!on.environment || !on.licence)
    return {
      status: 409,
      body: { error: "prepared actions are turned off", reason: "actions_off" },
    };

  const decide = async (
    status: "done" | "failed" | "rejected",
    extra: { note?: string | null; reason?: string | null; result?: unknown },
  ) => {
    const r = await db
      .prepare(
        "UPDATE agent_actions SET status = ?, decided_by = ?, decided_at = ?, note = ?, reason = ?, result_json = ? WHERE id = ? AND status = 'waiting'",
      )
      .bind(
        status,
        userId,
        now.toISOString(),
        extra.note ?? null,
        extra.reason ?? null,
        extra.result === undefined ? null : JSON.stringify(extra.result),
        id,
      )
      .run();
    return (r.meta?.changes ?? 0) === 1;
  };

  if (decision === "reject") {
    const reason =
      typeof input.reason === "string"
        ? input.reason.trim().slice(0, 300) || null
        : null;
    if (!(await decide("rejected", { reason })))
      return {
        status: 409,
        body: {
          error: "this action was decided already",
          reason: "already_decided",
        },
      };
    return { status: 200, body: { id, status: "rejected" } };
  }

  if (row.kind === "chase_supplier")
    return approveChase(db, userId, row, input, deps, now, decide);

  const note =
    typeof input.note === "string"
      ? input.note.trim().slice(0, NOTE_MAX) || null
      : null;
  const payload = JSON.parse(row.payload_json) as ReminderPayload;
  // Checked again: still open, still with the same person.
  const task = await db
    .prepare(
      "SELECT status, COALESCE(owner_user_id, claimed_by) AS holder FROM tasks WHERE id = ?",
    )
    .bind(payload.taskId)
    .first<{ status: string; holder: string | null }>();
  if (!task || task.status !== "open" || task.holder !== payload.holderId) {
    await decide("failed", { note, reason: "changed" });
    return {
      status: 409,
      body: {
        error: "the task has moved on since this was prepared",
        reason: "changed",
      },
    };
  }
  if (!(await decide("done", { note, result: { emailed: false } })))
    return {
      status: 409,
      body: {
        error: "this action was decided already",
        reason: "already_decided",
      },
    };

  // The reminder itself: an email to the holder in their language, where email is set up.
  let emailed = false;
  let error: string | null = null;
  const holder = await db
    .prepare("SELECT email, locale FROM org_users WHERE id = ?")
    .bind(payload.holderId)
    .first<{ email: string | null; locale: string | null }>();
  const approver = await db
    .prepare(
      "SELECT COALESCE(name, email, id) AS name FROM org_users WHERE id = ?",
    )
    .bind(userId)
    .first<{ name: string }>();
  if (!deps.email) error = "email_not_configured";
  else if (!holder?.email) error = "no_email_address";
  else {
    const built = buildReminderEmail({
      locale: emailLocale(holder.locale ?? deps.defaultLocale),
      approverName: approver?.name ?? userId,
      holderName: payload.holderName,
      invoiceNumber: payload.invoiceNumber,
      supplier: payload.supplier,
      stage: payload.stage,
      days: payload.days,
      note,
      appUrl: deps.appUrl,
    });
    const sent = await (deps.send ?? sendEmailViaResend)(deps.email.apiKey, {
      from: deps.email.from,
      to: holder.email,
      subject: built.subject,
      text: built.text,
      html: built.html,
    });
    emailed = sent.ok;
    if (!sent.ok) error = sent.error.slice(0, 300);
  }
  await db
    .prepare("UPDATE agent_actions SET result_json = ? WHERE id = ?")
    .bind(JSON.stringify({ emailed, ...(error ? { error } : {}) }), id)
    .run();
  return {
    status: 200,
    body: { id, status: "done", emailed, ...(error ? { error } : {}) },
  };
}

/** The Timeline's lines: reminders (0631) and supplier chasers (0632) done about this invoice. */
export async function reminderTimeline(db: D1Database, invoiceId: string) {
  const rows = await db
    .prepare(
      `SELECT x.kind, x.decided_at, x.note, x.payload_json, x.result_json, COALESCE(u.name, u.email, x.decided_by) AS by_name
       FROM agent_actions x LEFT JOIN org_users u ON u.id = x.decided_by
       WHERE x.invoice_id = ? AND x.kind IN ('remind_holder', 'chase_supplier') AND x.status = 'done'`,
    )
    .bind(invoiceId)
    .all<{
      kind: string;
      decided_at: string;
      note: string | null;
      payload_json: string;
      result_json: string | null;
      by_name: string;
    }>();
  return rows.results.map((r) => {
    if (r.kind === "chase_supplier") {
      const p = JSON.parse(r.payload_json) as ChasePayload;
      const sent = r.result_json
        ? (JSON.parse(r.result_json) as { subject?: string; to?: string })
        : {};
      return {
        action: "chase",
        at: r.decided_at,
        userName: r.by_name,
        targetUserName: `${p.facts.supplier} (${sent.to ?? p.to})`,
        comment: sent.subject ?? p.subject,
      };
    }
    return {
      action: "remind",
      at: r.decided_at,
      userName: r.by_name,
      targetUserName: (JSON.parse(r.payload_json) as ReminderPayload)
        .holderName,
      comment: r.note,
    };
  });
}

// ---------------------------------------------------------------------------
// Chasing a supplier — decision 0632
// ---------------------------------------------------------------------------

/** The same returned invoice is not chased again within this many days. */
export const CHASE_AGAIN_DAYS = 7;

interface ChasePayload {
  instanceId: string;
  invoiceId: string;
  supplierId: string | null;
  to: string;
  cc: string | null;
  subject: string;
  body: string;
  drafted: "ai" | "ours";
  facts: ChaseFacts;
}

/** Where a chaser goes: the supplier's address on file, else where the return itself went. */
async function chaseAddress(
  db: D1Database,
  instanceId: string,
  supplierId: string | null,
): Promise<string | null> {
  if (supplierId) {
    const s = await db
      .prepare("SELECT email FROM suppliers WHERE id = ?")
      .bind(supplierId)
      .first<{ email: string | null }>();
    if (s?.email) return s.email;
  }
  const e = await db
    .prepare(
      "SELECT to_address FROM supplier_return_emails WHERE process_instance_id = ? AND status <> 'send_failed' ORDER BY created_at DESC LIMIT 1",
    )
    .bind(instanceId)
    .first<{ to_address: string }>();
  return e?.to_address ?? null;
}

/** Our company's name for the signature: the legal entity above the invoice's unit. */
async function companyName(
  db: D1Database,
  unitId: string | null,
): Promise<string> {
  let id = unitId;
  let name: string | null = null;
  for (let i = 0; i < 8 && id; i++) {
    const u = await db
      .prepare("SELECT name, kind, parent_unit_id FROM org_units WHERE id = ?")
      .bind(id)
      .first<{ name: string; kind: string; parent_unit_id: string | null }>();
    if (!u) break;
    name = name ?? u.name;
    if (u.kind === "legal_entity") return u.name;
    id = u.parent_unit_id;
  }
  return name ?? "";
}

/** Still returned, and no corrected invoice since. */
async function stillWaiting(
  db: D1Database,
  invoiceId: string,
): Promise<{ instanceId: string } | null> {
  return db
    .prepare(
      `SELECT pi.id AS instanceId FROM invoice_headers h
       JOIN process_instances pi ON pi.subject_type = 'invoice' AND pi.subject_id = h.id
       WHERE h.id = ? AND pi.status = 'returned_manually' AND NOT EXISTS (${REPLY_ARRIVED_SQL})`,
    )
    .bind(invoiceId)
    .first<{ instanceId: string }>();
}

async function prepareChasers(
  db: D1Database,
  agent: { id: string },
  table: { rows: Record<string, unknown>[] },
  runId: string,
  now: Date,
  deps: Pick<AgentDeps, "model">,
): Promise<number> {
  const since = new Date(
    now.getTime() - CHASE_AGAIN_DAYS * 86_400_000,
  ).toISOString();
  const expires = addWorkingDays(now, ACTION_WAIT_WORKING_DAYS).toISOString();
  const cc =
    (
      await db
        .prepare("SELECT ap_team_email FROM org_settings WHERE id = 1")
        .first<{ ap_team_email: string | null }>()
    )?.ap_team_email ?? null;
  let prepared = 0;
  let aiLimit: number | null = null;
  for (const id of tableInvoiceIds(table)) {
    const r = await db
      .prepare(
        `SELECT h.id, h.org_unit_id, h.supplier_id, h.currency, h.total_with_vat AS total, h.issue_date,
                COALESCE(h.invoice_number, json_extract(h.facts_json, '$."BT-1"')) AS number,
                COALESCE(sup.name, json_extract(h.facts_json, '$."BT-27"')) AS supplier_name,
                json_extract(h.facts_json, '$."BT-40"') AS country, json_extract(h.facts_json, '$."BT-2"') AS bt2,
                pi.id AS instance_id, pi.ended_at, pi.supplier_comment, rr.label AS reason
         FROM invoice_headers h
         JOIN process_instances pi ON pi.subject_type = 'invoice' AND pi.subject_id = h.id
         LEFT JOIN suppliers sup ON sup.id = h.supplier_id
         LEFT JOIN supplier_return_reasons rr ON rr.id = pi.return_reason_id
         WHERE h.id = ? AND pi.status = 'returned_manually'`,
      )
      .bind(id)
      .first<{
        id: string;
        org_unit_id: string | null;
        supplier_id: string | null;
        currency: string | null;
        total: number | null;
        issue_date: string | null;
        number: string | null;
        supplier_name: string | null;
        country: string | null;
        bt2: string | null;
        instance_id: string;
        ended_at: string;
        supplier_comment: string | null;
        reason: string | null;
      }>();
    if (!r) continue;
    const key = `chase:${r.instance_id}`;
    const recent = await db
      .prepare(
        "SELECT 1 FROM agent_actions WHERE agent_id = ? AND kind = 'chase_supplier' AND subject_key = ? AND (status = 'waiting' OR prepared_at >= ?) LIMIT 1",
      )
      .bind(agent.id, key, since)
      .first();
    if (recent) continue;
    // Never an address the agent made up: on file, or where the return went; none, no chaser.
    const to = await chaseAddress(db, r.instance_id, r.supplier_id);
    if (!to) continue;
    const facts: ChaseFacts = {
      locale: chaseLocale(r.country),
      supplier: r.supplier_name ?? "",
      invoice: r.number ?? "",
      issued: r.issue_date ?? r.bt2,
      returned: r.ended_at,
      total: r.total,
      currency: r.currency,
      reason: r.reason,
      comment: r.supplier_comment,
      company: await companyName(db, r.org_unit_id),
      days: Math.floor((now.getTime() - Date.parse(r.ended_at)) / 86_400_000),
    };
    const ours = chaseTemplate(facts);
    let body = ours.body;
    let drafted: "ai" | "ours" = "ours";
    // The AI's wording counts against the day's AI allowance (decision 0626).
    if (deps.model) {
      aiLimit = aiLimit ?? (await summaryLimit(db));
      if (await takeSummary(db, aiLimit, now)) {
        const worded = await chaseWording(deps.model, facts);
        if (worded && !strayInChase(worded, facts)) {
          body = worded;
          drafted = "ai";
        }
      }
    }
    const payload: ChasePayload = {
      instanceId: r.instance_id,
      invoiceId: r.id,
      supplierId: r.supplier_id,
      to,
      cc,
      subject: ours.subject,
      body,
      drafted,
      facts,
    };
    await db
      .prepare(
        `INSERT INTO agent_actions (id, agent_id, run_id, kind, subject_key, invoice_id, org_unit_id, permission, payload_json, status, prepared_at, expires_at)
         VALUES (?, ?, ?, 'chase_supplier', ?, ?, ?, ?, ?, 'waiting', ?, ?)`,
      )
      .bind(
        `act-${crypto.randomUUID()}`,
        agent.id,
        runId,
        key,
        r.id,
        r.org_unit_id,
        AGENT_ACTIONS.chase_supplier.permission,
        JSON.stringify(payload),
        now.toISOString(),
        expires,
      )
      .run();
    prepared += 1;
  }
  return prepared;
}

/**
 * Approving a chaser: the subject and letter as the approver left them,
 * checked for numbers that are not the invoice's; still returned with no
 * corrected invoice, and the address unchanged; then sent from the AP
 * team, copied to the AP team's address where one is set. Claimed first,
 * so two people approving at once send it once.
 */
async function approveChase(
  db: D1Database,
  userId: string,
  row: ActionRow,
  input: Record<string, unknown>,
  deps: AgentDeps,
  now: Date,
  decide: (
    status: "done" | "failed" | "rejected",
    extra: { note?: string | null; reason?: string | null; result?: unknown },
  ) => Promise<boolean>,
): Promise<RouteResult> {
  const p = JSON.parse(row.payload_json) as ChasePayload;
  const subject =
    typeof input.subject === "string" && input.subject.trim()
      ? input.subject.trim().slice(0, 200)
      : p.subject;
  const body =
    typeof input.body === "string" && input.body.trim()
      ? input.body.trim().slice(0, 4000)
      : p.body;
  if (
    /https?:|@/i.test(
      `${subject}
${body}`.replace(p.to, ""),
    )
  )
    return {
      status: 422,
      body: {
        error: "the letter may not carry addresses or links",
        reason: "chase_address_in_text",
      },
    };
  const stray = strayInChase(
    `${subject}
${body}`,
    p.facts,
  );
  if (stray)
    return {
      status: 422,
      body: {
        error: `${stray} is not a number on this invoice`,
        reason: "number_not_on_invoice",
        stray,
      },
    };
  if (!deps.email)
    return {
      status: 409,
      body: {
        error: "email is not set up here",
        reason: "email_not_configured",
      },
    };
  // Checked again: still returned, nothing back from the supplier, and the same address.
  const waiting = await stillWaiting(db, p.invoiceId);
  const to = await chaseAddress(db, p.instanceId, p.supplierId);
  if (!waiting || to !== p.to) {
    await decide("failed", {
      reason: !waiting ? "replied" : "address_changed",
    });
    return {
      status: 409,
      body: {
        error:
          "the invoice or the supplier's address changed since this was prepared",
        reason: !waiting ? "replied" : "address_changed",
      },
    };
  }
  const claim = await db
    .prepare(
      "UPDATE agent_actions SET decided_by = ?, decided_at = ? WHERE id = ? AND status = 'waiting' AND decided_at IS NULL",
    )
    .bind(userId, now.toISOString(), row.id)
    .run();
  if ((claim.meta?.changes ?? 0) !== 1)
    return {
      status: 409,
      body: {
        error: "this action was decided already",
        reason: "already_decided",
      },
    };
  const cc =
    (
      await db
        .prepare("SELECT ap_team_email FROM org_settings WHERE id = 1")
        .first<{ ap_team_email: string | null }>()
    )?.ap_team_email ?? null;
  const html = `<div style="font-family:Calibri,Carlito,'Segoe UI',Arial,sans-serif;color:#121a26;font-size:14px;line-height:1.5">${body
    .split(/\n{2,}/)
    .map(
      (para) =>
        `<p style="margin:0 0 12px">${escapeHtml(para).replace(/\n/g, "<br>")}</p>`,
    )
    .join("")}</div>`;
  const sent = await (deps.send ?? sendEmailViaResend)(deps.email.apiKey, {
    from: deps.email.from,
    to: p.to,
    ...(cc ? { cc } : {}),
    subject,
    text: body,
    html,
  } as Parameters<typeof sendEmailViaResend>[1]);
  const finish = async (
    status: "done" | "failed",
    reason: string | null,
    result: unknown,
  ) =>
    db
      .prepare(
        "UPDATE agent_actions SET status = ?, reason = ?, result_json = ? WHERE id = ?",
      )
      .bind(status, reason, JSON.stringify(result), row.id)
      .run();
  if (!sent.ok) {
    await finish("failed", "send_failed", {
      error: sent.error.slice(0, 300),
      to: p.to,
    });
    return {
      status: 502,
      body: { error: "the email could not be sent", reason: "send_failed" },
    };
  }
  await finish("done", null, {
    emailed: true,
    messageId: sent.messageId,
    to: p.to,
    cc,
    subject,
    edited: subject !== p.subject || body !== p.body,
  });
  return {
    status: 200,
    body: { id: row.id, status: "done", emailed: true, to: p.to },
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
