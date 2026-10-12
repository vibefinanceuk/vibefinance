import { t, el } from "/strings.js";
import { topbar } from "/shell.js";
import { icon } from "/icons.js";

/**
 * **A goods receipt, opened — decision 0738.** Read only, laid out as an
 * invoice opened (0729): what the customer recorded as arriving and going
 * back against this supplier's purchase orders, line by line. No
 * conversation: a question about a delivery goes on its invoice.
 */

const dash = (v) => (v === null || v === undefined || v === "" ? "—" : String(v));
const qty = (n) => (typeof n === "number" ? (Number.isInteger(n) ? String(n) : n.toFixed(2)) : "—");
// Nothing to say is quieter than a zero.
const amount = (n) => (n ? qty(n) : el("span", { class: "muted", text: "—" }));

function pair(label, value) {
  return el("div", { class: "sfield" }, [el("span", { class: "slabel", text: label }), value ? el("span", { text: String(value) }) : el("span", { class: "muted", text: "—" })]);
}

/** The page. `deps` carries what portal.js owns: the status chip, and back to Documents. */
export function receiptPage(r, { statusChip, back }, handlers) {
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
  return el("div", { class: "netinvoiceview netreceiptview" }, [
    title,
    el("p", { class: "muted sm", text: t("network.receipt.note", { customer: r.customer ?? "" }) }),
    el("div", { class: "panel" }, [
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
    ]),
  ]);
}
