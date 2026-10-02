import { t } from "/strings.js";
import { el, frame, topbar, setCurrentScreen } from "/tasks.js";
import { actionLink } from "/viewer.js";
import { drawLines } from "/mapping-editor.js";

/**
 * **The outbound mapping editor — decision 0591**, slice 3 of the
 * connector framework: the mapping editor (0561) pointed outward.
 *
 * The VibeFinance invoice is on the left, with the values of a real
 * payment-eligible invoice. On the right is what the Destination sends:
 * the invoice's fields, then each line's, then each distribution's, each
 * named as the target expects, with a line from where its value comes and
 * an Fx where a function changes it on the way.
 *
 * Choose a field of the invoice to add it, or to use it for the field
 * chosen before. Choose a sent field to rename it, make it required, give
 * it a fixed value, or say in plain words what should happen to its value
 * (compiled from the closed list of functions, with worked examples from
 * the invoice, before it is accepted). Every change saves the draft. Try
 * lays out a real invoice; Publish makes the draft what the Destination
 * sends.
 */

let instanceId = null;
let data = null;
let def = null;
/** `{ level, i }` of the sent field chosen. */
let selected = null;
/** A field of the invoice chosen. */
let selectedSource = null;
let say = "";
let compiled = null;
let tried = null;
let note = null;
let invoiceId = null;

const LEVELS = ["invoice", "line", "distribution"];
const RANK = { invoice: 0, line: 1, distribution: 2 };

async function call(method, path, body) {
  try {
    const response = await fetch(`/api${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body: json };
  } catch {
    return { ok: false, status: 0, body: {} };
  }
}

const base = () => `/route-instances/${encodeURIComponent(instanceId)}/mapping`;

async function load() {
  const result = await call("GET", base());
  if (!result.ok) return false;
  data = result.body;
  def = structuredClone(data.editing?.definition ?? data.standard);
  invoiceId = invoiceId ?? data.sample?.invoiceId ?? data.candidates[0]?.id ?? null;
  return true;
}

/** Each change saves the draft; a refusal is said and the draft read again. */
async function save() {
  const r = await call("PUT", base(), { definition: def });
  if (!r.ok) {
    note = { text: r.body?.error ?? t("outmap.savefailed"), ok: false };
    await load();
  } else {
    note = null;
    const wasLive = data.editing?.status === "live";
    if (wasLive || !data.editing) await load();
  }
  render();
}

const fieldsAt = (level) => (level === "invoice" ? def.invoice : level === "line" ? def.lines.fields : def.distributions.fields);
const levelOf = (key) => data.sources.find((s) => s.key === key)?.level ?? null;
const allowed = (key, level) => levelOf(key) !== null && RANK[levelOf(key)] <= RANK[level];
const sourceName = (key) => {
  const k = `outmap.src.${key.toLowerCase()}`;
  return t(k) === k ? key : t(k);
};

/**
 * **Built from parts — decision 0605.** Stored with each look-up list by
 * its id; shown, and typed, with the list's name.
 */
const PART = /\{([^{}|]+)(?:\|([^{}]+))?\}/g;
const builtShown = (pattern) => String(pattern ?? "").replace(PART, (_m, source, list) => (list ? `{${source}|${data.lists.find((l) => l.id === list.trim())?.name ?? list}}` : `{${source}}`));
/** The pattern as typed, its lists' names turned to ids; or the name of a list there is none of. */
function builtStored(typed) {
  let unknown = null;
  const stored = typed.replace(PART, (_m, source, list) => {
    if (!list) return `{${source.trim()}}`;
    const hit = data.lists.find((l) => l.name.toLowerCase() === list.trim().toLowerCase() || l.id === list.trim());
    if (!hit) unknown = unknown ?? list.trim();
    return `{${source.trim()}|${hit ? hit.id : list.trim()}}`;
  });
  return { stored, unknown };
}

/** The value a source holds in the invoice shown: the first line's, the first distribution's. */
function sampleOf(key) {
  const inv = (tried?.invoice ?? data.sample?.invoice) || null;
  if (!inv) return null;
  const read = (obj, path) => path.split(".").reduce((n, p) => (n && typeof n === "object" ? n[p] : undefined), obj);
  const line = inv.lines?.[0];
  const dist = line?.distributions?.[0];
  const v = key.startsWith("line.")
    ? read(line, key.slice(5))
    : key === "distribution.sequence"
      ? dist
        ? 1
        : undefined
      : key.startsWith("distribution.")
        ? read(dist, key.slice(13))
        : read(inv, key);
  return v === undefined || v === null ? null : String(v);
}

// ---------------------------------------------------------------- the columns

function sourceColumn() {
  const used = new Set([...def.invoice, ...def.lines.fields, ...def.distributions.fields].map((f) => f.source).filter(Boolean));
  const row = (s) => {
    const node = el(
      "button",
      { type: "button", class: `meel src${selectedSource === s.key ? " sel" : ""}${used.has(s.key) ? "" : " unused"}`, "data-src": s.key, title: s.key },
      [el("span", { class: "mep", text: sourceName(s.key) }), el("span", { class: "mesv", text: sampleOf(s.key) ?? "—" })]
    );
    node.onclick = () => {
      selectedSource = s.key;
      compiled = null;
      render();
    };
    return node;
  };
  return el("div", { class: "mecol", id: "om-sources" }, [
    el("h4", { text: t("outmap.from") }),
    el("div", { class: "meh4s", text: data.sample ? t("outmap.fromsub").replace("{n}", tried?.invoice?.invoiceNumber ?? data.sample.invoice.invoiceNumber ?? "") : t("outmap.nosample") }),
    ...LEVELS.flatMap((level) => [el("div", { class: "megrp", text: t(`outmap.level.${level}`) }), ...data.sources.filter((s) => s.level === level).map(row)]),
  ]);
}

function targetColumn() {
  const row = (level, f, i) => {
    const sel = selected?.level === level && selected.i === i;
    const node = el(
      "button",
      {
        type: "button",
        class: `meel tgt${sel ? " sel" : ""}`,
        "data-tgt": `${level}:${i}`,
        ...(f.source ? { "data-from": f.source } : {}),
        ...(f.fx.length > 0 ? { "data-fx": "1" } : {}),
      },
      [
        el("span", { class: "mebt" }, [f.target, ...(f.required ? [el("span", { class: "mereq", text: "*" })] : [])]),
        f.built !== undefined
          ? el("span", { class: "mest", text: `${t("outmap.builtfrom")}: ${builtShown(f.built)}` })
          : f.source
            ? el("span", { class: "mest muted", text: f.source })
            : el("span", { class: "mest", text: `${t("outmap.fixed")}: ${f.fixed}` }),
      ]
    );
    node.onclick = () => {
      selected = { level, i };
      selectedSource = null;
      compiled = null;
      say = "";
      render();
    };
    return node;
  };
  const group = (level) => {
    const title =
      level === "invoice"
        ? t("outmap.level.invoice")
        : level === "line"
          ? `${t("outmap.level.line")} · ${def.lines.name ?? "—"}[]`
          : `${t("outmap.level.distribution")} · ${def.distributions.name ?? "—"}[] · ${t(`outmap.place.${def.distributions.place}`)}`;
    const fields = fieldsAt(level);
    return [
      el("div", { class: "megrp", text: title }),
      ...(fields.length === 0 ? [el("div", { class: "muted sm omempty", text: t("outmap.nofields") })] : fields.map((f, i) => row(level, f, i))),
    ];
  };
  return el("div", { class: "mecol", id: "om-targets" }, [
    el("h4", { text: t("outmap.to").replace("{name}", data.instance.name ?? "") }),
    el("div", { class: "meh4s", text: t("outmap.tosub") }),
    ...LEVELS.flatMap(group),
  ]);
}

// ---------------------------------------------------------------- the side

function stepPills(steps) {
  const list = (id) => data.lists.find((l) => l.id === id)?.name ?? id;
  return el(
    "div",
    { class: "mesteps" },
    steps.map((s) =>
      el("span", { class: "mestep" }, [
        t(`mapping.fn.${s.fn}`) === `mapping.fn.${s.fn}` ? s.fn : t(`mapping.fn.${s.fn}`),
        ...(s.fn === "look_up" ? [list(s.args?.list), t(s.args?.otherwise === "keep" ? "mapping.lookup.keep" : "mapping.lookup.refuse")] : Object.values(s.args ?? {})).map((v) =>
          el("span", { class: "mearg", text: ` ${v}` })
        ),
      ])
    )
  );
}

const lastSegment = (key) => key.split(".").pop();

/** A field of the invoice chosen: add it as a field sent, or use it for the one chosen before. */
function sourcePanel() {
  const key = selectedSource;
  const level = el(
    "select",
    { class: "meinput", id: "om-addlevel" },
    LEVELS.filter((l) => allowed(key, l)).map((l) => el("option", { value: l, text: t(`outmap.level.${l}`) }))
  );
  level.value = levelOf(key);
  const name = el("input", { class: "meinput", type: "text", id: "om-addname", value: lastSegment(key) });
  const problem = el("div", { class: "merefused", id: "om-addproblem" });
  const prior = selected ? fieldsAt(selected.level)[selected.i] : null;
  return el("div", { class: "panel", id: "om-source" }, [
    el("div", { class: "cardhead" }, [el("h3", {}, [sourceName(key), el("span", { class: "muted", text: ` ${key}` })])]),
    el("div", { class: "mekv" }, [el("span", { class: "l", text: t("outmap.sample") }), el("span", { class: "ref", text: sampleOf(key) ?? "—" })]),
    ...(prior && allowed(key, selected.level)
      ? [
          el("div", { class: "statebuttons mebtns" }, [
            actionLink("done", {
              label: t("outmap.usefor").replace("{target}", prior.target),
              onclick: async () => {
                prior.source = key;
                delete prior.fixed;
                delete prior.built;
                selectedSource = null;
                await save();
              },
            }),
          ]),
        ]
      : []),
    el("h4", { class: "rmh4", text: t("outmap.addas") }),
    el("div", { class: "mekv wide" }, [el("span", { class: "l", text: t("outmap.level") }), level, el("span", { class: "l", text: t("outmap.name") }), name]),
    el("div", { class: "statebuttons mebtns" }, [
      actionLink("addcard", {
        primary: true,
        label: t("outmap.add"),
        onclick: async () => {
          const target = name.value.trim();
          const fields = fieldsAt(level.value);
          if (fields.some((f) => f.target === target)) {
            problem.textContent = t("outmap.nametaken").replace("{name}", target);
            return;
          }
          fields.push({ target, source: key, fx: [] });
          selected = { level: level.value, i: fields.length - 1 };
          selectedSource = null;
          await save();
        },
      }),
    ]),
    problem,
  ]);
}

/** Nothing chosen: how it works, and a field with a fixed value. */
function howtoPanel() {
  const level = el("select", { class: "meinput", id: "om-fixedlevel" }, LEVELS.map((l) => el("option", { value: l, text: t(`outmap.level.${l}`) })));
  const name = el("input", { class: "meinput", type: "text", id: "om-fixedname" });
  const value = el("input", { class: "meinput", type: "text", id: "om-fixedvalue" });
  return el("div", { class: "panel" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: t("outmap.howto") })]),
    el("p", { class: "muted sm", text: t("outmap.howtotext") }),
    el("h4", { class: "rmh4", text: t("outmap.addfixed") }),
    el("div", { class: "mekv wide" }, [
      el("span", { class: "l", text: t("outmap.level") }),
      level,
      el("span", { class: "l", text: t("outmap.name") }),
      name,
      el("span", { class: "l", text: t("outmap.value") }),
      value,
    ]),
    el("div", { class: "statebuttons mebtns" }, [
      actionLink("addcard", {
        label: t("outmap.add"),
        onclick: async () => {
          if (!name.value.trim() || value.value.trim() === "") return;
          fieldsAt(level.value).push({ target: name.value.trim(), source: null, fixed: value.value.trim(), fx: [] });
          await save();
        },
      }),
    ]),
  ]);
}

function fieldPanel() {
  const { level, i } = selected;
  const f = fieldsAt(level)[i];
  if (!f) {
    selected = null;
    return howtoPanel();
  }
  const name = el("input", { class: "meinput", type: "text", id: "om-name", value: f.target });
  name.onchange = async () => {
    f.target = name.value.trim();
    await save();
  };
  const required = el("input", { type: "checkbox", id: "om-required" });
  required.checked = !!f.required;
  required.onchange = async () => {
    if (required.checked) f.required = true;
    else delete f.required;
    await save();
  };
  const fixed = el("input", { class: "meinput", type: "text", id: "om-fixed", value: f.source || f.built !== undefined ? "" : String(f.fixed ?? ""), placeholder: t("outmap.fixedplaceholder") });
  fixed.onchange = async () => {
    if (fixed.value.trim() === "") return;
    f.source = null;
    delete f.built;
    f.fixed = fixed.value.trim();
    await save();
  };
  // Decision 0605: or built from parts of the invoice, each looked up in a list where one is named.
  const builtProblemEl = el("div", { class: "merefused", id: "om-builtproblem" });
  const built = el("input", { class: "meinput", type: "text", id: "om-built", value: f.built !== undefined ? builtShown(f.built) : "", placeholder: t("outmap.builtplaceholder") });
  built.onchange = async () => {
    builtProblemEl.textContent = "";
    const typed = built.value.trim();
    if (typed === "") return;
    const { stored, unknown } = builtStored(typed);
    if (unknown) {
      builtProblemEl.textContent = t("outmap.builtunknownlist").replace("{name}", unknown);
      return;
    }
    f.source = null;
    delete f.fixed;
    f.built = stored;
    await save();
  };
  const box = el("textarea", { class: "mesay", rows: "2", id: "om-say", placeholder: t("mapping.sayplaceholder") });
  box.value = say;
  box.oninput = () => (say = box.value);
  const result = compiled
    ? compiled.kind === "refused"
      ? [el("div", { class: "merefused", text: compiled.reason })]
      : [
          el("div", { class: "muted sm", text: t("mapping.understood") }),
          stepPills(compiled.steps),
          el("div", { class: "muted sm", text: t("mapping.examples") }),
          el(
            "table",
            { class: "meex" },
            compiled.examples.map((x) =>
              el("tr", {}, [
                el("td", { class: "ref", text: x.input === null ? t("mapping.none") : x.input }),
                el("td", { text: "→" }),
                el("td", x.reason ? { class: "bad", text: x.reason } : { text: String(x.output) }),
              ])
            )
          ),
          el("div", { class: "statebuttons mebtns" }, [
            actionLink("done", {
              primary: true,
              label: t("mapping.accept"),
              onclick: async () => {
                f.fx = compiled.steps;
                f.say = say;
                compiled = null;
                await save();
              },
            }),
          ]),
        ]
    : [];
  return el("div", { class: "panel", id: "om-field" }, [
    el("div", { class: "cardhead" }, [
      el("h3", { text: f.target }),
      el("div", { class: "statebuttons" }, [
        actionLink("discard", {
          label: t("outmap.remove"),
          onclick: async () => {
            fieldsAt(level).splice(i, 1);
            selected = null;
            compiled = null;
            await save();
          },
        }),
      ]),
    ]),
    el("p", { class: "muted sm", text: t(`outmap.levelhint.${level}`) }),
    el("div", { class: "mekv wide" }, [
      el("span", { class: "l", text: t("outmap.name") }),
      name,
      el("span", { class: "l", text: t("outmap.comesfrom") }),
      el("span", { class: "ref", id: "om-from", text: f.built !== undefined ? t("outmap.builtfrom") : f.source ? `${sourceName(f.source)} · ${f.source}` : t("outmap.fixed") }),
      ...(f.source ? [el("span", { class: "l", text: t("outmap.sample") }), el("span", { class: "ref", text: sampleOf(f.source) ?? "—" })] : []),
      el("span", { class: "l", text: t("outmap.orfixed") }),
      fixed,
      el("span", { class: "l", text: t("outmap.orbuilt") }),
      el("div", {}, [built, el("div", { class: "muted sm", text: t("outmap.builthint") }), builtProblemEl]),
      el("span", { class: "l", text: t("outmap.required") }),
      el("label", { class: "sm" }, [required, ` ${t("outmap.requiredhint")}`]),
    ]),
    el("h4", { class: "rmh4" }, [el("span", { class: "mefx static", text: "Fx" }), ` ${t("mapping.function")}`]),
    ...(f.fx.length > 0 ? [...(f.say ? [el("div", { class: "mesaid", text: f.say })] : []), stepPills(f.fx)] : [el("p", { class: "muted sm", text: t("mapping.nofunction") })]),
    box,
    el("div", { class: "statebuttons mebtns" }, [
      actionLink("compile", {
        label: t("mapping.understand"),
        onclick: async () => {
          const r = await call("POST", `${base()}/compile`, { target: f.target, source: f.source, say, invoiceId });
          compiled = r.ok ? r.body : { kind: "refused", reason: r.body?.error ?? t("mapping.compilefailed") };
          render();
        },
      }),
      ...(f.fx.length > 0
        ? [
            actionLink("discard", {
              label: t("mapping.removefunction"),
              onclick: async () => {
                f.fx = [];
                delete f.say;
                say = "";
                await save();
              },
            }),
          ]
        : []),
    ]),
    ...result,
  ]);
}

/** The arrays' names, where distributions go, and what an empty value becomes. */
function settingsPanel() {
  const lines = el("input", { class: "meinput", type: "text", id: "om-linesname", value: def.lines.name ?? "" });
  const dists = el("input", { class: "meinput", type: "text", id: "om-distsname", value: def.distributions.name ?? "" });
  const place = el("select", { class: "meinput", id: "om-place" }, ["line", "invoice"].map((p) => el("option", { value: p, text: t(`outmap.place.${p}`) })));
  place.value = def.distributions.place;
  const empty = el("select", { class: "meinput", id: "om-empty" }, ["omit", "null"].map((p) => el("option", { value: p, text: t(`outmap.empty.${p}`) })));
  empty.value = def.empty;
  return el("div", { class: "panel", id: "om-settings" }, [
    el("div", { class: "cardhead" }, [
      el("h3", { text: t("outmap.settings") }),
      el("div", { class: "statebuttons" }, [
        actionLink("save", {
          onclick: async () => {
            def.lines.name = lines.value.trim() || null;
            def.distributions.name = dists.value.trim() || null;
            def.distributions.place = place.value;
            def.empty = empty.value;
            await save();
          },
        }),
      ]),
    ]),
    el("div", { class: "mekv wide" }, [
      el("span", { class: "l", text: t("outmap.linesname") }),
      lines,
      el("span", { class: "l", text: t("outmap.distsname") }),
      dists,
      el("span", { class: "l", text: t("outmap.place") }),
      place,
      el("span", { class: "l", text: t("outmap.empty") }),
      empty,
    ]),
  ]);
}

function tryPanel() {
  if (data.candidates.length === 0) {
    return el("div", { class: "panel", id: "om-try" }, [el("div", { class: "cardhead" }, [el("h3", { text: t("outmap.try") })]), el("p", { class: "muted sm", text: t("outmap.nocandidates") })]);
  }
  const pick = el(
    "select",
    { class: "meinput", id: "om-invoice" },
    data.candidates.map((c) => el("option", { value: c.id, text: `${c.number ?? c.id} · ${c.supplier ?? "—"}${c.total !== null ? ` · ${c.currency ?? ""} ${c.total}` : ""}` }))
  );
  if (invoiceId) pick.value = invoiceId;
  pick.onchange = () => {
    invoiceId = pick.value;
    tried = null;
  };
  return el("div", { class: "panel", id: "om-try" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: t("outmap.try") })]),
    el("p", { class: "muted sm", text: t("outmap.tryhint") }),
    pick,
    ...(tried
      ? [
          ...(tried.problems.length > 0
            ? [
                el("h4", { class: "rmh4", text: t("outmap.problems") }),
                el("ul", { class: "rmrules", id: "om-problems" }, tried.problems.map((p) => el("li", { text: p.words }))),
              ]
            : [el("p", { class: "sm ok", id: "om-noproblems", text: t("outmap.noproblems") })]),
          el("pre", { class: "httpspre", id: "om-output", text: JSON.stringify(tried.body, null, 2) }),
        ]
      : []),
  ]);
}

async function tryIt() {
  const r = await call("POST", `${base()}/try`, { invoiceId });
  tried = r.ok ? r.body : null;
  note = r.ok ? null : { text: r.body?.error ?? t("outmap.tryfailed"), ok: false };
  render();
}

async function publish() {
  const r = await call("POST", `${base()}/publish`, { invoiceId });
  if (r.ok) {
    note = { text: t("outmap.published").replace("{n}", String(r.body.version)).replace("{name}", data.instance.name ?? ""), ok: true };
    tried = null;
    await load();
  } else if (r.body?.reason === "sample_problems") {
    tried = r.body;
    note = { text: t("outmap.publishrefused"), ok: false };
  } else {
    note = { text: t(`outmap.error.${r.body?.reason}`) === `outmap.error.${r.body?.reason}` ? (r.body?.error ?? t("outmap.publishfailed")) : t(`outmap.error.${r.body?.reason}`), ok: false };
  }
  render();
}

function render() {
  const shell = document.getElementById("shell");
  if (!shell || !data) return;
  const editing = data.editing;
  const live = data.versions.find((v) => v.status === "live");
  const sub = [
    editing ? t(editing.status === "draft" ? "mapping.draftn" : "mapping.liven").replace("{n}", String(editing.version)) : "",
    live && editing?.status === "draft" ? t("mapping.livebeside").replace("{n}", String(live.version)) : "",
    t(data.using ? "outmap.sendingown" : "outmap.sendingstandard"),
  ]
    .filter(Boolean)
    .join(" · ");
  const count = def.invoice.length + def.lines.fields.length + def.distributions.fields.length;
  const withFx = [...def.invoice, ...def.lines.fields, ...def.distributions.fields].filter((f) => f.fx.length > 0).length;
  const grid = el("div", { class: "megrid" }, [sourceColumn(), el("div", {}), targetColumn()]);
  const main = el("div", { class: "panel" }, [
    el("div", { class: "cardhead" }, [
      el("h3", { text: t("outmap.heading") }),
      el("div", { class: "statebuttons" }, [
        actionLink("backtest", { label: t("outmap.trybutton"), onclick: tryIt }),
        ...(editing?.status === "draft" ? [actionLink("publish", { primary: true, label: t("outmap.publish"), onclick: publish })] : []),
        actionLink("back", {
          label: t("outmap.back"),
          onclick: async () => {
            const { open: openFlow } = await import("/process-routes.js");
            await openFlow({ kind: "destination", id: instanceId, processId: data.instance.processId });
          },
        }),
      ]),
    ]),
    el("p", { class: "muted sm", text: t("outmap.counts").replace("{n}", String(count)).replace("{f}", String(withFx)) }),
    el("div", { class: "melegend" }, [
      el("span", {}, [el("span", { class: "mesw" }), t("outmap.legend.line")]),
      el("span", {}, [el("span", { class: "mefx static", text: "Fx" }), ` ${t("mapping.legend.fx")}`]),
      el("span", {}, [el("span", { class: "mereq", text: "*" }), ` ${t("outmap.legend.required")}`]),
    ]),
    ...(note ? [el("div", { class: `menote${note.ok ? " ok" : ""}`, id: "om-note", text: note.text })] : []),
    grid,
  ]);
  const side = selectedSource ? sourcePanel() : selected ? fieldPanel() : howtoPanel();
  shell.replaceChildren(
    frame(
      el("div", {}, [
        topbar(t("outmap.title").replace("{name}", data.instance.name ?? ""), sub),
        el("div", { class: "meed" }, [main, el("div", {}, [side, tryPanel(), settingsPanel()])]),
      ])
    )
  );
  requestAnimationFrame(() => {
    const g = document.querySelector(".megrid");
    if (g) drawLines(g);
  });
}

export async function open(id) {
  // Its own screen for Help; the nav still lights Process routes.
  setCurrentScreen("outboundmapping");
  instanceId = id;
  selected = null;
  selectedSource = null;
  compiled = null;
  tried = null;
  note = null;
  say = "";
  invoiceId = null;
  const ok = await load();
  if (!ok) {
    const shell = document.getElementById("shell");
    if (shell) shell.replaceChildren(frame(el("div", {}, [topbar(t("outmap.title").replace("{name}", ""), ""), el("div", { class: "warn", text: t("outmap.loadfailed") })])));
    return;
  }
  render();
}

/** The same mapping again, after the org changes; Process routes if there is none. */
export async function reopen() {
  if (instanceId) return open(instanceId);
  const { open: openFlow } = await import("/process-routes.js");
  await openFlow();
}
