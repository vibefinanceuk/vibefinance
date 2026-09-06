import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Validation viewer, in a DOM — decision 0121.
 *
 * **Every test here corresponds to a bug found by somebody looking at
 * the screen.** That is deliberate: a new test layer earns its place by
 * catching what already escaped, not by covering what never broke.
 */

/** The panels the viewer renders into, as `index.html` provides them. */
function mountShell() {
  document.body.innerHTML = `
    <main id="signin-view" hidden></main>
    <main id="shell" hidden></main>
    <main id="viewer"></main>
    <link id="brand" />
  `;
}

/**
 * A task as the list supplies it, and a stored invoice as the API
 * returns it.
 *
 * `fetch` is stubbed per URL rather than globally, so a test that
 * forgets an endpoint fails loudly instead of receiving an empty object
 * and quietly proving nothing.
 */
function stubFetch(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url).split("?")[0];
      if (!(path in routes)) {
        throw new Error(`no stub for ${path} — add one, or the test proves nothing`);
      }
      return {
        ok: true,
        json: async () => routes[path],
      } as Response;
    })
  );
}

const TASK = {
  id: "t-1",
  stageId: "validation",
  stageName: "Validation",
  ownership: "mine",
  createdAt: "2026-09-01 09:00:00",
  actions: ["key", "complete"],
  subject: { type: "invoice", id: "inv-1", supplierVatId: "DE123", supplierName: "Munch GmbH" },
};

const FIELDS = {
  fields: [
    { field: "BT-106", visibility: "edit", type: "number", line: false, description: "sum of lines" },
    { field: "BT-110", visibility: "edit", type: "number", line: false, description: "total VAT" },
    { field: "BT-112", visibility: "edit", type: "number", line: false, description: "total with VAT" },
    { field: "BT-27", visibility: "read", type: "text", line: false, description: "seller name" },
    { field: "BT-131", visibility: "edit", type: "number", line: true, description: "line net" },
  ],
};

const STRINGS = {
  locale: "en",
  strings: {
    "check.vat_arithmetic": "Net plus VAT does not equal the total",
    "viewer.exceptions": "Exceptions",
    "viewer.noexceptions": "Nothing to resolve.",
    "field.bt-106": "Net before VAT",
    "field.bt-110": "VAT amount",
    "field.bt-112": "Total with VAT",
    "field.bt-27": "Seller name",
    "field.bt-131": "Line net amount",
  },
};

beforeEach(() => {
  mountShell();
  vi.resetModules();
});

describe("the form shows what was saved (decision 0120)", () => {
  /**
   * Reported: *"I click save, it says saved, I leave the screen and
   * re-enter, and it's empty again."* The save worked; the viewer built
   * its values from the task list's five-field summary and read nothing
   * back.
   */
  it("fills every editable field from the stored facts", async () => {
    stubFetch({
      "/api/code-lists": { fields: {} },
      "/api/ui-strings": STRINGS,
      "/api/field-visibility": FIELDS,
      "/api/invoices/inv-1": {
        facts: { "BT-106": 100, "BT-110": 20, "BT-112": 120 },
        lines: [],
        validation: { passed: true, checked: [], failures: [] },
      },
    });

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});

    expect((document.getElementById("f-BT-106") as HTMLInputElement).value).toBe("100");
    expect((document.getElementById("f-BT-110") as HTMLInputElement).value).toBe("20");
    expect((document.getElementById("f-BT-112") as HTMLInputElement).value).toBe("120");
  });

  it("brings keyed lines back", async () => {
    stubFetch({
      "/api/code-lists": { fields: {} },
      "/api/ui-strings": STRINGS,
      "/api/field-visibility": FIELDS,
      "/api/invoices/inv-1": {
        facts: {},
        lines: [{ lineNumber: 1, facts: { "BT-131": 60 } }],
        validation: { passed: true, checked: [], failures: [] },
      },
    });

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});

    const rows = document.querySelectorAll("#lines tr");
    expect(rows).toHaveLength(1);
  });
});

describe("the exceptions panel (decision 0119)", () => {
  /**
   * Reported twice: the panel showed nothing after saving because the
   * route dropped `involves`, and then read *"Nothing to resolve"* on a
   * failing document because it filled only on save.
   */
  const FAILING = {
    "/api/code-lists": { fields: {} },
    "/api/ui-strings": STRINGS,
    "/api/field-visibility": FIELDS,
    "/api/invoices/inv-1": {
      facts: { "BT-106": 100, "BT-110": 20, "BT-112": 999 },
      lines: [],
      validation: {
        passed: false,
        checked: ["vat_arithmetic"],
        failures: ["vat_arithmetic"],
        involves: [{ check: "vat_arithmetic", fields: ["BT-106", "BT-110", "BT-112"] }],
      },
    },
  };

  it("lists what is wrong the moment the document opens", async () => {
    stubFetch(FAILING);
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});

    const list = document.getElementById("exlist");
    expect(list?.textContent).toContain("Net plus VAT does not equal the total");
    // And not the empty state.
    expect(list?.textContent).not.toContain("Nothing to resolve");
  });

  it("names the fields involved, so a person can read the panel alone", async () => {
    stubFetch(FAILING);
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});

    const list = document.getElementById("exlist");
    expect(list?.textContent).toContain("Net before VAT");
    expect(list?.textContent).toContain("Total with VAT");
  });

  it("highlights every field the failure involves", async () => {
    stubFetch(FAILING);
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});

    for (const code of ["BT-106", "BT-110", "BT-112"]) {
      const box = document.getElementById(`f-${code}`)?.closest(".kf");
      expect(box?.classList.contains("failing"), code).toBe(true);
    }
  });

  it("carries the reason on each highlighted field", async () => {
    // A red box that does not explain itself makes somebody hunt
    // through the list to find which exception is theirs.
    stubFetch(FAILING);
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});

    const box = document.getElementById("f-BT-112")?.closest(".kf") as HTMLElement;
    expect(box.title).toBe("Net plus VAT does not equal the total");
  });

  it("leaves a field alone when nothing involves it", async () => {
    stubFetch(FAILING);
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});

    const box = document.getElementById("f-BT-27")?.closest(".kf");
    expect(box?.classList.contains("failing")).toBe(false);
  });

  it("says so plainly when there is nothing wrong", async () => {
    stubFetch({
      "/api/code-lists": { fields: {} },
      "/api/ui-strings": STRINGS,
      "/api/field-visibility": FIELDS,
      "/api/invoices/inv-1": {
        facts: { "BT-112": 100 },
        lines: [],
        validation: { passed: true, checked: ["total_missing"], failures: [] },
      },
    });

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});

    expect(document.getElementById("exlist")?.textContent).toContain("Nothing to resolve");
  });
});

describe("field visibility reaches the screen (decision 0114)", () => {
  it("renders a read-only field as text, not an input", async () => {
    // A greyed-out box invites clicking and reads as broken.
    stubFetch({
      "/api/code-lists": { fields: {} },
      "/api/ui-strings": STRINGS,
      "/api/field-visibility": FIELDS,
      "/api/invoices/inv-1": {
        facts: { "BT-27": "Munch GmbH" },
        lines: [],
        validation: { passed: true, checked: [], failures: [] },
      },
    });

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});

    const control = document.getElementById("f-BT-27");
    expect(control?.tagName).toBe("DIV");
    expect(control?.textContent).toBe("Munch GmbH");
  });

  it("renders nothing for a field the stage hides", async () => {
    stubFetch({
      "/api/code-lists": { fields: {} },
      "/api/ui-strings": STRINGS,
      "/api/field-visibility": { fields: FIELDS.fields.filter((f) => f.field !== "BT-110") },
      "/api/invoices/inv-1": {
        facts: {},
        lines: [],
        validation: { passed: true, checked: [], failures: [] },
      },
    });

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});

    expect(document.getElementById("f-BT-110")).toBeNull();
  });
});
