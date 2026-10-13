import { t, el } from "/strings.js";
import { topbar } from "/shell.js";
import { icon } from "/icons.js";

/**
 * **A goods receipt, opened — decision 0738.** Read only, laid out as an
 * invoice opened (0729): what the customer recorded as arriving and going
 * back against this supplier's purchase orders, line by line; and the
 * conversation with the customer about it on the right, as an invoice's
 * (decision 0740).
 */

const dash = (v) => (v === null || v === undefined || v === "" ? "—" : String(v));
const qty = (n) => (typeof n === "number" ? (Number.isInteger(n) ? String(n) : n.toFixed(2)) : "—");
// Nothing to say is quieter than a zero.
const amount = (n) => (n ? qty(n) : el("span", { class: "muted", text: "—" }));

function pair(label, value) {
  return el("div", { class: "sfield" }, [el("span", { class: "slabel", text: label }), value ? el("span", { text: String(value) }) : el("span", { class: "muted", text: "—" })]);
}

/** The page. `deps` carries what portal.js owns: the status chip, back to Documents, and the conversation (0740). */
export function receiptPage(r, { statusChip, back, conversation, document: documentTab, attachments: attachmentsTab }, handlers) {
  const title = topbar(
    r.invoiceNumber ?? "—",
    t("network.receipt.subtitle", { customer: r.customer ?? "", company: r.company ?? "", date: r.issueDate ?? "" }),
    [el("button", { class: "actionlink", type: "button", title: t("network.view.backtitle"), onclick: back }, [icon("back"), el("span", { text: t("network.view.back") })])],
    handlers
  );
  const h2 = title.querySelector("h2");
  h2?.append(el("span", { class: "bisbadge", text: t("network.types.goods_receipt") }));
  h2?.append(statusChip(r.status));

  const lines = r.lines ?? [];
  const cell = (v, cls = "num") => el("td", { class: cls }, [typeof v === "string" || typeof v === "number" ? String(v) : v]);
  const chat = conversation ? conversation(r) : null;
  chat?.classList.add("panel", "netviewchat");
  /**
   * **Document, Attachments and Messages — decision 0773**, as an order's
   * (0765) and an invoice's (0770): the receipt as a PDF, the page both
   * sides see; its PDF and CSV to download; and the conversation. The
   * Document first.
   */
  let side = chat;
  const doc = documentTab ? documentTab(r) : null;
  const files = attachmentsTab ? attachmentsTab(r) : null;
  if (doc && chat) {
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
  return el("div", { class: "netinvoiceview netreceiptview" }, [
    title,
    el("div", { class: side !== chat ? "netview netcreate netwide" : "netview netcreate" }, [el("div", { class: "netviewmain" }, [el("div", { class: "panel" }, [
      el("div", { class: "cardhead" }, [el("h3", { text: t("network.receipt.title") })]),
      el("div", { class: "sellergrid receiptgrid" }, [
        pair(t("network.col.customer"), r.customer),
        pair(t("network.col.company"), r.company),
        pair(t("network.receipt.date"), r.issueDate),
        pair(t("network.receipt.deliverynote"), r.deliveryNote),
        pair(t("network.col.po"), r.purchaseOrder),
      ]),
    ]),
    el("div", { class: "panel netviewlines" }, [
      el("div", { class: "cardhead" }, [el("h3", { text: t("network.receipt.lines") })]),
      lines.length
        ? el("table", { class: "linetable receiptlines" }, [
            el("thead", {}, [
              el("tr", {}, [
                el("th", { text: t("network.receipt.order") }),
                el("th", { class: "num", text: t("network.receipt.line") }),
                el("th", { text: t("network.receipt.item") }),
                el("th", { class: "num", text: t("network.receipt.ordered") }),
                el("th", { class: "num", text: t("network.receipt.received") }),
                el("th", { class: "num", text: t("network.receipt.rejected") }),
                el("th", { class: "num", text: t("network.receipt.returned") }),
                el("th", { text: t("network.receipt.unit") }),
                el("th", { text: t("network.receipt.reason") }),
              ]),
            ]),
            el(
              "tbody",
              {},
              lines.map((l) =>
                el("tr", {}, [
                  cell(dash(l.orderNumber), ""),
                  cell(dash(l.orderLine)),
                  cell(dash(l.item), ""),
                  cell(qty(l.ordered)),
                  cell(amount(l.received)),
                  cell(amount(l.rejected)),
                  cell(amount(l.returned)),
                  cell(dash(l.unitCode), ""),
                  cell(l.reason ? l.reason : el("span", { class: "muted", text: "—" }), ""),
                ])
              )
            ),
          ])
        : el("p", { class: "muted", text: t("network.receipt.nolines") }),
    ])]), side].filter(Boolean)),
  ]);
}
