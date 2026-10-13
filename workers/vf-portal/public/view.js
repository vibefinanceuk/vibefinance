import { t, el } from "/strings.js";
import { topbar } from "/shell.js";
import { icon } from "/icons.js";

/**
 * **An invoice, opened full screen — decision 0729.** Laid out as Create
 * is (the Seller, Buyer and Payment cards, then the invoice header), read
 * only; the messages with the customer on the right, as tall as the cards
 * and the header beside them; the lines below, across the whole page.
 * Documents in the top bar goes back to the list; Download saves what is
 * shown as a CSV file.
 */

const dash = (v) => (v === null || v === undefined || v === "" ? "—" : String(v));

function pair(label, value) {
  const lines = (Array.isArray(value) ? value : [value]).filter((v) => v !== null && v !== undefined && v !== "");
  return el("div", { class: "sfield" }, [
    el("span", { class: "slabel", text: label }),
    lines.length ? el("span", {}, lines.map((l) => el("div", { text: String(l) }))) : el("span", { class: "muted", text: "—" }),
  ]);
}

const field = (label, value, cls = "") => el("div", { class: "kf" }, [el("label", { text: label }), el("div", { class: `readonly ${cls}`.trim(), text: dash(value) })]);

const address = (p) => [p.addressLine, [p.city, p.country].filter(Boolean).join(", "), p.postalCode];

/** The invoice as a CSV file: its header, then a row per line. */
export function invoiceCsv(inv) {
  const cell = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [
    [t("network.create.number"), inv.invoiceNumber],
    [t("network.create.issuedate"), inv.issueDate],
    [t("network.create.duedate"), inv.dueDate],
    [t("network.create.currency"), inv.currency],
    [t("network.create.po"), inv.purchaseOrder],
    [t("network.create.buyerref"), inv.buyerReference],
    [t("network.create.seller"), inv.parties?.seller?.name ?? inv.supplier],
    [t("network.create.buyer"), inv.parties?.buyer?.name ?? inv.company],
    [t("network.create.net"), inv.net],
    [t("network.create.vatamount"), inv.vat],
    [t("network.create.total"), inv.total],
    [],
    ["#", t("network.line.description"), t("network.line.quantity"), t("network.line.unitprice"), t("network.line.net")],
    ...(inv.lines ?? []).map((l) => [l.lineNumber, l.description, l.quantity, l.unitPrice, l.netAmount]),
  ];
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

function download(inv) {
  const blob = new Blob([invoiceCsv(inv)], { type: "text/csv" });
  const a = el("a", { href: URL.createObjectURL(blob), download: `${(inv.invoiceNumber ?? "invoice").replace(/[^\w.-]+/g, "_")}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * The page. `deps` carries what portal.js owns: money, the status chip and
 * the conversation (with what to do once a message is sent), and back.
 */
export function viewPage(inv, { money, statusChip, conversation, back, credit, document: documentTab, attachments: attachmentsTab }, handlers) {
  // Decision 0732: a credit note reads as one, and an invoice may be credited.
  const cn = inv.documentType === "credit_note";
  const L = (invoiceKey, creditKey) => t(cn ? creditKey : invoiceKey);
  const m = (v) => (typeof v === "number" ? money(v, inv.currency) : "—");
  const seller = inv.parties?.seller ?? {};
  const buyer = inv.parties?.buyer ?? {};
  const own = [
    el("button", { class: "actionlink", type: "button", title: t("network.view.backtitle"), onclick: back }, [icon("back"), el("span", { text: t("network.view.back") })]),
    el("button", { class: "actionlink", type: "button", title: t("network.view.downloadtitle"), onclick: () => download(inv) }, [icon("download"), el("span", { text: t("network.view.download") })]),
    inv.mayCredit && credit
      ? el("button", { class: "actionlink", type: "button", title: t("network.credit.raisetitle"), onclick: credit }, [icon("documents"), el("span", { text: t("network.credit.raise") })])
      : null,
  ].filter(Boolean);
  const title = topbar(
    inv.invoiceNumber ?? "—",
    t("network.view.subtitle", { customer: inv.customer ?? "", company: inv.company ?? "", date: (inv.receivedAt ?? "").slice(0, 10) }),
    own,
    handlers
  );
  if (cn) title.querySelector("h2")?.append(el("span", { class: "bisbadge", text: t("network.types.credit_note") }));
  title.querySelector("h2")?.append(statusChip(inv.status));

  const chat = conversation(inv);
  chat.classList.add("panel", "netviewchat");
  /**
   * **Document, Attachments and Messages — decision 0770**, as an order's
   * (0765): the file the customer received, its downloads, and the
   * conversation, the Document first. Only where there is a document to
   * show and the customer shares it; otherwise the conversation alone.
   */
  let side = chat;
  const hasDocument = (inv.documentFiles ?? []).length > 0;
  const doc = documentTab && hasDocument ? documentTab(inv) : null;
  const files = attachmentsTab && hasDocument ? attachmentsTab(inv) : null;
  if (doc) {
    const panes = [
      { key: "document", label: t("orderdoc.tab"), pane: doc.content, onSelect: doc.open },
      ...(files ? [{ key: "attachments", label: t("network.order.attachtab"), pane: files.content }] : []),
      { key: "messages", label: t("network.order.messagestab"), pane: chat },
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

  const lines = inv.lines ?? [];
  const net = typeof inv.net === "number" ? inv.net : lines.reduce((s, l) => s + (typeof l.netAmount === "number" ? l.netAmount : 0), 0);

  const page = el("div", { class: "netinvoiceview" }, [
    title,
    el("div", { class: doc ? "netview netcreate netwide" : "netview netcreate" }, [
      el("div", { class: "netviewmain" }, [
        cn && inv.creditedInvoice ? el("div", { class: "sentnotice", text: t("network.credit.credits.line", { invoice: inv.creditedInvoice }) }) : null,
        inv.comment ? el("div", { class: "comment" }, [el("div", { class: "sm", text: t("network.comment", { customer: inv.customer }) }), el("div", { text: inv.comment })]) : null,
        el("div", { class: "row3" }, [
          el("div", { class: "panel" }, [
            el("div", { class: "cardhead" }, [el("h3", { text: t("network.create.seller") })]),
            seller.reference ? el("div", { class: "sub", text: seller.reference }) : null,
            el("div", { class: "sellergrid" }, [
              pair(t("network.create.name"), seller.name ?? inv.supplier),
              pair(t("network.create.vat"), seller.vatId),
              pair(t("network.create.address"), address(seller)),
            ]),
          ]),
          el("div", { class: "panel" }, [
            el("div", { class: "cardhead" }, [el("h3", { text: t("network.create.buyer") })]),
            el("div", { class: "sub", text: inv.customer ?? "" }),
            el("div", { class: "sellergrid" }, [
              pair(t("network.create.name"), buyer.name ?? inv.company),
              pair(t("network.create.vat"), buyer.vatId),
              pair(t("network.create.address"), address(buyer)),
            ]),
          ]),
          el("div", { class: "panel" }, [
            el("div", { class: "cardhead" }, [el("h3", { text: t("network.create.payment") })]),
            el("div", { class: "sellergrid" }, [
              el("div", { class: "sfield" }, [el("span", { class: "slabel", text: t("network.view.status") }), el("span", {}, [statusChip(inv.status)])]),
              pair(t("network.create.duedate"), inv.dueDate),
              pair(t("network.create.terms"), inv.paymentTerms),
              pair(t("network.create.payinto"), seller.account?.identifier),
            ]),
          ]),
        ]),
        el("div", { class: "panel netviewheader" }, [
          el("div", { class: "cardhead" }, [el("h3", { text: L("network.create.header", "network.credit.header") })]),
          el("div", { class: "headersummary" }, [
            el("div", { class: "hscolumn" }, [field(L("network.create.number", "network.credit.number"), inv.invoiceNumber), field(t("network.create.currency"), inv.currency)]),
            el("div", { class: "hscolumn" }, [field(t("network.create.issuedate"), inv.issueDate), field(t("network.create.duedate"), inv.dueDate)]),
            el("div", { class: "hscolumn" }, [field(t("network.create.po"), inv.purchaseOrder), field(t("network.create.buyerref"), inv.buyerReference)]),
            el("div", { class: "hscolumn" }, [field(t("network.create.net"), m(net), "money"), field(t("network.create.vatamount"), m(inv.vat), "money")]),
            el("div", { class: "hscolumn" }, [field(L("network.create.total", "network.credit.total"), m(inv.total), "money"), field(t("network.receivedat"), (inv.receivedAt ?? "").slice(0, 10))]),
          ]),
        ]),
      ]),
      side,
    ]),
    el("div", { class: "panel netviewlines" }, [
      el("div", { class: "cardhead" }, [el("h3", { text: L("network.create.lines", "network.credit.lines") })]),
      lines.length
        ? el("table", { class: "linetable" }, [
            el("colgroup", {}, [40, null, 110, 130, 130].map((w) => el("col", w ? { style: `width:${w}px` } : {}))),
            el("thead", {}, [
              el("tr", {}, [
                el("th", { text: "#" }),
                el("th", { text: t("network.line.description") }),
                el("th", { class: "num", text: t("network.line.quantity") }),
                el("th", { class: "num", text: t("network.line.unitprice") }),
                el("th", { class: "num", text: t("network.line.net") }),
              ]),
            ]),
            el(
              "tbody",
              {},
              lines.map((l) =>
                el("tr", {}, [
                  el("td", { text: String(l.lineNumber) }),
                  el("td", { text: dash(l.description) }),
                  el("td", { class: "num", text: dash(l.quantity) }),
                  el("td", { class: "num", text: m(l.unitPrice) }),
                  el("td", { class: "num", text: m(l.netAmount) }),
                ])
              )
            ),
          ])
        : el("p", { class: "muted", text: t("network.view.nolines") }),
      el("div", { class: "netfoot" }, [
        el("div"),
        el("div", { class: "nettotals" }, [
          el("div", {}, [el("span", { text: t("network.create.linesnet") }), el("span", { text: m(net) })]),
          el("div", {}, [el("span", { text: t("network.create.vatamount") }), el("span", { text: m(inv.vat) })]),
          el("div", { class: "grand" }, [el("span", { text: L("network.create.total", "network.credit.total") }), el("span", { text: m(inv.total) })]),
        ]),
      ]),
    ]),
  ]);
  return page;
}
