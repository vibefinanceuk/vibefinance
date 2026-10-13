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

/**
 * **Whether the order can be invoiced now — decision 0755**, and if not,
 * why: not while it is closed or on hold, nor once nothing is left to
 * invoice (where the customer receipts the goods, nothing received and
 * not yet invoiced). Exported for its test.
 */
export function invoiceable(o) {
  if (o.status === "order_closed") return { ok: false, why: "closed" };
  if (o.status === "order_on_hold") return { ok: false, why: "onhold" };
  if (!(o.lines ?? []).some((l) => typeof l.toInvoice === "number" && l.toInvoice > 0)) return { ok: false, why: o.receiptingRequired && !(o.lines ?? []).some((l) => l.received > (l.invoiced ?? 0)) ? "nothingreceived" : "allinvoiced" };
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
  const confirmButton =
    confirm && confirmation && !confirmed
      ? el(
          "button",
          {
            class: "actionlink primary",
            type: "button",
            id: "net-confirm",
            title: t("network.order.confirmtitle", { customer: o.customer ?? "" }),
            onclick: async (e) => {
              const button = e.currentTarget;
              button.disabled = true;
              confirmProblem.textContent = "";
              if (!(await confirm())) {
                button.disabled = false;
                confirmProblem.textContent = t("network.order.confirmfailed");
              }
            },
          },
          [icon("tick"), el("span", { text: t("network.order.confirm") })]
        )
      : null;
  const confirmLine = confirmation
    ? confirmed
      ? el("p", { class: "muted sm", id: "net-confirmed-line", text: t(`network.order.confirmedline.${confirmed.kind ?? "order"}`, { date: new Date(confirmed.at).toLocaleDateString() }) })
      : el("p", { class: "muted sm", id: "net-toconfirm-line", text: t(`network.order.toconfirm.${confirmation.kind ?? "order"}`, { customer: o.customer ?? "" }) })
    : null;
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
  const chat = conversation ? conversation(o) : null;
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
    const panes = [
      { key: "messages", label: t("network.order.messagestab"), pane: chat ?? el("div", {}) },
      { key: "document", label: t("orderdoc.tab"), pane: doc.content, onSelect: doc.open },
      ...(files ? [{ key: "attachments", label: t("network.order.attachtab"), pane: files.content }] : []),
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
    select("messages");
    side = el("div", { class: "panel netviewchat netsidetabs" }, [el("div", { class: "doctabs receipttabs", role: "tablist" }, panes.map((p) => p.button)), ...panes.map((p) => p.pane)]);
  }
  return el("div", { class: "netinvoiceview netorderview" }, [
    title,
    el("p", { class: "muted sm", text: t("network.order.note", { customer: o.customer ?? "" }) }),
    confirmLine,
    confirmProblem,
    invoice && !can.ok ? el("p", { class: "muted sm", id: "net-invoiceorder-why", text: t(`network.invoiceorder.why.${can.why}`) }) : null,
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
        ]),
      ]),
      side,
    ].filter(Boolean)),
  ]);
}
