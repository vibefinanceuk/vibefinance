import { t } from "/strings.js";
import { el, frame, topbar, setCurrentScreen, setMyAbsence } from "/tasks.js";
import { actionLink } from "/viewer.js";

/**
 * **Absence and cover — decision 0641.** A person marks themselves away
 * from a first day to the day they are back, naming who covers; an AP
 * Manager sees their team's absences and may amend or cancel one. While
 * someone is away, their open tasks pass to the cover, if the cover may
 * do them, and come back on their return. The server decides all of it;
 * this screen says it.
 */

let data = null; // GET /absences
let editing = null; // null, "new", or an absence
let draft = null;
let problem = "";

async function call(path, init) {
  try {
    const response = await fetch(path, init);
    return { ok: response.ok, status: response.status, body: await response.json().catch(() => null) };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}
const json = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function why(body) {
  const key = body?.reason ? `absence.error.${body.reason}` : null;
  const words = key ? t(key) : null;
  return words && words !== key ? words : (body?.error ?? t("absence.failed"));
}

async function load() {
  const r = await call("/api/absences");
  data = r.ok ? r.body : null;
  // Decision 0642: the top bar's button follows what this screen now knows.
  if (data) setMyAbsence({ awayUntil: (data.mine ?? []).find((a) => a.state === "away")?.returnsOn ?? null, covering: (data.covering ?? []).length });
  return r.ok;
}

/** A date in words, in the reader's language. */
export function day(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

const PILL = { planned: "q", away: "warn", back: "ok", cancelled: "bad" };
function statePill(a) {
  return el("span", { class: `rmpill ${PILL[a.state] ?? ""}`.trim(), text: t(`absence.state.${a.state}`) });
}

/** What became of their tasks, in words. */
export function tasksWords(a) {
  if (!a.passTasks) return t("absence.tasks.kept");
  const parts = [];
  if (a.state === "planned") parts.push(t("absence.tasks.willpass").replace("{cover}", a.coverName ?? ""));
  if (a.tasks.moved) parts.push(t("absence.tasks.moved").replace("{n}", String(a.tasks.moved)).replace("{cover}", a.coverName ?? ""));
  if (a.tasks.returned) parts.push(t("absence.tasks.returned").replace("{n}", String(a.tasks.returned)));
  for (const k of a.tasks.kept ?? []) {
    const [kind, what] = String(k.reason ?? "").split(":");
    parts.push(
      t(`absence.tasks.kept.${kind === "limit" ? "limit" : "permission"}`)
        .replace("{n}", String(k.count))
        .replace("{cover}", a.coverName ?? "")
        .replace("{what}", what ?? ""),
    );
  }
  if (a.state === "away" && !a.tasks.moved && !(a.tasks.kept ?? []).length) parts.push(t("absence.tasks.none"));
  return parts.join(" · ");
}

function startNew(userId) {
  editing = "new";
  const tomorrow = new Date(`${data.today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  draft = { userId: userId ?? data.me, startsOn: data.today, returnsOn: tomorrow.toISOString().slice(0, 10), coverUserId: "", passTasks: true, handBack: true, note: "" };
  problem = "";
  render();
}

function startEdit(a) {
  editing = a;
  draft = { userId: a.userId, startsOn: a.startsOn, returnsOn: a.returnsOn, coverUserId: a.coverUserId ?? "", passTasks: a.passTasks, handBack: a.handBack, note: a.note ?? "" };
  problem = "";
  render();
}

async function save() {
  const body = {
    startsOn: draft.startsOn,
    returnsOn: draft.returnsOn,
    coverUserId: draft.coverUserId || null,
    passTasks: draft.passTasks,
    handBack: draft.handBack,
    note: draft.note || null,
    ...(editing === "new" ? { userId: draft.userId } : {}),
  };
  const r =
    editing === "new"
      ? await call("/api/absences", json("POST", body))
      : await call(`/api/absences/${encodeURIComponent(editing.id)}`, json("PATCH", body));
  if (!r.ok) {
    problem = why(r.body);
    render();
    return;
  }
  problem = t(editing === "new" ? "absence.saved.new" : "absence.saved.edit");
  editing = null;
  draft = null;
  await load();
  render();
}

async function cancel(a) {
  const r = await call(`/api/absences/${encodeURIComponent(a.id)}/cancel`, json("POST", {}));
  problem = r.ok ? t("absence.saved.cancelled") : why(r.body);
  await load();
  render();
}

function field(label, control, id, hint) {
  return el("div", { class: "dofield" }, [
    el("label", { text: label, ...(id ? { for: id } : {}) }),
    control,
    ...(hint ? [el("div", { class: "muted sm", text: hint })] : []),
  ]);
}

function formPanel() {
  const forOther = draft.userId !== data.me;
  const people = [{ id: data.me, name: t("absence.me") }, ...(data.people ?? [])];
  const covers = data.covers?.[draft.userId] ?? [];
  const input = (id, type, value, onvalue) => {
    const node = el("input", { id, type, oninput: (e) => onvalue(e.target.value) });
    node.value = value ?? "";
    return node;
  };
  const tick = (id, checked, onvalue, label) => {
    const box = el("input", { id, type: "checkbox", onchange: (e) => onvalue(e.target.checked) });
    box.checked = checked;
    return el("label", { class: "absencetick", for: id }, [box, el("span", { text: label })]);
  };
  const who =
    editing === "new" && data.canManage
      ? (() => {
          const s = el(
            "select",
            {
              id: "absence-user",
              onchange: (e) => {
                draft.userId = e.target.value;
                draft.coverUserId = "";
                render();
              },
            },
            people.map((p) => el("option", { value: p.id, text: p.name })),
          );
          s.value = draft.userId;
          return [field(t("absence.form.who"), s, "absence-user")];
        })()
      : [];
  const cover = el(
    "select",
    {
      id: "absence-cover",
      onchange: (e) => {
        draft.coverUserId = e.target.value;
      },
    },
    [el("option", { value: "", text: t("absence.form.nocover") }), ...covers.map((c) => el("option", { value: c.id, text: c.name }))],
  );
  cover.value = draft.coverUserId ?? "";
  return el("div", { class: "panel", id: "absence-form" }, [
    el("div", { class: "cardhead" }, [
      el("h3", { text: editing === "new" ? (forOther ? t("absence.form.newfor") : t("absence.form.new")) : t("absence.form.edit") }),
      el("div", { class: "dobuttons" }, [
        actionLink("close", {
          label: t("absence.cancelform"),
          onclick: () => {
            editing = null;
            draft = null;
            problem = "";
            render();
          },
        }),
        actionLink("save", { primary: true, label: t("absence.save"), onclick: save }),
      ]),
    ]),
    ...who,
    el("div", { class: "dotwo" }, [
      field(t("absence.form.starts"), input("absence-starts", "date", draft.startsOn, (v) => (draft.startsOn = v)), "absence-starts"),
      field(t("absence.form.returns"), input("absence-returns", "date", draft.returnsOn, (v) => (draft.returnsOn = v)), "absence-returns", t("absence.form.returnshint")),
    ]),
    field(t("absence.form.cover"), cover, "absence-cover", t("absence.form.coverhint")),
    el("div", { class: "absenceticks" }, [
      tick("absence-pass", draft.passTasks, (v) => (draft.passTasks = v), t("absence.form.pass")),
      tick("absence-back", draft.handBack, (v) => (draft.handBack = v), t("absence.form.back")),
    ]),
    field(t("absence.form.note"), input("absence-note", "text", draft.note, (v) => (draft.note = v)), "absence-note"),
  ]);
}

function absenceRow(a, showWho) {
  const buttons = a.mayChange
    ? [
        actionLink("rename", { label: t("absence.amend"), onclick: () => startEdit(a) }),
        actionLink("discard", { label: t("absence.cancel"), onclick: () => cancel(a) }),
      ]
    : [];
  return el("tr", { "data-absence": a.id }, [
    ...(showWho ? [el("td", { text: a.userName })] : []),
    el("td", {}, [el("div", { text: `${day(a.startsOn)} – ${day(a.returnsOn)}` }), el("div", { class: "muted sm", text: t("absence.backon").replace("{day}", day(a.returnsOn)) })]),
    el("td", {}, [statePill(a)]),
    el("td", { text: a.coverName ?? "—" }),
    el("td", { class: "sm", text: tasksWords(a) }),
    el("td", {}, [el("div", { class: "dobuttons" }, buttons)]),
  ]);
}

function table(rows, showWho, id, empty) {
  if (rows.length === 0) return el("p", { class: "muted", id, text: empty });
  return el("table", { class: "absencetable", id }, [
    el("thead", {}, [
      el("tr", {}, [
        ...(showWho ? [el("th", { text: t("absence.col.who") })] : []),
        el("th", { text: t("absence.col.when") }),
        el("th", { text: t("absence.col.state") }),
        el("th", { text: t("absence.col.cover") }),
        el("th", { text: t("absence.col.tasks") }),
        el("th", {}),
      ]),
    ]),
    el("tbody", {}, rows.map((a) => absenceRow(a, showWho))),
  ]);
}

function render() {
  const shell = document.getElementById("shell");
  if (!shell) return;
  if (!data) {
    shell.replaceChildren(frame(el("div", {}, [topbar(t("nav.absence"), t("absence.subtitle")), el("div", { class: "warn", text: t("absence.failed") })])));
    return;
  }
  const right = editing
    ? []
    : [
        ...(data.canManage
          ? [actionLink("newperson", { label: t("absence.newfor"), onclick: () => startNew(data.people?.[0]?.id ?? data.me) })]
          : []),
        actionLink("addcard", { primary: true, label: t("absence.new"), onclick: () => startNew(data.me) }),
      ];
  shell.replaceChildren(
    frame(
      el("div", {}, [
        topbar(t("nav.absence"), t("absence.subtitle")),
        el("div", { class: "panel" }, [
          el("div", { class: "agenthead" }, [el("span", { class: "muted sm", text: t("absence.zone").replace("{zone}", data.timeZone ?? "") }), el("div", { class: "dobuttons" }, right)]),
          ...(data.covering?.length
            ? [
                el("p", {
                  id: "absence-covering",
                  text: t("absence.covering").replace(
                    "{who}",
                    data.covering.map((c) => t("absence.coveringone").replace("{name}", c.name).replace("{day}", day(c.returnsOn))).join(", "),
                  ),
                }),
              ]
            : []),
        ]),
        ...(problem ? [el("div", { class: "note", id: "absence-note-line", text: problem })] : []),
        ...(editing ? [formPanel()] : []),
        el("div", { class: "panel" }, [el("h3", { text: t("absence.mine") }), table(data.mine ?? [], false, "absence-mine", t("absence.mine.empty"))]),
        ...(data.canManage
          ? [el("div", { class: "panel" }, [el("h3", { text: t("absence.team") }), el("p", { class: "muted sm", text: t("absence.team.hint") }), table(data.team ?? [], true, "absence-team", t("absence.team.empty"))])]
          : []),
      ]),
    ),
  );
}

export async function open() {
  setCurrentScreen("absence");
  editing = null;
  draft = null;
  problem = "";
  await load();
  render();
}
