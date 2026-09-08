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
function stubFetch(routes: Record<string, unknown>, posted: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).split("?")[0];
      // **Records what was POSTed**, which the one-argument version did
      // not — so a test passing an array got it back empty and read
      // that as "nothing was called". The code was right throughout.
      if (init?.method === "POST") posted.push(path);
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
    "action.discard": "Discard",
    "action.return_to_supplier": "To supplier",
    "action.return": "Return",
    "action.whyreason": "Give a reason.",
    "viewer.actionfailed": "That could not be done.",
    "progress.since": "here since {when}",
    "progress.revisited": "This invoice came back to this stage.",
    "viewer.stagelabel": "Stage:",
    "tasks.waiting": "Waiting",
    "tasks.owner": "Owner",
    "tasks.unclaimed": "Nobody yet",
    "viewer.reflabel": "Unique Ref:",
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
    const { ICONS } = await import("/icons.js");
    // A bin has a lid and a tapered body; the archive is a box with a
    // drawer. Asserted on the path itself, since that is the claim.
    expect(ICONS.discard).toContain("M3 6h18v4H3");
    expect(ICONS.discard).not.toContain("6 7h12l-1 13H7L6 7");
  });

  it("draws release as an open padlock and claim as a closed one", async () => {
    // A claim IS a lock, and locks never expire (decision 0104), so
    // letting go is unlocking. The two must be mirrors or neither
    // reads.
    const { ICONS } = await import("/icons.js");
    expect(ICONS.release).toContain("a3 3 0 0 1 6 0");
    expect(ICONS.claim).toContain("a3 3 0 0 1 6 0v4");
    expect(ICONS.release).not.toBe(ICONS.claim);
  });

  it("has an icon for every action a task can report", async () => {
    // An action with no icon renders as a blank square, which reads as
    // broken rather than as unstyled.
    const { ICONS } = await import("/icons.js");
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

describe("the actions do something (decision 0138)", () => {
  /**
   * They rendered and did nothing, which decision 0122 recorded as
   * **worse than before**: an icon advertises more confidently than a
   * greyed-out word.
   *
   * Two reasons, both found by tracing what a click reached: the proxy
   * carried two of six task paths, and three routes authenticated by
   * API key only — the gap decision 0127 fixed everywhere it used
   * `requirePermission`, in the three routes that did not.
   */
  const OPEN = {
    "/api/code-lists": { fields: {} },
    "/api/ui-strings": STRINGS,
    "/api/field-visibility": FIELDS,
    "/api/invoices/inv-1": {
      facts: {},
      lines: [],
      validation: { passed: true, checked: [], failures: [] },
    },
    // The preview asks for one on open (decision 0123).
    "/api/invoices/inv-1/document-url": { url: null },
  };

  /**
   * Named apart from decision 0122's own `openWith` above.
   *
   * **Two helpers of one name in one file** is a reader's trap as much
   * as a test's: mine was shadowed by the earlier one, which takes a
   * single argument and stubs no routes — so every click posted
   * nothing and the code was correct throughout.
   */
  async function openTaskWith(actions: string[], extra = {}, posted: string[] = []) {
    stubFetch({ ...OPEN, ...extra }, posted);
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer({ ...TASK, actions }, () => {});
    await new Promise((r) => setTimeout(r, 0));
  }

  function click(label: string) {
    const link = [...document.querySelectorAll(".actionlink")].find(
      (b) => b.querySelector("span")?.textContent === label
    ) as HTMLButtonElement;
    link.click();
  }

  /**
   * Long enough for a click to finish.
   *
   * **`setTimeout(0)` is not**: `runAction` awaits a fetch and then a
   * JSON parse, and the assertion ran between them — reporting an
   * empty list as though nothing had been called. The first version of
   * these tests failed for that reason and the code was correct
   * throughout.
   */
  const settle = () => new Promise((r) => setTimeout(r, 20));

  it("calls the route an action names", async () => {
    const posted: string[] = [];
    await openTaskWith(["key", "complete"], { "/api/tasks/t-1/complete": {} }, posted);

    click("Complete");
    await settle();
    expect(posted).toContain("/api/tasks/t-1/complete");
  });

  it("turns an underscore into a path a router matches", async () => {
    // `return_to_supplier` is the action; `return-to-supplier` is the
    // route. Getting this wrong is a 404 that looks like a permission
    // problem.
    const posted: string[] = [];
    await openTaskWith(
      ["key", "return_to_supplier"],
      { "/api/tasks/t-1/return-to-supplier": {} },
      posted
    );

    vi.stubGlobal("prompt", () => "Wrong supplier");
    click("To supplier");
    await settle();
    expect(posted).toContain("/api/tasks/t-1/return-to-supplier");
  });

  it("asks for a reason before returning or discarding", async () => {
    // **Decision 0075 made that a requirement.** A document that comes
    // back with no explanation is one the next person cannot act on.
    let asked = false;
    vi.stubGlobal("prompt", () => {
      asked = true;
      return "Duplicate";
    });

    const posted: string[] = [];
    await openTaskWith(["key", "discard"], { "/api/tasks/t-1/discard": {} }, posted);
    click("Discard");
    await settle();

    expect(asked).toBe(true);
    expect(posted).toContain("/api/tasks/t-1/discard");
  });

  it("does nothing when the reason is cancelled", async () => {
    vi.stubGlobal("prompt", () => null);
    const posted: string[] = [];
    await openTaskWith(["key", "discard"], {}, posted);

    click("Discard");
    await settle();
    // **Task posts only.** Opening the viewer POSTs for a document URL
    // (decision 0123), so an empty list was never the right claim.
    expect(posted.filter((p) => p.includes("/tasks/"))).toHaveLength(0);
  });

  it("treats an empty reason as no reason", async () => {
    // The server refuses one too, so sending it would be a round trip
    // to be told what the screen already knows.
    vi.stubGlobal("prompt", () => "   ");
    const posted: string[] = [];
    await openTaskWith(["key", "return"], {}, posted);

    click("Return");
    await settle();
    expect(posted.filter((p) => p.includes("/tasks/"))).toHaveLength(0);
  });

  it("asks for nothing before completing", async () => {
    // Completing is not a refusal, so there is nothing to explain.
    let asked = false;
    vi.stubGlobal("prompt", () => {
      asked = true;
      return "x";
    });

    await openTaskWith(["key", "complete"], { "/api/tasks/t-1/complete": {} });
    click("Complete");
    await settle();
    expect(asked).toBe(false);
  });
});

describe("the same screen serves review (decision 0142)", () => {
  /**
   * **Not a second screen.** The operator's own framing: *"the same as
   * validate, just with different actions, and with the information
   * locked read-only."*
   *
   * It already worked that way. Field visibility (0114) makes a stage
   * read-only, the task reports its own actions (0103), and the viewer
   * fetches both per stage. What was missing was a way to open a task
   * that does not offer `key`, and a Save button that stopped
   * promising an effect it could not have.
   */
  const READ_ONLY = {
    fields: FIELDS.fields.map((f) => ({ ...f, visibility: "read" })),
  };

  const OPEN = {
    "/api/code-lists": { fields: {} },
    "/api/ui-strings": STRINGS,
    "/api/invoices/inv-1": {
      facts: { "BT-112": 1200 },
      lines: [],
      validation: { passed: true, checked: [], failures: [] },
    },
    "/api/invoices/inv-1/document-url": { url: null },
  };

  async function openApproval(actions = ["complete", "return"]) {
    stubFetch({ ...OPEN, "/api/field-visibility": READ_ONLY });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(
      { ...TASK, stageId: "approval", stageName: "Approval", actions },
      () => {}
    );
    await new Promise((r) => setTimeout(r, 0));
  }

  it("offers no Save when nothing can be saved", async () => {
    // **A Save that submits nothing is a button promising an effect it
    // cannot have**, which decision 0122 already called worse than an
    // absent one.
    await openApproval();
    const labels = [...document.querySelectorAll(".actionlink span")].map((n) => n.textContent);
    expect(labels).not.toContain("Save");
  });

  it("still offers the document", async () => {
    // Approving without seeing what is being approved is not approval.
    await openApproval();
    const labels = [...document.querySelectorAll(".actionlink span")].map((n) => n.textContent);
    expect(labels).toContain("Expand");
  });

  it("makes the task's first action the dominant one", async () => {
    // With nothing to save, what somebody came to do is what the task
    // offers.
    await openApproval(["complete", "return"]);
    const primary = document.querySelector(".actionlink.primary span");
    expect(primary?.textContent).toBe("Complete");
  });

  it("renders every field as text", async () => {
    await openApproval();
    expect(document.getElementById("f-BT-112")?.tagName).toBe("DIV");
    expect(document.querySelector("#f-BT-112 input")).toBeNull();
  });

  it("shows the value being approved", async () => {
    // Read-only is not blank.
    await openApproval();
    expect(document.getElementById("f-BT-112")?.textContent).toBe("1200");
  });

  it("names the stage, not the screen", async () => {
    // **The same screen serves every stage**, and a heading saying
    // "Validation" on an approval task is the screen lying about where
    // somebody is.
    await openApproval();
    // Labelled since decision 0175: a bare word could be anything.
    expect(document.querySelector(".topbar h2")?.textContent).toBe("Stage: Approval");
  });

  it("keeps Save where a stage does permit editing", async () => {
    // The property that makes this configuration rather than a second
    // screen: a customer who makes Validation read-only gets a
    // read-only Validation screen, and nothing about the code changes.
    stubFetch({ ...OPEN, "/api/field-visibility": FIELDS });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer({ ...TASK, actions: ["key", "complete"] }, () => {});
    await new Promise((r) => setTimeout(r, 0));

    const labels = [...document.querySelectorAll(".actionlink span")].map((n) => n.textContent);
    expect(labels).toContain("Save");
  });
});

describe("where the invoice has been (decision 0151)", () => {
  /**
   * The operator's idea, from the rules screen's chevrons: **the same
   * display at the head of the viewer**, with the current stage marked
   * and how long each took beneath.
   */
  const PROGRESS = {
    inProcess: true,
    currentStageId: "validation",
    stages: [
      {
        id: "intake",
        name: "Intake",
        state: "behind",
        visitCount: 1,
        periods: [
          { enteredAt: "2026-09-01 09:00:00", leftAt: "2026-09-01 09:40:00", duration: "40m" },
        ],
      },
      {
        id: "validation",
        name: "Validation",
        state: "here",
        visitCount: 1,
        periods: [{ enteredAt: "2026-09-01 09:40:00", leftAt: null, duration: null }],
      },
      { id: "approval", name: "Approval", state: "ahead" },
    ],
  };

  async function openWithProgress(progress: unknown) {
    stubFetch({
      "/api/code-lists": { fields: {} },
      "/api/ui-strings": STRINGS,
      "/api/field-visibility": FIELDS,
      "/api/invoices/inv-1": {
        facts: {},
        lines: [],
        validation: { passed: true, checked: [], failures: [] },
      },
      "/api/invoices/inv-1/document-url": { url: null },
      "/api/invoices/inv-1/progress": progress,
    });

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));
  }

  it("shows the whole sequence, not just where it is", async () => {
    await openWithProgress(PROGRESS);
    const names = [...document.querySelectorAll(".stage span:first-child")].map(
      (s) => s.textContent
    );
    expect(names).toEqual(["Intake", "Validation", "Approval"]);
  });

  it("marks the stage it is at", async () => {
    await openWithProgress(PROGRESS);
    expect(document.querySelector(".stage.here span:first-child")?.textContent).toBe("Validation");
  });

  it("dims what is still to come rather than hiding it", async () => {
    // **The sequence still reads as a whole**, and somebody can see
    // what is left.
    await openWithProgress(PROGRESS);
    const ahead = document.querySelector(".stage.ahead span:first-child");
    expect(ahead?.textContent).toBe("Approval");
  });

  it("says how long a finished stage took", async () => {
    await openWithProgress(PROGRESS);
    expect(document.body.textContent).toContain("40m");
  });

  it("says how long it has been at the current one", async () => {
    await openWithProgress(PROGRESS);
    expect(document.body.textContent).toContain("here since");
  });

  it("offers no chevron to click", async () => {
    // **It reports where the document has been.** It is not a place to
    // send it.
    await openWithProgress(PROGRESS);
    const stages = [...document.querySelectorAll(".stage")];
    expect(stages.every((s) => s.tagName === "DIV")).toBe(true);
  });

  it("shows nothing at all for an invoice in no process", async () => {
    // An empty row of chevrons would imply it has not started.
    await openWithProgress({ inProcess: false, stages: [] });
    expect(document.querySelector(".process")).toBeNull();
  });

  it("still opens when the path cannot be loaded", async () => {
    // A path nobody can show is not a document nobody can key.
    await openWithProgress({ inProcess: false, stages: [] });
    expect(document.getElementById("f-BT-112")).not.toBeNull();
  });
});

describe("a stage returned to (decision 0151)", () => {
  /**
   * The operator's refinement:
   *
   * > If a process stage is returned to, we do not need another box in
   * > the flow — we simply add another entry and exit timestamp in the
   * > same stage box.
   *
   * **One box per stage**, and a stage entered twice took time twice.
   */
  const RETURNED = {
    inProcess: true,
    currentStageId: "validation",
    stages: [
      {
        id: "intake",
        name: "Intake",
        state: "behind",
        visitCount: 1,
        periods: [{ enteredAt: "2026-09-01 09:00:00", leftAt: "2026-09-01 09:10:00", duration: "10m" }],
      },
      {
        id: "validation",
        name: "Validation",
        state: "here",
        visitCount: 2,
        periods: [
          { enteredAt: "2026-09-01 09:10:00", leftAt: "2026-09-02 11:10:00", duration: "1d 2h" },
          { enteredAt: "2026-09-03 08:00:00", leftAt: null, duration: null },
        ],
      },
      { id: "approval", name: "Approval", state: "behind", visitCount: 1, periods: [
        { enteredAt: "2026-09-02 11:10:00", leftAt: "2026-09-03 08:00:00", duration: "20h 50m" },
      ] },
    ],
  };

  async function openReturned() {
    stubFetch({
      "/api/code-lists": { fields: {} },
      "/api/ui-strings": STRINGS,
      "/api/field-visibility": FIELDS,
      "/api/invoices/inv-1": {
        facts: {},
        lines: [],
        validation: { passed: true, checked: [], failures: [] },
      },
      "/api/invoices/inv-1/document-url": { url: null },
      "/api/invoices/inv-1/progress": RETURNED,
    });

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));
  }

  it("adds no second box for a stage visited twice", async () => {
    await openReturned();
    const names = [...document.querySelectorAll(".stage span:first-child")].map(
      (s) => s.textContent
    );
    expect(names).toEqual(["Intake", "Validation", "Approval"]);
  });

  it("shows both periods in the one box", async () => {
    // **A stage entered twice took time twice**, and the second time is
    // often the interesting one.
    await openReturned();
    const validation = [...document.querySelectorAll(".stage")].find((s) =>
      s.textContent?.startsWith("Validation")
    );

    expect(validation?.textContent).toContain("1d 2h");
    expect(validation?.textContent).toContain("here since");
  });

  it("keeps Approval where it happened, not where it ends", async () => {
    // The document went forward and came back, so Approval is behind
    // even though Validation is current.
    await openReturned();
    const approval = [...document.querySelectorAll(".stage")].find((s) =>
      s.textContent?.startsWith("Approval")
    );
    expect(approval?.className).toContain("behind");
  });
});

describe("the status card is gone (decision 0175)", () => {
  /**
   * **Four things and none of them earned a card.** The status read
   * *"Not yet keyed · 0/4 fields known"* on every document, counting
   * four fields nobody chose. The stage was already the heading.
   * Waiting and Owner were real and belonged beside the document's own
   * identity rather than below it.
   */
  async function openOwned() {
    stubFetch({
      "/api/code-lists": { fields: {} },
      "/api/ui-strings": STRINGS,
      "/api/field-visibility": FIELDS,
      "/api/invoices/inv-1": {
        facts: {},
        lines: [],
        validation: { passed: true, checked: [], failures: [] },
      },
      "/api/invoices/inv-1/document-url": { url: null },
      "/api/invoices/inv-1/progress": { inProcess: false, stages: [] },
    });

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(
      {
        ...TASK,
        createdAt: "2026-09-01 09:00:00",
        lockedBy: { id: "u-alice", name: "Alice", email: "alice@acme.com", since: null },
      },
      () => {}
    );
    await new Promise((r) => setTimeout(r, 0));
  }

  it("no longer counts four fields nobody chose", async () => {
    await openOwned();
    expect(document.body.textContent).not.toContain("0/4");
  });

  it("removes the card entirely", async () => {
    await openOwned();
    expect(document.querySelector(".statusbar")).toBeNull();
  });

  it("labels the heading, so a bare word is not ambiguous", async () => {
    await openOwned();
    expect(document.querySelector(".topbar h2")?.textContent).toContain("Stage:");
  });

  it("labels the reference beneath it", async () => {
    await openOwned();
    expect(document.querySelector(".topbar")?.textContent).toContain("Unique Ref:");
  });

  it("keeps how long it has waited, at the top", async () => {
    await openOwned();
    expect(document.querySelector(".subhead")?.textContent).toContain("Waiting");
  });

  it("says who owns it by address, not 'Mine'", async () => {
    // **"Owner: Mine" tells the person holding it what they know** and
    // tells everybody else nothing. An address is who to ask.
    await openOwned();
    expect(document.querySelector(".subhead")?.textContent).toContain("alice@acme.com");
  });
});

describe("what identifies the document sits in the heading (decision 0176)", () => {
  /**
   * **The rule under a topbar separates the heading from the page.**
   * Waiting and Owner sat below it, which read as the first row of
   * content rather than as part of the heading.
   */
  async function openWith(task: Record<string, unknown>) {
    stubFetch({
      "/api/code-lists": { fields: {} },
      "/api/ui-strings": STRINGS,
      "/api/field-visibility": FIELDS,
      "/api/invoices/inv-1": {
        facts: {},
        lines: [],
        validation: { passed: true, checked: [], failures: [] },
      },
      "/api/invoices/inv-1/document-url": { url: null },
      "/api/invoices/inv-1/progress": { inProcess: false, stages: [] },
    });

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer({ ...TASK, ...task }, () => {});
    await new Promise((r) => setTimeout(r, 0));
  }

  it("puts the subhead inside the topbar", async () => {
    await openWith({ createdAt: "2026-09-01 09:00:00" });
    expect(document.querySelector(".topbar .subhead")).not.toBeNull();
  });

  it("says nobody has claimed it, rather than nothing", async () => {
    // **An absent line reads as a screen that forgot**, and unclaimed
    // is a real answer: anybody may take it.
    await openWith({ createdAt: "2026-09-01 09:00:00", lockedBy: undefined });
    expect(document.querySelector(".subhead")?.textContent).toContain("Nobody yet");
  });

  it("names the owner where there is one", async () => {
    await openWith({
      createdAt: "2026-09-01 09:00:00",
      lockedBy: { id: "u-a", name: "Alice", email: "alice@acme.com", since: null },
    });
    expect(document.querySelector(".subhead")?.textContent).toContain("alice@acme.com");
  });

  it("says nothing about ownership on a document with no stage", async () => {
    // A document opened from the manager is not work (decision 0167).
    await openWith({ createdAt: undefined, stageId: null, lockedBy: undefined });
    expect(document.querySelector(".subhead")?.textContent).not.toContain("Owner");
  });
});
