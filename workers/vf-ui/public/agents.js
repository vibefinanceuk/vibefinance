import { t } from "/strings.js";
import {
  el,
  frame,
  topbar,
  setCurrentScreen,
  hasMyPermission,
} from "/tasks.js";
import { actionLink } from "/viewer.js";
import { reportTable } from "/agent-notes.js";

/**
 * **Agents — decision 0622**, slice 1, under Accounts payable.
 *
 * An agent is a report set up once, for chosen organisations, run on a
 * schedule and delivered to the author's task list. This screen lists
 * them (an administrator may also see everyone's) and makes them from a
 * form: name, report, organisations, when. Saved paused; Start, Pause,
 * Run now (to the author only), Edit, Runs, Remove. The licence's count
 * and the environment's time zone are said at the top.
 */

let data = null; // GET /agents
let showAll = false;
let editing = null; // null, "new", or an agent
let draft = null;
let problem = "";
let openRuns = new Map(); // agentId -> runs, or "loading"
let confirmRemove = null;
// Decision 0625: what plain words gave, and whether Edit steps is open.
let understood = null; // { refusals, missing }
let understanding = false;
let stepsOpen = false;
let busy = false;
// Decision 0627: the agent's own page, and the agent log.
let page = null; // { id, body, runs, runId }
let agentLog = null; // null, "loading", or events
// Decision 0628: the library of ready-made agents, open or not.
let showExamples = false;
// Decision 0636: the question tried now — null, "loading", { table, count } or { problem }.
let tried = null;

/**
 * **Ready-made agents — decision 0628 (phase 2, slice 1).** The design's
 * use cases, set up so one choice fills the form: report, options, when,
 * how delivered, the AI summary, and the words it is described in. Only
 * those whose report the person may use are offered; organisations are
 * every one they can see it for. Nothing is saved until they save it,
 * paused, as any new agent.
 */
export const EXAMPLES = [
  {
    id: "weekly_payables",
    report: "outstanding_payables",
    schedule: { every: "week", time: "08:00", weekday: 1 },
    options: { highlightDays: 60 },
    email: true,
  },
  {
    id: "due_soon",
    report: "due_soon_not_eligible",
    schedule: { every: "workday", time: "07:30" },
    options: { withinDays: 7 },
    email: false,
  },
  {
    id: "stuck_digest",
    report: "stuck_work",
    schedule: { every: "workday", time: "09:00" },
    options: { olderThanDays: 5 },
    email: false,
  },
  {
    id: "past_due",
    report: "overdue_not_eligible",
    schedule: { every: "workday", time: "08:00" },
    options: {},
    email: false,
  },
  {
    id: "month_end_accruals",
    report: "accruals",
    schedule: { every: "month", time: "16:00", day: "lastWorking" },
    options: {},
    email: true,
  },
  {
    id: "team_workload",
    report: "open_tasks",
    schedule: { every: "week", time: "15:00", weekday: 5 },
    options: {},
    email: false,
  },
  {
    id: "fraud_watch",
    report: "possible_duplicates",
    schedule: { every: "week", time: "08:00", weekday: 1 },
    options: {},
    email: true,
  },
  // Decision 0630: started by an event.
  { id: "stuck_alert", report: "event_stuck", schedule: { every: "hour" }, options: { stageDays: 3 }, email: true },
  // Decision 0632: prepares a chaser for each return with no reply, for approval.
  { id: "chase_returns", report: "returned_no_reply", schedule: { every: "workday", time: "09:00" }, options: { waitDays: 7 }, email: false, action: "chase_supplier" },
  { id: "duplicate_alert", report: "event_duplicate", schedule: { every: "hour" }, options: {}, email: true },
  { id: "failed_files", report: "event_file_failed", schedule: { every: "hour" }, options: {}, email: true },
];

function examplesOffered() {
  const offered = new Map(reportsOffered().map((r) => [r.id, r]));
  return EXAMPLES.filter((x) => offered.has(x.report));
}

function startFromExample(x) {
  const report = reportsOffered().find((r) => r.id === x.report);
  if (!report) return;
  showExamples = false;
  editing = "new";
  draft = {
    name: t(`agents.example.${x.id}.name`),
    report: report.id,
    orgIds: [...report.orgIds],
    schedule: { ...x.schedule },
    // Email where it is set up and the example sends one; the task list otherwise.
    deliver:
      x.email && data.emailReady
        ? { task: true, email: true }
        : { task: true, email: false },
    recipients: [],
    options: { ...(report.options ?? {}), ...x.options },
    description: t(`agents.example.${x.id}.words`),
    summary: true,
    // Decision 0632: what it prepares, where the report can.
    action: x.action && (report.actions ?? []).includes(x.action) ? x.action : null,
  };
  understood = { refusals: [], missing: [] };
  stepsOpen = false;
  problem = "";
  render();
}

function examplesPanel() {
  const offered = examplesOffered();
  return el("div", { class: "panel", id: "agents-examples" }, [
    el("div", { class: "agenthead" }, [
      el("div", {}, [
        el("h3", { text: t("agents.examples.heading") }),
        el("p", { class: "muted sm", text: t("agents.examples.sub") }),
      ]),
      el("div", { class: "dobuttons" }, [
        actionLink("close", {
          label: t("agents.cancel"),
          onclick: () => {
            showExamples = false;
            render();
          },
        }),
      ]),
    ]),
    offered.length === 0
      ? el("p", { class: "muted sm", text: t("agents.examples.none") })
      : el(
          "div",
          { class: "agentexamples" },
          offered.map((x) =>
            el("div", { class: "agentexample", "data-example": x.id }, [
              el("div", { class: "agentexamplehead" }, [
                el("b", { text: t(`agents.example.${x.id}.name`) }),
                actionLink("addcard", {
                  primary: true,
                  label: t("agents.examples.use"),
                  onclick: () => startFromExample(x),
                }),
              ]),
              el("p", { class: "sm", text: t(`agents.example.${x.id}.words`) }),
              el("p", {
                class: "muted sm",
                text: `${reportName(x.report)} · ${scheduleWords(x.schedule)}`,
              }),
            ]),
          ),
        ),
  ]);
}

async function call(path, init) {
  try {
    const response = await fetch(path, init);
    return {
      ok: response.ok,
      status: response.status,
      body: await response.json().catch(() => null),
    };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}
const json = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** A refusal in words: the reason's own string where there is one, else what the server said. */
function why(body) {
  const key = body?.reason ? `agents.error.${body.reason}` : null;
  const words = key ? t(key) : null;
  if (words && words !== key)
    return body.reason === "limit_reached"
      ? words.replace("{n}", String(body.max ?? ""))
      : words;
  return body?.error ?? t("agents.failed");
}

function zone() {
  return data?.timeZone ?? "Europe/London";
}

/** A moment, in the environment's own time zone. */
export function when(iso, timeZone = zone()) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString([], {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A schedule in words: "Every Monday at 08:00". */
export function scheduleWords(s) {
  if (!s) return "—";
  const at = (key) => t(key).replace("{time}", s.time);
  switch (s.every) {
    case "day":
      return at("agents.when.day");
    case "workday":
      return at("agents.when.workday");
    case "week":
      return at("agents.when.week").replace(
        "{weekday}",
        t(`agents.weekday.${s.weekday}`),
      );
    case "month":
      if (s.day === "last") return at("agents.when.monthlast");
      if (s.day === "lastWorking") return at("agents.when.monthlastworking");
      return at("agents.when.month").replace("{day}", String(s.day));
    case "once":
      return at("agents.when.once").replace("{date}", s.date);
    case "hour":
      return t("agents.when.hour");
    default:
      return "—";
  }
}

async function load() {
  const r = await call(`/api/agents${showAll ? "?all=1" : ""}`);
  if (!r.ok) return false;
  data = r.body;
  return true;
}

function reportName(id) {
  return t(`agents.report.${id}`);
}

function statusPill(agent) {
  if (agent.status === "removed")
    return el("span", {
      class: "rmpill bad",
      text: t("agents.status.removed"),
    });
  if (agent.status === "active")
    return el("span", { class: "rmpill ok", text: t("agents.status.active") });
  const reason = agent.pausedReason
    ? t(`agents.paused.${agent.pausedReason}`)
    : null;
  return el("span", {
    class: "rmpill q",
    title: reason ?? "",
    text: reason ?? t("agents.status.paused"),
  });
}

function lastRunCell(agent) {
  const run = agent.lastRun;
  if (!run) return el("td", { class: "muted sm", text: t("agents.neverrun") });
  const cls =
    run.status === "delivered" ? "ok" : run.status === "failed" ? "bad" : "q";
  return el("td", {}, [
    el("span", { class: `rmpill ${cls}`, text: t(`agents.run.${run.status}`) }),
    el("div", {
      class: "muted sm",
      text: `${when(run.startedAt)}${run.late ? ` · ${t("agents.late")}` : ""}`,
    }),
    ...(run.status === "failed" && run.error
      ? [
          el("div", {
            class: "muted sm",
            text: words("agents.runerror", run.error),
          }),
        ]
      : []),
  ]);
}

/** Decision 0623: "Dan by email, Maya on the task list; Pat by email failed". */
function deliveriesWords(list) {
  return (list ?? [])
    .map(
      (d) =>
        `${d.userName} ${t(`agents.channel.${d.channel}`)}${d.status === "failed" ? ` (${t("agents.run.failed")}${d.error ? `: ${words("agents.runerror", d.error)}` : ""})` : ""}`,
    )
    .join(", ");
}

/**
 * Decision 0626: what became of the summaries in a run, once per kind:
 * "summary written", "no summary: a number did not match the table".
 */
export function summaryWords(list) {
  const kinds = [
    ...new Set(
      (list ?? []).map((d) => d.summary).filter((k) => k && k !== "off"),
    ),
  ];
  return kinds.map((k) => t(`agents.summary.run.${k}`)).join(" · ");
}

function words(prefix, code) {
  const key = `${prefix}.${code}`;
  const w = t(key);
  return w === key ? code : w;
}

async function act(fn) {
  if (busy) return;
  busy = true;
  problem = "";
  try {
    await fn();
    await load();
  } finally {
    busy = false;
  }
  render();
}

function runsRow(agent) {
  const runs = openRuns.get(agent.id);
  if (!runs) return null;
  const body =
    runs === "loading"
      ? el("p", { class: "muted sm", text: t("agents.loading") })
      : runs.length === 0
        ? el("p", { class: "muted sm", text: t("agents.noruns") })
        : el("table", { class: "dotable" }, [
            el(
              "tbody",
              {},
              runs.map((r) =>
                el("tr", {}, [
                  el("td", { text: when(r.startedAt) }),
                  el("td", { text: t(`agents.trigger.${r.trigger}`) }),
                  el("td", {}, [
                    el("span", {
                      class: `rmpill ${r.status === "delivered" ? "ok" : r.status === "failed" ? "bad" : "q"}`,
                      text: t(`agents.run.${r.status}`),
                    }),
                  ]),
                  el("td", {
                    class: "muted sm",
                    text: [
                      r.late ? t("agents.late") : "",
                      r.rowCount !== null && r.rowCount !== undefined
                        ? t("agents.rows").replace("{n}", String(r.rowCount))
                        : "",
                      r.error ? words("agents.runerror", r.error) : "",
                      r.planVersion
                        ? t("agents.planv").replace(
                            "{n}",
                            String(r.planVersion),
                          )
                        : "",
                      deliveriesWords(r.deliveries),
                      summaryWords(r.deliveries),
                    ]
                      .filter(Boolean)
                      .join(" · "),
                  }),
                ]),
              ),
            ),
          ]);
  return el("tr", { class: "agentruns" }, [el("td", { colspan: "6" }, [body])]);
}

async function toggleRuns(agent) {
  if (openRuns.has(agent.id)) {
    openRuns.delete(agent.id);
    render();
    return;
  }
  openRuns.set(agent.id, "loading");
  render();
  const r = await call(`/api/agents/${encodeURIComponent(agent.id)}/runs`);
  openRuns.set(agent.id, r.ok ? r.body.runs : []);
  render();
}

function agentRow(agent) {
  const canMake = hasMyPermission("AP.Agents");
  const buttons = [];
  if (canMake && agent.isMine) {
    buttons.push(
      agent.status === "active"
        ? actionLink("paused", {
            label: t("agents.pause"),
            onclick: () =>
              act(() =>
                call(
                  `/api/agents/${encodeURIComponent(agent.id)}`,
                  json("PATCH", { status: "paused" }),
                ),
              ),
          })
        : actionLink("activate", {
            label: t("agents.start"),
            onclick: () =>
              act(async () => {
                const r = await call(
                  `/api/agents/${encodeURIComponent(agent.id)}`,
                  json("PATCH", { status: "active" }),
                );
                if (!r.ok) problem = why(r.body);
              }),
          }),
      actionLink("post", {
        label: t("agents.runnow"),
        onclick: () =>
          act(async () => {
            const r = await call(
              `/api/agents/${encodeURIComponent(agent.id)}/run`,
              json("POST", {}),
            );
            problem = r.ok ? t(`agents.ranow.${r.body.status}`) : why(r.body);
          }),
      }),
      actionLink("rename", {
        label: t("agents.edit"),
        onclick: () => startEdit(agent),
      }),
    );
  }
  buttons.push(
    actionLink("expand", {
      label: t("agents.runs"),
      onclick: () => toggleRuns(agent),
    }),
  );
  buttons.push(
    confirmRemove === agent.id
      ? el("span", { class: "agentconfirm" }, [
          el("span", { class: "sm", text: t("agents.removeconfirm") }),
          actionLink("retire", {
            label: t("agents.remove"),
            onclick: () =>
              act(async () => {
                confirmRemove = null;
                await call(`/api/agents/${encodeURIComponent(agent.id)}`, {
                  method: "DELETE",
                });
              }),
          }),
          actionLink("close", {
            label: t("agents.cancel"),
            onclick: () => {
              confirmRemove = null;
              render();
            },
          }),
        ])
      : actionLink("retire", {
          label: t("agents.remove"),
          onclick: () => {
            confirmRemove = agent.id;
            render();
          },
        }),
  );
  return [
    el("tr", { "data-agent": agent.id }, [
      el("td", {}, [
        el("button", {
          type: "button",
          class: "agentname agentopen",
          text: agent.name,
          onclick: () => openAgentPage(agent.id),
        }),
        el("div", {
          class: "muted sm",
          text: `${reportName(agent.report)}${showAll ? ` · ${agent.authorName}` : ""}`,
        }),
      ]),
      el("td", { class: "sm" }, [
        el("div", { text: agent.orgs.map((o) => o.name).join(", ") }),
        el("div", { class: "muted sm agentto", text: deliveryWords(agent) }),
      ]),
      el("td", {}, [
        el("div", { text: scheduleWords(agent.schedule) }),
        el("div", {}, [statusPill(agent)]),
      ]),
      lastRunCell(agent),
      el("td", {
        class: "sm",
        text: agent.status === "active" ? when(agent.nextRunAt) : "—",
      }),
      el("td", {}, [el("div", { class: "dobuttons agentbuttons" }, buttons)]),
    ]),
    runsRow(agent),
  ].filter(Boolean);
}

// --- The form ---------------------------------------------------------------

function reportsOffered() {
  // Decision 0636: an agent's own question is offered too, where there is something to ask about.
  return (data?.reports ?? []).filter((r) => r.orgIds.length > 0 && (!r.custom || (data?.catalogue?.datasets ?? []).length > 0));
}

/** Decision 0634: the reports the form lists, with the agent's own question while the draft is one. */
function reportsListed() {
  const offered = reportsOffered();
  const own = draft?.report === "query" && !offered.some((r) => r.id === "query") ? (data?.reports ?? []).find((r) => r.id === "query") : null;
  return own ? [...offered, own] : offered;
}

/** Decision 0636: a first question for a dataset — a few of its columns, nothing narrowed yet. */
export function startingQuestion(dataset) {
  return {
    dataset: dataset?.id ?? "invoices",
    where: [],
    since: "all",
    show: (dataset?.fields ?? []).slice(0, 4).map((f) => f.key),
    groupBy: [],
    measures: [],
    sort: [],
    limit: 100,
  };
}

function startNew() {
  const first = reportsOffered()[0];
  editing = "new";
  draft = {
    name: "",
    report: first?.id ?? "",
    orgIds: first ? [...first.orgIds.slice(0, 1)] : [],
    schedule: { every: "week", time: "08:00", weekday: 1 },
    deliver: { task: true, email: false },
    recipients: [],
    options: { ...(first?.options ?? {}) },
    description: "",
    summary: true,
    action: null,
  };
  understood = null;
  stepsOpen = false;
  problem = "";
  tried = null;
  render();
}

function startEdit(agent) {
  editing = agent;
  draft = {
    name: agent.name,
    report: agent.report,
    orgIds: agent.orgs.map((o) => o.id),
    schedule: { ...agent.schedule },
    deliver: { ...(agent.deliver ?? { task: true, email: false }) },
    recipients: (agent.recipients ?? [])
      .filter((p) => p.id !== agent.authorId)
      .map((p) => p.id),
    options: { ...(agent.options ?? {}) },
    description: agent.description ?? "",
    summary: agent.summary !== false,
    action: agent.action ?? null,
  };
  understood = null;
  tried = null;
  stepsOpen = !agent.description;
  problem = "";
  render();
}

function field(label, control, hint, id) {
  return el("div", { class: "dofield" }, [
    el("label", { text: label, ...(id ? { for: id } : {}) }),
    control,
    ...(hint ? [el("div", { class: "muted sm", text: hint })] : []),
  ]);
}

function select(id, options, value, onchange) {
  const node = el(
    "select",
    { id, onchange: (e) => onchange(e.target.value) },
    options.map(([v, label]) =>
      el("option", { value: String(v), text: label }),
    ),
  );
  node.value = String(value ?? "");
  return node;
}

function scheduleFields() {
  const s = draft.schedule;
  const set = (patch) => {
    draft.schedule = { ...s, ...patch };
    render();
  };
  const every = select(
    "agent-every",
    ["day", "workday", "week", "month", "once"].map((v) => [
      v,
      t(`agents.every.${v}`),
    ]),
    s.every,
    (v) => {
      const base = { every: v, time: s.time };
      if (v === "week") base.weekday = s.weekday ?? 1;
      if (v === "month") base.day = s.day ?? 1;
      if (v === "once")
        base.date = s.date ?? new Date().toISOString().slice(0, 10);
      draft.schedule = base;
      render();
    },
  );
  const time = el("input", {
    type: "time",
    id: "agent-time",
    value: s.time,
    onchange: (e) => {
      draft.schedule.time = e.target.value;
    },
  });
  const extra = [];
  if (s.every === "week") {
    extra.push(
      field(
        t("agents.form.weekday"),
        select(
          "agent-weekday",
          [1, 2, 3, 4, 5, 6, 7].map((d) => [d, t(`agents.weekday.${d}`)]),
          s.weekday,
          (v) => set({ weekday: Number(v) }),
        ),
        null,
        "agent-weekday",
      ),
    );
  }
  if (s.every === "month") {
    const days = [
      ...Array.from({ length: 28 }, (_, i) => [i + 1, String(i + 1)]),
      ["last", t("agents.form.lastday")],
      ["lastWorking", t("agents.form.lastworkingday")],
    ];
    extra.push(
      field(
        t("agents.form.day"),
        select("agent-day", days, s.day, (v) =>
          set({ day: v === "last" || v === "lastWorking" ? v : Number(v) }),
        ),
        null,
        "agent-day",
      ),
    );
  }
  if (s.every === "once") {
    extra.push(
      field(
        t("agents.form.date"),
        el("input", {
          type: "date",
          id: "agent-date",
          value: s.date ?? "",
          onchange: (e) => {
            draft.schedule.date = e.target.value;
          },
        }),
        null,
        "agent-date",
      ),
    );
  }
  return el("div", { class: "agentwhen" }, [
    field(t("agents.form.every"), every, null, "agent-every"),
    field(
      t("agents.form.time"),
      time,
      t("agents.form.timehint").replace("{zone}", zone()),
      "agent-time",
    ),
    ...extra,
  ]);
}

function formPanel() {
  const offered = reportsListed();
  const report = offered.find((r) => r.id === draft.report) ?? offered[0];
  const name = el("input", {
    type: "text",
    id: "agent-name",
    value: draft.name,
    maxlength: "80",
    placeholder: t("agents.form.nameplaceholder"),
    oninput: (e) => {
      draft.name = e.target.value;
    },
  });
  const reportSelect = select(
    "agent-report",
    offered.map((r) => [r.id, reportName(r.id)]),
    report?.id,
    (v) => {
      draft.report = v;
      // Decision 0624: a report's own options, from its defaults.
      draft.options = { ...(offered.find((r) => r.id === v)?.options ?? {}) };
      // Decision 0636: the agent's own question starts from the first dataset.
      if (v === "query") draft.options = { query: startingQuestion(data?.catalogue?.datasets?.[0]) };
      tried = null;
      // Decision 0631: an action only where the new report can prepare it.
      if (!(offered.find((r) => r.id === v)?.actions ?? []).includes(draft.action)) draft.action = null;
      // Decision 0630: an event report looks every hour; another needs a time again.
      if (offered.find((r) => r.id === v)?.event) draft.schedule = { every: "hour" };
      else if (draft.schedule?.every === "hour") draft.schedule = { every: "week", time: "08:00", weekday: 1 };
      const allowed = offered.find((r) => r.id === v)?.orgIds ?? [];
      draft.orgIds = draft.orgIds.filter((id) => allowed.includes(id));
      if (draft.orgIds.length === 0 && allowed.length > 0)
        draft.orgIds = [allowed[0]];
      render();
    },
  );
  // Decision 0637: a question's organisations are those where its dataset may be asked about.
  const askedOf = report?.custom ? (data.catalogue?.datasets ?? []).find((d) => d.id === draft.options?.query?.dataset) : null;
  const orgs = (data.orgs ?? []).filter((o) => (askedOf?.orgIds ?? report?.orgIds ?? []).includes(o.id));
  const orgBoxes = el(
    "div",
    { class: "agentorgs", id: "agent-orgs" },
    orgs.map((o) => {
      const box = el("input", {
        type: "checkbox",
        id: `agent-org-${o.id}`,
        onchange: (e) => {
          draft.orgIds = e.target.checked
            ? [...new Set([...draft.orgIds, o.id])]
            : draft.orgIds.filter((id) => id !== o.id);
        },
      });
      box.checked = draft.orgIds.includes(o.id);
      return el("label", { class: "agentorg", for: `agent-org-${o.id}` }, [
        box,
        el("span", { text: o.name }),
      ]);
    }),
  );
  const save = actionLink("save", {
    primary: true,
    label:
      editing === "new" ? t("agents.form.savepaused") : t("agents.form.save"),
    onclick: async () => {
      const body = {
        name: draft.name,
        report: report?.id,
        orgIds: draft.orgIds,
        schedule: draft.schedule,
        deliver: draft.deliver,
        recipients: draft.recipients,
        options: draft.options,
        description: draft.description || null,
        summary: draft.summary,
        action: draft.action ?? null,
      };
      const r =
        editing === "new"
          ? await call("/api/agents", json("POST", body))
          : await call(
              `/api/agents/${encodeURIComponent(editing.id)}`,
              json("PATCH", body),
            );
      if (!r.ok) {
        problem = why(r.body);
        render();
        return;
      }
      editing = null;
      draft = null;
      problem = t(r.status === 201 ? "agents.saved.new" : "agents.saved.edit");
      await load();
      render();
    },
  });
  const cancel = actionLink("close", {
    label: t("agents.cancel"),
    onclick: () => {
      editing = null;
      draft = null;
      problem = "";
      render();
    },
  });
  // Decision 0625: the form's fields are "Edit steps", under the plan.
  const steps = el(
    "details",
    {
      class: "agentsteps",
      id: "agent-steps",
      ontoggle: (e) => {
        stepsOpen = e.target.open;
      },
    },
    [
      el("summary", { text: t("agents.editsteps") }),
      el("div", { class: "dotwo" }, [
        field(t("agents.form.name"), name, null, "agent-name"),
        field(
          t("agents.form.report"),
          reportSelect,
          report ? t(`agents.reporthint.${report.id}`) : null,
          "agent-report",
        ),
      ]),
      field(t("agents.form.orgs"), orgBoxes, t("agents.form.orgshint")),
      report?.custom ? questionField() : optionFields(report),
      report?.event ? eventField() : scheduleFields(),
      summaryField(),
      actionField(report),
      deliveryFields(),
    ],
  );
  if (stepsOpen) steps.open = true;
  return el("div", { class: "panel agentform", id: "agent-form" }, [
    el("div", { class: "cardhead" }, [
      el("h3", {
        text: editing === "new" ? t("agents.form.new") : t("agents.form.edit"),
      }),
      el("div", { class: "dobuttons" }, [cancel, save]),
    ]),
    describeField(),
    planPanel(report),
    steps,
  ]);
}

/**
 * **Describe it — decision 0625.** Plain words, Understand, and the form
 * filled from what came back. Nothing is saved until Save.
 */
function describeField() {
  const box = el("textarea", {
    id: "agent-describe",
    rows: "3",
    maxlength: "600",
    placeholder: t("agents.describe.placeholder"),
    oninput: (e) => {
      draft.description = e.target.value;
    },
  });
  box.value = draft.description ?? "";
  const go = actionLink("compile", {
    primary: !understood,
    label: understanding ? t("agents.understanding") : t("agents.understand"),
    onclick: async () => {
      if (understanding) return;
      understanding = true;
      problem = "";
      render();
      const r = await call(
        "/api/agents/understand",
        json("POST", { text: draft.description ?? "" }),
      );
      understanding = false;
      if (!r.ok) {
        problem = why(r.body);
        render();
        return;
      }
      const d = r.body.draft;
      draft = {
        ...draft,
        name: d.name ?? draft.name,
        report: d.report ?? draft.report,
        orgIds: d.orgIds?.length ? d.orgIds : draft.orgIds,
        schedule: d.schedule ?? draft.schedule,
        options: d.report ? { ...d.options } : draft.options,
        // Decision 0634: a new question or report drops what the old one prepared.
        action: d.report && d.report === draft.report ? draft.action : null,
        deliver: { ...d.deliver },
        recipients: [...(d.recipients ?? [])],
        description: r.body.text ?? draft.description,
        summary: d.summary !== false,
      };
      understood = {
        refusals: r.body.refusals ?? [],
        missing: r.body.missing ?? [],
        assumed: r.body.assumed ?? [],
      };
      tried = null;
      stepsOpen = understood.missing.length > 0;
      render();
    },
  });
  return el("div", { class: "agentdescribe" }, [
    field(
      t("agents.describe.label"),
      box,
      t("agents.describe.hint"),
      "agent-describe",
    ),
    el("div", { class: "dobuttons" }, [go]),
  ]);
}

/** The plan in plain words: what it reports, where, narrowed how, when, to whom. */
export function planLines(d, ctx) {
  const orgNames = (ctx.orgs ?? [])
    .filter((o) => d.orgIds.includes(o.id))
    .map((o) => o.name);
  const shape = [];
  const o = d.options ?? {};
  // Decision 0634: what the words did not say is the usual, and said so.
  const assumed = new Set(ctx.assumed ?? []);
  const usual = (key, words) => (assumed.has(key) ? `${words} ${t("agents.plan.usual")}` : words);
  if (d.report === "query" && o.query) shape.push(...queryWords(o.query, ctx.catalogue ?? data?.catalogue, assumed));
  if (o.minTotal !== undefined)
    shape.push(
      t("agents.plan.mintotal").replace(
        "{n}",
        Number(o.minTotal).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
      ),
    );
  if (o.highlightDays !== undefined)
    shape.push(
      usual("option:highlightDays", t("agents.plan.highlightdays").replace("{n}", String(o.highlightDays))),
    );
  if (o.withinDays !== undefined)
    shape.push(
      usual("option:withinDays", t("agents.plan.withindays").replace("{n}", String(o.withinDays))),
    );
  if (o.olderThanDays !== undefined)
    shape.push(
      usual("option:olderThanDays", t("agents.plan.olderthandays").replace("{n}", String(o.olderThanDays))),
    );
  const how =
    d.deliver?.task && d.deliver?.email
      ? t("agents.deliver.both")
      : d.deliver?.email
        ? t("agents.deliver.email")
        : t("agents.deliver.task");
  const others = (ctx.managers ?? [])
    .filter((m) => d.recipients.includes(m.id))
    .map((m) => m.name);
  const who = others.length
    ? t("agents.plan.toyouand").replace("{names}", others.join(", "))
    : t("agents.plan.toyou");
  return [
    ["when", d.schedule ? `${scheduleWords(d.schedule)} (${ctx.zone})` : null],
    [
      "gather",
      d.report && orgNames.length
        ? `${t(`agents.report.${d.report}`)} · ${orgNames.join(", ")}`
        : null,
    ],
    ["shape", shape.length ? shape.join(" · ") : t("agents.plan.shape.none")],
    // Decision 0626: the AI summary on top, or none.
    [
      "summarise",
      d.summary === false
        ? t("agents.plan.summary.off")
        : t("agents.plan.summary.on"),
    ],
    // Decision 0631: what it also prepares for approval.
    ...(d.action ? [["act", t(`agents.plan.act.${d.action}`)]] : []),
    ["deliver", `${how}, ${who}`],
  ];
}

function planPanel() {
  if (!understood) return el("div", { id: "agent-plan", hidden: "hidden" });
  const lines = planLines(draft, {
    orgs: data.orgs,
    managers: data.managers,
    zone: zone(),
    assumed: understood.assumed ?? [],
    catalogue: data.catalogue,
  });
  const missing = new Set(understood.missing);
  const missingWords = (key) =>
    t(
      `agents.plan.missing.${key === "when" ? "schedule" : key === "shape" ? "shape" : missing.has("report") || !draft.report ? "report" : "orgs"}`,
    );
  return el("div", { class: "agentplan", id: "agent-plan" }, [
    el("h4", { text: t("agents.plan.heading") }),
    el(
      "div",
      { class: "agentplanrows" },
      lines.map(([key, said]) => {
        // What the words left out is said as missing, even where the form keeps its own default.
        const text =
          (key === "when" && missing.has("schedule")) ||
          (key === "gather" && (missing.has("report") || missing.has("orgs"))) ||
          // Decision 0635: with no report yet, what narrows it is not known either.
          (key === "shape" && missing.has("report"))
            ? null
            : said;
        return el(
          "div",
          { class: `agentplanrow${text ? "" : " missing"}`, "data-step": key },
          [
            el("span", {
              class: "agentplantag",
              text: t(`agents.plan.${key}`),
            }),
            el("span", { text: text ?? missingWords(key) }),
          ],
        );
      }),
    ),
    ...(understood.refusals.length
      ? [
          el(
            "ul",
            { class: "agentrefusals", id: "agent-refusals" },
            understood.refusals.map((r) =>
              el("li", {
                text: t(`agents.refusal.${r.code}`).replace("{words}", r.words),
              }),
            ),
          ),
        ]
      : []),
    ...(missing.size
      ? [el("p", { class: "muted sm", text: t("agents.plan.finish") })]
      : []),
  ]);
}

/**
 * **A question in words — decision 0634**: the dataset and its filters,
 * new or all, the columns or grouping, the order and the limit. Parts the
 * words did not say are marked "(usual)".
 */
export function queryWords(q, catalogue, assumed = new Set()) {
  const ds = (catalogue?.datasets ?? []).find((d) => d.id === q.dataset);
  const fieldOf = (key) => ds?.fields.find((f) => f.key === key);
  const name = (key) => (fieldOf(key) ? t(fieldOf(key).label) : key);
  const money = (n) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const value = (f, v, currency) => {
    if (Array.isArray(v)) return v.map((x) => value(f, x, currency)).join(", ");
    if (f?.kind === "enum") return t(`${f.enumKey}.${v}`);
    if (f?.kind === "money") return `${money(v)} ${currency ?? ""}`.trim();
    return String(v);
  };
  const usual = (key, words) => (assumed.has(key) ? `${words} ${t("agents.plan.usual")}` : words);
  const and = ` ${t("agents.plan.q.and")} `;
  const filters = (q.where ?? []).map((w) => {
    const f = fieldOf(w.field);
    const v = w.value;
    const words = t(`agents.qop.${w.op}`)
      .replace("{field}", name(w.field))
      .replace("{a}", Array.isArray(v) ? value(f, v[0], w.currency) : "")
      .replace("{b}", Array.isArray(v) ? value(f, v[1], w.currency) : "")
      .replace("{value}", v === undefined ? "" : value(f, v, w.currency));
    return usual(`where:${w.field}`, words);
  });
  const dataset = t(`agents.dataset.${q.dataset}`);
  const parts = [filters.length ? t("agents.plan.q.where").replace("{dataset}", dataset).replace("{filters}", filters.join(and)) : t("agents.plan.q.all").replace("{dataset}", dataset)];
  parts.push(usual("since", t(`agents.plan.q.since.${q.since === "last_run" ? "last_run" : "all"}`)));
  if (q.groupBy?.length) {
    const measures = (q.measures ?? []).map((m) => {
      if (m.fn === "count") return usual("measure:count", t("agents.col.m.count"));
      const f = fieldOf(m.field);
      const fn = f?.kind === "date" ? (m.fn === "min" ? "first" : "last") : m.fn;
      return t(`agents.col.m.${fn}`).replace("{field}", name(m.field));
    });
    parts.push(
      usual("group:currency", t("agents.plan.q.group").replace("{fields}", q.groupBy.map(name).join(", ")).replace("{measures}", measures.join(", "))),
    );
  } else if (q.show?.length) {
    parts.push(t("agents.plan.q.show").replace("{fields}", q.show.map(name).join(", ")));
  }
  const measureName = (key) => {
    const m = (q.measures ?? []).find((x) => (x.fn === "count" ? "count" : `${x.fn}_${x.field}`) === key);
    if (!m) return name(key);
    if (m.fn === "count") return t("agents.col.m.count");
    return t(`agents.col.m.${m.fn}`).replace("{field}", name(m.field));
  };
  for (const s of q.sort ?? [])
    parts.push(usual("sort", t("agents.plan.q.sort").replace("{field}", measureName(s.key)).replace("{dir}", t(`agents.plan.q.${s.dir === "asc" ? "asc" : "desc"}`))));
  parts.push(usual("limit", t("agents.plan.q.limit").replace("{n}", String(q.limit ?? 100))));
  return parts;
}

/**
 * **The question in Edit steps — decisions 0634 and 0636.** In words, and
 * as a builder: what to ask about, filters, new or all, the columns or a
 * grouping, the order and the limit, each offered only from what this
 * person may ask. **Try it now** runs it with their own access, saving
 * nothing. The server checks it again on Try and on Save.
 */
function questionField() {
  const q = draft.options?.query;
  if (!q) return el("div", { id: "agent-question" });
  const datasets = data?.catalogue?.datasets ?? [];
  const ds = datasets.find((d) => d.id === q.dataset) ?? datasets[0];
  const fields = ds?.fields ?? [];
  const fieldOf = (key) => fields.find((f) => f.key === key);
  const fieldName = (f) => t(f.label);
  // A change of shape redraws the form; typing only updates the draft.
  const set = (change, redraw = true) => {
    draft.options = { ...draft.options, query: { ...draft.options.query, ...change } };
    if (redraw) {
      tried = null;
      render();
    } else {
      // The words follow what is typed, without redrawing the field being typed in.
      const list = document.getElementById("agent-q-words");
      if (list) list.replaceChildren(...queryWords(draft.options.query, data?.catalogue, new Set(understood?.assumed ?? [])).map((w) => el("li", { text: w })));
    }
  };
  const now = () => draft.options.query;
  const input = (props, onvalue) =>
    el("input", { ...props, oninput: (e) => onvalue(e.target.value) });

  const datasetSelect = select(
    "agent-q-dataset",
    datasets.map((d) => [d.id, t(`agents.dataset.${d.id}`)]),
    ds?.id,
    (v) => {
      const next = datasets.find((d) => d.id === v);
      // Decision 0637: only organisations where the new dataset may be asked about.
      if (next?.orgIds) {
        draft.orgIds = draft.orgIds.filter((id) => next.orgIds.includes(id));
        if (draft.orgIds.length === 0 && next.orgIds.length > 0) draft.orgIds = [next.orgIds[0]];
      }
      set(startingQuestion(next));
    },
  );

  const valueControls = (w, i) => {
    const f = fieldOf(w.field);
    const put = (value, extra = {}) => {
      const where = now().where.map((x, j) => (j === i ? { ...x, value, ...extra } : x));
      set({ where }, false);
    };
    if (!f || w.op === "is_empty" || w.op === "not_empty") return [];
    if (f.kind === "enum") {
      if (w.op === "in") {
        const chosen = Array.isArray(w.value) ? w.value : [];
        return [
          el(
            "span",
            { class: "agentqvalues" },
            (f.values ?? []).map((v) => {
              const box = el("input", {
                type: "checkbox",
                onchange: (e) => {
                  const now2 = Array.isArray(now().where[i].value) ? now().where[i].value : [];
                  put(e.target.checked ? [...new Set([...now2, v])] : now2.filter((x) => x !== v));
                },
              });
              box.checked = chosen.includes(v);
              return el("label", { class: "agentorg" }, [box, el("span", { text: t(`${f.enumKey}.${v}`) })]);
            }),
          ),
        ];
      }
      return [select(`agent-q-value-${i}`, (f.values ?? []).map((v) => [v, t(`${f.enumKey}.${v}`)]), w.value, (v) => put(v))];
    }
    const kindType = f.kind === "date" && !["in_last_days", "older_than_days"].includes(w.op) ? "date" : f.kind === "text" ? "text" : "number";
    const asValue = (v) => (kindType === "number" ? (v === "" ? null : Number(v)) : v);
    const currency =
      f.kind === "money"
        ? [
            input(
              { type: "text", class: "agentqcurrency", maxlength: "3", value: w.currency ?? "", placeholder: "GBP", "aria-label": t("agents.q.currency") },
              (v) => {
                const where = now().where.map((x, j) => (j === i ? { ...x, currency: v.toUpperCase() } : x));
                set({ where }, false);
              },
            ),
          ]
        : [];
    if (w.op === "between") {
      const pair = Array.isArray(w.value) ? w.value : ["", ""];
      return [
        input({ type: kindType, class: "agentqvalue", value: pair[0] ?? "", "data-part": "from" }, (v) => {
          const cur = Array.isArray(now().where[i].value) ? now().where[i].value : [null, null];
          put([asValue(v), cur[1]]);
        }),
        el("span", { class: "muted sm", text: t("agents.plan.q.and") }),
        input({ type: kindType, class: "agentqvalue", value: pair[1] ?? "", "data-part": "to" }, (v) => {
          const cur = Array.isArray(now().where[i].value) ? now().where[i].value : [null, null];
          put([cur[0], asValue(v)]);
        }),
        ...currency,
      ];
    }
    if (w.op === "in") {
      return [
        input({ type: "text", class: "agentqvalue", value: Array.isArray(w.value) ? w.value.join(", ") : "", placeholder: t("agents.q.commas") }, (v) =>
          put(v.split(",").map((x) => x.trim()).filter(Boolean)),
        ),
      ];
    }
    return [input({ type: kindType, class: "agentqvalue", value: w.value ?? "" }, (v) => put(asValue(v))), ...currency];
  };

  const filterRows = (q.where ?? []).map((w, i) => {
    const f = fieldOf(w.field);
    return el("div", { class: "agentqrow", "data-filter": String(i) }, [
      select(`agent-q-field-${i}`, fields.map((x) => [x.key, fieldName(x)]), w.field, (v) => {
        const nf = fieldOf(v);
        const where = now().where.map((x, j) => (j === i ? { field: v, op: nf.ops[0], ...(nf.kind === "money" ? { currency: x.currency ?? "GBP" } : {}) } : x));
        set({ where });
      }),
      select(`agent-q-op-${i}`, (f?.ops ?? []).map((op) => [op, t(`agents.q.op.${op}`)]), w.op, (v) => {
        const where = now().where.map((x, j) => (j === i ? { field: x.field, op: v, ...(x.currency ? { currency: x.currency } : {}) } : x));
        set({ where });
      }),
      ...valueControls(w, i),
      actionLink("close", { label: t("agents.q.remove"), onclick: () => set({ where: now().where.filter((_, j) => j !== i) }) }),
    ]);
  });
  const addFilter = actionLink("create", {
    label: t("agents.q.addfilter"),
    onclick: () => {
      const f = fields[0];
      if (f) set({ where: [...now().where, { field: f.key, op: f.ops[0], ...(f.kind === "money" ? { currency: "GBP" } : {}) }] });
    },
  });

  const since = select(
    "agent-q-since",
    [
      ["all", t("agents.plan.q.since.all")],
      // Decision 0637: only where something records when a row arrived.
      ...(ds?.since === false ? [] : [["last_run", t("agents.plan.q.since.last_run")]]),
    ],
    q.since ?? "all",
    (v) => set({ since: v }),
  );

  const grouped = (q.groupBy ?? []).length > 0;
  const shapeSelect = select(
    "agent-q-shape",
    [
      ["rows", t("agents.q.shape.rows")],
      ["group", t("agents.q.shape.group")],
    ],
    grouped ? "group" : "rows",
    (v) => {
      if (v === "group") {
        const g = fields.find((f) => f.group);
        set({ groupBy: g ? [g.key] : [], measures: [{ fn: "count" }], show: [], sort: [] });
      } else set({ groupBy: [], measures: [], show: startingQuestion(ds).show, sort: [] });
    },
  );

  const showBoxes = el(
    "div",
    { class: "agentorgs", id: "agent-q-show" },
    fields.map((f) => {
      const box = el("input", {
        type: "checkbox",
        onchange: (e) => {
          const show = e.target.checked ? [...now().show, f.key] : now().show.filter((k) => k !== f.key);
          set({ show, sort: now().sort.filter((s) => show.includes(s.key)) });
        },
      });
      box.checked = (q.show ?? []).includes(f.key);
      return el("label", { class: "agentorg" }, [box, el("span", { text: fieldName(f) })]);
    }),
  );

  const groupable = fields.filter((f) => f.group);
  const groupSelects = [0, 1].map((i) =>
    select(
      `agent-q-group-${i}`,
      [...(i === 1 ? [["", t("agents.q.none")]] : []), ...groupable.map((f) => [f.key, fieldName(f)])],
      q.groupBy?.[i] ?? "",
      (v) => {
        const g = [...(now().groupBy ?? [])];
        if (v) g[i] = v;
        else g.splice(i, 1);
        set({ groupBy: [...new Set(g.filter(Boolean))], sort: [] });
      },
    ),
  );
  const measured = fields.filter((f) => ["money", "days", "date"].includes(f.kind));
  const measureKeyOf = (m) => (m.fn === "count" ? "count" : `${m.fn}_${m.field}`);
  const measureLabel = (m) => {
    if (m.fn === "count") return t("agents.col.m.count");
    const f = fieldOf(m.field);
    const fn = f?.kind === "date" ? (m.fn === "min" ? "first" : "last") : m.fn;
    return t(`agents.col.m.${fn}`).replace("{field}", f ? fieldName(f) : m.field);
  };
  const measureOptions = [
    { fn: "count" },
    ...measured.flatMap((f) => (f.kind === "date" ? ["min", "max"] : ["sum", "avg", "min", "max"]).map((fn) => ({ fn, field: f.key }))),
  ];
  const measureBoxes = el(
    "div",
    { class: "agentorgs", id: "agent-q-measures" },
    measureOptions.map((m) => {
      const key = measureKeyOf(m);
      const box = el("input", {
        type: "checkbox",
        onchange: (e) => {
          const measures = e.target.checked ? [...now().measures, m] : now().measures.filter((x) => measureKeyOf(x) !== key);
          set({ measures, sort: now().sort.filter((s) => s.key !== key) });
        },
      });
      box.checked = (q.measures ?? []).some((x) => measureKeyOf(x) === key);
      return el("label", { class: "agentorg" }, [box, el("span", { text: measureLabel(m) })]);
    }),
  );

  const sortable = grouped
    ? [...q.groupBy.map((k) => [k, fieldOf(k) ? fieldName(fieldOf(k)) : k]), ...(q.measures ?? []).map((m) => [measureKeyOf(m), measureLabel(m)])]
    : (q.show ?? []).map((k) => [k, fieldOf(k) ? fieldName(fieldOf(k)) : k]);
  const sortSelect = select("agent-q-sort", [["", t("agents.q.none")], ...sortable], q.sort?.[0]?.key ?? "", (v) =>
    set({ sort: v ? [{ key: v, dir: now().sort?.[0]?.dir ?? "desc" }] : [] }),
  );
  const dirSelect = select(
    "agent-q-dir",
    [
      ["desc", t("agents.plan.q.desc")],
      ["asc", t("agents.plan.q.asc")],
    ],
    q.sort?.[0]?.dir ?? "desc",
    (v) => set({ sort: now().sort.length ? [{ key: now().sort[0].key, dir: v }] : [] }),
  );
  const limit = input({ type: "number", id: "agent-q-limit", min: "1", max: "500", step: "1", value: String(q.limit ?? 100) }, (v) =>
    set({ limit: v === "" ? 100 : Number(v) }, false),
  );

  const tryIt = actionLink("compile", {
    label: tried === "loading" ? t("agents.q.trying") : t("agents.q.try"),
    onclick: async () => {
      if (tried === "loading") return;
      tried = "loading";
      render();
      const r = await call("/api/agent-query/try", json("POST", { query: draft.options.query, orgIds: draft.orgIds }));
      tried = r.ok ? { table: r.body.table, count: r.body.count } : { problem: why(r.body) };
      render();
    },
  });
  const triedPanel =
    tried && tried !== "loading"
      ? tried.problem
        ? el("p", { class: "agentrefusals", id: "agent-q-tried", text: tried.problem })
        : el("div", { id: "agent-q-tried", class: "agentqtried" }, [
            el("p", { class: "muted sm", text: t("agents.q.tried").replace("{n}", String(tried.count)).replace("{shown}", String(tried.table.rows.length)) }),
            reportTable(tried.table),
          ])
      : null;

  return el("div", { id: "agent-question", class: "agentqbuilder" }, [
    field(
      t("agents.form.question"),
      el("ul", { class: "agentquestion", id: "agent-q-words" }, queryWords(q, data?.catalogue, new Set(understood?.assumed ?? [])).map((w) => el("li", { text: w }))),
      t("agents.q.hint"),
    ),
    el("div", { class: "dotwo" }, [field(t("agents.q.dataset"), datasetSelect, null, "agent-q-dataset"), field(t("agents.q.since"), since, null, "agent-q-since")]),
    field(t("agents.q.where"), el("div", { class: "agentqfilters", id: "agent-q-filters" }, [...filterRows, el("div", { class: "dobuttons" }, [addFilter])])),
    field(t("agents.q.shape"), shapeSelect, null, "agent-q-shape"),
    grouped
      ? el("div", {}, [
          field(t("agents.q.groupby"), el("div", { class: "agentqrow" }, groupSelects)),
          field(t("agents.q.measures"), measureBoxes),
        ])
      : field(t("agents.q.show"), showBoxes),
    el("div", { class: "agentqrow" }, [field(t("agents.q.sort"), el("div", { class: "agentqrow" }, [sortSelect, dirSelect]), null, "agent-q-sort"), field(t("agents.q.limit"), limit, null, "agent-q-limit")]),
    el("div", { class: "dobuttons" }, [tryIt]),
    ...(triedPanel ? [triedPanel] : []),
  ]);
}

/**
 * **What the report is narrowed by — decision 0624.** Only the report's
 * own: an amount for outstanding payables, days for the rest.
 */
function optionFields(report) {
  const keys = report?.optionKeys ?? [];
  if (keys.length === 0)
    return el("div", { id: "agent-options", hidden: "hidden" });
  return el(
    "div",
    { class: "agentwhen", id: "agent-options" },
    keys.map((key) => {
      const input = el("input", {
        type: "number",
        id: `agent-option-${key}`,
        min: key === "minTotal" ? "0" : "1",
        step: key === "minTotal" ? "0.01" : "1",
        value:
          draft.options?.[key] === undefined ? "" : String(draft.options[key]),
        placeholder:
          key === "minTotal" ? t("agents.option.mintotal.placeholder") : "",
        oninput: (e) => {
          const v = e.target.value;
          draft.options = { ...draft.options };
          if (v === "") delete draft.options[key];
          else draft.options[key] = Number(v);
        },
      });
      return field(
        t(`agents.option.${key.toLowerCase()}`),
        input,
        t(`agents.option.${key.toLowerCase()}.hint`),
        `agent-option-${key}`,
      );
    }),
  );
}

/**
 * **How, and to whom — decision 0623.** The task list, email or both;
 * its author always, and any AP Managers chosen. Each copy is filtered to
 * what its reader may see, and is in their language.
 */
function deliveryFields() {
  const box = (id, checked, onchange, disabled = false) => {
    const node = el("input", {
      type: "checkbox",
      id,
      onchange: (e) => onchange(e.target.checked),
    });
    node.checked = checked;
    if (disabled) node.disabled = true;
    return node;
  };
  const how = el("div", { class: "agentorgs", id: "agent-deliver" }, [
    el("label", { class: "agentorg", for: "agent-deliver-task" }, [
      box("agent-deliver-task", draft.deliver.task, (v) => {
        draft.deliver.task = v;
      }),
      el("span", { text: t("agents.deliver.task") }),
    ]),
    el("label", { class: "agentorg", for: "agent-deliver-email" }, [
      box(
        "agent-deliver-email",
        draft.deliver.email,
        (v) => {
          draft.deliver.email = v;
        },
        !data.emailReady && !draft.deliver.email,
      ),
      el("span", { text: t("agents.deliver.email") }),
    ]),
  ]);
  const people = data.managers ?? [];
  const who = people.length
    ? el(
        "div",
        { class: "agentorgs", id: "agent-recipients" },
        people.map((p) =>
          el("label", { class: "agentorg", for: `agent-to-${p.id}` }, [
            box(`agent-to-${p.id}`, draft.recipients.includes(p.id), (v) => {
              draft.recipients = v
                ? [...new Set([...draft.recipients, p.id])]
                : draft.recipients.filter((id) => id !== p.id);
            }),
            el("span", {
              text: p.hasEmail
                ? p.name
                : `${p.name} (${t("agents.deliver.noemail")})`,
            }),
          ]),
        ),
      )
    : el("p", {
        class: "muted sm",
        id: "agent-recipients",
        text: t("agents.deliver.nomanagers"),
      });
  return el("div", {}, [
    field(
      t("agents.deliver.how"),
      how,
      data.emailReady
        ? t("agents.deliver.hint")
        : t("agents.deliver.noemailsetup"),
    ),
    field(t("agents.deliver.who"), who, t("agents.deliver.whohint")),
  ]);
}

/**
 * **The AI summary — decision 0626.** On unless turned off: a few
 * sentences by AI on top of each copy, in its reader's language, sent
 * only when every number in it is in the table.
 */
function summaryField() {
  const node = el("input", {
    type: "checkbox",
    id: "agent-summary",
    onchange: (e) => {
      draft.summary = e.target.checked;
      render();
    },
  });
  node.checked = draft.summary !== false;
  return field(
    t("agents.summary.label"),
    el("label", { class: "agentorg", for: "agent-summary" }, [
      node,
      el("span", { text: t("agents.summary.on") }),
    ]),
    data.aiReady === false
      ? t("agents.summary.noai")
      : t("agents.summary.hint"),
  );
}

/**
 * **When, for an agent started by an event — decision 0630.** No time to
 * choose: it looks every hour and sends only what is new to each person.
 */
function eventField() {
  return field(
    t("agents.form.every"),
    el("p", { class: "sm", id: "agent-event-when", text: t("agents.when.hour") }),
    t("agents.event.hint"),
  );
}

/**
 * **Also prepare — decision 0631.** For a report that can: an action the
 * agent gets ready after each run, for a person to approve on Tasks.
 */
function actionField(report) {
  const kinds = report?.actions ?? [];
  if (kinds.length === 0) return el("div", { hidden: "hidden" });
  const on = data.actionsEnabled ?? { environment: true, licence: true };
  const chooser = select(
    "agent-action",
    [["", t("agents.action.none")], ...kinds.map((k) => [k, t(`agents.action.${k}`)])],
    draft.action ?? "",
    (v) => {
      draft.action = v || null;
      render();
    },
  );
  return field(
    t("agents.action.label"),
    chooser,
    !on.licence
      ? t("agents.action.offlicence")
      : !on.environment
        ? t("agents.action.offenvironment")
        : t(`agents.action.${draft.action ?? "none"}.hint`),
  );
}

/** Decision 0631: an administrator turns prepared actions on or off for the environment. */
function actionsSwitch() {
  const on = data.actionsEnabled ?? { environment: true, licence: true };
  if (!data.canSetTimeZone || !on.licence) return null;
  return el("div", { class: "agentzone sm", id: "agent-actions-switch" }, [
    el("span", { text: on.environment ? t("agents.actions.areon") : t("agents.actions.areoff") }),
    actionLink(on.environment ? "paused" : "activate", {
      label: on.environment ? t("agents.actions.turnoff") : t("agents.actions.turnon"),
      onclick: async () => {
        const r = await call("/api/agent-settings", json("PUT", { actionsEnabled: !on.environment }));
        problem = r.ok ? "" : why(r.body);
        await load();
        render();
      },
    }),
  ]);
}

/** Decision 0631: one prepared action, in words, for the agent's page. */
export function actionWords(a) {
  const p = a.payload ?? {};
  const what = t(`agents.actions.${a.kind}.title`)
    .replace("{holder}", p.holderName ?? "")
    .replace("{supplier}", p.facts?.supplier ?? p.supplier ?? "")
    .replace("{invoice}", p.invoiceNumber ?? p.facts?.invoice ?? "—");
  const status = t(`agents.actionstatus.${a.status}`);
  const by = a.decidedBy ? t("agents.actions.by").replace("{name}", a.decidedBy) : "";
  const key = a.reason ? `agents.actionreason.${a.reason}` : null;
  const why = key ? (t(key) === key ? a.reason : t(key)) : "";
  return [what, [status, by].filter(Boolean).join(" "), why].filter(Boolean).join(" · ");
}

/** Who it goes to, in a row: "Task list and email · Dan, Maya (stopped)". */
function deliveryWords(agent) {
  const how =
    agent.deliver?.task && agent.deliver?.email
      ? t("agents.deliver.both")
      : agent.deliver?.email
        ? t("agents.deliver.email")
        : t("agents.deliver.task");
  const who = (agent.recipients ?? [])
    .map((p) =>
      p.optedOut ? `${p.name} (${t("agents.deliver.stopped")})` : p.name,
    )
    .join(", ");
  const said =
    agent.summary === false ? how : `${how} · ${t("agents.summary.short")}`;
  return who ? `${said} · ${who}` : said;
}

// --- The time zone ------------------------------------------------------------

const ZONES = [
  "Europe/London",
  "Europe/Dublin",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Amsterdam",
  "Europe/Madrid",
  "Europe/Zurich",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "UTC",
];
let zoneOpen = false;

function zoneLine() {
  const parts = [
    el("span", {
      text: t("agents.limit")
        .replace("{used}", String(data.limit.used))
        .replace("{max}", String(data.limit.max)),
    }),
    el("span", { text: ` · ${t("agents.zone").replace("{zone}", zone())}` }),
  ];
  if (data.canSetTimeZone && !zoneOpen)
    parts.push(
      actionLink("rename", {
        label: t("agents.zonechange"),
        onclick: () => {
          zoneOpen = true;
          render();
        },
      }),
    );
  if (zoneOpen) {
    const choices = ZONES.includes(zone()) ? ZONES : [zone(), ...ZONES];
    const chooser = select(
      "agent-zone",
      choices.map((z) => [z, z]),
      zone(),
      () => {},
    );
    parts.push(
      chooser,
      actionLink("save", {
        label: t("agents.zonesave"),
        onclick: async () => {
          const r = await call(
            "/api/agent-settings",
            json("PUT", { timeZone: chooser.value }),
          );
          zoneOpen = false;
          problem = r.ok ? t("agents.zonesaved") : why(r.body);
          await load();
          render();
        },
      }),
    );
  }
  return el("div", { class: "agentzone sm", id: "agent-zone-line" }, parts);
}

function render() {
  const shell = document.getElementById("shell");
  if (!shell) return;
  if (!data) {
    shell.replaceChildren(
      frame(
        el("div", {}, [
          topbar(t("nav.agents"), t("agents.subtitle")),
          el("div", { class: "warn", text: t("agents.failed") }),
        ]),
      ),
    );
    return;
  }
  const canMake = hasMyPermission("AP.Agents");
  const right = [];
  if (data.canManageAll) {
    right.push(
      actionLink("users", {
        label: showAll ? t("agents.showmine") : t("agents.showall"),
        onclick: async () => {
          showAll = !showAll;
          await load();
          render();
        },
      }),
    );
  }
  if (canMake && !editing)
    right.push(
      actionLink("library", {
        label: t("agents.examples"),
        onclick: () => {
          showExamples = !showExamples;
          render();
        },
      }),
    );
  if (canMake && !editing)
    right.push(
      actionLink("addcard", {
        primary: true,
        label: t("agents.new"),
        onclick: startNew,
      }),
    );
  if (page) {
    shell.replaceChildren(frame(agentPage()));
    return;
  }
  const agents = data.agents ?? [];
  shell.replaceChildren(
    frame(
      el("div", {}, [
        topbar(t("nav.agents"), t("agents.subtitle")),
        el("div", { class: "panel" }, [
          el("div", { class: "agenthead" }, [
            zoneLine(),
            el("div", { class: "dobuttons" }, right),
          ]),
          ...[actionsSwitch()].filter(Boolean),
          // Decision 0624: Run now was taken to send to everyone; it does not.
          ...(canMake
            ? [
                el("p", {
                  class: "muted sm",
                  id: "agents-runnow-hint",
                  text: t("agents.runnowhint"),
                }),
                // Decision 0626: today's AI summaries against the licence.
                ...(data.summaries
                  ? [
                      el("p", {
                        class: "muted sm",
                        id: "agents-summaries",
                        text: t("agents.summary.today")
                          .replace("{used}", String(data.summaries.used))
                          .replace("{max}", String(data.summaries.max)),
                      }),
                    ]
                  : []),
              ]
            : []),
        ]),
        ...(problem
          ? [el("div", { class: "note", id: "agents-note", text: problem })]
          : []),
        ...(showExamples && !editing ? [examplesPanel()] : []),
        ...(editing ? [formPanel()] : []),
        el("div", { class: "panel" }, [
          agents.length === 0
            ? el("p", {
                class: "muted",
                id: "agents-empty",
                text: canMake ? t("agents.empty") : t("agents.emptyadmin"),
              })
            : el("table", { class: "agenttable" }, [
                el("thead", {}, [
                  el("tr", {}, [
                    el("th", { text: t("agents.col.agent") }),
                    el("th", { text: t("agents.col.orgs") }),
                    el("th", { text: t("agents.col.when") }),
                    el("th", { text: t("agents.col.lastrun") }),
                    el("th", { text: t("agents.col.next") }),
                    el("th", {}),
                  ]),
                ]),
                el(
                  "tbody",
                  {},
                  agents.flatMap((a) =>
                    agentRow({ ...a, isMine: a.authorId === data.me }),
                  ),
                ),
              ]),
        ]),
        ...(data.canManageAll ? [logPanel()] : []),
      ]),
    ),
  );
}

export async function open() {
  setCurrentScreen("agents");
  editing = null;
  draft = null;
  problem = "";
  openRuns = new Map();
  page = null;
  agentLog = null;
  showExamples = false;
  const ok = await load();
  if (!ok) data = null;
  render();
}

// --- The agent's own page — decision 0627 -------------------------------------

/** Opened from a note on the task list, or a link: the Agents screen at that agent. */
export async function openAgentById(id) {
  await open();
  await openAgentPage(id);
}

async function openAgentPage(id) {
  const [one, runs] = await Promise.all([
    call(`/api/agents/${encodeURIComponent(id)}`),
    call(`/api/agents/${encodeURIComponent(id)}/runs`),
  ]);
  if (!one.ok) {
    problem = why(one.body);
    page = null;
    render();
    return;
  }
  const list = runs.ok ? (runs.body?.runs ?? []) : [];
  page = { id, body: one.body, runs: list, runId: list[0]?.id ?? null };
  problem = "";
  render();
}

function backToList() {
  page = null;
  render();
}

/** What a plan version changed from the one before, as the plan's step names. */
export function changedSteps(plan, before) {
  if (!before) return [];
  const same = (a, b) =>
    JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const steps = [];
  if (!same(plan.schedule, before.schedule)) steps.push("when");
  if (!same(plan.report, before.report) || !same(plan.orgIds, before.orgIds))
    steps.push("gather");
  if (!same(plan.options, before.options)) steps.push("shape");
  if ((plan.summary !== false) !== (before.summary !== false))
    steps.push("summarise");
  if ((plan.action ?? null) !== (before.action ?? null)) steps.push("act");
  if (
    !same(plan.deliver, before.deliver) ||
    !same(
      [...(plan.recipients ?? [])].sort(),
      [...(before.recipients ?? [])].sort(),
    )
  )
    steps.push("deliver");
  return steps;
}

/** One run, step by step, as in the design's mock-up 3. */
export function runSteps(run) {
  const steps = [];
  if (run.late) steps.push(t("agents.page.step.late"));
  if (run.rowCount !== null && run.rowCount !== undefined)
    steps.push(
      t("agents.page.step.gathered").replace("{n}", String(run.rowCount)) +
        ((run.totals ?? []).length
          ? ` · ${(run.totals ?? [])
              .map((x) =>
                x.currency
                  ? `${Number(x.total ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${x.currency}`
                  : String(x.count),
              )
              .join(" · ")}`
          : ""),
    );
  else if (run.status === "nothing") steps.push(t("agents.page.step.nothing"));
  const summaries = summaryWords(run.deliveries);
  if (summaries) steps.push(summaries);
  for (const d of run.deliveries ?? [])
    steps.push(
      `${d.userName} ${t(`agents.channel.${d.channel}`)}: ${d.status === "failed" ? `${t("agents.run.failed")}${d.error ? ` (${words("agents.runerror", d.error)})` : ""}` : t("agents.page.step.sent")}`,
    );
  if (run.status === "failed" && run.error && !(run.deliveries ?? []).length)
    steps.push(
      `${t("agents.run.failed")}: ${words("agents.runerror", run.error)}`,
    );
  return steps;
}

/** An event in the agent log, in words. */
export function eventWords(e) {
  const by = e.by?.name ?? t("agents.event.byvibefinance");
  return t(`agents.event.${e.kind}`)
    .replace("{by}", by)
    .replace("{version}", String(e.detail?.version ?? ""))
    .replace("{from}", String(e.detail?.from ?? ""))
    .replace("{to}", String(e.detail?.to ?? ""));
}

function section(id, heading, children) {
  return el("div", { class: "panel agentsection", id }, [
    el("h3", { text: heading }),
    ...children,
  ]);
}

function agentPage() {
  const { body, runs } = page;
  const agent = { ...body.agent, isMine: body.agent.authorId === data?.me };
  const removed = agent.status === "removed";
  const run = runs.find((r) => r.id === page.runId) ?? null;
  const zoneName = zone();
  const buttons = [
    actionLink("back", { label: t("agents.page.back"), onclick: backToList }),
  ];
  if (!removed && agent.isMine && hasMyPermission("AP.Agents"))
    buttons.push(
      actionLink("rename", {
        label: t("agents.edit"),
        onclick: () => {
          page = null;
          startEdit(agent);
        },
      }),
    );

  const runList = el(
    "div",
    { class: "agentrunlist", id: "agent-page-runs" },
    runs.length === 0
      ? [el("p", { class: "muted sm", text: t("agents.noruns") })]
      : runs.map((r) =>
          el(
            "button",
            {
              type: "button",
              class: `agentrunpick${r.id === page.runId ? " on" : ""}`,
              "data-run": r.id,
              onclick: () => {
                page.runId = r.id;
                render();
              },
            },
            [
              el("span", {
                text: `${when(r.startedAt)}${r.trigger === "now" ? ` · ${t("agents.trigger.now")}` : ""}`,
              }),
              el("span", {
                class: `rmpill ${r.status === "delivered" ? "ok" : r.status === "failed" ? "bad" : "q"}`,
                text: t(`agents.run.${r.status}`),
              }),
            ],
          ),
        ),
  );
  const runDetail = run
    ? el("div", { class: "agentrundetail", id: "agent-page-run" }, [
        el("h4", {
          text: [
            when(run.startedAt),
            run.planVersion
              ? t("agents.planv").replace("{n}", String(run.planVersion))
              : "",
          ]
            .filter(Boolean)
            .join(" · "),
        }),
        el(
          "ol",
          { class: "agentsteps" },
          runSteps(run).map((step) => el("li", { text: step })),
        ),
      ])
    : el("div", {});

  const versions = body.versions ?? [];
  const versionCards = versions.map((v, i) => {
    const before = versions[i + 1]?.plan ?? null;
    const changed = changedSteps(v.plan, before);
    const lines = planLines(
      {
        ...v.plan,
        orgIds: v.plan.orgIds ?? [],
        recipients: v.plan.recipients ?? [],
      },
      {
        orgs: v.plan.orgs ?? [],
        managers: v.plan.people ?? [],
        zone: zoneName,
      },
    );
    return el(
      "div",
      {
        class: `agentversion${v.version === agent.planVersion ? " current" : ""}`,
        "data-version": String(v.version),
      },
      [
        el("div", { class: "agentversionhead" }, [
          el("b", {
            text: t("agents.planv").replace("{n}", String(v.version)),
          }),
          el("span", {
            class: "muted sm",
            text: ` · ${when(v.createdAt)} · ${v.createdBy}`,
          }),
          ...(v.version === agent.planVersion
            ? [
                el("span", {
                  class: "rmpill ok",
                  text: t("agents.page.current"),
                }),
              ]
            : []),
        ]),
        ...(v.description
          ? [
              el("p", {
                class: "agentversionwords",
                text: `\u201c${v.description}\u201d`,
              }),
            ]
          : []),
        ...(changed.length
          ? [
              el("p", {
                class: "muted sm agentversionchanged",
                text: t("agents.page.changed").replace(
                  "{steps}",
                  changed.map((k) => t(`agents.plan.${k}`)).join(", "),
                ),
              }),
            ]
          : []),
        el(
          "div",
          { class: "agentplanrows" },
          lines.map(([key, text]) =>
            el("div", { class: "agentplanrow", "data-step": key }, [
              el("span", {
                class: "agentplantag",
                text: t(`agents.plan.${key}`),
              }),
              el("span", { text: text ?? "—" }),
            ]),
          ),
        ),
      ],
    );
  });

  const recipients = el(
    "ul",
    { class: "agentpeople", id: "agent-page-people" },
    (body.recipients ?? []).map((p) =>
      el("li", {
        text: [
          p.name,
          p.author ? t("agents.page.author") : "",
          p.optedOutAt
            ? t("agents.page.stoppedon").replace("{when}", when(p.optedOutAt))
            : "",
        ]
          .filter(Boolean)
          .join(" · "),
      }),
    ),
  );

  const history = el(
    "ul",
    { class: "agentevents", id: "agent-page-history" },
    (body.events ?? []).map((e) =>
      el("li", { "data-kind": e.kind }, [
        el("span", { class: "muted sm", text: `${when(e.at)} · ` }),
        el("span", { text: eventWords(e) }),
      ]),
    ),
  );

  return el("div", { id: "agent-page" }, [
    topbar(agent.name, t("agents.page.subtitle")),
    el("div", { class: "panel" }, [
      el("div", { class: "agenthead" }, [
        el("div", { class: "sm" }, [
          el("div", {}, [
            statusPill(agent),
            el("span", {
              text: ` ${removed ? "" : scheduleWords(agent.schedule)}`,
            }),
          ]),
          el("div", {
            class: "muted sm",
            text: [
              reportName(agent.report),
              agent.orgs.map((o) => o.name).join(", "),
              deliveryWords(agent),
            ].join(" · "),
          }),
        ]),
        el("div", { class: "dobuttons" }, buttons),
      ]),
    ]),
    ...(problem
      ? [el("div", { class: "note", id: "agents-note", text: problem })]
      : []),
    section("agent-page-runsection", t("agents.page.runs"), [
      el("div", { class: "agentrunsgrid" }, [runList, runDetail]),
    ]),
    section("agent-page-versions", t("agents.page.versions"), versionCards),
    section("agent-page-recipients", t("agents.page.recipients"), [recipients]),
    // Decision 0631: what it prepared, and what became of each.
    ...((body.actions ?? []).length
      ? [
          section("agent-page-actions", t("agents.page.actions"), [
            el(
              "ul",
              { class: "agentevents", id: "agent-page-actionlist" },
              body.actions.map((a) =>
                el("li", { "data-status": a.status }, [
                  el("span", { class: "muted sm", text: `${when(a.preparedAt)} · ` }),
                  el("span", { text: actionWords(a) }),
                ]),
              ),
            ),
          ]),
        ]
      : []),
    section("agent-page-events", t("agents.page.history"), [history]),
  ]);
}

// --- The agent log — decision 0627 ---------------------------------------------

function logPanel() {
  const show = actionLink("expand", {
    label: agentLog ? t("agents.log.hide") : t("agents.log.show"),
    onclick: async () => {
      if (agentLog) {
        agentLog = null;
        render();
        return;
      }
      agentLog = "loading";
      render();
      const r = await call("/api/agent-events");
      agentLog = r.ok ? (r.body?.events ?? []) : [];
      render();
    },
  });
  const body =
    agentLog === null
      ? []
      : agentLog === "loading"
        ? [el("p", { class: "muted sm", text: t("agents.loading") })]
        : agentLog.length === 0
          ? [el("p", { class: "muted sm", text: t("agents.log.empty") })]
          : [
              el(
                "ul",
                { class: "agentevents", id: "agents-log" },
                agentLog.map((e) =>
                  el("li", { "data-kind": e.kind }, [
                    el("span", { class: "muted sm", text: `${when(e.at)} · ` }),
                    el("button", {
                      type: "button",
                      class: "agentopen",
                      text: e.agentName,
                      onclick: () => openAgentPage(e.agentId),
                    }),
                    el("span", { text: `: ${eventWords(e)}` }),
                  ]),
                ),
              ),
            ];
  return el("div", { class: "panel", id: "agents-log-panel" }, [
    el("div", { class: "agenthead" }, [
      el("div", {}, [
        el("h3", { text: t("agents.log.heading") }),
        el("p", { class: "muted sm", text: t("agents.log.sub") }),
      ]),
      el("div", { class: "dobuttons" }, [show]),
    ]),
    ...body,
  ]);
}
