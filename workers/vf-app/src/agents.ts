import {
  hasPermission,
  unitsFor,
  unitsWherePermitted,
  scopedToChosenOrg,
  unitClause,
} from "./enforce.js";
import type { Permission } from "./permissions.js";
import type { RouteResult } from "./org-route.js";
import { readLicenceState } from "./licence-cache.js";
import { exitStageIds } from "./process-ends.js";
import { handleAccruals } from "./accruals-route.js";
import { handleOverdueBalance } from "./overdue-balance-route.js";
import { handleWorkloadOpenTasks } from "./workload-open-tasks-route.js";
import { handlePossibleDuplicates } from "./fraud-duplicates-route.js";
import { handleUnapprovedSuppliers } from "./fraud-unapproved-suppliers-route.js";
import {
  actionsEnabled,
  actionsForReport,
  actionsOfAgent,
  checkAction,
  expireAgentActions,
  prepareActions,
  type AgentActionKind,
} from "./agent-actions.js";
import {
  checkSchedule,
  DEFAULT_TIME_ZONE,
  isTimeZone,
  nextRunAfter,
  type AgentSchedule,
} from "./agent-schedule.js";
import {
  buildAgentEmail,
  emailLocale,
  type EmailLocale,
} from "./agent-email.js";
import {
  summariesToday,
  summaryLimit,
  takeSummary,
  writeSummary,
  type SummaryOutcome,
} from "./agent-summary.js";
import type { CompilerModel } from "@vibefinance/shared";
import { sendEmailViaResend } from "./resend-client.js";

/**
 * **Agents, slice 1: the engine — decision 0622.**
 *
 * An agent is a report an AP Manager sets up once, for organisations
 * they choose, that runs on a schedule and lands on their task list.
 * The design agreed with Dan on 4 October 2026 (the Agents page and
 * `claude/agents-design.md`); this slice has no AI and no email:
 *
 * - **Made from a form**: a report from `AGENT_REPORTS`, organisations,
 *   a schedule. Saved paused; started, paused, edited, removed.
 * - **Run by the five-minute cron** (`runDueAgents`): each due agent is
 *   claimed by moving its `next_run_at` on in one conditional UPDATE,
 *   so two overlapping ticks cannot both run it. A run missed while
 *   nothing ran (an outage) happens once, late, and says so.
 * - **With its author's eyes**: every run checks again that the author
 *   holds `AP.Agents` and the report's own permission in each chosen
 *   organisation. An organisation no longer held is left out and named;
 *   with none left, or without `AP.Agents`, the agent pauses itself.
 * - **Delivered to the task list** as an `agent_notes` row, its own
 *   table rather than a task: a note belongs to no stage, so it never
 *   counts in workload, queue depth or handling time.
 * - **Capped by the licence**: `agentLimit` in the signed licence
 *   claims, set per environment on the control plane;
 *   `DEFAULT_AGENT_LIMIT` where the licence does not say.
 *
 * The numbers come from the same permission-checked handlers the
 * screens and the AP Expert (decision 0430) use, plus one new query,
 * outstanding payables: payment-eligible and not yet delivered to the
 * ERP (decision 0622, Dan: "payment-eligible is what we should track
 * against", and delivered-to-ERP as where it stops).
 */

export const DEFAULT_AGENT_LIMIT = 5;
/** At most this many agents are run in one five-minute tick; the rest wait for the next. */
const AGENTS_PER_TICK = 20;
/** A run this long after its time says it ran late. */
const LATE_AFTER_MS = 15 * 60_000;
const NAME_MAX = 80;
/** Runs, deliveries, notes and the copies sent are kept 13 months (decision 0623), then removed. */
export const KEEP_DAYS = 396;
const PURGE_PER_TICK = 200;

/**
 * **What a run needs from outside — decision 0623.** Resend's key and
 * sender (null where email is not set up), the app's own address for the
 * links in an email, the R2 bucket that keeps each copy sent, and the
 * language for a recipient who has not chosen one.
 */
export interface AgentDeps {
  email: { apiKey: string; from: string } | null;
  appUrl: string | null;
  bucket: R2Bucket | null;
  defaultLocale?: string | null;
  /** Injected in tests; Resend otherwise. */
  send?: typeof sendEmailViaResend;
  /** Decision 0626: the model that writes summaries; none where AI is not bound. */
  model?: CompilerModel | null;
}

export const NO_DEPS: AgentDeps = { email: null, appUrl: null, bucket: null };

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export type ColumnKind =
  "text" | "money" | "count" | "date" | "days" | "percent";

export interface ReportColumn {
  key: string;
  /** A string key; the interface says it in the reader's language. */
  label: string;
  kind: ColumnKind;
}

export interface ReportTotal {
  currency: string | null;
  total: number | null;
  count: number;
}

export interface ReportTable {
  report: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  totals: ReportTotal[];
  /** Chosen organisations left out because the author no longer holds the report's permission there. */
  skippedOrgs: string[];
  asAt: string;
  /** Decision 0624: this recipient's totals the last time it was sent to them, to compare with. */
  previous?: ReportTotal[] | null;
  /** Decision 0624: the options it ran with, so a reader is told (e.g. "at least 1,000.00"). */
  options?: AgentOptions;
  /** Decision 0626: the AI summary on top, checked against this table. */
  summary?: string | null;
}

/**
 * **What an agent's report is narrowed by — decision 0624.** Each report
 * takes only its own; the rest are dropped.
 *
 * - `minTotal` (outstanding payables): only suppliers owing at least this,
 *   in their own currency.
 * - `highlightDays` (outstanding payables): rows whose oldest invoice is
 *   more than this many days past due are highlighted. Default 60.
 * - `withinDays` (due soon): invoices due within this many days. Default 7.
 * - `olderThanDays` (stuck work): tasks open longer than this. Default 5.
 */
export interface AgentOptions {
  minTotal?: number;
  highlightDays?: number;
  withinDays?: number;
  olderThanDays?: number;
  /** Decision 0630: an invoice at one stage longer than this many days. Default 3. */
  stageDays?: number;
}

const OPTION_RULES: Record<
  string,
  Record<
    keyof AgentOptions,
    { min: number; max: number; default?: number } | undefined
  >
> = {
  outstanding_payables: {
    minTotal: { min: 0, max: 1e12 },
    highlightDays: { min: 1, max: 365, default: 60 },
    withinDays: undefined,
    olderThanDays: undefined,
    stageDays: undefined,
  },
  due_soon_not_eligible: {
    minTotal: undefined,
    highlightDays: undefined,
    withinDays: { min: 1, max: 90, default: 7 },
    olderThanDays: undefined,
    stageDays: undefined,
  },
  stuck_work: {
    minTotal: undefined,
    highlightDays: undefined,
    withinDays: undefined,
    olderThanDays: { min: 1, max: 365, default: 5 },
    stageDays: undefined,
  },
  event_stuck: {
    minTotal: undefined,
    highlightDays: undefined,
    withinDays: undefined,
    olderThanDays: undefined,
    stageDays: { min: 1, max: 90, default: 3 },
  },
};

/** A report's options as sent, checked: the options (defaults filled in), or why not. */
export function checkOptions(
  reportId: string,
  input: unknown,
): { options: AgentOptions } | { reason: string } {
  const rules = OPTION_RULES[reportId];
  const given =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const options: AgentOptions = {};
  if (!rules) return { options };
  for (const [key, rule] of Object.entries(rules) as [
    keyof AgentOptions,
    { min: number; max: number; default?: number } | undefined,
  ][]) {
    if (!rule) continue;
    const raw = given[key];
    if (raw === undefined || raw === null || raw === "") {
      if (rule.default !== undefined) options[key] = rule.default;
      continue;
    }
    const n = Number(raw);
    const whole = key !== "minTotal";
    if (
      !Number.isFinite(n) ||
      n < rule.min ||
      n > rule.max ||
      (whole && !Number.isInteger(n))
    )
      return { reason: `option_invalid_${key.toLowerCase()}` };
    options[key] = key === "minTotal" ? Math.round(n * 100) / 100 : n;
  }
  return { options };
}

interface Org {
  id: string;
  name: string;
}

interface AgentReport {
  id: string;
  permission: Permission;
  /**
   * Decision 0630: started by an event. Looked at every hour; each person
   * is sent only the rows (`_key`) they have not been sent before.
   */
  event?: boolean;
  gather(
    db: D1Database,
    authorId: string,
    orgs: Org[],
    now: Date,
    options: AgentOptions,
  ): Promise<Omit<ReportTable, "report" | "skippedOrgs" | "asAt">>;
}

function addTotal(
  totals: Map<string, ReportTotal>,
  currency: string | null,
  amount: number | null,
  count = 1,
) {
  const key = currency ?? "";
  const t = totals.get(key) ?? {
    currency,
    total: amount === null ? null : 0,
    count: 0,
  };
  if (amount !== null) t.total = (t.total ?? 0) + amount;
  t.count += count;
  totals.set(key, t);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function daysBetween(fromIso: string, to: Date): number {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const today = Date.parse(`${to.toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.round((today - from) / 86_400_000);
}

/**
 * **Outstanding payables** — payment-eligible (process completed, or at
 * its exit stage; never discarded or returned) and **not yet delivered to
 * the ERP**: no Destination delivery (ERP CSV export included, since
 * 0586) has succeeded for it. By organisation, supplier and currency.
 *
 * **Aged against the due date (BT-9) — decision 0624**: not yet due (or no
 * due date), then 1–30, 31–60, 61–90 and over 90 days past due, with the
 * oldest's days past due. Oldest first. `minTotal` keeps suppliers owing
 * at least that; `highlightDays` marks rows whose oldest is past it.
 */
async function gatherOutstanding(
  db: D1Database,
  authorId: string,
  orgs: Org[],
  now: Date,
  options: AgentOptions,
) {
  const visible = await unitsWherePermitted(db, authorId, "AP.Analysis");
  const exits = await exitStageIds(db);
  const exitSql =
    exits.length === 0
      ? "0"
      : `pi.current_stage_id IN (${exits.map(() => "?").join(", ")})`;
  const seen = new Set<string>();
  type Group = {
    org: string;
    supplier: string | null;
    currency: string;
    count: number;
    total: number;
    notDue: number;
    d30: number;
    d60: number;
    d90: number;
    d90plus: number;
    oldest: number | null;
    ids: string[];
  };
  const groups = new Map<string, Group>();
  for (const org of orgs) {
    const units = await scopedToChosenOrg(db, visible, org.id);
    const clause = unitClause({ units }, "h.org_unit_id");
    const rows = await db
      .prepare(
        `SELECT DISTINCT h.id AS id, COALESCE(sup.name, json_extract(h.facts_json, '$."BT-27"')) AS supplier_name,
                h.currency AS currency, h.total_with_vat AS total, json_extract(h.facts_json, '$."BT-9"') AS due_date
         FROM invoice_headers h
         JOIN process_instances pi ON pi.subject_type = 'invoice' AND pi.subject_id = h.id
         LEFT JOIN suppliers sup ON sup.id = h.supplier_id
         WHERE (pi.status = 'completed' OR (pi.status = 'in_progress' AND ${exitSql}))
           AND NOT EXISTS (
             SELECT 1 FROM process_instances other
             WHERE other.subject_type = 'invoice' AND other.subject_id = h.id AND other.status IN ('archived', 'returned_manually')
           )
           AND NOT EXISTS (SELECT 1 FROM destination_deliveries d WHERE d.invoice_id = h.id AND d.status = 'delivered')
           AND h.currency IS NOT NULL AND h.total_with_vat IS NOT NULL ${clause.sql}`,
      )
      .bind(...exits, ...clause.binds)
      .all<{
        id: string;
        supplier_name: string | null;
        currency: string;
        total: number;
        due_date: string | null;
      }>();
    for (const r of rows.results) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      const key = `${org.id}::${r.supplier_name ?? ""}::${r.currency}`;
      const g: Group = groups.get(key) ?? {
        org: org.name,
        supplier: r.supplier_name,
        currency: r.currency,
        count: 0,
        total: 0,
        notDue: 0,
        d30: 0,
        d60: 0,
        d90: 0,
        d90plus: 0,
        oldest: null,
        ids: [],
      };
      g.ids.push(r.id);
      g.count += 1;
      g.total += r.total;
      const past = r.due_date ? daysBetween(r.due_date, now) : null;
      if (past === null || past <= 0) g.notDue += r.total;
      else if (past <= 30) g.d30 += r.total;
      else if (past <= 60) g.d60 += r.total;
      else if (past <= 90) g.d90 += r.total;
      else g.d90plus += r.total;
      if (past !== null && past > 0 && (g.oldest === null || past > g.oldest))
        g.oldest = past;
      groups.set(key, g);
    }
  }
  const kept = [...groups.values()].filter(
    (g) => options.minTotal === undefined || g.total >= options.minTotal,
  );
  const totals = new Map<string, ReportTotal>();
  for (const g of kept) addTotal(totals, g.currency, g.total, g.count);
  const rows = kept
    .sort((a, b) => (b.oldest ?? -1) - (a.oldest ?? -1) || b.total - a.total)
    .map((g) => ({
      org: g.org,
      supplier: g.supplier,
      currency: g.currency,
      invoices: g.count,
      notDue: round2(g.notDue),
      d30: round2(g.d30),
      d60: round2(g.d60),
      d90: round2(g.d90),
      d90plus: round2(g.d90plus),
      total: round2(g.total),
      daysPastDue: g.oldest ?? 0,
      // Decision 0629: the invoices behind the row, for Open in Documents.
      _ids: g.ids.join(","),
      ...(options.highlightDays !== undefined &&
      (g.oldest ?? 0) > options.highlightDays
        ? { _highlight: 1 }
        : {}),
    }));
  return {
    columns: [
      { key: "org", label: "agents.col.org", kind: "text" as const },
      { key: "supplier", label: "agents.col.supplier", kind: "text" as const },
      { key: "currency", label: "agents.col.currency", kind: "text" as const },
      { key: "invoices", label: "agents.col.invoices", kind: "count" as const },
      { key: "notDue", label: "agents.col.notdue", kind: "money" as const },
      { key: "d30", label: "agents.col.d30", kind: "money" as const },
      { key: "d60", label: "agents.col.d60", kind: "money" as const },
      { key: "d90", label: "agents.col.d90", kind: "money" as const },
      { key: "d90plus", label: "agents.col.d90plus", kind: "money" as const },
      { key: "total", label: "agents.col.total", kind: "money" as const },
      {
        key: "daysPastDue",
        label: "agents.col.dayspastdue",
        kind: "days" as const,
      },
    ],
    rows,
    totals: [...totals.values()].map((t) => ({
      ...t,
      total: t.total === null ? null : round2(t.total),
    })),
  };
}

/**
 * **Due soon, not yet payment-eligible — decision 0624.** Invoices still
 * in progress short of their exit stage whose due date falls today or in
 * the next `withinDays` days: the ones to push through before a discount
 * or a supplier's patience runs out. Soonest first; due within two days
 * highlighted.
 */
async function gatherDueSoon(
  db: D1Database,
  authorId: string,
  orgs: Org[],
  now: Date,
  options: AgentOptions,
) {
  const visible = await unitsWherePermitted(db, authorId, "AP.Analysis");
  const exits = await exitStageIds(db);
  const notExit =
    exits.length === 0
      ? "1"
      : `pi.current_stage_id NOT IN (${exits.map(() => "?").join(", ")})`;
  const today = now.toISOString().slice(0, 10);
  const until = new Date(now.getTime() + (options.withinDays ?? 7) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const seen = new Set<string>();
  const out: Record<string, string | number | null>[] = [];
  const totals = new Map<string, ReportTotal>();
  for (const org of orgs) {
    const units = await scopedToChosenOrg(db, visible, org.id);
    const clause = unitClause({ units }, "h.org_unit_id");
    const rows = await db
      .prepare(
        `SELECT DISTINCT h.id AS id, COALESCE(h.invoice_number, json_extract(h.facts_json, '$."BT-1"')) AS number,
                COALESCE(sup.name, json_extract(h.facts_json, '$."BT-27"')) AS supplier_name, s.name AS stage_name,
                h.currency AS currency, h.total_with_vat AS total, json_extract(h.facts_json, '$."BT-9"') AS due_date
         FROM invoice_headers h
         JOIN process_instances pi ON pi.subject_type = 'invoice' AND pi.subject_id = h.id
         JOIN process_stages s ON s.id = pi.current_stage_id
         LEFT JOIN suppliers sup ON sup.id = h.supplier_id
         WHERE pi.status = 'in_progress' AND ${notExit}
           AND json_extract(h.facts_json, '$."BT-9"') >= ? AND json_extract(h.facts_json, '$."BT-9"') <= ? ${clause.sql}`,
      )
      .bind(...exits, today, until, ...clause.binds)
      .all<{
        id: string;
        number: string | null;
        supplier_name: string | null;
        stage_name: string;
        currency: string | null;
        total: number | null;
        due_date: string;
      }>();
    for (const r of rows.results) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      const days = -daysBetween(r.due_date, now);
      out.push({
        org: org.name,
        invoiceId: r.id,
        invoice: r.number,
        supplier: r.supplier_name,
        stage: r.stage_name,
        due: r.due_date.slice(0, 10),
        daysToDue: days,
        total: r.total === null ? null : round2(r.total),
        currency: r.currency,
        ...(days <= 2 ? { _highlight: 1 } : {}),
      });
      addTotal(totals, r.currency, r.total);
    }
  }
  out.sort(
    (a, b) =>
      String(a.due).localeCompare(String(b.due)) ||
      Number(b.total ?? 0) - Number(a.total ?? 0),
  );
  return {
    columns: [
      { key: "org", label: "agents.col.org", kind: "text" as const },
      { key: "invoice", label: "agents.col.invoice", kind: "text" as const },
      { key: "supplier", label: "agents.col.supplier", kind: "text" as const },
      { key: "stage", label: "agents.col.stage", kind: "text" as const },
      { key: "due", label: "agents.col.due", kind: "date" as const },
      {
        key: "daysToDue",
        label: "agents.col.daystodue",
        kind: "days" as const,
      },
      { key: "total", label: "agents.col.total", kind: "money" as const },
      { key: "currency", label: "agents.col.currency", kind: "text" as const },
    ],
    rows: out,
    totals: [...totals.values()].map((t) => ({
      ...t,
      total: t.total === null ? null : round2(t.total),
    })),
  };
}

/**
 * **Stuck work — decision 0624.** Tasks open longer than `olderThanDays`,
 * by organisation, stage and who has them (or unclaimed), with how many
 * and the oldest's age in days. Oldest first; twice the limit highlighted.
 */
async function gatherStuck(
  db: D1Database,
  authorId: string,
  orgs: Org[],
  now: Date,
  options: AgentOptions,
) {
  const visible = await unitsWherePermitted(db, authorId, "AP.Analysis");
  const older = options.olderThanDays ?? 5;
  const before = new Date(now.getTime() - older * 86_400_000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
  const seen = new Set<string>();
  type Group = {
    org: string;
    stage: string;
    person: string | null;
    count: number;
    oldest: number;
    ids: Set<string>;
  };
  const groups = new Map<string, Group>();
  let count = 0;
  for (const org of orgs) {
    const units = await scopedToChosenOrg(db, visible, org.id);
    const clause = unitClause({ units }, "h.org_unit_id");
    const rows = await db
      .prepare(
        `SELECT t.id AS id, t.created_at AS created_at, s.name AS stage_name, u.name AS user_name, h.id AS invoice_id
         FROM tasks t
         JOIN process_stages s ON s.id = t.stage_id
         LEFT JOIN org_users u ON u.id = COALESCE(t.owner_user_id, t.claimed_by)
         LEFT JOIN stage_visits v ON v.id = t.stage_visit_id
         LEFT JOIN process_instances pi ON pi.id = v.process_instance_id
         LEFT JOIN invoice_headers h ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
         WHERE t.status = 'open' AND replace(t.created_at, 'T', ' ') < ? ${clause.sql}`,
      )
      .bind(before, ...clause.binds)
      .all<{
        id: string;
        created_at: string;
        stage_name: string;
        user_name: string | null;
        invoice_id: string | null;
      }>();
    for (const r of rows.results) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      const age = daysBetween(r.created_at.replace(" ", "T"), now);
      const key = `${org.id}::${r.stage_name}::${r.user_name ?? ""}`;
      const g: Group = groups.get(key) ?? {
        org: org.name,
        stage: r.stage_name,
        person: r.user_name,
        count: 0,
        oldest: 0,
        ids: new Set<string>(),
      };
      if (r.invoice_id) g.ids.add(r.invoice_id);
      g.count += 1;
      g.oldest = Math.max(g.oldest, age);
      groups.set(key, g);
      count += 1;
    }
  }
  const rows = [...groups.values()]
    .sort((a, b) => b.oldest - a.oldest || b.count - a.count)
    .map((g) => ({
      org: g.org,
      stage: g.stage,
      person: g.person,
      open: g.count,
      oldestDays: g.oldest,
      _ids: [...g.ids].join(","),
      ...(g.oldest >= older * 2 ? { _highlight: 1 } : {}),
    }));
  return {
    columns: [
      { key: "org", label: "agents.col.org", kind: "text" as const },
      { key: "stage", label: "agents.col.stage", kind: "text" as const },
      { key: "person", label: "agents.col.person", kind: "text" as const },
      { key: "open", label: "agents.col.stuck", kind: "count" as const },
      {
        key: "oldestDays",
        label: "agents.col.oldestdays",
        kind: "days" as const,
      },
    ],
    rows,
    totals: count > 0 ? [{ currency: null, total: null, count }] : [],
  };
}

async function gatherOverdue(
  db: D1Database,
  authorId: string,
  orgs: Org[],
  now: Date,
) {
  const rows: Record<string, string | number | null>[] = [];
  const totals = new Map<string, ReportTotal>();
  for (const org of orgs) {
    const body = (await handleOverdueBalance(db, org.id, authorId, now))
      .body as {
      suppliers: {
        supplierName: string | null;
        currency: string;
        total: number;
        count: number;
      }[];
    };
    for (const s of body.suppliers) {
      rows.push({
        org: org.name,
        supplier: s.supplierName,
        invoices: s.count,
        total: round2(s.total),
        currency: s.currency,
      });
      addTotal(totals, s.currency, s.total, s.count);
    }
  }
  return {
    columns: [
      { key: "org", label: "agents.col.org", kind: "text" as const },
      { key: "supplier", label: "agents.col.supplier", kind: "text" as const },
      { key: "invoices", label: "agents.col.invoices", kind: "count" as const },
      { key: "total", label: "agents.col.total", kind: "money" as const },
      { key: "currency", label: "agents.col.currency", kind: "text" as const },
    ],
    rows,
    totals: [...totals.values()].map((t) => ({
      ...t,
      total: t.total === null ? null : round2(t.total),
    })),
  };
}

async function gatherAccruals(db: D1Database, authorId: string, orgs: Org[]) {
  const rows: Record<string, string | number | null>[] = [];
  const totals = new Map<string, ReportTotal>();
  for (const org of orgs) {
    const body = (await handleAccruals(db, org.id, authorId)).body as {
      currencies: {
        currency: string;
        stages: { stageName: string; total: number; count: number }[];
      }[];
    };
    for (const c of body.currencies) {
      for (const s of c.stages) {
        rows.push({
          org: org.name,
          stage: s.stageName,
          invoices: s.count,
          total: round2(s.total),
          currency: c.currency,
        });
        addTotal(totals, c.currency, s.total, s.count);
      }
    }
  }
  return {
    columns: [
      { key: "org", label: "agents.col.org", kind: "text" as const },
      { key: "stage", label: "agents.col.stage", kind: "text" as const },
      { key: "invoices", label: "agents.col.invoices", kind: "count" as const },
      { key: "total", label: "agents.col.total", kind: "money" as const },
      { key: "currency", label: "agents.col.currency", kind: "text" as const },
    ],
    rows,
    totals: [...totals.values()].map((t) => ({
      ...t,
      total: t.total === null ? null : round2(t.total),
    })),
  };
}

async function gatherOpenTasks(db: D1Database, authorId: string, orgs: Org[]) {
  const rows: Record<string, string | number | null>[] = [];
  let count = 0;
  for (const org of orgs) {
    const body = (await handleWorkloadOpenTasks(db, org.id, authorId)).body as {
      users: { userName: string; openCount: number }[];
      available: number;
    };
    for (const u of body.users) {
      rows.push({ org: org.name, person: u.userName, open: u.openCount });
      count += u.openCount;
    }
    if (body.available > 0) {
      rows.push({ org: org.name, person: null, open: body.available });
      count += body.available;
    }
  }
  return {
    columns: [
      { key: "org", label: "agents.col.org", kind: "text" as const },
      { key: "person", label: "agents.col.person", kind: "text" as const },
      { key: "open", label: "agents.col.open", kind: "count" as const },
    ],
    rows,
    totals: count > 0 ? [{ currency: null, total: null, count }] : [],
  };
}

async function gatherDuplicates(db: D1Database, authorId: string, orgs: Org[]) {
  const rows: Record<string, string | number | null>[] = [];
  const totals = new Map<string, ReportTotal>();
  const seen = new Set<string>();
  for (const org of orgs) {
    const body = (await handlePossibleDuplicates(db, org.id, authorId))
      .body as {
      invoices: {
        id: string;
        invoiceNumber: string | null;
        supplierName: string | null;
        totalWithVat: number | null;
        currency: string | null;
        issueDate: string | null;
        duplicateConfidence: number;
      }[];
    };
    for (const i of body.invoices) {
      if (seen.has(i.id)) continue;
      seen.add(i.id);
      rows.push({
        org: org.name,
        invoiceId: i.id,
        invoice: i.invoiceNumber,
        supplier: i.supplierName,
        issued: i.issueDate,
        total: i.totalWithVat === null ? null : round2(i.totalWithVat),
        currency: i.currency,
        confidence: i.duplicateConfidence,
      });
      addTotal(totals, i.currency, i.totalWithVat);
    }
  }
  return {
    columns: [
      { key: "org", label: "agents.col.org", kind: "text" as const },
      { key: "invoice", label: "agents.col.invoice", kind: "text" as const },
      { key: "supplier", label: "agents.col.supplier", kind: "text" as const },
      { key: "issued", label: "agents.col.issued", kind: "date" as const },
      { key: "total", label: "agents.col.total", kind: "money" as const },
      { key: "currency", label: "agents.col.currency", kind: "text" as const },
      {
        key: "confidence",
        label: "agents.col.confidence",
        kind: "percent" as const,
      },
    ],
    rows,
    totals: [...totals.values()].map((t) => ({
      ...t,
      total: t.total === null ? null : round2(t.total),
    })),
  };
}

/** The reports an agent can run, in the order the form offers them. */
/**
 * **An invoice stuck at a stage — decision 0630.** In progress, short of
 * its exit stage, and at its current stage longer than `stageDays`
 * (default 3). One row per invoice; each stay at a stage is told once.
 */
async function gatherStuckInvoices(
  db: D1Database,
  authorId: string,
  orgs: Org[],
  now: Date,
  options: AgentOptions,
) {
  const visible = await unitsWherePermitted(db, authorId, "AP.Analysis");
  const exits = await exitStageIds(db);
  const notExit =
    exits.length === 0
      ? "1"
      : `pi.current_stage_id NOT IN (${exits.map(() => "?").join(", ")})`;
  const days = options.stageDays ?? 3;
  const before = new Date(now.getTime() - days * 86_400_000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
  const seen = new Set<string>();
  const out: Record<string, string | number | null>[] = [];
  const totals = new Map<string, ReportTotal>();
  for (const org of orgs) {
    const units = await scopedToChosenOrg(db, visible, org.id);
    const clause = unitClause({ units }, "h.org_unit_id");
    const rows = await db
      .prepare(
        `SELECT h.id AS id, COALESCE(h.invoice_number, json_extract(h.facts_json, '$."BT-1"')) AS number,
                COALESCE(sup.name, json_extract(h.facts_json, '$."BT-27"')) AS supplier_name, s.name AS stage_name,
                h.currency AS currency, h.total_with_vat AS total, v.id AS visit_id, v.created_at AS entered_at
         FROM invoice_headers h
         JOIN process_instances pi ON pi.subject_type = 'invoice' AND pi.subject_id = h.id
         JOIN process_stages s ON s.id = pi.current_stage_id
         JOIN stage_visits v ON v.id = (
           SELECT v2.id FROM stage_visits v2
           WHERE v2.process_instance_id = pi.id AND v2.stage_id = pi.current_stage_id
           ORDER BY v2.created_at DESC, v2.rowid DESC LIMIT 1)
         LEFT JOIN suppliers sup ON sup.id = h.supplier_id
         WHERE pi.status = 'in_progress' AND ${notExit}
           AND replace(v.created_at, 'T', ' ') < ? ${clause.sql}`,
      )
      .bind(...exits, before, ...clause.binds)
      .all<{
        id: string;
        number: string | null;
        supplier_name: string | null;
        stage_name: string;
        currency: string | null;
        total: number | null;
        visit_id: string;
        entered_at: string;
      }>();
    for (const r of rows.results) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({
        org: org.name,
        invoiceId: r.id,
        invoice: r.number,
        supplier: r.supplier_name,
        stage: r.stage_name,
        daysAtStage: daysBetween(r.entered_at.replace(" ", "T"), now),
        total: r.total === null ? null : round2(r.total),
        currency: r.currency,
        _key: `stuck:${r.visit_id}`,
      });
      addTotal(totals, r.currency, r.total);
    }
  }
  out.sort((a, b) => Number(b.daysAtStage) - Number(a.daysAtStage));
  return {
    columns: [
      { key: "org", label: "agents.col.org", kind: "text" as const },
      { key: "invoice", label: "agents.col.invoice", kind: "text" as const },
      { key: "supplier", label: "agents.col.supplier", kind: "text" as const },
      { key: "stage", label: "agents.col.stage", kind: "text" as const },
      {
        key: "daysAtStage",
        label: "agents.col.daysatstage",
        kind: "days" as const,
      },
      { key: "total", label: "agents.col.total", kind: "money" as const },
      { key: "currency", label: "agents.col.currency", kind: "text" as const },
    ],
    rows: out,
    totals: [...totals.values()].map((t) => ({
      ...t,
      total: t.total === null ? null : round2(t.total),
    })),
  };
}

/** **An invoice from a supplier not on file, or on hold — decision 0630**, as Fraud Prevention lists them. */
async function gatherUnapproved(db: D1Database, authorId: string, orgs: Org[]) {
  const out: Record<string, string | number | null>[] = [];
  const totals = new Map<string, ReportTotal>();
  const seen = new Set<string>();
  for (const org of orgs) {
    const body = (await handleUnapprovedSuppliers(db, org.id, authorId))
      .body as {
      invoices: {
        id: string;
        invoiceNumber: string | null;
        supplierName: string | null;
        totalWithVat: number | null;
        currency: string | null;
        issueDate: string | null;
        reason: "notonfile" | "onhold";
      }[];
    };
    for (const i of body.invoices) {
      if (seen.has(i.id)) continue;
      seen.add(i.id);
      out.push({
        org: org.name,
        invoiceId: i.id,
        invoice: i.invoiceNumber,
        supplier: i.supplierName,
        reason: i.reason,
        issued: i.issueDate,
        total: i.totalWithVat === null ? null : round2(i.totalWithVat),
        currency: i.currency,
        _key: `unapproved:${i.id}`,
      });
      addTotal(totals, i.currency, i.totalWithVat);
    }
  }
  return {
    columns: [
      { key: "org", label: "agents.col.org", kind: "text" as const },
      { key: "invoice", label: "agents.col.invoice", kind: "text" as const },
      { key: "supplier", label: "agents.col.supplier", kind: "text" as const },
      { key: "reason", label: "agents.col.reason", kind: "text" as const },
      { key: "issued", label: "agents.col.issued", kind: "date" as const },
      { key: "total", label: "agents.col.total", kind: "money" as const },
      { key: "currency", label: "agents.col.currency", kind: "text" as const },
    ],
    rows: out,
    totals: [...totals.values()].map((t) => ({
      ...t,
      total: t.total === null ? null : round2(t.total),
    })),
  };
}

/** Failed supplier files are looked for over this many days, the first time and after. */
const FAILED_FILES_DAYS = 14;

/**
 * **A supplier's file that could not be read — decision 0630.** Messages
 * received that failed, or were only partly read, as the Route monitor
 * shows them. Not tied to an organisation: whoever holds
 * Integration.Monitor sees them all.
 */
async function gatherFailedFiles(db: D1Database, now: Date) {
  const since = new Date(
    now.getTime() - FAILED_FILES_DAYS * 86_400_000,
  ).toISOString();
  const rows = await db
    .prepare(
      `SELECT id, received_at, counterparty, subject, status, failed_part, error_text FROM route_messages
       WHERE direction = 'in' AND status IN ('failed', 'partial') AND received_at >= ?
       ORDER BY received_at DESC LIMIT 500`,
    )
    .bind(since)
    .all<{
      id: string;
      received_at: string;
      counterparty: string | null;
      subject: string | null;
      status: string;
      failed_part: string | null;
      error_text: string | null;
    }>();
  const out = rows.results.map((m) => ({
    received: m.received_at.slice(0, 10),
    from: m.counterparty,
    subject: m.subject,
    problem: (m.error_text ?? m.failed_part ?? m.status).slice(0, 200),
    messageId: m.id,
    _key: `file:${m.id}`,
  }));
  return {
    columns: [
      { key: "received", label: "agents.col.received", kind: "date" as const },
      { key: "from", label: "agents.col.from", kind: "text" as const },
      { key: "subject", label: "agents.col.subject", kind: "text" as const },
      { key: "problem", label: "agents.col.problem", kind: "text" as const },
    ],
    rows: out,
    totals: out.length
      ? [{ currency: null, total: null, count: out.length }]
      : [],
  };
}

/** The totals of the rows kept, by currency, or a count where rows have none. */
function totalsOfRows(rows: Record<string, unknown>[]): ReportTotal[] {
  const totals = new Map<string, ReportTotal>();
  for (const r of rows) {
    if (typeof r.currency === "string" || typeof r.total === "number")
      addTotal(
        totals,
        typeof r.currency === "string" ? r.currency : null,
        typeof r.total === "number" ? r.total : null,
      );
    else addTotal(totals, null, null);
  }
  return [...totals.values()].map((t) => ({
    ...t,
    total: t.total === null ? null : round2(t.total),
  }));
}

export const AGENT_REPORTS: AgentReport[] = [
  {
    id: "outstanding_payables",
    permission: "AP.Analysis",
    gather: gatherOutstanding,
  },
  // Decision 0624.
  {
    id: "due_soon_not_eligible",
    permission: "AP.Analysis",
    gather: gatherDueSoon,
  },
  { id: "stuck_work", permission: "AP.Analysis", gather: gatherStuck },
  {
    id: "overdue_not_eligible",
    permission: "AP.Analysis",
    gather: (db, a, o, n) => gatherOverdue(db, a, o, n),
  },
  {
    id: "accruals",
    permission: "AP.Analysis",
    gather: (db, a, o) => gatherAccruals(db, a, o),
  },
  {
    id: "open_tasks",
    permission: "AP.Analysis",
    gather: (db, a, o) => gatherOpenTasks(db, a, o),
  },
  {
    id: "possible_duplicates",
    permission: "AP.FraudReview",
    gather: (db, a, o) => gatherDuplicates(db, a, o),
  },
  // Decision 0630: agents started by an event.
  {
    id: "event_stuck",
    permission: "AP.Analysis",
    event: true,
    gather: gatherStuckInvoices,
  },
  {
    id: "event_duplicate",
    permission: "AP.FraudReview",
    event: true,
    gather: async (db, a, o) => {
      const t = await gatherDuplicates(db, a, o);
      return {
        ...t,
        rows: t.rows.map((r) => ({ ...r, _key: `dup:${r.invoiceId}` })),
      };
    },
  },
  {
    id: "event_unapproved_supplier",
    permission: "AP.FraudReview",
    event: true,
    gather: (db, a, o) => gatherUnapproved(db, a, o),
  },
  {
    id: "event_file_failed",
    permission: "Integration.Monitor",
    event: true,
    gather: (db, _a, _o, n) => gatherFailedFiles(db, n),
  },
];

export function reportById(id: unknown): AgentReport | null {
  return AGENT_REPORTS.find((r) => r.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Settings, licence, rows
// ---------------------------------------------------------------------------

export async function agentTimeZone(db: D1Database): Promise<string> {
  const row = await db
    .prepare("SELECT time_zone FROM org_settings WHERE id = 1")
    .first<{ time_zone: string | null }>();
  return row?.time_zone && isTimeZone(row.time_zone)
    ? row.time_zone
    : DEFAULT_TIME_ZONE;
}

export async function agentLimit(db: D1Database): Promise<number> {
  const state = await readLicenceState(db);
  const limit = state.known
    ? (state.claims as { agentLimit?: unknown }).agentLimit
    : undefined;
  return typeof limit === "number" && Number.isInteger(limit) && limit >= 0
    ? limit
    : DEFAULT_AGENT_LIMIT;
}

interface AgentRow {
  id: string;
  name: string;
  author_id: string;
  report: string;
  org_unit_ids_json: string;
  schedule_json: string;
  status: "active" | "paused" | "removed";
  paused_reason: string | null;
  next_run_at: string | null;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
  deliver_task: number;
  deliver_email: number;
  options_json: string;
  description: string | null;
  plan_version: number;
  /** Decision 0626: 1 when each copy carries an AI summary. */
  summary: number;
  /** Decision 0631: what it also prepares for approval, if anything. */
  action: string | null;
}

interface Person {
  id: string;
  name: string;
  email: string | null;
}

/** People who hold AP.Manager anywhere: those an agent may also go to (decision 0623). */
async function managers(db: D1Database): Promise<Person[]> {
  const rows = await db
    .prepare(
      `SELECT DISTINCT u.id, COALESCE(u.name, u.email, u.id) AS name, u.email FROM org_users u
       JOIN org_user_roles ur ON ur.user_id = u.id JOIN org_roles r ON r.id = ur.role_id
       WHERE r.permissions_json LIKE '%"AP.Manager"%' ORDER BY name`,
    )
    .all<Person>();
  return rows.results;
}

async function recipientsOf(
  db: D1Database,
  agentId: string,
): Promise<
  {
    id: string;
    name: string;
    email: string | null;
    optedOutAt: string | null;
  }[]
> {
  const rows = await db
    .prepare(
      `SELECT u.id, COALESCE(u.name, u.email, u.id) AS name, u.email, r.opted_out_at FROM agent_recipients r
       JOIN org_users u ON u.id = r.user_id WHERE r.agent_id = ? ORDER BY r.added_at, name`,
    )
    .bind(agentId)
    .all<{
      id: string;
      name: string;
      email: string | null;
      opted_out_at: string | null;
    }>();
  return rows.results.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    optedOutAt: r.opted_out_at,
  }));
}

function parseIds(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

function parseOptions(row: {
  report: string;
  options_json?: string | null;
}): AgentOptions {
  let raw: unknown = {};
  try {
    raw = JSON.parse(row.options_json ?? "{}");
  } catch {
    raw = {};
  }
  const checked = checkOptions(row.report, raw);
  return "options" in checked
    ? checked.options
    : (checkOptions(row.report, {}) as { options: AgentOptions }).options;
}

function parseSchedule(json: string): AgentSchedule | null {
  try {
    const raw = JSON.parse(json) as { every?: unknown };
    if (raw?.every === "hour") return { every: "hour" };
    const checked = checkSchedule(raw);
    return "schedule" in checked ? checked.schedule : null;
  } catch {
    return null;
  }
}

async function orgsNamed(db: D1Database, ids: string[]): Promise<Org[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .prepare(
      `SELECT id, name FROM org_units WHERE id IN (${ids.map(() => "?").join(", ")})`,
    )
    .bind(...ids)
    .all<Org>();
  const byId = new Map(rows.results.map((o) => [o.id, o]));
  return ids.map((id) => byId.get(id)).filter((o): o is Org => Boolean(o));
}

/** Whether a visible-units list (`unitsWherePermitted`) covers the organisation. */
function covers(visible: string[] | null, orgId: string): boolean {
  return visible === null || visible.includes(orgId);
}

async function lastRuns(
  db: D1Database,
  agentIds: string[],
): Promise<
  Map<
    string,
    {
      status: string;
      startedAt: string;
      late: boolean;
      rowCount: number | null;
      error: string | null;
    }
  >
> {
  const out = new Map<
    string,
    {
      status: string;
      startedAt: string;
      late: boolean;
      rowCount: number | null;
      error: string | null;
    }
  >();
  if (agentIds.length === 0) return out;
  const rows = await db
    .prepare(
      `SELECT r.agent_id, r.status, r.started_at, r.late, r.row_count, r.error FROM agent_runs r
       WHERE r.agent_id IN (${agentIds.map(() => "?").join(", ")})
         AND r.started_at = (SELECT max(x.started_at) FROM agent_runs x WHERE x.agent_id = r.agent_id)`,
    )
    .bind(...agentIds)
    .all<{
      agent_id: string;
      status: string;
      started_at: string;
      late: number;
      row_count: number | null;
      error: string | null;
    }>();
  for (const r of rows.results) {
    out.set(r.agent_id, {
      status: r.status,
      startedAt: r.started_at,
      late: r.late === 1,
      rowCount: r.row_count,
      error: r.error,
    });
  }
  return out;
}

async function toBody(db: D1Database, rows: AgentRow[]) {
  const authors = new Map<string, string>();
  const authorIds = [...new Set(rows.map((r) => r.author_id))];
  if (authorIds.length > 0) {
    const people = await db
      .prepare(
        `SELECT id, name FROM org_users WHERE id IN (${authorIds.map(() => "?").join(", ")})`,
      )
      .bind(...authorIds)
      .all<{ id: string; name: string | null }>();
    for (const p of people.results) authors.set(p.id, p.name ?? p.id);
  }
  const last = await lastRuns(
    db,
    rows.map((r) => r.id),
  );
  const out = [];
  for (const r of rows) {
    out.push({
      id: r.id,
      name: r.name,
      authorId: r.author_id,
      authorName: authors.get(r.author_id) ?? r.author_id,
      report: r.report,
      orgs: await orgsNamed(db, parseIds(r.org_unit_ids_json)),
      schedule: parseSchedule(r.schedule_json),
      status: r.status,
      pausedReason: r.paused_reason,
      nextRunAt: r.next_run_at,
      lastRun: last.get(r.id) ?? null,
      createdAt: r.created_at,
      deliver: { task: r.deliver_task === 1, email: r.deliver_email === 1 },
      options: parseOptions(r),
      // Decision 0625: the words it was described in, and which plan it is on.
      description: r.description ?? null,
      planVersion: r.plan_version ?? 1,
      // Decision 0626: whether each copy carries an AI summary.
      summary: r.summary !== 0,
      // Decision 0631: what it also prepares for approval.
      action: r.action ?? null,
      recipients: (await recipientsOf(db, r.id)).map((p) => ({
        id: p.id,
        name: p.name,
        optedOut: p.optedOutAt !== null,
      })),
    });
  }
  return out;
}

async function loadAgent(db: D1Database, id: string): Promise<AgentRow | null> {
  return db
    .prepare("SELECT * FROM agents WHERE id = ? AND status <> 'removed'")
    .bind(id)
    .first<AgentRow>();
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * `GET /agents` — the person's own agents (with `all`, an administrator
 * holding `Admin.UserManagement` sees everyone's), the reports they may
 * choose, their organisations, the licence's count and the time zone.
 */
export async function handleListAgents(
  db: D1Database,
  userId: string,
  opts: {
    all?: boolean;
    emailReady?: boolean;
    aiReady?: boolean;
    now?: Date;
  } = {},
): Promise<RouteResult> {
  const canManageAll = await hasPermission(db, userId, "Admin.UserManagement");
  const all = Boolean(opts.all) && canManageAll;
  const rows = all
    ? await db
        .prepare(
          "SELECT * FROM agents WHERE status <> 'removed' ORDER BY created_at",
        )
        .all<AgentRow>()
    : await db
        .prepare(
          "SELECT * FROM agents WHERE status <> 'removed' AND author_id = ? ORDER BY created_at",
        )
        .bind(userId)
        .all<AgentRow>();
  const used = await db
    .prepare("SELECT count(*) AS n FROM agents WHERE status <> 'removed'")
    .first<{ n: number }>();
  const { units } = await unitsFor(db, userId);
  const reports = [];
  for (const r of AGENT_REPORTS) {
    const visible = await unitsWherePermitted(db, userId, r.permission);
    reports.push({
      id: r.id,
      permission: r.permission,
      orgIds: units.filter((u) => covers(visible, u.id)).map((u) => u.id),
      // Decision 0624: what it can be narrowed by, with the defaults.
      options: (checkOptions(r.id, {}) as { options: AgentOptions }).options,
      optionKeys: Object.entries(OPTION_RULES[r.id] ?? {})
        .filter(([, rule]) => rule)
        .map(([k]) => k),
      // Decision 0630: started by an event, looked at hourly.
      event: Boolean(r.event),
      // Decision 0631: what it can also prepare for approval.
      actions: actionsForReport(r.id),
    });
  }
  return {
    status: 200,
    body: {
      me: userId,
      agents: await toBody(db, rows.results),
      reports,
      orgs: units,
      limit: { used: used?.n ?? 0, max: await agentLimit(db) },
      timeZone: await agentTimeZone(db),
      canManageAll,
      canSetTimeZone: await hasPermission(db, userId, "Admin.Configure"),
      // Decision 0623: who else an agent may go to, and whether email is set up here.
      managers: (await managers(db))
        .filter((m) => m.id !== userId)
        .map((m) => ({ id: m.id, name: m.name, hasEmail: Boolean(m.email) })),
      emailReady: Boolean(opts.emailReady),
      // Decision 0626: whether summaries can be written here, and today's against the licence.
      aiReady: Boolean(opts.aiReady),
      summaries: await summariesToday(db, opts.now ?? new Date()),
      // Decision 0631: prepared actions on or off, and who may switch them.
      actionsEnabled: await actionsEnabled(db),
    },
  };
}

/** Checks a name, report, organisations and schedule against the author; the parts, or why not. */
async function checkAgentInput(
  db: D1Database,
  userId: string,
  input: Record<string, unknown>,
  current?: AgentRow,
): Promise<
  | {
      name: string;
      report: AgentReport;
      orgIds: string[];
      schedule: AgentSchedule;
      recipients: string[];
      deliverTask: boolean;
      deliverEmail: boolean;
      options: AgentOptions;
      description: string | null;
      summary: boolean;
      action: AgentActionKind | null;
    }
  | { reason: string; message: string }
> {
  const name =
    typeof input.name === "string" ? input.name.trim() : (current?.name ?? "");
  if (!name)
    return { reason: "name_missing", message: "give the agent a name" };
  if (name.length > NAME_MAX)
    return {
      reason: "name_too_long",
      message: `a name is at most ${NAME_MAX} characters`,
    };
  const report = reportById(input.report ?? current?.report);
  if (!report)
    return { reason: "report_unknown", message: "choose one of the reports" };
  const orgIds = Array.isArray(input.orgIds)
    ? [
        ...new Set(
          input.orgIds.filter((x): x is string => typeof x === "string"),
        ),
      ]
    : current
      ? parseIds(current.org_unit_ids_json)
      : [];
  if (orgIds.length === 0)
    return {
      reason: "orgs_missing",
      message: "choose at least one organisation",
    };
  const known = await orgsNamed(db, orgIds);
  if (known.length !== orgIds.length)
    return {
      reason: "org_unknown",
      message: "an organisation chosen does not exist",
    };
  const visible = await unitsWherePermitted(db, userId, report.permission);
  const notHeld = known.filter((o) => !covers(visible, o.id));
  if (notHeld.length > 0) {
    return {
      reason: "org_not_permitted",
      message: `you cannot see this report for ${notHeld.map((o) => o.name).join(", ")}`,
    };
  }
  // Decision 0630: an event report is looked at every hour; it has no time of its own.
  const checked: ReturnType<typeof checkSchedule> = report.event
    ? { schedule: { every: "hour" } }
    : checkSchedule(
        input.schedule ??
          (current ? JSON.parse(current.schedule_json) : undefined),
      );
  if ("reason" in checked)
    return { reason: checked.reason, message: "the schedule is not complete" };

  // Decision 0623: how it is delivered, and to whom besides its author.
  const deliver = (input.deliver ?? {}) as Record<string, unknown>;
  const deliverTask =
    typeof deliver.task === "boolean"
      ? deliver.task
      : current
        ? current.deliver_task === 1
        : true;
  const deliverEmail =
    typeof deliver.email === "boolean"
      ? deliver.email
      : current
        ? current.deliver_email === 1
        : false;
  if (!deliverTask && !deliverEmail)
    return {
      reason: "deliver_missing",
      message: "choose the task list, email, or both",
    };
  const authorId = current?.author_id ?? userId;
  const recipients = Array.isArray(input.recipients)
    ? [
        ...new Set(
          input.recipients.filter(
            (x): x is string => typeof x === "string" && x !== authorId,
          ),
        ),
      ]
    : current
      ? (await recipientsOf(db, current.id))
          .map((p) => p.id)
          .filter((id) => id !== authorId)
      : [];
  if (recipients.length > 0) {
    const allowed = new Set((await managers(db)).map((m) => m.id));
    if (recipients.some((id) => !allowed.has(id))) {
      return {
        reason: "recipient_not_manager",
        message:
          "an agent goes only to its author and people with the AP Manager permission",
      };
    }
  }
  // Decision 0624: the report's own options; kept from before where not sent and the report is unchanged.
  const optionsInput =
    input.options ??
    (current && current.report === report.id
      ? JSON.parse(current.options_json ?? "{}")
      : {});
  const opts = checkOptions(report.id, optionsInput);
  if ("reason" in opts)
    return { reason: opts.reason, message: "an option is out of range" };
  // Decision 0625: the words it was described in, where it was.
  const description =
    typeof input.description === "string"
      ? input.description.trim().slice(0, 600) || null
      : input.description === null
        ? null
        : (current?.description ?? null);
  // Decision 0626: the AI summary, on unless turned off.
  const summary =
    typeof input.summary === "boolean"
      ? input.summary
      : current
        ? current.summary !== 0
        : true;
  // Decision 0631: what it also prepares; kept on edit while the report is the same.
  const actionChecked = checkAction(
    report.id,
    input.action !== undefined
      ? input.action
      : current && current.report === report.id
        ? current.action
        : null,
  );
  if ("reason" in actionChecked)
    return {
      reason: actionChecked.reason,
      message: "that action is not one this report can prepare",
    };
  return {
    name,
    report,
    orgIds,
    schedule: checked.schedule,
    recipients,
    deliverTask,
    deliverEmail,
    options: opts.options,
    description,
    summary,
    action: actionChecked.action,
  };
}

type Checked = Exclude<
  Awaited<ReturnType<typeof checkAgentInput>>,
  { reason: string }
>;

/** The plan as one value, to keep as a version and to tell whether it changed. */
function planOf(c: Checked) {
  return {
    report: c.report.id,
    orgIds: c.orgIds,
    schedule: c.schedule,
    options: c.options,
    deliver: { task: c.deliverTask, email: c.deliverEmail },
    recipients: [...c.recipients].sort(),
    // Decision 0626: said only when off, so plans kept before the summary existed (on) are unchanged.
    ...(c.summary ? {} : { summary: false }),
    // Decision 0631: said only when set, so earlier plans are unchanged.
    ...(c.action ? { action: c.action } : {}),
  };
}

/**
 * **A new version where the plan changed — decision 0625.** Renaming, or
 * starting and pausing, keeps the version; a different report, place,
 * time, option, delivery or recipient makes the next one.
 */
async function keepPlanVersion(
  db: D1Database,
  agentId: string,
  userId: string,
  checked: Checked,
  now: Date,
): Promise<number> {
  const plan = JSON.stringify(planOf(checked));
  const last = await db
    .prepare(
      "SELECT version, plan_json, description FROM agent_plan_versions WHERE agent_id = ? ORDER BY version DESC LIMIT 1",
    )
    .bind(agentId)
    .first<{
      version: number;
      plan_json: string;
      description: string | null;
    }>();
  if (last && last.plan_json === plan) {
    if (checked.description !== last.description) {
      await db
        .prepare(
          "UPDATE agent_plan_versions SET description = ? WHERE agent_id = ? AND version = ?",
        )
        .bind(checked.description, agentId, last.version)
        .run();
    }
    return last.version;
  }
  const version = (last?.version ?? 0) + 1;
  await db
    .prepare(
      "INSERT INTO agent_plan_versions (agent_id, version, description, plan_json, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(
      agentId,
      version,
      checked.description,
      plan,
      now.toISOString(),
      userId,
    )
    .run();
  return version;
}

/** Its author and the people chosen; anyone already there keeps whether they stopped it. */
async function setRecipients(
  db: D1Database,
  agentId: string,
  authorId: string,
  others: string[],
  now: Date,
) {
  const want = new Set([authorId, ...others]);
  const have = await recipientsOf(db, agentId);
  for (const p of have) {
    if (!want.has(p.id))
      await db
        .prepare(
          "DELETE FROM agent_recipients WHERE agent_id = ? AND user_id = ?",
        )
        .bind(agentId, p.id)
        .run();
  }
  const already = new Set(have.map((p) => p.id));
  for (const id of want) {
    if (!already.has(id))
      await db
        .prepare(
          "INSERT INTO agent_recipients (agent_id, user_id, added_at) VALUES (?, ?, ?)",
        )
        .bind(agentId, id, now.toISOString())
        .run();
  }
}

/** `POST /agents` — made paused. Refused at the licence's count. */
export async function handleCreateAgent(
  db: D1Database,
  userId: string,
  input: Record<string, unknown>,
  now = new Date(),
): Promise<RouteResult> {
  const checked = await checkAgentInput(db, userId, input);
  if ("reason" in checked)
    return {
      status: 422,
      body: { error: checked.message, reason: checked.reason },
    };
  const used = await db
    .prepare("SELECT count(*) AS n FROM agents WHERE status <> 'removed'")
    .first<{ n: number }>();
  const max = await agentLimit(db);
  if ((used?.n ?? 0) >= max) {
    return {
      status: 409,
      body: {
        error: `this environment's licence allows ${max} agents`,
        reason: "limit_reached",
        max,
      },
    };
  }
  const id = `agt-${crypto.randomUUID()}`;
  const at = now.toISOString();
  await db
    .prepare(
      `INSERT INTO agents (id, name, author_id, report, org_unit_ids_json, schedule_json, status, created_at, updated_at, deliver_task, deliver_email, options_json)
       VALUES (?, ?, ?, ?, ?, ?, 'paused', ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      checked.name,
      userId,
      checked.report.id,
      JSON.stringify(checked.orgIds),
      JSON.stringify(checked.schedule),
      at,
      at,
      checked.deliverTask ? 1 : 0,
      checked.deliverEmail ? 1 : 0,
      JSON.stringify(checked.options),
    )
    .run();
  await setRecipients(db, id, userId, checked.recipients, now);
  const version = await keepPlanVersion(db, id, userId, checked, now);
  await db
    .prepare(
      "UPDATE agents SET description = ?, plan_version = ?, summary = ?, action = ? WHERE id = ?",
    )
    .bind(
      checked.description,
      version,
      checked.summary ? 1 : 0,
      checked.action,
      id,
    )
    .run();
  await logEvent(db, id, userId, "created", { version }, now);
  const row = (await loadAgent(db, id))!;
  return { status: 201, body: (await toBody(db, [row]))[0] };
}

/**
 * `PATCH /agents/:id` — the author changes it: name, report,
 * organisations, schedule, and `status` active or paused. Starting works
 * out the next run; a `once` already past is refused.
 */
export async function handleUpdateAgent(
  db: D1Database,
  userId: string,
  id: string,
  input: Record<string, unknown>,
  now = new Date(),
): Promise<RouteResult> {
  const row = await loadAgent(db, id);
  if (!row)
    return {
      status: 404,
      body: { error: `agent ${id} does not exist`, reason: "not_found" },
    };
  if (row.author_id !== userId)
    return {
      status: 403,
      body: {
        error: "only its author can change an agent",
        reason: "not_author",
      },
    };
  // Pausing alone always works, even where the rest would no longer pass.
  if (
    input.status === "paused" &&
    Object.keys(input).every((k) => k === "status")
  ) {
    await db
      .prepare(
        "UPDATE agents SET status = 'paused', paused_reason = NULL, next_run_at = NULL, updated_at = ? WHERE id = ?",
      )
      .bind(now.toISOString(), id)
      .run();
    if (row.status === "active")
      await logEvent(db, id, userId, "paused", {}, now);
    return {
      status: 200,
      body: (await toBody(db, [(await loadAgent(db, id))!]))[0],
    };
  }
  const checked = await checkAgentInput(db, userId, input, row);
  if ("reason" in checked)
    return {
      status: 422,
      body: { error: checked.message, reason: checked.reason },
    };
  const status =
    input.status === "active" || input.status === "paused"
      ? input.status
      : row.status;
  let nextRunAt: string | null = null;
  if (status === "active") {
    nextRunAt = nextRunAfter(checked.schedule, await agentTimeZone(db), now);
    if (!nextRunAt)
      return {
        status: 422,
        body: { error: "that time has already passed", reason: "once_past" },
      };
  }
  await db
    .prepare(
      `UPDATE agents SET name = ?, report = ?, org_unit_ids_json = ?, schedule_json = ?, status = ?, paused_reason = NULL,
              next_run_at = ?, updated_at = ?, deliver_task = ?, deliver_email = ?, options_json = ? WHERE id = ?`,
    )
    .bind(
      checked.name,
      checked.report.id,
      JSON.stringify(checked.orgIds),
      JSON.stringify(checked.schedule),
      status,
      nextRunAt,
      now.toISOString(),
      checked.deliverTask ? 1 : 0,
      checked.deliverEmail ? 1 : 0,
      JSON.stringify(checked.options),
      id,
    )
    .run();
  await setRecipients(db, id, row.author_id, checked.recipients, now);
  const version = await keepPlanVersion(db, id, userId, checked, now);
  await db
    .prepare(
      "UPDATE agents SET description = ?, plan_version = ?, summary = ?, action = ? WHERE id = ?",
    )
    .bind(
      checked.description,
      version,
      checked.summary ? 1 : 0,
      checked.action,
      id,
    )
    .run();
  // Decision 0627: what changed, in the agent log.
  if (checked.name !== row.name)
    await logEvent(
      db,
      id,
      userId,
      "renamed",
      { from: row.name, to: checked.name },
      now,
    );
  if (version !== (row.plan_version ?? 1))
    await logEvent(
      db,
      id,
      userId,
      "changed",
      { version, from: row.plan_version ?? 1 },
      now,
    );
  if (status !== row.status)
    await logEvent(
      db,
      id,
      userId,
      status === "active" ? "started" : "paused",
      {},
      now,
    );
  return {
    status: 200,
    body: (await toBody(db, [(await loadAgent(db, id))!]))[0],
  };
}

/** `DELETE /agents/:id` — its author, or an administrator (`Admin.UserManagement`, decision 0622). Its runs and notes stay. */
export async function handleRemoveAgent(
  db: D1Database,
  userId: string,
  id: string,
  now = new Date(),
): Promise<RouteResult> {
  const row = await loadAgent(db, id);
  if (!row)
    return {
      status: 404,
      body: { error: `agent ${id} does not exist`, reason: "not_found" },
    };
  if (
    row.author_id !== userId &&
    !(await hasPermission(db, userId, "Admin.UserManagement"))
  ) {
    return {
      status: 403,
      body: {
        error: "only its author or an administrator can remove an agent",
        reason: "not_author",
      },
    };
  }
  await db
    .prepare(
      "UPDATE agents SET status = 'removed', next_run_at = NULL, removed_at = ?, removed_by = ?, updated_at = ? WHERE id = ?",
    )
    .bind(now.toISOString(), userId, now.toISOString(), id)
    .run();
  if (row.status !== "removed")
    await logEvent(
      db,
      id,
      userId,
      "removed",
      row.author_id === userId ? {} : { authorId: row.author_id },
      now,
    );
  return { status: 200, body: { id, removed: true } };
}

/** `GET /agents/:id/runs` — the last 50, for its author or an administrator. */
export async function handleListAgentRuns(
  db: D1Database,
  userId: string,
  id: string,
): Promise<RouteResult> {
  const row = await db
    .prepare("SELECT * FROM agents WHERE id = ?")
    .bind(id)
    .first<AgentRow>();
  if (!row)
    return {
      status: 404,
      body: { error: `agent ${id} does not exist`, reason: "not_found" },
    };
  if (
    row.author_id !== userId &&
    !(await hasPermission(db, userId, "Admin.UserManagement"))
  ) {
    return {
      status: 403,
      body: {
        error: "only its author or an administrator can see its runs",
        reason: "not_author",
      },
    };
  }
  const runs = await db
    .prepare(
      `SELECT id, trigger, scheduled_for, started_at, finished_at, status, late, row_count, totals_json, error, plan_version
       FROM agent_runs WHERE agent_id = ? ORDER BY started_at DESC LIMIT 50`,
    )
    .bind(id)
    .all<{
      id: string;
      trigger: string;
      scheduled_for: string | null;
      started_at: string;
      finished_at: string | null;
      status: string;
      late: number;
      row_count: number | null;
      totals_json: string | null;
      error: string | null;
      plan_version: number | null;
    }>();
  // Decision 0623: who each run went to, and how.
  const deliveries = new Map<
    string,
    {
      user_name: string;
      channel: string;
      status: string;
      error: string | null;
      summary: string | null;
    }[]
  >();
  if (runs.results.length > 0) {
    const rows = await db
      .prepare(
        `SELECT d.run_id, COALESCE(u.name, u.email, d.user_id) AS user_name, d.channel, d.status, d.error, d.summary FROM agent_deliveries d
         JOIN org_users u ON u.id = d.user_id WHERE d.run_id IN (${runs.results.map(() => "?").join(", ")}) ORDER BY d.created_at`,
      )
      .bind(...runs.results.map((r) => r.id))
      .all<{
        run_id: string;
        user_name: string;
        channel: string;
        status: string;
        error: string | null;
        summary: string | null;
      }>();
    for (const d of rows.results)
      deliveries.set(d.run_id, [...(deliveries.get(d.run_id) ?? []), d]);
  }
  return {
    status: 200,
    body: {
      runs: runs.results.map((r) => ({
        id: r.id,
        trigger: r.trigger,
        scheduledFor: r.scheduled_for,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        status: r.status,
        late: r.late === 1,
        rowCount: r.row_count,
        totals: r.totals_json
          ? (JSON.parse(r.totals_json) as ReportTotal[])
          : [],
        error: r.error,
        planVersion: r.plan_version,
        deliveries: (deliveries.get(r.id) ?? []).map((d) => ({
          userName: d.user_name,
          channel: d.channel,
          status: d.status,
          error: d.error,
          // Decision 0626: what became of the summary for this copy.
          summary: d.summary,
        })),
      })),
    },
  };
}

/** `PUT /agent-settings` — the environment's time zone (Admin.Configure). Every active agent's next run is worked out again. */
export async function handleSetAgentTimeZone(
  db: D1Database,
  input: Record<string, unknown>,
  now = new Date(),
): Promise<RouteResult> {
  if (!isTimeZone(input.timeZone))
    return {
      status: 422,
      body: {
        error: "that is not a time zone this system knows",
        reason: "time_zone_invalid",
      },
    };
  const zone = input.timeZone;
  await db
    .prepare(
      "UPDATE org_settings SET time_zone = ?, updated_at = datetime('now') WHERE id = 1",
    )
    .bind(zone)
    .run();
  const active = await db
    .prepare("SELECT id, schedule_json FROM agents WHERE status = 'active'")
    .all<{ id: string; schedule_json: string }>();
  for (const a of active.results) {
    const schedule = parseSchedule(a.schedule_json);
    const next = schedule ? nextRunAfter(schedule, zone, now) : null;
    if (next) {
      await db
        .prepare("UPDATE agents SET next_run_at = ? WHERE id = ?")
        .bind(next, a.id)
        .run();
    } else {
      await db
        .prepare(
          "UPDATE agents SET status = 'paused', paused_reason = 'finished', next_run_at = NULL WHERE id = ?",
        )
        .bind(a.id)
        .run();
    }
  }
  return { status: 200, body: { timeZone: zone } };
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

async function pause(db: D1Database, id: string, reason: string, now: Date) {
  const result = await db
    .prepare(
      "UPDATE agents SET status = 'paused', paused_reason = ?, next_run_at = NULL, updated_at = ? WHERE id = ? AND status = 'active'",
    )
    .bind(reason, now.toISOString(), id)
    .run();
  if ((result.meta?.changes ?? 0) > 0)
    await logEvent(db, id, null, "paused_access", { reason }, now);
}

export type AgentEventKind =
  | "created"
  | "changed"
  | "renamed"
  | "started"
  | "paused"
  | "paused_access"
  | "removed"
  | "stopped_receiving";

/**
 * **The agent log — decision 0627.** What was changed on an agent, by
 * whom (null: by VibeFinance) and when. Changes only; runs are on the
 * agent's own page.
 */
async function logEvent(
  db: D1Database,
  agentId: string,
  userId: string | null,
  kind: AgentEventKind,
  detail: Record<string, unknown>,
  now: Date,
) {
  await db
    .prepare(
      "INSERT INTO agent_events (id, agent_id, at, user_id, kind, detail_json) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(
      `evt-${crypto.randomUUID()}`,
      agentId,
      now.toISOString(),
      userId,
      kind,
      JSON.stringify(detail),
    )
    .run();
}

function bytesToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * One run: check the author, then for each recipient (the author alone for
 * Run now) gather what they may see and deliver it, on the task list, by
 * email, or both. Never throws; a failure is recorded on the run, and each
 * delivery on its own row.
 *
 * **Each copy is the recipient's own — decision 0623.** The organisations
 * are the chosen ones the author can still see *and* the recipient can, and
 * the report is gathered with the recipient's own access, so nobody is sent
 * a number they could not see in the app. A recipient no longer holding
 * AP.Manager (the author apart), or who stopped it, gets nothing.
 */
export async function runAgent(
  db: D1Database,
  agent: AgentRow,
  trigger: "schedule" | "now",
  now: Date,
  scheduledFor: string | null = null,
  deps: AgentDeps = NO_DEPS,
): Promise<RunResult> {
  const result = await runAgentOnce(
    db,
    agent,
    trigger,
    now,
    scheduledFor,
    deps,
  );
  try {
    await careFor(db, agent, trigger, result, now);
  } catch {
    // The run is recorded either way; the task about it is a courtesy.
  }
  return result;
}

type RunResult = {
  runId: string;
  status: "delivered" | "nothing" | "failed";
  error?: string;
  deliveries?: number;
};

/**
 * **A failure is a task for its author — decision 0627.** A scheduled
 * run that failed, or delivered with some copies failing, puts one note
 * on the author's task list saying what went wrong; while it keeps
 * failing, the same note says how many times and when last. A run that
 * succeeds again (Run now included) marks it done.
 */
async function careFor(
  db: D1Database,
  agent: AgentRow,
  trigger: "schedule" | "now",
  result: RunResult,
  now: Date,
) {
  let error = result.status === "failed" ? (result.error ?? "failed") : null;
  let failedCopies = 0;
  if (result.status === "delivered") {
    const f = await db
      .prepare(
        "SELECT count(*) AS n, MIN(error) AS error FROM agent_deliveries WHERE run_id = ? AND status = 'failed'",
      )
      .bind(result.runId)
      .first<{ n: number; error: string | null }>();
    failedCopies = f?.n ?? 0;
    if (failedCopies > 0) error = f?.error ?? "failed";
  }
  const open = await db
    .prepare(
      "SELECT id, report_json FROM agent_notes WHERE agent_id = ? AND user_id = ? AND kind = 'failure' AND done_at IS NULL ORDER BY created_at DESC LIMIT 1",
    )
    .bind(agent.id, agent.author_id)
    .first<{ id: string; report_json: string }>();
  if (error === null) {
    if (open)
      await db
        .prepare(
          "UPDATE agent_notes SET done_at = ? WHERE agent_id = ? AND user_id = ? AND kind = 'failure' AND done_at IS NULL",
        )
        .bind(now.toISOString(), agent.id, agent.author_id)
        .run();
    return;
  }
  if (trigger !== "schedule") return;
  const failure = {
    error: error.slice(0, 300),
    partial: result.status === "delivered",
    failedCopies,
    times: 1,
    firstAt: now.toISOString(),
    lastAt: now.toISOString(),
  };
  if (open) {
    const was = JSON.parse(open.report_json) as {
      times?: number;
      firstAt?: string;
    };
    await db
      .prepare(
        "UPDATE agent_notes SET run_id = ?, report_json = ? WHERE id = ?",
      )
      .bind(
        result.runId,
        JSON.stringify({
          ...failure,
          times: (was.times ?? 1) + 1,
          firstAt: was.firstAt ?? failure.firstAt,
        }),
        open.id,
      )
      .run();
    return;
  }
  await db
    .prepare(
      "INSERT INTO agent_notes (id, agent_id, run_id, user_id, report_json, created_at, kind) VALUES (?, ?, ?, ?, ?, ?, 'failure')",
    )
    .bind(
      `note-${crypto.randomUUID()}`,
      agent.id,
      result.runId,
      agent.author_id,
      JSON.stringify(failure),
      now.toISOString(),
    )
    .run();
}

async function runAgentOnce(
  db: D1Database,
  agent: AgentRow,
  trigger: "schedule" | "now",
  now: Date,
  scheduledFor: string | null,
  deps: AgentDeps,
): Promise<{
  runId: string;
  status: "delivered" | "nothing" | "failed";
  error?: string;
  deliveries?: number;
}> {
  const runId = `run-${crypto.randomUUID()}`;
  const late =
    scheduledFor !== null &&
    now.getTime() - Date.parse(scheduledFor) > LATE_AFTER_MS;
  await db
    .prepare(
      "INSERT INTO agent_runs (id, agent_id, trigger, scheduled_for, started_at, status, late, plan_version) VALUES (?, ?, ?, ?, ?, 'running', ?, ?)",
    )
    .bind(
      runId,
      agent.id,
      trigger,
      scheduledFor,
      now.toISOString(),
      late ? 1 : 0,
      agent.plan_version ?? 1,
    )
    .run();
  const finish = async (
    status: "delivered" | "nothing" | "failed",
    rowCount: number | null,
    totals: ReportTotal[] | null,
    error: string | null,
  ) => {
    await db
      .prepare(
        "UPDATE agent_runs SET status = ?, finished_at = ?, row_count = ?, totals_json = ?, error = ? WHERE id = ?",
      )
      .bind(
        status,
        new Date().toISOString(),
        rowCount,
        totals ? JSON.stringify(totals) : null,
        error,
        runId,
      )
      .run();
  };
  const record = async (
    userId: string,
    channel: "task" | "email",
    status: "sent" | "failed",
    rowCount: number,
    extra: {
      messageId?: string | null;
      copyKey?: string | null;
      error?: string | null;
      totals?: ReportTotal[] | null;
      summary?: string | null;
      id?: string;
      invoiceIds?: string[] | null;
    } = {},
  ) => {
    await db
      .prepare(
        "INSERT INTO agent_deliveries (id, run_id, agent_id, user_id, channel, status, row_count, message_id, copy_key, error, created_at, totals_json, summary, invoice_ids_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        extra.id ?? `dlv-${crypto.randomUUID()}`,
        runId,
        agent.id,
        userId,
        channel,
        status,
        rowCount,
        extra.messageId ?? null,
        extra.copyKey ?? null,
        extra.error ?? null,
        now.toISOString(),
        extra.totals ? JSON.stringify(extra.totals) : null,
        extra.summary ?? null,
        extra.invoiceIds && extra.invoiceIds.length
          ? JSON.stringify(extra.invoiceIds)
          : null,
      )
      .run();
  };

  try {
    const report = reportById(agent.report);
    if (!report) {
      await finish("failed", null, null, "report_unknown");
      return { runId, status: "failed", error: "report_unknown" };
    }
    if (!(await hasPermission(db, agent.author_id, "AP.Agents"))) {
      await finish("failed", null, null, "author_access");
      await pause(db, agent.id, "author_access", now);
      return { runId, status: "failed", error: "author_access" };
    }
    const chosen = await orgsNamed(db, parseIds(agent.org_unit_ids_json));
    const authorVisible = await unitsWherePermitted(
      db,
      agent.author_id,
      report.permission,
    );
    const orgs = chosen.filter((o) => covers(authorVisible, o.id));
    const skippedOrgs = chosen
      .filter((o) => !covers(authorVisible, o.id))
      .map((o) => o.name);
    if (orgs.length === 0) {
      await finish("failed", null, null, "author_access");
      await pause(db, agent.id, "author_access", now);
      return { runId, status: "failed", error: "author_access" };
    }

    const everyone = await recipientsOf(db, agent.id);
    const author =
      everyone.find((p) => p.id === agent.author_id) ??
      (await db
        .prepare(
          "SELECT id, COALESCE(name, email, id) AS name, email FROM org_users WHERE id = ?",
        )
        .bind(agent.author_id)
        .first<Person>());
    const authorName = author?.name ?? agent.author_id;
    const list =
      trigger === "now"
        ? author
          ? [
              {
                id: author.id,
                name: author.name,
                email: author.email,
                optedOutAt: null,
              },
            ]
          : []
        : everyone.filter((p) => p.optedOutAt === null);
    const zone = await agentTimeZone(db);
    const send = deps.send ?? sendEmailViaResend;

    // Decision 0626: summaries, one per distinct copy and language; the same copy twice is written once.
    const summaries = new Map<string, SummaryOutcome>();
    let dayLimit: number | null = null;
    const summarise = async (
      table: ReportTable,
      locale: EmailLocale,
    ): Promise<SummaryOutcome> => {
      if (agent.summary === 0) return { status: "off" };
      if (!deps.model) return { status: "no_ai" };
      const key = `${locale}|${JSON.stringify([table.rows, table.totals, table.previous])}`;
      const known = summaries.get(key);
      if (known) return known;
      dayLimit = dayLimit ?? (await summaryLimit(db));
      const outcome = (await takeSummary(db, dayLimit, now))
        ? await writeSummary(deps.model, table, locale, agent.name)
        : { status: "over_budget" as const };
      summaries.set(key, outcome);
      return outcome;
    };

    let sent = 0;
    let failed = 0;
    let authorTable: ReportTable | null = null;
    let anyTable: ReportTable | null = null;
    let firstError: string | null = null;
    for (const person of list) {
      const isAuthor = person.id === agent.author_id;
      if (!isAuthor && !(await hasPermission(db, person.id, "AP.Manager")))
        continue;
      const theirs = isAuthor
        ? null
        : await unitsWherePermitted(db, person.id, report.permission);
      const theirOrgs = isAuthor
        ? orgs
        : orgs.filter((o) => covers(theirs, o.id));
      if (theirOrgs.length === 0) continue;
      const options = parseOptions(agent);
      const gathered = await report.gather(
        db,
        person.id,
        theirOrgs,
        now,
        options,
      );
      // Decision 0624: compared with what this person was last sent.
      const last = await db
        .prepare(
          "SELECT totals_json FROM agent_deliveries WHERE agent_id = ? AND user_id = ? AND status = 'sent' AND totals_json IS NOT NULL ORDER BY created_at DESC LIMIT 1",
        )
        .bind(agent.id, person.id)
        .first<{ totals_json: string }>();
      const table: ReportTable = {
        report: report.id,
        ...gathered,
        skippedOrgs,
        asAt: now.toISOString(),
        previous: last ? (JSON.parse(last.totals_json) as ReportTotal[]) : null,
        options,
      };
      // Decision 0630: an event agent sends each person only what they have not been sent.
      if (report.event) {
        const keys = table.rows.map((r) => String(r._key ?? ""));
        const already = keys.length
          ? await db
              .prepare(
                "SELECT key FROM agent_seen WHERE agent_id = ? AND user_id = ? AND key IN (SELECT value FROM json_each(?))",
              )
              .bind(agent.id, person.id, JSON.stringify(keys))
              .all<{ key: string }>()
          : { results: [] };
        const sentBefore = new Set(already.results.map((r) => r.key));
        table.rows = table.rows.filter(
          (r) => !sentBefore.has(String(r._key ?? "")),
        );
        table.totals = totalsOfRows(table.rows);
        table.previous = null;
      }
      if (table.rows.length === 0) continue;
      const markSent = async () => {
        if (!report.event) return;
        const keys = table.rows
          .map((r) => String(r._key ?? ""))
          .filter(Boolean);
        if (!keys.length) return;
        await db
          .prepare(
            `INSERT OR IGNORE INTO agent_seen (agent_id, user_id, key, sent_at)
             SELECT ?, ?, value, ? FROM json_each(?)`,
          )
          .bind(agent.id, person.id, now.toISOString(), JSON.stringify(keys))
          .run();
      };
      if (isAuthor) authorTable = table;
      anyTable = anyTable ?? table;
      const localeRow = await db
        .prepare("SELECT locale FROM org_users WHERE id = ?")
        .bind(person.id)
        .first<{ locale: string | null }>();
      const locale = emailLocale(localeRow?.locale ?? deps.defaultLocale);
      const summary = await summarise(table, locale);
      table.summary = summary.status === "written" ? summary.text : null;

      if (agent.deliver_task === 1) {
        await db
          .prepare(
            "INSERT INTO agent_notes (id, agent_id, run_id, user_id, report_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .bind(
            `note-${crypto.randomUUID()}`,
            agent.id,
            runId,
            person.id,
            JSON.stringify(table),
            now.toISOString(),
          )
          .run();
        await record(person.id, "task", "sent", table.rows.length, {
          totals: table.totals,
          summary: summary.status,
        });
        await markSent();
        sent += 1;
      }

      if (agent.deliver_email === 1) {
        const fail = async (error: string) => {
          await record(person.id, "email", "failed", table.rows.length, {
            error,
            summary: summary.status,
          });
          failed += 1;
          firstError = firstError ?? error;
        };
        if (!deps.email) {
          await fail("email_not_configured");
          continue;
        }
        if (!person.email) {
          await fail("no_email_address");
          continue;
        }
        // Decision 0629: the email links to Documents at this copy's own invoices.
        const deliveryId = `dlv-${crypto.randomUUID()}`;
        const invoiceIds = tableInvoiceIds(table);
        const built = buildAgentEmail({
          locale,
          summary: table.summary,
          documentsUrl:
            deps.appUrl && invoiceIds.length
              ? `${deps.appUrl}/?agentdocs=${encodeURIComponent(deliveryId)}`
              : null,
          agentName: agent.name,
          authorName,
          table,
          timeZone: zone,
          appUrl: deps.appUrl,
          stopUrl:
            deps.appUrl && !isAuthor
              ? `${deps.appUrl}/?stopagent=${encodeURIComponent(agent.id)}`
              : null,
          filtered: theirOrgs.length < orgs.length,
        });
        let copyKey: string | null = null;
        if (deps.bucket) {
          copyKey = `agents/${agent.id}/${runId}/${person.id}.json`;
          await deps.bucket.put(
            copyKey,
            JSON.stringify({
              to: person.email,
              subject: built.subject,
              text: built.text,
              html: built.html,
              csv: built.csv,
              sentAt: now.toISOString(),
            }),
            {
              httpMetadata: { contentType: "application/json" },
            },
          );
        }
        const result = await send(deps.email.apiKey, {
          from: deps.email.from,
          to: person.email,
          subject: built.subject,
          text: built.text,
          html: built.html,
          attachments: [
            { filename: built.filename, content: bytesToBase64(built.csv) },
          ],
        });
        if (result.ok) {
          await record(person.id, "email", "sent", table.rows.length, {
            messageId: result.messageId,
            copyKey,
            totals: table.totals,
            summary: summary.status,
            id: deliveryId,
            invoiceIds,
          });
          await markSent();
          sent += 1;
        } else {
          await record(person.id, "email", "failed", table.rows.length, {
            copyKey,
            error: result.error.slice(0, 300),
            summary: summary.status,
          });
          failed += 1;
          firstError = firstError ?? result.error.slice(0, 300);
        }
      }
    }

    // Decision 0631: what it also prepares, from the author's own copy.
    if (agent.action) await prepareActions(db, agent, authorTable, runId, now);
    const shown = authorTable ?? anyTable;
    if (sent === 0 && failed === 0) {
      await finish("nothing", 0, [], null);
      // Decision 0630: an event agent looks every hour; an hour with nothing new leaves no run behind.
      if (report.event)
        await db
          .prepare("DELETE FROM agent_runs WHERE id = ?")
          .bind(runId)
          .run();
      return { runId, status: "nothing", deliveries: 0 };
    }
    if (sent === 0) {
      await finish(
        "failed",
        shown?.rows.length ?? null,
        shown?.totals ?? null,
        firstError,
      );
      return {
        runId,
        status: "failed",
        error: firstError ?? "failed",
        deliveries: 0,
      };
    }
    await finish(
      "delivered",
      shown?.rows.length ?? null,
      shown?.totals ?? null,
      failed > 0 ? firstError : null,
    );
    return { runId, status: "delivered", deliveries: sent };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finish("failed", null, null, message.slice(0, 500));
    return { runId, status: "failed", error: message };
  }
}

/**
 * **Kept 13 months — decision 0623.** Older deliveries (and the copies they
 * point to in R2), notes and runs are removed, a few at a time, on the
 * five-minute tick.
 */
export async function purgeOldAgentRecords(
  db: D1Database,
  bucket: R2Bucket | null,
  now = new Date(),
): Promise<{ runs: number }> {
  const before = new Date(now.getTime() - KEEP_DAYS * 86_400_000).toISOString();
  // Decision 0630: what an event agent sent each person, kept as long as the runs.
  await db
    .prepare(
      "DELETE FROM agent_seen WHERE rowid IN (SELECT rowid FROM agent_seen WHERE sent_at < ? LIMIT ?)",
    )
    .bind(before, PURGE_PER_TICK)
    .run();
  const old = await db
    .prepare("SELECT id FROM agent_runs WHERE started_at < ? LIMIT ?")
    .bind(before, PURGE_PER_TICK)
    .all<{ id: string }>();
  if (old.results.length === 0) return { runs: 0 };
  const ids = old.results.map((r) => r.id);
  const marks = ids.map(() => "?").join(", ");
  if (bucket) {
    const copies = await db
      .prepare(
        `SELECT copy_key FROM agent_deliveries WHERE run_id IN (${marks}) AND copy_key IS NOT NULL`,
      )
      .bind(...ids)
      .all<{ copy_key: string }>();
    if (copies.results.length > 0)
      await bucket.delete(copies.results.map((c) => c.copy_key));
  }
  // Decision 0631: a prepared action outlives its run.
  await db
    .prepare(
      `UPDATE agent_actions SET run_id = NULL WHERE run_id IN (${marks})`,
    )
    .bind(...ids)
    .run();
  await db
    .prepare(`DELETE FROM agent_deliveries WHERE run_id IN (${marks})`)
    .bind(...ids)
    .run();
  await db
    .prepare(`DELETE FROM agent_notes WHERE run_id IN (${marks})`)
    .bind(...ids)
    .run();
  await db
    .prepare(`DELETE FROM agent_runs WHERE id IN (${marks})`)
    .bind(...ids)
    .run();
  return { runs: ids.length };
}

/** `POST /agents/:id/run` — Run now: once, to the author only, paused or not. The schedule is untouched. */
export async function handleRunAgentNow(
  db: D1Database,
  userId: string,
  id: string,
  now = new Date(),
  deps: AgentDeps = NO_DEPS,
): Promise<RouteResult> {
  const row = await loadAgent(db, id);
  if (!row)
    return {
      status: 404,
      body: { error: `agent ${id} does not exist`, reason: "not_found" },
    };
  if (row.author_id !== userId)
    return {
      status: 403,
      body: { error: "only its author can run an agent", reason: "not_author" },
    };
  const result = await runAgent(db, row, "now", now, null, deps);
  return { status: 200, body: result };
}

/**
 * The cron's part, every five minutes: each active agent whose time has
 * come is **claimed** by moving `next_run_at` on to its next time in one
 * conditional UPDATE. Only the claim that changes the row runs it, so an
 * overlapping tick cannot run it twice; a run missed while nothing ran
 * happens once, late, because the next time is worked out from now.
 */
export async function runDueAgents(
  db: D1Database,
  now = new Date(),
  deps: AgentDeps = NO_DEPS,
): Promise<{ ran: number }> {
  await purgeOldAgentRecords(db, deps.bucket, now);
  // Decision 0631: prepared actions nobody approved in time lapse.
  await expireAgentActions(db, now);
  const due = await db
    .prepare(
      "SELECT * FROM agents WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at LIMIT ?",
    )
    .bind(now.toISOString(), AGENTS_PER_TICK)
    .all<AgentRow>();
  if (due.results.length === 0) return { ran: 0 };
  const zone = await agentTimeZone(db);
  let ran = 0;
  for (const agent of due.results) {
    const schedule = parseSchedule(agent.schedule_json);
    const next = schedule ? nextRunAfter(schedule, zone, now) : null;
    const claim = next
      ? await db
          .prepare(
            "UPDATE agents SET next_run_at = ?, last_run_at = ? WHERE id = ? AND status = 'active' AND next_run_at = ?",
          )
          .bind(next, now.toISOString(), agent.id, agent.next_run_at)
          .run()
      : await db
          .prepare(
            "UPDATE agents SET status = 'paused', paused_reason = 'finished', next_run_at = NULL, last_run_at = ? WHERE id = ? AND status = 'active' AND next_run_at = ?",
          )
          .bind(now.toISOString(), agent.id, agent.next_run_at)
          .run();
    if ((claim.meta?.changes ?? 0) !== 1) continue;
    await runAgent(db, agent, "schedule", now, agent.next_run_at, deps);
    ran += 1;
  }
  return { ran };
}

// ---------------------------------------------------------------------------
// Notes: what agents delivered to someone's task list
// ---------------------------------------------------------------------------

/** `GET /agent-notes` — the person's own notes not yet marked done, newest first. */
export async function handleListAgentNotes(
  db: D1Database,
  userId: string,
): Promise<RouteResult> {
  const rows = await db
    .prepare(
      `SELECT n.id, n.agent_id, a.name AS agent_name, a.report, n.created_at, r.late, r.row_count, r.totals_json, a.author_id,
              n.kind, CASE n.kind WHEN 'failure' THEN n.report_json END AS failure_json
       FROM agent_notes n JOIN agents a ON a.id = n.agent_id JOIN agent_runs r ON r.id = n.run_id
       WHERE n.user_id = ? AND n.done_at IS NULL ORDER BY n.created_at DESC LIMIT 50`,
    )
    .bind(userId)
    .all<{
      id: string;
      agent_id: string;
      agent_name: string;
      report: string;
      created_at: string;
      late: number;
      row_count: number | null;
      totals_json: string | null;
      author_id: string;
      kind: string;
      failure_json: string | null;
    }>();
  return {
    status: 200,
    body: {
      notes: rows.results.map((n) => ({
        id: n.id,
        agentId: n.agent_id,
        agentName: n.agent_name,
        report: n.report,
        createdAt: n.created_at,
        late: n.late === 1,
        rowCount: n.row_count,
        totals: n.totals_json
          ? (JSON.parse(n.totals_json) as ReportTotal[])
          : [],
        // Decision 0623: anyone but its author may stop receiving it.
        canStop: n.author_id !== userId && n.kind !== "failure",
        // Decision 0627: a note about a failing agent, for its author.
        kind: n.kind ?? "report",
        failure: n.failure_json ? JSON.parse(n.failure_json) : null,
      })),
    },
  };
}

/** `GET /agent-notes/:id` — one note with its table; only its own recipient. */
export async function handleGetAgentNote(
  db: D1Database,
  userId: string,
  id: string,
): Promise<RouteResult> {
  const n = await db
    .prepare(
      `SELECT n.id, n.agent_id, a.name AS agent_name, n.user_id, n.report_json, n.created_at, n.done_at, r.late
       FROM agent_notes n JOIN agents a ON a.id = n.agent_id JOIN agent_runs r ON r.id = n.run_id WHERE n.id = ?`,
    )
    .bind(id)
    .first<{
      id: string;
      agent_id: string;
      agent_name: string;
      user_id: string;
      report_json: string;
      created_at: string;
      done_at: string | null;
      late: number;
    }>();
  if (!n || n.user_id !== userId)
    return {
      status: 404,
      body: { error: `note ${id} does not exist`, reason: "not_found" },
    };
  return {
    status: 200,
    body: {
      id: n.id,
      agentId: n.agent_id,
      agentName: n.agent_name,
      createdAt: n.created_at,
      doneAt: n.done_at,
      late: n.late === 1,
      table: JSON.parse(n.report_json) as ReportTable,
    },
  };
}

/** `POST /agent-notes/:id/done` — off the task list. */
export async function handleAgentNoteDone(
  db: D1Database,
  userId: string,
  id: string,
  now = new Date(),
): Promise<RouteResult> {
  const result = await db
    .prepare(
      "UPDATE agent_notes SET done_at = ? WHERE id = ? AND user_id = ? AND done_at IS NULL",
    )
    .bind(now.toISOString(), id, userId)
    .run();
  if ((result.meta?.changes ?? 0) !== 1)
    return {
      status: 404,
      body: { error: `note ${id} does not exist`, reason: "not_found" },
    };
  return { status: 200, body: { id, done: true } };
}

/**
 * `POST /agents/:id/stop` — "Stop sending me this", from a note or the
 * link in an email (decision 0623). Its author pauses or removes it instead.
 */
export async function handleStopAgent(
  db: D1Database,
  userId: string,
  id: string,
  now = new Date(),
): Promise<RouteResult> {
  const agent = await db
    .prepare("SELECT id, name, author_id FROM agents WHERE id = ?")
    .bind(id)
    .first<{ id: string; name: string; author_id: string }>();
  if (!agent)
    return {
      status: 404,
      body: { error: `agent ${id} does not exist`, reason: "not_found" },
    };
  if (agent.author_id === userId)
    return {
      status: 422,
      body: {
        error: "you made this agent: pause or remove it instead",
        reason: "author_cannot_stop",
      },
    };
  const before = await db
    .prepare(
      "SELECT opted_out_at FROM agent_recipients WHERE agent_id = ? AND user_id = ?",
    )
    .bind(id, userId)
    .first<{ opted_out_at: string | null }>();
  const result = await db
    .prepare(
      "UPDATE agent_recipients SET opted_out_at = COALESCE(opted_out_at, ?) WHERE agent_id = ? AND user_id = ?",
    )
    .bind(now.toISOString(), id, userId)
    .run();
  if ((result.meta?.changes ?? 0) !== 1)
    return {
      status: 404,
      body: { error: "you do not receive this agent", reason: "not_recipient" },
    };
  if (before && before.opted_out_at === null)
    await logEvent(db, id, userId, "stopped_receiving", {}, now);
  return { status: 200, body: { id, name: agent.name, stopped: true } };
}

// ---------------------------------------------------------------------------
// The agent's own page and the agent log — decision 0627
// ---------------------------------------------------------------------------

interface EventRow {
  id: string;
  agent_id: string;
  agent_name: string;
  at: string;
  user_id: string | null;
  user_name: string | null;
  kind: AgentEventKind;
  detail_json: string;
}

function eventBody(e: EventRow) {
  return {
    id: e.id,
    agentId: e.agent_id,
    agentName: e.agent_name,
    at: e.at,
    by: e.user_id ? { id: e.user_id, name: e.user_name ?? e.user_id } : null,
    kind: e.kind,
    detail: JSON.parse(e.detail_json || "{}") as Record<string, unknown>,
  };
}

const EVENT_SELECT = `SELECT e.id, e.agent_id, a.name AS agent_name, e.at, e.user_id, COALESCE(u.name, u.email, e.user_id) AS user_name, e.kind, e.detail_json
  FROM agent_events e JOIN agents a ON a.id = e.agent_id LEFT JOIN org_users u ON u.id = e.user_id`;

/**
 * `GET /agents/:id` — the agent's own page: the agent, every version of
 * its plan (with the names it named), who gets it and who stopped it, and
 * what was changed. For its author or an administrator, as its runs are.
 */
export async function handleGetAgent(
  db: D1Database,
  userId: string,
  id: string,
): Promise<RouteResult> {
  // A removed agent's page stays readable: its history is the point.
  const row = await db
    .prepare("SELECT * FROM agents WHERE id = ?")
    .bind(id)
    .first<AgentRow>();
  if (!row)
    return {
      status: 404,
      body: { error: `agent ${id} does not exist`, reason: "not_found" },
    };
  if (
    row.author_id !== userId &&
    !(await hasPermission(db, userId, "Admin.UserManagement"))
  )
    return {
      status: 403,
      body: {
        error: "only its author or an administrator can see this agent",
        reason: "not_author",
      },
    };
  const versions = await db
    .prepare(
      `SELECT v.version, v.description, v.plan_json, v.created_at, COALESCE(u.name, u.email, v.created_by) AS created_by
       FROM agent_plan_versions v LEFT JOIN org_users u ON u.id = v.created_by WHERE v.agent_id = ? ORDER BY v.version DESC`,
    )
    .bind(id)
    .all<{
      version: number;
      description: string | null;
      plan_json: string;
      created_at: string;
      created_by: string;
    }>();
  const names = async (table: "org_units" | "org_users", ids: string[]) => {
    if (ids.length === 0) return new Map<string, string>();
    const col = table === "org_units" ? "name" : "COALESCE(name, email, id)";
    const found = await db
      .prepare(
        `SELECT id, ${col} AS name FROM ${table} WHERE id IN (${ids.map(() => "?").join(", ")})`,
      )
      .bind(...ids)
      .all<{ id: string; name: string }>();
    return new Map(found.results.map((r) => [r.id, r.name]));
  };
  const plans = versions.results.map((v) => ({
    ...v,
    plan: JSON.parse(v.plan_json) as {
      orgIds?: string[];
      recipients?: string[];
    } & Record<string, unknown>,
  }));
  const orgNames = await names("org_units", [
    ...new Set(plans.flatMap((p) => p.plan.orgIds ?? [])),
  ]);
  const peopleNames = await names("org_users", [
    ...new Set(plans.flatMap((p) => p.plan.recipients ?? [])),
  ]);
  const recipients = await db
    .prepare(
      `SELECT u.id, COALESCE(u.name, u.email, u.id) AS name, r.added_at, r.opted_out_at FROM agent_recipients r
       JOIN org_users u ON u.id = r.user_id WHERE r.agent_id = ? ORDER BY r.added_at, name`,
    )
    .bind(id)
    .all<{
      id: string;
      name: string;
      added_at: string;
      opted_out_at: string | null;
    }>();
  const events = await db
    .prepare(
      `${EVENT_SELECT} WHERE e.agent_id = ? ORDER BY e.at DESC, e.rowid DESC LIMIT 200`,
    )
    .bind(id)
    .all<EventRow>();
  return {
    status: 200,
    body: {
      agent: (await toBody(db, [row]))[0],
      versions: plans.map((p) => ({
        version: p.version,
        description: p.description,
        createdAt: p.created_at,
        createdBy: p.created_by,
        plan: {
          ...p.plan,
          orgs: (p.plan.orgIds ?? []).map((o) => ({
            id: o,
            name: orgNames.get(o) ?? o,
          })),
          people: (p.plan.recipients ?? []).map((u) => ({
            id: u,
            name: peopleNames.get(u) ?? u,
          })),
        },
      })),
      recipients: recipients.results.map((r) => ({
        id: r.id,
        name: r.name,
        author: r.id === row.author_id,
        addedAt: r.added_at,
        optedOutAt: r.opted_out_at,
      })),
      events: events.results.map(eventBody),
      // Decision 0631: what it prepared, and what became of each.
      actions: await actionsOfAgent(db, id),
    },
  };
}

/** `GET /agent-events` — the agent log: every agent's changes, latest first, for an administrator. */
export async function handleListAgentEvents(
  db: D1Database,
  userId: string,
): Promise<RouteResult> {
  if (!(await hasPermission(db, userId, "Admin.UserManagement")))
    return {
      status: 403,
      body: {
        error: "the agent log is for administrators",
        reason: "not_permitted",
      },
    };
  const events = await db
    .prepare(`${EVENT_SELECT} ORDER BY e.at DESC, e.rowid DESC LIMIT 200`)
    .all<EventRow>();
  return { status: 200, body: { events: events.results.map(eventBody) } };
}

// ---------------------------------------------------------------------------
// Open in Documents — decision 0629
// ---------------------------------------------------------------------------

/** The invoices behind one row of a report: its `_ids`, or its one `invoiceId`. */
export function rowInvoiceIds(row: Record<string, unknown>): string[] {
  if (typeof row._ids === "string" && row._ids)
    return row._ids.split(",").filter(Boolean);
  if (typeof row.invoiceId === "string" && row.invoiceId)
    return [row.invoiceId];
  return [];
}

/** Every invoice behind a report, once each. */
export function tableInvoiceIds(table: {
  rows: Record<string, unknown>[];
}): string[] {
  return [...new Set(table.rows.flatMap(rowInvoiceIds))];
}

const AGENT_DOCUMENTS_MAX = 5000;

/**
 * **Documents at an agent's report — decision 0629.** `agentNote` (with
 * `agentRow` for one row) or `agentDelivery` (an email copy) name what a
 * person was sent; the invoices behind it are looked up here, and only
 * for that person: anyone else's gets none. Documents still applies the
 * reader's own access on top. Null where neither was asked for.
 */
export async function agentDocumentIds(
  db: D1Database,
  params: URLSearchParams,
  userId: string | null,
): Promise<{ ids: string[]; name: string | null } | null> {
  const noteId = params.get("agentNote");
  const deliveryId = params.get("agentDelivery");
  if (!noteId && !deliveryId) return null;
  if (noteId) {
    const n = await db
      .prepare(
        "SELECT n.user_id, n.report_json, n.kind, a.name FROM agent_notes n JOIN agents a ON a.id = n.agent_id WHERE n.id = ?",
      )
      .bind(noteId)
      .first<{
        user_id: string;
        report_json: string;
        kind: string;
        name: string;
      }>();
    if (!n || n.user_id !== userId || n.kind === "failure")
      return { ids: [], name: n && n.user_id === userId ? n.name : null };
    const table = JSON.parse(n.report_json) as {
      rows: Record<string, unknown>[];
    };
    const rowRaw = params.get("agentRow");
    const row = rowRaw !== null && /^\d+$/.test(rowRaw) ? Number(rowRaw) : null;
    const ids =
      row === null
        ? tableInvoiceIds(table)
        : table.rows[row]
          ? rowInvoiceIds(table.rows[row])
          : [];
    return { ids: ids.slice(0, AGENT_DOCUMENTS_MAX), name: n.name };
  }
  const d = await db
    .prepare(
      "SELECT d.user_id, d.invoice_ids_json, a.name FROM agent_deliveries d JOIN agents a ON a.id = d.agent_id WHERE d.id = ?",
    )
    .bind(deliveryId)
    .first<{
      user_id: string;
      invoice_ids_json: string | null;
      name: string;
    }>();
  if (!d || d.user_id !== userId) return { ids: [], name: null };
  const ids = d.invoice_ids_json
    ? (JSON.parse(d.invoice_ids_json) as string[])
    : [];
  return { ids: ids.slice(0, AGENT_DOCUMENTS_MAX), name: d.name };
}

/**
 * `PUT /agent-settings` (Admin.Configure): the time zone (decision 0622)
 * and, decision 0631, whether prepared actions are on in this environment.
 */
export async function handleSetAgentSettings(
  db: D1Database,
  input: Record<string, unknown>,
  now = new Date(),
): Promise<RouteResult> {
  if (input.timeZone !== undefined) {
    const r = await handleSetAgentTimeZone(db, input, now);
    if (r.status !== 200) return r;
  }
  if (input.actionsEnabled !== undefined) {
    if (typeof input.actionsEnabled !== "boolean")
      return {
        status: 422,
        body: {
          error: "actionsEnabled must be true or false",
          reason: "actions_invalid",
        },
      };
    await db
      .prepare(
        "UPDATE org_settings SET agent_actions = ?, updated_at = datetime('now') WHERE id = 1",
      )
      .bind(input.actionsEnabled ? 1 : 0)
      .run();
  }
  return {
    status: 200,
    body: {
      timeZone: await agentTimeZone(db),
      actionsEnabled: await actionsEnabled(db),
    },
  };
}
