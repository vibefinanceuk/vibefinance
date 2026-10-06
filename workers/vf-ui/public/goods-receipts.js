import { t } from "/strings.js";
import { el as make, frame, topbar, setCurrentScreen, hasMyPermission } from "/tasks.js";
import { actionLink } from "/viewer.js";
import { icon } from "/icons.js";
import { currentOrgId } from "/orgs.js";
import { donutChart } from "/charts.js";

/**
 * **Goods Receipts — decision 0645, slice 3 of the Goods Receipts
 * proposal (0643).** Built like Purchase Orders: a CSV load with its
 * format and template, a chart of where orders stand, search and paging
 * over the register, and a receipt opened in a pop-out. Added: recording
 * a receipt or a return on screen, and cancelling one entered by mistake.
 *
 * AP.Receive records; AP.Validate only looks (Dan, 0643). The server
 * decides every figure and every refusal (0644); this screen says them.
 */

/** `el`, leaving out a child that is not there (null, undefined or false) rather than writing "null". */
const el = (tag, props = {}, children = []) => make(tag, props, children.filter((c) => c !== null && c !== undefined && c !== false));
/** Replacing a node's children the same way. */
const replace = (node, ...children) => node.replaceChildren(...children.filter((c) => c !== null && c !== undefined && c !== false));

const STATES = ["not_received", "partially_received", "fully_received", "over_received"];
const STATE_PILL = { not_received: "q", partially_received: "warn", fully_received: "ok", over_received: "bad" };
const PAGE_SIZES = [25, 50, 100, 200];

let receipts = [];
let total = 0;
let page = 1;
let pageSize = 50;
let searchTerm = "";
let kind = "";
let counts = null;
let csvFormat = null;
let reasons = [];
/** Decision 0651: the Warehouse Receipts process, when it is set up. */
let warehouse = null;

async function call(path, init) {
  try {
    const response = await fetch(`/api${path}`, init);
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body };
  } catch {
    return { ok: false, status: 0, body: {} };
  }
}

const post = (path, body) => call(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const canRecord = () => hasMyPermission("AP.Receive");
const qty = (n) => (n === null || n === undefined ? "—" : String(Math.round(Number(n) * 1000) / 1000));

/** A refusal or a warning in words: the server's reason code, else its own English. */
function said(body, fallbackKey) {
  if (body?.reason) {
    const key = `receipts.error.${body.reason}`;
    const words = t(key);
    if (words !== key) return body.line ? t("receipts.error.online").replace("{line}", String(body.line)).replace("{why}", words) : words;
  }
  return body?.error ?? t(fallbackKey);
}

export function statePill(state) {
  if (!state) return el("span", { class: "muted", text: "—" });
  return el("span", { class: `rmpill ${STATE_PILL[state] ?? ""}`.trim(), text: t(`receipts.state.${state}`) });
}
const creditPill = (n) => el("span", { class: "rmpill bad", text: n ? t("receipts.creditexpectedn").replace("{n}", qty(n)) : t("receipts.creditexpected") });
const movementPill = (m) => el("span", { class: `rmpill ${m === "returned" ? "bad" : "ok"}`, text: t(`receipts.movement.${m}`) });

function note(content) {
  const box = document.getElementById("receipts-note");
  if (!box) return;
  if (typeof content === "string" || content == null) box.replaceChildren(content ? el("div", { class: "warn", text: content }) : "");
  else box.replaceChildren(content);
}

async function load() {
  const params = new URLSearchParams();
  const org = currentOrgId();
  if (org) params.set("org", org);
  if (searchTerm) params.set("search", searchTerm);
  if (kind) params.set("kind", kind);
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  const r = await call(`/goods-receipts?${params}`);
  if (!r.ok) return false;
  receipts = r.body.receipts ?? [];
  total = r.body.total ?? 0;
  page = r.body.page ?? page;
  pageSize = r.body.pageSize ?? pageSize;
  return true;
}

async function loadCounts() {
  const org = currentOrgId();
  const r = await call(`/goods-receipts/status-counts${org ? `?org=${encodeURIComponent(org)}` : ""}`);
  counts = r.ok ? r.body.counts ?? null : null;
}

async function loadExtras() {
  const process = await call("/goods-receipts/process");
  warehouse = process.ok ? process.body.process ?? null : null;
  if (!canRecord()) return;
  const [format, active] = await Promise.all([call("/goods-receipts/csv-format"), call("/goods-return-reasons")]);
  csvFormat = format.ok ? format.body : null;
  reasons = active.ok ? active.body.reasons ?? [] : [];
}

const statusPill = (status) => (status === "pending" || status === "rejected" ? el("span", { class: `rmpill ${status === "pending" ? "warn" : "q"}`, text: t(`receipts.status.${status}`) }) : null);

/**
 * **Where a CSV load goes — decision 0651.** Through the Warehouse
 * Receipts process once it is set up; otherwise straight in, with a
 * button for Admin.Configure to set the process up.
 */
function processLine() {
  if (warehouse) return el("p", { class: "sm", id: "receipts-process", text: t("receipts.process.through").replace("{process}", warehouse.name) });
  const parts = [el("span", { class: "sm muted", text: t("receipts.process.direct") })];
  if (hasMyPermission("Admin.Configure")) {
    const button = actionLink("addcard", {
      label: t("receipts.process.setup"),
      onclick: async () => {
        button.disabled = true;
        const r = await post("/goods-receipts/process", {
          name: t("receipts.process.name"),
          teamName: t("receipts.process.teamname"),
          stageNames: { intake: t("receipts.process.stage.intake"), matching: t("receipts.process.stage.matching"), complete: t("receipts.process.stage.complete") },
        });
        button.disabled = false;
        if (!r.ok) return note(said(r.body, "receipts.process.failed"));
        warehouse = r.body.process ?? null;
        render();
        note(
          el("div", { class: "panel" }, [
            el("div", { text: t("receipts.process.done").replace("{process}", warehouse?.name ?? "") }),
            // Decision 0652: who works Matching's tasks.
            r.body.team ? el("div", { class: "muted", id: "receipts-team", text: t("receipts.process.team").replace("{team}", r.body.team.name).replace("{n}", String(r.body.team.members)) }) : null,
          ])
        );
      },
    });
    button.id = "receipts-setup-process";
    parts.push(button);
  }
  return el("div", { class: "receiptsprocess", id: "receipts-process" }, parts);
}

async function reload(focusId) {
  await load();
  render();
  if (focusId) document.getElementById(focusId)?.focus();
}

async function refreshAll() {
  await Promise.all([load(), loadCounts()]);
  render();
}

// ── The chart ──────────────────────────────────────────────────────────

function statusCard() {
  const segments = counts ? STATES.map((s) => ({ key: s, label: t(`receipts.state.${s}`), value: counts[s] ?? 0 })).filter((s) => s.value > 0) : [];
  return el("div", { class: "panel", id: "receipts-chart" }, [
    el("h3", { text: t("receipts.chartheading") }),
    el("p", { class: "muted sm", text: t("receipts.charthint") }),
    segments.length > 0 ? donutChart(segments) : el("div", { class: "muted", text: t("receipts.nochart") }),
    counts?.credit_expected ? el("div", { class: "receiptscredit" }, [creditPill(), el("span", { text: ` ${t("receipts.creditorders").replace("{n}", String(counts.credit_expected))}` })]) : null,
  ]);
}

// ── Loading a CSV ──────────────────────────────────────────────────────

function downloadTemplate() {
  if (!csvFormat) return;
  const csv = csvFormat.fields.map((f) => f.columns[0]).join(",") + "\n";
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = el("a", { href: url, download: "goods-receipts-template.csv" });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function formatReference() {
  if (!csvFormat) return null;
  return el("details", { class: "csvformat" }, [
    el("summary", { text: t("purchaseorders.viewformat") }),
    el("div", { class: "tablewrap" }, [
      el("table", {}, [
        el("thead", {}, [el("tr", {}, [t("purchaseorders.fieldname"), t("purchaseorders.acceptedcolumns"), t("purchaseorders.required"), t("receipts.meaning")].map((h) => el("th", { text: h })))]),
        el(
          "tbody",
          {},
          csvFormat.fields.map((f) =>
            el("tr", {}, [
              el("td", { text: f.key }),
              el("td", { class: "muted", text: f.columns.join(", ") }),
              el("td", { text: t(`receipts.required.${f.required}`) }),
              el("td", { class: "muted", text: f.description }),
            ])
          )
        ),
      ]),
    ]),
  ]);
}

/**
 * **What the re-check did — decision 0648.** Tasks a receipt rule raised
 * that closed because the goods are now in, and those still waiting.
 */
function recheckLines(result) {
  const r = result?.recheck;
  if (!r) return [];
  return [
    r.closed > 0 ? el("div", { class: "receiptsrecheck", text: t("receipts.recheck.closed").replace("{n}", String(r.closed)) }) : null,
    r.stillOpen > 0 ? el("div", { class: "muted", text: t("receipts.recheck.open").replace("{n}", String(r.stillOpen)) }) : null,
  ].filter(Boolean);
}

function loadOutcome(result) {
  const parts = [
    el("div", { text: t("receipts.loaded").replace("{lines}", String(result.linesLoaded)).replace("{receipts}", String(result.receiptsCreated)) }),
  ];
  if (result.linesSkipped > 0) parts.push(el("div", { class: "muted", text: t("receipts.skipped").replace("{n}", String(result.linesSkipped)) }));
  if (result.process) {
    const sent = result.process.sent ?? [];
    parts.push(
      el("div", {
        id: "receipts-sent",
        text: t("receipts.sent")
          .replace("{process}", result.process.name)
          .replace("{registered}", String(sent.filter((x) => x.status === "registered").length))
          .replace("{waiting}", String(sent.filter((x) => x.status === "pending").length)),
      })
    );
  }
  parts.push(...recheckLines(result));
  for (const w of result.warnings ?? []) {
    parts.push(el("div", { class: "warn", text: t("receipts.overrow").replace("{row}", String(w.row)).replace("{order}", w.orderNumber).replace("{line}", String(w.orderLine)).replace("{ordered}", qty(w.ordered)).replace("{held}", qty(w.netAfter)) }));
  }
  if (result.refused?.length > 0) {
    parts.push(el("h3", { text: t("receipts.refusedheading") }));
    for (const r of result.refused.slice(0, 25)) {
      parts.push(el("div", { class: "warn", text: t("receipts.refusedrow").replace("{row}", String(r.row)).replace("{why}", said(r, "receipts.loadfailed")) }));
    }
    if (result.refused.length > 25) parts.push(el("div", { class: "muted", text: t("purchaseorders.refusedmore").replace("{n}", String(result.refused.length - 25)) }));
  }
  return el("div", { class: "panel", id: "receipts-outcome" }, parts);
}

function loader() {
  const picker = el("input", { type: "file", accept: ".csv,text/csv", id: "receiptsfile" });
  const button = actionLink("load", { primary: true, label: t("purchaseorders.loadbutton"), onclick: () => run() });
  async function run() {
    const file = picker.files?.[0];
    if (!file) return note(t("purchaseorders.nofile"));
    button.disabled = true;
    const r = await call("/goods-receipts/csv-load", { method: "POST", headers: { "Content-Type": "text/csv" }, body: await file.text() });
    button.disabled = false;
    if (!r.ok) return note(r.status === 0 ? t("receipts.loadfailed") : said(r.body, "receipts.loadfailed"));
    page = 1;
    await refreshAll();
    note(loadOutcome(r.body));
  }
  const template = actionLink("download", { label: t("purchaseorders.templatebutton"), onclick: () => downloadTemplate() });
  template.disabled = !csvFormat;
  return el("div", { class: "panel" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: t("receipts.loadheading") }), el("div", { class: "statebuttons" }, [template, button])]),
    el("p", { class: "muted", text: t("receipts.loadhelp") }),
    processLine(),
    picker,
    formatReference(),
  ]);
}

// ── The list ───────────────────────────────────────────────────────────

function searchRow() {
  const search = el("input", { type: "search", id: "receiptsearch", placeholder: t("receipts.searchplaceholder") });
  search.value = searchTerm;
  search.onchange = async () => {
    searchTerm = search.value;
    page = 1;
    await reload("receiptsearch");
  };
  const kindPicker = el(
    "select",
    { id: "receiptkind" },
    ["", "received", "returned", "pending", "rejected", "cancelled"].map((k) => el("option", { value: k, text: t(`receipts.kind.${k || "all"}`) }))
  );
  kindPicker.value = kind;
  kindPicker.onchange = async () => {
    kind = kindPicker.value;
    page = 1;
    await reload("receiptkind");
  };
  const size = el("select", { id: "receiptrows" }, PAGE_SIZES.map((n) => el("option", { value: String(n), text: String(n) })));
  size.value = String(pageSize);
  size.onchange = async () => {
    pageSize = Number(size.value);
    page = 1;
    await reload("receiptrows");
  };
  const pages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const nav = (name, label, disabled, to) => {
    const b = el("button", { class: "iconbutton", "aria-label": label, title: label });
    b.append(icon(name));
    b.disabled = disabled;
    b.onclick = async () => {
      page = to();
      await reload();
    };
    return b;
  };
  const first = page <= 1;
  const last = total === 0 || page >= pages;
  return el("div", { class: "searchrow" }, [
    search,
    kindPicker,
    el("label", { class: "sm muted", text: t("purchaseorders.rows") }),
    size,
    nav("chevronsleft", t("purchaseorders.firstpage"), first, () => 1),
    nav("chevronleft", t("purchaseorders.previouspage"), first, () => Math.max(1, page - 1)),
    el("span", {
      class: "sm muted",
      text: t("purchaseorders.rangeof")
        .replace("{start}", String(total === 0 ? 0 : (page - 1) * pageSize + 1))
        .replace("{end}", String(Math.min(page * pageSize, total)))
        .replace("{total}", String(total)),
    }),
    nav("chevronright", t("purchaseorders.nextpage"), last, () => Math.min(pages, page + 1)),
    nav("chevronsright", t("purchaseorders.lastpage"), last, () => pages),
  ]);
}

function receiptRows() {
  if (receipts.length === 0) return el("div", { class: "muted", id: "receipts-empty", text: searchTerm || kind ? t("receipts.nomatches") : t("receipts.none") });
  const rows = receipts.map((r) => {
    const kinds = r.movements.map((m) => movementPill(m));
    if (r.returnReason) kinds.push(el("span", { class: "muted sm", text: ` ${r.returnReason}` }));
    if (r.cancelled) kinds.push(el("span", { class: "rmpill q", text: t("receipts.cancelled") }));
    const status = statusPill(r.status);
    if (status) kinds.push(status);
    const row = el("tr", { class: r.cancelled || r.status === "rejected" ? "clickable muted" : "clickable", "data-receipt": r.id }, [
      el("td", { text: r.receiptNumber }),
      el("td", { class: "muted", text: r.receiptDate }),
      el("td", { text: r.orders.map((o) => o.orderNumber).join(", ") }),
      el("td", { class: "muted", text: [...new Set(r.orders.map((o) => o.supplier).filter(Boolean))].join(", ") || "—" }),
      el("td", { class: "num", text: String(r.lineCount) }),
      el("td", {}, kinds),
      el("td", {}, r.orders.flatMap((o) => [statePill(o.state), o.creditExpected ? creditPill() : null].filter(Boolean))),
      el("td", { class: "muted", text: r.createdBy ?? "—" }),
    ]);
    row.onclick = () => openReceipt(r.id);
    return row;
  });
  return el("div", { class: "tablewrap" }, [
    el("table", { class: "receiptstable" }, [
      el("thead", {}, [
        el(
          "tr",
          {},
          ["receipts.col.receipt", "receipts.col.date", "receipts.col.orders", "receipts.col.supplier", "receipts.col.lines", "receipts.col.kind", "receipts.col.ordernow", "receipts.col.by"].map((k) =>
            el("th", { class: k === "receipts.col.lines" ? "num" : "", text: t(k) })
          )
        ),
      ]),
      el("tbody", {}, rows),
    ]),
  ]);
}

// ── One order's figures ────────────────────────────────────────────────

export function figuresTable(order, { inputs = null } = {}) {
  const head = ["receipts.col.line", "receipts.col.item", "receipts.col.ordered", "receipts.col.received", "receipts.col.returned", "receipts.col.net", "receipts.col.invoiced", "receipts.col.state"];
  if (inputs) head.push(inputs.headingKey);
  const rows = order.lines.map((l) => {
    const cells = [
      el("td", { text: String(l.lineNumber) }),
      el("td", { text: l.itemName ?? "—" }, l.onOrder ? [] : [el("div", { class: "warn sm", text: t("receipts.notonorder") })]),
      el("td", { class: "num", text: qty(l.ordered) }),
      el("td", { class: "num", text: qty(l.received) }),
      el("td", { class: "num", text: qty(l.returned) }),
      el("td", { class: "num", text: qty(l.net) }),
      el("td", { class: "num", text: qty(l.invoiced) }),
      el("td", {}, [statePill(l.state), l.creditExpected > 0 ? creditPill(l.creditExpected) : null].filter(Boolean)),
    ];
    if (inputs) cells.push(el("td", { class: "num" }, [inputs.cell(l)].filter(Boolean)));
    return el("tr", { "data-line": String(l.lineNumber) }, cells);
  });
  return el("div", { class: "tablewrap" }, [
    el("table", { class: "receiptfigures" }, [
      el("thead", {}, [el("tr", {}, head.map((k) => el("th", { class: ["receipts.col.line", "receipts.col.item", "receipts.col.state"].includes(k) ? "" : "num", text: t(k) })))]),
      el("tbody", {}, rows),
    ]),
  ]);
}

function orderHeading(order) {
  return el("div", { class: "cardhead" }, [
    el("h4", { text: `${order.orderNumber}${order.supplier ? ` · ${order.supplier.name}` : ""}` }),
    el("div", { class: "statebuttons" }, [statePill(order.state), order.receiptingRequired ? el("span", { class: "rmpill q", text: t("suppliers.receipting.short") }) : null].filter(Boolean)),
  ]);
}

// ── A receipt ──────────────────────────────────────────────────────────

function popout(content, wide = true) {
  const backdrop = el("div", { class: "backdrop" }, [el("div", { class: wide ? "popout wide" : "popout" }, content)]);
  backdrop.onclick = (e) => {
    if (e.target === backdrop) backdrop.remove();
  };
  document.body.append(backdrop);
  return backdrop;
}

/**
 * A receipt in its pop-out. `onDone` runs after anything that changes
 * it (the Goods Receipts screen refreshes; Tasks reloads its list, 0652).
 */
export async function openReceipt(id, { onDone = null } = {}) {
  const after = onDone ?? refreshAll;
  const r = await call(`/goods-receipts/${encodeURIComponent(id)}`);
  if (!r.ok) return note(t("receipts.detailfailed"));
  const { receipt, lines, orders, process } = r.body;
  const problem = el("div", { class: "warn", id: "receipt-problem" });
  let backdrop;
  const close = () => backdrop.remove();
  const pending = receipt.status === "pending";

  /** Decision 0652: what Matching found on a line. */
  const checkPill = (l) =>
    l.lineStatus === "rejected"
      ? el("span", { class: "rmpill q", title: l.rejectReason ?? "", text: t("receipts.check.rejected") })
      : l.checkReason
        ? el("span", { class: "rmpill bad", text: said({ reason: l.checkReason }, "receipts.check.attention") })
        : el("span", { class: "rmpill ok", text: t("receipts.check.matched") });

  /** Point a line needing attention at another order line, or reject it alone; then the pop-out opens again, checked. */
  const fixCell = (l) => {
    const order = el("input", { type: "text", class: "fixorder", id: `fix-order-${l.lineNumber}`, value: l.orderNumber, "aria-label": t("receipts.fix.order") });
    const line = el("input", { type: "number", min: "1", class: "fixline", id: `fix-line-${l.lineNumber}`, value: String(l.orderLine), "aria-label": t("receipts.fix.line") });
    const reopen = async (r) => {
      if (!r.ok) {
        problem.replaceChildren(el("div", { text: said(r.body, "receipts.fixfailed") }));
        return;
      }
      close();
      await openReceipt(id, { onDone });
    };
    const change = el("button", { type: "button", id: `fix-change-${l.lineNumber}`, text: t("receipts.fix.change") });
    change.onclick = async () => reopen(await post(`/goods-receipts/${encodeURIComponent(id)}/lines/${l.lineNumber}`, { orderNumber: order.value, orderLine: Number(line.value) }));
    const reject = el("button", { type: "button", id: `fix-reject-${l.lineNumber}`, text: t("receipts.fix.rejectline") });
    reject.onclick = () => {
      const why = el("input", { type: "text", class: "searchbox", id: "line-rejectreason", placeholder: t("receipts.rejectwhy") });
      const confirm = el("button", { class: "primary", id: "line-rejectconfirm", text: t("receipts.fix.rejectline") });
      confirm.onclick = async () => reopen(await post(`/goods-receipts/${encodeURIComponent(id)}/lines/${l.lineNumber}`, { reject: true, reason: why.value }));
      problem.replaceChildren(el("div", { text: t("receipts.fix.rejectprompt").replace("{line}", String(l.lineNumber)) }), why, confirm);
      why.focus();
    };
    return [
      el("div", { class: "receiptfix" }, [
        el("label", { for: order.id, class: "sm muted", text: t("receipts.fix.order") }),
        order,
        el("label", { for: line.id, class: "sm muted", text: t("receipts.fix.line") }),
        line,
        change,
        reject,
      ]),
    ];
  };

  const buttons = [];
  // Decision 0652: Register, once every line still in it matches.
  if (canRecord() && receipt.status === "pending") {
    const register = actionLink("save", {
      primary: true,
      label: t("receipts.register"),
      onclick: async () => {
        register.disabled = true;
        const done = await post(`/goods-receipts/${encodeURIComponent(id)}/register`, {});
        register.disabled = false;
        if (!done.ok) {
          problem.replaceChildren(el("div", { text: said(done.body, "receipts.registerfailed") }));
          return;
        }
        close();
        await after();
        note(el("div", { class: "panel" }, [el("div", { text: t("receipts.registered.done").replace("{number}", receipt.receiptNumber) }), ...recheckLines(done.body)]));
      },
    });
    register.id = "receipt-register";
    buttons.push(register);
  }
  // Decision 0651: a pending receipt is rejected, never cancelled; it has not counted yet.
  if (canRecord() && receipt.status === "pending") {
    buttons.push(
      actionLink("close", {
        label: t("receipts.rejectreceipt"),
        onclick: () => {
          const why = el("input", { type: "text", class: "searchbox", id: "receipt-rejectreason", placeholder: t("receipts.rejectwhy") });
          problem.replaceChildren(
            el("div", { text: t("receipts.rejectprompt") }),
            why,
            el("button", {
              class: "primary",
              id: "receipt-rejectconfirm",
              text: t("receipts.rejectconfirm"),
              onclick: async () => {
                const done = await post(`/goods-receipts/${encodeURIComponent(id)}/reject`, { reason: why.value });
                if (!done.ok) {
                  problem.replaceChildren(el("div", { text: said(done.body, "receipts.rejectfailed") }));
                  return;
                }
                close();
                await after();
                note(el("div", { class: "panel" }, [el("div", { text: t("receipts.rejected.done").replace("{number}", receipt.receiptNumber) })]));
              },
            })
          );
          why.focus();
        },
      })
    );
  }
  if (canRecord() && !receipt.cancelled && (receipt.status ?? "registered") === "registered") {
    buttons.push(
      actionLink("close", {
        label: t("receipts.cancelreceipt"),
        onclick: () => {
          const why = el("input", { type: "text", class: "searchbox", id: "receipt-cancelreason", placeholder: t("receipts.cancelwhy") });
          problem.replaceChildren(
            el("div", { text: t("receipts.cancelprompt") }),
            why,
            el("button", {
              class: "primary",
              text: t("receipts.cancelconfirm"),
              onclick: async () => {
                const done = await post(`/goods-receipts/${encodeURIComponent(id)}/cancel`, { reason: why.value });
                if (!done.ok) {
                  problem.replaceChildren(el("div", { text: said(done.body, "receipts.cancelfailed") }));
                  return;
                }
                close();
                await after();
                note(el("div", { class: "panel" }, [el("div", { text: t("receipts.cancelled.done").replace("{number}", receipt.receiptNumber) }), ...recheckLines(done.body)]));
              },
            })
          );
          why.focus();
        },
      })
    );
  }
  buttons.push(actionLink("close", { onclick: () => close() }));

  const fact = (k, v) => [el("div", { class: "muted", text: t(k) }), el("div", { text: v || "—" })];
  backdrop = popout([
    el("div", { class: "cardhead" }, [el("h3", { text: receipt.receiptNumber }), el("div", { class: "statebuttons" }, buttons)]),
    receipt.cancelled
      ? el("div", { class: "warn", text: t("receipts.cancelledby").replace("{who}", receipt.cancelledBy ?? "—").replace("{why}", receipt.cancelReason ?? "") })
      : null,
    receipt.status === "pending"
      ? el("div", {
          class: "warn",
          id: "receipt-pending",
          text: process?.stageName
            ? t("receipts.pendingat").replace("{stage}", process.stageName).replace("{process}", process.processName)
            : t("receipts.pendingnoprocess"),
        })
      : null,
    receipt.status === "rejected"
      ? el("div", { class: "warn", id: "receipt-rejected", text: t("receipts.rejectedby").replace("{who}", receipt.rejectedBy ?? "—").replace("{why}", receipt.rejectReason ?? "") })
      : null,
    el("div", { class: "editgrid" }, [
      ...fact("receipts.col.date", receipt.receiptDate),
      ...fact("receipts.deliverynote", receipt.deliveryNote),
      ...fact("receipts.col.by", `${receipt.createdBy ?? "—"} · ${t(`receipts.source.${receipt.source}`)}`),
      ...fact("receipts.note", receipt.note),
      ...(receipt.status === "registered" && receipt.registeredAt ? fact("receipts.registered", String(receipt.registeredAt).slice(0, 10)) : []),
    ]),
    el("div", { class: "tablewrap" }, [
      el("table", {}, [
        el("thead", {}, [
          el("tr", {}, [
            ...["receipts.col.line", "receipts.col.order", "receipts.col.kind", "receipts.col.quantity", "receipts.reason"].map((k) => el("th", { text: t(k) })),
            ...(pending ? [el("th", { text: t("receipts.col.check") })] : []),
          ]),
        ]),
        el(
          "tbody",
          {},
          lines.flatMap((l) => [
            el("tr", { class: l.lineStatus === "rejected" ? "muted" : "", "data-line": String(l.lineNumber) }, [
              el("td", { text: String(l.lineNumber) }),
              el("td", { class: "nowrap", text: `${l.orderNumber} / ${l.orderLine}` }),
              el("td", {}, [movementPill(l.movement)]),
              el("td", { class: "num", text: `${qty(l.quantity)}${l.unitCode ? ` ${l.unitCode}` : ""}` }),
              el("td", { class: "muted", text: l.returnReason ?? "—" }),
              ...(pending ? [el("td", {}, [checkPill(l)])] : []),
            ]),
            // Decision 0652: the fix sits under the line it is for.
            pending && canRecord() && l.lineStatus !== "rejected" && l.checkReason
              ? el("tr", { class: "receiptfixrow" }, [el("td", {}), el("td", { colspan: "5" }, fixCell(l))])
              : null,
          ].filter(Boolean))
        ),
      ]),
    ]),
    el("h4", { text: t("receipts.ordersnow") }),
    ...orders.flatMap((o) => [orderHeading(o), figuresTable(o)]),
    problem,
  ]);
}

// ── Recording ──────────────────────────────────────────────────────────

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Recording a receipt or a return. Find the order and its lines appear
 * with what each holds. For a receipt, what is outstanding is filled in:
 * change what differs. For a return, enter what went back and say why.
 */
export function openRecord(mode = "received") {
  const returning = mode === "returned";
  const problem = el("div", { class: "warn", id: "record-problem" });
  const orderInput = el("input", { type: "text", id: "record-order", placeholder: t("receipts.form.orderhint") });
  const numberInput = el("input", { type: "text", id: "record-number" });
  const dateInput = el("input", { type: "date", id: "record-date", value: today() });
  const noteInput = el("input", { type: "text", id: "record-deliverynote" });
  const reasonPicker = returning
    ? el("select", { id: "record-reason" }, [el("option", { value: "", text: t("receipts.form.choosereason") }), ...reasons.map((r) => el("option", { value: r.id, text: r.label }))])
    : null;
  const linesBox = el("div", { id: "record-lines" });
  let order = null;
  const amounts = new Map();

  async function find() {
    problem.textContent = "";
    const n = orderInput.value.trim();
    if (!n) return;
    const r = await call(`/goods-receipts/order/${encodeURIComponent(n)}`);
    if (!r.ok) {
      order = null;
      linesBox.replaceChildren();
      problem.textContent = t("receipts.error.order_not_found");
      return;
    }
    order = r.body.order;
    amounts.clear();
    const hint = (l, input, warn) => () => {
      const v = Number(input.value);
      warn.textContent =
        !returning && l.ordered !== null && v > 0 && l.net + v > l.ordered ? t("receipts.form.willover").replace("{held}", qty(l.net + v)).replace("{ordered}", qty(l.ordered)) : returning && v > l.net ? t("receipts.error.return_exceeds_received") : "";
    };
    replace(
      linesBox,
      orderHeading(order),
      order.status === "closed" ? el("div", { class: "warn", text: t("receipts.error.order_closed") }) : null,
      figuresTable(order, {
        inputs: {
          headingKey: returning ? "receipts.form.returnednow" : "receipts.form.receivednow",
          cell: (l) => {
            if (!l.onOrder) return null;
            const input = el("input", { type: "number", min: "0", step: "any", class: "qtyinput", "data-line": String(l.lineNumber) });
            if (!returning && l.outstanding > 0) input.value = String(l.outstanding);
            const warn = el("div", { class: "warn sm" });
            input.oninput = hint(l, input, warn);
            amounts.set(l.lineNumber, input);
            return el("div", {}, [input, warn]);
          },
        },
      })
    );
  }
  orderInput.onchange = find;

  async function save() {
    problem.textContent = "";
    if (!order) return void (problem.textContent = t("receipts.form.findfirst"));
    const lines = [...amounts.entries()]
      .filter(([, input]) => Number(input.value) > 0)
      .map(([lineNumber, input]) => ({
        orderNumber: order.orderNumber,
        orderLine: lineNumber,
        quantity: Number(input.value),
        ...(returning ? { movement: "returned", returnReason: reasonPicker.value } : {}),
      }));
    if (lines.length === 0) return void (problem.textContent = t("receipts.form.nothing"));
    if (returning && !reasonPicker.value) return void (problem.textContent = t("receipts.error.return_reason_missing"));
    const r = await post("/goods-receipts", { receiptNumber: numberInput.value, receiptDate: dateInput.value, deliveryNote: noteInput.value, lines });
    if (!r.ok) return void (problem.textContent = said(r.body, "receipts.savefailed"));
    backdrop.remove();
    await refreshAll();
    const done = [el("div", { text: t(returning ? "receipts.saved.return" : "receipts.saved.receipt").replace("{number}", r.body.receiptNumber) })];
    for (const w of r.body.warnings ?? []) {
      done.push(el("div", { class: "warn", text: t("receipts.overline").replace("{order}", w.orderNumber).replace("{line}", String(w.orderLine)).replace("{ordered}", qty(w.ordered)).replace("{held}", qty(w.netAfter)) }));
    }
    done.push(...recheckLines(r.body));
    note(el("div", { class: "panel", id: "receipts-saved" }, done));
  }

  const backdrop = popout([
    el("div", { class: "cardhead" }, [
      el("h3", { text: t(returning ? "receipts.form.returnheading" : "receipts.form.receiptheading") }),
      el("div", { class: "statebuttons" }, [actionLink("save", { primary: true, onclick: () => save() }), actionLink("close", { onclick: () => backdrop.remove() })]),
    ]),
    el("div", { class: "editgrid" }, [
      el("label", { for: "record-order", text: t("receipts.form.order") }),
      el("div", { class: "searchrow" }, [orderInput, actionLink("search", { label: t("receipts.form.find"), onclick: () => find() })]),
      el("label", { for: "record-number", text: t(returning ? "receipts.form.returnnumber" : "receipts.form.number") }),
      numberInput,
      el("label", { for: "record-date", text: t(returning ? "receipts.form.returnedon" : "receipts.form.receivedon") }),
      dateInput,
      el("label", { for: "record-deliverynote", text: t("receipts.deliverynote") }),
      noteInput,
      ...(returning ? [el("label", { for: "record-reason", text: t("receipts.reason") }), reasonPicker] : []),
    ]),
    linesBox,
    problem,
  ]);
  orderInput.focus();
  return backdrop;
}

// ── The screen ─────────────────────────────────────────────────────────

function render() {
  const shell = document.getElementById("shell");
  if (!shell) return;
  const actions = canRecord()
    ? el("div", { class: "statebuttons" }, [
        actionLink("create", { label: t("receipts.recordreturn"), onclick: () => openRecord("returned") }),
        actionLink("create", { primary: true, label: t("receipts.recordreceipt"), onclick: () => openRecord("received") }),
      ])
    : null;
  shell.replaceChildren(
    frame(
      el("div", {}, [
        topbar(t("nav.goodsreceipts"), t("receipts.subtitle")),
        el("div", { id: "receipts-note" }),
        el("div", { class: "poloadhead" }, [canRecord() ? loader() : el("div", { class: "panel" }, [el("p", { class: "muted", text: t("receipts.readonly") })]), statusCard()]),
        el("div", { class: "panel" }, [el("div", { class: "cardhead" }, [el("h3", { text: t("receipts.listheading") }), actions]), searchRow()]),
        el("div", { class: "panel" }, [receiptRows()]),
      ])
    )
  );
}

export async function open() {
  setCurrentScreen("goodsreceipts");
  searchTerm = "";
  kind = "";
  page = 1;
  const [ok] = await Promise.all([load(), loadCounts(), loadExtras()]);
  render();
  if (!ok) note(t("receipts.failed"));
}
