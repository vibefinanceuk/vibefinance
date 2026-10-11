import { t, el } from "/strings.js";
import { icon } from "/icons.js";
import { topbar } from "/shell.js";
import { UNITS, VAT_CATEGORIES, lineNet, toXml, totals, validate } from "/bis3.js";

/**
 * **Create an invoice — decision 0727.** The supplier makes the invoice
 * here, as Peppol BIS Billing 3.0, laid out as the application's invoice
 * viewer (Seller, Buyer, Payment; Invoice header; Invoice lines), checked
 * against the rules as they type, and sends it to the customer's
 * *Supplier network in* source (0726).
 *
 * - **Seller and payment** are the customer's record of the supplier, its
 *   bank account included: not editable here.
 * - **Buyer** is the company chosen, its legal details as the customer
 *   keeps them.
 * - **From a PO** fills the lines from one of that customer's purchase
 *   orders for this supplier.
 * - **A draft is kept in this browser only** (the network keeps nothing),
 *   and cleared once sent.
 */

const DRAFT_KEY = "vfn-draft";
const MAX_ATTACHMENT = 5 * 1024 * 1024;

let api = null;
let customers = null; // [{ linkId, customer, supplier, companies: [{ id, name }] }]
let parties = null; // { seller, buyer }
let model = null;
let choice = null; // { linkId, orgUnitId }
let problem = "";
let sending = false;
let onSentHandler = null;
/** The page's own root: it is drawn before it joins the document, so its parts are found within it. */
let scope = null;
const byId = (id) => scope?.querySelector(`#${id}`) ?? null;

const blankLine = () => ({ description: "", poLine: "", quantity: 1, unitCode: "C62", unitPrice: "", vatCategory: "S", vatRate: 20 });

function freshModel() {
  return {
    number: "",
    issueDate: new Date().toISOString().slice(0, 10),
    dueDate: "",
    currency: "GBP",
    typeCode: "380",
    purchaseOrder: "",
    buyerReference: "",
    paymentTerms: "",
    exemptionReason: "",
    lines: [blankLine()],
    attachment: null,
  };
}

function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ choice, model: { ...model, attachment: null } }));
  } catch {
    // A draft is a convenience.
  }
}

function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null");
    return d && d.model ? d : null;
  } catch {
    return null;
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing kept.
  }
}

/** The model as bis3.js wants it: the form's fields, with the seller, buyer and account the customer keeps. */
function fullModel() {
  const seller = parties?.seller ?? {};
  return { ...model, seller, buyer: parties?.buyer ?? {}, account: seller.account ?? null };
}

const money = (n) => {
  try {
    return new Intl.NumberFormat(document.documentElement.lang || "en", { style: "currency", currency: model.currency || "GBP" }).format(n);
  } catch {
    return Number(n).toFixed(2);
  }
};

// ---------------------------------------------------------------------------

/**
 * The page. `deps.api(path, init)` is the network's API; `onSent(sent)`
 * opens Documents with what was sent.
 */
export async function createPage(deps, handlers, onSent) {
  api = deps.api;
  onSentHandler = onSent;
  const root = el("div", { class: "netcreate" });
  scope = root;
  if (customers === null) {
    const { res, body } = await api("/submission-companies");
    customers = res.ok ? body.customers ?? [] : [];
  }
  if (!model) {
    const draft = loadDraft();
    model = draft?.model ?? freshModel();
    if (!model.lines?.length) model.lines = [blankLine()];
    const valid = draft?.choice && customers.some((c) => c.linkId === draft.choice.linkId && c.companies.some((u) => u.id === draft.choice.orgUnitId));
    choice = valid ? draft.choice : null;
  }
  if (!choice && customers.length) choice = { linkId: customers[0].linkId, orgUnitId: customers[0].companies[0].id };

  const fromPo = el("button", { class: "actionlink", type: "button", title: t("network.create.frompo"), onclick: openFromPo, disabled: customers.length ? null : true }, [
    icon("purchaseorders"),
    el("span", { text: t("network.create.frompo") }),
  ]);
  const title = topbar(t("network.create.title"), t("network.create.subtitle"), [fromPo], handlers);
  title.querySelector("h2")?.append(el("span", { class: "bisbadge", text: "Peppol BIS Billing 3.0" }));

  if (!customers.length) {
    root.append(title, el("div", { class: "panel" }, [el("p", { class: "muted", text: t("network.create.none") })]));
    return root;
  }
  root.append(title, el("div", { id: "createbody" }));
  await loadParties();
  draw(root.querySelector("#createbody"));
  return root;
}

async function loadParties() {
  parties = null;
  const { res, body } = await api(`/customers/${encodeURIComponent(choice.linkId)}/invoice-parties?orgUnitId=${encodeURIComponent(choice.orgUnitId)}`);
  parties = res.ok ? body : { seller: {}, buyer: {} };
  if (!model.paymentTerms && parties.seller?.paymentTerms) model.paymentTerms = parties.seller.paymentTerms;
  if (!model.buyerReference && parties.buyer?.buyerReference) model.buyerReference = parties.buyer.buyerReference;
}

const customerOf = () => customers.find((c) => c.linkId === choice.linkId);

function pair(label, value) {
  const lines = Array.isArray(value) ? value.filter(Boolean) : [value];
  return el("div", { class: "sfield" }, [
    el("span", { class: "slabel", text: label }),
    lines.length && lines[0] ? el("span", {}, lines.map((l) => el("div", { text: l }))) : el("span", { class: "muted", text: "—" }),
  ]);
}

const address = (p) => [p.addressLine, [p.city, p.country].filter(Boolean).join(", "), p.postalCode];

function draw(body) {
  const seller = parties.seller ?? {};
  const buyer = parties.buyer ?? {};
  const account = seller.account;

  // Buyer: every company this person may send to, across customers.
  const picker = el(
    "select",
    { id: "nc-company", "aria-label": t("network.create.company") },
    customers.map((c) => el("optgroup", { label: c.customer }, c.companies.map((u) => el("option", { value: `${c.linkId}|${u.id}`, text: u.name }))))
  );
  picker.value = `${choice.linkId}|${choice.orgUnitId}`;
  picker.addEventListener("change", async () => {
    const [linkId, orgUnitId] = picker.value.split("|");
    choice = { linkId, orgUnitId };
    saveDraft();
    await loadParties();
    draw(body);
  });

  const terms = input("paymentTerms", { id: "nc-paymentTerms" });

  body.replaceChildren(
    el("div", { class: "row3" }, [
      el("div", { class: "panel" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("network.create.seller") })]),
        seller.reference ? el("div", { class: "sub", text: seller.reference }) : null,
        el("div", { class: "sellergrid" }, [
          pair(t("network.create.name"), seller.name),
          pair(t("network.create.vat"), seller.vatId),
          pair(t("network.create.address"), address(seller)),
          pair(t("network.create.phone"), seller.phone),
        ]),
        el("p", { class: "note", text: t("network.create.sellernote", { customer: customerOf()?.customer ?? "" }) }),
      ]),
      el("div", { class: "panel" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("network.create.buyer") }), picker]),
        el("div", { class: "sub", text: customerOf()?.customer ?? "" }),
        el("div", { class: "sellergrid" }, [
          pair(t("network.create.name"), buyer.name),
          pair(t("network.create.vat"), buyer.vatId),
          pair(t("network.create.address"), address(buyer)),
          pair(t("network.create.peppolid"), buyer.endpoint),
        ]),
      ]),
      el("div", { class: "panel" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("network.create.payment") })]),
        el("div", { class: "sellergrid" }, [
          pair(t("network.create.payinto"), account?.identifier ?? null),
          pair(t("network.create.accountname"), account?.name ?? null),
        ]),
        kf("paymentTerms", t("network.create.terms"), terms),
        el("p", { class: "note", text: t(account ? "network.create.accountnote" : "network.create.noaccount", { customer: customerOf()?.customer ?? "" }) }),
      ]),
    ]),
    el("div", { class: "panel" }, [
      el("div", { class: "cardhead" }, [el("h3", { text: t("network.create.header") })]),
      el("div", { class: "headersummary" }, [
        el("div", { class: "hscolumn" }, [kf("number", t("network.create.number"), input("number")), kf("currency", t("network.create.currency"), currencySelect())]),
        el("div", { class: "hscolumn" }, [kf("issueDate", t("network.create.issuedate"), input("issueDate", { type: "date" })), kf("dueDate", t("network.create.duedate"), input("dueDate", { type: "date" }))]),
        el("div", { class: "hscolumn" }, [kf("purchaseOrder", t("network.create.po"), input("purchaseOrder")), kf("buyerReference", t("network.create.buyerref"), input("buyerReference"))]),
        el("div", { class: "hscolumn" }, [kf("net", t("network.create.net"), el("div", { class: "readonly money", id: "nc-net" })), kf("vat", t("network.create.vatamount"), el("div", { class: "readonly money", id: "nc-vat" }))]),
        el("div", { class: "hscolumn" }, [
          kf("total", t("network.create.total"), el("div", { class: "readonly money", id: "nc-total" })),
          kf("typeCode", t("network.create.type"), el("select", { id: "nc-typeCode", disabled: true }, [el("option", { value: "380", text: t("network.create.type380") })])),
        ]),
      ]),
    ]),
    el("div", { class: "panel" }, [
      el("div", { class: "cardhead" }, [
        el("h3", { text: t("network.create.lines") }),
        el("button", { class: "actionlink compactlink", type: "button", title: t("network.create.addline"), onclick: () => { model.lines.push(blankLine()); drawLines(); changed(); } }, [icon("addline"), el("span", { text: t("network.create.addline") })]),
      ]),
      el("table", { class: "linetable netlines" }, [
        el("colgroup", {}, [34, null, 84, 84, 140, 108, 190, 104, 40].map((w) => el("col", w ? { style: `width:${w}px` } : {}))),
        el("thead", {}, [
          el("tr", {}, [
            el("th", { text: "#" }),
            el("th", { text: t("network.create.description") }),
            el("th", { text: t("network.create.poline") }),
            el("th", { class: "num", text: t("network.create.quantity") }),
            el("th", { text: t("network.create.unit") }),
            el("th", { class: "num", text: t("network.create.unitprice") }),
            el("th", { text: t("network.create.vatcol") }),
            el("th", { class: "num", text: t("network.create.netcol") }),
            el("th", {}),
          ]),
        ]),
        el("tbody", { id: "nc-lines" }),
      ]),
      el("div", { class: "kf", id: "nc-exemption-field", hidden: true }, [el("label", { text: t("network.create.exemption") }), input("exemptionReason")]),
      el("div", { class: "netfoot" }, [attachmentField(), el("div", { class: "nettotals", id: "nc-totals" })]),
    ]),
    el("div", { id: "nc-check", role: "status" }),
    el("div", { class: "netbuttons" }, [
      el("button", { class: "actionlink compactlink", type: "button", title: t("network.create.download"), onclick: download }, [icon("download"), el("span", { text: t("network.create.download") })]),
      el("button", { class: "actionlink compactlink", type: "button", title: t("network.create.discard"), onclick: discard }, [icon("close"), el("span", { text: t("network.create.discard") })]),
      el("button", { class: "actionlink compactlink primary", type: "button", id: "nc-send", onclick: send }, [icon("post"), el("span", { id: "nc-sendlabel" })]),
    ]),
    el("div", { class: "problem", id: "nc-problem", role: "alert" }),
  );
  drawLines();
  changed();
}

function kf(field, label, control) {
  return el("div", { class: "kf", "data-field": field }, [el("label", { text: label }), control]);
}

function input(field, attrs = {}) {
  const node = el("input", { type: "text", id: `nc-${field}`, value: model[field] ?? "", ...attrs });
  node.addEventListener("input", () => {
    model[field] = node.value;
    changed();
  });
  return node;
}

function currencySelect() {
  const list = ["GBP", "EUR", "USD", "CHF", "SEK", "NOK", "DKK", "PLN"];
  const node = el("select", { id: "nc-currency" }, list.map((c) => el("option", { value: c, text: c })));
  node.value = model.currency;
  node.addEventListener("change", () => {
    model.currency = node.value;
    changed();
  });
  return node;
}

function drawLines() {
  const tbody = byId("nc-lines");
  if (!tbody) return;
  tbody.replaceChildren(
    ...model.lines.map((line, i) => {
      const cell = (column, control) => el("td", { "data-cell": `line:${i}:${column}` }, [control]);
      const text = (column, cls = "") => {
        const node = el("input", { type: "text", class: cls, value: line[column] ?? "", "aria-label": `${column} ${i + 1}` });
        node.addEventListener("input", () => {
          line[column] = node.value;
          changed();
        });
        return node;
      };
      const unit = el("select", { "aria-label": `unit ${i + 1}` }, UNITS.map((u) => el("option", { value: u, text: t(`network.unit.${u}`) })));
      unit.value = line.unitCode || "C62";
      unit.addEventListener("change", () => {
        line.unitCode = unit.value;
        changed();
      });
      const category = el("select", { "aria-label": `vat ${i + 1}` }, VAT_CATEGORIES.map((c) => el("option", { value: c, text: t(`network.vat.${c}`) })));
      category.value = line.vatCategory || "S";
      const rate = el("input", { type: "text", class: "num netrate", value: line.vatRate ?? "", "aria-label": `rate ${i + 1}`, hidden: category.value === "S" ? null : true });
      category.addEventListener("change", () => {
        line.vatCategory = category.value;
        rate.hidden = category.value !== "S";
        changed();
      });
      rate.addEventListener("input", () => {
        line.vatRate = rate.value;
        changed();
      });
      const remove = el("button", { class: "iconbutton", type: "button", title: t("network.create.removeline"), "aria-label": t("network.create.removeline"), disabled: model.lines.length === 1 ? true : null, onclick: () => {
        model.lines.splice(i, 1);
        drawLines();
        changed();
      } }, [icon("close")]);
      return el("tr", {}, [
        el("td", { text: String(i + 1) }),
        cell("description", text("description")),
        cell("poLine", text("poLine")),
        cell("quantity", text("quantity", "num")),
        cell("unitCode", unit),
        cell("unitPrice", text("unitPrice", "num")),
        cell("vatRate", el("div", { class: "netvat" }, [category, rate, el("span", { class: "muted", text: "%", hidden: category.value === "S" ? null : true })])),
        el("td", { class: "num", "data-net": String(i) }),
        el("td", {}, [remove]),
      ]);
    })
  );
}

function attachmentField() {
  const file = el("input", { type: "file", accept: "application/pdf", id: "nc-attachment", hidden: true });
  const label = el("span", { class: "muted", id: "nc-attachment-name", text: model.attachment ? model.attachment.filename : "" });
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    if (!f) return;
    if (f.size > MAX_ATTACHMENT) {
      showProblem(t("network.create.attachmenttoobig"));
      return;
    }
    const bytes = new Uint8Array(await f.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    model.attachment = { filename: f.name.replace(/[^\w.\- ]/g, "_"), mimeType: "application/pdf", base64: btoa(bin) };
    label.textContent = model.attachment.filename;
    changed();
  });
  return el("div", { class: "note" }, [
    el("span", { text: `${t("network.create.attachment")} ` }),
    el("button", { class: "linkbutton", type: "button", text: t("network.create.choosefile"), onclick: () => file.click() }),
    " ",
    label,
    file,
  ]);
}

/** After any change: the totals, each field's tier, the check, and Send. */
function changed() {
  saveDraft();
  const m = fullModel();
  const tot = totals(m);
  const failures = validate(m);
  const set = (id, text) => {
    const node = byId(id);
    if (node) node.textContent = text;
  };
  set("nc-net", money(tot.net));
  set("nc-vat", money(tot.vat));
  set("nc-total", money(tot.total));
  for (const cell of scope.querySelectorAll("[data-net]")) cell.textContent = money(lineNet(model.lines[Number(cell.getAttribute("data-net"))] ?? {}));
  const totalsNode = byId("nc-totals");
  if (totalsNode) {
    totalsNode.replaceChildren(
      el("div", {}, [el("span", { text: t("network.create.linesnet") }), el("span", { text: money(tot.net) })]),
      ...tot.breakdown.map((g) =>
        el("div", {}, [el("span", { text: t(`network.vatline.${g.category}`, { rate: g.rate, amount: money(g.taxable) }) }), el("span", { text: money(g.tax) })])
      ),
      el("div", { class: "grand" }, [el("span", { text: t("network.create.totalpay") }), el("span", { text: money(tot.total) })])
    );
  }
  const exemption = byId("nc-exemption-field");
  if (exemption) exemption.hidden = !model.lines.some((l) => l.vatCategory === "E" || l.vatCategory === "AE");

  // Each header field: red where a rule fails, green where it is filled in and passes.
  const failing = new Set(failures.map((f) => f.field));
  for (const node of scope.querySelectorAll(".kf[data-field]")) {
    const field = node.getAttribute("data-field");
    node.classList.remove("danger", "ok");
    node.querySelector(".kf-dot")?.remove();
    const filled = ["net", "vat", "total"].includes(field) ? tot.total > 0 : String(model[field] ?? "").trim() !== "";
    const tier = failing.has(field) ? "danger" : filled ? "ok" : null;
    if (tier) {
      node.classList.add(tier);
      node.querySelector("label")?.prepend(el("span", { class: "kf-dot" }));
    }
  }
  for (const cell of scope.querySelectorAll("[data-cell]")) cell.classList.toggle("danger", failing.has(cell.getAttribute("data-cell")));

  const check = byId("nc-check");
  if (check) {
    check.className = failures.length ? "netcheck bad" : "netcheck good";
    check.replaceChildren(
      el("b", { text: failures.length ? t("network.create.checkfailed", { n: failures.length }) : t("network.create.checkok") }),
      ...(failures.length
        ? [el("ul", {}, failures.map((f) => el("li", { text: `${t(f.key, f.params ?? {})} (${f.rule})` })))]
        : [])
    );
  }
  const sendButton = byId("nc-send");
  if (sendButton) sendButton.disabled = failures.length > 0 || sending;
  set("nc-sendlabel", t("network.create.send", { customer: customerOf()?.customer ?? "" }));
}

function showProblem(text) {
  problem = text;
  const node = byId("nc-problem");
  if (node) node.textContent = problem;
}

function download() {
  const xml = toXml(fullModel());
  const a = el("a", { href: URL.createObjectURL(new Blob([xml], { type: "application/xml" })), download: `${model.number || "invoice"}.xml` });
  document.body.append(a);
  a.click();
  a.remove();
}

function discard() {
  clearDraft();
  model = freshModel();
  const body = byId("createbody");
  if (body) draw(body);
}

async function send() {
  const m = fullModel();
  if (validate(m).length || sending) return;
  sending = true;
  showProblem("");
  changed();
  const { res, body } = await api(`/submissions/${encodeURIComponent(choice.linkId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgUnitId: choice.orgUnitId, filename: `${model.number}.xml`, xml: toXml(m) }),
  });
  sending = false;
  if (!res.ok) {
    showProblem(t(`network.create.failed.${body.reason ?? "other"}`) === `network.create.failed.${body.reason ?? "other"}` ? t("network.create.failed.other") : t(`network.create.failed.${body.reason}`));
    changed();
    return;
  }
  const company = customerOf()?.companies.find((u) => u.id === choice.orgUnitId)?.name ?? "";
  const sent = { customer: body.customer ?? customerOf()?.customer ?? "", company, message: body.message, number: model.number };
  clearDraft();
  model = null;
  onSentHandler?.(sent);
}

/** From a PO: one of this customer's purchase orders for this supplier fills the lines. */
async function openFromPo() {
  if (!choice) return;
  const { res, body } = await api(`/customers/${encodeURIComponent(choice.linkId)}/purchase-orders?orgUnitId=${encodeURIComponent(choice.orgUnitId)}`);
  const orders = res.ok ? body.purchaseOrders ?? [] : [];
  const close = () => backdrop.remove();
  const choose = (po) => {
    model.purchaseOrder = po.orderNumber;
    if (po.currency) model.currency = po.currency;
    model.lines = po.lines.map((l) => ({
      description: l.description ?? "",
      poLine: String(l.lineNumber ?? ""),
      quantity: l.quantity ?? 1,
      unitCode: UNITS.includes(l.unitCode) ? l.unitCode : "C62",
      unitPrice: l.unitPrice ?? "",
      vatCategory: "S",
      vatRate: 20,
    }));
    if (!model.lines.length) model.lines = [blankLine()];
    close();
    const b = byId("createbody");
    if (b) draw(b);
  };
  const pop = el("div", { class: "popout netpos", role: "dialog", "aria-label": t("network.create.frompo") }, [
    el("div", { class: "cardhead" }, [
      el("h3", { text: t("network.create.frompotitle", { customer: customerOf()?.customer ?? "" }) }),
      el("button", { class: "actionlink compactlink", type: "button", onclick: close }, [icon("close"), el("span", { text: t("network.close") })]),
    ]),
    orders.length
      ? el("table", {}, [
          el("thead", {}, [el("tr", {}, [el("th", { text: t("network.col.po") }), el("th", { text: t("network.col.date") }), el("th", { class: "num", text: t("network.create.net") }), el("th", { class: "num", text: t("network.create.lines") })])]),
          el(
            "tbody",
            {},
            orders.map((po) =>
              el("tr", { class: "netrow", tabindex: "0", onclick: () => choose(po), onkeydown: (e) => e.key === "Enter" && choose(po) }, [
                el("td", { text: po.orderNumber }),
                el("td", { text: po.issueDate ?? "—" }),
                el("td", { class: "num", text: typeof po.net === "number" ? po.net.toFixed(2) : "—" }),
                el("td", { class: "num", text: String(po.lines.length) }),
              ])
            )
          ),
        ])
      : el("p", { class: "muted", text: t("network.create.nopos") }),
  ]);
  const backdrop = el("div", { class: "backdrop", onclick: (e) => e.target === backdrop && close() }, [pop]);
  document.body.append(backdrop);
}

/** For a new language: the page is drawn again, keeping what was typed. */
export function resetCreate() {
  customers = null;
}
