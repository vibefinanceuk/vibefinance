import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The purchase order load screen — decision 0371, and the class of bug
 * decision 0191 already named once for Suppliers: a screen that
 * renders correctly proves nothing if the module cannot be imported,
 * writes to an element that is not there, or was never added to the
 * navigation the person actually clicks.
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
    "action.load": "Load",
  },
};

function stubFetch(loadResponse: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url).split("?")[0];
      if (path === "/api/ui-strings") return { ok: true, json: async () => STRINGS } as Response;
      if (path === "/api/purchase-orders/csv-load") {
        return { ok, json: async () => loadResponse } as Response;
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
    stubFetch({ loadId: "l1", ordersLoaded: 0, ordersReplaced: 0, linesLoaded: 0, refused: [] });
    await openScreen();

    expect(document.getElementById("shell")?.textContent).toContain("Purchase Orders");
  });

  it("says what loading is for, not just that it exists", async () => {
    stubFetch({ loadId: "l1", ordersLoaded: 0, ordersReplaced: 0, linesLoaded: 0, refused: [] });
    await openScreen();

    expect(document.body.textContent).toContain("matched against them");
  });

  it("shows the load control without ever calling a list endpoint", async () => {
    // No GET /api/purchase-orders stub is registered at all — a call
    // to one would throw inside stubFetch and fail the test, which is
    // the proof this screen never asks for a list that does not exist.
    stubFetch({ loadId: "l1", ordersLoaded: 0, ordersReplaced: 0, linesLoaded: 0, refused: [] });
    await openScreen();

    expect(document.querySelector("#purchaseorderfile")).not.toBeNull();
    const buttons = [...document.querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons).toContain("Load");
  });

  it("puts Load top right of the card, beside its own heading — the same pattern decision 0300 already set", async () => {
    stubFetch({ loadId: "l1", ordersLoaded: 0, ordersReplaced: 0, linesLoaded: 0, refused: [] });
    await openScreen();

    const cardhead = [...document.querySelectorAll(".cardhead")].find(
      (c) => c.querySelector("h3")?.textContent === "Load purchase orders"
    );
    expect(cardhead).not.toBeUndefined();
    expect(cardhead?.querySelector(".statebuttons")).not.toBeNull();
  });
});

describe("loading a file (decision 0216's one-try-per-thing discipline)", () => {
  it("refuses to load with no file chosen", async () => {
    stubFetch({ loadId: "l1", ordersLoaded: 0, ordersReplaced: 0, linesLoaded: 0, refused: [] });
    await openScreen();

    const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "Load");
    button?.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.body.textContent).toContain("Choose a file first");
  });

  it("shows what a load did — orders and lines both", async () => {
    stubFetch({ loadId: "l1", ordersLoaded: 3, ordersReplaced: 0, linesLoaded: 7, refused: [] });
    await openScreen();
    chooseFile("order_number,line number,item\nPO-1,1,Widgets");

    const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "Load");
    button?.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.body.textContent).toContain("3 purchase orders loaded");
    expect(document.body.textContent).toContain("7 order lines loaded");
  });

  it("mentions replaced orders only when there were any", async () => {
    stubFetch({ loadId: "l1", ordersLoaded: 2, ordersReplaced: 2, linesLoaded: 4, refused: [] });
    await openScreen();
    chooseFile("order_number,line number\nPO-1,1");

    const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "Load");
    button?.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.body.textContent).toContain("2 of those replaced");
  });

  it("shows a refused order with its own reason, not a generic failure", async () => {
    stubFetch({
      loadId: "l1",
      ordersLoaded: 1,
      ordersReplaced: 0,
      linesLoaded: 2,
      refused: [{ orderNumber: "PO-9", reason: "line numbers must be unique within one order" }],
    });
    await openScreen();
    chooseFile("order_number,line number\nPO-1,1");

    const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "Load");
    button?.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.body.textContent).toContain("Order PO-9");
    expect(document.body.textContent).toContain("line numbers must be unique");
  });

  it("does not blame the network for a refusal — the route's own words, not a generic message", async () => {
    stubFetch({ error: "the file needs an order number column" }, false);
    await openScreen();
    chooseFile("line number\n1");

    const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "Load");
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
        if (path === "/api/purchase-orders/csv-load") throw new Error("network down");
        throw new Error(`no stub for ${path}`);
      })
    );
    await openScreen();
    chooseFile("order_number,line number\nPO-1,1");

    const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "Load");
    button?.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.body.textContent).toContain("could not reach the service");
  });
});
