import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The purchase order screen — load (decision 0371), then list and
 * detail pop-out (decision 0372) — and the class of bug decision 0191
 * already named once for Suppliers: a screen that renders correctly
 * proves nothing if the module cannot be imported, writes to an
 * element that is not there, or was never added to the navigation the
 * person actually clicks.
 */

function mountShell() {
  document.body.innerHTML = `<main id="shell"></main><main id="viewer" hidden></main>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "nav.tasks": "Tasks",
    "nav.dashboard": "Dashboard",
    "nav.purchaseorders": "Purchase Orders",
    "purchaseorders.heading": "Purchase Orders",
    "purchaseorders.subtitle": "Loaded so invoices can be matched against them.",
    "purchaseorders.loadheading": "Load purchase orders",
    "purchaseorders.loadhelp": "A CSV exported from your ERP, one row per order line.",
    "purchaseorders.nofile": "Choose a file first.",
    "purchaseorders.loadfailed": "We could not reach the service to load that file.",
    "purchaseorders.loadbroke": "The file was loaded, but this screen could not show the result:",
    "purchaseorders.ordersloaded": "{n} purchase orders loaded.",
    "purchaseorders.ordersreplaced": "{n} of those replaced an order already on file.",
    "purchaseorders.linesloaded": "{n} order lines loaded.",
    "purchaseorders.refusedheading": "Orders which could not be loaded",
    "purchaseorders.refusedorder": "Order {order}: {reason}",
    "purchaseorders.refusedmore": "and {n} more.",
    "purchaseorders.ordernumber": "Order Number",
    "purchaseorders.issuedate": "Issue Date",
    "purchaseorders.seller": "Seller",
    "purchaseorders.buyer": "Buyer",
    "purchaseorders.org": "Org",
    "purchaseorders.searchplaceholder": "Search order number, seller, item...",
    "purchaseorders.rows": "Rows",
    "purchaseorders.rangeof": "{start}–{end} of {total}",
    "purchaseorders.firstpage": "First page",
    "purchaseorders.previouspage": "Previous page",
    "purchaseorders.nextpage": "Next page",
    "purchaseorders.lastpage": "Last page",
    "purchaseorders.nomatches": "No purchase orders match your search.",
    "purchaseorders.statusheading": "Status",
    "purchaseorders.statuslabel": "Status",
    "purchaseorders.status.active": "Active",
    "purchaseorders.status.onhold": "On Hold",
    "purchaseorders.status.closed": "Closed",
    "purchaseorders.status.invoicedpart": "Invoiced (Part)",
    "purchaseorders.status.invoicedfull": "Invoiced (Full)",
    "purchaseorders.hold": "Hold",
    "purchaseorders.holdreason": "Why is this order on hold?",
    "purchaseorders.holdreasonhint": "Reason for the hold",
    "purchaseorders.holdconfirm": "Confirm hold",
    "purchaseorders.closeorder": "Close Order",
    "purchaseorders.closeconfirm": "Close this order permanently? This cannot be undone.",
    "purchaseorders.statuschangefailed": "Could not change the order's status.",
    "purchaseorders.nostatusdata": "No status data to show yet.",
    "action.hold": "Hold",
    "action.releasehold": "Release hold",
    "purchaseorders.total": "Total",
    "purchaseorders.lines": "Lines",
    "purchaseorders.none": "No purchase orders have been loaded yet.",
    "purchaseorders.failed": "The purchase order list could not be loaded.",
    "purchaseorders.loading": "Loading...",
    "purchaseorders.detailfailed": "This purchase order could not be loaded.",
    "purchaseorders.ordertype": "Order Type",
    "purchaseorders.currency": "Currency",
    "purchaseorders.netamount": "Net Amount",
    "purchaseorders.taxexclusive": "Tax Exclusive",
    "purchaseorders.taxinclusive": "Tax Inclusive",
    "purchaseorders.payable": "Payable",
    "purchaseorders.requisition": "Requisition Reference",
    "purchaseorders.line": "Line",
    "purchaseorders.item": "Item",
    "purchaseorders.description": "Description",
    "purchaseorders.sku": "Seller's Item ID",
    "purchaseorders.standardid": "Standard Item ID",
    "purchaseorders.quantity": "Quantity",
    "purchaseorders.unit": "Unit",
    "purchaseorders.price": "Unit Price",
    "purchaseorders.amount": "Amount",
    "purchaseorders.viewformat": "View accepted columns",
    "purchaseorders.fieldname": "Field",
    "purchaseorders.acceptedcolumns": "Accepted column names",
    "purchaseorders.required": "Required",
    "purchaseorders.headercolumns": "Header columns",
    "purchaseorders.linecolumns": "Line columns",
    "action.load": "Load",
    "action.close": "Close",
    "action.download": "Download",
    "purchaseorders.loadbutton": "Load CSV",
    "purchaseorders.templatebutton": "CSV Template",
  },
};

const EMPTY_LIST = { purchaseOrders: [], total: 0, page: 1, pageSize: 50 };

const ONE_ORDER = {
  purchaseOrders: [
    {
      id: "po-1",
      order_number: "PO-500",
      issue_date: "2026-09-01",
      currency: "EUR",
      seller_party_id: "GB447711223",
      buyer_party_id: "GB907856452",
      org_unit_id: "acme-uk",
      org_unit_name: "Acme UK",
      payable_amount: 864,
      line_count: 2,
    },
  ],
  total: 1,
  page: 1,
  pageSize: 50,
};

const SAMPLE_FORMAT = {
  header: [
    { key: "order_number", columns: ["order_number", "order number", "po_number"], required: true, description: "The buyer's own order number." },
    { key: "issue_date", columns: ["issue_date", "issue date"], required: false, description: "When the order was issued." },
  ],
  line: [
    { key: "line_number", columns: ["line_number", "line number"], required: true, description: "Which line of the order this is." },
    { key: "quantity", columns: ["quantity", "qty"], required: false, description: "The quantity ordered." },
  ],
};

const PO_500_DETAIL = {
  order: {
    id: "po-1",
    order_number: "PO-500",
    issue_date: "2026-09-01",
    order_type_code: "220",
    currency: "EUR",
    seller_party_id: "GB447711223",
    buyer_party_id: "GB907856452",
    org_unit_id: "acme-uk",
    org_unit_name: "Acme UK",
    line_extension_amount: 720,
    tax_exclusive_amount: 720,
    tax_inclusive_amount: 864,
    payable_amount: 864,
    originator_reference: "REQ-100",
    status: "active",
    hold_reason: null,
    effective_status: "active",
  },
  lines: [
    {
      line_number: 1,
      quantity: 15,
      unit_code: "EA",
      line_extension_amount: 450,
      item_name: "Pallet handling",
      item_description: null,
      sellers_item_id: "NW-PAL-01",
      standard_item_id: null,
      price_amount: 30,
      base_quantity: 1,
    },
    {
      line_number: 2,
      quantity: 3,
      unit_code: "MON",
      line_extension_amount: 270,
      item_name: "Warehouse storage",
      item_description: "Monthly pallet storage",
      sellers_item_id: "NW-STO-02",
      standard_item_id: null,
      price_amount: 90,
      base_quantity: 1,
    },
  ],
};

/** Maps a path to a canned response; `/api/ui-strings` is always included. */
function stubFetch(routes: Record<string, { ok?: boolean; body: unknown }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url).split("?")[0];
      if (path === "/api/ui-strings") return { ok: true, json: async () => STRINGS } as Response;
      if (path in routes) {
        const { ok = true, body } = routes[path];
        return { ok, json: async () => body } as Response;
      }
      throw new Error(`no stub for ${path}`);
    })
  );
}

async function openScreen() {
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { open } = await import("/purchase-orders.js");
  await open();
}

/** A file picker cannot be filled by a test, so the file is supplied — mirrors suppliers.test.ts. */
function chooseFile(text: string) {
  const picker = document.querySelector("#purchaseorderfile") as HTMLInputElement;
  Object.defineProperty(picker, "files", {
    value: [{ text: async () => text }],
    configurable: true,
  });
}

beforeEach(() => {
  mountShell();
  vi.unstubAllGlobals();
  // No chosen org bleeding in from a previous test — decision 0374's
  // own load() reads this directly via currentOrgId().
  localStorage.removeItem("vf-current-org");
});

/**
 * A stub that outlives its file — decision 0227, applied to every file
 * rather than only the one that had the symptom. `vi.stubGlobal` is
 * not undone between files, so whichever ran next inherited this
 * one's `fetch`.
 */
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the screen opens at all", () => {
  it("renders into the shell", async () => {
    stubFetch({ "/api/purchase-orders": { body: EMPTY_LIST } });
    await openScreen();

    expect(document.getElementById("shell")?.textContent).toContain("Purchase Orders");
  });

  it("says what loading is for, not just that it exists", async () => {
    stubFetch({ "/api/purchase-orders": { body: EMPTY_LIST } });
    await openScreen();

    expect(document.body.textContent).toContain("matched against them");
  });

  it("shows the load control", async () => {
    stubFetch({ "/api/purchase-orders": { body: EMPTY_LIST } });
    await openScreen();

    expect(document.querySelector("#purchaseorderfile")).not.toBeNull();
    const buttons = [...document.querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons).toContain("Load CSV");
  });

  it("puts Load top right of the card, beside its own heading — the same pattern decision 0300 already set", async () => {
    stubFetch({ "/api/purchase-orders": { body: EMPTY_LIST } });
    await openScreen();

    const cardhead = [...document.querySelectorAll(".cardhead")].find(
      (c) => c.querySelector("h3")?.textContent === "Load purchase orders"
    );
    expect(cardhead).not.toBeUndefined();
    expect(cardhead?.querySelector(".statebuttons")).not.toBeNull();
  });

  it("reports when the list itself could not be loaded, rather than showing an empty table silently", async () => {
    stubFetch({ "/api/purchase-orders": { ok: false, body: { error: "nope" } } });
    await openScreen();

    expect(document.body.textContent).toContain("could not be loaded");
  });
});

describe("the list — decision 0372", () => {
  it("says nothing has been loaded yet, when nothing has", async () => {
    stubFetch({ "/api/purchase-orders": { body: EMPTY_LIST } });
    await openScreen();

    expect(document.body.textContent).toContain("No purchase orders have been loaded yet");
  });

  it("lists a loaded order with its own summary fields", async () => {
    stubFetch({ "/api/purchase-orders": { body: ONE_ORDER } });
    await openScreen();

    expect(document.body.textContent).toContain("PO-500");
    expect(document.body.textContent).toContain("GB447711223");
    expect(document.body.textContent).toContain("GB907856452");
    expect(document.body.textContent).toContain("864");
    // The line count, not the lines themselves — decision 0372's own
    // "a list row is a summary" reasoning.
    expect(document.body.textContent).toContain("2");
  });

  it("marks a row as clickable", async () => {
    stubFetch({ "/api/purchase-orders": { body: ONE_ORDER } });
    await openScreen();

    const row = document.querySelector("tbody tr");
    expect(row?.className).toContain("clickable");
  });

  it("shows the resolved legal entity's own name, not just the raw buyer VAT — decision 0374", async () => {
    stubFetch({ "/api/purchase-orders": { body: ONE_ORDER } });
    await openScreen();

    expect(document.body.textContent).toContain("Acme UK");
  });
});

describe("the chosen org narrows the list — decision 0374", () => {
  it("appends the chosen org as a query param when one is chosen", async () => {
    localStorage.setItem("vf-current-org", "acme-uk");
    let requestedUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = String(url).split("?")[0];
        if (path === "/api/ui-strings") return { ok: true, json: async () => STRINGS } as Response;
        if (path === "/api/purchase-orders") {
          requestedUrl = String(url);
          return { ok: true, json: async () => EMPTY_LIST } as Response;
        }
        throw new Error(`no stub for ${path}`);
      })
    );
    await openScreen();

    expect(requestedUrl).toBe("/api/purchase-orders?org=acme-uk&page=1&pageSize=50");
  });

  it("asks for every org's own orders when none is chosen", async () => {
    let requestedUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = String(url).split("?")[0];
        if (path === "/api/ui-strings") return { ok: true, json: async () => STRINGS } as Response;
        if (path === "/api/purchase-orders") {
          requestedUrl = String(url);
          return { ok: true, json: async () => EMPTY_LIST } as Response;
        }
        throw new Error(`no stub for ${path}`);
      })
    );
    await openScreen();

    expect(requestedUrl).toBe("/api/purchase-orders?page=1&pageSize=50");
  });
});

describe("the detail pop-out — 'all PO and PO Line information'", () => {
  it("opens on a row click and shows every header field", async () => {
    stubFetch({
      "/api/purchase-orders": { body: ONE_ORDER },
      "/api/purchase-orders/PO-500": { body: PO_500_DETAIL },
    });
    await openScreen();

    (document.querySelector("tbody tr") as HTMLElement)?.click();
    await new Promise((r) => setTimeout(r, 0));

    const popout = document.querySelector(".popout");
    expect(popout).not.toBeNull();
    expect(popout?.textContent).toContain("PO-500");
    expect(popout?.textContent).toContain("220"); // order type code
    expect(popout?.textContent).toContain("EUR");
    expect(popout?.textContent).toContain("REQ-100"); // originator reference
    expect(popout?.textContent).toContain("864"); // payable amount
    expect(popout?.textContent).toContain("Acme UK"); // resolved legal entity
  });

  it("shows every line, with every field a line carries", async () => {
    stubFetch({
      "/api/purchase-orders": { body: ONE_ORDER },
      "/api/purchase-orders/PO-500": { body: PO_500_DETAIL },
    });
    await openScreen();

    (document.querySelector("tbody tr") as HTMLElement)?.click();
    await new Promise((r) => setTimeout(r, 0));

    const popout = document.querySelector(".popout") as HTMLElement;
    expect(popout.textContent).toContain("Pallet handling");
    expect(popout.textContent).toContain("NW-PAL-01");
    expect(popout.textContent).toContain("Warehouse storage");
    expect(popout.textContent).toContain("Monthly pallet storage");
    expect(popout.textContent).toContain("NW-STO-02");
    // Both lines' own quantities and units, not just the first.
    expect(popout.textContent).toContain("15");
    expect(popout.textContent).toContain("MON");
  });

  it("is the wide variant, since the line table needs more room than the default popout width", async () => {
    stubFetch({
      "/api/purchase-orders": { body: ONE_ORDER },
      "/api/purchase-orders/PO-500": { body: PO_500_DETAIL },
    });
    await openScreen();

    (document.querySelector("tbody tr") as HTMLElement)?.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelector(".popout")?.className).toContain("wide");
  });

  it("closes on the Close button", async () => {
    stubFetch({
      "/api/purchase-orders": { body: ONE_ORDER },
      "/api/purchase-orders/PO-500": { body: PO_500_DETAIL },
    });
    await openScreen();

    (document.querySelector("tbody tr") as HTMLElement)?.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector(".popout")).not.toBeNull();

    const close = [...document.querySelectorAll(".popout button")].find((b) => b.textContent === "Close");
    close?.dispatchEvent(new MouseEvent("click"));

    expect(document.querySelector(".backdrop")).toBeNull();
  });

  it("closes on a click outside the box, not on a click inside it", async () => {
    stubFetch({
      "/api/purchase-orders": { body: ONE_ORDER },
      "/api/purchase-orders/PO-500": { body: PO_500_DETAIL },
    });
    await openScreen();

    (document.querySelector("tbody tr") as HTMLElement)?.click();
    await new Promise((r) => setTimeout(r, 0));

    const backdrop = document.querySelector(".backdrop") as HTMLElement;
    const popout = document.querySelector(".popout") as HTMLElement;
    popout.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector(".backdrop")).not.toBeNull();

    backdrop.dispatchEvent(new MouseEvent("click"));
    expect(document.querySelector(".backdrop")).toBeNull();
  });

  it("reports a failed detail fetch rather than an empty or stuck pop-out", async () => {
    stubFetch({
      "/api/purchase-orders": { body: ONE_ORDER },
      "/api/purchase-orders/PO-500": { ok: false, body: { error: "nope" } },
    });
    await openScreen();

    (document.querySelector("tbody tr") as HTMLElement)?.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.body.textContent).toContain("This purchase order could not be loaded");
  });
});

describe("loading a file (decision 0216's one-try-per-thing discipline)", () => {
  it("refuses to load with no file chosen", async () => {
    stubFetch({ "/api/purchase-orders": { body: EMPTY_LIST } });
    await openScreen();

    const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "Load CSV");
    button?.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.body.textContent).toContain("Choose a file first");
  });

  it("shows what a load did — orders and lines both", async () => {
    stubFetch({
      "/api/purchase-orders": { body: EMPTY_LIST },
      "/api/purchase-orders/csv-load": { body: { loadId: "l1", ordersLoaded: 3, ordersReplaced: 0, linesLoaded: 7, refused: [] } },
    });
    await openScreen();
    chooseFile("order_number,line number,item\nPO-1,1,Widgets");

    const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "Load CSV");
    button?.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.body.textContent).toContain("3 purchase orders loaded");
    expect(document.body.textContent).toContain("7 order lines loaded");
  });

  it("mentions replaced orders only when there were any", async () => {
    stubFetch({
      "/api/purchase-orders": { body: EMPTY_LIST },
      "/api/purchase-orders/csv-load": { body: { loadId: "l1", ordersLoaded: 2, ordersReplaced: 2, linesLoaded: 4, refused: [] } },
    });
    await openScreen();
    chooseFile("order_number,line number\nPO-1,1");

    const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "Load CSV");
    button?.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.body.textContent).toContain("2 of those replaced");
  });

  it("shows a refused order with its own reason, not a generic failure", async () => {
    stubFetch({
      "/api/purchase-orders": { body: EMPTY_LIST },
      "/api/purchase-orders/csv-load": {
        body: {
          loadId: "l1",
          ordersLoaded: 1,
          ordersReplaced: 0,
          linesLoaded: 2,
          refused: [{ orderNumber: "PO-9", reason: "line numbers must be unique within one order" }],
        },
      },
    });
    await openScreen();
    chooseFile("order_number,line number\nPO-1,1");

    const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "Load CSV");
    button?.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.body.textContent).toContain("Order PO-9");
    expect(document.body.textContent).toContain("line numbers must be unique");
  });

  it("does not blame the network for a refusal — the route's own words, not a generic message", async () => {
    stubFetch({
      "/api/purchase-orders": { body: EMPTY_LIST },
      "/api/purchase-orders/csv-load": { ok: false, body: { error: "the file needs an order number column" } },
    });
    await openScreen();
    chooseFile("line number\n1");

    const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "Load CSV");
    button?.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.body.textContent).toContain("needs an order number column");
    expect(document.body.textContent).not.toContain("could not reach the service");
  });

  it("names the network layer when the request genuinely never reached the service", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = String(url).split("?")[0];
        if (path === "/api/ui-strings") return { ok: true, json: async () => STRINGS } as Response;
        if (path === "/api/purchase-orders") return { ok: true, json: async () => EMPTY_LIST } as Response;
        if (path === "/api/purchase-orders/csv-load") throw new Error("network down");
        throw new Error(`no stub for ${path}`);
      })
    );
    await openScreen();
    chooseFile("order_number,line number\nPO-1,1");

    const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "Load CSV");
    button?.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.body.textContent).toContain("could not reach the service");
  });

  it("refreshes the list after a successful load, rather than leaving the table showing what it showed before", async () => {
    let listCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = String(url).split("?")[0];
        if (path === "/api/ui-strings") return { ok: true, json: async () => STRINGS } as Response;
        if (path === "/api/purchase-orders") {
          listCalls++;
          return { ok: true, json: async () => (listCalls > 1 ? ONE_ORDER : EMPTY_LIST) } as Response;
        }
        if (path === "/api/purchase-orders/csv-load") {
          return {
            ok: true,
            json: async () => ({ loadId: "l1", ordersLoaded: 1, ordersReplaced: 0, linesLoaded: 2, refused: [] }),
          } as Response;
        }
        throw new Error(`no stub for ${path}`);
      })
    );
    await openScreen();
    expect(document.body.textContent).toContain("No purchase orders have been loaded yet");

    chooseFile("order_number,line number\nPO-500,1");
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "Load CSV");
    button?.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.body.textContent).toContain("PO-500");
    expect(document.body.textContent).not.toContain("No purchase orders have been loaded yet");
  });
});

describe("the CSV format reference — decision 0373", () => {
  it("does not appear at all when the format could not be fetched", async () => {
    // No /api/purchase-orders/csv-format stub registered — the
    // existing 21 tests above already prove this degrades gracefully;
    // this test names the behaviour directly.
    stubFetch({ "/api/purchase-orders": { body: EMPTY_LIST } });
    await openScreen();

    expect(document.querySelector(".poformat")).toBeNull();
  });

  it("shows the disclosure, collapsed, with every field's own accepted columns inside it", async () => {
    stubFetch({
      "/api/purchase-orders": { body: EMPTY_LIST },
      "/api/purchase-orders/csv-format": { body: SAMPLE_FORMAT },
    });
    await openScreen();

    const details = document.querySelector(".poformat") as HTMLDetailsElement;
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
    expect(details.textContent).toContain("order_number");
    expect(details.textContent).toContain("po_number");
    expect(details.textContent).toContain("line_number");
    expect(details.textContent).toContain("quantity");
  });

  it("marks required fields as required, and leaves optional ones blank rather than saying 'Optional' redundantly", async () => {
    stubFetch({
      "/api/purchase-orders": { body: EMPTY_LIST },
      "/api/purchase-orders/csv-format": { body: SAMPLE_FORMAT },
    });
    await openScreen();

    const rows = [...document.querySelectorAll(".poformat tbody tr")];
    const orderNumberRow = rows.find((r) => r.textContent?.includes("order_number"));
    const issueDateRow = rows.find((r) => r.textContent?.includes("issue_date"));
    expect(orderNumberRow?.textContent).toContain("Required");
    expect(issueDateRow?.textContent).not.toContain("Required");
  });
});

describe("downloading a template — decision 0373", () => {
  it("builds a CSV from every field's own recommended column, header and line together", async () => {
    stubFetch({
      "/api/purchase-orders": { body: EMPTY_LIST },
      "/api/purchase-orders/csv-format": { body: SAMPLE_FORMAT },
    });
    await openScreen();

    let capturedBlob: Blob | undefined;
    const createSpy = vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      capturedBlob = blob as Blob;
      return "blob:mock";
    });
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const downloadButton = [...document.querySelectorAll("button")].find((b) => b.textContent === "CSV Template");
    downloadButton?.click();

    expect(createSpy).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(revokeSpy).toHaveBeenCalledWith("blob:mock");

    const text = await capturedBlob?.text();
    // The first-listed (recommended) column of every field, header
    // fields before line fields — not just any accepted alias.
    expect(text).toBe("order_number,issue_date,line_number,quantity\n");

    createSpy.mockRestore();
    revokeSpy.mockRestore();
    clickSpy.mockRestore();
  });

  it("is disabled when the format itself could not be fetched, rather than downloading an empty or broken file", async () => {
    stubFetch({ "/api/purchase-orders": { body: EMPTY_LIST } });
    await openScreen();

    const downloadButton = [...document.querySelectorAll("button")].find((b) => b.textContent === "CSV Template");
    expect(downloadButton?.disabled).toBe(true);
  });

  it("is enabled once the format has loaded", async () => {
    stubFetch({
      "/api/purchase-orders": { body: EMPTY_LIST },
      "/api/purchase-orders/csv-format": { body: SAMPLE_FORMAT },
    });
    await openScreen();

    const downloadButton = [...document.querySelectorAll("button")].find((b) => b.textContent === "CSV Template");
    expect(downloadButton?.disabled).toBe(false);
  });
});

/** A page of `count` orders out of `total`, for pagination-display tests — decision 0376. */
function pageOf(count, total, page, pageSize) {
  return {
    purchaseOrders: Array.from({ length: count }, (_, i) => ({
      id: `po-${i}`,
      order_number: `PO-${i}`,
      line_count: 1,
    })),
    total,
    page,
    pageSize,
  };
}

describe("searching the list — decision 0376", () => {
  it("shows the search box with its own placeholder", async () => {
    stubFetch({ "/api/purchase-orders": { body: EMPTY_LIST } });
    await openScreen();

    const search = document.getElementById("posearch");
    expect(search?.getAttribute("placeholder")).toBe("Search order number, seller, item...");
  });

  it("re-fetches with the search term once typing is done, and resets to page 1", async () => {
    let requestedUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        const path = String(url).split("?")[0];
        if (path === "/api/ui-strings") return { ok: true, json: async () => STRINGS };
        if (path === "/api/purchase-orders") {
          requestedUrl = String(url);
          return { ok: true, json: async () => pageOf(1, 1, 1, 50) };
        }
        throw new Error(`no stub for ${path}`);
      })
    );
    await openScreen();

    const search = document.getElementById("posearch");
    search.value = "widgets";
    search.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));

    expect(requestedUrl).toContain("search=widgets");
    expect(requestedUrl).toContain("page=1");
  });

  it("keeps focus on the search box after a search reloads the screen", async () => {
    stubFetch({ "/api/purchase-orders": { body: EMPTY_LIST } });
    await openScreen();

    const search = document.getElementById("posearch");
    search.value = "widgets";
    search.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));

    expect(document.activeElement?.id).toBe("posearch");
  });

  it("shows a message distinct from 'nothing loaded yet' when a search matches nothing", async () => {
    stubFetch({ "/api/purchase-orders": { body: { purchaseOrders: [], total: 0, page: 1, pageSize: 50 } } });
    await openScreen();

    const search = document.getElementById("posearch");
    search.value = "no such thing";
    search.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));

    expect(document.body.textContent).toContain("No purchase orders match your search.");
    expect(document.body.textContent).not.toContain("No purchase orders have been loaded yet");
  });
});

describe("pagination controls — decision 0376", () => {
  it("shows every page size actually offered", async () => {
    stubFetch({ "/api/purchase-orders": { body: EMPTY_LIST } });
    await openScreen();

    const options = [...document.querySelectorAll("#porowsize option")].map((o) => o.value);
    expect(options).toEqual(["25", "50", "100", "200"]);
  });

  it("changing the page size re-fetches with the new size and resets to page 1", async () => {
    let requestedUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        const path = String(url).split("?")[0];
        if (path === "/api/ui-strings") return { ok: true, json: async () => STRINGS };
        if (path === "/api/purchase-orders") {
          requestedUrl = String(url);
          return { ok: true, json: async () => pageOf(25, 120, 1, 25) };
        }
        throw new Error(`no stub for ${path}`);
      })
    );
    await openScreen();

    const sizePicker = document.getElementById("porowsize");
    sizePicker.value = "25";
    sizePicker.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));

    expect(requestedUrl).toContain("pageSize=25");
    expect(requestedUrl).toContain("page=1");
  });

  it("disables first and previous on the first page", async () => {
    stubFetch({ "/api/purchase-orders": { body: pageOf(50, 120, 1, 50) } });
    await openScreen();

    expect(document.querySelector('[aria-label="First page"]')?.disabled).toBe(true);
    expect(document.querySelector('[aria-label="Previous page"]')?.disabled).toBe(true);
    expect(document.querySelector('[aria-label="Next page"]')?.disabled).toBe(false);
    expect(document.querySelector('[aria-label="Last page"]')?.disabled).toBe(false);
  });

  it("disables next and last on the last page", async () => {
    stubFetch({ "/api/purchase-orders": { body: pageOf(20, 120, 3, 50) } });
    await openScreen();

    expect(document.querySelector('[aria-label="Next page"]')?.disabled).toBe(true);
    expect(document.querySelector('[aria-label="Last page"]')?.disabled).toBe(true);
    expect(document.querySelector('[aria-label="First page"]')?.disabled).toBe(false);
    expect(document.querySelector('[aria-label="Previous page"]')?.disabled).toBe(false);
  });

  it("enables every button in the middle of a multi-page result", async () => {
    stubFetch({ "/api/purchase-orders": { body: pageOf(50, 120, 2, 50) } });
    await openScreen();

    for (const label of ["First page", "Previous page", "Next page", "Last page"]) {
      expect(document.querySelector(`[aria-label="${label}"]`)?.disabled).toBe(false);
    }
  });

  it("shows the range as text", async () => {
    stubFetch({ "/api/purchase-orders": { body: pageOf(50, 120, 2, 50) } });
    await openScreen();

    expect(document.body.textContent).toContain("51–100 of 120");
  });

  it("clicking next advances the page while keeping the same search term", async () => {
    let requestedUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        const path = String(url).split("?")[0];
        if (path === "/api/ui-strings") return { ok: true, json: async () => STRINGS };
        if (path === "/api/purchase-orders") {
          requestedUrl = String(url);
          return { ok: true, json: async () => pageOf(50, 120, 1, 50) };
        }
        throw new Error(`no stub for ${path}`);
      })
    );
    await openScreen();

    const search = document.getElementById("posearch");
    search.value = "widgets";
    search.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));

    document.querySelector('[aria-label="Next page"]')?.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(requestedUrl).toContain("page=2");
    expect(requestedUrl).toContain("search=widgets");
  });
});

const STATUS_COUNTS = {
  counts: { active: 3, on_hold: 1, closed: 1, invoiced_part: 2, invoiced_full: 1 },
};

describe("the status chart — decision 0377", () => {
  it("shows a segment for every real, non-zero bucket", async () => {
    stubFetch({
      "/api/purchase-orders": { body: EMPTY_LIST },
      "/api/purchase-orders/status-counts": { body: STATUS_COUNTS },
    });
    await openScreen();

    expect(document.body.textContent).toContain("Active");
    expect(document.body.textContent).toContain("On Hold");
    expect(document.body.textContent).toContain("Closed");
    expect(document.body.textContent).toContain("Invoiced (Part)");
    expect(document.body.textContent).toContain("Invoiced (Full)");
  });

  it("shows a message rather than an empty ring when there is no status data yet", async () => {
    stubFetch({ "/api/purchase-orders": { body: EMPTY_LIST } });
    await openScreen();

    expect(document.body.textContent).toContain("No status data to show yet.");
  });

  it("clicking a segment filters the paginated list by that status", async () => {
    let requestedUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        const path = String(url).split("?")[0];
        if (path === "/api/ui-strings") return { ok: true, json: async () => STRINGS };
        if (path === "/api/purchase-orders/status-counts") return { ok: true, json: async () => STATUS_COUNTS };
        if (path === "/api/purchase-orders") {
          requestedUrl = String(url);
          return { ok: true, json: async () => EMPTY_LIST };
        }
        throw new Error(`no stub for ${path}`);
      })
    );
    await openScreen();

    const onHoldRow = [...document.querySelectorAll(".donutkey")].find((row) => row.textContent?.includes("On Hold"));
    onHoldRow?.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(requestedUrl).toContain("status=on_hold");
    expect(requestedUrl).toContain("page=1");
  });
});

describe("Hold, Release Hold, Close on the detail pop-out — decision 0377", () => {
  it("shows Hold and Close Order for an active order", async () => {
    stubFetch({
      "/api/purchase-orders": { body: ONE_ORDER },
      "/api/purchase-orders/PO-500": { body: PO_500_DETAIL },
    });
    await openScreen();
    document.querySelector("tbody tr")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(document.body.textContent).toContain("Hold");
    expect(document.body.textContent).toContain("Close Order");
    expect(document.body.textContent).not.toContain("Release hold");
  });

  it("shows Release Hold, and the hold reason, for an order on hold", async () => {
    const onHoldDetail = {
      order: { ...PO_500_DETAIL.order, status: "on_hold", hold_reason: "supplier dispute", effective_status: "on_hold" },
      lines: PO_500_DETAIL.lines,
    };
    stubFetch({
      "/api/purchase-orders": { body: ONE_ORDER },
      "/api/purchase-orders/PO-500": { body: onHoldDetail },
    });
    await openScreen();
    document.querySelector("tbody tr")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(document.body.textContent).toContain("Release hold");
    expect(document.body.textContent).toContain("supplier dispute");
    expect(document.body.textContent).not.toContain(">Hold<");
  });

  it("shows no lifecycle action at all for a closed order — terminal", async () => {
    const closedDetail = {
      order: { ...PO_500_DETAIL.order, status: "closed", effective_status: "closed" },
      lines: PO_500_DETAIL.lines,
    };
    stubFetch({
      "/api/purchase-orders": { body: ONE_ORDER },
      "/api/purchase-orders/PO-500": { body: closedDetail },
    });
    await openScreen();
    document.querySelector("tbody tr")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(document.body.textContent).not.toContain("Release hold");
    expect(document.body.textContent).not.toContain("Close Order");
  });

  it("placing a hold sends the real reason typed into the prompt", async () => {
    let patchBody = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        const path = String(url).split("?")[0];
        if (path === "/api/ui-strings") return { ok: true, json: async () => STRINGS };
        if (path === "/api/purchase-orders/status-counts") return { ok: true, json: async () => STATUS_COUNTS };
        if (path === "/api/purchase-orders/PO-500" && init?.method === "PATCH") {
          patchBody = JSON.parse(init.body);
          return { ok: true, json: async () => ({}) };
        }
        if (path === "/api/purchase-orders/PO-500") return { ok: true, json: async () => PO_500_DETAIL };
        if (path === "/api/purchase-orders") return { ok: true, json: async () => ONE_ORDER };
        throw new Error(`no stub for ${path}`);
      })
    );
    await openScreen();
    document.querySelector("tbody tr")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    const holdButton = [...document.querySelectorAll("button")].find((b) => b.textContent === "Hold");
    holdButton?.click();
    await new Promise((r) => setTimeout(r, 0));

    const reasonInput = document.querySelector('input[placeholder="Reason for the hold"]');
    reasonInput.value = "supplier dispute";
    const confirmButton = [...document.querySelectorAll("button")].find((b) => b.textContent === "Confirm hold");
    confirmButton?.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(patchBody).toEqual({ status: "on_hold", holdReason: "supplier dispute" });
  });

  it("closing asks for confirmation before sending the request", async () => {
    let patchSent = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        const path = String(url).split("?")[0];
        if (path === "/api/ui-strings") return { ok: true, json: async () => STRINGS };
        if (path === "/api/purchase-orders/status-counts") return { ok: true, json: async () => STATUS_COUNTS };
        if (path === "/api/purchase-orders/PO-500" && init?.method === "PATCH") {
          patchSent = true;
          return { ok: true, json: async () => ({}) };
        }
        if (path === "/api/purchase-orders/PO-500") return { ok: true, json: async () => PO_500_DETAIL };
        if (path === "/api/purchase-orders") return { ok: true, json: async () => ONE_ORDER };
        throw new Error(`no stub for ${path}`);
      })
    );
    vi.stubGlobal("confirm", vi.fn(() => false));
    await openScreen();
    document.querySelector("tbody tr")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    const closeOrderButton = [...document.querySelectorAll("button")].find((b) => b.textContent === "Close Order");
    closeOrderButton?.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(patchSent).toBe(false);
  });
});
