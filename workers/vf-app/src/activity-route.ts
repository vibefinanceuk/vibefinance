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
  kind: "comment" | "received" | "stage_completed" | "rule_fired";
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

async function ruleFiredEvents(db: D1Database, invoiceId: string): Promise<ActivityItem[]> {
  const rows = await db
    .prepare(
      `SELECT vs.created_at AS at, r.name AS rule_name, rv.source_text, rv.compiled_json
       FROM stage_visit_steps st
       JOIN stage_visits vs ON vs.id = st.stage_visit_id
       JOIN process_instances pi ON pi.id = vs.process_instance_id
       JOIN rules r ON r.id = st.rule_id
       JOIN rule_versions rv ON rv.rule_id = st.rule_id AND rv.version = st.rule_version
       WHERE pi.subject_type = 'invoice' AND pi.subject_id = ? AND st.matched = 1
       ORDER BY st.id`
    )
    .bind(invoiceId)
    .all<{ at: string; rule_name: string | null; source_text: string; compiled_json: string }>();

  if (rows.results.length === 0) return [];

  const parsed = rows.results.map((r) => ({
    ...r,
    actions: (JSON.parse(r.compiled_json) as { actions: RuleAction[] }).actions ?? [],
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
    ruleName: row.rule_name ?? row.source_text,
    actionDescriptions: row.actions.map((a) => describeAction(a, names)),
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

  const [received, stageCompletions, ruleFirings, comments] = await Promise.all([
    receivedEvent(db, invoiceId),
    stageCompletedEvents(db, invoiceId),
    ruleFiredEvents(db, invoiceId),
    commentEvents(db, invoiceId),
  ]);

  const items = [...received, ...stageCompletions, ...ruleFirings, ...comments].sort((a, b) =>
    a.at < b.at ? -1 : a.at > b.at ? 1 : 0
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
