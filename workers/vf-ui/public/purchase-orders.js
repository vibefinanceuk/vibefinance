import { t } from "/strings.js";
import { el, frame, topbar, setCurrentScreen } from "/tasks.js";
import { actionLink } from "/viewer.js";
import { icon } from "/icons.js";
import { currentOrgId } from "/orgs.js";

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
let csvFormat = null;

/**
 * Search and pagination state — decision 0376. Module-level, reset to
 * defaults every time the screen opens (`open()` below) rather than
 * carried across navigations — a fresh view each time, the same
 * choice this screen already made for its own results before search
 * or pagination existed at all.
 */
let searchTerm = "";
let page = 1;
let pageSize = 50;
let total = 0;

const PAGE_SIZES = [25, 50, 100, 200];

async function load() {
  try {
    // The chosen org — decision 0374, the same treatment Suppliers'
    // own load() already gives it (decision 0317), and why this
    // screen needs no explicit wiring into relaunchAfterOrgChange:
    // switching orgs re-dispatches to whatever screen is current
    // (tasks.js's own go(current)), which calls this open() again.
    const org = currentOrgId();
    const params = new URLSearchParams();
    if (org) params.set("org", org);
    if (searchTerm) params.set("search", searchTerm);
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    const response = await fetch(`/api/purchase-orders?${params}`);
    if (!response.ok) return false;
    const body = await response.json();
    purchaseOrders = body.purchaseOrders ?? [];
    // Read back from the response, not assumed from what was sent —
    // the route itself clamps an out-of-range page or an unlisted
    // page size to a real default, and the controls must reflect
    // what the server actually used, not what was merely requested.
    total = body.total ?? 0;
    page = body.page ?? page;
    pageSize = body.pageSize ?? pageSize;
    return true;
  } catch {
    return false;
  }
}

/**
 * The format reference itself — decision 0373, on the operator's own
 * observation: without it, a person preparing their own file has
 * nothing to go on beyond the one-line hint in `loadhelp`. Failure
 * here is deliberately independent of `load()`'s own — the reference
 * is a help affordance, not core functionality, so its own absence
 * degrades gracefully (the disclosure and template link simply do not
 * appear) rather than blocking the load card or the list either one.
 */
async function loadFormat() {
  try {
    const response = await fetch("/api/purchase-orders/csv-format");
    if (!response.ok) return;
    csvFormat = await response.json();
  } catch {
    csvFormat = null;
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

/**
 * A ready-to-fill CSV, built purely from the recommended (first-listed)
 * column of every field `csvFormat` describes — no new backend
 * capability needed, since the backend already told the screen
 * everything it needs to build one.
 */
function downloadTemplate() {
  if (!csvFormat) return;
  const headerRow = csvFormat.header.map((f) => f.columns[0]);
  const lineRow = csvFormat.line.map((f) => f.columns[0]);
  const csv = [...headerRow, ...lineRow].join(",") + "\n";

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const anchor = el("a", { href: url, download: "purchase-orders-template.csv" });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** One field's own row in the format reference table. */
function fieldRow(spec) {
  return el("tr", {}, [
    el("td", { text: spec.key }),
    el("td", { class: "muted", text: spec.columns.join(", ") }),
    el("td", { text: spec.required ? t("purchaseorders.required") : "—" }),
  ]);
}

function fieldTable(heading, specs) {
  return el("div", {}, [
    el("h4", { text: heading }),
    el("div", { class: "tablewrap" }, [
      el("table", {}, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", { text: t("purchaseorders.fieldname") }),
            el("th", { text: t("purchaseorders.acceptedcolumns") }),
            el("th", { text: t("purchaseorders.required") }),
          ]),
        ]),
        el("tbody", {}, specs.map(fieldRow)),
      ]),
    ]),
  ]);
}

/**
 * The disclosure itself. `csvFormat` is fetched once, at screen open,
 * so opening this costs nothing further — no per-expand fetch, no
 * loading state to design for.
 */
function formatReference() {
  if (!csvFormat) return el("div", {});

  return el("details", { class: "poformat" }, [
    el("summary", { text: t("purchaseorders.viewformat") }),
    fieldTable(t("purchaseorders.headercolumns"), csvFormat.header),
    fieldTable(t("purchaseorders.linecolumns"), csvFormat.line),
  ]);
}

function loader() {
  const picker = el("input", { type: "file", accept: ".csv,text/csv", id: "purchaseorderfile" });
  // The handler goes in at construction — actionLink disables a button
  // with no onclick (decision 0161), and assigning it afterwards
  // leaves the button disabled and looking fine.
  const button = actionLink("load", { primary: true, onclick: () => runLoad(), label: t("purchaseorders.loadbutton") });

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
      // Back to page 1 — decision 0376 — since a newly-loaded order
      // sorts to the top and a person left on page 3 would not see it.
      page = 1;
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

  const templateButton = actionLink("download", {
    onclick: () => downloadTemplate(),
    label: t("purchaseorders.templatebutton"),
  });
  // csvFormat is already in its final state by the time loader() runs
  // — open() awaits loadFormat() before ever calling render() — so
  // this is a one-time check, not something that needs to react to a
  // later state change.
  templateButton.disabled = !csvFormat;

  return el("div", { class: "panel" }, [
    el("div", { class: "cardhead" }, [
      el("h3", { text: t("purchaseorders.loadheading") }),
      el("div", { class: "statebuttons" }, [templateButton, button]),
    ]),
    el("p", { class: "muted", text: t("purchaseorders.loadhelp") }),
    picker,
    formatReference(),
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
    ...fact(t("purchaseorders.org"), order.org_unit_name),
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

/**
 * Reload after any control changes state, then redraw the whole
 * screen — the same "full render, then restore focus" shape
 * documents.js's own search box already established, rather than a
 * partial DOM patch. `focusId`, when given, is re-focused afterward,
 * since `render()` rebuilds the whole screen and would otherwise drop
 * focus out of whatever control the person was just using.
 */
async function reload(focusId) {
  await load();
  render();
  if (focusId) document.getElementById(focusId)?.focus();
}

/**
 * The search box and pagination controls, in one row above the list —
 * decision 0376, the operator's own layout: "in the same row as the
 * search I wondered if we could paginate the results." Both push to
 * the database rather than filtering or paging a fully-loaded list in
 * the browser, since the request that shaped this was a customer with
 * thousands of orders on file.
 */
function searchAndPaginationRow() {
  const search = el("input", {
    type: "search",
    id: "posearch",
    placeholder: t("purchaseorders.searchplaceholder"),
  });
  search.value = searchTerm;
  // onchange, not oninput — fires once the person is done typing
  // (blur or Enter), not on every keystroke, the same choice
  // documents.js's own search box already made.
  search.onchange = async () => {
    searchTerm = search.value;
    page = 1;
    await reload("posearch");
  };

  const sizePicker = el(
    "select",
    { id: "porowsize" },
    PAGE_SIZES.map((size) => el("option", { value: String(size), text: String(size) }))
  );
  sizePicker.value = String(pageSize);
  sizePicker.onchange = async () => {
    pageSize = Number(sizePicker.value);
    page = 1;
    await reload("porowsize");
  };

  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const atFirst = page <= 1;
  const atLast = total === 0 || page >= totalPages;

  function navButton(name, label, disabled, onclick) {
    const button = el("button", { class: "iconbutton", "aria-label": label, title: label });
    button.append(icon(name));
    button.disabled = disabled;
    button.onclick = onclick;
    return button;
  }

  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  return el("div", { class: "searchrow" }, [
    search,
    el("label", { class: "sm muted", text: t("purchaseorders.rows") }),
    sizePicker,
    navButton("chevronsleft", t("purchaseorders.firstpage"), atFirst, async () => {
      page = 1;
      await reload();
    }),
    navButton("chevronleft", t("purchaseorders.previouspage"), atFirst, async () => {
      page = Math.max(1, page - 1);
      await reload();
    }),
    el("span", {
      class: "sm muted",
      text: t("purchaseorders.rangeof").replace("{start}", String(rangeStart)).replace("{end}", String(rangeEnd)).replace("{total}", String(total)),
    }),
    navButton("chevronright", t("purchaseorders.nextpage"), atLast, async () => {
      page = Math.min(totalPages, page + 1);
      await reload();
    }),
    navButton("chevronsright", t("purchaseorders.lastpage"), atLast, async () => {
      page = totalPages;
      await reload();
    }),
  ]);
}

function purchaseOrderRows() {
  if (purchaseOrders.length === 0) {
    // Distinct from "nothing has ever been loaded" — a search or the
    // chosen org narrowing to nothing is a different fact from an
    // empty warehouse, and worth saying so rather than reusing the
    // same line for both.
    const message = searchTerm ? t("purchaseorders.nomatches") : t("purchaseorders.none");
    return el("div", { class: "muted", text: message });
  }

  const rows = purchaseOrders.map((po) => {
    const row = el("tr", { class: "clickable" }, [
      el("td", { text: po.order_number }),
      el("td", { class: "muted", text: po.issue_date ?? "—" }),
      el("td", { class: "muted", text: po.seller_party_id ?? "—" }),
      el("td", { class: "muted", text: po.buyer_party_id ?? "—" }),
      el("td", { text: po.org_unit_name ?? "—" }),
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
          el("th", { text: t("purchaseorders.org") }),
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
        el("div", { class: "panel" }, [searchAndPaginationRow()]),
        el("div", { class: "panel" }, [purchaseOrderRows()]),
      ])
    )
  );
}

export async function open() {
  setCurrentScreen("purchaseorders");
  // Search and pagination reset to their defaults on every fresh
  // open — decision 0376, the same "a clean view each time" choice
  // this screen already makes for the org switcher itself: switching
  // orgs re-dispatches here through the same open(), and a page 3
  // search left over from a different org would not mean anything in
  // the new one anyway.
  searchTerm = "";
  page = 1;
  // render() first, always — decision 0372's own finding: calling
  // note() before the screen has ever rendered writes to an element
  // (#purchaseorders-note) that does not exist yet, and the message
  // goes nowhere. The same bug suppliers.js's own open() carried,
  // unfixed until this was built and a test actually exercised a
  // failed first load.
  const ok = await load();
  // Independent of load()'s own outcome — decision 0373's own format
  // reference is a help affordance, not core functionality, so its
  // own failure must never block the list or the load card either one.
  await loadFormat();
  render();
  if (!ok) note(t("purchaseorders.failed"));
}

