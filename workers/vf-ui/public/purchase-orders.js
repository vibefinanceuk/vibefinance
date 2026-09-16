import { t } from "/strings.js";
import { el, frame, topbar, setCurrentScreen } from "/tasks.js";
import { actionLink } from "/viewer.js";

/**
 * Loading, and now browsing, purchase orders — decisions 0371 and 0372.
 *
 * **A list, but still not an editable one.** A purchase order is
 * reference data invoices are matched against, not a document with
 * work attached to it (decision 0081's own reasoning) — so unlike
 * Suppliers there is no *Change*, no hold, no status. Clicking a row
 * opens what is on file, and the only action in the pop-out is Close.
 *
 * **No freshness indicator, unlike Suppliers.** `suppliers.js` can say
 * "loaded 4 days ago" because its own list endpoint returns `lastLoad`
 * alongside the data; nothing equivalent exists here.
 */

let purchaseOrders = [];

async function load() {
  try {
    const response = await fetch("/api/purchase-orders");
    if (!response.ok) return false;
    const body = await response.json();
    purchaseOrders = body.purchaseOrders ?? [];
    return true;
  } catch {
    return false;
  }
}

function note(message) {
  const box = document.getElementById("purchaseorders-note");
  if (box) box.textContent = message ?? "";
}

/** What a load did, shown where the person can act on it — mirrors suppliers.js's own outcome(). */
function outcome(result) {
  const lines = [
    el("div", { text: t("purchaseorders.ordersloaded").replace("{n}", String(result.ordersLoaded)) }),
  ];

  if (result.ordersReplaced > 0) {
    lines.push(
      el("div", {
        class: "muted",
        text: t("purchaseorders.ordersreplaced").replace("{n}", String(result.ordersReplaced)),
      })
    );
  }

  lines.push(
    el("div", { class: "muted", text: t("purchaseorders.linesloaded").replace("{n}", String(result.linesLoaded)) })
  );

  if (result.refused?.length > 0) {
    // Order numbers, because that is what a person can act on in a
    // spreadsheet — decision 0211's own reasoning, unchanged for orders.
    lines.push(el("h3", { text: t("purchaseorders.refusedheading") }));
    for (const row of result.refused.slice(0, 20)) {
      lines.push(
        el("div", {
          class: "warn",
          text: t("purchaseorders.refusedorder")
            .replace("{order}", row.orderNumber)
            .replace("{reason}", row.reason),
        })
      );
    }
    if (result.refused.length > 20) {
      lines.push(
        el("div", {
          class: "muted",
          text: t("purchaseorders.refusedmore").replace("{n}", String(result.refused.length - 20)),
        })
      );
    }
  }

  return el("div", { class: "panel" }, lines);
}

function loader() {
  const picker = el("input", { type: "file", accept: ".csv,text/csv", id: "purchaseorderfile" });
  // The handler goes in at construction — actionLink disables a button
  // with no onclick (decision 0161), and assigning it afterwards
  // leaves the button disabled and looking fine.
  const button = actionLink("load", { primary: true, onclick: () => runLoad() });

  async function runLoad() {
    const file = picker.files?.[0];
    if (!file) {
      note(t("purchaseorders.nofile"));
      return;
    }

    button.disabled = true;

    // One try per thing that can fail, not one around everything —
    // decision 0216, the same discipline suppliers.js's own loader
    // already follows: a bug in the redraw must never be reported as
    // "we could not reach the service."
    let response;
    try {
      response = await fetch("/api/purchase-orders/csv-load", {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: await file.text(),
      });
    } catch {
      note(t("purchaseorders.loadfailed"));
      button.disabled = false;
      return;
    }

    try {
      const body = await response.json();

      if (!response.ok) {
        // The route's own words, not a generic failure — a file with
        // no order number column is refused for a specific reason.
        note(body.error);
        return;
      }

      // The list has to reflect what was just loaded, the same
      // reload-then-redraw suppliers.js already does after its own
      // load — otherwise a person watches the outcome say "8 loaded"
      // above a table that still shows what it showed a moment ago.
      await load();
      render();
      const panel = document.getElementById("purchaseorders-note");
      if (panel) panel.replaceChildren(outcome(body));
    } catch (err) {
      note(`${t("purchaseorders.loadbroke")} ${err?.message ?? ""}`);
    } finally {
      button.disabled = false;
    }
  }

  return el("div", { class: "panel" }, [
    el("div", { class: "cardhead" }, [
      el("h3", { text: t("purchaseorders.loadheading") }),
      el("div", { class: "statebuttons" }, [button]),
    ]),
    el("p", { class: "muted", text: t("purchaseorders.loadhelp") }),
    picker,
  ]);
}

/** One label:value pair in a read-only grid — .editgrid's own two-column layout, without an input. */
function fact(label, value) {
  return [el("div", { class: "muted", text: label }), el("div", { text: value ?? "—" })];
}

/** The full detail pop-out — decision 0372, on the operator's own request: "all PO and PO Line information." */
async function openPurchaseOrder(summary) {
  const backdrop = el("div", { class: "backdrop" }, [
    el("div", { class: "panel muted", text: t("purchaseorders.loading") }),
  ]);
  const close = () => backdrop.remove();
  backdrop.onclick = (e) => {
    if (e.target === backdrop) close();
  };
  document.body.append(backdrop);

  let response;
  try {
    response = await fetch(`/api/purchase-orders/${encodeURIComponent(summary.order_number)}`);
  } catch {
    backdrop.replaceChildren(el("div", { class: "popout warn", text: t("purchaseorders.detailfailed") }));
    return;
  }
  if (!response.ok) {
    backdrop.replaceChildren(el("div", { class: "popout warn", text: t("purchaseorders.detailfailed") }));
    return;
  }
  const { order, lines } = await response.json();

  const header = el("div", { class: "editgrid" }, [
    ...fact(t("purchaseorders.ordernumber"), order.order_number),
    ...fact(t("purchaseorders.issuedate"), order.issue_date),
    ...fact(t("purchaseorders.ordertype"), order.order_type_code),
    ...fact(t("purchaseorders.currency"), order.currency),
    ...fact(t("purchaseorders.seller"), order.seller_party_id),
    ...fact(t("purchaseorders.buyer"), order.buyer_party_id),
    ...fact(t("purchaseorders.netamount"), order.line_extension_amount),
    ...fact(t("purchaseorders.taxexclusive"), order.tax_exclusive_amount),
    ...fact(t("purchaseorders.taxinclusive"), order.tax_inclusive_amount),
    ...fact(t("purchaseorders.payable"), order.payable_amount),
    ...fact(t("purchaseorders.requisition"), order.originator_reference),
  ]);

  const lineRows = lines.map((l) =>
    el("tr", {}, [
      el("td", { text: l.line_number }),
      el("td", { text: l.item_name ?? "—" }),
      el("td", { class: "muted", text: l.item_description ?? "—" }),
      el("td", { class: "muted", text: l.sellers_item_id ?? "—" }),
      el("td", { class: "muted", text: l.standard_item_id ?? "—" }),
      el("td", { text: l.quantity ?? "—" }),
      el("td", { class: "muted", text: l.unit_code ?? "—" }),
      el("td", { text: l.price_amount ?? "—" }),
      el("td", { text: l.line_extension_amount ?? "—" }),
    ])
  );
  const linesTable = el("div", { class: "tablewrap" }, [
    el("table", {}, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", { text: t("purchaseorders.line") }),
          el("th", { text: t("purchaseorders.item") }),
          el("th", { text: t("purchaseorders.description") }),
          el("th", { text: t("purchaseorders.sku") }),
          el("th", { text: t("purchaseorders.standardid") }),
          el("th", { text: t("purchaseorders.quantity") }),
          el("th", { text: t("purchaseorders.unit") }),
          el("th", { text: t("purchaseorders.price") }),
          el("th", { text: t("purchaseorders.amount") }),
        ]),
      ]),
      el("tbody", {}, lineRows),
    ]),
  ]);

  backdrop.replaceChildren(
    el("div", { class: "popout wide" }, [
      el("div", { class: "cardhead" }, [
        el("h3", { text: order.order_number }),
        actionLink("close", { onclick: close }),
      ]),
      header,
      linesTable,
    ])
  );
}

function purchaseOrderRows() {
  if (purchaseOrders.length === 0) {
    return el("div", { class: "muted", text: t("purchaseorders.none") });
  }

  const rows = purchaseOrders.map((po) => {
    const row = el("tr", { class: "clickable" }, [
      el("td", { text: po.order_number }),
      el("td", { class: "muted", text: po.issue_date ?? "—" }),
      el("td", { class: "muted", text: po.seller_party_id ?? "—" }),
      el("td", { class: "muted", text: po.buyer_party_id ?? "—" }),
      el("td", { text: po.payable_amount ?? "—" }),
      el("td", { class: "muted", text: String(po.line_count) }),
    ]);
    // The whole row, not a button in it — the same reasoning
    // suppliers.js already gives: a purchase order is one thing, and
    // a person looking at a row is looking at that order.
    row.onclick = () => openPurchaseOrder(po);
    return row;
  });

  return el("div", { class: "tablewrap" }, [
    el("table", {}, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", { text: t("purchaseorders.ordernumber") }),
          el("th", { text: t("purchaseorders.issuedate") }),
          el("th", { text: t("purchaseorders.seller") }),
          el("th", { text: t("purchaseorders.buyer") }),
          el("th", { text: t("purchaseorders.total") }),
          el("th", { text: t("purchaseorders.lines") }),
        ]),
      ]),
      el("tbody", {}, rows),
    ]),
  ]);
}

function render() {
  const shell = document.getElementById("shell");
  if (!shell) return;

  // Through frame and topbar, like every other screen — decision
  // 0191's own finding: a screen that writes to #main directly, or
  // imports el/setCurrentScreen from strings.js instead of tasks.js,
  // is a screen the navigation cannot reach.
  shell.replaceChildren(
    frame(
      el("div", {}, [
        topbar(t("purchaseorders.heading"), t("purchaseorders.subtitle")),
        el("div", { id: "purchaseorders-note", class: "warn" }),
        loader(),
        el("div", { class: "panel" }, [purchaseOrderRows()]),
      ])
    )
  );
}

export async function open() {
  setCurrentScreen("purchaseorders");
  // render() first, always — decision 0372's own finding: calling
  // note() before the screen has ever rendered writes to an element
  // (#purchaseorders-note) that does not exist yet, and the message
  // goes nowhere. The same bug suppliers.js's own open() carried,
  // unfixed until this was built and a test actually exercised a
  // failed first load.
  const ok = await load();
  render();
  if (!ok) note(t("purchaseorders.failed"));
}

