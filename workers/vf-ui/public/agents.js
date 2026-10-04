import { t } from "/strings.js";
import {
  el,
  frame,
  topbar,
  setCurrentScreen,
  hasMyPermission,
} from "/tasks.js";
import { actionLink } from "/viewer.js";

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
        el("div", { class: "agentname", text: agent.name }),
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
  return (data?.reports ?? []).filter((r) => r.orgIds.length > 0);
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
  };
  understood = null;
  stepsOpen = false;
  problem = "";
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
  };
  understood = null;
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
  const offered = reportsOffered();
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
      const allowed = offered.find((r) => r.id === v)?.orgIds ?? [];
      draft.orgIds = draft.orgIds.filter((id) => allowed.includes(id));
      if (draft.orgIds.length === 0 && allowed.length > 0)
        draft.orgIds = [allowed[0]];
      render();
    },
  );
  const orgs = (data.orgs ?? []).filter((o) => report?.orgIds.includes(o.id));
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
      optionFields(report),
      scheduleFields(),
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
        deliver: { ...d.deliver },
        recipients: [...(d.recipients ?? [])],
        description: r.body.text ?? draft.description,
      };
      understood = {
        refusals: r.body.refusals ?? [],
        missing: r.body.missing ?? [],
      };
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
      t("agents.plan.highlightdays").replace("{n}", String(o.highlightDays)),
    );
  if (o.withinDays !== undefined)
    shape.push(
      t("agents.plan.withindays").replace("{n}", String(o.withinDays)),
    );
  if (o.olderThanDays !== undefined)
    shape.push(
      t("agents.plan.olderthandays").replace("{n}", String(o.olderThanDays)),
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
    ["deliver", `${how}, ${who}`],
  ];
}

function planPanel() {
  if (!understood) return el("div", { id: "agent-plan", hidden: "hidden" });
  const lines = planLines(draft, {
    orgs: data.orgs,
    managers: data.managers,
    zone: zone(),
  });
  const missing = new Set(understood.missing);
  const missingWords = (key) =>
    t(
      `agents.plan.missing.${key === "when" ? "schedule" : missing.has("report") || !draft.report ? "report" : "orgs"}`,
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
          (key === "gather" && (missing.has("report") || missing.has("orgs")))
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
  return who ? `${how} · ${who}` : how;
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
      actionLink("addcard", {
        primary: true,
        label: t("agents.new"),
        onclick: startNew,
      }),
    );
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
          // Decision 0624: Run now was taken to send to everyone; it does not.
          ...(canMake
            ? [
                el("p", {
                  class: "muted sm",
                  id: "agents-runnow-hint",
                  text: t("agents.runnowhint"),
                }),
              ]
            : []),
        ]),
        ...(problem
          ? [el("div", { class: "note", id: "agents-note", text: problem })]
          : []),
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
  const ok = await load();
  if (!ok) data = null;
  render();
}
