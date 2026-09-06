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
    "action.expand": "Expand",
    "action.save": "Save",
    "action.complete": "Complete",
    "action.release": "Release",
    "viewer.document": "Document",
    "viewer.nodocument": "No document retained",
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

describe("the action row (decision 0122)", () => {
  const OPEN = {
    "/api/code-lists": { fields: {} },
    "/api/ui-strings": STRINGS,
    "/api/field-visibility": FIELDS,
    "/api/invoices/inv-1": {
      facts: {},
      lines: [],
      validation: { passed: true, checked: [], failures: [] },
    },
  };

  async function openWith(actions: string[]) {
    stubFetch(OPEN);
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer({ ...TASK, actions }, () => {});
  }

  it("puts the actions below the document, not in a panel of their own", async () => {
    await openWith(["key", "complete"]);
    const row = document.querySelector(".actionrow");
    expect(row).not.toBeNull();
    // The old stacked panel is gone.
    expect(document.querySelector(".panel.actions")).toBeNull();
  });

  it("gives every action an icon and a label", async () => {
    // An icon alone is a guess. The reference this came from labels
    // every one of its three.
    await openWith(["key", "complete", "release"]);
    for (const link of document.querySelectorAll(".actionlink")) {
      expect(link.querySelector("svg"), link.textContent ?? "").not.toBeNull();
      expect(link.querySelector("span")?.textContent?.trim()).toBeTruthy();
    }
  });

  it("always offers expand and save, whatever the task says", async () => {
    // Those two are the screen's own, not the task's: a person can
    // always look at the document and always save what they typed.
    await openWith([]);
    const labels = [...document.querySelectorAll(".actionlink span")].map((n) => n.textContent);
    expect(labels).toContain("Expand");
    expect(labels).toContain("Save");
  });

  it("renders exactly the actions the task reports, and no others", async () => {
    // Still the server's decision (decision 0103). Icons changed how
    // they look, not where they are decided.
    await openWith(["key", "complete"]);
    const labels = [...document.querySelectorAll(".actionlink span")].map((n) => n.textContent);
    expect(labels).toContain("Complete");
    expect(labels).not.toContain("Release");
  });

  it("marks one action as the dominant one", async () => {
    // Giving every action equal weight loses which one a person is
    // here to press (decision 0108).
    await openWith(["key"]);
    const primary = document.querySelectorAll(".actionlink.primary");
    expect(primary).toHaveLength(1);
    expect(primary[0].querySelector("span")?.textContent).toBe("Save");
  });

  it("does not offer key as an action, since keying is the screen", async () => {
    await openWith(["key"]);
    const labels = [...document.querySelectorAll(".actionlink span")].map((n) => n.textContent);
    expect(labels).not.toContain("Key");
  });
});

describe("the icons say what the actions do (decision 0122)", () => {
  /**
   * **An icon that misdescribes an action is worse than a word.** These
   * assert the two that were genuinely at risk of lying.
   */
  it("draws discard as an archive, never a waste bin", async () => {
    // Discarding archives and deletes nothing (decision 0078). A bin
    // would promise a customer something this system does not do.
    const { ICONS } = await import("/viewer.js");
    // A bin has a lid and a tapered body; the archive is a box with a
    // drawer. Asserted on the path itself, since that is the claim.
    expect(ICONS.discard).toContain("M3 6h18v4H3");
    expect(ICONS.discard).not.toContain("6 7h12l-1 13H7L6 7");
  });

  it("draws release as an open padlock and claim as a closed one", async () => {
    // A claim IS a lock, and locks never expire (decision 0104), so
    // letting go is unlocking. The two must be mirrors or neither
    // reads.
    const { ICONS } = await import("/viewer.js");
    expect(ICONS.release).toContain("a3 3 0 0 1 6 0");
    expect(ICONS.claim).toContain("a3 3 0 0 1 6 0v4");
    expect(ICONS.release).not.toBe(ICONS.claim);
  });

  it("has an icon for every action a task can report", async () => {
    // An action with no icon renders as a blank square, which reads as
    // broken rather than as unstyled.
    const { ICONS } = await import("/viewer.js");
    for (const action of [
      "expand",
      "save",
      "complete",
      "release",
      "claim",
      "return",
      "return_to_supplier",
      "discard",
    ]) {
      expect(ICONS[action], action).toBeTruthy();
    }
  });
});

describe("the document preview (decision 0123)", () => {
  /**
   * **The browser renders it, not us.** Decision 0042 records that a
   * *Worker* cannot render a PDF, which was read for longer than it
   * should have been as "this cannot be previewed".
   */
  function withDocument(contentType: string | null) {
    return {
      "/api/code-lists": { fields: {} },
      "/api/ui-strings": STRINGS,
      "/api/field-visibility": FIELDS,
      "/api/invoices/inv-1": {
        facts: {},
        lines: [],
        document: contentType ? { contentType, documentType: "original" } : null,
        validation: { passed: true, checked: [], failures: [] },
      },
      "/api/invoices/inv-1/document-url": { url: "https://example.com/signed.pdf" },
    };
  }

  async function open(contentType: string | null) {
    stubFetch(withDocument(contentType));
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    // The preview is deliberately not awaited, so the form is usable
    // while it loads.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it("puts a PDF in a frame, where the browser's own viewer scrolls it", async () => {
    await open("application/pdf");
    const frame = document.querySelector("#vpreview iframe") as HTMLIFrameElement;
    expect(frame).not.toBeNull();
    expect(frame.src).toBe("https://example.com/signed.pdf");
  });

  it("puts an image in an image, not a frame", async () => {
    // Getting this the wrong way round shows nothing.
    await open("image/jpeg");
    expect(document.querySelector("#vpreview img")).not.toBeNull();
    expect(document.querySelector("#vpreview iframe")).toBeNull();
  });

  it("says so when nothing was retained", async () => {
    // An invoice with no original is a real state, not a failure.
    stubFetch({
      ...withDocument(null),
      "/api/invoices/inv-1/document-url": { url: null },
    });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.getElementById("vpreview")?.textContent).toContain("No document retained");
  });

  it("does not hold up the form while the document loads", async () => {
    // A slow R2 fetch should not block somebody who knows what to type.
    stubFetch(withDocument("application/pdf"));
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});

    // Fields are present before the preview has resolved.
    expect(document.getElementById("f-BT-112")).not.toBeNull();
  });
});
