import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The supplier screen — decision 0213, and the bug that followed it.
 *
 * **The first version rendered into `#main`**, which does not exist,
 * and imported `el` and `setCurrentScreen` from `strings.js`, which
 * does not export them. So the module threw, the menu item went
 * nowhere, and **every test passed** — because nothing tested that the
 * screen opened.
 *
 * Decision 0191's finding, again.
 */

function mountShell() {
  document.body.innerHTML = `<main id="shell"></main><main id="viewer" hidden></main>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "suppliers.heading": "Suppliers",
    "suppliers.mirror": "Loaded from your ERP.",
    "suppliers.none": "No suppliers have been loaded yet.",
    "suppliers.neverloaded": "No supplier file has ever been loaded.",
    "suppliers.loadedago": "Loaded {days} days ago.",
    "suppliers.loadheading": "Load a supplier file",
    "suppliers.loadhelp": "A CSV exported from your ERP.",
    "suppliers.loadbutton": "Load",
    "suppliers.erpid": "Supplier number",
    "suppliers.name": "Name",
    "suppliers.vat": "VAT number",
    "suppliers.country": "Country",
    "suppliers.terms": "Terms",
    "suppliers.hold": "Hold",
    "suppliers.status": "Status",
    "nav.tasks": "Tasks",
    "nav.sources": "Sources",
    "nav.suppliers": "Suppliers",
    "nav.rules": "Rules",
    "nav.documents": "Documents",
  },
};

function stubFetch(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url).split("?")[0];
      if (path === "/api/ui-strings") return { ok: true, json: async () => STRINGS } as Response;
      if (path === "/api/suppliers") return { ok: true, json: async () => body } as Response;
      throw new Error(`no stub for ${path}`);
    })
  );
}

beforeEach(() => {
  mountShell();
  vi.unstubAllGlobals();
});

describe("the screen opens at all", () => {
  /**
   * **The test that was missing.** Rendering correctly proves nothing
   * if the module cannot be imported or writes to an element that is
   * not there.
   */
  it("renders into the shell", async () => {
    stubFetch({ suppliers: [], lastLoad: null });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();

    const { open } = await import("/suppliers.js");
    await open();

    expect(document.getElementById("shell")?.textContent).toContain("Suppliers");
  });

  it("says a supplier file has never been loaded", async () => {
    // **Never loaded is a different sentence from stale** — decision
    // 0208 — because one is fixed by asking for a file and the other by
    // asking for a newer one.
    stubFetch({ suppliers: [], lastLoad: null });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();

    const { open } = await import("/suppliers.js");
    await open();

    expect(document.body.textContent).toContain("has ever been loaded");
  });

  it("offers no way to add a supplier", async () => {
    /**
     * **Because we are the mirror** (decision 0208). Changing it here
     * would make this the master and the ERP wrong.
     */
    stubFetch({
      suppliers: [
        {
          erpIdentifier: "40118",
          name: "Northwind",
          vatId: "GB1",
          country: "GB",
          paymentTerms: "Net 30",
          onHold: false,
          holdReason: null,
          status: "active",
        },
      ],
      lastLoad: { loadedAt: "2026-09-01 09:00:00", loadedBy: "alice", rowCount: 1, refusedCount: 0 },
    });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();

    const { open } = await import("/suppliers.js");
    await open();

    const buttons = [...document.querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons).toEqual(["Load"]);
    expect(document.body.textContent).toContain("Northwind");
  });
});
