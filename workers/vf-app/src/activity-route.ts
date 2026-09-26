import type { RouteResult } from "./examples-route.js";
import { t } from "./i18n.js";
import type { Locale } from "./i18n.js";

/**
 * The document activity feed — decision 0267.
 *
 * **One kind of new storage, and only one.** `document_comments` is
 * the only table this adds. Everything system-generated — received,
 * a stage completed, a rule firing — is derived at read time from
 * `invoice_headers`, `tasks`, and `stage_visit_steps`, all of which
 * already exist. A second table recording "a rule fired" alongside
 * `stage_visit_steps` already recording exactly that would be the same
 * fault decisions 0236 and 0264 found and fixed once: a record able to
 * quietly disagree with the thing it claims to describe.
 *
 * **No first-person narration.** Nothing in this system reads an
 * invoice and reasons about it turn by turn — every system-generated
 * line here names a real actor (a person, or a named or sentence-
 * identified rule) and a real, closed-vocabulary action. Confirmed
 * directly against the mock-up this replaces.
 */

interface ActivityItem {
  kind: "comment" | "received" | "stage_completed" | "rule_fired" | "action_taken";
  at: string;
  [key: string]: unknown;
}

interface RuleAction {
  type: string;
  params?: Record<string, unknown>;
}

/**
 * One fired action, in words — the closed vocabulary's own eleven
 * actions (`shared/interpreter/vocabulary.ts`), each named honestly
 * rather than only the two the operator's own example used.
 *
 * `names` resolves whatever ids an action carries — a stage, an org
 * unit, a team or a user — to what a person actually reads. Batched
 * once per request rather than looked up per action, so a rule that
 * fired three times against the same document costs one lookup, not
 * three.
 */
function describeAction(
  action: RuleAction,
  names: { stages: Map<string, string>; orgUnits: Map<string, string>; teams: Map<string, string>; users: Map<string, string> }
): string {
  const p = action.params ?? {};
  switch (action.type) {
    case "route_to":
      return `routed to ${names.stages.get(String(p.stage)) ?? p.stage}`;
    case "assign_org":
      return `assigned to ${names.orgUnits.get(String(p.org)) ?? p.org}`;
    case "assign_cost_centre":
      return `assigned cost centre ${p.value}`;
    case "hold_until":
      return `held until ${p.date}`;
    case "flag":
      return "flagged it";
    case "reject":
      return "rejected it";
    case "tag":
      return `tagged it \u2018${p.value}\u2019`;
    case "set_field":
      // **The field's own code, not a description** — decision 0267.
      // A human-readable description depends on which vocabulary
      // (invoice, expense, or a customer's own custom fields) the
      // rule set declares; resolving that correctly here would mean
      // re-deriving the exact vocabulary a rule was compiled against.
      // The code is accurate; a nicer label is a real follow-up, not
      // something to approximate now.
      return `set ${p.field}`;
    case "notify":
      return `sent a notification to ${p.target}`;
    case "escalate_after":
      return `will escalate after ${p.after}`;
    case "assign_task": {
      const target = p.team
        ? names.teams.get(String(p.team)) ?? String(p.team)
        : names.users.get(String(p.user)) ?? String(p.user);
      return `assigned to ${target}`;
    }
    default:
      return String(action.type);
  }
}

async function receivedEvent(db: D1Database, invoiceId: string): Promise<ActivityItem[]> {
  const row = await db
    .prepare("SELECT created_at FROM invoice_headers WHERE id = ?")
    .bind(invoiceId)
    .first<{ created_at: string }>();
  return row ? [{ kind: "received", at: row.created_at }] : [];
}

async function stageCompletedEvents(db: D1Database, invoiceId: string): Promise<ActivityItem[]> {
  const rows = await db
    .prepare(
      `SELECT t.completed_at AS at, s.name AS stage_name, u.name AS user_name
       FROM tasks t
       JOIN stage_visits v ON v.id = t.stage_visit_id
       JOIN process_instances pi ON pi.id = v.process_instance_id
       JOIN process_stages s ON s.id = t.stage_id
       JOIN org_users u ON u.id = t.completed_by
       WHERE pi.subject_type = 'invoice' AND pi.subject_id = ?
         AND t.completed_at IS NOT NULL`
    )
    .bind(invoiceId)
    .all<{ at: string; stage_name: string; user_name: string }>();

  /**
   * **No fallback chain, on purpose.** `completed_at IS NOT NULL`
   * implies `completed_by IS NOT NULL` — a standing invariant in
   * migration 0033 — and `org_users.name` is itself `NOT NULL`. A
   * completed task's completer always has a real name; an `?? email
   * ?? "Someone"` chain here would be defending against a state the
   * schema does not allow, untestable because it cannot be produced.
   */
  return rows.results.map((r) => ({
    kind: "stage_completed",
    at: r.at,
    stageName: r.stage_name,
    userName: r.user_name,
  }));
}

/**
 * Claim / release — decision 0488.
 *
 * **The one genuine new table this decision adds**, `task_action_
 * events` (migration 0083) — see its own header comment for why only
 * these two actions get durable storage while everything else here
 * stays derived. Same invoice-scoping join every other derivation in
 * this file already uses (`stage_visits` -> `process_instances`), so a
 * task created directly via `POST /tasks` with no `stage_visit_id`
 * (decision 0018's own pre-engine path) is silently excluded here the
 * same way it already is from `stageCompletedEvents`.
 */
async function taskActionEvents(db: D1Database, invoiceId: string): Promise<ActivityItem[]> {
  const rows = await db
    .prepare(
      `SELECT e.action, e.at, e.comment, u.name AS user_name, tu.name AS target_user_name
       FROM task_action_events e
       JOIN tasks t ON t.id = e.task_id
       JOIN stage_visits v ON v.id = t.stage_visit_id
       JOIN process_instances pi ON pi.id = v.process_instance_id
       JOIN org_users u ON u.id = e.actor_id
       LEFT JOIN org_users tu ON tu.id = e.target_user_id
       WHERE pi.subject_type = 'invoice' AND pi.subject_id = ?`
    )
    .bind(invoiceId)
    .all<{ action: string; at: string; comment: string | null; user_name: string; target_user_name: string | null }>();

  return rows.results.map((r) => ({
    kind: "action_taken",
    at: r.at,
    action: r.action,
    userName: r.user_name,
    comment: r.comment,
    // Decisions 0489 and 0497: only reassign and route_to_approver
    // ever carry one — the CHECK constraint on task_action_events'
    // own invariant (migration 0086) already guarantees that.
    targetUserName: r.target_user_name ?? undefined,
  }));
}

/**
 * Return / return-to-supplier / discard — decision 0488.
 *
 * **Derived, not stored** — each is already terminal and fully
 * recorded on `tasks` itself (`ended_by`/`ended_at`/`end_reason`/
 * `status`/`returned_to_stage_id`, decision 0075 and migrations 0031/
 * 0033), exactly the principle this file's own header comment states.
 * The three are told apart purely by `status` and whether
 * `returned_to_stage_id` is set — `endTaskAndSiblings` (return-
 * route.ts) is where all three, and the `cancelled` siblings a return
 * produces, are actually written; `status IN ('returned', 'discarded')`
 * is what excludes those siblings here, the same way a task simply
 * moot from a return should not read as its own audit-trail action.
 */
async function taskEndedEvents(db: D1Database, invoiceId: string): Promise<ActivityItem[]> {
  // The most recent attempt, not "a" join. Decision 0498's own design
  // writes exactly one supplier_return_emails row per return, but the
  // LEFT JOIN below is written defensively rather than assumed
  // one-to-one — a correlated MAX(created_at) rather than a bare join
  // on process_instance_id, so a future second attempt (a resend, say)
  // could never silently duplicate this Timeline line.
  const rows = await db
    .prepare(
      `SELECT t.status, t.ended_at AS at, t.end_reason, t.returned_to_stage_id,
              u.name AS user_name, s.name AS target_stage_name,
              pi.supplier_comment,
              e.status AS email_status, e.to_address AS email_to_address
       FROM tasks t
       JOIN stage_visits v ON v.id = t.stage_visit_id
       JOIN process_instances pi ON pi.id = v.process_instance_id
       JOIN org_users u ON u.id = t.ended_by
       LEFT JOIN process_stages s ON s.id = t.returned_to_stage_id
       LEFT JOIN supplier_return_emails e
         ON e.process_instance_id = pi.id
        AND e.created_at = (
              SELECT MAX(created_at) FROM supplier_return_emails WHERE process_instance_id = pi.id
            )
       WHERE pi.subject_type = 'invoice' AND pi.subject_id = ?
         AND t.status IN ('returned', 'discarded')`
    )
    .bind(invoiceId)
    .all<{
      status: string;
      at: string;
      end_reason: string | null;
      returned_to_stage_id: string | null;
      user_name: string;
      target_stage_name: string | null;
      supplier_comment: string | null;
      email_status: string | null;
      email_to_address: string | null;
    }>();

  return rows.results.map((r) => ({
    kind: "action_taken",
    at: r.at,
    action: r.status === "discarded" ? "discard" : r.returned_to_stage_id ? "return" : "return_to_supplier",
    userName: r.user_name,
    comment: r.end_reason,
    targetStageName: r.returned_to_stage_id ? r.target_stage_name : undefined,
    // Decision 0498 — only ever present on a return_to_supplier row;
    // undefined (not rendered) for return/discard, which never write
    // either column.
    supplierComment: r.returned_to_stage_id === null && r.status === "returned" ? (r.supplier_comment ?? undefined) : undefined,
    emailStatus: r.returned_to_stage_id === null && r.status === "returned" ? (r.email_status ?? undefined) : undefined,
    emailToAddress: r.returned_to_stage_id === null && r.status === "returned" ? (r.email_to_address ?? undefined) : undefined,
  }));
}

async function ruleFiredEvents(db: D1Database, invoiceId: string): Promise<ActivityItem[]> {
  const rows = await db
    .prepare(
      `SELECT vs.id AS visit_id, vs.created_at AS at, st.rule_id, st.rule_version, st.line_number,
              r.name AS rule_name, rv.source_text, rv.compiled_json
       FROM stage_visit_steps st
       JOIN stage_visits vs ON vs.id = st.stage_visit_id
       JOIN process_instances pi ON pi.id = vs.process_instance_id
       JOIN rules r ON r.id = st.rule_id
       JOIN rule_versions rv ON rv.rule_id = st.rule_id AND rv.version = st.rule_version
       WHERE pi.subject_type = 'invoice' AND pi.subject_id = ? AND st.matched = 1
       ORDER BY st.id`
    )
    .bind(invoiceId)
    .all<{
      visit_id: string;
      at: string;
      rule_id: string;
      rule_version: number;
      line_number: number | null;
      rule_name: string | null;
      source_text: string;
      compiled_json: string;
    }>();

  if (rows.results.length === 0) return [];

  /**
   * **One entry per firing, not one per line it fired on** — decision
   * 0409. A line-scoped rule set (decision 0027) evaluates once per
   * invoice line, so a rule matching on eight of twelve lines wrote
   * eight `stage_visit_steps` rows at the same visit, and this used to
   * turn that into eight identical, same-timestamp entries with
   * nothing telling them apart. Grouped by the visit and rule that
   * actually fired — same rule, same `stage_visit_id`, is one firing
   * — with which lines it matched kept rather than discarded, so
   * collapsing the duplicates doesn't also throw away the one thing
   * an auditor would actually ask next ("which lines?").
   */
  const groups = new Map<
    string,
    { at: string; ruleName: string | null; sourceText: string; compiledJson: string; lines: number[] }
  >();
  for (const row of rows.results) {
    const key = `${row.visit_id}:${row.rule_id}:${row.rule_version}`;
    let group = groups.get(key);
    if (!group) {
      group = { at: row.at, ruleName: row.rule_name, sourceText: row.source_text, compiledJson: row.compiled_json, lines: [] };
      groups.set(key, group);
    }
    if (row.line_number !== null) group.lines.push(row.line_number);
  }

  const parsed = [...groups.values()].map((g) => ({
    ...g,
    lines: g.lines.slice().sort((a, b) => a - b),
    actions: (JSON.parse(g.compiledJson) as { actions: RuleAction[] }).actions ?? [],
  }));

  // One batch of lookups for every id any firing referenced, rather
  // than one lookup per action.
  const stageIds = new Set<string>();
  const orgIds = new Set<string>();
  const teamIds = new Set<string>();
  const userIds = new Set<string>();
  for (const row of parsed) {
    for (const a of row.actions) {
      const p = a.params ?? {};
      if (a.type === "route_to" && p.stage) stageIds.add(String(p.stage));
      if (a.type === "assign_org" && p.org) orgIds.add(String(p.org));
      if (a.type === "assign_task") {
        if (p.team) teamIds.add(String(p.team));
        if (p.user) userIds.add(String(p.user));
      }
    }
  }

  const [stages, orgUnits, teams, users] = await Promise.all([
    lookupNames(db, "process_stages", stageIds),
    lookupNames(db, "org_units", orgIds),
    lookupNames(db, "org_teams", teamIds),
    lookupNames(db, "org_users", userIds),
  ]);
  const names = { stages, orgUnits, teams, users };

  return parsed.map((row) => ({
    kind: "rule_fired",
    at: row.at,
    // **Named where a name exists, the sentence otherwise** — decision
    // 0266 built exactly this fallback for exactly this reason.
    ruleName: row.ruleName ?? row.sourceText,
    actionDescriptions: row.actions.map((a) => describeAction(a, names)),
    // Empty for a header-scoped firing, which only ever fires once.
    lines: row.lines,
  }));
}

async function lookupNames(db: D1Database, table: string, ids: Set<string>): Promise<Map<string, string>> {
  if (ids.size === 0) return new Map();
  const list = [...ids];
  const rows = await db
    .prepare(`SELECT id, name FROM ${table} WHERE id IN (${list.map(() => "?").join(",")})`)
    .bind(...list)
    .all<{ id: string; name: string }>();
  return new Map(rows.results.map((r) => [r.id, r.name]));
}

async function commentEvents(db: D1Database, invoiceId: string): Promise<ActivityItem[]> {
  const rows = await db
    .prepare(
      `SELECT c.id, c.body, c.created_at AS at, u.name AS user_name
       FROM document_comments c
       JOIN org_users u ON u.id = c.author_id
       WHERE c.invoice_id = ?`
    )
    .bind(invoiceId)
    .all<{ id: string; body: string; at: string; user_name: string }>();

  // Same reasoning as stageCompletedEvents: author_id is NOT NULL and
  // FK-enforced, and org_users.name is NOT NULL — no fallback needed.
  return rows.results.map((r) => ({
    kind: "comment",
    at: r.at,
    id: r.id,
    body: r.body,
    userName: r.user_name,
  }));
}

export async function handleGetActivity(db: D1Database, invoiceId: string): Promise<RouteResult> {
  const invoice = await db.prepare("SELECT id FROM invoice_headers WHERE id = ?").bind(invoiceId).first();
  if (!invoice) {
    return { status: 404, body: { error: `document ${invoiceId} does not exist` } };
  }

  const [received, stageCompletions, ruleFirings, comments, taskActions, taskEnded] = await Promise.all([
    receivedEvent(db, invoiceId),
    stageCompletedEvents(db, invoiceId),
    ruleFiredEvents(db, invoiceId),
    commentEvents(db, invoiceId),
    taskActionEvents(db, invoiceId),
    taskEndedEvents(db, invoiceId),
  ]);

  const items = [...received, ...stageCompletions, ...ruleFirings, ...comments, ...taskActions, ...taskEnded].sort(
    (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)
  );

  return { status: 200, body: { items } };
}

/**
 * Post an internal comment — decision 0267.
 *
 * **The author is derived from the authenticated caller, never
 * accepted from the request body** — the same discipline decision
 * 0010 proves with a spoofed-identity test for who confirmed a worked
 * example or activated a rule. A comment claiming to be from somebody
 * other than whoever is actually signed in would make the audit trail
 * this panel exists to be untrustworthy by construction.
 */
export async function handlePostComment(
  db: D1Database,
  invoiceId: string,
  authorId: string,
  body: unknown,
  locale: Locale = "en"
): Promise<RouteResult> {
  const text = (body as Record<string, unknown> | null)?.body;
  if (typeof text !== "string" || !text.trim()) {
    return { status: 400, body: { error: t("commentBodyRequired", locale) } };
  }

  const invoice = await db.prepare("SELECT id FROM invoice_headers WHERE id = ?").bind(invoiceId).first();
  if (!invoice) {
    return { status: 404, body: { error: `document ${invoiceId} does not exist` } };
  }

  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO document_comments (id, invoice_id, author_id, body) VALUES (?, ?, ?, ?)")
    .bind(id, invoiceId, authorId, text.trim())
    .run();

  return { status: 201, body: { id, invoiceId, authorId, body: text.trim() } };
}
