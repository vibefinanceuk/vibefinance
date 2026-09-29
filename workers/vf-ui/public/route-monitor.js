import { t } from "/strings.js";
import { el, frame, topbar, setCurrentScreen } from "/tasks.js";
import { actionLink } from "/viewer.js";

/**
 * **The Route monitor — decision 0556**, slice 2 of the Routes design
 * (`docs/design/routes-phase1-data-model.md`), as mocked up and agreed.
 *
 * Every message a Source received (decision 0555), for a customer's own
 * IT team: four counts, the messages with filters, and one message
 * opened beside them, showing which of the route's parts it got through,
 * what went wrong in plain words, the technical detail, the invoices it
 * made, its original files as they arrived, and its history.
 *
 * Read-only: reprocessing and dismissing come in slice 5. The words for
 * each error are the interface's (0132): the server sends a code.
 */

let data = { period: "today", summary: {}, sources: [], messages: [] };
let filter = { source: "", failedOnly: false, period: "today" };
let selectedId = null;
let detail = null;

const PARTS = ["gateway", "format", "translation", "model", "process"];

async function getJson(path) {
  try {
    const response = await fetch(path);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function load() {
  const q = new URLSearchParams();
  if (filter.source) q.set("source", filter.source);
  if (filter.failedOnly) q.set("status", "failed");
  q.set("period", filter.period);
  const body = await getJson(`/api/route-messages?${q}`);
  if (!body) return false;
  data = body;
  return true;
}

async function loadDetail(id) {
  selectedId = id;
  detail = id ? await getJson(`/api/route-messages/${encodeURIComponent(id)}`) : null;
}

/** Today's time alone; an earlier day's date and time. Local time, as a person reads it. */
function when(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const today = new Date().toDateString() === d.toDateString();
  return today ? time : `${d.toLocaleDateString()} ${time}`;
}

function size(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const STATUS_PILL = { delivered: "ok", partial: "warn", failed: "bad", received: "q", dismissed: "q" };

function statusPill(status) {
  return el("span", { class: `rmpill ${STATUS_PILL[status] ?? "q"}`, text: t(`routemonitor.status.${status}`) });
}

/**
 * **Which of the route's parts a message got through.** From its status
 * and the part that failed: everything before the failed part is done,
 * everything after it was not reached. A partial message got through,
 * with its translation only partly done.
 */
export function partStates(message) {
  const failedAt = message.status === "failed" ? PARTS.indexOf(message.failedPart) : -1;
  return PARTS.map((part, i) => {
    if (message.status === "delivered" || message.status === "partial") {
      return part === "translation" && message.status === "partial" ? "warn" : "ok";
    }
    if (failedAt >= 0) return i < failedAt ? "ok" : i === failedAt ? "bad" : "idle";
    // Still in progress: only the gateway is known to be done.
    return i === 0 ? "ok" : "idle";
  });
}

async function download(seq, filename) {
  try {
    const response = await fetch(`/api/route-messages/${encodeURIComponent(selectedId)}/parts/${seq}`);
    if (!response.ok) return false;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}

function tiles() {
  const s = data.summary ?? {};
  const tile = (key, value, tone) =>
    el("div", { class: `rmtile${tone && value > 0 ? ` ${tone}` : ""}` }, [
      el("div", { class: "k", text: t(`routemonitor.tile.${key}`) }),
      el("div", { class: "v", text: String(value ?? 0) }),
    ]);
  return el("div", { class: "rmtiles" }, [
    tile("received", s.receivedToday),
    tile("delivered", s.deliveredToday),
    tile("failed", s.failedOpen, "bad"),
    tile("waiting", s.waitingOverHour, "warn"),
  ]);
}

function chip(label, on, onclick) {
  const b = el("button", { class: `rmchip${on ? " on" : ""}`, type: "button", text: label });
  b.onclick = onclick;
  return b;
}

async function refilter(change) {
  filter = { ...filter, ...change };
  await load();
  render();
}

function filters() {
  return el("div", { class: "rmfilters" }, [
    chip(t("routemonitor.filter.allsources"), filter.source === "", () => refilter({ source: "" })),
    ...data.sources.map((s) => chip(s.name, filter.source === s.id, () => refilter({ source: s.id }))),
    chip(t("routemonitor.filter.unclaimed"), filter.source === "none", () => refilter({ source: "none" })),
    el("span", { class: "rmsep" }),
    chip(t("routemonitor.filter.failedonly"), filter.failedOnly, () => refilter({ failedOnly: !filter.failedOnly })),
    el("span", { class: "rmsep" }),
    ...["today", "7d", "30d"].map((p) => chip(t(`routemonitor.period.${p}`), filter.period === p, () => refilter({ period: p }))),
  ]);
}

/** What a message made, in a few words: "→ invoice INV-7", "no invoice made", "2 invoices". */
function outcomeLine(m) {
  if (m.invoices === 1 && m.firstInvoice) return t("routemonitor.made.one").replace("{number}", m.firstInvoice);
  if (m.invoices > 1) return t("routemonitor.made.many").replace("{n}", String(m.invoices));
  return t("routemonitor.made.none");
}

function messagesPanel() {
  const head = el("div", { class: "cardhead" }, [el("h3", { text: t("routemonitor.messages") })]);
  if (data.messages.length === 0) {
    return el("div", { class: "panel rmmessages" }, [head, filters(), el("p", { class: "muted sm", text: t("routemonitor.nomessages") })]);
  }
  return el("div", { class: "panel rmmessages" }, [
    head,
    filters(),
    el("table", { class: "rmtable" }, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", { text: t("routemonitor.col.time") }),
          el("th", { text: t("routemonitor.col.route") }),
          el("th", { text: t("routemonitor.col.message") }),
          el("th", { text: t("routemonitor.col.status") }),
        ]),
      ]),
      el(
        "tbody",
        {},
        data.messages.map((m) => {
          const classes = ["clickable", m.status === "failed" || m.status === "partial" ? "bad" : "", m.id === selectedId ? "sel" : ""]
            .filter(Boolean)
            .join(" ");
          const row = el("tr", { class: classes }, [
            el("td", { class: "rmtime", text: when(m.receivedAt) }),
            el("td", {}, [
              el("div", { text: m.sourceName ?? t("routemonitor.unclaimed") }),
              el("div", { class: "muted sm", text: t("routemonitor.from").replace("{who}", m.counterparty ?? "—") }),
            ]),
            el("td", {}, [
              el("div", { text: m.subject || t("routemonitor.nosubject") }),
              el("div", { class: "muted sm", text: outcomeLine(m) }),
            ]),
            el("td", {}, [
              statusPill(m.status),
              ...(m.failedPart ? [el("div", { class: "muted sm", text: t(`routemonitor.at.${m.failedPart}`) })] : []),
            ]),
          ]);
          row.onclick = async () => {
            await loadDetail(m.id);
            render();
          };
          return row;
        })
      ),
    ]),
  ]);
}

function chain(message) {
  const states = partStates(message);
  return el(
    "div",
    { class: "rmchain" },
    PARTS.map((part, i) =>
      el("div", { class: `rmpart ${states[i]}` }, [
        el("div", { class: "k", text: t(`routemonitor.part.${part}`) }),
        el("div", { class: "d", text: t(`routemonitor.state.${states[i]}`) }),
      ])
    )
  );
}

/**
 * **What went wrong, in words, then what to do.** A code the interface
 * has no words for still says something: the generic explanation, with
 * the server's own reason below it in the technical detail.
 */
function explanation(message) {
  if (message.status !== "failed" && message.status !== "partial") return [];
  const code = message.status === "partial" ? "partial" : message.errorCode ?? "unknown";
  const known = t(`routemonitor.error.${code}.title`) !== `routemonitor.error.${code}.title`;
  const key = known ? code : "unknown";
  return [
    el("div", { class: "rmexplain" }, [
      el("div", { class: "h", text: t(`routemonitor.error.${key}.title`) }),
      el("p", { text: t(`routemonitor.error.${key}.body`) }),
      el("p", {}, [el("b", { text: `${t("routemonitor.tofix")} ` }), t(`routemonitor.error.${key}.fix`)]),
    ]),
  ];
}

function technical(message, parts) {
  // Each failed file's own reason where there is one; the message's
  // reason only when no file carries it (it repeats theirs otherwise).
  const failedParts = parts.filter((p) => p.outcome === "failed");
  const lines = [
    ...(message.errorCode ? [`code      ${message.errorCode}`] : []),
    ...(message.errorText && failedParts.length === 0 ? [`reason    ${message.errorText}`] : []),
    ...failedParts.map((p) => `part ${p.seq}    ${p.filename}: ${p.reason ?? "—"}`),
  ];
  return lines.length === 0 ? [] : [el("pre", { class: "rmtech", text: lines.join("\n") })];
}

function detailPanel() {
  if (!detail) {
    return el("div", { class: "panel rmdetail" }, [el("p", { class: "muted sm", text: t("routemonitor.pick") })]);
  }
  const { message, parts, events, invoices } = detail;
  const close = actionLink("close", {
    onclick: () => {
      selectedId = null;
      detail = null;
      render();
    },
  });
  return el("div", { class: "panel rmdetail" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: message.subject || message.id }), el("div", { class: "statebuttons" }, [close])]),
    el("p", {
      class: "muted sm",
      text: [message.sourceName ?? t("routemonitor.unclaimed"), when(message.receivedAt), message.id].join(" · "),
    }),
    chain(message),
    ...explanation(message),
    ...technical(message, parts),
    ...(invoices.length > 0
      ? [
          el("h4", { class: "rmh4", text: t("routemonitor.invoices") }),
          el(
            "ul",
            { class: "rmlist" },
            invoices.map((i) =>
              el("li", { text: [i.number ?? i.invoiceId, i.supplierName].filter(Boolean).join(" · ") })
            )
          ),
        ]
      : []),
    el("h4", { class: "rmh4", text: t("routemonitor.originals") }),
    parts.length === 0
      ? el("p", { class: "muted sm", text: t("routemonitor.nooriginals") })
      : el(
          "div",
          { class: "rmorigs" },
          parts.map((p) => {
            const label = p.role === "original" ? t("routemonitor.theemail") : p.filename;
            const b = el("button", { class: `rmorig${p.outcome === "failed" ? " bad" : ""}`, type: "button", title: t("routemonitor.download") }, [
              el("span", { text: label }),
              el("span", { class: "muted", text: size(p.bytes) }),
            ]);
            b.onclick = () => download(p.seq, p.role === "original" ? `${message.id}.eml` : p.filename);
            return b;
          })
        ),
    el("h4", { class: "rmh4", text: t("routemonitor.history") }),
    el(
      "ol",
      { class: "rmhistory" },
      events.map((e) =>
        el("li", {}, [
          el("span", { class: "rmtime", text: when(e.at) }),
          ` ${t(`routemonitor.event.${e.event}`)}`,
          ...(e.partSeq ? [el("span", { class: "muted", text: ` · ${t("routemonitor.partn").replace("{n}", String(e.partSeq))}` })] : []),
        ])
      )
    ),
  ]);
}

function render() {
  const shell = document.getElementById("shell");
  if (!shell) return;
  shell.replaceChildren(
    frame(
      el("div", {}, [
        topbar(t("routemonitor.heading"), t("routemonitor.subtitle")),
        el("div", { id: "routemonitor-note", class: "warn" }),
        tiles(),
        el("div", { class: "rmcols" }, [messagesPanel(), detailPanel()]),
      ])
    )
  );
}

export async function open() {
  setCurrentScreen("routemonitor");
  const ok = await load();
  if (ok && selectedId) await loadDetail(selectedId);
  render();
  if (!ok) {
    const note = document.getElementById("routemonitor-note");
    if (note) note.textContent = t("routemonitor.failed");
  }
}
