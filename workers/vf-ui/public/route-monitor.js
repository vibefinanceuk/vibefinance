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
/**
 * **The same five parts, the other way round — decision 0558.** An
 * outbound message starts in the process and ends at the gateway: the
 * ERP's file download, for the ERP export.
 */
const PARTS_OUT = ["process", "model", "translation", "format", "gateway"];
const partsFor = (message) => (message.direction === "out" ? PARTS_OUT : PARTS);
/** Undone is a dismissed export, and says so (0558). */
const statusKey = (m) => (m.status === "dismissed" && m.errorCode === "undone" ? "undone" : m.status);

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

function statusPill(m) {
  const key = statusKey(m);
  return el("span", { class: `rmpill ${key === "undone" ? "warn" : STATUS_PILL[m.status] ?? "q"}`, text: t(`routemonitor.status.${key}`) });
}

/**
 * **Which of the route's parts a message got through.** From its status
 * and the part that failed: everything before the failed part is done,
 * everything after it was not reached. A partial message got through,
 * with its translation only partly done.
 */
export function partStates(message) {
  const parts = partsFor(message);
  // A failed message, or a dismissed one that failed first (an undone
  // export failed at delivery): the part it failed at, and nothing after.
  const failedAt = message.status === "failed" || (message.status === "dismissed" && message.failedPart) ? parts.indexOf(message.failedPart === "delivery" ? "gateway" : message.failedPart) : -1;
  return parts.map((part, i) => {
    if (message.status === "delivered" || message.status === "partial") {
      return part === "translation" && message.status === "partial" ? "warn" : "ok";
    }
    if (failedAt >= 0) return i < failedAt ? "ok" : i === failedAt ? "bad" : "idle";
    // Still in progress: only the first part is known to be done.
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
    // Decision 0558: the Destinations messages go out on, too.
    ...(data.destinations ?? []).map((d) => chip(d.name, filter.source === d.id, () => refilter({ source: d.id }))),
    chip(t("routemonitor.filter.unclaimed"), filter.source === "none", () => refilter({ source: "none" })),
    el("span", { class: "rmsep" }),
    chip(t("routemonitor.filter.failedonly"), filter.failedOnly, () => refilter({ failedOnly: !filter.failedOnly })),
    el("span", { class: "rmsep" }),
    ...["today", "7d", "30d"].map((p) => chip(t(`routemonitor.period.${p}`), filter.period === p, () => refilter({ period: p }))),
  ]);
}

/** What a message made, in a few words: "→ invoice INV-7", "no invoice made", "2 invoices". */
function outcomeLine(m) {
  if (m.direction === "out") {
    return m.invoices === 1 && m.firstInvoice
      ? t("routemonitor.made.sentone").replace("{number}", m.firstInvoice)
      : t("routemonitor.made.sent").replace("{n}", String(m.invoices));
  }
  if (m.invoices === 1 && m.firstInvoice) return t("routemonitor.made.one").replace("{number}", m.firstInvoice);
  if (m.invoices > 1) return t("routemonitor.made.many").replace("{n}", String(m.invoices));
  return t("routemonitor.made.none");
}

function messagesPanel() {
  const head = el("div", { class: "cardhead" }, [
    el("h3", { text: t("routemonitor.messages") }),
    // Decision 0559: who is told, and when.
    el("div", { class: "statebuttons" }, [actionLink("systemalert", { label: t("routemonitor.alerts"), onclick: openAlerts })]),
  ]);
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
              el("div", {
                class: "muted sm",
                text: m.direction === "out" ? t("routemonitor.sentout") : t("routemonitor.from").replace("{who}", m.counterparty ?? "—"),
              }),
            ]),
            el("td", {}, [
              el("div", { text: m.subject || t("routemonitor.nosubject") }),
              el("div", { class: "muted sm", text: outcomeLine(m) }),
            ]),
            el("td", {}, [
              statusPill(m),
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
    partsFor(message).map((part, i) =>
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
/**
 * **What the failed files have in common — decision 0561.** When every
 * file that failed is a supplier's own XML, "check it is legible" is the
 * wrong advice: it needs a mapping, or its mapping could not read it.
 */
/** A supplier's own file, read through a supplier mapping: XML (0561) or CSV (0565). */
const SUPPLIER_FORMATS = ["supplier_xml", "supplier_csv"];

function supplierXmlCode(parts) {
  const failed = (parts ?? []).filter((p) => p.role === "attachment" && p.outcome === "failed");
  if (failed.length === 0 || !failed.every((p) => SUPPLIER_FORMATS.includes(p.format))) return null;
  // Decision 0565: a CSV has its own words where they differ from XML's.
  const csv = failed.every((p) => p.format === "supplier_csv") ? "_csv" : "";
  if (failed.some((p) => !p.mapping)) return `no_mapping${csv}`;
  // Decision 0563: a mapping came close, and the part says why it did not read.
  const miss = failed.find((p) => p.mapping?.miss)?.mapping.miss;
  return miss ?? `mapping_failed${csv}`;
}

function explanation(message, parts) {
  const undone = statusKey(message) === "undone";
  if (message.status !== "failed" && message.status !== "partial" && !undone) return [];
  const code =
    message.status === "failed" && supplierXmlCode(parts)
      ? supplierXmlCode(parts)
      : message.status === "partial"
        ? "partial"
        : message.errorCode ?? "unknown";
  const known = t(`routemonitor.error.${code}.title`) !== `routemonitor.error.${code}.title`;
  const key = known ? code : "unknown";
  return [
    // An undone export is dealt with, not waiting: amber, not red (0558).
    el("div", { class: `rmexplain${undone ? " done" : ""}` }, [
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

/**
 * **What each e-invoice was, and what the EN 16931 checks found —
 * decision 0560.** One line per attachment read as data: its format and
 * syntax, then either that it passed, that it was not checked (a Factur-X
 * MINIMUM or BASIC WL), or each rule it broke, in words, with the figures
 * the check found.
 */
export function formatChecks(parts) {
  const read = parts.filter((p) => p.format);
  if (read.length === 0) return [];
  return [
    el("h4", { class: "rmh4", text: t("routemonitor.checks") }),
    ...read.map((p) => {
      if (SUPPLIER_FORMATS.includes(p.format)) return supplierXmlCheck(p);
      const name = `${words("routes.format", p.format)}${p.syntax ? ` (${t(`routes.syntax.${p.syntax}`)})` : ""}`;
      const failed = p.en16931Failed;
      const verdict =
        failed === null
          ? el("span", { class: "rmpill q", text: t("routemonitor.notchecked") })
          : failed.length === 0
            ? el("span", { class: "rmpill ok", text: t("routemonitor.passed") })
            : el("span", { class: "rmpill bad", text: brokenCount(failed.length) });
      return el("div", { class: "rmfmt" }, [
        el("div", { class: "rmfmthead" }, [el("span", { class: "rmfmtname", text: `${p.filename}: ${name}` }), verdict]),
        ...(failed === null ? [el("div", { class: "muted sm", text: t("routemonitor.notcheckedwhy") })] : []),
        ...(failed && failed.length > 0
          ? [
              el(
                "ul",
                { class: "rmrules" },
                failed.map((f) =>
                  el("li", {}, [
                    el("span", { class: "rmrule", text: f.rule }),
                    // Keys are lower case (0013); the rule identifier is shown as it is.
                    el("span", { text: ` ${words("en16931.rule", f.rule.toLowerCase())}` }),
                    ...(f.detail ? [el("span", { class: "muted", text: ` · ${f.detail}` })] : []),
                  ])
                )
              ),
              el("div", { class: "muted sm", text: t("routemonitor.notstopped") }),
            ]
          : []),
      ]);
    }),
  ];
}

/**
 * **A supplier's own XML — decision 0561.** Which mapping read it, or
 * tried to, or that none exists yet; and the way to the editor: open the
 * mapping, or draw a new one from this very file.
 */
function supplierXmlCheck(p) {
  const openEditor = async () => {
    const editor = await import("/mapping-editor.js");
    if (p.mapping) {
      await editor.open(p.mapping.id);
      return;
    }
    const made = await editor.createFrom(selectedId, p.seq);
    if (!made.ok) note(t(made.reason === "forbidden" ? "routemonitor.mapforbidden" : "routemonitor.mapfailed"));
  };
  const captured = p.outcome === "captured";
  // Decision 0563: a mapping that came close, and why it did not read this file.
  const miss = !captured ? p.mapping?.miss ?? null : null;
  const mappingName = p.mapping ? p.mapping.name ?? p.mapping.id : "";
  const verdict = captured
    ? el("span", { class: `rmpill ${(p.en16931Failed ?? []).length > 0 ? "bad" : "ok"}`, text: (p.en16931Failed ?? []).length > 0 ? brokenCount(p.en16931Failed.length) : t("routemonitor.passed") })
    : miss
      ? el("span", { class: "rmpill q", text: t(miss === "not_published" ? "routemonitor.notpublished" : "routemonitor.notforsender") })
      : el("span", { class: `rmpill ${p.mapping ? "bad" : "q"}`, text: t(p.mapping ? "routemonitor.mappingfailed" : "routemonitor.nomapping") });
  const why = miss
    ? t(miss === "not_published" ? "routemonitor.notpublishedwhy" : "routemonitor.notforsenderwhy")
        .replace("{name}", mappingName)
        .replace("{sender}", detail?.message?.counterparty ?? "—")
    : p.mapping
      ? // Decision 0566: a failed file was tried, not read, and says why.
        captured
        ? t("routemonitor.readwith").replace("{name}", mappingName).replace("{n}", String(p.mapping.version))
        : `${t("routemonitor.triedwith").replace("{name}", mappingName).replace("{n}", String(p.mapping.version))} ${withoutMappingName(p.reason, mappingName, p.mapping.version)}`.trim()
      : t(p.format === "supplier_csv" ? "routemonitor.nomappingwhy_csv" : "routemonitor.nomappingwhy");
  return el("div", { class: "rmfmt" }, [
    el("div", { class: "rmfmthead" }, [
      el("span", {
        class: "rmfmtname",
        text: p.format === "supplier_csv" ? `${p.filename}: ${t("routes.format.supplier_csv")}` : `${p.filename}: ${t("routes.format.supplier_xml")} <${p.xmlRoot ?? "?"}>`,
      }),
      verdict,
    ]),
    el("div", { class: "muted sm", text: why }),
    ...(captured && (p.en16931Failed ?? []).length > 0
      ? [el("ul", { class: "rmrules" }, p.en16931Failed.map((f) => el("li", {}, [el("span", { class: "rmrule", text: f.rule }), el("span", { text: ` ${words("en16931.rule", f.rule.toLowerCase())}` }), ...(f.detail ? [el("span", { class: "muted", text: ` · ${f.detail}` })] : [])])))]
      : []),
    ...(p.reread && !p.reread.can
      ? [el("div", { class: "muted sm rmreread", text: t(`routemonitor.reread.no.${p.reread.reason}`) })]
      : []),
    ...(p.reread?.can ? [el("div", { class: "sm rmreread", text: t("routemonitor.reread.offer").replace("{n}", String(p.reread.version)) })] : []),
    el("div", { class: "statebuttons rmfmtact" }, [
      ...(p.reread?.can
        ? [actionLink("release", { primary: true, label: t("routemonitor.reread.button").replace("{n}", String(p.reread.version)), onclick: () => reread(p) })]
        : []),
      actionLink("coding", { primary: !captured && !p.reread?.can, label: t(p.mapping ? "routemonitor.openmapping" : "routemonitor.mapthis"), onclick: openEditor }),
    ]),
  ]);
}

/**
 * A reason without the mapping's name and version at its start — decision
 * 0567. The server's reason names them ("Lager Nord CSV v2: ..."), for the
 * technical detail and the history; the card has just said them.
 */
function withoutMappingName(reason, name, version) {
  const prefix = `${name} v${version}: `;
  const rest = (reason ?? "").startsWith(prefix) ? reason.slice(prefix.length) : reason ?? "";
  // A sentence after the colon starts with a capital (decision 0568, Dan's choice).
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/** "1 rule broken", "2 rules broken" — decision 0566. */
function brokenCount(n) {
  return n === 1 ? t("routemonitor.brokenone") : t("routemonitor.brokenn").replace("{n}", String(n));
}

/**
 * **Read again with the newer version — decision 0566.** A captured file
 * whose mapping has a newer live version can be read again, into the same
 * invoice, while nobody has worked on it; otherwise the reason is shown.
 */
async function reread(p) {
  note("");
  const result = await post(`/api/route-messages/${encodeURIComponent(selectedId)}/parts/${p.seq}/reread`);
  if (!result.ok) {
    const key = `routemonitor.reread.no.${result.body.reason}`;
    note(t(key) === key ? result.body.error ?? t("routemonitor.reread.failed") : t(key));
    return;
  }
  await load();
  if (selectedId) await loadDetail(selectedId);
  render();
  const failed = result.body.en16931Failed ?? [];
  note(
    t(failed.length === 0 ? "routemonitor.reread.done" : "routemonitor.reread.donebroken")
      .replace("{n}", String(result.body.version))
      .replace("{r}", String(failed.length)),
    failed.length === 0
  );
}

/** A value's words, or the value itself where the interface has none. */
function words(prefix, value) {
  const key = `${prefix}.${value}`;
  const found = t(key);
  return found === key ? value : found;
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
  /**
   * **Fix and run again, or close — decision 0559.** Reprocess where the
   * message can be run again; the same for every open failure like it on
   * this route, where there are others; and Dismiss, with a reason.
   */
  const actions = [
    ...(detail.canReprocess ? [actionLink("release", { primary: true, label: t("routemonitor.reprocess"), onclick: () => reprocess([message.id]) })] : []),
    ...(detail.canReprocess && detail.similar?.length > 0
      ? [
          actionLink("release", {
            label: t("routemonitor.reprocessall").replace("{n}", String(detail.similar.length + 1)),
            onclick: () => reprocess([message.id, ...detail.similar]),
          }),
        ]
      : []),
    ...(detail.canDismiss ? [actionLink("discard", { label: t("routemonitor.dismiss"), onclick: () => openDismiss(message) })] : []),
  ];
  return el("div", { class: "panel rmdetail" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: message.subject || message.id }), el("div", { class: "statebuttons" }, [...actions, close])]),
    el("p", {
      class: "muted sm",
      text: [message.sourceName ?? t("routemonitor.unclaimed"), when(message.receivedAt), message.id].join(" · "),
    }),
    chain(message),
    ...explanation(message, parts),
    // Why it cannot be run again, where it failed and cannot (0559).
    ...((message.status === "failed" || message.status === "partial") && !detail.canReprocess && detail.cannotReprocess
      ? [el("p", { class: "muted sm", text: t(`routemonitor.cannot.${detail.cannotReprocess}`) })]
      : []),
    ...technical(message, parts),
    ...(invoices.length > 0
      ? [
          el("h4", { class: "rmh4", text: t(message.direction === "out" ? "routemonitor.invoicessent" : "routemonitor.invoices") }),
          el(
            "ul",
            { class: "rmlist" },
            invoices.map((i) =>
              el("li", { text: [i.number ?? i.invoiceId, i.supplierName].filter(Boolean).join(" · ") })
            )
          ),
        ]
      : []),
    el("h4", { class: "rmh4", text: t(message.direction === "out" ? "routemonitor.sent" : "routemonitor.originals") }),
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
    ...formatChecks(parts),
    el("h4", { class: "rmh4", text: t("routemonitor.history") }),
    el(
      "ol",
      { class: "rmhistory" },
      events.map((e) =>
        el("li", {}, [
          el("span", { class: "rmtime", text: when(e.at) }),
          ` ${t(`routemonitor.event.${e.event}`)}`,
          // Who, for what a person did: an export made or undone (0558).
          ...(e.actorName ? [el("span", { class: "muted", text: ` · ${t("routemonitor.by").replace("{who}", e.actorName)}` })] : []),
          // The reason a person gave, for what they closed (0558, 0559).
          ...((e.event === "dismissed" || e.event === "undone") && e.detail ? [el("div", { class: "muted sm rmreason", text: e.detail })] : []),
          ...(e.partSeq ? [el("span", { class: "muted", text: ` · ${t("routemonitor.partn").replace("{n}", String(e.partSeq))}` })] : []),
        ])
      )
    ),
  ]);
}

function note(message, ok = false) {
  const box = document.getElementById("routemonitor-note");
  if (!box) return;
  box.textContent = message ?? "";
  box.className = ok ? "ok" : "warn";
}

async function post(path, body) {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    return { ok: response.ok, body: await response.json().catch(() => ({})) };
  } catch {
    return { ok: false, body: {} };
  }
}

/** Run one message, or several, again — decision 0559. */
async function reprocess(ids) {
  note("");
  const single = ids.length === 1;
  const result = single
    ? await post(`/api/route-messages/${encodeURIComponent(ids[0])}/reprocess`)
    : await post("/api/route-messages/reprocess", { ids });
  if (!result.ok) {
    note(result.body.reason ? t(`routemonitor.cannot.${result.body.reason}`) : t("routemonitor.reprocessfailed"));
    return;
  }
  const outcomes = single ? [result.body] : (result.body.results ?? []);
  const delivered = outcomes.filter((o) => o.status === "delivered").length;
  await load();
  if (selectedId) await loadDetail(selectedId);
  render();
  note(t("routemonitor.reprocessed").replace("{n}", String(outcomes.length)).replace("{d}", String(delivered)), delivered > 0);
}

/** Close a failure that needs no fixing, with the reason — decision 0559. */
function openDismiss(message) {
  const reasonBox = el("textarea", { class: "rmreasonbox", placeholder: t("routemonitor.dismissplaceholder") });
  const errorBox = el("div", { class: "warn sm", hidden: "hidden" });
  const onKey = (event) => {
    if (event.key === "Escape") close();
  };
  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
  };
  const doDismiss = async () => {
    const reason = reasonBox.value.trim();
    if (!reason) {
      errorBox.hidden = false;
      errorBox.textContent = t("routemonitor.dismissneedsreason");
      reasonBox.focus();
      return;
    }
    const result = await post(`/api/route-messages/${encodeURIComponent(message.id)}/dismiss`, { reason });
    if (!result.ok) {
      errorBox.hidden = false;
      errorBox.textContent = result.body.error ?? t("routemonitor.dismissfailed");
      return;
    }
    close();
    await load();
    if (selectedId) await loadDetail(selectedId);
    render();
  };
  const box = el("div", { class: "popout rmpop", role: "dialog", "aria-label": t("routemonitor.dismisstitle") }, [
    el("div", { class: "cardhead" }, [
      el("h3", { text: t("routemonitor.dismisstitle") }),
      el("div", { class: "statebuttons" }, [
        actionLink("discard", { primary: true, label: t("routemonitor.dismiss"), onclick: doDismiss }),
        actionLink("close", { onclick: close }),
      ]),
    ]),
    el("p", { class: "muted sm", text: t("routemonitor.dismissexplain") }),
    el("div", { class: "kf" }, [el("label", { text: t("routemonitor.dismisslabel") }), reasonBox]),
    errorBox,
  ]);
  const backdrop = el("div", { class: "backdrop" }, [box]);
  backdrop.onclick = (e) => {
    if (e.target === backdrop) close();
  };
  document.addEventListener("keydown", onKey);
  document.body.append(backdrop);
  reasonBox.focus();
}

/**
 * **Alerts — decision 0559.** Who is told, and when: on each failure,
 * when a day's failures reach a number, or when a Source has received
 * nothing for some hours; by email and/or a signed webhook. For one
 * route or every route. Listed with what each last sent, and each can
 * be tested, changed or deleted.
 */
async function openAlerts() {
  let alerts = [];
  let editing = null; // an alert being changed, or null for a new one
  const listBox = el("div", { class: "rmalerts" });
  const formBox = el("div", { class: "rmalertform" });
  const errorBox = el("div", { class: "warn sm", hidden: "hidden" });
  const onKey = (event) => {
    if (event.key === "Escape") close();
  };
  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
  };
  const routes = [
    ...data.sources.map((s) => ({ id: s.id, name: s.name, source: true })),
    ...(data.destinations ?? []).map((d) => ({ id: d.id, name: d.name, source: false })),
  ];
  const routeName = (id) => (id ? routes.find((r) => r.id === id)?.name ?? id : t("routemonitor.alert.allroutes"));

  async function reload() {
    try {
      const response = await fetch("/api/route-alerts");
      alerts = response.ok ? (await response.json()).alerts ?? [] : [];
    } catch {
      alerts = [];
    }
    drawList();
  }

  function summaryOf(a) {
    return [
      ...(a.onFailure ? [t("routemonitor.alert.eachfailure")] : []),
      ...(a.failuresPerDay ? [t("routemonitor.alert.perday").replace("{n}", String(a.failuresPerDay))] : []),
      ...(a.silentHours ? [t("routemonitor.alert.silent").replace("{n}", String(a.silentHours))] : []),
    ].join(" · ");
  }

  function drawList() {
    listBox.replaceChildren(
      ...(alerts.length === 0
        ? [el("p", { class: "muted sm", text: t("routemonitor.alert.none") })]
        : alerts.map((a) =>
            el("div", { class: "rmalert" }, [
              el("div", { class: "rmalerthead" }, [
                el("b", { text: routeName(a.routeId) }),
                el("div", { class: "statebuttons" }, [
                  actionLink("backtest", {
                    label: t("routemonitor.alert.test"),
                    onclick: async () => {
                      const result = await post(`/api/route-alerts/${encodeURIComponent(a.id)}/test`);
                      await reload();
                      errorBox.hidden = false;
                      errorBox.className = result.ok ? "ok sm" : "warn sm";
                      errorBox.textContent = result.ok ? t("routemonitor.alert.tested").replace("{outcome}", result.body.outcome ?? "") : t("routemonitor.alert.failed");
                    },
                  }),
                  actionLink("rename", {
                    label: t("routemonitor.alert.change"),
                    onclick: () => {
                      editing = a;
                      drawForm();
                    },
                  }),
                  actionLink("discard", {
                    label: t("routemonitor.alert.delete"),
                    onclick: async () => {
                      await fetch(`/api/route-alerts/${encodeURIComponent(a.id)}`, { method: "DELETE" }).catch(() => null);
                      if (editing?.id === a.id) editing = null;
                      await reload();
                      drawForm();
                    },
                  }),
                ]),
              ]),
              el("div", { class: "sm", text: summaryOf(a) }),
              el("div", { class: "muted sm", text: [...a.emails, ...(a.webhookUrl ? [a.webhookUrl] : [])].join(", ") }),
              ...(a.webhookSecret ? [el("div", { class: "muted sm", text: t("routemonitor.alert.secret").replace("{secret}", a.webhookSecret) })] : []),
              ...(a.lastSent ? [el("div", { class: "muted sm", text: t("routemonitor.alert.lastsent").replace("{when}", String(a.lastSent.at).slice(0, 16).replace("T", " ")).replace("{outcome}", a.lastSent.outcome) })] : []),
            ])
          ))
    );
  }

  function drawForm() {
    const a = editing ?? { routeId: null, onFailure: true, failuresPerDay: null, silentHours: null, emails: [], webhookUrl: null };
    const route = el("select", {});
    route.append(el("option", { value: "", text: t("routemonitor.alert.allroutes") }));
    for (const r of routes) route.append(el("option", { value: r.id, text: r.name }));
    route.value = a.routeId ?? "";
    const each = el("input", { type: "checkbox", ...(a.onFailure ? { checked: "checked" } : {}) });
    const perDayOn = el("input", { type: "checkbox", ...(a.failuresPerDay ? { checked: "checked" } : {}) });
    const perDay = el("input", { type: "number", min: "1", class: "rmnum", value: String(a.failuresPerDay ?? 5) });
    const silentOn = el("input", { type: "checkbox", ...(a.silentHours ? { checked: "checked" } : {}) });
    const silent = el("input", { type: "number", min: "1", max: "720", class: "rmnum", value: String(a.silentHours ?? 24) });
    const emails = el("input", { type: "text", value: a.emails.join(", "), placeholder: "it-support@example.com" });
    const webhook = el("input", { type: "text", value: a.webhookUrl ?? "", placeholder: "https://" });
    const save = actionLink("save", {
      primary: true,
      label: t(editing ? "routemonitor.alert.save" : "routemonitor.alert.add"),
      onclick: async () => {
        errorBox.hidden = true;
        const body = {
          routeId: route.value || null,
          onFailure: each.checked,
          failuresPerDay: perDayOn.checked ? Number(perDay.value) : null,
          silentHours: silentOn.checked ? Number(silent.value) : null,
          emails: emails.value,
          webhookUrl: webhook.value.trim() || null,
        };
        let result;
        try {
          const response = await fetch(editing ? `/api/route-alerts/${encodeURIComponent(editing.id)}` : "/api/route-alerts", {
            method: editing ? "PUT" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          result = { ok: response.ok, body: await response.json().catch(() => ({})) };
        } catch {
          result = { ok: false, body: {} };
        }
        if (!result.ok) {
          errorBox.hidden = false;
          errorBox.className = "warn sm";
          const words = result.body.reason ? t(`routemonitor.alert.refused.${result.body.reason}`) : "";
          errorBox.textContent = words && !words.startsWith("routemonitor.") ? words : result.body.error ?? t("routemonitor.alert.failed");
          return;
        }
        editing = null;
        await reload();
        drawForm();
      },
    });
    const line = (box, words, extra = []) => el("label", { class: "rmcheck" }, [box, ` ${words}`, ...extra]);
    formBox.replaceChildren(
      el("h4", { class: "rmh4", text: t(editing ? "routemonitor.alert.changetitle" : "routemonitor.alert.new") }),
      el("div", { class: "kf" }, [el("label", { text: t("routemonitor.alert.route") }), route]),
      el("div", { class: "kf" }, [
        el("label", { text: t("routemonitor.alert.when") }),
        line(each, t("routemonitor.alert.eachfailure")),
        line(perDayOn, t("routemonitor.alert.perdayform"), [perDay]),
        line(silentOn, t("routemonitor.alert.silentform"), [silent]),
      ]),
      el("div", { class: "kf" }, [el("label", { text: t("routemonitor.alert.emails") }), emails]),
      el("div", { class: "kf" }, [el("label", { text: t("routemonitor.alert.webhook") }), webhook]),
      el("div", { class: "statebuttons rmformbuttons" }, [
        save,
        ...(editing ? [actionLink("close", { label: t("routemonitor.alert.cancel"), onclick: () => { editing = null; drawForm(); } })] : []),
      ])
    );
  }

  const box = el("div", { class: "popout rmpop rmalertspop", role: "dialog", "aria-label": t("routemonitor.alerts") }, [
    el("div", { class: "cardhead" }, [el("h3", { text: t("routemonitor.alerts") }), el("div", { class: "statebuttons" }, [actionLink("close", { onclick: close })])]),
    el("p", { class: "muted sm", text: t("routemonitor.alert.explain") }),
    listBox,
    errorBox,
    formBox,
  ]);
  const backdrop = el("div", { class: "backdrop" }, [box]);
  backdrop.onclick = (e) => {
    if (e.target === backdrop) close();
  };
  document.addEventListener("keydown", onKey);
  document.body.append(backdrop);
  drawForm();
  await reload();
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

/**
 * `message` opens one message's detail at once — decision 0573, from
 * Create's "Route monitor" button for the upload just made.
 */
export async function open({ message } = {}) {
  setCurrentScreen("routemonitor");
  if (message) selectedId = message;
  const ok = await load();
  if (ok && selectedId) await loadDetail(selectedId);
  render();
  if (!ok) {
    const note = document.getElementById("routemonitor-note");
    if (note) note.textContent = t("routemonitor.failed");
  }
}
