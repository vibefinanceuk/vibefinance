import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    "action.newsupplier": "New supplier",
    "action.load": "Load",
    "nav.tasks": "Tasks",
    "nav.sources": "Sources",
    "nav.dashboard": "Dashboard",
    "nav.suppliers": "Suppliers",
    "nav.rules": "Rules",
    "nav.documents": "Documents",
    "suppliers.loaded": "{n} suppliers loaded.",
    "suppliers.rematched": "{n} invoices which had no supplier now have one.",
    "suppliers.loadfailed": "We could not reach the service to load that file.",
    "suppliers.loadbroke": "The file was loaded, but this screen could not show the result:",
    "suppliers.nofile": "Choose a file first.",
    "suppliers.loading": "Loading...",
    "suppliers.statusheading": "Supplier status",
    "suppliers.status.active": "Active",
    "suppliers.status.inactive": "Inactive",
    "suppliers.status.onhold": "On hold",
    "suppliers.status.awaitingerp": "Awaiting ERP",
    "suppliers.allsuppliers": "All suppliers",
    "suppliers.showing.active": "Showing active suppliers only",
    "suppliers.showing.inactive": "Showing inactive suppliers only",
    "suppliers.showing.onhold": "Showing suppliers on hold only",
    "suppliers.showing.awaitingerp": "Showing suppliers awaiting the ERP only",
    "suppliers.nonefiltered": "No suppliers match this filter.",
    "documents.clearfilter": "Clear filter",
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

/**
 * **A stub that outlives its file** — decision 0227, applied to every
 * file rather than the one that had the symptom.
 *
 * `vi.stubGlobal` is not undone between files, so whichever ran next
 * inherited this one's `fetch` — and failed **depending on the order
 * the two were scheduled in**.
 */
afterEach(() => {
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

  it("offers to record one the ERP does not have", async () => {
    /**
     * **Inverted by decision 0231.** This asserted there was no way to
     * add a supplier, because we are the mirror.
     *
     * **Still true of a supplier the ERP has** — that one is changed
     * there. What can be recorded here is one it **does not**, which
     * the operator described as the precursor to a new-supplier
     * process: an invoice turns up, somebody writes down who sent it,
     * and a team creates the ERP record from those details.
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
    expect(buttons).toContain("New supplier");
    expect(buttons).toContain("Load");
    expect(document.body.textContent).toContain("Northwind");
  });
});

describe("loading a file (decision 0216)", () => {
  /**
   * **The first version wrapped the request, the parse and the redraw
   * in one `try`**, so a bug in the redraw reported *"we could not
   * reach the service"* — decision 0190's finding, where a 500 was
   * reported as *"sign-in failed"* and blamed the person for something
   * they could not see.
   *
   * **A message that names the wrong layer sends somebody to check
   * their network when their screen is broken.**
   */
  function stubLoad(loadResponse: unknown, ok = true) {
    let listCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = String(url).split("?")[0];
        if (path === "/api/ui-strings") return { ok: true, json: async () => STRINGS } as Response;
        if (path === "/api/suppliers/load") {
          return { ok, json: async () => loadResponse } as Response;
        }
        if (path === "/api/suppliers") {
          listCalls++;
          return {
            ok: true,
            json: async () => ({
              suppliers: [],
              lastLoad:
                listCalls > 1
                  ? { loadedAt: "2026-09-11 09:00:00", loadedBy: "a", rowCount: 5, refusedCount: 0 }
                  : null,
            }),
          } as Response;
        }
        throw new Error(`no stub for ${path} ${init?.method ?? ""}`);
      })
    );
  }

  async function openScreen() {
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/suppliers.js");
    await open();
  }

  /** A file picker cannot be filled by a test, so the file is supplied. */
  function chooseFile(text: string) {
    const picker = document.querySelector("#supplierfile") as HTMLInputElement;
    Object.defineProperty(picker, "files", {
      value: [{ text: async () => text }],
      configurable: true,
    });
  }

  it("shows what a load did", async () => {
    stubLoad({ loadId: "l1", loaded: 5, refused: [], deactivated: 0, rematched: 2 });
    await openScreen();
    chooseFile("ERP ID,Name\n40118,Northwind");

    const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "Load");
    button?.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.body.textContent).toContain("5 suppliers loaded");
    expect(document.body.textContent).toContain("2 invoices");
  });

  it("does not blame the network for a refusal", async () => {
    // **The route's own words**, so a person can fix the file.
    stubLoad({ error: "the file needs an ERP identifier column" }, false);
    await openScreen();
    chooseFile("Name\nNorthwind");

    const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "Load");
    button?.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.body.textContent).toContain("needs an ERP identifier column");
    expect(document.body.textContent).not.toContain("could not reach the service");
  });
});

describe("both ways in, side by side (decision 0237)", () => {
  /**
   * **A load brings many; recording brings one.** Different acts, the
   * same question — *how does a supplier get into this list* — so a
   * person looking for either should find both.
   */
  it("puts New supplier beside Load", async () => {
    stubFetch({ suppliers: [], lastLoad: null });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/suppliers.js");
    await open();

    const bar = [...document.querySelectorAll(".statebuttons")].find((b) =>
      b.textContent?.includes("Load")
    );
    expect(bar?.textContent).toContain("New supplier");
  });

  it("leaves both able to be clicked", async () => {
    /**
     * **`actionLink` disables a button with no `onclick`** — decision
     * 0161's rule that an action with nothing to do says so.
     *
     * Assigning `.onclick` after construction leaves it **disabled and
     * looking fine**: the icon, the label and the hover are all there,
     * and nothing happens. Both buttons shipped that way for the length
     * of one test run.
     */
    stubFetch({ suppliers: [], lastLoad: null });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/suppliers.js");
    await open();

    const disabled = [...document.querySelectorAll("button.actionlink")]
      .filter((b) => (b as HTMLButtonElement).disabled)
      .map((b) => b.textContent);

    expect(disabled).toEqual([]);
  });
});

describe("the status card (decision 0299)", () => {
  /**
   * **Six suppliers, two of them chosen to test priority, not just
   * category.** Every field in this system is independent — a
   * supplier can be active, on hold, and missing its own ERP
   * identifier all at the same time — so counting them correctly
   * means proving the priority order, not just that each label works
   * once in isolation.
   */
  const SUPPLIERS = [
    { id: "s1", name: "Acme", erpIdentifier: "E1", status: "active", onHold: false },
    { id: "s2", name: "Beta", erpIdentifier: "E2", status: "inactive", onHold: false },
    { id: "s3", name: "Gamma", erpIdentifier: "E3", status: "active", onHold: true, holdReason: "Dispute" },
    { id: "s4", name: "Delta", erpIdentifier: null, status: "active", onHold: false },
    // Missing its own identifier AND on hold — awaiting ERP wins.
    { id: "s5", name: "Epsilon", erpIdentifier: null, status: "active", onHold: true, holdReason: "x" },
    // Inactive AND on hold — on hold wins over the plain status split.
    { id: "s6", name: "Zeta", erpIdentifier: "E6", status: "inactive", onHold: true, holdReason: "y" },
  ];

  function legendRow(label: string) {
    return [...document.querySelectorAll(".donutkey")].find((row) => row.textContent?.includes(label));
  }

  it("buckets each supplier into exactly one status, even when more than one condition applies", async () => {
    stubFetch({ suppliers: SUPPLIERS, lastLoad: null });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/suppliers.js");
    await open();

    // Active: only s1 — s3 is on hold despite being active, s4/s5 are
    // awaiting ERP despite one of them also being active.
    expect(legendRow("Active")?.textContent).toContain("1");
    expect(legendRow("Inactive")?.textContent).toContain("1");
    // On hold: s3 and s6 — s6 counts here rather than under Inactive.
    expect(legendRow("On hold")?.textContent).toContain("2");
    // Awaiting ERP: s4 and s5 — s5 counts here rather than under On hold.
    expect(legendRow("Awaiting ERP")?.textContent).toContain("2");
  });

  it("filters the list to exactly the suppliers a clicked slice counted", async () => {
    stubFetch({ suppliers: SUPPLIERS, lastLoad: null });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/suppliers.js");
    await open();

    (legendRow("On hold") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));

    const names = [...document.querySelectorAll("tbody tr")].map((row) => row.textContent);
    expect(names.some((t) => t?.includes("Gamma"))).toBe(true);
    expect(names.some((t) => t?.includes("Zeta"))).toBe(true);
    expect(names.some((t) => t?.includes("Acme"))).toBe(false);
    expect(document.body.textContent).toContain("Showing suppliers on hold only");
  });

  it("All suppliers shows the true total and clears the filter", async () => {
    stubFetch({ suppliers: SUPPLIERS, lastLoad: null });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/suppliers.js");
    await open();

    (legendRow("Awaiting ERP") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelectorAll("tbody tr").length).toBe(2);

    const allRow = legendRow("All suppliers");
    expect(allRow?.textContent).toContain(String(SUPPLIERS.length));
    (allRow as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelectorAll("tbody tr").length).toBe(SUPPLIERS.length);
    expect(document.body.textContent).not.toContain("Showing suppliers");
  });
});
