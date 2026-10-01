import { t } from "/strings.js";
import { el, frame, topbar, setCurrentScreen } from "/tasks.js";
import { actionLink } from "/viewer.js";
import { httpsSection } from "/https-keys.js";
import {
  setSourcesRefresh,
  loadUnits,
  retireSource,
  openRenameSourceForm,
  orgPicker,
  slug,
  outcome,
} from "/sources.js";

/**
 * **Process routes — decision 0557**, in place of Sources, as mocked up
 * and agreed (the operator's refinement: Sources deliver to the process's
 * entry stage, Destinations read from its exit stage).
 *
 * One process as a flow: its Source instances on the left, fanning into
 * its entry stage (Intake); its stages in order; its Destination
 * instances on the right, reading from its exit stage (Payment
 * Eligible). A Source instance **is** a source, so choosing one opens the
 * same actions the Sources screen had (address, org, rename, retire), and
 * "Add a source" creates one here, in this process.
 *
 * The ERP Destination is shown, not yet configured: the export works as
 * before, from its own screen, until slice 4 makes it this Destination.
 */

const CARD_HEIGHT = 132;
const CARD_GAP = 12;

let data = { processes: [], process: null, sources: [], destinations: [] };
let processId = null;
let selected = null; // { kind: "source" | "destination", id }

async function load() {
  try {
    const q = processId ? `?process=${encodeURIComponent(processId)}` : "";
    const response = await fetch(`/api/process-routes${q}`);
    if (!response.ok) return false;
    data = await response.json();
    processId = data.process?.id ?? null;
    return true;
  } catch {
    return false;
  }
}

function stageName(id) {
  return data.process?.stages.find((s) => s.id === id)?.name ?? "—";
}

function pill(tone, text) {
  return el("span", { class: `rmpill ${tone}`, text });
}

/** What a Source instance is doing, in a pill or two. */
function sourceState(s, full = false) {
  if (s.status === "retired") return [pill("q", t("sources.retired"))];
  if (!s.route?.live) return [pill("q", t("processroutes.notlive"))];
  const pills = [];
  if (s.mechanism === "email") {
    pills.push(
      s.emailAddress
        ? pill(s.emailRouting === "active" ? "ok" : "warn", t(`routing.${s.emailRouting}`))
        : pill("warn", t("processroutes.noaddress"))
    );
  }
  // Decision 0580: an HTTPS source receives once it has a live key.
  if (s.mechanism === "https") {
    pills.push(s.liveKeys > 0 ? pill("ok", t("routing.active")) : pill("warn", t("processroutes.nokeys")));
  }
  if (s.failedOpen > 0) pills.push(pill("bad", t("processroutes.failedn").replace("{n}", String(s.failedOpen))));
  // The week's count where there is room for it: on the panel always, on
  // a card only when nothing more urgent is showing.
  if (s.receivedThisWeek > 0 && (full || s.failedOpen === 0)) {
    pills.push(el("span", { class: "muted sm", text: t("processroutes.thisweek").replace("{n}", String(s.receivedThisWeek)) }));
  }
  return pills;
}

function card(kind, item, lines, state) {
  const isSelected = selected?.kind === kind && selected.id === item.id;
  const retired = item.status === "retired" || item.status === "paused" || (kind === "source" && !item.route?.live);
  const node = el(
    "button",
    { type: "button", class: `prcard${retired ? " dim" : ""}${isSelected ? " sel" : ""}`, style: `height:${CARD_HEIGHT}px` },
    [
      el("div", { class: "t", text: t(`processroutes.${kind}`) }),
      el("div", { class: "v", text: item.name }),
      ...lines.map((l) => el("div", { class: "d", text: l })),
      el("div", { class: "s" }, state),
    ]
  );
  node.onclick = () => {
    selected = isSelected ? null : { kind, id: item.id };
    render();
  };
  return node;
}

/**
 * **The connectors, drawn to the cards.** One curve from each card's
 * middle to the flow's middle, as tall as the stack beside it, so however
 * many sources a process has, each is visibly joined to its entry stage.
 */
function bracket(count, side) {
  const n = Math.max(count, 1);
  const height = n * CARD_HEIGHT + (n - 1) * CARD_GAP;
  const mid = height / 2;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "prbracket");
  svg.setAttribute("viewBox", `0 0 44 ${height}`);
  svg.setAttribute("width", "44");
  svg.setAttribute("height", String(height));
  svg.setAttribute("aria-hidden", "true");
  for (let i = 0; i < count; i++) {
    const y = i * (CARD_HEIGHT + CARD_GAP) + CARD_HEIGHT / 2;
    const path = document.createElementNS(ns, "path");
    path.setAttribute(
      "d",
      side === "in" ? `M0 ${y} C22 ${y} 22 ${mid} 40 ${mid}` : `M4 ${mid} C22 ${mid} 22 ${y} 44 ${y}`
    );
    svg.append(path);
    if (side === "out") {
      const head = document.createElementNS(ns, "path");
      head.setAttribute("d", `M38 ${y - 5} L44 ${y} L38 ${y + 5}`);
      svg.append(head);
    }
  }
  if (side === "in" && count > 0) {
    const head = document.createElementNS(ns, "path");
    head.setAttribute("d", `M34 ${mid - 5} L41 ${mid} L34 ${mid + 5}`);
    svg.append(head);
  }
  return svg;
}

function flow() {
  const { process, sources, destinations } = data;
  const stages = process.stages;
  if (stages.length === 0) return el("p", { class: "muted", text: t("processroutes.nostages") });

  const sourceCards = sources.map((s) =>
    card(
      "source",
      s,
      [
        `${s.routeName} · v${s.route?.version ?? "—"}`,
        s.mechanism === "email" ? s.emailAddress ?? t("processroutes.noaddress") : t(`routes.gw.${s.mechanism}`),
      ],
      sourceState(s)
    )
  );
  const destinationCards = destinations.map((d) =>
    card(
      "destination",
      d,
      [`${d.routeName} · v${d.route?.version ?? "—"}`, t(`routes.gw.${d.route?.deliveryGateway}`)],
      [
        ...(d.status === "paused" ? [pill("warn", t("processroutes.status.paused"))] : []),
        ...(d.waiting === null || d.waiting === undefined ? [] : [pill(d.waiting > 0 ? "warn" : "q", t("processroutes.waiting").replace("{n}", String(d.waiting)))]),
      ]
    )
  );

  const stageBoxes = [];
  stages.forEach((s, i) => {
    const entry = s.id === process.entryStageId;
    const exit = s.id === process.exitStageId;
    stageBoxes.push(
      el("div", { class: `prstage${entry || exit ? " edge" : ""}` }, [
        el("div", { class: "sn", text: s.name }),
        ...(entry ? [el("div", { class: "sd", text: t("processroutes.sourcesdeliver") })] : []),
        ...(exit ? [el("div", { class: "sd", text: t("processroutes.destsread") })] : []),
      ])
    );
    if (i < stages.length - 1) stageBoxes.push(el("span", { class: "prarrow", text: "→" }));
  });

  const column = (kind, cards, stageId) =>
    el("div", { class: "prstack" }, [
      el("div", { class: "prcolh" }, [
        t(`processroutes.${kind}s`),
        el("span", { text: t(`processroutes.${kind === "source" ? "deliverto" : "readfrom"}`).replace("{stage}", stageName(stageId)) }),
      ]),
      ...(cards.length > 0 ? cards : [el("div", { class: "prempty", style: `height:${CARD_HEIGHT}px`, text: t(`processroutes.no${kind}s`) })]),
    ]);

  return el("div", { class: "prgrid" }, [
    column("source", sourceCards, process.entryStageId),
    bracket(sourceCards.length, "in"),
    el("div", { class: "prflow" }, stageBoxes),
    bracket(destinationCards.length, "out"),
    column("destination", destinationCards, process.exitStageId),
  ]);
}

/** The chosen Source instance: the Sources screen's own actions, here. */
function sourcePanel(s) {
  const actions =
    s.status === "retired"
      ? []
      : [
          ...(s.mechanism === "email" && !s.emailAddress
            ? [actionLink("addcard", { primary: true, label: t("sources.claim"), onclick: () => openCreateAddress(s) })]
            : []),
          actionLink("rename", { onclick: () => openRenameSourceForm(s) }),
          actionLink("retire", { onclick: () => retireSource(s) }),
        ];
  return el("div", { class: "panel prdetail" }, [
    el("div", { class: "cardhead" }, [
      el("h3", { text: `${t("processroutes.sourcetitle")}: ${s.name}` }),
      el("div", { class: "statebuttons" }, [...actions, actionLink("close", { onclick: () => { selected = null; render(); } })]),
    ]),
    el("p", { class: "muted sm", text: t("processroutes.sourcesub").replace("{route}", s.routeName).replace("{process}", data.process.name) }),
    el("div", { class: "prfields" }, [
      el("div", { class: "l", text: t("processroutes.field.route") }),
      el("div", { text: `${s.routeName} · ${t("routes.versionn").replace("{n}", String(s.route?.version ?? "—"))} (${t(s.route?.live ? "routes.live" : "routes.draft")})` }),
      el("div", { class: "l", text: t("processroutes.field.deliversto") }),
      el("div", { text: stageName(data.process.entryStageId) }),
      el("div", { class: "l", text: t("processroutes.field.gateway") }),
      el(
        "div",
        {},
        s.mechanism === "email"
          ? s.emailAddress
            ? [el("span", { class: "addr", text: s.emailAddress }), " ", pill(s.emailRouting === "active" ? "ok" : "warn", t(`routing.${s.emailRouting}`))]
            : [t("processroutes.noaddress")]
          : [t(`mechanism.${s.mechanism}`)]
      ),
      el("div", { class: "l", text: t("sources.org") }),
      el("div", {}, [s.status === "retired" ? el("span", { class: "muted", text: "—" }) : orgPicker(s)]),
      el("div", { class: "l", text: t("processroutes.field.status") }),
      el("div", {}, sourceState(s, true)),
    ]),
    // Decision 0578: an HTTPS source's address, keys, and how to send.
    s.mechanism === "https" ? httpsSection(s) : null,
  ].filter(Boolean));
}

/**
 * **Pause or resume the Destination — decision 0558.** Paused, it takes
 * nothing: its process's invoices stay ready, and the ERP export leaves
 * them until it is resumed.
 */
async function setDestinationStatus(d, status) {
  try {
    const response = await fetch(`/api/route-instances/${encodeURIComponent(d.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!response.ok) {
      const note = document.getElementById("sources-note");
      if (note) note.textContent = t("processroutes.pausefailed");
      return;
    }
    await load();
    render();
  } catch {
    const note = document.getElementById("sources-note");
    if (note) note.textContent = t("processroutes.pausefailed");
  }
}

function destinationPanel(d) {
  const pauseOrResume =
    d.status === "paused"
      ? actionLink("release", { primary: true, label: t("processroutes.resume"), onclick: () => setDestinationStatus(d, "active") })
      : actionLink("paused", { label: t("processroutes.pause"), onclick: () => setDestinationStatus(d, "paused") });
  const openExport = actionLink("download", {
    label: t("processroutes.openexport"),
    onclick: async () => {
      const { open: openErp } = await import("/erp-export.js");
      await openErp();
    },
  });
  return el("div", { class: "panel prdetail" }, [
    el("div", { class: "cardhead" }, [
      el("h3", { text: `${t("processroutes.destinationtitle")}: ${d.name}` }),
      el("div", { class: "statebuttons" }, [pauseOrResume, openExport, actionLink("close", { onclick: () => { selected = null; render(); } })]),
    ]),
    el("p", { class: "muted sm", text: t("processroutes.destsub").replace("{route}", d.routeName).replace("{process}", data.process.name) }),
    el("div", { class: "prfields" }, [
      el("div", { class: "l", text: t("processroutes.field.route") }),
      el("div", { text: `${d.routeName} · ${t("routes.versionn").replace("{n}", String(d.route?.version ?? "—"))}` }),
      el("div", { class: "l", text: t("processroutes.field.readsfrom") }),
      el("div", { text: `${stageName(data.process.exitStageId)} · ${t("processroutes.readsfromhint")}` }),
      el("div", { class: "l", text: t("processroutes.field.gateway") }),
      el("div", { text: t(`routes.gw.${d.route?.deliveryGateway}`) }),
      el("div", { class: "l", text: t("processroutes.field.status") }),
      el("div", {}, [pill(d.status === "active" ? "ok" : "warn", t(`processroutes.status.${d.status}`))]),
    ]),
    el("p", { class: "muted sm", text: t(d.status === "paused" ? "processroutes.pausednote" : "processroutes.erpnote") }),
  ]);
}

/**
 * **Create the address, with its mailbox name — decision 0582.** The
 * source's name is what people read; the mailbox name is the part before
 * the customer's own `.<customer>@…`, prefilled from the name, previewed
 * as it is typed, then issued. Never changed once suppliers have it.
 */
function openCreateAddress(s) {
  const problem = el("div", { class: "warn", id: "mailbox-problem" });
  const input = el("input", { type: "text", id: "mailbox-name", value: slug(s.name), autocomplete: "off" });
  const preview = el("code", { id: "mailbox-address" });
  const why = (body) =>
    body?.reason === "address_taken"
      ? t("processroutes.mailboxtaken")
      : body?.reason === "name_unusable"
        ? t("processroutes.mailboxunusable")
        : outcome(body?.reason) || body?.error || t("sources.failed");
  let asked = 0;
  const check = async () => {
    const ask = ++asked;
    try {
      const response = await fetch(`/api/sources/${encodeURIComponent(s.id)}/email?mailbox=${encodeURIComponent(input.value)}`);
      const body = await response.json();
      if (ask !== asked) return; // A later keystroke has asked since.
      preview.textContent = body.ok ? body.address : "—";
      problem.textContent = body.ok ? "" : why(body);
    } catch {
      if (ask === asked) problem.textContent = t("sources.failed");
    }
  };
  let timer = null;
  input.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(check, 250);
  };
  const close = () => backdrop.remove();
  const create = actionLink("addcard", {
    primary: true,
    label: t("sources.claim"),
    onclick: async () => {
      problem.textContent = "";
      try {
        const response = await fetch(`/api/sources/${encodeURIComponent(s.id)}/email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mailbox: input.value }),
        });
        const body = await response.json();
        if (!response.ok) {
          problem.textContent = why(body);
          return;
        }
        close();
        await load();
        render();
      } catch {
        problem.textContent = t("sources.failed");
      }
    },
  });
  const backdrop = el("div", { class: "backdrop" }, [
    el("div", { class: "popout praddpop", role: "dialog", "aria-label": t("processroutes.createaddress") }, [
      el("div", { class: "cardhead" }, [
        el("h3", { text: t("processroutes.createaddress") }),
        el("div", { class: "statebuttons" }, [create, actionLink("close", { onclick: close })]),
      ]),
      el("p", { class: "muted sm", text: t("processroutes.createaddresssub").replace("{name}", s.name) }),
      el("div", { class: "newsource stacked" }, [
        el("div", { class: "kf" }, [
          el("label", { for: "mailbox-name", text: t("processroutes.mailbox") }),
          input,
          el("div", { class: "muted sm", text: t("processroutes.mailboxhint") }),
        ]),
        el("div", { class: "kf" }, [el("label", { text: t("processroutes.willbe") }), el("div", { class: "httpscopy" }, [preview])]),
      ]),
      problem,
    ]),
  ]);
  backdrop.onclick = (e) => {
    if (e.target === backdrop) close();
  };
  document.body.append(backdrop);
  input.focus();
  check();
}

/** Add a source to this process: its name and how it arrives. */
function openAddSource() {
  const problem = el("div", { class: "warn" });
  const nameInput = el("input", { type: "text", placeholder: t("sources.nameexample") });
  const preview = el("div", { class: "muted slugpreview" });
  nameInput.oninput = () => {
    preview.textContent = slug(nameInput.value);
  };
  const mechanism = el("select", {});
  for (const value of ["email", "https", "sftp", "file_import", "edi"]) {
    mechanism.append(el("option", { value, text: t(`mechanism.${value}`) }));
  }
  const close = () => backdrop.remove();
  const create = actionLink("create", {
    primary: true,
    onclick: async () => {
      problem.textContent = "";
      const name = nameInput.value.trim();
      const id = slug(name);
      if (name === "") return void (problem.textContent = t("sources.needname"));
      if (id === "") return void (problem.textContent = t("sources.needletters"));
      if (id.length > 40) return void (problem.textContent = t("sources.toolong"));
      try {
        const response = await fetch(`/api/processes/${encodeURIComponent(processId)}/sources`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, name, mechanism: mechanism.value }),
        });
        const body = await response.json();
        if (!response.ok) {
          problem.textContent = outcome(body.reason) || body.error || t("sources.failed");
          return;
        }
        backdrop.remove();
        selected = { kind: "source", id };
        await load();
        render();
      } catch {
        problem.textContent = t("sources.failed");
      }
    },
  });
  const backdrop = el("div", { class: "backdrop" }, [
    el("div", { class: "popout praddpop", role: "dialog", "aria-label": t("processroutes.addsource") }, [
      el("div", { class: "cardhead" }, [
        el("h3", { text: t("processroutes.addsource") }),
        el("div", { class: "statebuttons" }, [create, actionLink("close", { onclick: close })]),
      ]),
      el("p", { class: "muted sm", text: t("processroutes.addsourcesub").replace("{process}", data.process.name).replace("{stage}", stageName(data.process.entryStageId)) }),
      el("div", { class: "newsource stacked" }, [
        el("div", { class: "kf" }, [el("label", { text: t("sources.name") }), nameInput, preview]),
        el("div", { class: "kf" }, [el("label", { text: t("processroutes.howarrives") }), mechanism]),
      ]),
      problem,
    ]),
  ]);
  backdrop.onclick = (e) => {
    if (e.target === backdrop) close();
  };
  document.body.append(backdrop);
  nameInput.focus();
}

function processChips() {
  return el(
    "div",
    { class: "rmfilters" },
    data.processes.map((p) => {
      const b = el("button", { type: "button", class: `rmchip${p.id === processId ? " on" : ""}`, text: p.name });
      b.onclick = async () => {
        processId = p.id;
        selected = null;
        await load();
        render();
      };
      return b;
    })
  );
}

function render() {
  const shell = document.getElementById("shell");
  if (!shell) return;
  const body = [];
  if (!data.process) {
    body.push(el("div", { class: "panel" }, [el("p", { class: "muted", text: t("sources.noprocess") })]));
  } else {
    body.push(
      el("div", { class: "panel prpanel" }, [
        el("div", { class: "cardhead" }, [
          el("h3", { text: data.process.name }),
          el("div", { class: "statebuttons" }, [actionLink("addcard", { label: t("processroutes.addsource"), onclick: openAddSource })]),
        ]),
        processChips(),
        flow(),
      ])
    );
    const chosen =
      selected?.kind === "source"
        ? data.sources.find((s) => s.id === selected.id)
        : selected?.kind === "destination"
          ? data.destinations.find((d) => d.id === selected.id)
          : null;
    if (chosen) body.push(selected.kind === "source" ? sourcePanel(chosen) : destinationPanel(chosen));
  }
  shell.replaceChildren(
    frame(
      el("div", {}, [
        topbar(t("processroutes.heading"), t("processroutes.subtitle")),
        // The Sources screen's own refusals land here (`note` in sources.js).
        el("div", { class: "problem", id: "sources-note", role: "status" }),
        ...body,
      ])
    )
  );
}

export async function open() {
  setCurrentScreen("processroutes");
  // A fresh visit opens on the flow alone, whatever was chosen last time.
  selected = null;
  setSourcesRefresh(async () => {
    await load();
    render();
  });
  await loadUnits();
  const ok = await load();
  render();
  if (!ok) {
    const note = document.getElementById("sources-note");
    if (note) note.textContent = t("processroutes.failed");
  }
}
