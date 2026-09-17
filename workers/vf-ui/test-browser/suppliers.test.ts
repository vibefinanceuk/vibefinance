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
    "action.hold": "Hold",
    "action.releasehold": "Release hold",
    "action.activate": "Activate",
    "action.deactivate": "Deactivate",
    "action.save": "Save",
    "action.close": "Close",
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
    "suppliers.nostatusdata": "No status data to show yet.",
    "suppliers.searchplaceholder": "Search suppliers",
    "suppliers.rows": "Rows",
    "suppliers.rangeof": "{start}\u2013{end} of {total}",
    "suppliers.firstpage": "First page",
    "suppliers.previouspage": "Previous page",
    "suppliers.nextpage": "Next page",
    "suppliers.lastpage": "Last page",
    "suppliers.nomatches": "No suppliers match your search.",
    "documents.clearfilter": "Clear filter",
  },
};

/** The same priority order SUPPLIER_STATUS_CASE applies in SQL now — mirrored here only so the stub can derive status-counts and honour a status filter, matching what the real backend now does. */
function bucketOf(s: { erpIdentifier?: string | null; onHold?: boolean; status?: string }) {
  if (!s.erpIdentifier) return "awaitingerp";
  if (s.onHold) return "onhold";
  return s.status === "inactive" ? "inactive" : "active";
}

function stubFetch(body: unknown) {
  const allSuppliers = ((body as { suppliers?: unknown[] })?.suppliers ?? []) as {
    name?: string;
    erpIdentifier?: string | null;
    onHold?: boolean;
    status?: string;
  }[];
  const counts = { active: 0, onhold: 0, inactive: 0, awaitingerp: 0 };
  for (const s of allSuppliers) counts[bucketOf(s)]++;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const [path, qs] = String(url).split("?");
      const params = new URLSearchParams(qs ?? "");
      if (path === "/api/ui-strings") return { ok: true, json: async () => STRINGS } as Response;
      if (path === "/api/suppliers/status-counts") return { ok: true, json: async () => ({ counts }) } as Response;
      if (path === "/api/suppliers") {
        // A real, query-aware filter — decision 0378 made the status
        // filter a server-side param, so a stub returning the same,
        // unfiltered list regardless of the query would no longer
        // exercise what a click-to-filter test needs to prove.
        const status = params.get("status");
        const search = params.get("search")?.toLowerCase();
        let matching = allSuppliers;
        if (status) matching = matching.filter((s) => bucketOf(s) === status);
        if (search) matching = matching.filter((s) => s.name?.toLowerCase().includes(search));

        const page = Number(params.get("page") ?? "1");
        const pageSize = Number(params.get("pageSize") ?? "50");
        const page_ = matching.slice((page - 1) * pageSize, page * pageSize);

        return {
          ok: true,
          json: async () => ({ ...body, suppliers: page_, total: matching.length, page, pageSize }),
        } as Response;
      }
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

  it("puts Load and New supplier top right of the card, beside its own heading (decision 0300)", async () => {
    // Reported live: "move the Load, and New Supplier buttons to be
    // in the top right of the Load a supplier file card. This will
    // free space at the bottom of the card."
    stubFetch({ suppliers: [], lastLoad: null });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/suppliers.js");
    await open();

    const cardhead = [...document.querySelectorAll(".cardhead")].find((c) =>
      c.querySelector("h3")?.textContent === "Load a supplier file"
    );
    expect(cardhead).not.toBeUndefined();
    expect(cardhead?.querySelector(".statebuttons")).not.toBeNull();
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

  it("has no All suppliers row of its own any more", async () => {
    // The operator's own correction: "you have added a 'Clear
    // Filter' button, which actually means the All Suppliers Link is
    // no longer needed."
    stubFetch({ suppliers: SUPPLIERS, lastLoad: null });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/suppliers.js");
    await open();

    expect(legendRow("All suppliers")).toBeUndefined();
  });

  it("Clear filter, on the banner, is now the one way back to everyone", async () => {
    stubFetch({ suppliers: SUPPLIERS, lastLoad: null });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/suppliers.js");
    await open();

    (legendRow("Awaiting ERP") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelectorAll("tbody tr").length).toBe(2);

    const clear = [...document.querySelectorAll("button.chip")].find((b) => b.textContent === "Clear filter");
    expect(clear).not.toBeUndefined();
    (clear as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelectorAll("tbody tr").length).toBe(SUPPLIERS.length);
    expect(document.body.textContent).not.toContain("Showing suppliers");
  });

  it("matches the load-file card's own height, and gives the status card less width (decisions 0300, 0301)", async () => {
    /**
     * **Reported live, twice**: first "the card height on the
     * Supplier Status card be changed to match the 'Load a supplier
     * file' card" and "the Supplier Status card width be reduced,
     * therefore the counts are closer to the text" (decision 0300);
     * then, against the real, deployed result, "alignment between
     * cards at the bottom still seems off" (decision 0301) — grid's
     * own default stretch was not visibly enough, so `height: 100%`
     * on each panel is the thing actually checked here now, not the
     * absence of the override that turned out not to be the whole
     * story. jsdom applies no CSS, so this reads the real stylesheet
     * rather than measure a rendered layout.
     */
    const css = (await import("virtual:stylesheets")).default["app.css"];
    const headStart = css.indexOf(".supplierhead {");
    expect(headStart, "the .supplierhead rule must exist").toBeGreaterThan(-1);
    const headRule = css.slice(headStart, css.indexOf("}", headStart) + 1);

    // Genuinely unequal now, not the auto-fit 1fr/1fr split both cards
    // used to share.
    expect(headRule).not.toContain("auto-fit, minmax(300px, 1fr)");
    expect(headRule).toContain("minmax(260px, 380px)");

    const panelStart = css.indexOf(".supplierhead > .panel {");
    expect(panelStart, "the .supplierhead > .panel rule must exist").toBeGreaterThan(-1);
    const panelRule = css.slice(panelStart, css.indexOf("}", panelStart) + 1);
    expect(panelRule).toContain("height: 100%");
  });
});

describe("the supplier detail pop-out's own buttons, top right (decision 0306)", () => {
  /**
   * **Reported live**: "upon selecting a supplier, it launches a
   * pop-out. Please can you move the buttons - Release Hold / Hold,
   * Activate / Deactivate, Save and Close to the top right of the
   * pop-out."
   */
  const ONE_SUPPLIER = [
    {
      id: "s1",
      erpIdentifier: "E1",
      name: "Acme",
      status: "active",
      onHold: false,
    },
  ];

  async function openDetail() {
    stubFetch({ suppliers: ONE_SUPPLIER, lastLoad: null });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/suppliers.js");
    await open();

    (document.querySelector("tbody tr") as HTMLElement).click();
  }

  it("puts Hold, Activate, Save, and Close in the pop-out's own cardhead, beside its own name", async () => {
    await openDetail();

    const cardhead = [...document.querySelectorAll(".popout .cardhead")].find(
      (c) => c.querySelector("h3")?.textContent === "Acme"
    );
    expect(cardhead).not.toBeUndefined();

    const titles = [...(cardhead?.querySelectorAll(".statebuttons button") ?? [])].map((b) =>
      b.getAttribute("title")
    );
    expect(titles).toEqual(["Hold", "Deactivate", "Save", "Close"]);

    // Not left behind in a row of its own, further down the pop-out.
    const looseStatebuttons = [...document.querySelectorAll(".popout > .statebuttons")];
    expect(looseStatebuttons).toHaveLength(0);
  });

  it("still closes the pop-out from its new position", async () => {
    await openDetail();

    const closeButton = [...document.querySelectorAll(".popout .cardhead button")].find(
      (b) => b.getAttribute("title") === "Close"
    ) as HTMLButtonElement;
    closeButton.click();

    expect(document.querySelector(".backdrop")).toBeNull();
  });
});

describe("focused on one org, decision 0317", () => {
  /**
   * **Extends the same treatment already given to Tasks, Documents,
   * and the dashboard.**
   */
  it("sends the chosen org to /api/suppliers", async () => {
    localStorage.clear();
    localStorage.setItem("vf-current-org", "fr");
    stubFetch({ suppliers: [], lastLoad: null });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/suppliers.js");
    await open();

    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    const call = calls.find((u) => u.startsWith("/api/suppliers?"));
    expect(call).toContain("org=fr");
  });

  it("sends no org param at all when nothing is chosen", async () => {
    localStorage.clear();
    stubFetch({ suppliers: [], lastLoad: null });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/suppliers.js");
    await open();

    // page/pageSize are always sent now (decision 0378, matching
    // decision 0376's own Purchase Orders row) — what this test
    // actually checks is that no org param rides along uninvited.
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    const call = calls.find((u) => u.startsWith("/api/suppliers?"));
    expect(call).toBeDefined();
    expect(call).not.toContain("org=");
  });
});

function manySuppliers(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `s${i}`,
    name: `Supplier ${i}`,
    erpIdentifier: `E${i}`,
    status: "active",
    onHold: false,
  }));
}

describe("searching the list — mirroring decision 0376 for Purchase Orders", () => {
  it("shows the search box with its own placeholder", async () => {
    stubFetch({ suppliers: [], lastLoad: null });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/suppliers.js");
    await open();

    const search = document.getElementById("supplierssearch") as HTMLInputElement;
    expect(search).not.toBeNull();
    expect(search.placeholder).toBe("Search suppliers");
  });

  it("re-fetches with the search term once typing is done, and resets to page 1", async () => {
    stubFetch({ suppliers: manySuppliers(5), lastLoad: null });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/suppliers.js");
    await open();

    const search = document.getElementById("supplierssearch") as HTMLInputElement;
    search.value = "Supplier 2";
    search.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));

    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    const last = [...calls].reverse().find((u) => u.startsWith("/api/suppliers?"));
    expect(last).toContain("search=Supplier+2");
    expect(last).toContain("page=1");
  });

  it("keeps focus on the search box after a search reloads the screen", async () => {
    stubFetch({ suppliers: manySuppliers(5), lastLoad: null });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/suppliers.js");
    await open();

    const search = document.getElementById("supplierssearch") as HTMLInputElement;
    search.value = "Supplier 2";
    search.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));

    expect(document.activeElement?.id).toBe("supplierssearch");
  });

  it("shows a message distinct from 'nothing loaded yet' when a search matches nothing", async () => {
    stubFetch({ suppliers: [], lastLoad: { loadedAt: "2026-09-01T00:00:00Z", loadedBy: "x", rowCount: 1, refusedCount: 0 } });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/suppliers.js");
    await open();

    const search = document.getElementById("supplierssearch") as HTMLInputElement;
    search.value = "no such supplier anywhere";
    search.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));

    expect(document.body.textContent).toContain("No suppliers match your search.");
    expect(document.body.textContent).not.toContain("No suppliers have been loaded yet.");
  });
});

describe("real, server-side pagination for suppliers — mirroring decision 0376", () => {
  it("shows every page size actually offered", async () => {
    stubFetch({ suppliers: manySuppliers(5), lastLoad: null });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/suppliers.js");
    await open();

    const sizePicker = document.getElementById("suppliersrowsize") as HTMLSelectElement;
    const values = [...sizePicker.options].map((o) => o.value);
    expect(values).toEqual(["25", "50", "100", "200"]);
  });

  it("changing the page size re-fetches with the new size and resets to page 1", async () => {
    stubFetch({ suppliers: manySuppliers(120), lastLoad: null });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/suppliers.js");
    await open();

    const sizePicker = document.getElementById("suppliersrowsize") as HTMLSelectElement;
    sizePicker.value = "25";
    sizePicker.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));

    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    const last = [...calls].reverse().find((u) => u.startsWith("/api/suppliers?"));
    expect(last).toContain("pageSize=25");
    expect(last).toContain("page=1");
  });

  it("disables first and previous on the first page", async () => {
    stubFetch({ suppliers: manySuppliers(120), lastLoad: null });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/suppliers.js");
    await open();

    const buttons = [...document.querySelectorAll(".iconbutton")] as HTMLButtonElement[];
    const first = buttons.find((b) => b.title === "First page");
    const prev = buttons.find((b) => b.title === "Previous page");
    expect(first?.disabled).toBe(true);
    expect(prev?.disabled).toBe(true);
  });

  it("disables next and last on the last page", async () => {
    // 3, not 30 — small enough to be the only page regardless of
    // whichever page size a previous test left selected (page size is
    // a remembered preference across opens, the same as Purchase
    // Orders' own row, and deliberately not reset by open()).
    stubFetch({ suppliers: manySuppliers(3), lastLoad: null });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/suppliers.js");
    await open();

    const buttons = [...document.querySelectorAll(".iconbutton")] as HTMLButtonElement[];
    const next = buttons.find((b) => b.title === "Next page");
    const last = buttons.find((b) => b.title === "Last page");
    expect(next?.disabled).toBe(true);
    expect(last?.disabled).toBe(true);
  });

  it("enables every button in the middle of a multi-page result", async () => {
    stubFetch({ suppliers: manySuppliers(120), lastLoad: null });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/suppliers.js");
    await open();

    const nextButton = [...document.querySelectorAll(".iconbutton")].find(
      (b) => (b as HTMLButtonElement).title === "Next page"
    ) as HTMLButtonElement;
    nextButton.click();
    await new Promise((r) => setTimeout(r, 0));

    const buttons = [...document.querySelectorAll(".iconbutton")] as HTMLButtonElement[];
    for (const label of ["First page", "Previous page", "Next page", "Last page"]) {
      expect(buttons.find((b) => b.title === label)?.disabled).toBe(false);
    }
  });

  it("shows the range as text", async () => {
    stubFetch({ suppliers: manySuppliers(120), lastLoad: null });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/suppliers.js");
    await open();

    // Set the page size explicitly rather than assume the default —
    // it is a remembered preference across opens (not reset by
    // open()), so a previous test may have left it at something else.
    const sizePicker = document.getElementById("suppliersrowsize") as HTMLSelectElement;
    sizePicker.value = "50";
    sizePicker.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));

    expect(document.body.textContent).toContain("1\u201350 of 120");
  });

  it("clicking next advances the page while keeping the same search term", async () => {
    stubFetch({ suppliers: manySuppliers(120), lastLoad: null });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/suppliers.js");
    await open();

    const search = document.getElementById("supplierssearch") as HTMLInputElement;
    search.value = "Supplier";
    search.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));

    const nextButton = [...document.querySelectorAll(".iconbutton")].find(
      (b) => (b as HTMLButtonElement).title === "Next page"
    ) as HTMLButtonElement;
    nextButton.click();
    await new Promise((r) => setTimeout(r, 0));

    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    const last = [...calls].reverse().find((u) => u.startsWith("/api/suppliers?"));
    expect(last).toContain("page=2");
    expect(last).toContain("search=Supplier");
  });
});

describe("the status ring stays independent of pagination — decision 0378", () => {
  it("keeps the same segment counts across pages, since it is fetched from its own endpoint", async () => {
    stubFetch({ suppliers: manySuppliers(120), lastLoad: null });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/suppliers.js");
    await open();

    const before = [...document.querySelectorAll(".donutkey")].find((r) => r.textContent?.includes("Active"))?.textContent;

    const nextButton = [...document.querySelectorAll(".iconbutton")].find(
      (b) => (b as HTMLButtonElement).title === "Next page"
    ) as HTMLButtonElement;
    nextButton.click();
    await new Promise((r) => setTimeout(r, 0));

    const after = [...document.querySelectorAll(".donutkey")].find((r) => r.textContent?.includes("Active"))?.textContent;
    expect(after).toBe(before);
    expect(after).toContain("120");
  });

  it("shows a message rather than an empty ring when there is no status data yet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = String(url).split("?")[0];
        if (path === "/api/ui-strings") return { ok: true, json: async () => STRINGS } as Response;
        if (path === "/api/suppliers/status-counts") return { ok: false } as Response;
        if (path === "/api/suppliers") return { ok: true, json: async () => ({ suppliers: [], lastLoad: null }) } as Response;
        throw new Error(`no stub for ${path}`);
      })
    );
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/suppliers.js");
    await open();

    expect(document.body.textContent).toContain("No status data to show yet.");
  });
});
