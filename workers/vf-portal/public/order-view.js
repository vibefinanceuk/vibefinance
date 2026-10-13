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

function pair(label, value) {
  return el("div", { class: "sfield" }, [el("span", { class: "slabel", text: label }), value ? el("span", { text: String(value) }) : el("span", { class: "muted", text: "—" })]);
}

/** The page. `deps` carries what portal.js owns: the status chip, money, back to Documents, and the conversation (0752). */
export function orderPage(o, { statusChip, money, back, conversation }, handlers) {
  const title = topbar(
    o.invoiceNumber ?? "—",
    t("network.order.subtitle", { customer: o.customer ?? "", company: o.company ?? "", date: o.issueDate ?? "" }),
    [el("button", { class: "actionlink", type: "button", title: t("network.view.backtitle"), onclick: back }, [icon("back"), el("span", { text: t("network.view.back") })])],
    handlers
  );
  const h2 = title.querySelector("h2");
  h2?.append(el("span", { class: "bisbadge", text: t("network.types.purchase_order") }));
  h2?.append(statusChip(o.status));

  const lines = o.lines ?? [];
  const cell = (v, cls = "num") => el("td", { class: cls }, [typeof v === "string" || typeof v === "number" ? String(v) : v]);
  const price = (n) => (typeof n === "number" ? money(n, o.currency) : "—");
  const chat = conversation ? conversation(o) : null;
  chat?.classList.add("panel", "netviewchat");
  return el("div", { class: "netinvoiceview netorderview" }, [
    title,
    el("p", { class: "muted sm", text: t("network.order.note", { customer: o.customer ?? "" }) }),
    el("div", { class: "netview netcreate" }, [
      el("div", { class: "netviewmain" }, [
        el("div", { class: "panel" }, [
          el("div", { class: "cardhead" }, [el("h3", { text: t("network.order.title") })]),
          el("div", { class: "sellergrid receiptgrid" }, [
            pair(t("network.col.customer"), o.customer),
            pair(t("network.col.company"), o.company),
            pair(t("network.order.date"), o.issueDate),
            pair(t("network.order.currency"), o.currency),
            pair(t("network.order.total"), typeof o.total === "number" ? money(o.total, o.currency) : null),
          ]),
        ]),
        el("div", { class: "panel netviewlines" }, [
          el("div", { class: "cardhead" }, [el("h3", { text: t("network.order.lines") })]),
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
                    ])
                  )
                ),
              ])
            : el("p", { class: "muted", text: t("network.order.nolines") }),
        ]),
      ]),
      chat,
    ].filter(Boolean)),
  ]);
}
