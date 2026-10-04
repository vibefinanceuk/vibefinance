import { t } from "/strings.js";
import { el, frame, topbar, setCurrentScreen, hasMyPermission } from "/tasks.js";
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
let busy = false;

async function call(path, init) {
  try {
    const response = await fetch(path, init);
    return { ok: response.ok, status: response.status, body: await response.json().catch(() => null) };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}
const json = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** A refusal in words: the reason's own string where there is one, else what the server said. */
function why(body) {
  const key = body?.reason ? `agents.error.${body.reason}` : null;
  const words = key ? t(key) : null;
  if (words && words !== key) return body.reason === "limit_reached" ? words.replace("{n}", String(body.max ?? "")) : words;
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
  return d.toLocaleString([], { timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
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
      return at("agents.when.week").replace("{weekday}", t(`agents.weekday.${s.weekday}`));
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
  if (agent.status === "active") return el("span", { class: "rmpill ok", text: t("agents.status.active") });
  const reason = agent.pausedReason ? t(`agents.paused.${agent.pausedReason}`) : null;
  return el("span", { class: "rmpill q", title: reason ?? "", text: reason ?? t("agents.status.paused") });
}

function lastRunCell(agent) {
  const run = agent.lastRun;
  if (!run) return el("td", { class: "muted sm", text: t("agents.neverrun") });
  const cls = run.status === "delivered" ? "ok" : run.status === "failed" ? "bad" : "q";
  return el("td", {}, [
    el("span", { class: `rmpill ${cls}`, text: t(`agents.run.${run.status}`) }),
    el("div", { class: "muted sm", text: `${when(run.startedAt)}${run.late ? ` · ${t("agents.late")}` : ""}` }),
    ...(run.status === "failed" && run.error ? [el("div", { class: "muted sm", text: words("agents.runerror", run.error) })] : []),
  ]);
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
                  el("td", {}, [el("span", { class: `rmpill ${r.status === "delivered" ? "ok" : r.status === "failed" ? "bad" : "q"}`, text: t(`agents.run.${r.status}`) })]),
                  el("td", { class: "muted sm", text: [r.late ? t("agents.late") : "", r.rowCount !== null && r.rowCount !== undefined ? t("agents.rows").replace("{n}", String(r.rowCount)) : "", r.error ? words("agents.runerror", r.error) : ""].filter(Boolean).join(" · ") }),
                ])
              )
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
        ? actionLink("paused", { label: t("agents.pause"), onclick: () => act(() => call(`/api/agents/${encodeURIComponent(agent.id)}`, json("PATCH", { status: "paused" }))) })
        : actionLink("activate", {
            label: t("agents.start"),
            onclick: () =>
              act(async () => {
                const r = await call(`/api/agents/${encodeURIComponent(agent.id)}`, json("PATCH", { status: "active" }));
                if (!r.ok) problem = why(r.body);
              }),
          }),
      actionLink("post", {
        label: t("agents.runnow"),
        onclick: () =>
          act(async () => {
            const r = await call(`/api/agents/${encodeURIComponent(agent.id)}/run`, json("POST", {}));
            problem = r.ok ? t(`agents.ranow.${r.body.status}`) : why(r.body);
          }),
      }),
      actionLink("rename", { label: t("agents.edit"), onclick: () => startEdit(agent) })
    );
  }
  buttons.push(actionLink("expand", { label: t("agents.runs"), onclick: () => toggleRuns(agent) }));
  buttons.push(
    confirmRemove === agent.id
      ? el("span", { class: "agentconfirm" }, [
          el("span", { class: "sm", text: t("agents.removeconfirm") }),
          actionLink("retire", { label: t("agents.remove"), onclick: () => act(async () => { confirmRemove = null; await call(`/api/agents/${encodeURIComponent(agent.id)}`, { method: "DELETE" }); }) }),
          actionLink("close", { label: t("agents.cancel"), onclick: () => { confirmRemove = null; render(); } }),
        ])
      : actionLink("retire", { label: t("agents.remove"), onclick: () => { confirmRemove = agent.id; render(); } })
  );
  return [
    el("tr", { "data-agent": agent.id }, [
      el("td", {}, [
        el("div", { class: "agentname", text: agent.name }),
        el("div", { class: "muted sm", text: `${reportName(agent.report)}${showAll ? ` · ${agent.authorName}` : ""}` }),
      ]),
      el("td", { class: "sm", text: agent.orgs.map((o) => o.name).join(", ") }),
      el("td", {}, [el("div", { text: scheduleWords(agent.schedule) }), el("div", {}, [statusPill(agent)])]),
      lastRunCell(agent),
      el("td", { class: "sm", text: agent.status === "active" ? when(agent.nextRunAt) : "—" }),
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
  };
  problem = "";
  render();
}

function startEdit(agent) {
  editing = agent;
  draft = { name: agent.name, report: agent.report, orgIds: agent.orgs.map((o) => o.id), schedule: { ...agent.schedule } };
  problem = "";
  render();
}

function field(label, control, hint, id) {
  return el("div", { class: "dofield" }, [el("label", { text: label, ...(id ? { for: id } : {}) }), control, ...(hint ? [el("div", { class: "muted sm", text: hint })] : [])]);
}

function select(id, options, value, onchange) {
  const node = el("select", { id, onchange: (e) => onchange(e.target.value) }, options.map(([v, label]) => el("option", { value: String(v), text: label })));
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
    ["day", "workday", "week", "month", "once"].map((v) => [v, t(`agents.every.${v}`)]),
    s.every,
    (v) => {
      const base = { every: v, time: s.time };
      if (v === "week") base.weekday = s.weekday ?? 1;
      if (v === "month") base.day = s.day ?? 1;
      if (v === "once") base.date = s.date ?? new Date().toISOString().slice(0, 10);
      draft.schedule = base;
      render();
    }
  );
  const time = el("input", { type: "time", id: "agent-time", value: s.time, onchange: (e) => { draft.schedule.time = e.target.value; } });
  const extra = [];
  if (s.every === "week") {
    extra.push(field(t("agents.form.weekday"), select("agent-weekday", [1, 2, 3, 4, 5, 6, 7].map((d) => [d, t(`agents.weekday.${d}`)]), s.weekday, (v) => set({ weekday: Number(v) })), null, "agent-weekday"));
  }
  if (s.every === "month") {
    const days = [...Array.from({ length: 28 }, (_, i) => [i + 1, String(i + 1)]), ["last", t("agents.form.lastday")], ["lastWorking", t("agents.form.lastworkingday")]];
    extra.push(field(t("agents.form.day"), select("agent-day", days, s.day, (v) => set({ day: v === "last" || v === "lastWorking" ? v : Number(v) })), null, "agent-day"));
  }
  if (s.every === "once") {
    extra.push(field(t("agents.form.date"), el("input", { type: "date", id: "agent-date", value: s.date ?? "", onchange: (e) => { draft.schedule.date = e.target.value; } }), null, "agent-date"));
  }
  return el("div", { class: "agentwhen" }, [
    field(t("agents.form.every"), every, null, "agent-every"),
    field(t("agents.form.time"), time, t("agents.form.timehint").replace("{zone}", zone()), "agent-time"),
    ...extra,
  ]);
}

function formPanel() {
  const offered = reportsOffered();
  const report = offered.find((r) => r.id === draft.report) ?? offered[0];
  const name = el("input", { type: "text", id: "agent-name", value: draft.name, maxlength: "80", placeholder: t("agents.form.nameplaceholder"), oninput: (e) => { draft.name = e.target.value; } });
  const reportSelect = select(
    "agent-report",
    offered.map((r) => [r.id, reportName(r.id)]),
    report?.id,
    (v) => {
      draft.report = v;
      const allowed = offered.find((r) => r.id === v)?.orgIds ?? [];
      draft.orgIds = draft.orgIds.filter((id) => allowed.includes(id));
      if (draft.orgIds.length === 0 && allowed.length > 0) draft.orgIds = [allowed[0]];
      render();
    }
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
          draft.orgIds = e.target.checked ? [...new Set([...draft.orgIds, o.id])] : draft.orgIds.filter((id) => id !== o.id);
        },
      });
      box.checked = draft.orgIds.includes(o.id);
      return el("label", { class: "agentorg", for: `agent-org-${o.id}` }, [box, el("span", { text: o.name })]);
    })
  );
  const save = actionLink("save", {
    primary: true,
    label: editing === "new" ? t("agents.form.savepaused") : t("agents.form.save"),
    onclick: async () => {
      const body = { name: draft.name, report: report?.id, orgIds: draft.orgIds, schedule: draft.schedule };
      const r =
        editing === "new"
          ? await call("/api/agents", json("POST", body))
          : await call(`/api/agents/${encodeURIComponent(editing.id)}`, json("PATCH", body));
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
  const cancel = actionLink("close", { label: t("agents.cancel"), onclick: () => { editing = null; draft = null; problem = ""; render(); } });
  return el("div", { class: "panel agentform", id: "agent-form" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: editing === "new" ? t("agents.form.new") : t("agents.form.edit") }), el("div", { class: "dobuttons" }, [cancel, save])]),
    el("div", { class: "dotwo" }, [field(t("agents.form.name"), name, null, "agent-name"), field(t("agents.form.report"), reportSelect, report ? t(`agents.reporthint.${report.id}`) : null, "agent-report")]),
    field(t("agents.form.orgs"), orgBoxes, t("agents.form.orgshint")),
    scheduleFields(),
    el("p", { class: "muted sm", text: t("agents.form.delivery") }),
  ]);
}

// --- The time zone ------------------------------------------------------------

const ZONES = ["Europe/London", "Europe/Dublin", "Europe/Berlin", "Europe/Paris", "Europe/Amsterdam", "Europe/Madrid", "Europe/Zurich", "America/New_York", "America/Chicago", "America/Los_Angeles", "UTC"];
let zoneOpen = false;

function zoneLine() {
  const parts = [
    el("span", { text: t("agents.limit").replace("{used}", String(data.limit.used)).replace("{max}", String(data.limit.max)) }),
    el("span", { text: ` · ${t("agents.zone").replace("{zone}", zone())}` }),
  ];
  if (data.canSetTimeZone && !zoneOpen) parts.push(actionLink("rename", { label: t("agents.zonechange"), onclick: () => { zoneOpen = true; render(); } }));
  if (zoneOpen) {
    const choices = ZONES.includes(zone()) ? ZONES : [zone(), ...ZONES];
    const chooser = select("agent-zone", choices.map((z) => [z, z]), zone(), () => {});
    parts.push(
      chooser,
      actionLink("save", {
        label: t("agents.zonesave"),
        onclick: async () => {
          const r = await call("/api/agent-settings", json("PUT", { timeZone: chooser.value }));
          zoneOpen = false;
          problem = r.ok ? t("agents.zonesaved") : why(r.body);
          await load();
          render();
        },
      })
    );
  }
  return el("div", { class: "agentzone sm", id: "agent-zone-line" }, parts);
}

function render() {
  const shell = document.getElementById("shell");
  if (!shell) return;
  if (!data) {
    shell.replaceChildren(frame(el("div", {}, [topbar(t("nav.agents"), t("agents.subtitle")), el("div", { class: "warn", text: t("agents.failed") })])));
    return;
  }
  const canMake = hasMyPermission("AP.Agents");
  const right = [];
  if (data.canManageAll) {
    right.push(actionLink("users", { label: showAll ? t("agents.showmine") : t("agents.showall"), onclick: async () => { showAll = !showAll; await load(); render(); } }));
  }
  if (canMake && !editing) right.push(actionLink("addcard", { primary: true, label: t("agents.new"), onclick: startNew }));
  const agents = data.agents ?? [];
  shell.replaceChildren(
    frame(
      el("div", {}, [
        topbar(t("nav.agents"), t("agents.subtitle")),
        el("div", { class: "panel" }, [el("div", { class: "agenthead" }, [zoneLine(), el("div", { class: "dobuttons" }, right)])]),
        ...(problem ? [el("div", { class: "note", id: "agents-note", text: problem })] : []),
        ...(editing ? [formPanel()] : []),
        el("div", { class: "panel" }, [
          agents.length === 0
            ? el("p", { class: "muted", id: "agents-empty", text: canMake ? t("agents.empty") : t("agents.emptyadmin") })
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
                el("tbody", {}, agents.flatMap((a) => agentRow({ ...a, isMine: a.authorId === data.me }))),
              ]),
        ]),
      ])
    )
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
