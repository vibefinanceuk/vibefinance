import { t, el } from "/strings.js";
import { topbar } from "/shell.js";
import { icon } from "/icons.js";

/**
 * **A purchase order, opened — decision 0751.** Read only, laid out as a
 * goods receipt opened (0738): what the customer ordered from this
 * supplier, at what price, and per line how much has been received (net
 * of returns) and invoiced so far, with what is still to deliver; and the
 * conversation with the customer about it on the right (decision 0752).
 */

const dash = (v) => (v === null || v === undefined || v === "" ? "—" : String(v));
const qty = (n) => (typeof n === "number" ? (Number.isInteger(n) ? String(n) : n.toFixed(2)) : "—");
// Nothing yet is quieter than a zero.
const quiet = (n) => (n ? qty(n) : el("span", { class: "muted", text: "—" }));

/** A label and its value; several values (an address, a contact) each on its own line, as the invoice's (0765). */
function pair(label, value) {
  const lines = (Array.isArray(value) ? value : [value]).filter((v) => v !== null && v !== undefined && v !== "");
  return el("div", { class: "sfield" }, [el("span", { class: "slabel", text: label }), lines.length ? el("span", {}, lines.map((l) => el("div", { text: String(l) }))) : el("span", { class: "muted", text: "—" })]);
}

/**
 * **Whether the order can be invoiced now — decision 0755**, and if not,
 * why: not while it is closed or on hold, nor once nothing is left to
 * invoice (where the customer receipts the goods, nothing received and
 * not yet invoiced). Exported for its test.
 */
export function invoiceable(o) {
  if (o.status === "order_closed") return { ok: false, why: "closed" };
  if (o.status === "order_on_hold") return { ok: false, why: "onhold" };
  const lines = o.lines ?? [];
  // Decision 0764: everything ordered invoiced says so, whether or not the customer receipts goods.
  const allInvoiced = lines.length > 0 && lines.every((l) => (l.invoiced ?? 0) >= (l.ordered ?? 0));
  if (!lines.some((l) => typeof l.toInvoice === "number" && l.toInvoice > 0)) return { ok: false, why: !allInvoiced && o.receiptingRequired && !lines.some((l) => l.received > (l.invoiced ?? 0)) ? "nothingreceived" : "allinvoiced" };
  return { ok: true, why: null };
}

/** The page. `deps` carries what portal.js owns: the status chip, money, back to Documents, the conversation (0752), and invoicing it (0755). */
export function orderPage(o, { statusChip, money, back, conversation, invoice, document: documentTab, attachments: attachmentsTab, confirm }, handlers) {
  const can = invoiceable(o);
  /**
   * **Confirming receipt — decision 0762**, for a supplier who never saw
   * the email's link: the version they have now, once. Confirmed, the
   * order says so beside its status, and when.
   */
  const confirmation = o.confirmation ?? null;
  const confirmed = confirmation?.confirmed ?? null;
  const confirmProblem = el("p", { class: "problem", id: "net-confirm-problem", role: "alert" });
  const doConfirm = async (e) => {
    const button = e.currentTarget;
    button.disabled = true;
    confirmProblem.textContent = "";
    if (!(await confirm())) {
      button.disabled = false;
      confirmProblem.textContent = t("network.order.confirmfailed");
    }
  };
  const confirmButton =
    confirm && confirmation && !confirmed
      ? el(
          "button",
          {
            class: "actionlink primary",
            type: "button",
            id: "net-confirm",
            title: t("network.order.confirmtitle", { customer: o.customer ?? "" }),
            onclick: doConfirm,
          },
          [icon("tick"), el("span", { text: t("network.order.confirm") })]
        )
      : null;
  /**
   * **Waiting to be confirmed, as an alert — decision 0764**, as the
   * application's *Here because* line (0528): amber, with its icon, and
   * the way to confirm in it. Dan: "Can … be an alert, such as attached
   * Here because message."
   */
  const alertIcon = icon("systemalert");
  alertIcon.setAttribute("aria-hidden", "true");
  const confirmAlert =
    confirmation && !confirmed
      ? el("div", { class: "panel reasonline", id: "net-toconfirm", role: "status" }, [
          el("div", { class: "reasonline-row" }, [
            el("span", { class: "reasonline-icon" }, [alertIcon]),
            el("span", { class: "reasonline-label", text: t("network.order.todo") }),
            el("b", { text: t(`network.order.toconfirm.${confirmation.kind ?? "order"}`, { customer: o.customer ?? "" }) }),
            confirm ? el("button", { type: "button", class: "linky", id: "net-confirm-alert", onclick: doConfirm, text: t("network.order.confirm") }) : null,
          ].filter(Boolean)),
        ])
      : null;
  /**
   * **What happened, in Messages — decision 0764**: that the supplier
   * confirmed, and why the order cannot be invoiced (everything has been,
   * at the time of the last invoice), as dated lines among the messages
   * rather than above the order.
   */
  const notes = [
    confirmed ? { id: "net-confirmed-note", at: confirmed.at, text: t(`network.order.confirmednote.${confirmed.kind ?? "order"}`) } : null,
    invoice && !can.ok ? { id: "net-invoiceorder-why", at: can.why === "allinvoiced" ? o.invoicedAt ?? null : null, text: t(`network.invoiceorder.why.${can.why}`) } : null,
  ].filter(Boolean);
  // Decision 0755: Invoice this order, beside Back; why not, where it cannot be.
  const invoiceButton = invoice
    ? el(
        "button",
        { class: "actionlink", type: "button", id: "net-invoiceorder", title: can.ok ? t("network.invoiceorder.title") : t(`network.invoiceorder.why.${can.why}`), onclick: can.ok ? invoice : null, disabled: can.ok ? null : true },
        [icon("create"), el("span", { text: t("network.invoiceorder") })]
      )
    : null;
  const title = topbar(
    o.invoiceNumber ?? "—",
    t("network.order.subtitle", { customer: o.customer ?? "", company: o.company ?? "", date: o.issueDate ?? "" }),
    [confirmButton, invoiceButton, el("button", { class: "actionlink", type: "button", title: t("network.view.backtitle"), onclick: back }, [icon("back"), el("span", { text: t("network.view.back") })])].filter(Boolean),
    handlers
  );
  const h2 = title.querySelector("h2");
  h2?.append(el("span", { class: "bisbadge", text: t("network.types.purchase_order") }));
  h2?.append(statusChip(o.status));
  // Decision 0762: confirmed, beside its status.
  if (confirmed) h2?.append(el("span", { class: "status order_confirmed", id: "net-confirmed", text: t("network.order.confirmed") }));

  const lines = o.lines ?? [];
  const cell = (v, cls = "num") => el("td", { class: cls }, [typeof v === "string" || typeof v === "number" ? String(v) : v]);
  const price = (n) => (typeof n === "number" ? money(n, o.currency) : "—");
  const chat = conversation ? conversation({ ...o, notes }) : null;
  chat?.classList.add("panel", "netviewchat");
  /**
   * **Messages and Document, as tabs — decision 0760**: the conversation
   * (0752) and the order as the customer sends it, a PDF with its downloads.
   * Messages first, as the conversation was alone before.
   */
  let side = chat;
  const doc = documentTab ? documentTab(o) : null;
  // Decision 0763: its downloads, as the application lists files.
  const files = attachmentsTab ? attachmentsTab(o) : null;
  if (doc) {
    // Decision 0765: Document, Attachments, then Messages; the Document open first.
    const panes = [
      { key: "document", label: t("orderdoc.tab"), pane: doc.content, onSelect: doc.open },
      ...(files ? [{ key: "attachments", label: t("network.order.attachtab"), pane: files.content }] : []),
      { key: "messages", label: t("network.order.messagestab"), pane: chat ?? el("div", {}) },
    ];
    for (const p of panes) {
      p.pane.classList.remove("panel", "netviewchat");
      p.pane.classList.add("netsidepane");
    }
    const select = (which) => {
      for (const p of panes) {
        p.button.className = p.key === which ? "doctab on" : "doctab";
        p.button.setAttribute("aria-selected", String(p.key === which));
        p.pane.hidden = p.key !== which;
      }
      panes.find((p) => p.key === which)?.onSelect?.();
    };
    for (const p of panes) p.button = el("button", { type: "button", role: "tab", class: "doctab", id: `net-tab-${p.key}`, onclick: () => select(p.key) }, [el("span", { text: p.label })]);
    select("document");
    side = el("div", { class: "panel netviewchat netsidetabs" }, [el("div", { class: "doctabs receipttabs", role: "tablist" }, panes.map((p) => p.button)), ...panes.map((p) => p.pane)]);
  }
  /**
   * **Laid out as an invoice is — decision 0765**: Seller, Buyer and
   * Progress, then the order's header, beside the Document; the lines
   * below, across the page. The alert sits over the cards, not the page.
   */
  const parties = o.parties ?? {};
  const seller = parties.seller ?? {};
  const buyer = parties.buyer ?? {};
  const address = (p) => [p.addressLine, [p.postalCode, p.city].filter(Boolean).join(" "), p.country];
  const field = (label, value, cls = "") => el("div", { class: "kf" }, [el("label", { text: label }), el("div", { class: `readonly ${cls}`.trim(), text: dash(value) })]);
  const m = (n) => (typeof n === "number" ? money(n, o.currency) : null);
  const sum = (k) => lines.reduce((acc, l) => acc + (typeof l[k] === "number" ? l[k] : 0), 0);
  const toDeliver = lines.some((l) => typeof l.outstanding === "number") ? sum("outstanding") : null;
  return el("div", { class: "netinvoiceview netorderview" }, [
    title,
    el("div", { class: "netview netcreate" }, [
      el("div", { class: "netviewmain" }, [
        confirmAlert,
        confirmProblem,
        el("div", { class: "row3" }, [
          el("div", { class: "panel", id: "net-order-seller" }, [
            el("div", { class: "cardhead" }, [el("h3", { text: t("network.create.seller") })]),
            seller.reference ? el("div", { class: "sub", text: seller.reference }) : null,
            el("div", { class: "sellergrid" }, [
              pair(t("network.create.name"), seller.name ?? o.supplier),
              pair(t("network.create.vat"), seller.vatId),
              pair(t("network.create.address"), address(seller)),
              pair(t("network.order.email"), seller.email),
            ]),
          ]),
          el("div", { class: "panel", id: "net-order-buyer" }, [
            el("div", { class: "cardhead" }, [el("h3", { text: t("network.create.buyer") })]),
            el("div", { class: "sub", text: o.customer ?? "" }),
            el("div", { class: "sellergrid" }, [
              pair(t("network.create.name"), buyer.name ?? o.company),
              pair(t("network.create.vat"), buyer.vatId),
              pair(t("network.create.address"), address(buyer)),
              pair(t("network.order.contact"), [buyer.contact, buyer.email, buyer.phone]),
            ]),
          ]),
          el("div", { class: "panel", id: "net-order-progress" }, [
            el("div", { class: "cardhead" }, [el("h3", { text: t("network.order.progress") })]),
            el("div", { class: "sellergrid" }, [
              el("div", { class: "sfield" }, [el("span", { class: "slabel", text: t("network.view.status") }), el("span", {}, [statusChip(o.status)])]),
              pair(t("network.order.confirmedfield"), confirmed ? new Date(confirmed.at).toLocaleDateString() : confirmation ? t("network.order.notyet") : null),
              pair(t("network.order.outstanding"), toDeliver === null ? null : qty(toDeliver)),
              pair(t("network.order.toinvoice"), qty(sum("toInvoice"))),
            ]),
          ]),
        ]),
        el("div", { class: "panel netviewheader", id: "net-order-header" }, [
          el("div", { class: "cardhead" }, [el("h3", { text: t("network.order.header") })]),
          el("div", { class: "headersummary" }, [
            el("div", { class: "hscolumn" }, [field(t("network.order.number"), o.invoiceNumber), field(t("network.create.currency"), o.currency)]),
            el("div", { class: "hscolumn" }, [field(t("network.order.date"), o.issueDate), field(t("network.order.requisition"), o.requisition)]),
            el("div", { class: "hscolumn" }, [field(t("network.create.net"), m(o.net), "money"), field(t("network.create.vatamount"), m(o.vat), "money")]),
            el("div", { class: "hscolumn" }, [field(t("network.order.total"), m(o.total), "money"), field(t("network.col.company"), o.company)]),
          ]),
        ]),
      ].filter(Boolean)),
      side,
    ].filter(Boolean)),
    el("div", { class: "panel netviewlines", id: "net-order-lines" }, [
          el("div", { class: "cardhead" }, [el("h3", { text: t("network.order.linestitle") })]),
          lines.length
            ? el("table", { class: "linetable orderlines" }, [
                el("thead", {}, [
                  el("tr", {}, [
                    el("th", { class: "num", text: t("network.order.line") }),
                    el("th", { text: t("network.order.item") }),
                    el("th", { text: t("network.order.youritem") }),
                    el("th", { class: "num", text: t("network.order.ordered") }),
                    el("th", { text: t("network.order.unit") }),
                    el("th", { class: "num", text: t("network.order.price") }),
                    el("th", { class: "num", text: t("network.order.amount") }),
                    el("th", { class: "num", text: t("network.order.received") }),
                    el("th", { class: "num", text: t("network.order.invoiced") }),
                    el("th", { class: "num", text: t("network.order.outstanding") }),
                    // Decision 0755: what Invoice this order fills in.
                    el("th", { class: "num", text: t("network.order.toinvoice") }),
                  ]),
                ]),
                el(
                  "tbody",
                  {},
                  lines.map((l) =>
                    el("tr", { "data-line": String(l.lineNumber) }, [
                      cell(String(l.lineNumber)),
                      cell(dash(l.item), ""),
                      cell(dash(l.sellersItemId), ""),
                      cell(qty(l.ordered)),
                      cell(dash(l.unitCode), ""),
                      cell(price(l.price)),
                      cell(price(l.amount)),
                      cell(quiet(l.received)),
                      cell(quiet(l.invoiced)),
                      cell(typeof l.outstanding === "number" ? qty(l.outstanding) : el("span", { class: "muted", text: "—" })),
                      cell(quiet(l.toInvoice)),
                    ])
                  )
                ),
              ])
            : el("p", { class: "muted", text: t("network.order.nolines") }),
      el("div", { class: "netfoot" }, [
        el("div"),
        el("div", { class: "nettotals" }, [
          el("div", {}, [el("span", { text: t("network.create.linesnet") }), el("span", { text: m(o.net ?? sum("amount")) ?? "—" })]),
          typeof o.vat === "number" ? el("div", {}, [el("span", { text: t("network.create.vatamount") }), el("span", { text: m(o.vat) })]) : null,
          el("div", { class: "grand" }, [el("span", { text: t("network.order.total") }), el("span", { text: m(o.total) ?? "—" })]),
        ].filter(Boolean)),
      ]),
    ]),
  ]);
}
