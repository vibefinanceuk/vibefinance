import type { CompilerModel } from "@vibefinance/shared";
import { extractJson } from "@vibefinance/shared";
import type { RouteResult } from "./org-route.js";
import { unitsFor, unitsWherePermitted } from "./enforce.js";
import { checkSchedule, type AgentSchedule } from "./agent-schedule.js";
import {
  AGENT_REPORTS,
  agentTimeZone,
  checkOptions,
  type AgentOptions,
} from "./agents.js";

/**
 * **Plain words in, a plan out — decision 0625**, Agents slice 4.
 *
 * An AP Manager writes what they want: *"Every Monday at 8am send me and
 * Priya the outstanding payables over £1,000 for UK Ltd, by email."* The
 * model is given a closed list of what an agent can be (the reports,
 * their options, the schedule shapes, the organisations and AP Managers
 * this person can choose) and answers in JSON. **Our code then checks
 * every part** against those same lists, exactly as the form is checked,
 * and returns a draft for the form with what it could not use, in words.
 * Nothing is saved here: the person reads the plan, adjusts it in *Edit
 * steps* if they like, and saves.
 *
 * The same pattern as the rule compiler and the AP Expert: the model
 * picks from a closed vocabulary, refusal is a first-class answer, and
 * the deciding is ours. Two things are refused here whatever the model
 * says: an email address (agents go only to people in VibeFinance), and
 * anything that would pay, approve or change an invoice.
 */

export const DESCRIPTION_MAX = 600;

const REPORT_WORDS: Record<string, string> = {
  outstanding_payables:
    "Outstanding payables: payment-eligible invoices not yet sent to the ERP, by supplier, aged by days past due. Options: minTotal (only suppliers owing at least this amount), highlightDays (highlight when the oldest is more than this many days past due).",
  due_soon_not_eligible:
    "Due soon, not yet payment-eligible: invoices still being processed whose due date is within the next days. Option: withinDays (1-90).",
  stuck_work:
    "Stuck work: tasks open longer than a number of days, by stage and person. Option: olderThanDays (1-365).",
  overdue_not_eligible:
    "Past due, not yet payment-eligible: invoices past their due date still being processed, by supplier.",
  accruals:
    "Accruals by stage: invoices received and not yet payment-eligible, by the stage they are at (month-end accruals).",
  open_tasks:
    "Open tasks by person: how many open tasks each person has, and how many wait unclaimed (team workload).",
  possible_duplicates:
    "Possible duplicates: invoices that look like another already received (fraud watch).",
  // Decision 0632.
  returned_no_reply:
    "Returned to the supplier with no corrected invoice yet, returned more than a number of days ago. Option: waitDays (1-90, default 7).",
  // Decision 0630: started by an event.
  event_stuck:
    "EVENT, when an invoice has been at one stage longer than a number of days (stuck invoices). Option: stageDays (1-90, default 3).",
  event_duplicate:
    "EVENT, when a new invoice looks like a duplicate of another.",
  event_unapproved_supplier:
    "EVENT, when an invoice arrives from a supplier not on file, or on hold.",
  event_file_failed:
    "EVENT, when a supplier's file could not be read (a failed or partly read file in the Route monitor).",
};

export type RefusalCode =
  | "outside_address"
  | "cannot_act"
  | "too_often"
  | "unknown_report"
  | "unknown_org"
  | "unknown_person"
  | "option_out_of_range"
  | "other";

export interface Refusal {
  code: RefusalCode;
  /** The words of the request it is about, as written. */
  words: string;
}

export interface UnderstoodDraft {
  name: string;
  report: string | null;
  orgIds: string[];
  schedule: AgentSchedule | null;
  options: AgentOptions;
  deliver: { task: boolean; email: boolean };
  recipients: string[];
  /** Decision 0626: the AI summary; on unless the words turn it off. */
  summary: boolean;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ACT_RE =
  /\b(pay|pays|paying|approve|approves|approving|release|reject|delete|discard|zahl\w*|genehmig\w*|freigeb\w*)\b/i;

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Finds the one entry a name means: exactly, else by its first word, else by containing it; null where none or several. */
export function matchName<T extends { name: string }>(
  said: string,
  among: T[],
): T | null {
  const s = norm(said);
  if (!s) return null;
  const exact = among.filter((x) => norm(x.name) === s);
  if (exact.length === 1) return exact[0];
  const first = among.filter((x) => norm(x.name).split(" ")[0] === s);
  if (first.length === 1) return first[0];
  const contains = among.filter(
    (x) => norm(x.name).includes(s) || s.includes(norm(x.name)),
  );
  return contains.length === 1 ? contains[0] : null;
}

function promptFor(
  text: string,
  ctx: {
    today: string;
    weekday: string;
    zone: string;
    orgs: string[];
    managers: string[];
    me: string;
  },
): string {
  return `You set up a scheduled report ("agent") in an accounts payable system from a manager's request.
Answer with ONE JSON object and nothing else, of this shape:
{"name": short title, "report": one report id or null, "orgs": ["organisation name", ...] or "all", "schedule": schedule or null, "options": {...}, "deliver": {"task": true|false, "email": true|false}, "recipients": ["person name", ...], "summary": true|false, "refusals": [{"code": code, "words": "the words of the request it is about"}]}

Reports (use the id):
${AGENT_REPORTS.map((r) => `- ${r.id}: ${REPORT_WORDS[r.id] ?? r.id}`).join("\n")}

Schedules (times are HH:MM, 24-hour, in ${ctx.zone}):
- {"every":"day","time":"08:00"}
- {"every":"workday","time":"08:00"} (Monday to Friday)
- {"every":"week","time":"08:00","weekday":1} (1 Monday ... 7 Sunday)
- {"every":"month","time":"16:00","day":15} (day 1-28, or "last", or "lastWorking")
- {"every":"once","time":"10:00","date":"YYYY-MM-DD"}
Nothing runs more often than daily, except EVENT reports: they are looked at every hour by themselves and send only what is new, so for them use "schedule": null and do not refuse "as soon as" or "whenever". Today is ${ctx.weekday} ${ctx.today}.

Organisations this person can choose: ${ctx.orgs.map((o) => JSON.stringify(o)).join(", ") || "none"}.
People it may also go to (AP Managers): ${ctx.managers.map((m) => JSON.stringify(m)).join(", ") || "none"}. The person asking is ${JSON.stringify(ctx.me)}; "me" means them and is not a recipient.
"deliver": "task" puts it on their task list, "email" emails it. If neither is said, use {"task": true, "email": false}.
If no organisation is named, use "all".
"summary": a few sentences written by AI on top of the report. true unless the request says no summary (or only the table).

Refusal codes, for any part you cannot express:
- "outside_address": an email address or anyone outside the lists above
- "cannot_act": paying, approving, releasing, rejecting or changing invoices (agents only report)
- "too_often": more often than daily (hourly, every few minutes)
- "unknown_report": a report not in the list
- "unknown_org", "unknown_person": a name not in the lists
- "other": anything else that cannot be done
Never invent ids, organisations or people. Leave out what you refuse.

Request: ${JSON.stringify(text)}`;
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * `POST /agents/understand` — `{ text }` → `{ draft, refusals, missing }`.
 * `missing` names what the plan still needs before it can be saved:
 * `report`, `orgs`, `schedule`.
 */
export async function handleUnderstandAgent(
  db: D1Database,
  model: CompilerModel,
  userId: string,
  input: Record<string, unknown>,
  now = new Date(),
): Promise<RouteResult> {
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (text.length < 3)
    return {
      status: 422,
      body: { error: "say what the agent should do", reason: "text_missing" },
    };
  if (text.length > DESCRIPTION_MAX)
    return {
      status: 422,
      body: {
        error: `at most ${DESCRIPTION_MAX} characters`,
        reason: "text_too_long",
      },
    };

  const me = await db
    .prepare(
      "SELECT COALESCE(name, email, id) AS name FROM org_users WHERE id = ?",
    )
    .bind(userId)
    .first<{ name: string }>();
  const { units } = await unitsFor(db, userId);
  const allowedByReport = new Map<string, Set<string>>();
  for (const r of AGENT_REPORTS) {
    const visible = await unitsWherePermitted(db, userId, r.permission);
    allowedByReport.set(
      r.id,
      new Set(
        units
          .filter((u) => visible === null || visible.includes(u.id))
          .map((u) => u.id),
      ),
    );
  }
  const choosable = units.filter((u) =>
    [...allowedByReport.values()].some((s) => s.has(u.id)),
  );
  const managers = (
    await db
      .prepare(
        `SELECT DISTINCT u.id, COALESCE(u.name, u.email, u.id) AS name FROM org_users u
         JOIN org_user_roles ur ON ur.user_id = u.id JOIN org_roles r ON r.id = ur.role_id
         WHERE r.permissions_json LIKE '%"AP.Manager"%' AND u.id <> ? ORDER BY name`,
      )
      .bind(userId)
      .all<{ id: string; name: string }>()
  ).results;
  const zone = await agentTimeZone(db);
  const localDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const weekday = WEEKDAYS[new Date(`${localDay}T12:00:00Z`).getUTCDay()];

  let raw: string;
  try {
    raw = await model.compile(
      promptFor(text, {
        today: localDay,
        weekday,
        zone,
        orgs: choosable.map((u) => u.name),
        managers: managers.map((m) => m.name),
        me: me?.name ?? "me",
      }),
    );
  } catch {
    return {
      status: 503,
      body: {
        error: "the AI could not be reached just now",
        reason: "ai_unavailable",
      },
    };
  }
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      status: 422,
      body: {
        error: "that could not be understood; try saying it another way",
        reason: "not_understood",
      },
    };
  }
  const p = parsed as Record<string, unknown>;
  const refusals: Refusal[] = [];
  const codes = new Set<RefusalCode>([
    "outside_address",
    "cannot_act",
    "too_often",
    "unknown_report",
    "unknown_org",
    "unknown_person",
    "option_out_of_range",
    "other",
  ]);
  for (const r of Array.isArray(p.refusals) ? p.refusals : []) {
    const code = (r as Record<string, unknown>)?.code;
    const words = (r as Record<string, unknown>)?.words;
    if (typeof code === "string" && codes.has(code as RefusalCode))
      refusals.push({
        code: code as RefusalCode,
        words: typeof words === "string" ? words.slice(0, 200) : "",
      });
  }
  // Ours, whatever the model said.
  for (const address of text.match(EMAIL_RE) ?? []) {
    if (
      !refusals.some(
        (r) => r.code === "outside_address" && r.words.includes(address),
      )
    )
      refusals.push({ code: "outside_address", words: address });
  }
  const act = text.match(ACT_RE);
  if (act && !refusals.some((r) => r.code === "cannot_act"))
    refusals.push({ code: "cannot_act", words: act[0] });

  const reportId =
    typeof p.report === "string" && AGENT_REPORTS.some((r) => r.id === p.report)
      ? p.report
      : null;
  if (typeof p.report === "string" && p.report && !reportId)
    refusals.push({ code: "unknown_report", words: p.report.slice(0, 80) });
  const allowed = reportId
    ? allowedByReport.get(reportId)!
    : new Set(choosable.map((u) => u.id));

  let orgIds: string[] = [];
  if (
    p.orgs === "all" ||
    p.orgs === undefined ||
    p.orgs === null ||
    (Array.isArray(p.orgs) && p.orgs.length === 0)
  ) {
    orgIds = choosable.filter((u) => allowed.has(u.id)).map((u) => u.id);
  } else if (Array.isArray(p.orgs)) {
    for (const said of p.orgs) {
      if (typeof said !== "string") continue;
      const found = matchName(said, choosable);
      if (found && allowed.has(found.id)) orgIds.push(found.id);
      else refusals.push({ code: "unknown_org", words: said.slice(0, 80) });
    }
    orgIds = [...new Set(orgIds)];
  }

  const recipients: string[] = [];
  for (const said of Array.isArray(p.recipients) ? p.recipients : []) {
    if (typeof said !== "string") continue;
    if (/^(me|myself|mich|mir)$/i.test(said.trim())) continue;
    if (said.includes("@")) continue;
    const found = matchName(said, managers);
    if (found) recipients.push(found.id);
    else if (!(me && matchName(said, [{ name: me.name }])))
      refusals.push({ code: "unknown_person", words: said.slice(0, 80) });
  }

  // Decision 0630: an event report looks every hour by itself, whatever was said about when.
  const isEvent = Boolean(
    reportId && AGENT_REPORTS.find((r) => r.id === reportId)?.event,
  );
  if (isEvent) {
    for (let i = refusals.length - 1; i >= 0; i--)
      if (refusals[i].code === "too_often") refusals.splice(i, 1);
  }
  const scheduleChecked = isEvent
    ? { schedule: { every: "hour" as const } }
    : checkSchedule(p.schedule);
  const schedule =
    "schedule" in scheduleChecked ? scheduleChecked.schedule : null;

  let options: AgentOptions = {};
  if (reportId) {
    const checked = checkOptions(reportId, p.options);
    if ("options" in checked) options = checked.options;
    else {
      refusals.push({
        code: "option_out_of_range",
        words: checked.reason.replace("option_invalid_", ""),
      });
      options = (checkOptions(reportId, {}) as { options: AgentOptions })
        .options;
    }
  }

  const d = (
    p.deliver && typeof p.deliver === "object" ? p.deliver : {}
  ) as Record<string, unknown>;
  let deliver = { task: d.task === true, email: d.email === true };
  if (!deliver.task && !deliver.email) deliver = { task: true, email: false };

  const name = (
    typeof p.name === "string" && p.name.trim() ? p.name.trim() : text
  ).slice(0, 80);
  const missing = [
    ...(reportId ? [] : ["report"]),
    ...(orgIds.length ? [] : ["orgs"]),
    ...(schedule ? [] : ["schedule"]),
  ];
  const draft: UnderstoodDraft = {
    name,
    report: reportId,
    orgIds,
    schedule,
    options,
    deliver,
    recipients: [...new Set(recipients)],
    summary: p.summary !== false,
  };
  return { status: 200, body: { draft, refusals, missing, text } };
}
