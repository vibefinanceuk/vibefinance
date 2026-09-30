import { t } from "/strings.js";
import { el, frame, topbar, setCurrentScreen } from "/tasks.js";
import { actionLink } from "/viewer.js";

/**
 * **The mapping editor — decision 0561**, Routes phase 2, as mocked up and
 * approved: a supplier's own XML on the left, the EN 16931 invoice on the
 * right, and a line for each mapping between them, with an Fx where a
 * function changes the value on the way.
 *
 * Choose an element, then the Business Term it becomes (or the other way
 * round). Say what should happen to the value in plain words and the
 * function is compiled from the closed list, with worked examples from
 * the sample's own values, before it is accepted. Every change saves the
 * draft. Try runs the draft on its sample; Publish makes it the live
 * version and offers to reprocess what it may now read.
 *
 * Not yet: AI proposing the lines (slice 4), and trying several samples
 * (slice 5).
 */

let mappingId = null;
let data = null;
let def = null;
let selectedSource = null;
let selectedTarget = null;
let say = "";
let compiled = null;
let tried = null;
let publishResult = null;
let note = null;

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

async function load() {
  const result = await call("GET", `/supplier-mappings/${encodeURIComponent(mappingId)}`);
  if (!result.ok) return false;
  data = result.body;
  def = structuredClone(data.editing?.definition ?? { root: data.mapping.root, linesPath: null, lines: [] });
  return true;
}

const btName = (id) => {
  const key = `mapping.bt.${id.toLowerCase()}`;
  const found = t(key);
  return found === key ? id : found;
};
const targetOf = (id) => data.targets.find((x) => x.id === id);
const inLines = (path) => !!def.linesPath && path.startsWith(`${def.linesPath}/`);
const lineFor = (target) => def.lines.find((l) => l.target === target);

/** A line's source as a path from the root, whatever its scope. */
function absolute(line) {
  if (line.source === null) return null;
  return targetOf(line.target)?.line ? `${def.linesPath}/${line.source}` : line.source;
}
const sampleOf = (path) => data.described?.elements.find((e) => e.path === path)?.sample ?? null;
const lastSegment = (path) => path.split("/").pop();

async function save() {
  const result = await call("PUT", `/supplier-mappings/${encodeURIComponent(mappingId)}/draft`, { definition: def });
  if (!result.ok) {
    note = { text: result.body?.error ?? t("mapping.savefailed"), ok: false };
    return false;
  }
  if (data.editing) {
    data.editing.version = result.body.version;
    data.editing.status = "draft";
  }
  tried = null;
  publishResult = null;
  return true;
}

async function connect(source, target) {
  const tgt = targetOf(target);
  if (tgt.line !== inLines(source)) {
    note = { text: t(tgt.line ? "mapping.scope.line" : "mapping.scope.header"), ok: false };
    render();
    return;
  }
  def.lines = def.lines.filter((l) => l.target !== target);
  def.lines.push({ target, source: tgt.line ? source.slice(def.linesPath.length + 1) : source, fx: [], origin: "person" });
  selectedSource = null;
  selectedTarget = target;
  compiled = null;
  say = "";
  note = null;
  await save();
  render();
}

function pickSource(path) {
  if (selectedTarget && !lineFor(selectedTarget)) return connect(path, selectedTarget);
  selectedSource = selectedSource === path ? null : path;
  render();
}

function pickTarget(id) {
  if (selectedSource && !lineFor(id)) return connect(selectedSource, id);
  selectedTarget = id;
  selectedSource = null;
  compiled = null;
  const line = lineFor(id);
  say = line?.say ?? "";
  note = null;
  render();
}

// ---------------------------------------------------------------- the grid

function sourceColumn() {
  const elements = data.described?.elements ?? [];
  const header = elements.filter((e) => !inLines(e.path));
  const lines = elements.filter((e) => inLines(e.path));
  const byParent = new Map();
  for (const e of header) {
    const parent = e.path.split("/").slice(0, -1).join("/");
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(e);
  }
  const row = (e) => {
    const mapped = def.lines.some((l) => absolute(l) === e.path);
    const node = el(
      "button",
      {
        type: "button",
        class: `meel src${selectedSource === e.path ? " sel" : ""}${mapped ? "" : " unused"}`,
        "data-src": e.path,
        title: e.path,
      },
      [el("span", { class: "mep", text: lastSegment(e.path) }), el("span", { class: "mesv", text: e.sample })]
    );
    node.onclick = () => pickSource(e.path);
    return node;
  };
  return el("div", { class: "mecol" }, [
    el("h4", { text: t("mapping.receiving") }),
    el("div", { class: "meh4s", text: t("mapping.receivingsub").replace("{root}", data.mapping.root) }),
    ...[...byParent.entries()].flatMap(([parent, list]) => [el("div", { class: "megrp", text: lastSegment(parent) }), ...list.map(row)]),
    ...(lines.length > 0 ? [el("div", { class: "megrp", text: `${lastSegment(def.linesPath)} · ${t("mapping.eachline")}` }), ...lines.map(row)] : []),
  ]);
}

function targetColumn() {
  const row = (tgt) => {
    const line = lineFor(tgt.id);
    const node = el(
      "button",
      {
        type: "button",
        class: `meel tgt${selectedTarget === tgt.id ? " sel" : ""}${!line && tgt.required ? " miss" : ""}`,
        "data-tgt": tgt.id,
        ...(line && line.source !== null ? { "data-from": absolute(line) } : {}),
        ...(line && line.fx.length > 0 ? { "data-fx": "1" } : {}),
      },
      [
        el("span", { class: "mebt" }, [btName(tgt.id), ...(tgt.required ? [el("span", { class: "mereq", text: "*" })] : []), el("i", { text: tgt.id })]),
        ...(line && line.source === null ? [el("span", { class: "mest", text: t("mapping.fixed") })] : []),
        ...(!line && tgt.required ? [el("span", { class: "mest", text: t("mapping.needed") })] : []),
      ]
    );
    node.onclick = () => pickTarget(tgt.id);
    return node;
  };
  return el("div", { class: "mecol" }, [
    el("h4", { text: t("mapping.delivery") }),
    el("div", { class: "meh4s", text: t("mapping.deliverysub") }),
    el("div", { class: "megrp", text: t("mapping.invoice") }),
    ...data.targets.filter((x) => !x.line).map(row),
    el("div", { class: "megrp", text: t("mapping.invoiceline") }),
    ...data.targets.filter((x) => x.line).map(row),
  ]);
}

/** The lines between the columns, drawn once both are laid out. */
export function drawLines(grid) {
  grid.querySelector("svg.melines")?.remove();
  grid.querySelectorAll(".mefx").forEach((n) => n.remove());
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "melines");
  grid.append(svg);
  const box = grid.getBoundingClientRect();
  for (const tgt of grid.querySelectorAll("[data-from]")) {
    const src = grid.querySelector(`[data-src="${CSS.escape(tgt.dataset.from)}"]`);
    if (!src) continue;
    const a = src.getBoundingClientRect();
    const b = tgt.getBoundingClientRect();
    const x1 = a.right - box.left;
    const y1 = a.top + a.height / 2 - box.top;
    const x2 = b.left - box.left;
    const y2 = b.top + b.height / 2 - box.top;
    const mx = (x1 + x2) / 2;
    const sel = tgt.classList.contains("sel");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`);
    path.setAttribute("class", `meline${sel ? " sel" : ""}`);
    svg.append(path);
    if (tgt.dataset.fx) {
      const fx = el("span", { class: `mefx${sel ? " on" : ""}`, text: "Fx" });
      fx.style.left = `${mx}px`;
      fx.style.top = `${(y1 + y2) / 2}px`;
      grid.append(fx);
    }
  }
}

// ---------------------------------------------------------------- the side

function stepPills(steps) {
  return el(
    "div",
    { class: "mesteps" },
    steps.map((s) =>
      el("span", { class: "mestep" }, [
        t(`mapping.fn.${s.fn}`) === `mapping.fn.${s.fn}` ? s.fn : t(`mapping.fn.${s.fn}`),
        ...Object.values(s.args ?? {}).map((v) => el("span", { class: "mearg", text: ` ${v}` })),
      ])
    )
  );
}

function detailPanel() {
  if (!selectedTarget) {
    return el("div", { class: "panel" }, [
      el("div", { class: "cardhead" }, [el("h3", { text: t("mapping.howto") })]),
      el("p", { class: "muted sm", text: t("mapping.howtotext") }),
    ]);
  }
  const tgt = targetOf(selectedTarget);
  const line = lineFor(selectedTarget);
  const head = el("div", { class: "cardhead" }, [el("h3", {}, [btName(tgt.id), el("span", { class: "muted", text: ` ${tgt.id}` })])]);
  const required = el("p", { class: "muted sm", text: tgt.required ? t("mapping.required") : t("mapping.optional") });

  if (!line) {
    const input = el("input", { class: "meinput", type: "text", placeholder: t("mapping.fixedplaceholder") });
    return el("div", { class: "panel" }, [
      head,
      required,
      el("p", { class: "sm", text: t("mapping.choosesource") }),
      el("label", { class: "sm muted", text: t("mapping.orfixed") }),
      input,
      el("div", { class: "statebuttons mebtns" }, [
        actionLink("done", {
          label: t("mapping.usefixed"),
          onclick: async () => {
            if (input.value.trim() === "") return;
            def.lines.push({ target: tgt.id, source: null, fx: [{ fn: "always", args: { value: input.value.trim() } }], origin: "person" });
            await save();
            render();
          },
        }),
      ]),
    ]);
  }

  const from = absolute(line);
  const box = el("textarea", { class: "mesay", rows: "2", placeholder: t("mapping.sayplaceholder") });
  box.value = say;
  box.oninput = () => (say = box.value);
  const result =
    compiled?.target === tgt.id
      ? compiled.outcome.kind === "refused"
        ? [el("div", { class: "merefused", text: compiled.outcome.reason })]
        : [
            el("div", { class: "muted sm", text: t("mapping.understood") }),
            stepPills(compiled.outcome.steps),
            el("div", { class: "muted sm", text: t("mapping.examples") }),
            el(
              "table",
              { class: "meex" },
              compiled.outcome.examples.map((x) =>
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
                  line.fx = compiled.outcome.steps;
                  line.say = say;
                  compiled = null;
                  await save();
                  render();
                },
              }),
            ]),
          ]
      : [];

  return el("div", { class: "panel" }, [
    head,
    required,
    el("div", { class: "mekv" }, [
      el("span", { class: "l", text: t("mapping.from") }),
      el("span", { class: "ref", text: from ?? t("mapping.fixed") }),
      ...(from ? [el("span", { class: "l", text: t("mapping.sample") }), el("span", { class: "ref", text: sampleOf(from) ?? "—" })] : []),
    ]),
    el("h4", { class: "rmh4" }, [el("span", { class: "mefx static", text: "Fx" }), ` ${t("mapping.function")}`]),
    ...(line.fx.length > 0
      ? [...(line.say ? [el("div", { class: "mesaid", text: line.say })] : []), stepPills(line.fx)]
      : [el("p", { class: "muted sm", text: t("mapping.nofunction") })]),
    box,
    el("div", { class: "statebuttons mebtns" }, [
      actionLink("compile", {
        label: t("mapping.understand"),
        onclick: async () => {
          const r = await call("POST", `/supplier-mappings/${encodeURIComponent(mappingId)}/compile`, { target: tgt.id, source: from, say });
          compiled = r.ok ? { target: tgt.id, outcome: r.body } : { target: tgt.id, outcome: { kind: "refused", reason: r.body?.error ?? t("mapping.compilefailed") } };
          render();
        },
      }),
      ...(line.fx.length > 0
        ? [
            actionLink("discard", {
              label: t("mapping.removefunction"),
              onclick: async () => {
                line.fx = [];
                delete line.say;
                say = "";
                await save();
                render();
              },
            }),
          ]
        : []),
      actionLink("discard", {
        label: t("mapping.removeline"),
        onclick: async () => {
          def.lines = def.lines.filter((l) => l.target !== tgt.id);
          compiled = null;
          await save();
          render();
        },
      }),
    ]),
    ...result,
  ]);
}

function tryPanel() {
  if (publishResult) {
    const waiting = publishResult.waiting ?? [];
    return el("div", { class: "panel" }, [
      el("div", { class: "cardhead" }, [el("h3", { text: t("mapping.published").replace("{n}", String(publishResult.version)) })]),
      el("p", { class: "sm", text: waiting.length > 0 ? t("mapping.waiting").replace("{n}", String(waiting.length)) : t("mapping.nowaiting") }),
      ...(waiting.length > 0
        ? [
            el("div", { class: "statebuttons mebtns" }, [
              actionLink("release", {
                primary: true,
                label: t("mapping.reprocess").replace("{n}", String(waiting.length)),
                onclick: async () => {
                  const r = await call("POST", "/route-messages/reprocess", { ids: waiting });
                  const delivered = (r.body?.results ?? []).filter((x) => x.status === "delivered").length;
                  note = r.ok
                    ? { text: t("mapping.reprocessed").replace("{n}", String(waiting.length)).replace("{d}", String(delivered)), ok: delivered > 0 }
                    : { text: t(r.status === 403 ? "mapping.reprocessforbidden" : "mapping.reprocessfailed"), ok: false };
                  publishResult = { ...publishResult, waiting: [] };
                  render();
                },
              }),
            ]),
          ]
        : []),
    ]);
  }
  if (!tried) return null;
  if (tried.error) return el("div", { class: "panel" }, [el("p", { class: "merefused", text: tried.error })]);
  const failed = tried.en16931?.failed ?? [];
  const values = Object.keys(tried.facts ?? {}).length;
  return el("div", { class: "panel" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: t("mapping.tried").replace("{file}", tried.filename ?? "") })]),
    el("p", {
      class: "sm",
      text: t("mapping.triedsummary").replace("{v}", String(values)).replace("{l}", String((tried.lines ?? []).length)),
    }),
    ...(tried.problems.length > 0
      ? [
          el("h4", { class: "rmh4", text: t("mapping.problems") }),
          el(
            "ul",
            { class: "rmrules" },
            tried.problems.map((p) =>
              el("li", {}, [
                el("span", { class: "rmrule", text: p.target }),
                ` ${btName(p.target)}${p.line ? ` · ${t("mapping.linen").replace("{n}", String(p.line))}` : ""}: `,
                el("span", { text: p.reason }),
              ])
            )
          ),
        ]
      : [el("p", { class: "sm", text: t("mapping.noproblems") })]),
    el("h4", { class: "rmh4", text: t("routemonitor.checks") }),
    failed.length === 0
      ? el("span", { class: "rmpill ok", text: t("routemonitor.passed") })
      : el(
          "ul",
          { class: "rmrules" },
          failed.map((f) => {
            const key = `en16931.rule.${f.rule.toLowerCase()}`;
            return el("li", {}, [el("span", { class: "rmrule", text: f.rule }), ` ${t(key) === key ? "" : t(key)}`, ...(f.detail ? [el("span", { class: "muted", text: ` · ${f.detail}` })] : [])]);
          })
        ),
  ]);
}

function settingsPanel() {
  const name = el("input", { class: "meinput", type: "text", value: data.mapping.name });
  const senders = el("input", { class: "meinput", type: "text", value: (data.mapping.senders ?? []).join(", "), placeholder: t("mapping.sendersplaceholder") });
  const groups = el(
    "select",
    { class: "meinput" },
    [el("option", { value: "", text: t("mapping.nolines") }), ...(data.described?.groups ?? []).map((g) => el("option", { value: g, text: g }))]
  );
  groups.value = def.linesPath ?? "";
  groups.onchange = async () => {
    const kept = def.lines.filter((l) => !targetOf(l.target)?.line);
    const dropped = def.lines.length - kept.length;
    def.linesPath = groups.value || null;
    def.lines = kept;
    note = dropped > 0 ? { text: t("mapping.linesreset").replace("{n}", String(dropped)), ok: false } : null;
    await save();
    render();
  };
  return el("div", { class: "panel" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: t("mapping.settings") })]),
    el("div", { class: "mekv wide" }, [
      el("span", { class: "l", text: t("mapping.name") }),
      name,
      el("span", { class: "l", text: t("mapping.senders") }),
      senders,
      el("span", { class: "l", text: t("mapping.linesat") }),
      groups,
    ]),
    el("div", { class: "statebuttons mebtns" }, [
      actionLink("save", {
        onclick: async () => {
          const list = senders.value.split(",").map((s) => s.trim()).filter(Boolean);
          const r = await call("PUT", `/supplier-mappings/${encodeURIComponent(mappingId)}/draft`, {
            definition: def,
            name: name.value,
            senders: list.length > 0 ? list : null,
          });
          note = r.ok ? { text: t("mapping.saved"), ok: true } : { text: r.body?.error ?? t("mapping.savefailed"), ok: false };
          await load();
          render();
        },
      }),
    ]),
  ]);
}

function render() {
  const shell = document.getElementById("shell");
  if (!shell || !data) return;
  const editing = data.editing;
  const live = data.versions.find((v) => v.status === "live");
  const sub = [
    t("mapping.subtitle"),
    editing ? t(editing.status === "draft" ? "mapping.draftn" : "mapping.liven").replace("{n}", String(editing.version)) : "",
    live && editing?.status === "draft" ? t("mapping.livebeside").replace("{n}", String(live.version)) : "",
    editing?.sample ? t("mapping.samplefrom").replace("{file}", editing.sample.filename) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const mapped = def.lines.length;
  const missing = data.targets.filter((x) => x.required && !lineFor(x.id)).length;
  const withFx = def.lines.filter((l) => l.fx.length > 0).length;

  const grid = el("div", { class: "megrid" }, [sourceColumn(), el("div", {}), targetColumn()]);
  const main = el("div", { class: "panel" }, [
    el("div", { class: "cardhead" }, [
      el("h3", { text: t("mapping.heading").replace("{root}", data.mapping.root) }),
      el("div", { class: "statebuttons" }, [
        actionLink("backtest", {
          label: t("mapping.try"),
          onclick: async () => {
            const r = await call("POST", `/supplier-mappings/${encodeURIComponent(mappingId)}/try`);
            tried = r.ok ? r.body : { error: r.body?.error ?? t("mapping.tryfailed") };
            publishResult = null;
            render();
          },
        }),
        actionLink("publish", {
          primary: true,
          label: t("mapping.publish"),
          onclick: async () => {
            const r = await call("POST", `/supplier-mappings/${encodeURIComponent(mappingId)}/publish`);
            if (r.ok) {
              publishResult = r.body;
              tried = null;
              note = null;
              await load();
            } else if (r.body?.reason === "sample_problems") {
              tried = { filename: editing?.sample?.filename, facts: {}, lines: [], problems: r.body.problems, en16931: { failed: [] } };
              note = { text: t("mapping.publishrefused"), ok: false };
            } else {
              note = { text: r.body?.error ?? t("mapping.publishfailed"), ok: false };
            }
            render();
          },
        }),
        actionLink("back", {
          label: t("mapping.back"),
          onclick: async () => {
            const { open } = await import("/routes.js");
            await open();
          },
        }),
      ]),
    ]),
    el("p", {
      class: "muted sm",
      text: t("mapping.counts").replace("{m}", String(mapped)).replace("{f}", String(withFx)).replace("{r}", String(missing)),
    }),
    el("div", { class: "melegend" }, [
      el("span", {}, [el("span", { class: "mesw" }), t("mapping.legend.line")]),
      el("span", {}, [el("span", { class: "mefx static", text: "Fx" }), ` ${t("mapping.legend.fx")}`]),
      el("span", {}, [el("span", { class: "mereq", text: "*" }), ` ${t("mapping.legend.required")}`]),
    ]),
    ...(note ? [el("div", { class: `menote${note.ok ? " ok" : ""}`, text: note.text })] : []),
    data.described ? grid : el("p", { class: "muted sm", text: t("mapping.nosample") }),
  ]);

  shell.replaceChildren(
    frame(
      el("div", {}, [
        topbar(t("mapping.title").replace("{name}", data.mapping.name), sub),
        el("div", { class: "meed" }, [main, el("div", {}, [detailPanel(), ...[tryPanel()].filter(Boolean), settingsPanel()])]),
      ])
    )
  );
  requestAnimationFrame(() => {
    const g = document.querySelector(".megrid");
    if (g) drawLines(g);
  });
}

export async function open(id) {
  setCurrentScreen("routes");
  mappingId = id;
  selectedSource = null;
  selectedTarget = null;
  compiled = null;
  tried = null;
  publishResult = null;
  note = null;
  say = "";
  const ok = await load();
  if (!ok) {
    const shell = document.getElementById("shell");
    if (shell) shell.replaceChildren(frame(el("div", {}, [topbar(t("mapping.title").replace("{name}", ""), ""), el("div", { class: "warn", text: t("mapping.loadfailed") })])));
    return;
  }
  render();
}

/**
 * **A new mapping from a kept message part** — from the Route monitor's
 * "Map this format". Opens the editor on it, or says why not.
 */
export async function createFrom(messageId, partSeq) {
  const r = await call("POST", "/supplier-mappings", { messageId, partSeq });
  if (!r.ok) return { ok: false, reason: r.status === 403 ? "forbidden" : r.body?.reason ?? "failed" };
  await open(r.body.id);
  return { ok: true };
}
