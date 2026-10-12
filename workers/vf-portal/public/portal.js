import { loadStrings, t, fill, el } from "/strings.js";
import { frame, setBadge, topbar } from "/shell.js";
import { icon } from "/icons.js";
import { createPage, startCreditNote } from "/create.js";
import { viewPage } from "/view.js";
import { receiptPage } from "/receipt-view.js";

/**
 * **The supplier network's pages — decisions 0717 and 0725.** Sign in;
 * then, in the application's own frame (side menu, top bar), the
 * supplier's invoices across every customer they are linked to, asked of
 * each customer live; an invoice opens full screen, with its lines and
 * its messages (0729).
 */

export const STATUSES = ["received", "in_review", "query_raised", "returned", "approved", "sent_for_payment", "paid", "rejected", "credited"];
/** Decision 0738: a goods receipt's, where a customer shares them. */
export const RECEIPT_STATUSES = ["goods_received", "goods_returned", "goods_checking"];
/** Whether any customer shares goods receipts with this supplier: the type and statuses are offered then. */
let receiptsShared = false;

const $ = (id) => document.getElementById(id);

export function money(amount, currency) {
  if (typeof amount !== "number") return "—";
  try {
    return new Intl.NumberFormat(document.documentElement.lang || "en", { style: "currency", currency: currency || "GBP" }).format(amount);
  } catch {
    return `${currency ?? ""} ${amount.toFixed(2)}`.trim();
  }
}

const statusChip = (s) => el("span", { class: `status ${s}`, text: t(`network.status.${s}`) });

async function api(path, init) {
  const res = await fetch(`/api${path}`, init);
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/sign-in") showSignIn();
  return { res, body };
}

/** Who is signed in and the customers they see (`/api/me`). */
let me = { email: "", customers: [] };
let current = "documents";
let invoices = [];
/** Decision 0729: the invoice open full screen — its row in the list, and what its customer answered. */
let opened = null;

/** Decision 0728: invoices with messages from the customer this person has not read yet (opened the invoice since). */
const waiting = (inv) => (inv.messages?.unread ?? 0) > 0;
const waitingCount = () => invoices.filter(waiting).length;

function showSignIn() {
  document.querySelector(".backdrop")?.remove();
  document.getElementById("helppanel")?.remove();
  $("shell").hidden = true;
  $("shell").replaceChildren();
  document.body.classList.remove("working");
  $("signin-view").hidden = false;
}

const handlers = {
  onSignOut: async () => {
    await fetch("/api/sign-out", { method: "POST" });
    showSignIn();
  },
  onLanguage: () => render(),
  onMood: () => render(),
};

/** The supplier's own name, as their customers have it (one per link; usually the same). */
function supplierNames() {
  return [...new Set(me.customers.map((c) => c.supplier).filter(Boolean))].join(" · ");
}

function go(screen) {
  current = screen;
  window.scrollTo?.(0, 0);
  render();
  if (screen === "documents") loadInvoices();
}

/** What was just sent from Create, said once on Documents (0727). */
let sentNotice = null;

/** Draw the frame and the screen showing. */
export async function render() {
  const page =
    current === "create"
      ? await createPage({ api, redraw: () => render() }, handlers, (sent) => {
          sentNotice = sent;
          go("documents");
        })
      : current === "receipt" && opened
        ? receiptPage(opened.body, { statusChip, back: () => go("documents") }, handlers)
        : current === "invoice" && opened
        ? viewPage(
            opened.body,
            {
              money,
              statusChip,
              conversation: (body) => conversation(body, opened.inv),
              back: () => go("documents"),
              // Decision 0732: a credit note against this invoice, in Create.
              credit: () => {
                startCreditNote({ ...opened.body, id: opened.inv.id }, opened.inv.linkId, opened.body.customer);
                go("create");
              },
            },
            handlers
          )
        : el("div", {}, documentsPage());
  // The open invoice is one of the documents, so Documents stays chosen in the menu.
  $("shell").replaceChildren(frame({ current: current === "invoice" || current === "receipt" ? "documents" : current, go, who: { email: me.email, supplier: supplierNames() }, page, badges: { documents: waitingCount() } }));
  $("shell").hidden = false;
  $("signin-view").hidden = true;
  // As the app (tasks.js): the page fills the window once someone is signed in.
  document.body.classList.add("working");
  drawRows();
  // The latest message in view.
  const feed = document.querySelector(".netviewchat .chatfeed");
  if (feed) feed.scrollTop = feed.scrollHeight;
}

// ---------------------------------------------------------------------------
// Documents — every invoice, across the customers (0717, 0725).
// ---------------------------------------------------------------------------

const filters = { q: "", customer: "", status: "", type: "" };
let timer = null;

/**
 * **Pages and columns, as the app's Documents — decision 0736.** Dan:
 * *"align the Documents screen in the supplier network with the document
 * screen in (vf-app)"* — pages in the browser (the list is merged live
 * from each customer, its newest 500 each), rows per page, and the
 * column picker, remembered here.
 */
const PAGE_SIZES = [25, 50, 100, 200];
let page = 1;
let pageSize = 50;
const COLUMNS_KEY = "vfn-columns";
// Decision 0738: invoice, credit note or goods receipt.
const typeOf = (inv) => (inv.documentType === "credit_note" || inv.documentType === "goods_receipt" ? inv.documentType : "invoice");
const negative = (inv) => (inv.documentType === "credit_note" && typeof inv.total === "number" ? -inv.total : inv.total);
const DOC_COLUMNS = [
  { key: "customer", label: "network.col.customer", on: true, cell: (inv) => el("td", { text: inv.customer }) },
  { key: "type", label: "network.col.type", on: true, cell: (inv) => el("td", { class: `doctype${inv.documentType === "credit_note" ? " cn" : inv.documentType === "goods_receipt" ? " gr" : ""}`, text: t(`network.types.${typeOf(inv)}`) }) },
  { key: "number", label: "network.col.document", always: true, cell: (inv) => el("td", { class: "nowrap", text: inv.invoiceNumber ?? "—" }) },
  { key: "date", label: "network.col.date", on: true, cls: "hide-narrow", cell: (inv) => el("td", { class: "hide-narrow", text: inv.issueDate ?? "—" }) },
  { key: "due", label: "network.col.due", on: false, cell: (inv) => el("td", { text: inv.dueDate ?? "—" }) },
  // A credit note is money the other way.
  { key: "amount", label: "network.col.amount", on: true, cls: "num", cell: (inv) => el("td", { class: "num", text: money(negative(inv), inv.currency) }) },
  { key: "currency", label: "network.col.currency", on: false, cell: (inv) => el("td", { text: inv.currency ?? "—" }) },
  { key: "po", label: "network.col.po", on: true, cls: "hide-narrow", cell: (inv) => el("td", { class: "hide-narrow", text: inv.purchaseOrder ?? "—" }) },
  { key: "buyerref", label: "network.col.buyerref", on: false, cell: (inv) => el("td", { text: inv.buyerReference ?? "—" }) },
  { key: "company", label: "network.col.company", on: true, cls: "hide-narrow", cell: (inv) => el("td", { class: "hide-narrow", text: inv.company ?? "" }) },
  { key: "received", label: "network.col.received", on: false, cell: (inv) => el("td", { text: (inv.receivedAt ?? "").slice(0, 10) || "—" }) },
  { key: "credits", label: "network.col.credits", on: false, cell: (inv) => el("td", { text: inv.creditedInvoice ?? "—" }) },
  { key: "messages", label: "network.col.messages", on: true, cls: "num", cell: (inv) => el("td", { class: "num" }, [messagesPill(inv)]) },
  { key: "status", label: "network.col.status", on: true, cell: (inv) => el("td", {}, [statusChip(inv.status)]) },
];

function shownColumns() {
  let keys = null;
  try {
    keys = JSON.parse(localStorage.getItem(COLUMNS_KEY) ?? "null");
  } catch {
    // Not kept: the standard columns.
  }
  const chosen = new Set(Array.isArray(keys) ? keys : DOC_COLUMNS.filter((c) => c.on).map((c) => c.key));
  return DOC_COLUMNS.filter((c) => c.always || chosen.has(c.key));
}

function columnPicker() {
  const shown = new Set(shownColumns().map((c) => c.key));
  const list = el(
    "div",
    { class: "columnlist" },
    DOC_COLUMNS.map((c) => {
      const box = el("input", { type: "checkbox", ...(shown.has(c.key) ? { checked: true } : {}), ...(c.always ? { disabled: true } : {}) });
      box.addEventListener("change", () => {
        const now = new Set(shownColumns().map((x) => x.key));
        if (box.checked) now.add(c.key);
        else now.delete(c.key);
        try {
          localStorage.setItem(COLUMNS_KEY, JSON.stringify([...now]));
        } catch {
          // A convenience.
        }
        drawTable();
      });
      return el("label", {}, [box, ` ${t(c.label)}`]);
    })
  );
  return el("details", { class: "columnpicker", id: "netcolumns" }, [el("summary", { title: t("network.choosecolumns"), "aria-label": t("network.choosecolumns") }, [icon("columns")]), list]);
}

function pager() {
  const size = el("select", { id: "rowsize", "aria-label": t("network.rows") }, PAGE_SIZES.map((n) => el("option", { value: String(n), text: String(n) })));
  size.value = String(pageSize);
  size.addEventListener("change", () => {
    pageSize = Number(size.value);
    page = 1;
    drawRows();
  });
  const nav = (name, label, id, onclick) => el("button", { class: "iconbutton", type: "button", id, title: t(label), "aria-label": t(label), onclick }, [icon(name)]);
  return el("div", { class: "netlist-controls" }, [
    el("label", { class: "sm muted", for: "rowsize", text: t("network.rows") }),
    size,
    nav("chevronsleft", "network.page.first", "pg-first", () => { page = 1; drawRows(); }),
    nav("chevronleft", "network.page.prev", "pg-prev", () => { page = Math.max(1, page - 1); drawRows(); }),
    el("span", { class: "range", id: "count" }),
    nav("chevronright", "network.page.next", "pg-next", () => { page += 1; drawRows(); }),
    nav("chevronsright", "network.page.last", "pg-last", () => { page = Number.MAX_SAFE_INTEGER; drawRows(); }),
    columnPicker(),
  ]);
}

/** The table's head for the columns chosen, then its rows. */
function drawTable() {
  const head = $("doc-head");
  if (head) head.replaceChildren(el("tr", {}, shownColumns().map((c) => el("th", { class: c.cls ?? "", text: t(c.label) }))));
  drawRows();
}

function documentsPage() {
  const search = el("input", { type: "search", id: "search", placeholder: t("network.searchdocs"), "aria-label": t("network.searchdocs"), value: filters.q });
  search.addEventListener("input", () => {
    filters.q = search.value;
    page = 1;
    clearTimeout(timer);
    timer = setTimeout(loadInvoices, 300);
  });
  const customer = el("select", { id: "customer", "aria-label": t("network.col.customer") }, [
    el("option", { value: "", text: t("network.customers.all") }),
    ...me.customers.map((c) => el("option", { value: c.linkId, text: c.customer })),
  ]);
  customer.value = filters.customer;
  customer.addEventListener("change", () => {
    filters.customer = customer.value;
    page = 1;
    drawRows();
  });
  // Decision 0732: invoices, credit notes, or both.
  const type = el("select", { id: "type", "aria-label": t("network.col.type") }, [
    el("option", { value: "", text: t("network.types.all") }),
    el("option", { value: "invoice", text: t("network.types.invoice") }),
    el("option", { value: "credit_note", text: t("network.types.credit_note") }),
    ...(receiptsShared ? [el("option", { value: "goods_receipt", text: t("network.types.goods_receipt") })] : []),
  ]);
  type.value = filters.type;
  type.addEventListener("change", () => {
    filters.type = type.value;
    page = 1;
    drawRows();
  });
  const status = el("select", { id: "status", "aria-label": t("network.col.status") }, [
    el("option", { value: "", text: t("network.status.all") }),
    ...[...STATUSES, ...(receiptsShared ? RECEIPT_STATUSES : [])].map((s) => el("option", { value: s, text: t(`network.status.${s}`) })),
  ]);
  status.value = filters.status;
  status.addEventListener("change", () => {
    filters.status = status.value;
    page = 1;
    loadInvoices();
  });
  const notice = sentNotice;
  sentNotice = null;
  return [
    topbar(t("network.nav.documents"), me.customers.length ? `${supplierNames()} · ${me.customers.map(customerLabel).join(" · ")}` : t("network.nocustomers"), [], handlers),
    notice
      ? el("div", { class: "sentnotice", role: "status" }, [
          el("b", { text: t(notice.credit ? "network.credit.sent" : "network.create.sent", { customer: notice.customer, company: notice.company, number: notice.number ?? "" }) }),
          " ",
          el("span", { text: t("network.create.sentref", { message: notice.message ?? "", customer: notice.customer }) }),
        ])
      : null,
    el("div", { class: "notice", id: "unavailable", role: "status", hidden: true }),
    el("div", { class: "panel" }, [
      el("div", { class: "searchrow" }, [search, el("div", { class: "filters" }, [customer, type, status]), pager()]),
    ]),
    el("div", { class: "panel" }, [
      el("table", { class: "netlist" }, [
        el("thead", { id: "doc-head" }, [el("tr", {}, shownColumns().map((c) => el("th", { class: c.cls ?? "", text: t(c.label) })))]),
        el("tbody", { id: "rows" }),
      ]),
      el("div", { class: "empty", id: "empty", hidden: true }),
      el("div", { class: "netlist-capped", id: "capped", hidden: true }),
    ]),
  ];
}

export async function loadInvoices() {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.status) params.set("status", filters.status);
  const { res, body } = await api(`/invoices${params.toString() ? `?${params}` : ""}`);
  if (!res.ok) return;
  invoices = body.invoices ?? [];
  // Decision 0738: the first answer that says receipts are shared draws the filters again, with them.
  if (Boolean(body.receipts) !== receiptsShared) {
    receiptsShared = Boolean(body.receipts);
    if (current === "documents") await render();
  }
  // Unfiltered, the list is every invoice: the menu's count is worked out from it (0728).
  if (!filters.q.trim() && !filters.status) setBadge("documents", waitingCount());
  const gone = body.unavailable ?? [];
  const notice = $("unavailable");
  if (notice) {
    notice.hidden = gone.length === 0;
    notice.textContent = t("network.unavailable", { list: gone.map((g) => g.customer).join(", ") });
  }
  const capped = $("capped");
  if (capped) {
    capped.hidden = !(body.capped ?? []).length;
    capped.textContent = t("network.capped", { list: (body.capped ?? []).join(", ") });
  }
  drawRows();
}

/**
 * **Messages on an invoice — decision 0728.** Amber, "2 new", where the
 * customer has written since this person last opened the invoice (Dan:
 * unread, not unanswered, since a supplier need not reply to everything);
 * a plain count where every message is read; a dash where there are none.
 */
function messagesPill(inv) {
  const m = inv.messages ?? { total: 0, unread: 0 };
  if (m.unread > 0) return el("span", { class: "msgpill new", title: t("network.msg.unreadtitle", { customer: inv.customer }), text: t("network.msg.new", { n: m.unread }) });
  if (m.total > 0) return el("span", { class: "msgpill", title: t("network.msg.readtitle"), text: String(m.total) });
  return el("span", { class: "muted", text: "—" });
}

function drawRows() {
  const tbody = $("rows");
  if (!tbody) return;
  const shown = invoices.filter((inv) => (!filters.customer || inv.linkId === filters.customer) && (!filters.type || typeOf(inv) === filters.type));
  // Decision 0736: this page of them.
  const pages = Math.max(1, Math.ceil(shown.length / pageSize));
  page = Math.min(Math.max(1, page), pages);
  const from = (page - 1) * pageSize;
  const onPage = shown.slice(from, from + pageSize);
  const columns = shownColumns();
  tbody.replaceChildren(
    ...onPage.map((inv) =>
      el(
        "tr",
        { tabindex: "0", class: waiting(inv) ? "netrow hasnew" : "netrow", onclick: () => openInvoice(inv), onkeydown: (e) => e.key === "Enter" && openInvoice(inv) },
        columns.map((c) => c.cell(inv))
      )
    )
  );
  for (const [id, off] of [["pg-first", page <= 1], ["pg-prev", page <= 1], ["pg-next", page >= pages], ["pg-last", page >= pages]]) {
    const b = $(id);
    if (b) b.disabled = off;
  }
  const empty = $("empty");
  empty.hidden = shown.length > 0;
  /**
   * **What "nothing" means — decision 0718.** With a search or a filter
   * chosen, nothing matches it. Without, there is nothing yet for the
   * companies this person can see, named.
   */
  const filtered = filters.q.trim() || filters.status || filters.customer || filters.type;
  empty.textContent =
    filtered || !me.customers.length
      ? t(filtered ? "network.nomatch" : "network.none")
      : t("network.noneyet", { list: me.customers.map((c) => `${c.customer}: ${c.companies.join(", ")}`).join(" · ") });
  $("count").textContent = t("network.range", { from: shown.length ? from + 1 : 0, to: from + onPage.length, total: shown.length });
}

/** Decision 0729: an invoice opens full screen, in place of the list. */
export async function openInvoice(inv) {
  // Decision 0738: a goods receipt opens read only, on its own page.
  if (inv.documentType === "goods_receipt") {
    const { res, body } = await api(`/receipts/${encodeURIComponent(inv.linkId)}/${encodeURIComponent(inv.id)}`);
    if (!res.ok) return;
    opened = { inv, body };
    current = "receipt";
    window.scrollTo?.(0, 0);
    await render();
    return;
  }
  const { res, body } = await api(`/invoices/${encodeURIComponent(inv.linkId)}/${encodeURIComponent(inv.id)}`);
  if (!res.ok) return;
  // Decision 0728: opening it reads its messages, so its pill and the menu's count go down at once.
  if ((inv.messages?.unread ?? 0) > 0) inv.messages = { ...inv.messages, unread: 0 };
  opened = { inv, body };
  current = "invoice";
  window.scrollTo?.(0, 0);
  await render();
  if (!filters.q.trim() && !filters.status) setBadge("documents", waitingCount());
}

/** A customer and its companies, in a line: past three companies, how many, with every name on hover (0718). */
export function customerLabel(c) {
  return c.companies.length <= 3 ? `${c.customer} (${c.companies.join(", ")})` : `${c.customer} (${t("network.companies.count", { n: c.companies.length })})`;
}

/**
 * **The conversation with the customer about this invoice — decision 0721.**
 * Their questions and anything either side has written, then a reply box.
 * Replying ends a "Query raised".
 */
export function conversation(body, inv) {
  const messages = body.messages ?? [];
  const when = (at) => (at ?? "").slice(0, 16).replace("T", " ");
  const list = messages.map((m) =>
    el("div", { class: `msg ${m.from === "customer" ? "them" : "us"}` }, [
      el("div", { class: "who" }, [
        el("span", {
          text:
            m.from === "customer"
              ? // Decision 0724: a return says so.
                `${body.customer}${m.kind === "return" ? ` · ${t("network.msg.returned")}` : ""}${m.lines?.length ? ` · ${t("network.msg.aboutlines", { lines: m.lines.join(", ") })}` : ""}`
              : m.authorName ?? body.supplier ?? "",
        }),
        el("span", { class: "muted", text: when(m.at) }),
      ]),
      el("div", { class: "msgbody", text: m.body }),
    ])
  );
  const box = el("textarea", { "aria-label": t("network.msg.write"), placeholder: t("network.msg.write") });
  const problem = el("div", { class: "problem", role: "alert" });
  const send = el("button", {
    class: "actionlink compactlink primary",
    type: "button",
    title: t("network.msg.send"),
    onclick: async () => {
      problem.textContent = "";
      if (!box.value.trim()) return;
      send.disabled = true;
      const { res } = await api(`/invoices/${encodeURIComponent(inv.linkId)}/${encodeURIComponent(inv.id)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: box.value }),
      });
      send.disabled = false;
      if (!res.ok) {
        problem.textContent = t("network.msg.failed");
        return;
      }
      await openInvoice(inv);
    },
  }, [icon("post"), el("span", { text: t("network.msg.send") })]);
  return el("section", { class: "conversation" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: t(messages.length ? "network.msg.title" : "network.msg.start", { customer: body.customer }) })]),
    el("div", { class: "chatfeed" }, list),
    el("div", { class: "reply" }, [box, el("div", { class: "replybar" }, [el("span", { class: "muted sm", text: t("network.msg.note", { customer: body.customer }) }), send]), problem]),
  ]);
}

async function showList() {
  const { res, body } = await api("/me");
  if (!res.ok) return;
  me = { email: body.email ?? "", customers: body.customers ?? [] };
  await render();
  await loadInvoices();
}

export async function start() {
  await loadStrings();
  fill();
  $("signin-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("signin-problem").textContent = "";
    const { res, body } = await api("/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: $("email").value.trim(), password: $("password").value }),
    });
    if (res.ok) return showList();
    $("signin-problem").textContent = res.status === 429 ? t("network.signin.wait", { n: body.retryAfterSeconds ?? "" }) : t("network.signin.failed");
  });
  // Signed in already shows the list; signed out, the API's 401 shows the form.
  await showList();
}

if (!globalThis.__VF_TEST__) start();
