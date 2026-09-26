import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
 *
 * **One default, not zero.** `GET /invoices/:id/pages` (decision 0381)
 * is now asked by every open document, through `pageViewer()`
 * (decision 0382) — a question almost none of these tests are actually
 * about (they are about the fields, the exceptions, the timeline).
 * Defaulting it to "no retained pages" here is the same call
 * `purchase-orders.test.ts`'s own `stubFetch` already made for
 * `/api/ui-strings`: infrastructure every screen needs, not the thing
 * under test. A `routes` entry for the same path still overrides it,
 * for the tests that are genuinely about multi-page documents.
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
      if (path in routes) {
        return { ok: true, json: async () => routes[path] } as Response;
      }
      if (/^\/api\/invoices\/[^/]+\/pages$/.test(path)) {
        return { ok: true, json: async () => ({ pages: [] }) } as Response;
      }
      /**
       * **The same default the pages route gets, for the same
       * reason — decision 0471.** `collaborators.js` (decision 0470)
       * fetches this the moment the Timeline / Chat tab builds, for
       * every task that carries an invoice subject — infrastructure
       * almost none of these tests are actually about, the same as
       * `/pages` above. A `routes` entry for the same path still
       * overrides it, for the tests genuinely about collaborators.
       */
      if (/^\/api\/documents\/[^/]+\/collaborators$/.test(path)) {
        return { ok: true, json: async () => ({ collaborators: [] }) } as Response;
      }
      throw new Error(`no stub for ${path} — add one, or the test proves nothing`);
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
    "viewer.back": "Back",
    "check.vat_arithmetic": "Net plus VAT does not equal the total",
    "check.po_mismatch": "Does not match the purchase order",
    "viewer.exceptions": "Exceptions",
    "viewer.seller": "Seller",
    "viewer.buyer": "Buyer",
    "viewer.supplier.name": "Name",
    "viewer.supplier.vat": "VAT number",
    "viewer.supplier.endpoint": "Electronic address",
    "viewer.supplier.email": "Email",
    "viewer.supplier.street": "Address",
    "viewer.supplier.phone": "Phone",
    "viewer.supplier.city": "City",
    "viewer.supplier.postcode": "Postcode",
    "viewer.supplier.country": "Country",
    "viewer.supplier.none": "This invoice has not been matched to a supplier.",
    "viewer.supplier.no_match": "No supplier on file matches this seller.",
    "viewer.supplier.newseller": "New Seller",
    "viewer.supplier.record": "Record New Supplier",
    "viewer.supplier.newsellerheading": "Record a new seller",
    "viewer.supplier.newsellerhint": "Enter what the invoice itself tells you. A team will complete the setup with the ERP.",
    "viewer.supplier.namerequired": "Company name is required.",
    "viewer.supplier.save": "Save",
    "viewer.supplier.savefailed": "Could not save this supplier. Try again.",
    "viewer.supplier.pounidentified": "This invoice names a purchase order but no supplier could be matched. A purchase order cannot exist for a supplier that was never set up — this needs investigation, not a new record.",
    "workflow.systemreason.supplier_unidentified.name": "Awaiting a new supplier record",
    "workflow.systemreason.supplier_awaiting_erp.name": "Awaiting an ERP identifier for this supplier",
    "workflow.systemreason.po_supplier_unidentified.name": "Purchase order references a supplier that was never set up",
    "suppliers.pay": "Payment",
    "suppliers.sameorg": "Same org as this invoice",
    "viewer.workflow.stageerror": "This invoice stopped moving because of a processing error:",
    "invoice.reasonline.label": "Here because:",
    "invoice.reasonline.expand": "click for details",
    "matching.standardrule.po_line_not_found.name": "Standard rule: PO line not found",
    "action.changebuyer": "Change Buyer",
    "action.changeseller": "Change Seller",
    "viewer.noexceptions": "Nothing to resolve.",
    "field.bt-106": "Net before VAT",
    "field.bt-110": "VAT amount",
    "field.bt-112": "Total with VAT",
    "field.bt-27": "Seller name",
    "field.bt-131": "Line net amount",
    "field.bt-129": "Invoiced quantity",
    "field.bt-1": "Invoice number",
    "field.bt-5": "Currency",
    "field.bt-2": "Issue date",
    "field.bt-9": "Due date",
    "field.bt-13": "Purchase order",
    "field.bt-20": "Payment terms",
    "field.bt-3": "Invoice type",
    "field.bt-109": "Total without VAT",
    "field.bt-115": "Amount due",
    "field.bt-23": "Business process",
    "field.bt-24": "Specification",
    "action.headerfields": "Header Fields",
    "viewer.allheaderfields": "All invoice header fields",
    "viewer.fields": "Invoice header",
    "action.close": "Close",
    "action.expand": "Expand",
    "action.save": "Save",
    "action.claim": "Claim",
    "action.complete": "Complete",
    "action.approve": "Approve",
    "action.release": "Release",
    "action.discard": "Discard",
    "action.discard.reasonlabel": "Reason",
    "action.reassign": "Reassign",
    "action.reassign.wholabel": "Reassign to",
    "action.reassign.commentlabel": "Comment (optional)",
    "action.reassign.nonefound": "There are no eligible users to reassign.",
    "action.return_to_supplier": "To supplier",
    "action.return_to_supplier.nonefound": "There are no return reasons configured.",
    "action.return_to_supplier.reasonlabel": "Reason",
    "action.return_to_supplier.commentlabel": "Comment for the supplier",
    "action.return_to_supplier.willgoto": "This will be emailed to",
    "action.return_to_supplier.noemail": "No email address on file for this supplier.",
    "action.return_to_supplier.ccapteam": "Copy our AP team",
    "action.return": "Return",
    "action.return.wholabel": "Return to",
    "action.return.reasonlabel": "Reason",
    "action.return.nonefound": "No return targets are configured for this stage.",
    "action.route_to_approver": "Route To Approver",
    "action.route_to_approver.wholabel": "Route to",
    "action.route_to_approver.commentlabel": "Comment (optional)",
    "action.route_to_approver.nonefound": "Nobody is set up to approve this yet.",
    "action.whyreason": "Give a reason.",
    "action.ok": "OK",
    "viewer.actionfailed": "That could not be done.",
    "progress.since": "here since {when}",
    "progress.revisited": "This invoice came back to this stage.",
    "viewer.stagelabel": "Stage:",
    "tasks.waiting": "Waiting",
    "tasks.owner": "Owner",
    "tasks.unclaimed": "Nobody yet",
    "viewer.waitinglabel": "Waiting:",
    "viewer.ownerlabel": "Owner:",
    "viewer.reflabel": "Unique Ref:",
    "viewer.document": "Document",
    "viewer.nodocument": "No document retained",
    "viewer.unreadable": "This document could not be read automatically. Please manually enter the fields in the cells provided.",
    "viewer.xmltab": "XML",
    "viewer.tried": "Tried:",
    "viewer.popupblocked": "Your browser blocked the pop-up window. Allow pop-ups for this site and try again.",
    "viewer.openinwindow": "Document open in a separate window",
    "viewer.bringtofront": "Bring to front",
    "viewer.showhere": "Show here instead",
    "activity.tab": "Activity",
    "activity.title": "Activity",
    "activity.loading": "Loading…",
    "activity.empty": "Nothing here yet.",
    "activity.placeholder": "Leave a note for your team…",
    "activity.post": "Post",
    "activity.internalonly": "Internal only — not visible to the supplier.",
    "activity.loadfailed": "Could not load the activity for this document.",
    "activity.postfailed": "That did not post. Try again.",
    "activity.received": "Invoice received",
    "activity.stagecompleted": "{who} completed {stage}",
    "activity.rulefired": "Business rule \u2018{rule}\u2019 fired: {actions}",
    // Decision 0488 \u2014 Timeline entries for claim/release/return/
    // return-to-supplier/discard.
    "activity.claimed": "{who} claimed this task",
    "activity.released": "{who} released this task",
    "activity.returned": "{who} returned this to {stage}",
    "activity.returnedtosupplier": "{who} returned this to the supplier",
    "activity.discarded": "{who} discarded this task",
    "activity.timelinetab": "Timeline / Chat",
    "activity.systemalert": "System Alert",
    // Removing a collaborator — decision 0476.
    "activity.removeperson": "Remove from conversation",
    "activity.removepersonfailed": "Could not remove that person. Try again.",
  },
};

beforeEach(() => {
  mountShell();
  vi.resetModules();
});

/**
 * **A stub that outlives its file** — decision 0227.
 *
 * `vi.stubGlobal` is not undone between files, so this one's `fetch`
 * was still installed when `tasks.test.ts` ran, and that file's
 * navigation test failed **depending on the order the two were
 * scheduled in** — passing alone and failing together.
 *
 * A test that fails by order is worse than one that fails: the first
 * time it goes green nobody knows whether it was fixed or reshuffled.
 */
afterEach(() => {
  vi.unstubAllGlobals();
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
        involves: [
          { check: "vat_arithmetic", fields: ["BT-106", "BT-110", "BT-112"], severity: "warning" },
        ],
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

  it("highlights every field the failure involves, at its severity tier", async () => {
    // decision 0400: vat_arithmetic is a "warning" (the document's own
    // numbers disagree with each other, not a linked source of truth).
    stubFetch(FAILING);
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});

    for (const code of ["BT-106", "BT-110", "BT-112"]) {
      const box = document.getElementById(`f-${code}`)?.closest(".kf");
      expect(box?.classList.contains("warning"), code).toBe(true);
      expect(box?.classList.contains("danger"), code).toBe(false);
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
    expect(box?.classList.contains("warning")).toBe(false);
    expect(box?.classList.contains("danger")).toBe(false);
    expect(box?.classList.contains("ok")).toBe(false);
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

describe("three-tier severity on key fields (decision 0400)", () => {
  /**
   * Danger — a linked purchase order genuinely disagrees (checked
   * against a source of truth outside the document). Warning — the
   * document's own numbers disagree with each other. Ok — a check ran
   * against this field and it agreed. Precedence between them (a
   * `danger` always wins the field) is its own test below, since a
   * field only ever carries one tier at a time here.
   */
  const RESPONSE = (validation: Record<string, unknown>) => ({
    "/api/code-lists": { fields: {} },
    "/api/ui-strings": STRINGS,
    "/api/field-visibility": FIELDS,
    "/api/invoices/inv-1": {
      facts: { "BT-106": 100, "BT-110": 20, "BT-112": 120, "BT-13": "PO-1" },
      lines: [],
      validation,
    },
  });

  it("marks a po_mismatch failure as danger, not warning", async () => {
    stubFetch(
      RESPONSE({
        passed: false,
        checked: ["po_mismatch"],
        failures: ["po_mismatch"],
        involves: [{ check: "po_mismatch", fields: ["BT-13", "BT-112"], severity: "danger" }],
      })
    );
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});

    const box = document.getElementById("f-BT-112")?.closest(".kf");
    expect(box?.classList.contains("danger")).toBe(true);
    expect(box?.classList.contains("warning")).toBe(false);
    expect((box as HTMLElement).title).toBe("Does not match the purchase order");
  });

  it("marks a confirmed field ok, and adds a dot beside its label", async () => {
    stubFetch(
      RESPONSE({
        passed: true,
        checked: ["vat_arithmetic"],
        failures: [],
        confirms: [{ check: "vat_arithmetic", fields: ["BT-106", "BT-110", "BT-112"] }],
      })
    );
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});

    const box = document.getElementById("f-BT-112")?.closest(".kf") as HTMLElement;
    expect(box.classList.contains("ok")).toBe(true);
    expect(box.querySelector(".kf-dot")).not.toBeNull();
  });

  it("lets a danger failure win a field over a warning confirmation elsewhere on it", async () => {
    // BT-112 both fails po_mismatch (danger) and is merely confirmed
    // by vat_arithmetic (ok) — the field must end up danger, not ok,
    // regardless of which array the backend happened to list first.
    stubFetch(
      RESPONSE({
        passed: false,
        checked: ["vat_arithmetic", "po_mismatch"],
        failures: ["po_mismatch"],
        involves: [{ check: "po_mismatch", fields: ["BT-112"], severity: "danger" }],
        confirms: [{ check: "vat_arithmetic", fields: ["BT-106", "BT-110", "BT-112"] }],
      })
    );
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});

    const box = document.getElementById("f-BT-112")?.closest(".kf");
    expect(box?.classList.contains("danger")).toBe(true);
    expect(box?.classList.contains("ok")).toBe(false);
  });

  it("marks the named line field's own cell, not its neighbour", async () => {
    // A regression test for a pre-existing off-by-one in `markOne()`,
    // found while screenshotting this decision's own line-cell
    // highlighting: `lineRow()` lays a row out as
    // `[...lineFields.map(cell), removeButtonTd]` — no leading row-
    // counter column — so a field at `lineFields` position `index`
    // sits at `row.children[index]`. The prior code read
    // `row.children[index + 1]`, which mismarked the field after the
    // named one (or, for the last line field, the remove button's own
    // cell — invisible in CSS, since nothing targets it, but it did
    // hijack the button's tooltip).
    const twoLineFields = {
      fields: [
        ...FIELDS.fields,
        { field: "BT-129", visibility: "edit", type: "number", line: true, description: "quantity" },
      ],
    };
    stubFetch({
      "/api/code-lists": { fields: {} },
      "/api/ui-strings": STRINGS,
      "/api/field-visibility": twoLineFields,
      "/api/invoices/inv-1": {
        facts: {},
        lines: [{ lineNumber: 1, facts: { "BT-131": 60, "BT-129": 3 } }],
        validation: {
          passed: false,
          checked: ["line_sum"],
          failures: ["line_sum"],
          involves: [{ check: "line_sum", fields: ["BT-131"], line: 1, severity: "warning" }],
        },
      },
    });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});

    const row = document.querySelector("#lines tr") as HTMLElement;
    // BT-131 is lineFields position 0 — its own cell, not BT-129's.
    expect(row.children[0]?.classList.contains("warning")).toBe(true);
    expect(row.children[1]?.classList.contains("warning")).toBe(false);
    // And not the trailing remove-button cell.
    expect(row.children[2]?.querySelector(".rm")).not.toBeNull();
    expect(row.children[2]?.classList.contains("warning")).toBe(false);
  });

  it("re-reads confirms after a save, not only on first load", async () => {
    // The post-save handler has its own `confirms = ...` assignment,
    // separate from loadInvoice()'s — a field that just started
    // passing should not stay unmarked until the document is reopened.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = String(url).split("?")[0];
        const bodies: Record<string, unknown> = {
          "/api/ui-strings": STRINGS,
          "/api/code-lists": { fields: {} },
          "/api/field-visibility": FIELDS,
          "/api/invoices/inv-1": {
            facts: { "BT-106": 100, "BT-110": 20, "BT-112": 120 },
            lines: [],
            validation: { passed: true, checked: ["vat_arithmetic"], failures: [] },
          },
          "/api/invoices/inv-1/key": {
            facts: { "BT-106": 100, "BT-110": 20, "BT-112": 120 },
            lines: [],
            validation: {
              passed: true,
              checked: ["vat_arithmetic"],
              failures: [],
              confirms: [{ check: "vat_arithmetic", fields: ["BT-106", "BT-110", "BT-112"] }],
            },
          },
        };
        if (!(path in bodies)) throw new Error(`no stub for ${path} — add one, or the test proves nothing`);
        return { ok: true, json: async () => bodies[path] } as Response;
      })
    );
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});

    const saveButton = [...document.querySelectorAll(".actionlink")].find(
      (a) => a.querySelector("span")?.textContent === "Save"
    ) as HTMLButtonElement;
    saveButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const box = document.getElementById("f-BT-112")?.closest(".kf") as HTMLElement;
    expect(box.classList.contains("ok")).toBe(true);
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

  it("puts Save and the task's own actions in the topbar, beside Back (decision 0298)", async () => {
    /**
     * **The operator's own request**: "move Save, Complete, Release
     * and Return buttons to the top right of the page, next to the
     * Back button. This will free space below the document image."
     * Decision 0122's own placement — a row directly beneath the
     * document — is exactly what moved.
     */
    await openWith(["key", "complete"]);

    const topRight = document.querySelector(".topbar .right");
    const labels = [...(topRight?.querySelectorAll(".actionlink span") ?? [])].map((n) => n.textContent);
    expect(labels).toContain("Complete");
    expect(labels).toContain("Back");
    // The old stacked panel is gone.
    expect(document.querySelector(".panel.actions")).toBeNull();
    // Nothing left in a row beneath the document — that row is gone
    // entirely, not merely emptied.
    expect(document.querySelector(".vpreview + .actionrow")).toBeNull();
  });

  it("puts Expand top right of the document image, beside its own tabs, not in the topbar", async () => {
    // The operator's own request named where each set of buttons
    // should land — Save and the task's own actions in the topbar,
    // but Expand stays with the document it belongs to, just moved
    // from a footer row to the same row as the Document/Timeline tabs.
    await openWith(["key", "complete"]);

    const topRight = document.querySelector(".topbar .right");
    const topRightLabels = [...(topRight?.querySelectorAll(".actionlink span") ?? [])].map((n) => n.textContent);
    expect(topRightLabels).not.toContain("Expand");

    const doctabsHead = document.querySelector(".doctabs")?.closest(".cardhead");
    const expand = [...(doctabsHead?.querySelectorAll(".actionlink span") ?? [])].find(
      (n) => n.textContent === "Expand"
    );
    expect(expand).not.toBeUndefined();
  });

  it("gives every action an icon and a label", async () => {
    // An icon alone is a guess. The reference this came from labels
    // every one of its three.
    await openWith(["key", "complete", "release"]);
    for (const link of document.querySelectorAll(".actionlink")) {
      /**
       * **The language toggle's own exception** — decision 0302. It
       * carries a short-code badge rather than an SVG glyph, by the
       * operator's own request, since there is no shape for "this is
       * now in German." Every other action still needs a real icon.
       */
      const iconEl = link.querySelector("svg") ?? link.querySelector(".langbadge");
      expect(iconEl, link.textContent ?? "").not.toBeNull();
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

  it("labels the complete action 'Approve' for a Business Approver's task (decision 0471)", async () => {
    // Same action, same route (POST /tasks/:id/complete) — only the
    // label differs, read off the task's own requiredPermission rather
    // than guessed from the stage's name.
    stubFetch(OPEN);
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer({ ...TASK, actions: ["complete"], requiredPermission: "Procurement.Approve" }, () => {});

    const labels = [...document.querySelectorAll(".actionlink span")].map((n) => n.textContent);
    expect(labels).toContain("Approve");
    expect(labels).not.toContain("Complete");
  });

  it("keeps the generic 'Complete' label for every task that isn't a Business Approver's", async () => {
    await openWith(["complete"]);
    const labels = [...document.querySelectorAll(".actionlink span")].map((n) => n.textContent);
    expect(labels).toContain("Complete");
    expect(labels).not.toContain("Approve");
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

describe("the document pop-out window (decision 0384, phase 4)", () => {
  const ROUTES = {
    "/api/code-lists": { fields: {} },
    "/api/ui-strings": STRINGS,
    "/api/field-visibility": FIELDS,
    "/api/invoices/inv-1": {
      facts: {},
      lines: [],
      validation: { passed: true, checked: [], failures: [] },
    },
  };

  /** Real enough to stand in for `window.open`'s own return value. */
  function fakeWindow() {
    return { closed: false, focus: vi.fn(), close: vi.fn(), location: { href: "" } };
  }

  async function open(task: typeof TASK = TASK) {
    stubFetch(ROUTES);
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(task, () => {});
  }

  function clickExpand() {
    const doctabsHead = document.querySelector(".doctabs")?.closest(".cardhead");
    const expand = [...(doctabsHead?.querySelectorAll(".actionlink") ?? [])].find(
      (n) => n.querySelector("span")?.textContent === "Expand"
    );
    (expand as HTMLElement)?.click();
  }

  it("opens document-window.html with the invoice id, in a fixed-name window — not the raw file (decision 0384, retiring 0073's window.open)", async () => {
    const handle = fakeWindow();
    const openSpy = vi.fn(() => handle);
    vi.stubGlobal("open", openSpy);

    await open();
    clickExpand();

    expect(openSpy).toHaveBeenCalledTimes(1);
    const [url, name] = openSpy.mock.calls[0];
    expect(url).toBe("/document-window.html?task=inv-1");
    expect(name).toBe("vibefinance-document-window");
    expect(handle.focus).toHaveBeenCalled();
  });

  it("brings the same window forward instead of opening a second one, for the same invoice", async () => {
    /**
     * The operator's own answer, when this phase was scoped: *"there
     * should not be a situation where the user has multiple pop-out
     * windows open."* A fixed window name already makes the browser
     * enforce that on its own; this is `openDocumentWindow()`'s own
     * short-circuit doing the same thing without even asking it to.
     */
    const handle = fakeWindow();
    const openSpy = vi.fn(() => handle);
    vi.stubGlobal("open", openSpy);

    await open();
    clickExpand();
    clickExpand();

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(handle.focus).toHaveBeenCalledTimes(2);
  });

  it("shows a placeholder in the embedded card once the pop-out is open, giving up the tabs' own space", async () => {
    const handle = fakeWindow();
    vi.stubGlobal("open", vi.fn(() => handle));

    await open();
    clickExpand();

    const placeholder = document.querySelector(".vpoppedout") as HTMLElement;
    expect(placeholder.hidden).toBe(false);
    // Decision 0393 reworded this from "Open in a separate window" to
    // "Document open in a separate window" — the substring below is
    // what both wordings share, so this test still checks what it
    // always checked (some rendering of the placeholder's own text)
    // without also asserting the exact wording, which is the newer,
    // more specific test's job (decision 0393, below).
    expect(placeholder.textContent).toContain("open in a separate window");
    expect(document.getElementById("vpreview")?.parentElement?.hidden).toBe(true);
  });

  it("gives the embedded card its space back once the pop-out closes, via its own poll", async () => {
    vi.useFakeTimers();
    try {
      const handle = fakeWindow();
      vi.stubGlobal("open", vi.fn(() => handle));

      await open();
      clickExpand();

      // Nothing tells this side when the other window closes —
      // `.closed` is the only signal, and decision 0384's own comment
      // says it "only answers when asked." Flipping it here, then
      // advancing the poll's own interval, is that ask.
      handle.closed = true;
      await vi.advanceTimersByTimeAsync(700);

      const placeholder = document.querySelector(".vpoppedout") as HTMLElement;
      expect(placeholder.hidden).toBe(true);
      expect(document.getElementById("vpreview")?.parentElement?.hidden).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * **Seller, Buyer and Header reflow into one row — decision 0392.**
   * `#viewer .columns.docpoppedout` in `app.css` carries the actual
   * layout (untestable here — jsdom computes no grid), so what this
   * checks is the one thing `viewer.js` itself is responsible for:
   * the class that selects it appears and disappears with the same
   * open/close cycle the tests above already exercise, and disappears
   * again once the pop-out closes rather than getting stuck on.
   */
  it("toggles the reflow class on .columns with the same open/close cycle as the placeholder", async () => {
    vi.useFakeTimers();
    try {
      const handle = fakeWindow();
      vi.stubGlobal("open", vi.fn(() => handle));

      await open();
      const columns = document.querySelector(".columns") as HTMLElement;
      expect(columns.className).not.toContain("docpoppedout");

      clickExpand();
      expect(columns.className).toContain("docpoppedout");

      handle.closed = true;
      await vi.advanceTimersByTimeAsync(700);
      expect(columns.className).not.toContain("docpoppedout");
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * **`.c-process` can hold up to three panels, and each one used to
   * claim the whole row's height for itself — decision 0479.**
   * Reported live, against a screenshot: popped out, the "Here
   * because" and "Document open in a separate window" cards were much
   * too tall, and the process timeline visibly overlaid the row
   * beneath it. `app.css`'s own layout is untestable here (jsdom
   * computes no grid or flexbox), so what this checks is the actual
   * rule text: a banner panel keeps its own natural height, only the
   * last panel — `progressRow()`, whenever it renders — grows to fill
   * the rest, and `.c-header`'s own panel now stretches to match
   * `.c-parties` in either direction, not only the one first covered
   * by decision 0393.
   */
  it("shares .c-process's stretched height across however many panels it holds, rather than each one claiming it whole (decision 0479)", async () => {
    const css = (await import("virtual:stylesheets")).default["app.css"];
    const processRule = css.slice(
      css.indexOf("#viewer .columns.docpoppedout .c-process {"),
      css.indexOf("The notice itself, shrunk from a box built to fill the whole")
    );

    expect(processRule).toContain("display: flex");
    expect(processRule).toContain("flex-direction: column");
    expect(processRule).toMatch(/\.c-process > \.panel \{[^}]*flex: 0 0 auto/);
    expect(processRule).toMatch(/\.c-process > \.panel:last-child \{[^}]*flex: 1 1 auto/);
    expect(processRule).toContain("min-height: 0");
  });

  it("stretches the Invoice Header panel to match a taller Parties column, not only the other way around (decision 0479)", async () => {
    const css = (await import("virtual:stylesheets")).default["app.css"];

    expect(css).toContain("#viewer .columns.docpoppedout .c-header > .panel {\n    height: 100%;\n    box-sizing: border-box;\n  }");
  });

  it("retargets the already-open pop-out to a different task, rather than opening a second window — the operator's own answer", async () => {
    const handle = fakeWindow();
    vi.stubGlobal("open", vi.fn(() => handle));

    await open();
    clickExpand();

    const secondTask = { ...TASK, subject: { ...TASK.subject, id: "inv-2" } };
    stubFetch({ ...ROUTES, "/api/invoices/inv-2": ROUTES["/api/invoices/inv-1"] });
    const { openViewer } = await import("/viewer.js");
    await openViewer(secondTask, () => {});

    expect(handle.location.href).toBe("/document-window.html?task=inv-2");
    expect(window.open).toHaveBeenCalledTimes(1);
  });

  it("does not retarget a pop-out that is already showing the task being opened — no pointless reload", async () => {
    const handle = fakeWindow();
    vi.stubGlobal("open", vi.fn(() => handle));

    await open();
    clickExpand();
    handle.location.href = "/document-window.html?task=inv-1";

    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});

    expect(handle.location.href).toBe("/document-window.html?task=inv-1");
  });

  it("shows a message and does not crash when the browser blocks the pop-up — as a centred pop-out alert requiring OK, with the warning-toned severity icon (decisions 0492, 0493)", async () => {
    vi.stubGlobal("open", vi.fn(() => null));

    await open();
    clickExpand();

    const popout = document.querySelector(".popout.notealert");
    expect(popout).not.toBeNull();
    expect(document.getElementById("viewer-note")?.textContent).toContain(
      "Your browser blocked the pop-up window"
    );
    // Warning-toned, not the success (Save) styling — a blocked pop-up
    // is not good news.
    const iconBox = popout!.querySelector(".notealert-icon") as HTMLElement;
    expect(iconBox.className).not.toContain("success");

    // OK is the only way to dismiss it — clicking the backdrop itself
    // does nothing (unlike the reassign/return pickers, which do close
    // on an outside click).
    (document.querySelector(".backdrop") as HTMLElement).click();
    expect(document.querySelector(".popout")).not.toBeNull();

    const ok = document.querySelector(".notealert-ok") as HTMLButtonElement;
    ok.click();
    expect(document.querySelector(".popout")).toBeNull();
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

/**
 * **Four of this block's five tests retired alongside decision 0382,
 * not carried forward.** They drove `#vpreview iframe`'s own `load`
 * event by hand — exactly the frame `pageViewer()` (decision 0382)
 * replaced with a canvas that is never held open against a URL that
 * can go stale. There is no reload to watch, so there is nothing left
 * for those four to assert; the fifth, the XML tab's own frame, is
 * still real (`showXmlPreview()` was not touched) and stays.
 */
describe("a frame asks for a fresh link only when it loads again (decision 0380)", () => {
  /**
   * The five-minute signed URL (decision 0073). Measured in a real
   * Chromium, a frame whose link has expired goes on showing the
   * document through scrolling, zooming, hiding and switching tabs —
   * and shows `{"error":"document link expired"}` only when it loads a
   * second time. So the load event is the signal, and every test here
   * drives that event by hand, the way the browser would.
   *
   * **A custom fetch mock, not `stubFetch`**: each mint has to hand out
   * a different URL, and the query string (`type=original`) has to
   * survive being recorded.
   */
  function stubMinting(options: { xml?: boolean; secondMint?: string | null } = {}) {
    const minted: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = String(url).split("?")[0];
        if (path === "/api/invoices/inv-1/document-url") {
          minted.push(String(url));
          const n = minted.length;
          const value = n === 2 && "secondMint" in options ? options.secondMint : `https://files.example/signed-${n}`;
          return { ok: true, json: async () => ({ url: value }) } as Response;
        }
        const routes: Record<string, unknown> = {
          "/api/code-lists": { fields: {} },
          "/api/ui-strings": STRINGS,
          "/api/field-visibility": FIELDS,
          "/api/invoices/inv-1": {
            facts: {},
            lines: [],
            document: { contentType: "application/pdf", documentType: "generated_rendering" },
            ...(options.xml ? { originalDocument: { contentType: "application/xml" } } : {}),
            validation: { passed: true, checked: [], failures: [] },
          },
          "/api/invoices/inv-1/progress": { visits: [] },
          "/api/documents/inv-1/activity": { items: [] },
        };
        if (!(path in routes)) throw new Error(`no stub for ${path} — add one, or the test proves nothing`);
        return { ok: true, json: async () => routes[path] } as Response;
      })
    );
    return minted;
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  async function open(options: Parameters<typeof stubMinting>[0] = {}) {
    const minted = stubMinting(options);
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await settle();
    return minted;
  }

  /** The browser finishing a load of whatever the frame points at. */
  const loaded = async (frame: HTMLIFrameElement) => {
    frame.dispatchEvent(new Event("load"));
    await settle();
  };

  it("gives the XML tab's frame the same, asking for the original again", async () => {
    const minted = await open({ xml: true });
    const xmlFrame = document.querySelector("#vxml iframe") as HTMLIFrameElement;
    expect(xmlFrame).not.toBeNull();
    await loaded(xmlFrame);
    const before = minted.length;

    await loaded(xmlFrame);

    expect(minted).toHaveLength(before + 1);
    expect(minted[minted.length - 1]).toContain("type=original");
    expect(xmlFrame.getAttribute("src")).toBe(`https://files.example/signed-${before + 1}`);
  });
});

/**
 * **Two of this block's tests replaced, not carried forward, by
 * decision 0382.** They asserted `#vpreview iframe`/`#vpreview img`
 * directly — the split `pageViewer()` (`page-renderer.js`) replaced
 * with one canvas, image or PDF alike. The replacements below assert
 * the new shape; `page-renderer.test.ts` covers `pageViewer()` itself
 * in isolation (rotate, zoom, the thumbnail rail, which of the two
 * document shapes gets resolved), which this file does not repeat.
 */
describe("the document preview (decision 0123, canvas since 0382)", () => {
  /**
   * **We render it now, not the browser.** Decision 0042 records that
   * a *Worker* cannot render a PDF; decision 0382 is what stopped
   * relying on the browser's own viewer to do it client-side either.
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

  it("puts a PDF through the page renderer, not the browser's own viewer", async () => {
    await open("application/pdf");
    expect(document.querySelector("#vpreview .vpagesroot")).not.toBeNull();
    expect(document.querySelector("#vpreview canvas.vcanvas")).not.toBeNull();
    expect(document.querySelector("#vpreview iframe")).toBeNull();
  });

  it("puts an image through the same page renderer — one shape for both kinds now", async () => {
    // The whole point of decision 0382: an image is not a second,
    // differently-behaved case any more.
    await open("image/jpeg");
    expect(document.querySelector("#vpreview .vpagesroot")).not.toBeNull();
    expect(document.querySelector("#vpreview canvas.vcanvas")).not.toBeNull();
    expect(document.querySelector("#vpreview img")).toBeNull();
    expect(document.querySelector("#vpreview iframe")).toBeNull();
  });

  it("puts a generated rendering through an iframe, not the page renderer (decision 0406)", async () => {
    /**
     * **The gap decision 0405 uncovered.** `resolvePages()` only knows
     * `pdf` and "everything else is an image" — a `text/html`
     * `generated_rendering` fell into the image branch, tried to
     * decode HTML as a picture, and failed silently. Routed to the
     * same iframe `showXmlPreview()` already uses below instead.
     */
    await open("text/html; charset=utf-8");
    expect(document.querySelector("#vpreview iframe")).not.toBeNull();
    expect(document.querySelector("#vpreview .vpagesroot")).toBeNull();
    expect(document.querySelector("#vpreview canvas.vcanvas")).toBeNull();
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
    //
    // **No longer a `prompt()` — decision 0498** moved this action to
    // its own dedicated picker, the same shape Reassign, Return and
    // Route To Approver already use (see the describe block below for
    // its full coverage). This test still exists to pin the one fact
    // its name promises: the underscore in the action name becomes a
    // hyphen in the route it posts to.
    const posted: string[] = [];
    await openTaskWith(
      ["key", "return_to_supplier"],
      {
        "/api/return-reasons": { reasons: [{ id: "duplicate_invoice", label: "Duplicate invoice" }] },
        "/api/return-email-settings": { configured: false },
        "/api/tasks/t-1/return-to-supplier": {},
      },
      posted
    );

    click("To supplier");
    await settle();
    (document.querySelector(".popout .actionlink") as HTMLButtonElement).click();
    await settle();
    expect(posted).toContain("/api/tasks/t-1/return-to-supplier");
  });

  /**
   * **Discard moved off `window.prompt()` onto its own picker —
   * decision 0502.** Reported live: the native browser dialog read as
   * out of place next to every other action here, which had each
   * already been moved to a real `.backdrop`/`.popout` (Reassign,
   * Return, Route To Approver, Return To Supplier — decisions 0489,
   * 0490, 0495, 0498). `ACTIONS_NEEDING_A_REASON` is empty now; this
   * is the last of those to go.
   */
  it("opens a styled picker, not the native browser prompt", async () => {
    let asked = false;
    vi.stubGlobal("prompt", () => {
      asked = true;
      return "should never be called";
    });

    await openTaskWith(["key", "discard"], {});
    click("Discard");
    await settle();

    expect(asked).toBe(false);
    expect(document.querySelector(".backdrop .popout")).not.toBeNull();
    expect(document.querySelector(".popout .cardhead h3")?.textContent).toBe("Discard");
  });

  it("refuses an empty reason inline, without a round trip", async () => {
    // The server refuses one too (decision 0075) — caught here first
    // so the most common way to get this wrong costs no fetch at all.
    const posted: string[] = [];
    await openTaskWith(["key", "discard"], {}, posted);
    click("Discard");
    await settle();

    (document.querySelector(".popout .actionlink") as HTMLButtonElement).click();
    await settle();

    expect(posted.filter((p) => p.includes("/tasks/"))).toHaveLength(0);
    expect(document.querySelector(".popout .warn")?.hidden).toBe(false);
  });

  it("closes without posting anything on Close", async () => {
    const posted: string[] = [];
    await openTaskWith(["key", "discard"], {}, posted);
    click("Discard");
    await settle();

    const closeButton = [...document.querySelectorAll(".popout .actionlink")].find(
      (b) => b.querySelector("span")?.textContent === "Close"
    ) as HTMLButtonElement;
    closeButton.click();
    await settle();

    expect(posted.filter((p) => p.includes("/tasks/"))).toHaveLength(0);
    expect(document.querySelector(".backdrop")).toBeNull();
  });

  it("posts the typed reason to the discard route", async () => {
    const posted: string[] = [];
    await openTaskWith(["key", "discard"], { "/api/tasks/t-1/discard": {} }, posted);
    click("Discard");
    await settle();

    (document.querySelector(".popout textarea") as HTMLTextAreaElement).value = "Duplicate of inv-0";
    (document.querySelector(".popout .actionlink") as HTMLButtonElement).click();
    await settle();

    expect(posted).toContain("/api/tasks/t-1/discard");
    expect(document.querySelector(".backdrop")).toBeNull();
  });

  it("shows the server's own refusal inline, without closing the picker", async () => {
    // **Decision 0502's own stage restriction refuses server-side
    // too** (`handleDiscard`, `return-route.ts`) — this is what a
    // click looks like when the button was shown (a stale task list)
    // but the stage has since turned Discard off. `stubFetch`'s own
    // `routes` map always wraps a value as `ok: true`, so a failing
    // response is simulated by overriding `fetch` outright, the same
    // move the Return picker's own equivalent test makes.
    await openTaskWith(["key", "discard"], {});
    click("Discard");
    await settle();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = String(url).split("?")[0];
        if (path === "/api/tasks/t-1/discard") {
          return { ok: false, json: async () => ({ error: "discard is not available at this stage" }) } as Response;
        }
        throw new Error(`no stub for ${path} in the failure override`);
      })
    );

    (document.querySelector(".popout textarea") as HTMLTextAreaElement).value = "Duplicate";
    (document.querySelector(".popout .actionlink") as HTMLButtonElement).click();
    await settle();

    const errorBox = document.querySelector(".popout .warn") as HTMLElement;
    expect(errorBox.hidden).toBe(false);
    expect(errorBox.textContent).toBe("discard is not available at this stage");
    expect(document.querySelector(".backdrop")).not.toBeNull();
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

  describe("reassigning from the picker (decision 0489)", () => {
    /**
     * Its own dedicated pop-out, not the generic comment-and-OK/Cancel
     * modal (that is a later, separate decision in the agreed
     * sequence) — so it gets its own fetch stub, one that also
     * captures the POST body. `stubFetch` above only remembers which
     * paths were posted to, and the whole point here is checking what
     * `targetUserId` and `comment` the picker actually sent.
     */
    function stubReassign(
      routes: Record<string, unknown> = {},
      posted: string[] = [],
      bodies: { path: string; body: unknown }[] = []
    ) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
          const path = String(url).split("?")[0];
          if (init?.method === "POST") {
            posted.push(path);
            if (init.body) bodies.push({ path, body: JSON.parse(String(init.body)) });
          }
          const base: Record<string, unknown> = { ...OPEN, ...routes };
          if (path in base) return { ok: true, json: async () => base[path] } as Response;
          if (/^\/api\/invoices\/[^/]+\/pages$/.test(path)) {
            return { ok: true, json: async () => ({ pages: [] }) } as Response;
          }
          if (/^\/api\/documents\/[^/]+\/collaborators$/.test(path)) {
            return { ok: true, json: async () => ({ collaborators: [] }) } as Response;
          }
          throw new Error(`no stub for ${path} — add one, or the test proves nothing`);
        })
      );
    }

    async function openWithReassign(
      routes: Record<string, unknown> = {},
      posted: string[] = [],
      bodies: { path: string; body: unknown }[] = []
    ) {
      stubReassign(routes, posted, bodies);
      const { loadStrings } = await import("/strings.js");
      await loadStrings();
      const { openViewer } = await import("/viewer.js");
      await openViewer({ ...TASK, actions: ["key", "complete", "reassign"] }, () => {});
      await new Promise((r) => setTimeout(r, 0));
    }

    const CANDIDATES = {
      candidates: [
        { id: "u-2", name: "Priya Shah", email: "priya@example.com" },
        { id: "u-3", name: "Sam Okafor", email: null },
      ],
    };

    it("lists the server's own candidates, not a client guess", async () => {
      // `handleReassignCandidates` computes exactly who the POST would
      // accept; the picker just renders what it's given.
      await openWithReassign({ "/api/tasks/t-1/reassign-candidates": CANDIDATES });
      click("Reassign");
      await settle();

      const popout = document.querySelector(".popout");
      expect(popout).not.toBeNull();
      const options = [...popout!.querySelectorAll("select option")].map((o) => o.textContent);
      expect(options).toEqual(["Priya Shah (priya@example.com)", "Sam Okafor"]);
    });

    it("says so with a pop-out alert instead of opening an empty picker when nobody is eligible (decisions 0492/0493)", async () => {
      // **Reported live**: clicking Reassign on a task claimed by the
      // caller "did nothing." The message was always here — 0491 found
      // it was set correctly but scrolled off-screen, and fixed that by
      // scrolling it into view. Decision 0492 replaced that with a
      // pop-out alert; decision 0493 reworded the message itself,
      // reported live as "unhelpful" against the original "Nobody else
      // on this team can take this task."
      await openWithReassign({ "/api/tasks/t-1/reassign-candidates": { candidates: [] } });

      click("Reassign");
      await settle();

      // Not the reassign picker itself — the picker never opens when
      // there is nobody to reassign to — but a `.popout.notealert` all
      // the same, this one carrying the alert.
      const popout = document.querySelector(".popout.notealert");
      expect(popout).not.toBeNull();
      expect(document.getElementById("viewer-note")?.textContent).toBe(
        "There are no eligible users to reassign."
      );

      // OK is the only way to dismiss it.
      (popout!.querySelector(".notealert-ok") as HTMLButtonElement).click();
      expect(document.querySelector(".popout")).toBeNull();
    });

    it("posts the chosen target and comment, and closes the picker on success", async () => {
      const posted: string[] = [];
      const bodies: { path: string; body: unknown }[] = [];
      await openWithReassign(
        { "/api/tasks/t-1/reassign-candidates": CANDIDATES, "/api/tasks/t-1/reassign": {} },
        posted,
        bodies
      );
      click("Reassign");
      await settle();

      (document.querySelector(".popout select") as HTMLSelectElement).value = "u-3";
      (document.querySelector(".popout textarea") as HTMLTextAreaElement).value = "Out of office this week";
      (document.querySelector(".popout .actionlink") as HTMLButtonElement).click();
      await settle();

      expect(posted).toContain("/api/tasks/t-1/reassign");
      expect(bodies).toContainEqual({
        path: "/api/tasks/t-1/reassign",
        body: { targetUserId: "u-3", comment: "Out of office this week" },
      });
      // Handed to somebody else — the same "nothing left to show" close
      // every other action already takes at the end of runAction().
      expect(document.querySelector(".popout")).toBeNull();
    });

    it("sends no comment field when none was typed, not an empty string", async () => {
      const posted: string[] = [];
      const bodies: { path: string; body: unknown }[] = [];
      await openWithReassign(
        { "/api/tasks/t-1/reassign-candidates": CANDIDATES, "/api/tasks/t-1/reassign": {} },
        posted,
        bodies
      );
      click("Reassign");
      await settle();

      // Default target (first option), comment left blank.
      (document.querySelector(".popout .actionlink") as HTMLButtonElement).click();
      await settle();

      expect(bodies[0]?.body).toEqual({ targetUserId: "u-2" });
      expect(bodies[0]?.body).not.toHaveProperty("comment");
    });

    it("shows the server's error and leaves the picker open to try again", async () => {
      await openWithReassign({ "/api/tasks/t-1/reassign-candidates": CANDIDATES });
      click("Reassign");
      await settle();

      // Override just the POST route to fail, since the stub above
      // returns ok:true for anything listed — a second stubGlobal call
      // replaces the mock outright for this one test, the same move
      // the supplier-search "shows a save error inline" test above
      // makes for /api/suppliers.
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          const path = String(url).split("?")[0];
          if (path === "/api/tasks/t-1/reassign") {
            return { ok: false, json: async () => ({ error: "no longer yours to reassign" }) } as Response;
          }
          throw new Error(`no stub for ${path} in the failure override`);
        })
      );

      (document.querySelector(".popout .actionlink") as HTMLButtonElement).click();
      await settle();

      const errorBox = document.querySelector(".popout .warn") as HTMLElement;
      expect(errorBox.hidden).toBe(false);
      expect(errorBox.textContent).toBe("no longer yours to reassign");
      // Still open — a failure is something to fix, not to start over from.
      expect(document.querySelector(".popout")).not.toBeNull();
    });
  });

  /**
   * **Returning from the picker (decision 0490).** The same dedicated-
   * picker shape `reassigning from the picker` above already
   * established — its own stub that captures POST bodies, since the
   * whole point is what `stageId`/`assignToTeam`/`reason` the picker
   * actually sends.
   *
   * **This is what first made Return reachable at all**: `POST /tasks/
   * :id/return` has required a `stageId` plus exactly one of
   * `assignToUser`/`assignToTeam` since decision 0075, but nothing
   * before this decision ever collected either — every Return click
   * 400'd. Unlike Reassign's optional comment, the reason here is
   * mandatory (decision 0075's own rule); rather than duplicate that
   * validation client-side, the picker just lets the POST fail and
   * shows the server's own message — covered below by leaving the
   * reason blank and asserting on the server's own 400 text.
   */
  describe("returning from the picker (decision 0490)", () => {
    function stubReturn(
      routes: Record<string, unknown> = {},
      posted: string[] = [],
      bodies: { path: string; body: unknown }[] = []
    ) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
          const path = String(url).split("?")[0];
          if (init?.method === "POST") {
            posted.push(path);
            if (init.body) bodies.push({ path, body: JSON.parse(String(init.body)) });
          }
          const base: Record<string, unknown> = { ...OPEN, ...routes };
          if (path in base) return { ok: true, json: async () => base[path] } as Response;
          if (/^\/api\/invoices\/[^/]+\/pages$/.test(path)) {
            return { ok: true, json: async () => ({ pages: [] }) } as Response;
          }
          if (/^\/api\/documents\/[^/]+\/collaborators$/.test(path)) {
            return { ok: true, json: async () => ({ collaborators: [] }) } as Response;
          }
          throw new Error(`no stub for ${path} — add one, or the test proves nothing`);
        })
      );
    }

    async function openWithReturn(
      routes: Record<string, unknown> = {},
      posted: string[] = [],
      bodies: { path: string; body: unknown }[] = []
    ) {
      stubReturn(routes, posted, bodies);
      const { loadStrings } = await import("/strings.js");
      await loadStrings();
      const { openViewer } = await import("/viewer.js");
      await openViewer({ ...TASK, actions: ["key", "complete", "return"] }, () => {});
      await new Promise((r) => setTimeout(r, 0));
    }

    const TARGETS = {
      targets: [
        { stageId: "coding", stageName: "Coding", teamId: "team-coding", teamName: "Coding team" },
        { stageId: "matching", stageName: "Matching", teamId: "team-matching", teamName: "Matching team" },
      ],
    };

    it("lists the server's own targets, not a client guess", async () => {
      // `handleReturnTargets` computes exactly the intersection the
      // POST would actually accept; the picker just renders what it's
      // given, the same as `openReassignPicker`'s own candidates.
      await openWithReturn({ "/api/tasks/t-1/return-targets": TARGETS });
      click("Return");
      await settle();

      const popout = document.querySelector(".popout");
      expect(popout).not.toBeNull();
      const options = [...popout!.querySelectorAll("select option")].map((o) => o.textContent);
      expect(options).toEqual(["Coding — Coding team", "Matching — Matching team"]);
    });

    it("says so with a pop-out alert instead of opening an empty picker when no target is configured (decision 0492)", async () => {
      // Same fix as Reassign's own equivalent test above, for the same
      // shared `note()` — Return's own "nothing configured" message goes
      // through the same pop-out alert. Its own wording is unchanged by
      // decision 0493, which reworded Reassign's message only.
      await openWithReturn({ "/api/tasks/t-1/return-targets": { targets: [] } });

      click("Return");
      await settle();

      const popout = document.querySelector(".popout.notealert");
      expect(popout).not.toBeNull();
      expect(document.getElementById("viewer-note")?.textContent).toBe(
        "No return targets are configured for this stage."
      );

      (popout!.querySelector(".notealert-ok") as HTMLButtonElement).click();
      expect(document.querySelector(".popout")).toBeNull();
    });

    it("posts the chosen stage, its team, and the reason, and closes the picker on success", async () => {
      const posted: string[] = [];
      const bodies: { path: string; body: unknown }[] = [];
      await openWithReturn(
        { "/api/tasks/t-1/return-targets": TARGETS, "/api/tasks/t-1/return": {} },
        posted,
        bodies
      );
      click("Return");
      await settle();

      (document.querySelector(".popout select") as HTMLSelectElement).value = "matching";
      (document.querySelector(".popout textarea") as HTMLTextAreaElement).value = "GL code is wrong";
      (document.querySelector(".popout .actionlink") as HTMLButtonElement).click();
      await settle();

      expect(posted).toContain("/api/tasks/t-1/return");
      expect(bodies).toContainEqual({
        path: "/api/tasks/t-1/return",
        body: { stageId: "matching", assignToTeam: "team-matching", reason: "GL code is wrong" },
      });
      // Handed to another stage entirely — the same "nothing left to
      // show" close every other action already takes at the end of
      // runAction().
      expect(document.querySelector(".popout")).toBeNull();
    });

    it("leaves the picker open and shows the server's own validation error when the reason is blank", async () => {
      // No client-side check duplicates decision 0075's own rule — the
      // picker sends whatever is typed, including nothing (the reason
      // box is left untouched here), and shows exactly what the server
      // says back. The failure comes from a second `stubGlobal` override
      // (`stubReturn`'s own `routes` map always wraps its values as
      // `ok: true`, the same shape `stubReassign` above uses, so a
      // failing response is only ever simulated by replacing `fetch`
      // outright — see the next test).
      await openWithReturn({ "/api/tasks/t-1/return-targets": TARGETS });
      click("Return");
      await settle();

      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          const path = String(url).split("?")[0];
          if (path === "/api/tasks/t-1/return") {
            return { ok: false, json: async () => ({ error: "a reason is required" }) } as Response;
          }
          throw new Error(`no stub for ${path} in the failure override`);
        })
      );

      (document.querySelector(".popout .actionlink") as HTMLButtonElement).click();
      await settle();

      const errorBox = document.querySelector(".popout .warn") as HTMLElement;
      expect(errorBox.hidden).toBe(false);
      expect(errorBox.textContent).toBe("a reason is required");
      expect(document.querySelector(".popout")).not.toBeNull();
    });

    it("shows the server's error and leaves the picker open to try again", async () => {
      await openWithReturn({ "/api/tasks/t-1/return-targets": TARGETS });
      click("Return");
      await settle();

      // Override just the POST route to fail, the same move
      // `openWithReassign`'s own equivalent test makes.
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          const path = String(url).split("?")[0];
          if (path === "/api/tasks/t-1/return") {
            return { ok: false, json: async () => ({ error: "that stage is no longer part of this process" }) } as Response;
          }
          throw new Error(`no stub for ${path} in the failure override`);
        })
      );

      (document.querySelector(".popout textarea") as HTMLTextAreaElement).value = "Wrong GL code";
      (document.querySelector(".popout .actionlink") as HTMLButtonElement).click();
      await settle();

      const errorBox = document.querySelector(".popout .warn") as HTMLElement;
      expect(errorBox.hidden).toBe(false);
      expect(errorBox.textContent).toBe("that stage is no longer part of this process");
      expect(document.querySelector(".popout")).not.toBeNull();
    });
  });

  describe("routing to an approver from the picker (decision 0495)", () => {
    /**
     * Its own dedicated pop-out, the same shape Reassign's and
     * Return's own already established. Unlike either of those, there
     * is no separate action route to capture a POST body for — picking
     * a name here posts straight to `/complete`, so this stub only
     * needs to remember what body that specific POST carried.
     */
    function stubRouteToApprover(
      routes: Record<string, unknown> = {},
      posted: string[] = [],
      bodies: { path: string; body: unknown }[] = []
    ) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
          const path = String(url).split("?")[0];
          if (init?.method === "POST") {
            posted.push(path);
            if (init.body) bodies.push({ path, body: JSON.parse(String(init.body)) });
          }
          const base: Record<string, unknown> = { ...OPEN, ...routes };
          if (path in base) return { ok: true, json: async () => base[path] } as Response;
          if (/^\/api\/invoices\/[^/]+\/pages$/.test(path)) {
            return { ok: true, json: async () => ({ pages: [] }) } as Response;
          }
          if (/^\/api\/documents\/[^/]+\/collaborators$/.test(path)) {
            return { ok: true, json: async () => ({ collaborators: [] }) } as Response;
          }
          throw new Error(`no stub for ${path} — add one, or the test proves nothing`);
        })
      );
    }

    async function openWithRouteToApprover(
      routes: Record<string, unknown> = {},
      posted: string[] = [],
      bodies: { path: string; body: unknown }[] = []
    ) {
      stubRouteToApprover(routes, posted, bodies);
      const { loadStrings } = await import("/strings.js");
      await loadStrings();
      const { openViewer } = await import("/viewer.js");
      // The server offers this INSTEAD of "complete" — decision 0495's
      // own actionsFor gate — so the fixture reflects that, not both.
      await openViewer({ ...TASK, actions: ["key", "route_to_approver"] }, () => {});
      await new Promise((r) => setTimeout(r, 0));
    }

    const CANDIDATES = {
      candidates: [
        { id: "u-2", name: "Priya Shah", email: "priya@example.com" },
        { id: "u-3", name: "Sam Okafor", email: null },
      ],
    };

    it("lists the server's own candidates, not a client guess", async () => {
      await openWithRouteToApprover({ "/api/tasks/t-1/route-to-approver-candidates": CANDIDATES });
      click("Route To Approver");
      await settle();

      const popout = document.querySelector(".popout");
      expect(popout).not.toBeNull();
      const options = [...popout!.querySelectorAll("select option")].map((o) => o.textContent);
      expect(options).toEqual(["Priya Shah (priya@example.com)", "Sam Okafor"]);
    });

    it("says so with a pop-out alert instead of opening an empty picker when nobody is eligible", async () => {
      await openWithRouteToApprover({ "/api/tasks/t-1/route-to-approver-candidates": { candidates: [] } });
      click("Route To Approver");
      await settle();

      const popout = document.querySelector(".popout.notealert");
      expect(popout).not.toBeNull();
      expect(document.getElementById("viewer-note")?.textContent).toBe(
        "Nobody is set up to approve this yet."
      );

      (popout!.querySelector(".notealert-ok") as HTMLButtonElement).click();
      expect(document.querySelector(".popout")).toBeNull();
    });

    it("posts the chosen target to /complete, not a separate route, and closes the picker on success", async () => {
      const posted: string[] = [];
      const bodies: { path: string; body: unknown }[] = [];
      await openWithRouteToApprover(
        { "/api/tasks/t-1/route-to-approver-candidates": CANDIDATES, "/api/tasks/t-1/complete": {} },
        posted,
        bodies
      );
      click("Route To Approver");
      await settle();

      (document.querySelector(".popout select") as HTMLSelectElement).value = "u-3";
      (document.querySelector(".popout .actionlink") as HTMLButtonElement).click();
      await settle();

      expect(posted).toContain("/api/tasks/t-1/complete");
      expect(bodies).toContainEqual({ path: "/api/tasks/t-1/complete", body: { targetUserId: "u-3" } });
      // Completed and routed on — the same "nothing left to show"
      // close every other action already takes at the end of
      // runAction().
      expect(document.querySelector(".popout")).toBeNull();
    });

    /**
     * **An optional comment, decision 0497** — asked for directly:
     * "add an optional comment box to the Route To Approver box,
     * similar to the Reassign box." Replaces the earlier "carries no
     * comment field at all" test, which checked the exact opposite
     * fact on purpose (`handleCompleteTask` accepted no comment at
     * all until this decision gave it somewhere to go — see
     * `handleCompleteTask`'s own comment in `task-route.ts`). The two
     * tests below mirror Reassign's own pair immediately above.
     */
    it("posts the chosen target and comment, and closes the picker on success", async () => {
      const posted: string[] = [];
      const bodies: { path: string; body: unknown }[] = [];
      await openWithRouteToApprover(
        { "/api/tasks/t-1/route-to-approver-candidates": CANDIDATES, "/api/tasks/t-1/complete": {} },
        posted,
        bodies
      );
      click("Route To Approver");
      await settle();

      (document.querySelector(".popout select") as HTMLSelectElement).value = "u-3";
      (document.querySelector(".popout textarea") as HTMLTextAreaElement).value = "Please check the VAT rate.";
      (document.querySelector(".popout .actionlink") as HTMLButtonElement).click();
      await settle();

      expect(posted).toContain("/api/tasks/t-1/complete");
      expect(bodies).toContainEqual({
        path: "/api/tasks/t-1/complete",
        body: { targetUserId: "u-3", comment: "Please check the VAT rate." },
      });
      // Completed and routed on — the same "nothing left to show"
      // close every other action already takes at the end of
      // runAction().
      expect(document.querySelector(".popout")).toBeNull();
    });

    it("sends no comment field when none was typed, not an empty string", async () => {
      const posted: string[] = [];
      const bodies: { path: string; body: unknown }[] = [];
      await openWithRouteToApprover(
        { "/api/tasks/t-1/route-to-approver-candidates": CANDIDATES, "/api/tasks/t-1/complete": {} },
        posted,
        bodies
      );
      click("Route To Approver");
      await settle();

      // Default target (first option), comment left blank.
      (document.querySelector(".popout .actionlink") as HTMLButtonElement).click();
      await settle();

      expect(bodies[0]?.body).toEqual({ targetUserId: "u-2" });
      expect(bodies[0]?.body).not.toHaveProperty("comment");
    });

    it("shows the server's error and leaves the picker open to try again", async () => {
      await openWithRouteToApprover({ "/api/tasks/t-1/route-to-approver-candidates": CANDIDATES });
      click("Route To Approver");
      await settle();

      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          const path = String(url).split("?")[0];
          if (path === "/api/tasks/t-1/complete") {
            return { ok: false, json: async () => ({ error: "task is already completed" }) } as Response;
          }
          throw new Error(`no stub for ${path} in the failure override`);
        })
      );

      (document.querySelector(".popout .actionlink") as HTMLButtonElement).click();
      await settle();

      const errorBox = document.querySelector(".popout .warn") as HTMLElement;
      expect(errorBox.hidden).toBe(false);
      expect(errorBox.textContent).toBe("task is already completed");
      expect(document.querySelector(".popout")).not.toBeNull();
    });
  });

  describe("returning to the supplier from the picker (decision 0498)", () => {
    /**
     * Its own dedicated pop-out, the same shape Reassign, Return and
     * Route To Approver already established: reasons instead of
     * candidates, a comment for the supplier's own eyes, the address
     * it will actually go to (read from `stored.supplier`, no new
     * fetch), and — only when an AP team address is configured at
     * all — a checkbox to copy it in.
     */
    const REASONS = {
      reasons: [
        { id: "duplicate_invoice", label: "Duplicate invoice" },
        { id: "goods_not_received", label: "Goods or services not received" },
      ],
    };

    function stubReturnToSupplier(
      routes: Record<string, unknown> = {},
      posted: string[] = [],
      bodies: { path: string; body: unknown }[] = []
    ) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
          const path = String(url).split("?")[0];
          if (init?.method === "POST") {
            posted.push(path);
            if (init.body) bodies.push({ path, body: JSON.parse(String(init.body)) });
          }
          const base: Record<string, unknown> = {
            ...OPEN,
            "/api/return-reasons": REASONS,
            "/api/return-email-settings": { configured: false },
            ...routes,
          };
          if (path in base) return { ok: true, json: async () => base[path] } as Response;
          if (/^\/api\/invoices\/[^/]+\/pages$/.test(path)) {
            return { ok: true, json: async () => ({ pages: [] }) } as Response;
          }
          if (/^\/api\/documents\/[^/]+\/collaborators$/.test(path)) {
            return { ok: true, json: async () => ({ collaborators: [] }) } as Response;
          }
          throw new Error(`no stub for ${path} — add one, or the test proves nothing`);
        })
      );
    }

    async function openWithReturnToSupplier(
      routes: Record<string, unknown> = {},
      posted: string[] = [],
      bodies: { path: string; body: unknown }[] = []
    ) {
      stubReturnToSupplier(routes, posted, bodies);
      const { loadStrings } = await import("/strings.js");
      await loadStrings();
      const { openViewer } = await import("/viewer.js");
      await openViewer({ ...TASK, actions: ["key", "return_to_supplier"] }, () => {});
      await new Promise((r) => setTimeout(r, 0));
    }

    it("lists the server's own reasons, not a client guess", async () => {
      await openWithReturnToSupplier();
      click("To supplier");
      await settle();

      const popout = document.querySelector(".popout");
      expect(popout).not.toBeNull();
      const options = [...popout!.querySelectorAll("select option")].map((o) => o.textContent);
      expect(options).toEqual(["Duplicate invoice", "Goods or services not received"]);
    });

    it("says so with a pop-out alert instead of opening an empty picker when no reasons are configured", async () => {
      await openWithReturnToSupplier({ "/api/return-reasons": { reasons: [] } });
      click("To supplier");
      await settle();

      const popout = document.querySelector(".popout.notealert");
      expect(popout).not.toBeNull();
      expect(document.getElementById("viewer-note")?.textContent).toBe(
        "There are no return reasons configured."
      );

      (popout!.querySelector(".notealert-ok") as HTMLButtonElement).click();
      expect(document.querySelector(".popout")).toBeNull();
    });

    it("shows the supplier's own email as the address this will go to", async () => {
      await openWithReturnToSupplier({
        "/api/invoices/inv-1": {
          facts: {},
          lines: [],
          validation: { passed: true, checked: [], failures: [] },
          supplier: { name: "Acme Payments", email: "payments@acme.example" },
        },
      });
      click("To supplier");
      await settle();

      expect(document.querySelector(".popout")?.textContent).toContain(
        "This will be emailed to payments@acme.example"
      );
    });

    it("says so when the supplier has no email on file, rather than hiding the line", async () => {
      await openWithReturnToSupplier();
      click("To supplier");
      await settle();

      expect(document.querySelector(".popout")?.textContent).toContain(
        "No email address on file for this supplier."
      );
    });

    it("offers no AP-team checkbox when no AP team address is configured", async () => {
      await openWithReturnToSupplier({ "/api/return-email-settings": { configured: false } });
      click("To supplier");
      await settle();

      expect(document.querySelector(".popout")?.textContent).not.toContain("Copy our AP team");
      expect(document.querySelector(".popout input[type=checkbox]")).toBeNull();
    });

    it("offers the AP-team checkbox once an address is configured", async () => {
      await openWithReturnToSupplier({ "/api/return-email-settings": { configured: true } });
      click("To supplier");
      await settle();

      expect(document.querySelector(".popout")?.textContent).toContain("Copy our AP team");
      expect(document.querySelector(".popout input[type=checkbox]")).not.toBeNull();
    });

    it("posts the chosen reason, comment and CC flag, and closes the picker on success", async () => {
      const posted: string[] = [];
      const bodies: { path: string; body: unknown }[] = [];
      await openWithReturnToSupplier(
        { "/api/return-email-settings": { configured: true }, "/api/tasks/t-1/return-to-supplier": {} },
        posted,
        bodies
      );
      click("To supplier");
      await settle();

      (document.querySelector(".popout select") as HTMLSelectElement).value = "goods_not_received";
      (document.querySelector(".popout textarea") as HTMLTextAreaElement).value = "Nothing arrived on our dock.";
      (document.querySelector(".popout input[type=checkbox]") as HTMLInputElement).click();
      (document.querySelector(".popout .actionlink") as HTMLButtonElement).click();
      await settle();

      expect(posted).toContain("/api/tasks/t-1/return-to-supplier");
      expect(bodies).toContainEqual({
        path: "/api/tasks/t-1/return-to-supplier",
        body: { reasonId: "goods_not_received", comment: "Nothing arrived on our dock.", ccApTeam: true },
      });
      // The instance has ended — nothing left to show, the same
      // "finished or moved" close every other action already takes at
      // the end of runAction() above.
      expect(document.querySelector(".popout")).toBeNull();
    });

    it("sends no comment field when none was typed, not an empty string", async () => {
      const posted: string[] = [];
      const bodies: { path: string; body: unknown }[] = [];
      await openWithReturnToSupplier({ "/api/tasks/t-1/return-to-supplier": {} }, posted, bodies);
      click("To supplier");
      await settle();

      // Default reason (first option), comment left blank, no AP team
      // checkbox at all (not configured by default).
      (document.querySelector(".popout .actionlink") as HTMLButtonElement).click();
      await settle();

      expect(bodies[0]?.body).toEqual({ reasonId: "duplicate_invoice" });
      expect(bodies[0]?.body).not.toHaveProperty("comment");
      expect(bodies[0]?.body).not.toHaveProperty("ccApTeam");
    });

    it("shows the server's error and leaves the picker open to try again", async () => {
      await openWithReturnToSupplier();
      click("To supplier");
      await settle();

      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          const path = String(url).split("?")[0];
          if (path === "/api/tasks/t-1/return-to-supplier") {
            return { ok: false, json: async () => ({ error: "reason is no longer active" }) } as Response;
          }
          throw new Error(`no stub for ${path} in the failure override`);
        })
      );

      (document.querySelector(".popout .actionlink") as HTMLButtonElement).click();
      await settle();

      const errorBox = document.querySelector(".popout .warn") as HTMLElement;
      expect(errorBox.hidden).toBe(false);
      expect(errorBox.textContent).toBe("reason is no longer active");
      expect(document.querySelector(".popout")).not.toBeNull();
    });
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

  it("names the document by its reference, not the stage (decision 0312)", async () => {
    /**
     * **Reported live**: "we state the 'Stage: <stage name>'... this
     * information is duplicated, because it is highlighted in the
     * Process flow." The heading now names the document instead; the
     * Process flow's own chevrons already carry the stage's own name.
     */
    await openApproval();
    expect(document.querySelector(".topbar h2")?.textContent).toBe("Unique Ref: inv-1");
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

  it("stays read-only for an unclaimed task even when the stage permits editing (decision 0288)", async () => {
    /**
     * **The operator's own question, answered**: "a document can be
     * opened in read-only mode, when it is not claimed, however in
     * order to act on the document in Edit mode, it must be claimed."
     *
     * Before this, field visibility was the *only* thing gating
     * `canEditAnything` — an editable stage was editable for anyone who
     * could open the task at all, unclaimed included. This is the
     * regression test for the actual gap: an "available" task, on a
     * stage whose own field visibility permits editing, must still
     * render read-only.
     */
    stubFetch({ ...OPEN, "/api/field-visibility": FIELDS });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer({ ...TASK, ownership: "available", actions: ["claim"] }, () => {});
    await new Promise((r) => setTimeout(r, 0));

    const labels = [...document.querySelectorAll(".actionlink span")].map((n) => n.textContent);
    expect(labels).not.toContain("Save");
    expect(document.getElementById("f-BT-112")?.tagName).toBe("DIV");
    expect(document.querySelector("#f-BT-112 input")).toBeNull();
  });

  it("keeps line items read-only for an unclaimed task too (decision 0402)", async () => {
    /**
     * **The gap the operator's own report surfaced.** The test above
     * already covers the header; this is the line table's own
     * regression test. `cell()` (in `lineRow()`) checked only the
     * field's own visibility and never `canEditAnything`, so an
     * unclaimed task rendered its header correctly as read-only text
     * while its line items stayed real, editable inputs — a Save
     * button was gone, but a line amount could still be typed into.
     */
    stubFetch({
      ...OPEN,
      "/api/field-visibility": FIELDS,
      "/api/invoices/inv-1": {
        facts: { "BT-112": 1200 },
        lines: [{ lineNumber: 1, facts: { "BT-131": 60 } }],
        validation: { passed: true, checked: [], failures: [] },
      },
    });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer({ ...TASK, ownership: "available", actions: ["claim"] }, () => {});
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelector(".linetable input")).toBeNull();
    expect(document.querySelector(".linetable .readonly")).not.toBeNull();
  });

  it("stays read-only for a task someone else has already claimed", async () => {
    stubFetch({ ...OPEN, "/api/field-visibility": FIELDS });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer({ ...TASK, ownership: "locked", actions: [] }, () => {});
    await new Promise((r) => setTimeout(r, 0));

    const labels = [...document.querySelectorAll(".actionlink span")].map((n) => n.textContent);
    expect(labels).not.toContain("Save");
  });

  it("still offers Claim from within the read-only view of an unclaimed task", async () => {
    // The one thing an unclaimed task's own read-only view has to
    // offer — otherwise a person who opened it to look has no way to
    // take it without closing the viewer and finding the row again.
    stubFetch({ ...OPEN, "/api/field-visibility": FIELDS });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer({ ...TASK, ownership: "available", actions: ["claim"] }, () => {});
    await new Promise((r) => setTimeout(r, 0));

    const labels = [...document.querySelectorAll(".actionlink span")].map((n) => n.textContent);
    expect(labels).toContain("Claim");
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
        // **Owned, not locked** — decision 0180. A claim says somebody
        // is working on it now; ownership says whose it is.
        ownedBy: { id: "u-alice", name: "Alice", email: "alice@acme.com" },
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

  it("labels the heading, so a bare id is not ambiguous (decision 0312)", async () => {
    // The heading used to read "Stage: X"; decision 0175's own
    // reasoning — a bare word could be anything — still applies to
    // what replaced it: "inv-1" alone could be any kind of thing,
    // "Unique Ref: inv-1" says what it is.
    await openOwned();
    expect(document.querySelector(".topbar h2")?.textContent).toContain("Unique Ref:");
  });

  it("no longer renders an empty subtitle line beneath it, decision 0312", async () => {
    // The reference used to sit in a separate .sub paragraph beneath
    // the heading; now that it's the heading itself, that paragraph
    // has nothing left to say — topbar() omits it rather than
    // rendering an empty line (decision 0312's own change to topbar()
    // itself, in tasks.js).
    await openOwned();
    expect(document.querySelector(".topbar .sub")).toBeNull();
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
    await openWith({ createdAt: "2026-09-01 09:00:00", ownedBy: undefined });
    expect(document.querySelector(".subhead")?.textContent).toContain("Nobody yet");
  });

  it("names the owner where there is one", async () => {
    await openWith({
      createdAt: "2026-09-01 09:00:00",
      ownedBy: { id: "u-a", name: "Alice", email: "alice@acme.com" },
    });
    expect(document.querySelector(".subhead")?.textContent).toContain("alice@acme.com");
  });

  it("says nothing about ownership on a document with no stage", async () => {
    // A document opened from the manager is not work (decision 0167).
    await openWith({ createdAt: undefined, stageId: null, ownedBy: undefined });
    expect(document.querySelector(".subhead")?.textContent).not.toContain("Owner");
  });
});

describe("the screen asks for the document's unit (decision 0198)", () => {
  /**
   * **The invoice loads before the fields**, because its unit decides
   * which are editable (decision 0197). They were the other way round,
   * because until then nothing about the document affected which fields
   * it offered.
   */
  it("passes the unit to field visibility", async () => {
    const asked: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        asked.push(String(url));
        const path = String(url).split("?")[0];
        const bodies: Record<string, unknown> = {
          "/api/ui-strings": STRINGS,
          "/api/code-lists": { fields: {} },
          "/api/field-visibility": FIELDS,
          "/api/invoices/inv-1": {
            facts: {},
            lines: [],
            orgUnitId: "ap-fr",
            validation: { passed: true, checked: [], failures: [] },
          },
          "/api/invoices/inv-1/document-url": { url: null },
          "/api/invoices/inv-1/progress": { inProcess: false, stages: [] },
        };
        if (!(path in bodies)) throw new Error(`no stub for ${path}`);
        return { ok: true, json: async () => bodies[path] } as Response;
      })
    );

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));

    const fieldsCall = asked.find((u) => u.startsWith("/api/field-visibility"));
    expect(fieldsCall).toContain("unit=ap-fr");
  });
});

describe("one Seller card, not two (decision 0220)", () => {
  /**
   * **Screen real estate**, in the operator's own words. A viewer
   * showing the document and the form side by side has no room for a
   * card that repeats what the card above it says differently.
   *
   * Decision 0219 added a second panel; this folds it into the first.
   */
  it("shows our record inside the Seller card when matched", async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        asked.push(String(url));
        const path = String(url).split("?")[0];
        const bodies: Record<string, unknown> = {
          "/api/ui-strings": STRINGS,
          "/api/code-lists": { fields: {} },
          "/api/field-visibility": FIELDS,
          "/api/invoices/inv-1": {
            facts: {},
            lines: [],
            supplier: {
              erpIdentifier: "40121",
              erpSiteIdentifier: "PAY-UK",
              isPaySite: true,
              name: "Acme Payments",
              vatId: "GB112233445",
              email: "payments@acme.example",
              addressLine: "PO Box 44",
              city: "London",
              postalCode: "EC2V 7HH",
              country: "GB",
            },
            validation: { passed: true, checked: [], failures: [] },
          },
          "/api/invoices/inv-1/document-url": { url: null },
          "/api/invoices/inv-1/progress": { inProcess: false, stages: [] },
        };
        if (!(path in bodies)) throw new Error(`no stub for ${path}`);
        return { ok: true, json: async () => bodies[path] } as Response;
      })
    );

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));

    const text = document.body.textContent ?? "";

    // Our record, with the address a person checks against the image.
    expect(text).toContain("Acme Payments");
    expect(text).toContain("GB112233445");
    expect(text).toContain("PO Box 44");

    // **E-mail is no longer one of the card's rows** — decision 0387
    // dropped it, along with E-address and Phone, so a value present
    // in the fetched record still must not reach the screen.
    expect(text).not.toContain("payments@acme.example");

    // **And the site, which is why this record and not a sibling** —
    // decision 0218 matches on a pay-site flag that is nowhere on the
    // document.
    expect(text).toContain("PAY-UK");

    // **One card.** The second heading is gone.
    const headings = [...document.querySelectorAll("h3")].map((h) => h.textContent);
    expect(headings.filter((h) => h === "Seller")).toHaveLength(1);
    expect(headings).not.toContain("Supplier on file");
  });

  it("falls back to what the document said when unmatched", async () => {
    /**
     * **What was extracted is all there is**, plus why no supplier was
     * found — and the card stays in the same place, so a person is not
     * hunting for a panel that appears and disappears.
     */
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = String(url).split("?")[0];
        const bodies: Record<string, unknown> = {
          "/api/ui-strings": STRINGS,
          "/api/code-lists": { fields: {} },
          "/api/field-visibility": FIELDS,
          "/api/invoices/inv-1": {
            facts: { "supplier.unmatchedReason": "no_match" },
            lines: [],
            supplier: null,
            validation: { passed: true, checked: [], failures: [] },
          },
          "/api/invoices/inv-1/document-url": { url: null },
          "/api/invoices/inv-1/progress": { inProcess: false, stages: [] },
        };
        if (!(path in bodies)) throw new Error(`no stub for ${path}`);
        return { ok: true, json: async () => bodies[path] } as Response;
      })
    );

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));

    const headings = [...document.querySelectorAll("h3")].map((h) => h.textContent);
    expect(headings.filter((h) => h === "Seller")).toHaveLength(1);
    expect(document.body.textContent).toContain("No supplier on file matches");
  });
});

describe("New Seller — a genuinely new supplier, recorded by hand (decision 0480)", () => {
  /**
   * The operator's own words: *"If the seller cannot be found, and it
   * is a new invoice, we should provide a New Seller, so that the
   * user can Enter in the Company Name, Tax ID, E-mail address, and
   * Address."* But not for a PO invoice — *"an invoice with an
   * unidentified supplier should not happen"* there, confirmed via
   * AskUserQuestion as a distinct anomaly with no self-service.
   */
  function stub(facts: Record<string, unknown>, posted: string[] = []) {
    return stubFetch(
      {
        "/api/ui-strings": STRINGS,
        "/api/code-lists": { fields: {} },
        "/api/field-visibility": FIELDS,
        "/api/invoices/inv-1": {
          facts,
          lines: [],
          supplier: null,
          validation: { passed: true, checked: [], failures: [] },
        },
        "/api/invoices/inv-1/document-url": { url: null },
        "/api/invoices/inv-1/progress": { inProcess: false, stages: [] },
      },
      posted
    );
  }

  async function open(facts: Record<string, unknown>) {
    const posted: string[] = [];
    stub(facts, posted);
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));
    return posted;
  }

  it("offers the New Seller button for a Non-PO invoice with no supplier matched", async () => {
    await open({ "supplier.unmatchedReason": "no_match" });

    const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "New Seller");
    expect(button).toBeTruthy();
    expect(document.body.textContent).not.toContain("This invoice names a purchase order");
  });

  it("carries its own icon, and sits beside Change Seller in the same card — reported live", async () => {
    await open({ "supplier.unmatchedReason": "no_match" });

    const newSellerButton = [...document.querySelectorAll("button")].find((b) => b.textContent === "New Seller");
    const changeSellerButton = [...document.querySelectorAll("button")].find((b) => b.textContent === "Change Seller");
    expect(newSellerButton?.querySelector("svg")).toBeTruthy();
    expect(changeSellerButton).toBeTruthy();
    // Same .cardhead, not two separate rows.
    expect(newSellerButton?.closest(".cardhead")).toBe(changeSellerButton?.closest(".cardhead"));
  });

  it("hides the New Seller button and shows the PO-anomaly warning instead when the invoice names a purchase order", async () => {
    await open({ "supplier.unmatchedReason": "no_match", "BT-13": "PO-4471" });

    const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "New Seller");
    expect(button).toBeFalsy();
    expect(document.body.textContent).toContain(
      "This invoice names a purchase order but no supplier could be matched"
    );
  });

  it("treats a blank PO reference the same as none at all", async () => {
    // A field present but empty — decision 0480's own check trims it,
    // the same way `hasPoReference` in viewer.js reads it.
    await open({ "supplier.unmatchedReason": "no_match", "BT-13": "   " });

    const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "New Seller");
    expect(button).toBeTruthy();
  });

  it("prefills the form from what the document itself says (BT-27, BT-31, BT-40)", async () => {
    await open({ "supplier.unmatchedReason": "no_match", "BT-27": "Acme Foods Ltd", "BT-31": "GB998877", "BT-40": "GB" });

    const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "New Seller");
    button?.click();
    await new Promise((r) => setTimeout(r, 0));

    const inputs = [...document.querySelectorAll(".popout input")] as HTMLInputElement[];
    expect(inputs.map((i) => i.value)).toContain("Acme Foods Ltd");
    expect(inputs.map((i) => i.value)).toContain("GB998877");
    expect(inputs.map((i) => i.value)).toContain("GB");
  });

  it("Save and Close sit top right of the pop-out, beside its heading, and Save carries an icon", async () => {
    await open({ "supplier.unmatchedReason": "no_match" });

    const openButton = [...document.querySelectorAll("button")].find((b) => b.textContent === "New Seller");
    openButton?.click();
    await new Promise((r) => setTimeout(r, 0));

    const saveButton = [...document.querySelectorAll(".popout button")].find((b) => b.textContent === "Save");
    const closeButton = [...document.querySelectorAll(".popout button")].find((b) => b.textContent === "Close");
    expect(saveButton?.querySelector("svg")).toBeTruthy();
    expect(saveButton?.closest(".cardhead")).toBeTruthy();
    expect(closeButton?.closest(".cardhead")).toBe(saveButton?.closest(".cardhead"));
  });

  it("Close actually closes the pop-out — previously disabled and inert, reported live", async () => {
    // The previous version called actionLink("close") with no
    // onclick, which actionLink treats as "nothing to do" and marks
    // disabled — a disabled button never dispatches a click at all,
    // so a handler patched on afterwards was never reachable. Wired
    // directly now, the same way every other pop-out's Close already
    // is.
    await open({ "supplier.unmatchedReason": "no_match" });

    const openButton = [...document.querySelectorAll("button")].find((b) => b.textContent === "New Seller");
    openButton?.click();
    await new Promise((r) => setTimeout(r, 0));

    const closeButton = [...document.querySelectorAll(".popout button")].find((b) => b.textContent === "Close");
    expect(closeButton?.disabled).toBe(false);
    closeButton?.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelector(".backdrop")).toBeFalsy();
  });

  it("refuses to save with no company name, and calls nothing", async () => {
    const posted = await open({ "supplier.unmatchedReason": "no_match" });

    const openButton = [...document.querySelectorAll("button")].find((b) => b.textContent === "New Seller");
    openButton?.click();
    await new Promise((r) => setTimeout(r, 0));

    const saveButton = [...document.querySelectorAll(".popout button")].find((b) => b.textContent === "Save");
    saveButton?.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.body.textContent).toContain("Company name is required.");
    expect(posted).not.toContain("/api/suppliers");
  });

  it("saves the new supplier, then attaches it to this invoice, then refreshes", async () => {
    // A bespoke stub, not the shared `stubFetch` helper — that one
    // only records POSTs in `posted`, and attaching a supplier is a
    // PUT (matching `handleSetInvoiceSupplier`'s own route). Every
    // call, any method, is recorded here instead.
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = String(url).split("?")[0];
        calls.push(`${init?.method ?? "GET"} ${path}`);
        const bodies: Record<string, unknown> = {
          "/api/ui-strings": STRINGS,
          "/api/code-lists": { fields: {} },
          "/api/field-visibility": FIELDS,
          "/api/invoices/inv-1": {
            facts: { "supplier.unmatchedReason": "no_match" },
            lines: [],
            supplier: null,
            validation: { passed: true, checked: [], failures: [] },
          },
          "/api/invoices/inv-1/document-url": { url: null },
          "/api/invoices/inv-1/progress": { inProcess: false, stages: [] },
          "/api/documents/inv-1/activity": { items: [] },
          "/api/suppliers": { id: "local:new-1" },
          "/api/invoices/inv-1/supplier": { invoiceId: "inv-1", supplierId: "local:new-1" },
        };
        if (!(path in bodies)) throw new Error(`no stub for ${path}`);
        return { ok: true, json: async () => bodies[path] } as Response;
      })
    );

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));

    const openButton = [...document.querySelectorAll("button")].find((b) => b.textContent === "New Seller");
    openButton?.click();
    await new Promise((r) => setTimeout(r, 0));

    const nameInput = document.querySelector(".popout input") as HTMLInputElement;
    nameInput.value = "Brand New Co";
    const saveButton = [...document.querySelectorAll(".popout button")].find((b) => b.textContent === "Save");
    saveButton?.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(calls).toContain("POST /api/suppliers");
    expect(calls).toContain("PUT /api/invoices/inv-1/supplier");
    // Attach happens after create, not before — the id used to attach
    // only exists once the create response has come back.
    expect(calls.indexOf("POST /api/suppliers")).toBeLessThan(calls.indexOf("PUT /api/invoices/inv-1/supplier"));
    // The popout is gone — closed and the viewer reopened, same as
    // openSupplierSearch's own choose handler.
    expect(document.querySelector(".backdrop")).toBeFalsy();
  });

  it("shows a save error inline and leaves the form open rather than closing on failure", async () => {
    stubFetch({
      "/api/ui-strings": STRINGS,
      "/api/code-lists": { fields: {} },
      "/api/field-visibility": FIELDS,
      "/api/invoices/inv-1": {
        facts: { "supplier.unmatchedReason": "no_match" },
        lines: [],
        supplier: null,
        validation: { passed: true, checked: [], failures: [] },
      },
      "/api/invoices/inv-1/document-url": { url: null },
      "/api/invoices/inv-1/progress": { inProcess: false, stages: [] },
    });
    // Override /api/suppliers specifically to fail, since stubFetch's
    // routes map returns ok:true for anything listed — a second
    // stubGlobal call replaces the mock outright for this one test.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = String(url).split("?")[0];
        if (path === "/api/suppliers") {
          return { ok: false, json: async () => ({ error: "a supplier with ERP identifier already exists" }) } as Response;
        }
        const bodies: Record<string, unknown> = {
          "/api/ui-strings": STRINGS,
          "/api/code-lists": { fields: {} },
          "/api/field-visibility": FIELDS,
          "/api/invoices/inv-1": {
            facts: { "supplier.unmatchedReason": "no_match" },
            lines: [],
            supplier: null,
            validation: { passed: true, checked: [], failures: [] },
          },
          "/api/invoices/inv-1/document-url": { url: null },
          "/api/invoices/inv-1/progress": { inProcess: false, stages: [] },
        };
        if (!(path in bodies)) throw new Error(`no stub for ${path}`);
        return { ok: true, json: async () => bodies[path] } as Response;
      })
    );

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));

    const openButton = [...document.querySelectorAll("button")].find((b) => b.textContent === "New Seller");
    openButton?.click();
    await new Promise((r) => setTimeout(r, 0));

    const nameInput = document.querySelector(".popout input") as HTMLInputElement;
    nameInput.value = "Brand New Co";
    const saveButton = [...document.querySelectorAll(".popout button")].find((b) => b.textContent === "Save");
    saveButton?.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.body.textContent).toContain("a supplier with ERP identifier already exists");
    expect(document.querySelector(".popout")).toBeTruthy();
  });
});

describe("every variable the page uses exists (decision 0223)", () => {
  /**
   * **A token nothing defines is not an error. It is transparent.**
   *
   * The supplier pop-out read `var(--bg-panel)`, which I invented, and
   * rendered as a box with no background at all — every word of the
   * page behind it showing through. Nothing failed and nothing logged;
   * the screen simply looked broken.
   *
   * `--bg-hover` was invented in the same block, and neither was caught
   * by a type checker, a linter or two hundred tests.
   */
  it("names no variable that tokens.css does not define", async () => {
    const sheets = (await import("virtual:stylesheets")).default;
    const tokens = sheets["tokens.css"];
    const page = sheets["app.css"];

    const defined = new Set(
      [...tokens.matchAll(/(--[a-z0-9-]+)\s*:/gi), ...page.matchAll(/(--[a-z0-9-]+)\s*:\s*[^;]+;/gi)].map(
        (m) => m[1]
      )
    );

    // A guard on the guard: a pattern matching nothing would make the
    // assertion below pass for the wrong reason.
    expect(defined.size).toBeGreaterThan(20);

    const used = [...page.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
    const invented = [...new Set(used)].filter((v) => !defined.has(v));

    expect(invented).toEqual([]);
  });

  it("lets a long address shrink rather than escaping the card", async () => {
    /**
     * **`auto` sizes a column to its content and refuses to shrink
     * below it**, so *United Kingdom of Great Britain and Northern
     * Ireland* pushed the address straight out through the side of the
     * card. `minmax(0, …)` is what says otherwise.
     */
    const page = (await import("virtual:stylesheets")).default["app.css"];
    const rule = page.slice(page.indexOf(".sellergrid {"), page.indexOf(".sellergrid {") + 400);

    expect(rule).toContain("minmax(0");
    expect(rule).not.toMatch(/grid-template-columns:\s*1fr auto/);
  });

  it("breaks a value that has nowhere natural to break", async () => {
    // A long email or a VAT number written without spaces would widen
    // its row instead of wrapping.
    const page = (await import("virtual:stylesheets")).default["app.css"];
    const rule = page.slice(page.indexOf(".sfield {"), page.indexOf(".sfield {") + 500);

    expect(rule).toContain("overflow-wrap");
  });

  it("no longer gives the address its own stacked grid (decision 0387, superseding 0280)", async () => {
    /**
     * **0280 stacked the address under its own label because the
     * card's own address column was half the card's width then.**
     * `.sellergrid` is one full-width column now, so the address is
     * back to the shared 88px-label layout every other field on the
     * card already uses — `.sfield.address` has nothing left to do.
     * A rule nothing selects is worth catching before it comes back.
     */
    const page = (await import("virtual:stylesheets")).default["app.css"];

    expect(page).not.toContain(".sfield.address {");
  });
});

describe("the address sits beside its label, not beneath it (decision 0387, superseding 0280)", () => {
  it("puts the address value to the right of its label on both the Seller and Buyer cards", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = String(url).split("?")[0];
        const bodies: Record<string, unknown> = {
          "/api/ui-strings": STRINGS,
          "/api/code-lists": { fields: {} },
          "/api/field-visibility": FIELDS,
          "/api/invoices/inv-1": {
            facts: {},
            lines: [],
            supplier: {
              name: "Northwind Logistics Ltd",
              vatId: null,
              electronicAddress: null,
              email: null,
              phone: null,
              addressLine: null,
              city: null,
              country: "GB",
              postalCode: null,
            },
            buyer: {
              unitId: "acme-uk",
              unitName: "Acme UK Limited",
              entityName: "Acme UK Limited",
              vatId: "GB123456789",
              addressLine: "1 Handover Street",
              city: "London",
              country: "GB",
              postalCode: "EC1A 1AA",
            },
            validation: { passed: true, checked: [], failures: [] },
          },
          "/api/invoices/inv-1/progress": { visits: [] },
          "/api/documents/inv-1/activity": { items: [] },
        };
        if (!(path in bodies)) throw new Error(`no stub for ${path}`);
        return { ok: true, json: async () => bodies[path] } as Response;
      })
    );

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});

    // No element carries the now-dead stacked-address modifier class.
    expect(document.querySelectorAll(".sfield.address")).toHaveLength(0);

    // Both cards still render the address, as a plain `.sfield` whose
    // label ("Address") sits beside the value rather than above it.
    const labels = [...document.querySelectorAll(".slabel")].filter((l) => l.textContent === "Address");
    expect(labels).toHaveLength(2);
    for (const label of labels) {
      expect(label.parentElement?.textContent).toContain("GB");
    }
  });
});

describe("more room, and a phone number back (decision 0393)", () => {
  /**
   * **The country sits beside the city, not beneath it.** Asked for
   * directly: "the 2 digit country code appears next to the City, on
   * the same line." `addressBlock()` now joins them with `", "`
   * before either reaches a `<div>` of its own, rather than each
   * keeping its own line — checked here as one line's own text, not
   * as two lines that happen to be adjacent.
   */
  it("joins the city and country onto the same line, with the postal code still its own line below", async () => {
    stubFetch({
      "/api/code-lists": { fields: {} },
      "/api/ui-strings": STRINGS,
      "/api/field-visibility": FIELDS,
      "/api/invoices/inv-1": {
        facts: {},
        lines: [],
        supplier: {
          name: "Northwind Logistics Ltd",
          vatId: null,
          addressLine: "Trinity Wharf",
          city: "Felixstowe",
          country: "GB",
          postalCode: "IP11 3SL",
          phone: "+44 1394 555 123",
        },
        validation: { passed: true, checked: [], failures: [] },
      },
    });

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));

    const addressLabel = [...document.querySelectorAll(".slabel")].find((l) => l.textContent === "Address");
    const addressLines = [...(addressLabel?.parentElement?.querySelectorAll("div") ?? [])].map(
      (d) => d.textContent
    );
    expect(addressLines).toEqual(["Trinity Wharf", "Felixstowe, GB", "IP11 3SL"]);
  });

  /**
   * **Phone, back beneath the address.** Decision 0387 dropped it
   * along with E-address and E-mail to give the card back a column;
   * asked to reintroduce this one alone. `s.phone`/`b.phone` were
   * never stopped being fetched (0387's own note), so this is a
   * rendering change only.
   */
  it("shows Phone beneath the address, on both the Seller and Buyer cards", async () => {
    stubFetch({
      "/api/code-lists": { fields: {} },
      "/api/ui-strings": STRINGS,
      "/api/field-visibility": FIELDS,
      "/api/invoices/inv-1": {
        facts: {},
        lines: [],
        supplier: {
          name: "Northwind Logistics Ltd",
          vatId: null,
          addressLine: "Trinity Wharf",
          city: "Felixstowe",
          country: "GB",
          postalCode: null,
          phone: "+44 1394 555 123",
        },
        buyer: {
          unitId: "acme-uk",
          unitName: "Acme UK Limited",
          entityName: "Acme UK Limited",
          vatId: "GB123456789",
          addressLine: "1 Handover Street",
          city: "London",
          country: "GB",
          postalCode: "EC1A 1AA",
          phone: "+44 20 7946 0958",
        },
        validation: { passed: true, checked: [], failures: [] },
      },
    });

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));

    const phoneLabels = [...document.querySelectorAll(".slabel")].filter((l) => l.textContent === "Phone");
    expect(phoneLabels).toHaveLength(2);
    expect(phoneLabels[0].parentElement?.textContent).toContain("+44 1394 555 123");
    expect(phoneLabels[1].parentElement?.textContent).toContain("+44 20 7946 0958");
  });

  it("still shows a muted dash for Phone when the record has none, rather than omitting the row", async () => {
    // The same rule Name and VAT already follow (`pair()` always
    // renders) — Phone joining them as a third always-rendered row is
    // not a special case, and a test that only ever supplies a phone
    // number would not catch a regression here.
    stubFetch({
      "/api/code-lists": { fields: {} },
      "/api/ui-strings": STRINGS,
      "/api/field-visibility": FIELDS,
      "/api/invoices/inv-1": {
        facts: {},
        lines: [],
        supplier: {
          name: "Northwind Logistics Ltd",
          vatId: null,
          addressLine: null,
          city: null,
          country: "GB",
          postalCode: null,
          phone: null,
        },
        validation: { passed: true, checked: [], failures: [] },
      },
    });

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));

    const phoneLabel = [...document.querySelectorAll(".slabel")].find((l) => l.textContent === "Phone");
    expect(phoneLabel?.parentElement?.textContent).toContain("—");
  });

  /**
   * **The row-format placeholder actions are gone, not just
   * overridden again.** Decision 0392 gave `.vpoppedoutactions
   * .actionlink` its own row-format rule; decision 0393 deletes it
   * outright so the shared `.actionlink` rule — the same one "Header
   * Fields" uses — is the only one left to apply. Grid layout itself
   * is untestable in jsdom (decision 0392's own note, still true), so
   * this checks the stylesheet text directly, the same way decision
   * 0387's "no longer gives the address its own stacked grid" test
   * checked for an absent selector rather than a computed style.
   */
  it("no longer overrides the pop-out actions into a row (decision 0393, superseding part of 0392)", async () => {
    const page = (await import("virtual:stylesheets")).default["app.css"];
    expect(page).not.toContain(".vpoppedoutactions .actionlink {");
  });

  /**
   * **The wording itself is data (`ui_strings`, migration 0122), not
   * something this file decides** — `t("viewer.openinwindow")` reads
   * whatever the fixture's `STRINGS` supplies, the same as production
   * reads whatever the database holds. This asserts the new wording
   * reaches the screen once the fixture (and, in production, the
   * migration) supplies it; the older test above intentionally only
   * checks the shared substring, since exactness is this test's job.
   */
  it("reads the placeholder's new wording from the same string the older, looser test only substring-matches", async () => {
    stubFetch({
      "/api/code-lists": { fields: {} },
      "/api/ui-strings": STRINGS,
      "/api/field-visibility": FIELDS,
      "/api/invoices/inv-1": { facts: {}, lines: [], validation: { passed: true, checked: [], failures: [] } },
    });
    vi.stubGlobal("open", vi.fn(() => ({ closed: false, focus: vi.fn(), close: vi.fn(), location: { href: "" } })));

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});

    const doctabsHead = document.querySelector(".doctabs")?.closest(".cardhead");
    const expand = [...(doctabsHead?.querySelectorAll(".actionlink") ?? [])].find(
      (n) => n.querySelector("span")?.textContent === "Expand"
    );
    (expand as HTMLElement)?.click();

    expect(document.querySelector(".vpoppedouttext")?.textContent).toBe(
      "Document open in a separate window"
    );
  });
});

describe("the country stays the short code (decision 0389, superseding 0221)", () => {
  /**
   * **0221's own reasoning was "say what the image says"** — an
   * invoice prints *United Kingdom*, so the card should too. Asked
   * directly to reverse it, with `GB` becoming "United Kingdom of
   * Great Britain and Northern Ireland" as the example: "I think in
   * all cases, we can stick with the short form country code."
   *
   * `invoice-facts-route.ts` still sends `countryName` alongside
   * `country` — this asserts the card reads only the latter, so a
   * value genuinely present in the fetched record still must not
   * reach the screen (the same shape decision 0387 used for E-mail).
   */
  it("shows the short country code and not the expanded Peppol name, on both cards", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = String(url).split("?")[0];
        const bodies: Record<string, unknown> = {
          "/api/ui-strings": STRINGS,
          "/api/code-lists": { fields: {} },
          "/api/field-visibility": FIELDS,
          "/api/invoices/inv-1": {
            facts: {},
            lines: [],
            supplier: {
              name: "Northwind Logistics Ltd",
              vatId: null,
              addressLine: "1 Dock Road",
              city: "Southampton",
              country: "GB",
              countryName: "United Kingdom of Great Britain and Northern Ireland",
              postalCode: "SO14 3XY",
            },
            buyer: {
              unitId: "acme-uk",
              unitName: "Acme UK Limited",
              entityName: "Acme UK Limited",
              vatId: "GB123456789",
              addressLine: "1 Handover Street",
              city: "London",
              country: "GB",
              countryName: "United Kingdom of Great Britain and Northern Ireland",
              postalCode: "EC1A 1AA",
            },
            validation: { passed: true, checked: [], failures: [] },
          },
          "/api/invoices/inv-1/progress": { visits: [] },
          "/api/documents/inv-1/activity": { items: [] },
        };
        if (!(path in bodies)) throw new Error(`no stub for ${path}`);
        return { ok: true, json: async () => bodies[path] } as Response;
      })
    );

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});

    const text = document.body.textContent ?? "";
    expect(text).toContain("GB");
    expect(text).not.toContain("United Kingdom of Great Britain and Northern Ireland");
  });
});

describe("the Buyer card says a name once (decision 0227)", () => {
  /**
   * **The sub-line repeated the Name directly beneath it.**
   *
   * Decision 0224 put the entity and the unit there because an invoice
   * was assigned to a department beneath a company. **Since decision
   * 0226 the header names the company**, so the two are the same row.
   */
  it("does not repeat the name under the heading", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = String(url).split("?")[0];
        const bodies: Record<string, unknown> = {
          "/api/ui-strings": STRINGS,
          "/api/code-lists": { fields: {} },
          "/api/field-visibility": FIELDS,
          "/api/invoices/inv-1": {
            facts: {},
            lines: [],
            supplier: null,
            buyer: {
              unitId: "acme-uk",
              unitName: "Acme UK Limited",
              entityName: "Acme UK Limited",
              vatId: "GB123456789",
              addressLine: "1 Handover Street",
              city: "London",
              country: "GB",
              postalCode: "EC1A 1AA",
            },
            validation: { passed: true, checked: [], failures: [] },
          },
          "/api/invoices/inv-1/document-url": { url: null },
          "/api/invoices/inv-1/progress": { inProcess: false, stages: [] },
        };
        if (!(path in bodies)) throw new Error(`no stub for ${path}`);
        return { ok: true, json: async () => bodies[path] } as Response;
      })
    );

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));

    const buyerCard = [...document.querySelectorAll(".panel")].find(
      (p) => p.querySelector("h3")?.textContent === "Buyer"
    );

    // Once as the value of Name, and nowhere else.
    const occurrences = (buyerCard?.textContent?.match(/Acme UK Limited/g) ?? []).length;
    expect(occurrences).toBe(1);
  });
});

describe("each party card carries its own action (decision 0228)", () => {
  /**
   * **Top right, in space the heading already leaves empty.**
   *
   * A footer adds height to a card in a column already short of it, and
   * the operator said so: *"it might extend the card size if we place
   * at the bottom right. There is space in the top right already."*
   */
  function stub(body: Record<string, unknown>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = String(url).split("?")[0];
        const bodies: Record<string, unknown> = {
          "/api/ui-strings": STRINGS,
          "/api/code-lists": { fields: {} },
          "/api/field-visibility": FIELDS,
          "/api/invoices/inv-1": {
            facts: {},
            lines: [],
            validation: { passed: true, checked: [], failures: [] },
            ...body,
          },
          "/api/invoices/inv-1/document-url": { url: null },
          "/api/invoices/inv-1/progress": { inProcess: false, stages: [] },
        };
        if (!(path in bodies)) throw new Error(`no stub for ${path}`);
        return { ok: true, json: async () => bodies[path] } as Response;
      })
    );
  }

  async function open(body: Record<string, unknown>) {
    stub(body);
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));
  }

  const MATCHED = {
    supplier: { erpIdentifier: "40118", name: "Northwind", isPaySite: true },
    buyer: { unitId: "acme-uk", unitName: "Acme UK", entityName: "Acme UK", vatId: "GB1" },
  };

  it("offers both actions when both matched", async () => {
    /**
     * **Offered even when a match was found**, because a wrong answer
     * is worse than none: none stops at the org gate (decision 0037),
     * and a wrong one sails through every org-scoped stage after it.
     */
    await open(MATCHED);
    const labels = [...document.querySelectorAll(".actionlink span")].map((s) => s.textContent);

    expect(labels).toContain("Change Seller");
    expect(labels).toContain("Change Buyer");
  });

  it("offers them when neither matched", async () => {
    // **The state where they are most needed**, and where a card that
    // hid its action would strand somebody.
    await open({ supplier: null, buyer: null, buyerUnplaced: "no_match" });
    const labels = [...document.querySelectorAll(".actionlink span")].map((s) => s.textContent);

    expect(labels).toContain("Change Seller");
    expect(labels).toContain("Change Buyer");
  });

  it("hides both actions on an unclaimed task, matching every other edit affordance (decision 0289)", async () => {
    /**
     * **Reported live**: "I was able to click the Change Seller and
     * Change Buyer buttons on invoices that are not claimed to my
     * user." Reassigning who an invoice is from or billed to is
     * exactly the kind of edit decision 0288 already gates behind
     * `"mine"` ownership for every field and the Save button —
     * `cardHead()`'s own action had simply never been reached by that
     * fix.
     */
    stub(MATCHED);
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer({ ...TASK, ownership: "available", actions: ["claim"] }, () => {});
    await new Promise((r) => setTimeout(r, 0));

    const labels = [...document.querySelectorAll(".actionlink span")].map((s) => s.textContent);
    expect(labels).not.toContain("Change Seller");
    expect(labels).not.toContain("Change Buyer");
  });

  it("omits the Seller card's own identifier line entirely when there is nothing in it (decision 0290)", async () => {
    /**
     * **Reported live**: "The fields beneath the word Seller appear
     * to be aligned to the bottom of the card. The Buyer card, details
     * seem aligned to the top." This line rendered unconditionally —
     * a supplier with no ERP identifier, no site, and not a pay site
     * still produced an empty line, present in the layout and carrying
     * its own margin, pushing the fields beneath it down for no
     * reason a person reading the card could see.
     */
    await open({ supplier: { name: "Acme Payments" }, buyer: null });
    expect(document.querySelector(".parties .sub")).toBeNull();
  });

  it("keeps the identifier line when there is something to say", async () => {
    await open(MATCHED);
    expect(document.querySelector(".parties .sub")?.textContent).toContain("40118");
  });

  it("gives the identifier line a caption's margin, not the sign-in page's own subtitle margin", async () => {
    /**
     * **The other half of the same fix.** Even with real content, the
     * base `.sub` rule — written for the sign-in page's own subtitle,
     * a full sentence needing real air beneath it — carried a 34px
     * bottom margin nothing here had ever overridden, the way
     * `#shell .sub` and `.vhead .sub` already override it for their
     * own contexts. jsdom applies no CSS, so this reads the real
     * stylesheet text.
     */
    const css = (await import("virtual:stylesheets")).default["app.css"];
    const ruleStart = css.indexOf(".parties .sub {");
    expect(ruleStart, "the .parties .sub override must exist").toBeGreaterThan(-1);
    const rule = css.slice(ruleStart, css.indexOf("}", ruleStart) + 1);
    expect(rule).not.toContain("34px");
  });

  it("puts the action in the heading row, not below the card", async () => {
    /**
     * **The whole point of moving it.** A footer would sit after the
     * fields; this sits beside the title, using height that is already
     * spent.
     */
    await open(MATCHED);

    const buyerCard = [...document.querySelectorAll(".panel")].find(
      (p) => p.querySelector("h3")?.textContent === "Buyer"
    );

    const head = buyerCard?.querySelector(".cardhead");
    expect(head?.querySelector("h3")?.textContent).toBe("Buyer");
    expect(head?.querySelector(".actionlink span")?.textContent).toBe("Change Buyer");

    // And nowhere else in the card.
    expect(buyerCard?.querySelectorAll(".actionlink")).toHaveLength(1);
  });

  it("opens the search when clicked", async () => {
    await open(MATCHED);

    const buyerCard = [...document.querySelectorAll(".panel")].find(
      (p) => p.querySelector("h3")?.textContent === "Buyer"
    );
    (buyerCard?.querySelector(".actionlink") as HTMLButtonElement)?.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelector(".popout")).not.toBeNull();
  });

  /**
   * **The pop-out's own top-right actions — decision 0494.** Reported
   * live: "There are two buttons on the pop-out, Record this supplier
   * from the invoice, and close. Please can these be moved to the top
   * right of the card / pop-out." `openSearch()` is shared by both
   * Change Seller and Change Buyer, so this checks the shape from
   * Seller's own side, where `alsoOffer` actually exists.
   */
  it("carries Record New Supplier and Close in the pop-out's own cardhead, not a plain button below the results", async () => {
    await open(MATCHED);

    const sellerButton = [...document.querySelectorAll("button")].find((b) => b.textContent === "Change Seller");
    (sellerButton as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));

    const popout = document.querySelector(".popout") as HTMLElement;
    const head = popout.querySelector(".cardhead");
    expect(head).not.toBeNull();
    const headButtons = [...head!.querySelectorAll(".actionlink span")].map((s) => s.textContent);
    expect(headButtons).toEqual(["Record New Supplier", "Close"]);
    // Not the old plain `.secondary` button below the results.
    expect(popout.querySelector("button.secondary")).toBeNull();
  });

  it("posts the invoice's own facts and attaches the new supplier when Record New Supplier is clicked", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = String(url).split("?")[0];
        calls.push(`${init?.method ?? "GET"} ${path}`);
        const bodies: Record<string, unknown> = {
          "/api/ui-strings": STRINGS,
          "/api/code-lists": { fields: {} },
          "/api/field-visibility": FIELDS,
          "/api/invoices/inv-1": {
            facts: { "BT-27": "New Co Ltd", "BT-31": "GB123", "BT-34": "0088:9999", "BT-40": "GB" },
            lines: [],
            ...MATCHED,
            validation: { passed: true, checked: [], failures: [] },
          },
          "/api/invoices/inv-1/document-url": { url: null },
          "/api/invoices/inv-1/progress": { inProcess: false, stages: [] },
          "/api/suppliers": { id: "local:new-1" },
          "/api/invoices/inv-1/supplier": { invoiceId: "inv-1", supplierId: "local:new-1" },
        };
        if (!(path in bodies)) throw new Error(`no stub for ${path}`);
        return { ok: true, json: async () => bodies[path] } as Response;
      })
    );
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));

    const sellerButton = [...document.querySelectorAll("button")].find((b) => b.textContent === "Change Seller");
    (sellerButton as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));

    const record = [...document.querySelectorAll(".popout .actionlink")].find(
      (a) => a.querySelector("span")?.textContent === "Record New Supplier"
    ) as HTMLButtonElement;
    record.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(calls).toContain("POST /api/suppliers");
    expect(calls).toContain("PUT /api/invoices/inv-1/supplier");
    // Attach happens after create, not before.
    expect(calls.indexOf("POST /api/suppliers")).toBeLessThan(calls.indexOf("PUT /api/invoices/inv-1/supplier"));
    expect(document.querySelector(".backdrop")).toBeFalsy();
  });

  it("offers no Record button on Change Buyer's own pop-out — only Close, since there is no alsoOffer there", async () => {
    await open(MATCHED);

    const buyerButton = [...document.querySelectorAll("button")].find((b) => b.textContent === "Change Buyer");
    (buyerButton as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));

    const head = document.querySelector(".popout .cardhead");
    const headButtons = [...head!.querySelectorAll(".actionlink span")].map((s) => s.textContent);
    expect(headButtons).toEqual(["Close"]);
  });
});

describe("a workflow stage error is shown, not silently absorbed (decision 0435)", () => {
  function stub(body: Record<string, unknown>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = String(url).split("?")[0];
        const bodies: Record<string, unknown> = {
          "/api/ui-strings": STRINGS,
          "/api/code-lists": { fields: {} },
          "/api/field-visibility": FIELDS,
          "/api/invoices/inv-1": {
            facts: {},
            lines: [],
            validation: { passed: true, checked: [], failures: [] },
            ...body,
          },
          "/api/invoices/inv-1/document-url": { url: null },
          "/api/invoices/inv-1/progress": { inProcess: false, stages: [] },
          "/api/invoices/inv-1/pages": { pages: [] },
          "/api/documents/inv-1/activity": { events: [] },
        };
        if (!(path in bodies)) throw new Error(`no stub for ${path}`);
        return { ok: true, json: async () => bodies[path] } as Response;
      })
    );
  }

  async function open(body: Record<string, unknown>) {
    stub(body);
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));
  }

  it("shows the raw error, prefixed by a labelled banner, when a stage visit failed", async () => {
    await open({ workflowStageError: 'assign_task fired an invalid task: {"error":"requiredPermission \\"undefined\\" is not in the closed permission vocabulary"}' });

    const warn = document.querySelector(".panel.needsattention .warn");
    expect(warn?.textContent).toContain("This invoice stopped moving because of a processing error:");
    expect(warn?.textContent).toContain("requiredPermission");
  });

  it("shows nothing when there is no stage error — the ordinary case", async () => {
    await open({ workflowStageError: null });

    const banners = [...document.querySelectorAll(".panel.needsattention .warn")].map((w) => w.textContent);
    expect(banners.some((t) => t?.includes("processing error"))).toBe(false);
  });
});

describe("why this task is here (decision 0478)", () => {
  async function open(body: Record<string, unknown>) {
    stubFetch({
      "/api/ui-strings": STRINGS,
      "/api/code-lists": { fields: {} },
      "/api/field-visibility": FIELDS,
      "/api/invoices/inv-1": {
        facts: {},
        lines: [],
        validation: { passed: true, checked: [], failures: [] },
        ...body,
      },
      "/api/documents/inv-1/activity": { events: [] },
    });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));
  }

  it("shows nothing when the invoice has no open task reason — the ordinary case", async () => {
    await open({ openTaskReason: null });
    expect(document.querySelector(".panel.reasonline")).toBeNull();
  });

  it("names a custom rule, already resolved to this viewer's own locale by the server", async () => {
    await open({
      openTaskReason: {
        ruleId: "rule-supplier",
        standardKey: null,
        name: "Supplier Not Matching in ERP",
        sourceText: "If the supplier is not matching in the ERP, assign a task to the AP team requiring AP.Review permission.",
      },
    });

    const row = document.querySelector(".panel.reasonline .reasonline-row");
    expect(row?.textContent).toContain("Here because:");
    expect(row?.textContent).toContain("Supplier Not Matching in ERP");
  });

  it("resolves a standard matching rule's name through t(), by its stable key", async () => {
    await open({
      openTaskReason: {
        ruleId: "rule-standard",
        standardKey: "po_line_not_found",
        // Deliberately different from the t() string below — proves
        // the frontend actually looked the name up by standardKey
        // rather than just echoing what the server sent.
        name: "some other name the server happened to send",
        sourceText: "the sentence",
      },
    });

    const row = document.querySelector(".panel.reasonline .reasonline-row");
    expect(row?.textContent).toContain("Standard rule: PO line not found");
    expect(row?.textContent).not.toContain("some other name");
  });

  it("keeps the full sentence hidden until asked for, and shows it exactly as authored — never translated", async () => {
    await open({
      openTaskReason: {
        ruleId: "rule-supplier",
        standardKey: null,
        name: "Supplier Not Matching in ERP",
        sourceText: "If the supplier is not matching in the ERP, assign a task to the AP team requiring AP.Review permission.",
      },
    });

    const detail = document.querySelector(".reasonline-detail") as HTMLElement;
    expect(detail.hidden).toBe(true);

    const expand = [...document.querySelectorAll(".panel.reasonline button")].find((b) =>
      b.textContent?.includes("click for details")
    ) as HTMLButtonElement;
    expand.click();

    expect(detail.hidden).toBe(false);
    expect(detail.textContent).toContain(
      "If the supplier is not matching in the ERP, assign a task to the AP team requiring AP.Review permission."
    );
  });

  it("is visually distinct from workflowErrorPanel — both can be present without colliding", async () => {
    await open({
      workflowStageError: "assign_task fired an invalid task",
      openTaskReason: {
        ruleId: "rule-supplier",
        standardKey: null,
        name: "Supplier Not Matching in ERP",
        sourceText: null,
      },
    });

    expect(document.querySelector(".panel.needsattention .warn")).not.toBeNull();
    expect(document.querySelector(".panel.reasonline")).not.toBeNull();
    // Not the same element, and the reason line does not borrow the
    // warning styling — it names an ordinary outcome, not a fault.
    expect(document.querySelector(".panel.reasonline.needsattention")).toBeNull();
  });
});

describe("the manual supplier search ranks by the invoice's own org (decision 0433)", () => {
  /**
   * **Found live**: an invoice whose seller matched two sites sharing
   * a VAT number, neither a pay site, reached this exact search — and
   * every candidate looked equally plausible, because nothing here
   * knew which one does business with the buying entity this invoice
   * was actually placed under. `stored.orgUnitId` (decision 0198) is
   * sent along so the backend can rank by it — `match-supplier.test.ts`
   * covers the backend's own ranking; this covers that the request and
   * the rendered row actually carry it.
   */
  function open(orgUnitId: string | null) {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(String(url));
        const path = String(url).split("?")[0];
        const bodies: Record<string, unknown> = {
          "/api/ui-strings": STRINGS,
          "/api/code-lists": { fields: {} },
          "/api/field-visibility": FIELDS,
          "/api/invoices/inv-1": {
            facts: {},
            lines: [],
            validation: { passed: true, checked: [], failures: [] },
            supplier: null,
            orgUnitId,
          },
          "/api/invoices/inv-1/document-url": { url: null },
          "/api/invoices/inv-1/progress": { inProcess: false, stages: [] },
          "/api/invoices/inv-1/pages": { pages: [] },
          "/api/documents/inv-1/activity": { items: [] },
          "/api/suppliers/search": {
            suppliers: [
              { id: "fr", name: "Northwind FR", erp_identifier: "1", org_match: 0 },
              { id: "de", name: "Northwind DE", erp_identifier: "2", org_match: 1 },
            ],
          },
        };
        if (!(path in bodies)) throw new Error(`no stub for ${path}`);
        return { ok: true, json: async () => bodies[path] } as Response;
      })
    );
    return calls;
  }

  async function openAndSearch(orgUnitId: string | null) {
    const calls = open(orgUnitId);
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));

    const sellerCard = [...document.querySelectorAll(".panel")].find(
      (p) => p.querySelector("h3")?.textContent === "Seller"
    );
    (sellerCard?.querySelector(".actionlink") as HTMLButtonElement)?.click();
    await new Promise((r) => setTimeout(r, 0));

    const input = document.querySelector(".searchbox") as HTMLInputElement;
    input.value = "northwind";
    input.oninput?.(new Event("input"));
    await new Promise((r) => setTimeout(r, 0));

    return calls;
  }

  it("sends the invoice's own org on the search request", async () => {
    const calls = await openAndSearch("acme-uk");
    const searchCall = calls.find((c) => c.startsWith("/api/suppliers/search"));
    expect(searchCall).toContain("orgUnitId=acme-uk");
  });

  it("sends an empty orgUnitId where the invoice has none", async () => {
    const calls = await openAndSearch(null);
    const searchCall = calls.find((c) => c.startsWith("/api/suppliers/search"));
    expect(searchCall).toContain("orgUnitId=");
    expect(searchCall).not.toContain("orgUnitId=null");
  });

  it("marks the row the backend flagged as an org match", async () => {
    await openAndSearch("acme-uk");

    const rows = [...document.querySelectorAll(".searchresult")];
    const deRow = rows.find((r) => r.textContent?.includes("Northwind DE"));
    const frRow = rows.find((r) => r.textContent?.includes("Northwind FR"));

    expect(deRow?.textContent).toContain("Same org as this invoice");
    expect(frRow?.textContent).not.toContain("Same org as this invoice");
  });
});

describe("the Invoice header card is a curated summary, with a pop-out for the rest (decision 0291)", () => {
  /**
   * **Reported live, from a screenshot and two mock-ups**: "Business
   * Process and Specification... do not display well and overlap."
   * Both are EN 16931 technical identifiers — long URN strings with
   * no spaces to wrap at — never meant for a person reviewing an
   * invoice. Replaced with a curated, fixed arrangement of the fields
   * that are, plus a pop-out (matching the Supplier screen's own
   * pattern) for anything a customer's own configuration adds beyond
   * them.
   */
  const CURATED_FIELDS = {
    fields: [
      { field: "BT-1", visibility: "edit", type: "text", line: false, description: "invoice number" },
      { field: "BT-5", visibility: "read", type: "text", line: false, description: "currency" },
      { field: "BT-2", visibility: "read", type: "date", line: false, description: "issue date" },
      { field: "BT-9", visibility: "read", type: "date", line: false, description: "due date" },
      { field: "BT-13", visibility: "read", type: "text", line: false, description: "purchase order" },
      { field: "BT-20", visibility: "read", type: "text", line: false, description: "payment terms" },
      { field: "BT-106", visibility: "read", type: "number", line: false, description: "net before vat" },
      { field: "BT-110", visibility: "read", type: "number", line: false, description: "vat amount" },
      { field: "BT-112", visibility: "read", type: "number", line: false, description: "total with vat" },
      { field: "BT-115", visibility: "read", type: "number", line: false, description: "amount due" },
    ],
  };

  function stub(fieldVisibility: Record<string, unknown>, facts: Record<string, unknown>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = String(url).split("?")[0];
        const bodies: Record<string, unknown> = {
          "/api/ui-strings": STRINGS,
          "/api/code-lists": { fields: {} },
          "/api/field-visibility": fieldVisibility,
          "/api/invoices/inv-1": {
            facts,
            lines: [],
            validation: { passed: true, checked: [], failures: [] },
          },
          "/api/invoices/inv-1/document-url": { url: null },
          "/api/invoices/inv-1/progress": { inProcess: false, stages: [] },
        };
        if (!(path in bodies)) throw new Error(`no stub for ${path}`);
        return { ok: true, json: async () => bodies[path] } as Response;
      })
    );
  }

  async function open(fieldVisibility: Record<string, unknown>, facts: Record<string, unknown> = {}) {
    stub(fieldVisibility, facts);
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));
  }

  function headerCard() {
    return [...document.querySelectorAll(".panel")].find(
      (p) => p.querySelector("h3")?.textContent === "Invoice header"
    ) as HTMLElement;
  }

  it("shows the curated fields, arranged in their own columns", async () => {
    await open(CURATED_FIELDS, { "BT-1": "INV-1", "BT-115": "1200" });

    const columns = headerCard().querySelectorAll(".headersummary > .hscolumn");
    expect(columns.length).toBe(5);
    // First column: Invoice number, then Currency.
    const firstColumnLabels = [...columns[0].querySelectorAll(".kf label")].map((l) => l.textContent);
    expect(firstColumnLabels).toEqual(["Invoice number", "Currency"]);
  });

  it("never shows Business process or Specification in the summary card itself", async () => {
    const withExtras = {
      fields: [...CURATED_FIELDS.fields, { field: "BT-23", visibility: "read", type: "text", line: false }],
    };
    await open(withExtras, { "BT-23": "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0" });

    expect(headerCard().textContent).not.toContain("Business process");
    expect(document.getElementById("f-BT-23")).toBeNull();
  });

  it("offers Header Fields when a customer's own configuration adds fields beyond the curated set", async () => {
    const withExtras = {
      fields: [...CURATED_FIELDS.fields, { field: "BT-23", visibility: "read", type: "text", line: false }],
    };
    await open(withExtras, {});

    const labels = [...headerCard().querySelectorAll(".actionlink span")].map((s) => s.textContent);
    expect(labels).toContain("Header Fields");
  });

  it("omits Header Fields when the curated set is everything that's configured", async () => {
    await open(CURATED_FIELDS, {});

    const labels = [...headerCard().querySelectorAll(".actionlink span")].map((s) => s.textContent);
    expect(labels).not.toContain("Header Fields");
  });

  it("opens a pop-out listing every configured field, matching its own title (decision 0293)", async () => {
    /**
     * **The operator's own correction**: "I had thought that the
     * pop-out would show fields on the card, and any additional
     * fields not shown on the card... Hence the pop-out title — 'All
     * invoice header fields.'" Restricting it to only the overflow
     * (decision 0292) made the title wrong about what was in it.
     */
    const withExtras = {
      fields: [
        ...CURATED_FIELDS.fields,
        { field: "BT-23", visibility: "read", type: "text", line: false },
        { field: "BT-24", visibility: "read", type: "text", line: false },
      ],
    };
    await open(withExtras, {
      "BT-1": "INV-2026-04471",
      "BT-23": "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
      "BT-24": "urn:cen.eu:en16931:2017",
    });

    const trigger = [...headerCard().querySelectorAll(".actionlink")].find(
      (a) => a.querySelector("span")?.textContent === "Header Fields"
    ) as HTMLButtonElement;
    trigger.click();
    await new Promise((r) => setTimeout(r, 0));

    const popout = document.querySelector(".popout");
    expect(popout).not.toBeNull();
    // The genuine overflow, as before.
    expect(popout?.textContent).toContain("Business process");
    expect(popout?.textContent).toContain("Specification");
    expect(popout?.textContent).toContain("urn:fdc:peppol.eu:2017:poacc:billing:01:1.0");
    // Now also every field the card itself already shows.
    expect(popout?.textContent).toContain("Invoice number");
    expect(popout?.textContent).toContain("INV-2026-04471");
  });

  it("renders a field already on the card as read-only in the pop-out, under a different id from the card's own", async () => {
    /**
     * **The card already has the one real, editable copy.** A second
     * one here, even genuinely distinct in the DOM, would be an input
     * `save()` never reads — it looks for `f-${field}` specifically,
     * nothing else — so an edit typed into a second copy would look
     * accepted and then silently not exist. This is the test that
     * proves the pop-out's own copy is read-only text, not a second,
     * inert-looking input.
     */
    const withOverflow = {
      fields: [...CURATED_FIELDS.fields, { field: "BT-23", visibility: "read", type: "text", line: false }],
    };
    await open(withOverflow, { "BT-1": "INV-2026-04471" });

    const trigger = [...headerCard().querySelectorAll(".actionlink")].find(
      (a) => a.querySelector("span")?.textContent === "Header Fields"
    ) as HTMLButtonElement;
    trigger.click();
    await new Promise((r) => setTimeout(r, 0));

    // The card's own, real, editable copy — untouched.
    expect(document.getElementById("f-BT-1")?.tagName).toBe("INPUT");
    // The pop-out's own copy of the same field: a different id, and
    // read-only regardless of the field's own edit visibility.
    const popoutCopy = document.getElementById("hf-BT-1");
    expect(popoutCopy).not.toBeNull();
    expect(popoutCopy?.tagName).toBe("DIV");
    expect(popoutCopy?.textContent).toBe("INV-2026-04471");
  });

  it("lets an overflow field the person may edit actually be edited, and Save picks it up (decision 0292)", async () => {
    /**
     * **The operator's own request**: "Perhaps the pop-out should be
     * edit-mode also, if my user permissions allow." An overflow field
     * marked `edit` now renders through the same `field()` every other
     * editable field on this screen uses — and because the field
     * genuinely has no second copy on the page (the previous test),
     * `save()`'s own `document.getElementById` lookup finds this one
     * exactly the way it finds any other.
     */
    const withEditableExtra = {
      fields: [
        ...CURATED_FIELDS.fields,
        { field: "BT-23", visibility: "edit", type: "text", line: false },
      ],
    };
    const posted: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = String(url).split("?")[0];
        if (init?.method === "POST" && path.endsWith("/key")) {
          posted.push(JSON.parse(String(init.body)));
        }
        const bodies: Record<string, unknown> = {
          "/api/ui-strings": STRINGS,
          "/api/code-lists": { fields: {} },
          "/api/field-visibility": withEditableExtra,
          "/api/invoices/inv-1": { facts: {}, lines: [], validation: { passed: true, checked: [], failures: [] } },
          "/api/invoices/inv-1/document-url": { url: null },
          "/api/invoices/inv-1/progress": { inProcess: false, stages: [] },
          "/api/invoices/inv-1/key": { facts: {} },
        };
        if (!(path in bodies)) throw new Error(`no stub for ${path}`);
        return { ok: true, json: async () => bodies[path] } as Response;
      })
    );
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));

    const trigger = [...headerCard().querySelectorAll(".actionlink")].find(
      (a) => a.querySelector("span")?.textContent === "Header Fields"
    ) as HTMLButtonElement;
    trigger.click();
    await new Promise((r) => setTimeout(r, 0));

    const input = document.getElementById("f-BT-23") as HTMLInputElement;
    expect(input.tagName).toBe("INPUT");
    input.value = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";

    const save = [...document.querySelectorAll(".actionlink")].find(
      (a) => a.querySelector("span")?.textContent === "Save"
    ) as HTMLButtonElement;
    save.click();
    await new Promise((r) => setTimeout(r, 0));

    expect((posted[0] as { facts: Record<string, unknown> }).facts["BT-23"]).toBe(
      "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0"
    );
  });

  it("keeps an overflow edit even after the pop-out is closed, then Save is pressed", async () => {
    /**
     * **The scenario that actually matters.** A person edits a field
     * in the pop-out, closes it to look at the rest of the document,
     * and presses Save minutes later — the input has to still be in
     * the page at that point for `save()` to find it at all.
     */
    const withEditableExtra = {
      fields: [
        ...CURATED_FIELDS.fields,
        { field: "BT-23", visibility: "edit", type: "text", line: false },
      ],
    };
    const posted: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = String(url).split("?")[0];
        if (init?.method === "POST" && path.endsWith("/key")) {
          posted.push(JSON.parse(String(init.body)));
        }
        const bodies: Record<string, unknown> = {
          "/api/ui-strings": STRINGS,
          "/api/code-lists": { fields: {} },
          "/api/field-visibility": withEditableExtra,
          "/api/invoices/inv-1": { facts: {}, lines: [], validation: { passed: true, checked: [], failures: [] } },
          "/api/invoices/inv-1/document-url": { url: null },
          "/api/invoices/inv-1/progress": { inProcess: false, stages: [] },
          "/api/invoices/inv-1/key": { facts: {} },
        };
        if (!(path in bodies)) throw new Error(`no stub for ${path}`);
        return { ok: true, json: async () => bodies[path] } as Response;
      })
    );
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));

    const trigger = [...headerCard().querySelectorAll(".actionlink")].find(
      (a) => a.querySelector("span")?.textContent === "Header Fields"
    ) as HTMLButtonElement;
    trigger.click();
    await new Promise((r) => setTimeout(r, 0));

    (document.getElementById("f-BT-23") as HTMLInputElement).value = "urn:kept-after-close";

    const close = [...document.querySelectorAll(".popout .actionlink")].find(
      (a) => a.querySelector("span")?.textContent === "Close"
    ) as HTMLButtonElement;
    close.click();

    const save = [...document.querySelectorAll(".actionlink")].find(
      (a) => a.querySelector("span")?.textContent === "Save"
    ) as HTMLButtonElement;
    save.click();
    await new Promise((r) => setTimeout(r, 0));

    expect((posted[0] as { facts: Record<string, unknown> }).facts["BT-23"]).toBe("urn:kept-after-close");
  });

  it("hides the pop-out on Close, without removing its own fields from the page", async () => {
    /**
     * **Hidden, not removed** — decision 0292's own reason: `save()`
     * reads a field's value from `document.getElementById`, wherever
     * it lives in the page. An input built here and then deleted on
     * close would silently lose whatever was typed into it the next
     * time Save runs, since nothing would be left to read.
     */
    const withExtras = {
      fields: [
        ...CURATED_FIELDS.fields,
        { field: "BT-23", visibility: "edit", type: "text", line: false },
      ],
    };
    await open(withExtras, {});

    const trigger = [...headerCard().querySelectorAll(".actionlink")].find(
      (a) => a.querySelector("span")?.textContent === "Header Fields"
    ) as HTMLButtonElement;
    trigger.click();
    await new Promise((r) => setTimeout(r, 0));
    const backdrop = document.querySelector(".backdrop") as HTMLElement;
    expect(backdrop).not.toBeNull();
    expect(backdrop.hidden).toBe(false);

    (document.getElementById("f-BT-23") as HTMLInputElement).value = "urn:example";

    const close = [...document.querySelectorAll(".popout .actionlink")].find(
      (a) => a.querySelector("span")?.textContent === "Close"
    ) as HTMLButtonElement;
    close.click();

    expect(backdrop.hidden).toBe(true);
    // Still in the page — this is what save() depends on.
    expect((document.getElementById("f-BT-23") as HTMLInputElement)?.value).toBe("urn:example");
  });

  it("leaves a field's own slot empty, rather than the layout breaking, when a customer does not use it", async () => {
    // No Payment terms in this customer's own configuration.
    const withoutPaymentTerms = {
      fields: CURATED_FIELDS.fields.filter((f) => f.field !== "BT-20"),
    };
    await open(withoutPaymentTerms, {});

    expect(headerCard().textContent).not.toContain("Payment terms");
    // Still five columns — the third simply holds one field instead
    // of two, not a rearranged four-column layout.
    expect(headerCard().querySelectorAll(".headersummary > .hscolumn").length).toBe(5);
  });

  it("drops a column entirely, rather than reserving a blank grid track, when neither of its fields is configured", async () => {
    /**
     * **Reported live, from a screenshot**: "I am missing some fields
     * on the card" — a wide, unexplained gap where Purchase order and
     * Cost centre would have sat, because neither was in this
     * customer's own field-visibility configuration for the stage —
     * Cost centre specifically because it could never have been
     * (decision 0295, it's a line field), replaced on the card by
     * Payment terms (decision 0296). The scenario this test proves is
     * about an empty column generally, not either field specifically.
     */
    const withoutThirdColumn = {
      fields: CURATED_FIELDS.fields.filter((f) => f.field !== "BT-13" && f.field !== "BT-20"),
    };
    await open(withoutThirdColumn, {});

    expect(headerCard().querySelectorAll(".headersummary > .hscolumn").length).toBe(4);
  });

  it("reopens the same pop-out rather than building a second one, keeping whatever was already typed", async () => {
    /**
     * **A second call to `field()` for the same spec would be exactly
     * the duplicate-id problem this whole rewrite exists to avoid**,
     * just deferred from "the card and the pop-out overlap" to "the
     * pop-out was opened twice." `popoutBackdrop` is what prevents a
     * second build.
     */
    const withEditableExtra = {
      fields: [
        ...CURATED_FIELDS.fields,
        { field: "BT-23", visibility: "edit", type: "text", line: false },
      ],
    };
    await open(withEditableExtra, {});

    const trigger = () =>
      [...headerCard().querySelectorAll(".actionlink")].find(
        (a) => a.querySelector("span")?.textContent === "Header Fields"
      ) as HTMLButtonElement;

    trigger().click();
    await new Promise((r) => setTimeout(r, 0));
    (document.getElementById("f-BT-23") as HTMLInputElement).value = "urn:still-here";

    const close = [...document.querySelectorAll(".popout .actionlink")].find(
      (a) => a.querySelector("span")?.textContent === "Close"
    ) as HTMLButtonElement;
    close.click();

    trigger().click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelectorAll(".backdrop").length).toBe(1);
    expect((document.getElementById("f-BT-23") as HTMLInputElement).value).toBe("urn:still-here");
  });

  it("shows Payment terms in Purchase order's own column, decision 0296", async () => {
    // The operator's own follow-up: "replace the field Cost Center
    // with Terms, which should be a header field." Built properly —
    // BT-20 added to the closed vocabulary itself, not just this
    // screen — rather than folded into an existing field.
    await open(CURATED_FIELDS, { "BT-13": "PO-1", "BT-20": "Net 30" });

    const columns = headerCard().querySelectorAll(".headersummary > .hscolumn");
    const thirdColumnLabels = [...columns[2].querySelectorAll(".kf label")].map((l) => l.textContent);
    expect(thirdColumnLabels).toEqual(["Purchase order", "Payment terms"]);
  });

  it("orders Header Fields to match the operator's own mock-up, not whatever order the API returned them in", async () => {
    /**
     * **Decision 0297.** Given fields in a different order than the
     * mock-up's own sequence, the pop-out still reads Invoice number,
     * then Invoice type, then Issue date, then Business process —
     * proving the order is a deliberate sort, not an accident of
     * already-sorted test data.
     */
    const shuffled = {
      fields: [
        { field: "BT-23", visibility: "read", type: "text", line: false },
        { field: "BT-2", visibility: "read", type: "date", line: false },
        { field: "BT-3", visibility: "read", type: "text", line: false },
        { field: "BT-1", visibility: "edit", type: "text", line: false },
      ],
    };
    await open(shuffled, {});

    const trigger = [...headerCard().querySelectorAll(".actionlink")].find(
      (a) => a.querySelector("span")?.textContent === "Header Fields"
    ) as HTMLButtonElement;
    trigger.click();
    await new Promise((r) => setTimeout(r, 0));

    const labels = [...document.querySelectorAll(".popout .kf label")].map((l) => l.textContent);
    expect(labels).toEqual(["Invoice number", "Invoice type", "Issue date", "Business process"]);
  });

  it("puts a field the mock-up never named after every field it did, rather than dropping it", async () => {
    // A field not in the curated sequence at all — BT-109 (total
    // without VAT) isn't part of HEADER_FIELDS_ORDER — must still
    // appear, just after everything that is named.
    const withUnlisted = {
      fields: [
        { field: "BT-109", visibility: "read", type: "number", line: false },
        { field: "BT-2", visibility: "read", type: "date", line: false },
        { field: "BT-1", visibility: "edit", type: "text", line: false },
      ],
    };
    await open(withUnlisted, {});

    const trigger = [...headerCard().querySelectorAll(".actionlink")].find(
      (a) => a.querySelector("span")?.textContent === "Header Fields"
    ) as HTMLButtonElement;
    trigger.click();
    await new Promise((r) => setTimeout(r, 0));

    const labels = [...document.querySelectorAll(".popout .kf label")].map((l) => l.textContent);
    // BT-1, then BT-2, both named in the order; BT-109 unlisted, last.
    expect(labels).toEqual(["Invoice number", "Issue date", "Total without VAT"]);
  });

  it("the browser's own [hidden] default actually applies to .backdrop (decision 0294)", async () => {
    /**
     * **Reported live**: "The Close button does not work currently.
     * So when I open the pop-out, I cannot get away from the screen
     * unless I refresh the browser." The exact pattern decision 0271
     * already found and fixed once, in a different element: `.backdrop
     * { display: flex }` and the browser's own `[hidden] { display:
     * none }` land at equal specificity, and the author's own rule won
     * the tie — `popoutBackdrop.hidden = true` was setting the
     * attribute correctly; nothing was reading it.
     */
    const css = (await import("virtual:stylesheets")).default["app.css"];
    expect(css).toContain(".backdrop[hidden] { display: none; }");
  });

  it("moves Close into the pop-out's own header, beside the title", async () => {
    // The operator's own request: consistent with every other card's
    // action — cardHead()'s own Change Seller, headerSummary()'s own
    // Header Fields — top right, not a footer row of its own.
    const withOverflow = {
      fields: [...CURATED_FIELDS.fields, { field: "BT-23", visibility: "read", type: "text", line: false }],
    };
    await open(withOverflow, {});

    const trigger = [...headerCard().querySelectorAll(".actionlink")].find(
      (a) => a.querySelector("span")?.textContent === "Header Fields"
    ) as HTMLButtonElement;
    trigger.click();
    await new Promise((r) => setTimeout(r, 0));

    const close = [...document.querySelectorAll(".popout .cardhead .actionlink")].find(
      (a) => a.querySelector("span")?.textContent === "Close"
    );
    expect(close).not.toBeUndefined();
  });

  it("lays out each field as a row, name on the left and value on the right", async () => {
    // The operator's own request: "list the field in a single row
    // stacked, with field name on the left and field value on the
    // right."
    const withOverflow = {
      fields: [...CURATED_FIELDS.fields, { field: "BT-23", visibility: "read", type: "text", line: false }],
    };
    await open(withOverflow, { "BT-23": "urn:example" });

    const trigger = [...headerCard().querySelectorAll(".actionlink")].find(
      (a) => a.querySelector("span")?.textContent === "Header Fields"
    ) as HTMLButtonElement;
    trigger.click();
    await new Promise((r) => setTimeout(r, 0));

    const list = document.querySelector(".hffields");
    expect(list).not.toBeNull();
    expect(list?.querySelector(".kf")).not.toBeNull();
  });

  /**
   * **The one caller among nine that is not a problem — decision
   * 0493.** Every other `note()` call reports something that stopped a
   * person — nothing to reassign to, a blocked pop-up, a save that
   * failed — and gets the amber `systemalert` triangle. A successful
   * save is not one of those, and dressing it in the same warning
   * colour would say something had gone wrong when it had not — so
   * this checks the one caller that opts into `{ success: true }`
   * actually renders differently, not just that the whole nine share
   * one component.
   */
  it("shows the success-toned checkmark, not the warning triangle, when a save actually succeeds", async () => {
    const withEditableExtra = {
      fields: [...CURATED_FIELDS.fields, { field: "BT-23", visibility: "edit", type: "text", line: false }],
    };
    const posted: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = String(url).split("?")[0];
        if (init?.method === "POST" && path.endsWith("/key")) {
          posted.push(JSON.parse(String(init.body)));
        }
        const bodies: Record<string, unknown> = {
          "/api/ui-strings": STRINGS,
          "/api/code-lists": { fields: {} },
          "/api/field-visibility": withEditableExtra,
          "/api/invoices/inv-1": { facts: {}, lines: [], validation: { passed: true, checked: [], failures: [] } },
          "/api/invoices/inv-1/document-url": { url: null },
          "/api/invoices/inv-1/progress": { inProcess: false, stages: [] },
          "/api/invoices/inv-1/key": { facts: {} },
        };
        if (!(path in bodies)) throw new Error(`no stub for ${path}`);
        return { ok: true, json: async () => bodies[path] } as Response;
      })
    );
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));

    const trigger = [...headerCard().querySelectorAll(".actionlink")].find(
      (a) => a.querySelector("span")?.textContent === "Header Fields"
    ) as HTMLButtonElement;
    trigger.click();
    await new Promise((r) => setTimeout(r, 0));
    (document.getElementById("f-BT-23") as HTMLInputElement).value = "urn:example";

    const save = [...document.querySelectorAll(".actionlink")].find(
      (a) => a.querySelector("span")?.textContent === "Save"
    ) as HTMLButtonElement;
    save.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(posted).toHaveLength(1);
    const popout = document.querySelector(".popout.notealert");
    expect(popout).not.toBeNull();
    expect(popout!.querySelector(".notealert-icon")?.className).toContain("success");
  });
});

describe("an action that labels itself draws itself (decision 0229)", () => {
  /**
   * **A missing glyph renders an empty `<svg>`.**
   *
   * `icon()` ends `ICONS[name] ?? ""`, so an action whose name has no
   * entry gets a button with a label and a blank square. Nothing fails
   * and nothing logs — the same shape as decision 0223's undefined CSS
   * variable, which was also invisible until somebody looked.
   *
   * The glyph was registered as `swap` and looked up as `changeseller`.
   */
  it("draws a glyph for every action on the page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = String(url).split("?")[0];
        const bodies: Record<string, unknown> = {
          "/api/ui-strings": STRINGS,
          "/api/code-lists": { fields: {} },
          "/api/field-visibility": FIELDS,
          "/api/invoices/inv-1": {
            facts: {},
            lines: [],
            supplier: { erpIdentifier: "40118", name: "Northwind", isPaySite: true },
            buyer: { unitId: "acme-uk", unitName: "Acme UK", entityName: "Acme UK" },
            validation: { passed: true, checked: [], failures: [] },
          },
          "/api/invoices/inv-1/document-url": { url: null },
          "/api/invoices/inv-1/progress": { inProcess: false, stages: [] },
        };
        if (!(path in bodies)) throw new Error(`no stub for ${path}`);
        return { ok: true, json: async () => bodies[path] } as Response;
      })
    );

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));

    const blank = [...document.querySelectorAll(".actionlink")]
      // The language toggle's own exception — decision 0302, a
      // short-code badge rather than an SVG glyph, by request.
      .filter((b) => !b.querySelector(".langbadge"))
      .filter((b) => (b.querySelector("svg")?.innerHTML ?? "") === "");

    // Named, so a failure says which one rather than how many.
    expect(blank.map((b) => b.textContent)).toEqual([]);
  });
});

describe("the document/timeline tabs (decision 0269)", () => {
  const BASE_ROUTES = {
    "/api/code-lists": { fields: {} },
    "/api/ui-strings": STRINGS,
    "/api/field-visibility": FIELDS,
    "/api/invoices/inv-1": { facts: {}, lines: [], validation: { passed: true, checked: [], failures: [] } },
    "/api/invoices/inv-1/progress": { visits: [] },
  };

  function docTabButton() {
    return [...document.querySelectorAll(".doctab")].find((b) => b.textContent?.includes("Document"));
  }
  function timelineTabButton() {
    return [...document.querySelectorAll(".doctab")].find((b) => b.textContent?.includes("Timeline / Chat"));
  }

  it("shows the Document tab active by default, with the preview visible", async () => {
    stubFetch({ ...BASE_ROUTES, "/api/documents/inv-1/activity": { items: [] } });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});

    expect(docTabButton()?.className).toContain("on");
    expect(timelineTabButton()?.className).not.toContain("on");
    expect(document.getElementById("vpreview")?.closest("[hidden]")).toBeNull();
    expect(document.querySelector(".activitytabcontent")?.closest("[hidden]")).not.toBeNull();
  });

  it("loads the feed eagerly, showing a real count on the tab before it is ever clicked", async () => {
    // **Not lazy anymore** — decision 0269. The tab has to show how
    // much is there without being opened first, or "Timeline / Chat"
    // with no number would be a tab lying about its own contents for
    // its entire first moment on screen.
    const seen: string[] = [];
    stubFetch(
      {
        ...BASE_ROUTES,
        "/api/documents/inv-1/activity": {
          items: [
            { kind: "received", at: "2026-09-01 09:00:00" },
            { kind: "stage_completed", at: "2026-09-01 11:00:00", stageName: "Validation", userName: "Priya Patel" },
          ],
        },
      },
      seen
    );
    const real = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        seen.push(String(url).split("?")[0]);
        return real(url, init);
      })
    );

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));

    expect(seen.some((u) => u === "/api/documents/inv-1/activity")).toBe(true);
    expect(timelineTabButton()?.textContent).toContain("2");
  });

  it("switches to the Timeline tab without losing the loaded document preview", async () => {
    stubFetch({
      ...BASE_ROUTES,
      "/api/documents/inv-1/activity": {
        items: [{ kind: "received", at: "2026-09-01 09:00:00" }],
      },
    });

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));

    (timelineTabButton() as HTMLButtonElement).click();

    expect(timelineTabButton()?.className).toContain("on");
    expect(docTabButton()?.className).not.toContain("on");
    expect(document.body.textContent).toContain("Invoice received");
    // The preview node is still in the DOM, just hidden — not torn
    // down and rebuilt, which would have discarded whatever
    // showPreview() had already filled it with.
    expect(document.getElementById("vpreview")).not.toBeNull();

    (docTabButton() as HTMLButtonElement).click();
    expect(document.getElementById("vpreview")?.closest("[hidden]")).toBeNull();
  });

  it("phrases a fired rule from its own name and its own actions", async () => {
    stubFetch({
      ...BASE_ROUTES,
      "/api/documents/inv-1/activity": {
        items: [
          {
            kind: "rule_fired",
            at: "2026-09-01 09:16:00",
            ruleName: "Spend Threshold",
            actionDescriptions: ["routed to AP Review", "assigned to AP Team"],
          },
        ],
      },
    });

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));

    (timelineTabButton() as HTMLButtonElement).click();

    expect(document.body.textContent).toContain(
      "Business rule \u2018Spend Threshold\u2019 fired: routed to AP Review and assigned to AP Team"
    );
  });

  /**
   * **Decision 0409** \u2014 `activity-route.ts` now collapses a
   * line-scoped rule's own repeated firings into one entry per
   * (visit, rule), carrying which lines it matched rather than
   * discarding that. This is the display half: naming the lines
   * instead of silently dropping them.
   */
  it("names which lines a line-scoped rule fired on", async () => {
    stubFetch({
      ...BASE_ROUTES,
      "/api/documents/inv-1/activity": {
        items: [
          {
            kind: "rule_fired",
            at: "2026-09-01 09:16:00",
            ruleName: "Line Threshold",
            actionDescriptions: ["flagged it"],
            lines: [2, 5, 7],
          },
        ],
      },
    });

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));

    (timelineTabButton() as HTMLButtonElement).click();

    expect(document.body.textContent).toContain(
      "Business rule \u2018Line Threshold\u2019 fired: flagged it (lines 2, 5, 7)"
    );
  });

  it("says 'line', singular, for a rule that fired on exactly one", async () => {
    stubFetch({
      ...BASE_ROUTES,
      "/api/documents/inv-1/activity": {
        items: [
          {
            kind: "rule_fired",
            at: "2026-09-01 09:16:00",
            ruleName: "Line Threshold",
            actionDescriptions: ["flagged it"],
            lines: [4],
          },
        ],
      },
    });

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));

    (timelineTabButton() as HTMLButtonElement).click();

    expect(document.body.textContent).toContain("Business rule \u2018Line Threshold\u2019 fired: flagged it (line 4)");
  });

  it("adds nothing at all for an ordinary header-scoped firing", async () => {
    stubFetch({
      ...BASE_ROUTES,
      "/api/documents/inv-1/activity": {
        items: [
          {
            kind: "rule_fired",
            at: "2026-09-01 09:16:00",
            ruleName: "Spend Threshold",
            actionDescriptions: ["routed to AP Review"],
            lines: [],
          },
        ],
      },
    });

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));

    (timelineTabButton() as HTMLButtonElement).click();

    expect(document.body.textContent).toContain("Business rule \u2018Spend Threshold\u2019 fired: routed to AP Review");
    expect(document.body.textContent).not.toContain("(line");
  });

  /**
   * **Decision 0488** — a button/action taken renders with the real
   * action icon (`icons.js`'s own `claim` shape), not the generic
   * `.activitydot` every other system line uses.
   */
  it("shows a claim with its own icon, not the generic system dot", async () => {
    stubFetch({
      ...BASE_ROUTES,
      "/api/documents/inv-1/activity": {
        items: [{ kind: "action_taken", at: "2026-09-01 09:05:00", action: "claim", userName: "Priya Patel", comment: null }],
      },
    });

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));

    (timelineTabButton() as HTMLButtonElement).click();

    expect(document.body.textContent).toContain("Priya Patel claimed this task");
    expect(document.querySelector(".activityaction .activityactionicon svg")).not.toBeNull();
    expect(document.querySelectorAll(".activitysysline .activitydot")).toHaveLength(0);
  });

  it("shows a release's own comment underneath the message line", async () => {
    stubFetch({
      ...BASE_ROUTES,
      "/api/documents/inv-1/activity": {
        items: [
          {
            kind: "action_taken",
            at: "2026-09-01 09:10:00",
            action: "release",
            userName: "Priya Patel",
            comment: "Wrong queue, sending it back.",
          },
        ],
      },
    });

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));

    (timelineTabButton() as HTMLButtonElement).click();

    expect(document.body.textContent).toContain("Priya Patel released this task");
    expect(document.querySelector(".activityactioncomment")?.textContent).toBe("Wrong queue, sending it back.");
  });

  it("names the target stage on a return", async () => {
    stubFetch({
      ...BASE_ROUTES,
      "/api/documents/inv-1/activity": {
        items: [
          {
            kind: "action_taken",
            at: "2026-09-01 09:20:00",
            action: "return",
            userName: "Priya Patel",
            comment: "PO amount does not match",
            targetStageName: "Validation",
          },
        ],
      },
    });

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));

    (timelineTabButton() as HTMLButtonElement).click();

    expect(document.body.textContent).toContain("Priya Patel returned this to Validation");
  });

  it("says nothing about a target stage on a return to the supplier", async () => {
    stubFetch({
      ...BASE_ROUTES,
      "/api/documents/inv-1/activity": {
        items: [
          {
            kind: "action_taken",
            at: "2026-09-01 09:20:00",
            action: "return_to_supplier",
            userName: "Priya Patel",
            comment: "Wrong supplier entirely",
          },
        ],
      },
    });

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));

    (timelineTabButton() as HTMLButtonElement).click();

    expect(document.body.textContent).toContain("Priya Patel returned this to the supplier");
  });

  it("shows a discard with no comment line when none was given", async () => {
    stubFetch({
      ...BASE_ROUTES,
      "/api/documents/inv-1/activity": {
        items: [{ kind: "action_taken", at: "2026-09-01 09:20:00", action: "discard", userName: "Priya Patel", comment: null }],
      },
    });

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));

    (timelineTabButton() as HTMLButtonElement).click();

    expect(document.body.textContent).toContain("Priya Patel discarded this task");
    expect(document.querySelector(".activityactioncomment")).toBeNull();
  });

  /**
   * **Decision 0502.** A closed loop, checked rather than assumed: the
   * reason a discard's own picker now collects (`openDiscardPicker`,
   * posted as `reason`) is the same `end_reason` `activity-route.ts`'s
   * own `taskEndedEvents` already reads back as `comment` — the same
   * generic rendering `release`'s own comment test above already
   * covers, exercised here for `discard` specifically since nothing
   * had, until now.
   */
  it("shows a discard's own reason underneath the message line", async () => {
    stubFetch({
      ...BASE_ROUTES,
      "/api/documents/inv-1/activity": {
        items: [
          {
            kind: "action_taken",
            at: "2026-09-01 09:20:00",
            action: "discard",
            userName: "Priya Patel",
            comment: "Duplicate of inv-0",
          },
        ],
      },
    });

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));

    (timelineTabButton() as HTMLButtonElement).click();

    expect(document.body.textContent).toContain("Priya Patel discarded this task");
    expect(document.querySelector(".activityactioncomment")?.textContent).toBe("Duplicate of inv-0");
  });

  it("shows a comment with an avatar, not as a system line", async () => {
    stubFetch({
      ...BASE_ROUTES,
      "/api/documents/inv-1/activity": {
        items: [{ kind: "comment", id: "c-1", at: "2026-09-01 12:00:00", userName: "Priya Patel", body: "Checked with procurement." }],
      },
    });

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));

    (timelineTabButton() as HTMLButtonElement).click();

    expect(document.querySelector(".activitycomment .activityavatar")?.textContent).toBe("PP");
    expect(document.body.textContent).toContain("Checked with procurement.");
    expect(document.querySelectorAll(".activitysysline")).toHaveLength(0);
  });

  it("posts a comment and reloads the feed", async () => {
    const bodies: { path: string; method?: string; body: unknown }[] = [];
    let posted = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = String(url).split("?")[0];
        bodies.push({ path, method: init?.method, body: init?.body ? JSON.parse(init.body as string) : null });
        const routes: Record<string, unknown> = { ...BASE_ROUTES };
        routes["/api/documents/inv-1/activity"] = {
          items: posted ? [{ kind: "comment", id: "c-1", at: "2026-09-01 12:00:00", userName: "Priya Patel", body: "Noted." }] : [],
        };
        if (path === "/api/documents/inv-1/comments" && init?.method === "POST") {
          posted = true;
          return { ok: true, json: async () => ({ id: "c-1" }) } as Response;
        }
        if (!(path in routes)) throw new Error(`no stub for ${path}`);
        return { ok: true, json: async () => routes[path] } as Response;
      })
    );

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));

    (timelineTabButton() as HTMLButtonElement).click();

    (document.getElementById("activity-input") as HTMLTextAreaElement).value = "Noted.";
    (document.getElementById("activity-post") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));

    const post = bodies.find((b) => b.path === "/api/documents/inv-1/comments");
    expect(post?.body).toEqual({ body: "Noted." });
    expect(document.body.textContent).toContain("Noted.");
  });

  it("gives the post button an icon, matching every other action button", async () => {
    stubFetch({ ...BASE_ROUTES, "/api/documents/inv-1/activity": { items: [] } });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));

    (timelineTabButton() as HTMLButtonElement).click();

    const post = document.getElementById("activity-post");
    expect(post?.querySelector("svg")).not.toBeNull();
    expect(post?.textContent).toBe("Post");
  });

  it("actually hides the timeline pane visually, not only its own hidden property", async () => {
    /**
     * **Reported live**: "the timeline appears under the document
     * image, and also within the Timeline / Chat tab." `.hidden` as a
     * DOM property was set correctly the whole time — every test
     * above checking `.hidden` genuinely passed — but
     * `.activitytabcontent { display: flex }` overrides the browser's
     * own default `[hidden] { display: none }` once any other rule
     * sets `display` on the same element, and nothing here loads real
     * CSS to have caught that.
     *
     * Read from the stylesheet's own text instead, this app's
     * established pattern (decision 0257's stacking test, 0261's
     * margin test) for exactly this kind of thing.
     */
    const css = (await import("virtual:stylesheets")).default["app.css"];
    const rule = css.slice(
      css.indexOf(".activitytabcontent[hidden]"),
      css.indexOf(".activitytabcontent[hidden]") + 120
    );
    expect(rule).toContain("display: none");
  });

  it("actually hides the whole Timeline / Chat pane, not only .activitytabcontent inside it (decision 0506)", async () => {
    /**
     * **The same bug, reintroduced by decision 0504.** `timelinePane`
     * (`.vtimeline`) had no class, and so no `display` of its own,
     * until 0504 gave it `display: flex` — which is exactly what
     * stopped the browser's own default `[hidden] { display: none }`
     * from taking effect once `select()` sets `hidden` on it for the
     * Document/XML tabs. Reported live, against screenshots: with
     * Document selected, the System Alert still showed, floating over
     * the Invoice Lines card beneath it. Read from the stylesheet's
     * own text, the same reason the `.activitytabcontent[hidden]` test
     * just above does — jsdom applies no CSS at all.
     */
    const css = (await import("virtual:stylesheets")).default["app.css"];
    const rule = css.slice(css.indexOf(".c-document .vtimeline[hidden]"), css.indexOf(".c-document .vtimeline[hidden]") + 60);
    expect(rule).toContain("display: none");
  });

  it("shows the unreadable-document note in Timeline / Chat, not under the image, as a System Alert", async () => {
    /**
     * **Reported live**: "I would rather this information appeared in
     * the Timeline / Chat... it should be removed from beneath the
     * document image, to make room for the image." (decision 0271),
     * then: "have the look and feel of the mock-up... identified as a
     * 'System Alert'... it does not need to be highlighted in Orange"
     * (decision 0272).
     */
    stubFetch({
      ...BASE_ROUTES,
      "/api/invoices/inv-1": {
        facts: {},
        lines: [],
        validation: { passed: true, checked: [], failures: [] },
        intake: { readable: false, attempted: "OCR" },
      },
      "/api/documents/inv-1/activity": { items: [] },
    });

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));

    // Not visible while the Document tab is active — its own pane,
    // not `#vpreview` itself (which never contained it either way),
    // is what must be hidden.
    const alertPane = document.querySelector(".systemalert")?.closest("[hidden]");
    expect(alertPane).not.toBeNull();

    (timelineTabButton() as HTMLButtonElement).click();

    const note = document.querySelector(".systemalert");
    expect(note).not.toBeNull();
    expect(note?.querySelector(".systemalertlabel")?.textContent).toBe("System Alert");
    expect(note?.textContent).toContain("This document could not be read automatically");
    expect(note?.textContent).toContain("Tried: OCR");
  });

  it("does not colour the system alert orange", async () => {
    // **The operator's own words**: "it does not need to be
    // highlighted in Orange." Checked against the real stylesheet,
    // since jsdom applies no CSS at all.
    const css = (await import("virtual:stylesheets")).default["app.css"];
    const rule = css.slice(css.indexOf(".systemalert {"), css.indexOf(".systemalert {") + 300);
    expect(rule).not.toContain("--bg-warning");
    expect(rule).not.toContain("--text-warning");
  });

  it("gives the Timeline / Chat pane its own class, bounded to the card's real height (decision 0504)", async () => {
    /**
     * **Reported live, against two screenshots**: the reply box sat
     * hard against the card's bottom edge, and opening "Add person"
     * pushed the whole feed — reply box included — down into the
     * Invoice Lines card beneath it. `timelinePane` had no class of
     * its own until this decision, so none of `.c-document`'s own
     * height rules (the same ones `.vpreview` already relies on,
     * decision 0391) ever reached it — checked directly here, since
     * jsdom applies no CSS at all and a missing selector would
     * otherwise pass silently.
     */
    stubFetch({ ...BASE_ROUTES, "/api/documents/inv-1/activity": { items: [] } });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelector(".vtimeline")).not.toBeNull();

    const css = (await import("virtual:stylesheets")).default["app.css"];
    const heightRule = css.slice(css.indexOf(".c-document .vtimeline {"), css.indexOf(".c-document .vtimeline {") + 200);
    expect(heightRule).toContain("height: 100%");
    expect(heightRule).toContain("display: flex");
    expect(heightRule).toContain("flex-direction: column");

    // The reply box's own row keeps its natural height — it is the
    // feed above it that gives way, not the other way around.
    const inputRule = css.slice(css.indexOf(".activityinput {"), css.indexOf(".activityinput {") + 200);
    expect(inputRule).toContain("flex: 0 0 auto");

    const feedRule = css.slice(css.indexOf(".activityfeed {"), css.indexOf(".activityfeed {") + 200);
    expect(feedRule).not.toContain("max-height: 300px");
    expect(feedRule).toContain("min-height: 0");
  });

  it("shows no unreadable note anywhere when the document was read fine", async () => {
    stubFetch({
      ...BASE_ROUTES,
      "/api/invoices/inv-1": {
        facts: {},
        lines: [],
        validation: { passed: true, checked: [], failures: [] },
        intake: { readable: true },
      },
      "/api/documents/inv-1/activity": { items: [] },
    });

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));

    (timelineTabButton() as HTMLButtonElement).click();
    expect(document.querySelector(".systemalert")).toBeNull();
  });

  it("resets to the Document tab when a different document is opened", async () => {
    // **Not a global toggle any more** — decision 0269's own state
    // lives per document. Arriving at a second invoice must not carry
    // over whichever tab the first one was left on.
    stubFetch({ ...BASE_ROUTES, "/api/documents/inv-1/activity": { items: [] } });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));
    (timelineTabButton() as HTMLButtonElement).click();
    expect(timelineTabButton()?.className).toContain("on");

    const TASK_2 = { ...TASK, subject: { ...TASK.subject, id: "inv-2" } };
    stubFetch({
      ...BASE_ROUTES,
      "/api/invoices/inv-2": { facts: {}, lines: [], validation: { passed: true, checked: [], failures: [] } },
      "/api/invoices/inv-2/progress": { visits: [] },
      "/api/documents/inv-2/activity": { items: [] },
    });
    await openViewer(TASK_2, () => {});

    expect(docTabButton()?.className).toContain("on");
    expect(document.getElementById("vpreview")?.closest("[hidden]")).toBeNull();
  });


  it("never renders the literal text 'null' anywhere on the page", async () => {
    // **The bug found while wiring this in.** `unreadableNote()`
    // returns null in its common case, and `Node.append(null)`
    // stringifies rather than skips — confirmed directly against the
    // real DOM before this was fixed with `.filter(Boolean)`.
    stubFetch({ ...BASE_ROUTES, "/api/documents/inv-1/activity": { items: [] } });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});

    expect(document.body.innerHTML).not.toContain(">null<");
  });
});

describe("removing a collaborator (decision 0476)", () => {
  /**
   * `collaborators.js` itself has carried no dedicated coverage here
   * since it was built (decision 0470) — only the generic empty-roster
   * default `stubFetch()`'s own comment above already explains. These
   * four are scoped to decision 0476's own new behavior: the "x" on
   * each chip, a successful removal reloading the roster, a refused
   * one surfacing the real error without touching the roster, and the
   * button rendering unconditionally — this file's own established
   * habit of testing what was just built, not only what already broke
   * live, the same as decisions 0198, 0387, and most of the describe
   * blocks above.
   */
  function timelineTabButton() {
    return [...document.querySelectorAll(".doctab")].find((b) => b.textContent?.includes("Timeline / Chat"));
  }

  /**
   * A roster that starts with one collaborator and empties once the
   * remove button's own `DELETE` call succeeds — what `removePerson()`
   * itself relies on, since it reloads rather than filters locally
   * (the same read-after-write discipline `addPerson()` already uses).
   * `deleteOk: false` instead answers the `DELETE` with a 403, the same
   * shape the real route gives a caller without `AP.Manager`.
   */
  function stubWithRoster(deleteOk: boolean) {
    let removed = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = String(url).split("?")[0];
        const method = init?.method ?? "GET";
        if (path === "/api/documents/inv-1/collaborators" && method === "GET") {
          return {
            ok: true,
            json: async () => ({ collaborators: removed ? [] : [{ userId: "u-1", userName: "Alex Alvarez" }] }),
          } as Response;
        }
        if (path === "/api/documents/inv-1/collaborators/u-1" && method === "DELETE") {
          if (!deleteOk) return { ok: false, status: 403, json: async () => ({ error: "forbidden" }) } as Response;
          removed = true;
          return { ok: true, json: async () => ({}) } as Response;
        }
        const routes: Record<string, unknown> = {
          "/api/code-lists": { fields: {} },
          "/api/ui-strings": STRINGS,
          "/api/field-visibility": FIELDS,
          "/api/invoices/inv-1": { facts: {}, lines: [], validation: { passed: true, checked: [], failures: [] } },
          "/api/invoices/inv-1/progress": { visits: [] },
          "/api/documents/inv-1/activity": { items: [] },
        };
        if (path in routes) return { ok: true, json: async () => routes[path] } as Response;
        if (/^\/api\/invoices\/[^/]+\/pages$/.test(path)) {
          return { ok: true, json: async () => ({ pages: [] }) } as Response;
        }
        throw new Error(`no stub for ${method} ${path} — add one, or the test proves nothing`);
      })
    );
  }

  async function openOnTimeline() {
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));
    (timelineTabButton() as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
  }

  it("renders a remove button on every collaborator chip", async () => {
    stubWithRoster(true);
    await openOnTimeline();

    const chip = document.querySelector(".collabchip");
    expect(chip?.textContent).toContain("Alex Alvarez");
    expect(chip?.querySelector(".collabchipremove")).not.toBeNull();
  });

  it("removing a collaborator reloads the roster — the chip is gone, not just hidden", async () => {
    stubWithRoster(true);
    await openOnTimeline();
    expect(document.querySelectorAll(".collabchip").length).toBe(1);

    (document.querySelector(".collabchipremove") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelectorAll(".collabchip").length).toBe(0);
  });

  it("shows the real error inline and leaves the chip in place when removal is refused", async () => {
    stubWithRoster(false);
    await openOnTimeline();

    (document.querySelector(".collabchipremove") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelectorAll(".collabchip").length).toBe(1);
    expect(document.body.textContent).toContain("Could not remove that person. Try again.");
  });

  it("shows the remove button unconditionally — the server, not the client, is the real gate", async () => {
    // **No client-side permission check here at all.** `collaborators.js`'s
    // own doc comment states the discipline directly: never hide a
    // control the caller cannot use. This test exists so a future
    // change that adds client-side gating (say, checking `whoami`'s
    // own permission list before rendering the button) gets caught the
    // moment it changes this behavior, not discovered live.
    stubWithRoster(true);
    await openOnTimeline();

    expect(document.querySelector(".collabchipremove")).not.toBeNull();
  });
});

describe("the XML tab, offered only when it exists (decision 0273, widened by 0383)", () => {
  const BASE_ROUTES = {
    "/api/code-lists": { fields: {} },
    "/api/ui-strings": STRINGS,
    "/api/field-visibility": FIELDS,
    "/api/invoices/inv-1/progress": { visits: [] },
    "/api/documents/inv-1/activity": { items: [] },
  };

  function xmlTabButton() {
    return [...document.querySelectorAll(".doctab")].find((b) => b.textContent === "XML");
  }
  function docTabButton() {
    return [...document.querySelectorAll(".doctab")].find((b) => b.textContent?.includes("Document"));
  }

  it("offers no XML tab when the original was never XML", async () => {
    stubFetch({
      ...BASE_ROUTES,
      "/api/invoices/inv-1": {
        facts: {},
        lines: [],
        validation: { passed: true, checked: [], failures: [] },
        originalDocument: { contentType: "application/pdf" },
      },
    });

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});

    expect(xmlTabButton()).toBeUndefined();
  });

  it("offers no XML tab when there is no original at all", async () => {
    stubFetch({
      ...BASE_ROUTES,
      "/api/invoices/inv-1": {
        facts: {},
        lines: [],
        validation: { passed: true, checked: [], failures: [] },
        originalDocument: null,
      },
    });

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});

    expect(xmlTabButton()).toBeUndefined();
  });

  it("offers the XML tab when the original genuinely is XML", async () => {
    // **A custom mock, not the shared `stubFetch` helper.** That
    // helper strips the query string before recording what was
    // called, which hides exactly the thing this test needs to see:
    // whether `type=original` was actually asked for.
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        seen.push(String(url));
        const path = String(url).split("?")[0];
        const routes: Record<string, unknown> = {
          ...BASE_ROUTES,
          "/api/invoices/inv-1": {
            facts: {},
            lines: [],
            validation: { passed: true, checked: [], failures: [] },
            originalDocument: { contentType: "application/xml" },
          },
          "/api/invoices/inv-1/document-url": { url: "https://files.example/inv-1.xml" },
        };
        if (!(path in routes)) throw new Error(`no stub for ${path}`);
        return { ok: true, json: async () => routes[path] } as Response;
      })
    );

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));

    expect(xmlTabButton()).not.toBeUndefined();

    // **Asked for the original specifically**, not whatever is
    // preferred for the main preview — decision 0273's own point.
    expect(seen.some((u) => u.includes("/document-url") && u.includes("type=original"))).toBe(true);
  });

  it("offers the XML tab for a hybrid PDF that retained its embedded invoice — decision 0383", async () => {
    // The original here is the outer PDF, not XML — this is exactly
    // the case `hasXml`'s content-type check alone would miss, which
    // is why `embeddedXmlDocument` is checked too.
    stubFetch({
      ...BASE_ROUTES,
      "/api/invoices/inv-1": {
        facts: {},
        lines: [],
        validation: { passed: true, checked: [], failures: [] },
        originalDocument: { contentType: "application/pdf" },
        embeddedXmlDocument: { contentType: "application/xml" },
      },
    });

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});

    expect(xmlTabButton()).not.toBeUndefined();
  });

  it("asks for the embedded XML specifically, not the outer PDF, for a hybrid invoice", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        seen.push(String(url));
        const path = String(url).split("?")[0];
        const routes: Record<string, unknown> = {
          ...BASE_ROUTES,
          "/api/invoices/inv-1": {
            facts: {},
            lines: [],
            validation: { passed: true, checked: [], failures: [] },
            originalDocument: { contentType: "application/pdf" },
            embeddedXmlDocument: { contentType: "application/xml" },
          },
          "/api/invoices/inv-1/document-url": { url: "https://files.example/inv-1-embedded.xml" },
        };
        if (!(path in routes)) throw new Error(`no stub for ${path}`);
        return { ok: true, json: async () => routes[path] } as Response;
      })
    );

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));

    expect(seen.some((u) => u.includes("/document-url") && u.includes("type=embedded_xml"))).toBe(true);
    expect(seen.some((u) => u.includes("/document-url") && u.includes("type=original"))).toBe(false);
  });

  it("switches to the XML tab and shows the fetched document, without disturbing the Document tab", async () => {
    stubFetch({
      ...BASE_ROUTES,
      "/api/invoices/inv-1": {
        facts: {},
        lines: [],
        validation: { passed: true, checked: [], failures: [] },
        originalDocument: { contentType: "application/xml" },
      },
      "/api/invoices/inv-1/document-url": { url: "https://files.example/inv-1.xml" },
    });

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));

    (xmlTabButton() as HTMLButtonElement).click();

    expect(xmlTabButton()?.className).toContain("on");
    expect(document.getElementById("vxml")?.closest("[hidden]")).toBeNull();
    expect(document.getElementById("vxml")?.querySelector("iframe")?.getAttribute("src")).toBe(
      "https://files.example/inv-1.xml"
    );
    // The Document pane is hidden, not gone — switching back must
    // still find #vpreview intact.
    expect(document.getElementById("vpreview")?.closest("[hidden]")).not.toBeNull();

    (docTabButton() as HTMLButtonElement).click();
    expect(document.getElementById("vpreview")?.closest("[hidden]")).toBeNull();
  });

  it("falls back to the Document tab when a new document has no XML to show", async () => {
    // **The tab list is rebuilt per document, not carried over.**
    // `openViewer()` already resets `docPanelTab` to `"doc"`
    // unconditionally for every document (decision 0269) — this test
    // checks the other half: that the XML tab itself genuinely
    // disappears for a document with none, not just that the active
    // selection moved.
    stubFetch({
      ...BASE_ROUTES,
      "/api/invoices/inv-1": {
        facts: {},
        lines: [],
        validation: { passed: true, checked: [], failures: [] },
        originalDocument: { contentType: "application/xml" },
      },
      "/api/invoices/inv-1/document-url": { url: "https://files.example/inv-1.xml" },
    });

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});
    await new Promise((r) => setTimeout(r, 0));
    (xmlTabButton() as HTMLButtonElement).click();
    expect(xmlTabButton()?.className).toContain("on");

    const TASK_2 = { ...TASK, subject: { ...TASK.subject, id: "inv-2" } };
    stubFetch({
      ...BASE_ROUTES,
      "/api/invoices/inv-2": {
        facts: {},
        lines: [],
        validation: { passed: true, checked: [], failures: [] },
        originalDocument: null,
      },
      "/api/invoices/inv-2/progress": { visits: [] },
      "/api/documents/inv-2/activity": { items: [] },
    });
    await openViewer(TASK_2, () => {});

    expect(xmlTabButton()).toBeUndefined();
    expect(docTabButton()?.className).toContain("on");
    expect(document.getElementById("vpreview")?.closest("[hidden]")).toBeNull();
  });
});

describe("the Back button matches the other topbar actions (decision 0284)", () => {
  const ROUTES = {
    "/api/code-lists": { fields: {} },
    "/api/ui-strings": STRINGS,
    "/api/field-visibility": FIELDS,
    "/api/invoices/inv-1": { facts: {}, lines: [], validation: { passed: true, checked: [], failures: [] } },
    "/api/invoices/inv-1/progress": { visits: [] },
    "/api/documents/inv-1/activity": { items: [] },
  };

  /**
   * **Reported live, from a screenshot**: "Back to tasks" sat in the
   * same row as Sign out, a bordered rectangle with no icon beside a
   * clean icon-and-label button — "also appears to not comply with
   * the style, and missing an icon... updated to read simply 'Back'."
   */
  function backButton() {
    return [...document.querySelectorAll(".topbar button")].find(
      (b) => b.getAttribute("title") === "Back"
    );
  }

  it("reads \"Back\", carries an icon, and shares the actionlink class other topbar buttons use", async () => {
    stubFetch(ROUTES);

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(TASK, () => {});

    const back = backButton();
    expect(back).not.toBeUndefined();
    expect(back?.className).toContain("actionlink");
    expect(back?.querySelector("svg")).not.toBeNull();
    expect(back?.textContent).toBe("Back");
  });

  it("still calls the close handler when clicked", async () => {
    stubFetch(ROUTES);

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    let closed = false;
    await openViewer(TASK, () => {
      closed = true;
    });

    (backButton() as HTMLButtonElement).click();
    expect(closed).toBe(true);
  });
});

/**
 * **The invoice-line Coding pop-out — decision 0453.** The operator's
 * own ask: *"a pop-out, that is accessible from a Coding icon on the
 * invoice line... show the Org / Company Code and optional Cost
 * Center or Project, then provide the linked Commodity and General
 * Ledger Code. Each should expose a searchable drop-down that searches
 * across the already created Account Coding lists."*
 */
describe("the invoice-line Coding pop-out (decision 0453)", () => {
  const CODING_STRINGS = {
    ...STRINGS.strings,
    "action.coding": "Coding",
    "viewer.coding.heading": "Line coding",
    "viewer.coding.searchhint": "Type to search",
    "viewer.coding.nomatches": "Nothing on file matches that.",
    "viewer.coding.searchfailed": "We could not reach the service to search.",
    "viewer.coding.clear": "Clear",
    "viewer.coding.noteditable": "Not editable at this stage",
    "viewer.coding.suggested": "Suggested from this supplier's own history — review before saving.",
    "viewer.coding.resultsfor": "Results for",
    "viewer.coding.nomatchesscoped": "Narrowed by:",
    "apsetup.codingtab.companycode": "Org / Company Code",
    "apsetup.codingtab.commoditycode": "Commodity Code",
    "field.bt-133": "Cost centre",
    "field.coding.project": "Project",
    "field.coding.commodity_code": "Commodity code",
    "field.coding.gl_code": "General ledger code",
  };

  // Cost Centre and Project both `edit`; Commodity Code `read` (visible
  // but not editable here); General Ledger Code absent entirely — the
  // real resolver's own way of saying "hidden" (`field-visibility-
  // route.ts` never returns a hidden field at all).
  const CODING_FIELDS = {
    fields: [
      { field: "BT-131", visibility: "edit", type: "number", line: true, description: "line net" },
      { field: "BT-133", visibility: "edit", type: "text", line: true, description: "cost centre" },
      { field: "coding.project", visibility: "edit", type: "text", line: true, description: "project" },
      { field: "coding.commodity_code", visibility: "read", type: "text", line: true, description: "commodity code" },
    ],
  };

  function stub(routes: Record<string, unknown>, calls: string[] = [], bodies: { path: string; body: unknown }[] = []) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(String(url));
        const path = String(url).split("?")[0];
        if (init?.body) bodies.push({ path, body: JSON.parse(init.body as string) });
        const base: Record<string, unknown> = {
          "/api/ui-strings": { locale: "en", strings: CODING_STRINGS },
          "/api/code-lists": { fields: {} },
          "/api/field-visibility": CODING_FIELDS,
          "/api/invoices/inv-1": {
            facts: {},
            lines: [{ lineNumber: 1, facts: { "BT-131": 100, "BT-133": "cc1" } }],
            validation: { passed: true, checked: [], failures: [] },
            supplier: null,
            buyer: { unitId: "UK01", unitName: "Acme UK", entityName: "Acme UK", vatId: "GB1" },
            orgUnitId: "UK01",
          },
          "/api/invoices/inv-1/document-url": { url: null },
          "/api/invoices/inv-1/progress": { inProcess: false, stages: [] },
          "/api/invoices/inv-1/pages": { pages: [] },
          "/api/documents/inv-1/activity": { items: [] },
          "/api/invoices/inv-1/key": { ok: true },
          "/api/invoices/inv-1/coding-suggestions": { suggestions: {} },
          ...routes,
        };
        if (path in base) return { ok: true, json: async () => base[path] } as Response;
        throw new Error(`no stub for ${path}`);
      })
    );
    return { calls, bodies };
  }

  async function openAndClickCoding(task: Record<string, unknown> = TASK) {
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { openViewer } = await import("/viewer.js");
    await openViewer(task, () => {});
    await new Promise((r) => setTimeout(r, 0));

    (document.querySelector('button[title="Coding"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
  }

  it("shows a Coding icon on the line regardless of edit permission — viewing is not editing", async () => {
    stub({});
    await openAndClickCoding();
    // Opened at all: the click above found the button and the
    // pop-out it opens is on the page.
    expect(document.querySelector(".popout")).not.toBeNull();
    expect(document.querySelector(".popout h3")?.textContent).toBe("Line coding");
  });

  it("shows the invoice's own Company Code, read-only", async () => {
    stub({});
    await openAndClickCoding();

    const rows = [...document.querySelectorAll(".popout .editgrid > *")];
    const labelIndex = rows.findIndex((r) => r.textContent === "Org / Company Code");
    expect(labelIndex).toBeGreaterThanOrEqual(0);
    expect(rows[labelIndex + 1]?.textContent).toBe("Acme UK");
  });

  it("resolves the line's own already-keyed Cost Centre to its name", async () => {
    stub({
      "/api/org/cost-centres": { costCentres: [{ id: "cc1", name: "Marketing", filters: [] }], total: 1, page: 1, pageSize: 50 },
    });
    await openAndClickCoding();
    await new Promise((r) => setTimeout(r, 0)); // the resolveCurrent() lookup

    const costCentreBox = document.querySelectorAll(".popout .searchbox")[0] as HTMLInputElement;
    expect(costCentreBox.value).toBe("Marketing");
  });

  it("a field not configured editable at this stage shows read-only, with a note it isn't editable here", async () => {
    stub({});
    await openAndClickCoding();

    const rowsText = document.querySelector(".popout .editgrid")?.textContent ?? "";
    // General Ledger Code — absent from field-visibility entirely.
    expect(rowsText).toContain("Not editable at this stage");
  });

  it("a field configured read (visible but not editable) shows its value without that note", async () => {
    stub({});
    await openAndClickCoding();

    const rows = [...document.querySelectorAll(".popout .editgrid > *")];
    const commodityLabelIndex = rows.findIndex((r) => r.textContent === "Commodity code");
    const commodityValueBlock = rows[commodityLabelIndex + 1];
    expect(commodityValueBlock?.textContent).not.toContain("Not editable at this stage");
  });

  it("searches Project as the operator types, and choosing one reaches the Save payload", async () => {
    const calls: string[] = [];
    const bodies: { path: string; body: unknown }[] = [];
    stub(
      {
        "/api/org/cost-centres": { costCentres: [{ id: "cc1", name: "Marketing", filters: [] }], total: 1, page: 1, pageSize: 50 },
        "/api/coding-lists/project": { entries: [{ id: "proj-1", name: "Mjolner", filters: [] }], declaredFilters: [], total: 1, page: 1, pageSize: 50 },
      },
      calls,
      bodies
    );
    await openAndClickCoding();
    await new Promise((r) => setTimeout(r, 0));

    const searchBoxes = [...document.querySelectorAll(".popout .searchbox")] as HTMLInputElement[];
    const projectBox = searchBoxes[1]; // Cost Centre, then Project, per CODING_PICKER_FIELDS' own order
    projectBox.value = "mjol";
    projectBox.oninput?.(new Event("input"));
    await new Promise((r) => setTimeout(r, 0));

    expect(calls.some((c) => c.startsWith("/api/coding-lists/project?") && c.includes("search=mjol"))).toBe(true);

    const result = [...document.querySelectorAll(".popout .searchresult")].find((r) => r.textContent?.includes("Mjolner"));
    (result as HTMLButtonElement).click();

    // Close the pop-out, then Save the document — the pop-out itself
    // never calls /key; the page's own existing Save button does,
    // reading the same `line["coding.project"]` this choice set.
    (document.querySelector(".popout .actionlink") as HTMLButtonElement).click();

    const saveButton = [...document.querySelectorAll(".actionlink span")].find((s) => s.textContent === "Save")?.closest("button");
    (saveButton as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));

    const keyPost = bodies.find((b) => b.path === "/api/invoices/inv-1/key");
    const line = (keyPost?.body as { lines: { facts: Record<string, unknown> }[] })?.lines?.[0];
    expect(line?.facts["coding.project"]).toBe("proj-1");
  });

  it("clearing a chosen value removes it from what Save sends", async () => {
    const calls: string[] = [];
    const bodies: { path: string; body: unknown }[] = [];
    stub(
      { "/api/org/cost-centres": { costCentres: [{ id: "cc1", name: "Marketing", filters: [] }], total: 1, page: 1, pageSize: 50 } },
      calls,
      bodies
    );
    await openAndClickCoding();
    await new Promise((r) => setTimeout(r, 0));

    const clearButtons = document.querySelectorAll(".popout .codingsearch button.rm");
    (clearButtons[0] as HTMLButtonElement).click(); // Cost Centre's own clear button

    (document.querySelector(".popout .actionlink") as HTMLButtonElement).click();

    const saveButton = [...document.querySelectorAll(".actionlink span")].find((s) => s.textContent === "Save")?.closest("button");
    (saveButton as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));

    const keyPost = bodies.find((b) => b.path === "/api/invoices/inv-1/key");
    const line = (keyPost?.body as { lines: { facts: Record<string, unknown> }[] })?.lines?.[0];
    expect(line?.facts["BT-133"]).toBeUndefined();
  });

  it("General Ledger Code's picker is linked to Company Code always, and to Commodity Code once chosen", async () => {
    const calls: string[] = [];
    stub(
      {
        "/api/field-visibility": {
          fields: [
            ...CODING_FIELDS.fields.map((f) => (f.field === "coding.commodity_code" ? { ...f, visibility: "edit" } : f)),
            { field: "coding.gl_code", visibility: "edit", type: "text", line: true, description: "general ledger code" },
          ],
        },
        "/api/org/cost-centres": { costCentres: [{ id: "cc1", name: "Marketing", filters: [] }], total: 1, page: 1, pageSize: 50 },
        "/api/coding-lists/commodity_code": { entries: [{ id: "com-1", name: "Live Plant Material", filters: [] }], declaredFilters: [], total: 1, page: 1, pageSize: 50 },
        "/api/coding-lists/gl_code": { entries: [{ id: "gl-1", name: "Plant Suppliers", filters: [] }], declaredFilters: ["company_code", "commodity_code"], total: 1, page: 1, pageSize: 50 },
      },
      calls
    );
    await openAndClickCoding();
    await new Promise((r) => setTimeout(r, 0));

    const searchBoxes = [...document.querySelectorAll(".popout .searchbox")] as HTMLInputElement[];
    // Cost Centre, Project, Commodity Code, General Ledger Code — the
    // order `CODING_PICKER_FIELDS` itself declares.
    const commodityBox = searchBoxes[2];
    const glBox = searchBoxes[3];

    glBox.value = "plant";
    glBox.oninput?.(new Event("input"));
    await new Promise((r) => setTimeout(r, 0));
    const beforeCommodity = calls.find((c) => c.startsWith("/api/coding-lists/gl_code?") && c.includes("search=plant"));
    expect(beforeCommodity).toContain("filter.company_code=UK01");
    expect(beforeCommodity).not.toContain("filter.commodity_code=");

    commodityBox.value = "live";
    commodityBox.oninput?.(new Event("input"));
    await new Promise((r) => setTimeout(r, 0));
    const commodityResult = [...document.querySelectorAll(".popout .searchresult")].find((r) => r.textContent?.includes("Live Plant Material"));
    (commodityResult as HTMLButtonElement).click();

    calls.length = 0;
    glBox.value = "plant2";
    glBox.oninput?.(new Event("input"));
    await new Promise((r) => setTimeout(r, 0));
    const afterCommodity = calls.find((c) => c.startsWith("/api/coding-lists/gl_code?") && c.includes("search=plant2"));
    expect(afterCommodity).toContain("filter.company_code=UK01");
    expect(afterCommodity).toContain("filter.commodity_code=com-1");
  });

  /**
   * **Account Coding suggestions — decision 0457.** A field with no
   * existing value is pre-filled from `/coding-suggestions` and shown
   * with a visible "suggested" note, so the person sees a default
   * without having to have already trusted it.
   */
  it("pre-fills a field that has no existing value from a coding suggestion, with a visible note", async () => {
    stub({
      "/api/invoices/inv-1/coding-suggestions": {
        suggestions: { "coding.project": { value: "proj-9", confidence: 0.8, sampleSize: 5 } },
      },
      "/api/coding-lists/project": {
        entries: [{ id: "proj-9", name: "Mjolner Refit", filters: [] }],
        declaredFilters: [],
        total: 1,
        page: 1,
        pageSize: 50,
      },
    });
    await openAndClickCoding();
    await new Promise((r) => setTimeout(r, 0));

    const searchBoxes = [...document.querySelectorAll(".popout .searchbox")] as HTMLInputElement[];
    const projectBox = searchBoxes[1]; // Cost Centre, then Project, per CODING_PICKER_FIELDS' own order
    expect(projectBox.value).toBe("Mjolner Refit");

    const note = document.getElementById("codingsuggested-coding.project");
    expect(note?.textContent).toBe("Suggested from this supplier's own history — review before saving.");
  });

  it("Save persists a pre-filled suggestion even without an explicit click, the same as any other keyed value", async () => {
    const bodies: { path: string; body: unknown }[] = [];
    stub(
      {
        "/api/invoices/inv-1/coding-suggestions": {
          suggestions: { "coding.project": { value: "proj-9", confidence: 0.8, sampleSize: 5 } },
        },
        "/api/coding-lists/project": {
          entries: [{ id: "proj-9", name: "Mjolner Refit", filters: [] }],
          declaredFilters: [],
          total: 1,
          page: 1,
          pageSize: 50,
        },
      },
      [],
      bodies
    );
    await openAndClickCoding();
    await new Promise((r) => setTimeout(r, 0));

    (document.querySelector(".popout .actionlink") as HTMLButtonElement).click();
    const saveButton = [...document.querySelectorAll(".actionlink span")].find((s) => s.textContent === "Save")?.closest("button");
    (saveButton as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));

    const keyPost = bodies.find((b) => b.path === "/api/invoices/inv-1/key");
    const line = (keyPost?.body as { lines: { facts: Record<string, unknown> }[] })?.lines?.[0];
    expect(line?.facts["coding.project"]).toBe("proj-9");
  });

  it("choosing a value for a suggested field — even the same one — clears the suggested note, since it's now the person's own choice", async () => {
    stub({
      "/api/invoices/inv-1/coding-suggestions": {
        suggestions: { "coding.project": { value: "proj-9", confidence: 0.8, sampleSize: 5 } },
      },
      "/api/coding-lists/project": {
        entries: [{ id: "proj-9", name: "Mjolner Refit", filters: [] }],
        declaredFilters: [],
        total: 1,
        page: 1,
        pageSize: 50,
      },
    });
    await openAndClickCoding();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.getElementById("codingsuggested-coding.project")).not.toBeNull();

    const searchBoxes = [...document.querySelectorAll(".popout .searchbox")] as HTMLInputElement[];
    const projectBox = searchBoxes[1];
    projectBox.value = "mjol";
    projectBox.oninput?.(new Event("input"));
    await new Promise((r) => setTimeout(r, 0));

    const result = [...document.querySelectorAll(".popout .searchresult")].find((r) => r.textContent?.includes("Mjolner Refit"));
    (result as HTMLButtonElement).click();

    expect(document.getElementById("codingsuggested-coding.project")).toBeNull();
  });

  it("a field that already has a value on the line is never overwritten by a suggestion", async () => {
    // Cost Centre (BT-133) already has "cc1" on the stubbed line — a
    // suggestion for it must not replace or flag that existing value.
    stub({
      "/api/invoices/inv-1/coding-suggestions": {
        suggestions: { "BT-133": { value: "cc-other", confidence: 0.9, sampleSize: 10 } },
      },
    });
    await openAndClickCoding();
    await new Promise((r) => setTimeout(r, 0));

    const searchBoxes = [...document.querySelectorAll(".popout .searchbox")] as HTMLInputElement[];
    const costCentreBox = searchBoxes[0];
    expect(costCentreBox.value).toBe("cc1");
    expect(document.getElementById("codingsuggested-BT-133")).toBeNull();
  });

  /**
   * **A fixed-size pop-out with one shared results area — decision
   * 0458.** Reported live from a mock-up: each field's own results
   * used to grow and shrink the whole pop-out on every keystroke.
   */
  describe("the pop-out's own size and its shared results area (decision 0458)", () => {
    it("is a fixed-size pop-out, with the results area a sibling of the field grid, not nested inside it", async () => {
      stub({});
      await openAndClickCoding();

      const popout = document.querySelector(".popout");
      expect(popout?.classList.contains("codingpopout")).toBe(true);
      expect(document.querySelector(".popout.codingpopout > .editgrid")).not.toBeNull();
      expect(document.querySelector(".popout.codingpopout > .codingresults")).not.toBeNull();
    });

    it("has exactly one results list for all four fields, not one each", async () => {
      stub({});
      await openAndClickCoding();
      expect(document.querySelectorAll(".codingresultslist").length).toBe(1);
    });

    it("labels the shared results area with whichever field was searched, and switching fields replaces what it shows", async () => {
      stub({
        "/api/org/cost-centres": { costCentres: [{ id: "cc9", name: "Engineering West", filters: [] }], total: 1, page: 1, pageSize: 50 },
        "/api/coding-lists/project": { entries: [{ id: "proj-1", name: "Mjolner", filters: [] }], declaredFilters: [], total: 1, page: 1, pageSize: 50 },
      });
      await openAndClickCoding();
      await new Promise((r) => setTimeout(r, 0));

      const searchBoxes = [...document.querySelectorAll(".popout .searchbox")] as HTMLInputElement[];
      const costCentreBox = searchBoxes[0];
      const projectBox = searchBoxes[1];

      costCentreBox.value = "eng";
      costCentreBox.oninput?.(new Event("input"));
      await new Promise((r) => setTimeout(r, 0));
      expect(document.querySelector(".codingresultslabel")?.textContent).toBe("Results for Cost centre");
      expect(document.querySelector(".codingresultslist")?.textContent).toContain("Engineering West");

      projectBox.value = "mjol";
      projectBox.oninput?.(new Event("input"));
      await new Promise((r) => setTimeout(r, 0));
      expect(document.querySelector(".codingresultslabel")?.textContent).toBe("Results for Project");
      const listText = document.querySelector(".codingresultslist")?.textContent ?? "";
      expect(listText).toContain("Mjolner");
      expect(listText).not.toContain("Engineering West");
    });

    it("a slower search from a field the person has since left does not overwrite a faster one from the field they moved to", async () => {
      let resolveCostCentres: (() => void) | undefined;
      const costCentresGate = new Promise<void>((resolve) => {
        resolveCostCentres = resolve;
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          const path = String(url).split("?")[0];
          const base: Record<string, unknown> = {
            "/api/ui-strings": { locale: "en", strings: CODING_STRINGS },
            "/api/code-lists": { fields: {} },
            "/api/field-visibility": CODING_FIELDS,
            "/api/invoices/inv-1": {
              facts: {},
              lines: [{ lineNumber: 1, facts: { "BT-131": 100, "BT-133": "cc1" } }],
              validation: { passed: true, checked: [], failures: [] },
              supplier: null,
              buyer: { unitId: "UK01", unitName: "Acme UK", entityName: "Acme UK", vatId: "GB1" },
              orgUnitId: "UK01",
            },
            "/api/invoices/inv-1/document-url": { url: null },
            "/api/invoices/inv-1/progress": { inProcess: false, stages: [] },
            "/api/invoices/inv-1/pages": { pages: [] },
            "/api/documents/inv-1/activity": { items: [] },
            "/api/invoices/inv-1/key": { ok: true },
            "/api/invoices/inv-1/coding-suggestions": { suggestions: {} },
            "/api/coding-lists/project": { entries: [{ id: "proj-1", name: "Mjolner", filters: [] }], declaredFilters: [], total: 1, page: 1, pageSize: 50 },
          };
          if (path === "/api/org/cost-centres") {
            // Never resolves until the test explicitly lets it — the
            // slow search a person has already typed past.
            await costCentresGate;
            return { ok: true, json: async () => ({ costCentres: [{ id: "cc9", name: "Engineering West", filters: [] }], total: 1, page: 1, pageSize: 50 }) } as Response;
          }
          if (path in base) return { ok: true, json: async () => base[path] } as Response;
          throw new Error(`no stub for ${path}`);
        })
      );

      await openAndClickCoding();
      await new Promise((r) => setTimeout(r, 0));

      const searchBoxes = [...document.querySelectorAll(".popout .searchbox")] as HTMLInputElement[];
      const costCentreBox = searchBoxes[0];
      const projectBox = searchBoxes[1];

      // Typed into Cost Centre first — its own fetch is now in flight,
      // gated open, waiting.
      costCentreBox.value = "eng";
      costCentreBox.oninput?.(new Event("input"));
      await new Promise((r) => setTimeout(r, 0));

      // Left for Project before Cost Centre's own fetch ever resolved
      // — Project's fetch isn't gated, so it resolves first.
      projectBox.value = "mjol";
      projectBox.oninput?.(new Event("input"));
      await new Promise((r) => setTimeout(r, 0));
      expect(document.querySelector(".codingresultslabel")?.textContent).toBe("Results for Project");

      // Only now does Cost Centre's own slow answer arrive — a stale
      // token, and must not clobber what Project already put there.
      resolveCostCentres?.();
      await new Promise((r) => setTimeout(r, 0));
      expect(document.querySelector(".codingresultslabel")?.textContent).toBe("Results for Project");
      const listText = document.querySelector(".codingresultslist")?.textContent ?? "";
      expect(listText).toContain("Mjolner");
      expect(listText).not.toContain("Engineering West");
    });
  });

  /**
   * **Auto-focus, pre-load, and naming what narrowed an empty
   * result — decision 0459.** The operator's own live follow-up once
   * 0458 shipped: *"Could we auto-focus on the Cost Center and pre-
   * load the screen with values for that field... Also - I see no rows
   * returned for General Ledger, even though it seems to be
   * populated."* The last part traced to intended behaviour (decision
   * 0355's own "a missing filter is not everything," restated at the
   * entry level by `coding-list-route.test.ts`'s own coverage) rather
   * than a bug — what was actually missing was the pop-out saying why.
   */
  describe("auto-focus, pre-load, and naming what narrowed an empty result (decision 0459)", () => {
    it("focuses the Cost Centre search box the moment the pop-out opens, before anybody clicks into it", async () => {
      stub({
        "/api/org/cost-centres": { costCentres: [{ id: "cc1", name: "Marketing", filters: [] }], total: 1, page: 1, pageSize: 50 },
      });
      await openAndClickCoding();
      await new Promise((r) => setTimeout(r, 0));

      const searchBoxes = [...document.querySelectorAll(".popout .searchbox")] as HTMLInputElement[];
      expect(document.activeElement).toBe(searchBoxes[0]);
    });

    it("shows the Cost Centre field's own first page of results on open, with nothing typed", async () => {
      stub({
        "/api/org/cost-centres": { costCentres: [{ id: "cc1", name: "Marketing", filters: [] }], total: 1, page: 1, pageSize: 50 },
      });
      await openAndClickCoding();
      await new Promise((r) => setTimeout(r, 0));

      expect(document.querySelector(".codingresultslabel")?.textContent).toBe("Results for Cost centre");
      expect(document.querySelector(".codingresultslist")?.textContent).toContain("Marketing");
    });

    it("does not preload any other field — only the one auto-focused", async () => {
      const calls: string[] = [];
      stub(
        { "/api/org/cost-centres": { costCentres: [{ id: "cc1", name: "Marketing", filters: [] }], total: 1, page: 1, pageSize: 50 } },
        calls
      );
      await openAndClickCoding();
      await new Promise((r) => setTimeout(r, 0));

      expect(calls.some((c) => c.startsWith("/api/coding-lists/project"))).toBe(false);
    });

    it("a plain empty result, with no active filter, states no matches and nothing more", async () => {
      stub({
        "/api/org/cost-centres": { costCentres: [], total: 0, page: 1, pageSize: 50 },
      });
      await openAndClickCoding();
      await new Promise((r) => setTimeout(r, 0));

      const listText = document.querySelector(".codingresultslist")?.textContent ?? "";
      expect(listText).toBe("Nothing on file matches that.");
    });

    it("names the active filter on a scoped field's own empty result, so it reads as narrowed rather than broken", async () => {
      stub({
        "/api/field-visibility": {
          fields: [
            ...CODING_FIELDS.fields,
            { field: "coding.gl_code", visibility: "edit", type: "text", line: true, description: "general ledger code" },
          ],
        },
        "/api/org/cost-centres": { costCentres: [{ id: "cc1", name: "Marketing", filters: [] }], total: 1, page: 1, pageSize: 50 },
        "/api/coding-lists/gl_code": { entries: [], declaredFilters: ["company_code", "commodity_code"], total: 0, page: 1, pageSize: 25 },
      });
      await openAndClickCoding();
      await new Promise((r) => setTimeout(r, 0));

      // Commodity Code stays `read` here (unchanged from `CODING_FIELDS`),
      // so it renders no search box of its own — Cost Centre, Project,
      // General Ledger Code are the three actually searchable fields.
      const searchBoxes = [...document.querySelectorAll(".popout .searchbox")] as HTMLInputElement[];
      const glBox = searchBoxes[2];
      glBox.value = "anything";
      glBox.oninput?.(new Event("input"));
      await new Promise((r) => setTimeout(r, 0));

      const listText = document.querySelector(".codingresultslist")?.textContent ?? "";
      expect(listText).toContain("Nothing on file matches that.");
      expect(listText).toContain("Narrowed by: Org / Company Code");
    });
  });

  /**
   * **Every field's own first page on focus, no minimum before typing
   * counts, and the Org / Company Code box matched to the fields below
   * it — decision 0460.** The operator's own live follow-up: *"can we
   * automatically show the first 25 available rows, when a Line coding
   * element has focus, limited by what is already type into the box,
   * but if nothing is type simply show available fields. Automatically
   * update the list as typing occurs. The width of the box can also be
   * reduced, probably to 2/3 of the visible width. Can you update the
   * Org / Company Code field so that it is the same height and width
   * as the fields beneath it."*
   */
  describe("every field's own first page on focus, and no minimum before typing counts (decision 0460)", () => {
    it("shows any field's own first page the moment it is focused, not only the one auto-focused on open", async () => {
      stub({
        "/api/org/cost-centres": { costCentres: [{ id: "cc1", name: "Marketing", filters: [] }], total: 1, page: 1, pageSize: 50 },
        "/api/coding-lists/project": { entries: [{ id: "proj-1", name: "Mjolner", filters: [] }], declaredFilters: [], total: 1, page: 1, pageSize: 50 },
      });
      await openAndClickCoding();
      await new Promise((r) => setTimeout(r, 0));

      const searchBoxes = [...document.querySelectorAll(".popout .searchbox")] as HTMLInputElement[];
      const projectBox = searchBoxes[1];
      projectBox.focus();
      await new Promise((r) => setTimeout(r, 0));

      expect(document.querySelector(".codingresultslabel")?.textContent).toBe("Results for Project");
      expect(document.querySelector(".codingresultslist")?.textContent).toContain("Mjolner");
    });

    it("a single typed character already updates the shared results — no two-character minimum any more", async () => {
      const calls: string[] = [];
      stub(
        { "/api/org/cost-centres": { costCentres: [{ id: "cc1", name: "Marketing", filters: [] }], total: 1, page: 1, pageSize: 50 } },
        calls
      );
      await openAndClickCoding();
      await new Promise((r) => setTimeout(r, 0));
      calls.length = 0;

      const costCentreBox = document.querySelectorAll(".popout .searchbox")[0] as HTMLInputElement;
      costCentreBox.value = "m";
      costCentreBox.oninput?.(new Event("input"));
      await new Promise((r) => setTimeout(r, 0));

      expect(calls.some((c) => c.startsWith("/api/org/cost-centres") && c.includes("search=m"))).toBe(true);
      expect(document.querySelector(".codingresultslist")?.textContent).toContain("Marketing");
    });

    it("clearing a field's own box shows its first page again, rather than leaving the results panel blank", async () => {
      stub({
        "/api/org/cost-centres": { costCentres: [{ id: "cc1", name: "Marketing", filters: [] }], total: 1, page: 1, pageSize: 50 },
      });
      await openAndClickCoding();
      await new Promise((r) => setTimeout(r, 0));

      const clearButtons = document.querySelectorAll(".popout .codingsearch button.rm");
      (clearButtons[0] as HTMLButtonElement).click(); // Cost Centre's own clear button
      await new Promise((r) => setTimeout(r, 0));

      expect(document.querySelector(".codingresultslabel")?.textContent).toBe("Results for Cost centre");
      expect(document.querySelector(".codingresultslist")?.textContent).toContain("Marketing");
    });

    it("the Org / Company Code field carries the class matched to the fields beneath it", async () => {
      stub({});
      await openAndClickCoding();

      expect(document.querySelector(".popout .codingcompanycode")).not.toBeNull();
    });

    it("a late-resolving already-keyed field does not steal the results area back from wherever the person has since moved on", async () => {
      // The exact same shape as decision 0458's own race test, but
      // exercising the *other* source of a stale, late request this
      // decision introduces: `resolveCurrent`'s own rename lookup,
      // gated open here, still in flight when the person has already
      // moved on to Project by the time it finally settles.
      let resolveCostCentres: (() => void) | undefined;
      const costCentresGate = new Promise<void>((resolve) => {
        resolveCostCentres = resolve;
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          const path = String(url).split("?")[0];
          const base: Record<string, unknown> = {
            "/api/ui-strings": { locale: "en", strings: CODING_STRINGS },
            "/api/code-lists": { fields: {} },
            "/api/field-visibility": CODING_FIELDS,
            "/api/invoices/inv-1": {
              facts: {},
              lines: [{ lineNumber: 1, facts: { "BT-131": 100, "BT-133": "cc1" } }],
              validation: { passed: true, checked: [], failures: [] },
              supplier: null,
              buyer: { unitId: "UK01", unitName: "Acme UK", entityName: "Acme UK", vatId: "GB1" },
              orgUnitId: "UK01",
            },
            "/api/invoices/inv-1/document-url": { url: null },
            "/api/invoices/inv-1/progress": { inProcess: false, stages: [] },
            "/api/invoices/inv-1/pages": { pages: [] },
            "/api/documents/inv-1/activity": { items: [] },
            "/api/invoices/inv-1/key": { ok: true },
            "/api/invoices/inv-1/coding-suggestions": { suggestions: {} },
            "/api/coding-lists/project": { entries: [{ id: "proj-1", name: "Mjolner", filters: [] }], declaredFilters: [], total: 1, page: 1, pageSize: 50 },
          };
          if (path === "/api/org/cost-centres") {
            // Cost Centre already has "cc1" keyed on the stubbed line,
            // so `resolveCurrent`'s own lookup fires immediately on
            // open — gated here, so it is still unresolved by the time
            // the person has moved on to Project.
            await costCentresGate;
            return { ok: true, json: async () => ({ costCentres: [{ id: "cc9", name: "Engineering West", filters: [] }], total: 1, page: 1, pageSize: 50 }) } as Response;
          }
          if (path in base) return { ok: true, json: async () => base[path] } as Response;
          throw new Error(`no stub for ${path}`);
        })
      );

      await openAndClickCoding();
      await new Promise((r) => setTimeout(r, 0));

      const searchBoxes = [...document.querySelectorAll(".popout .searchbox")] as HTMLInputElement[];
      const projectBox = searchBoxes[1];
      projectBox.value = "mjol";
      projectBox.oninput?.(new Event("input"));
      await new Promise((r) => setTimeout(r, 0));
      expect(document.querySelector(".codingresultslabel")?.textContent).toBe("Results for Project");

      // Only now does Cost Centre's own gated `resolveCurrent` lookup
      // settle — its own deferred, once-focused search must not fire
      // and clobber what Project already put there.
      resolveCostCentres?.();
      await new Promise((r) => setTimeout(r, 0));
      expect(document.querySelector(".codingresultslabel")?.textContent).toBe("Results for Project");
      const listText = document.querySelector(".codingresultslist")?.textContent ?? "";
      expect(listText).toContain("Mjolner");
      expect(listText).not.toContain("Engineering West");
    });
  });

  /**
   * **`canEditAnything` reaching this pop-out — decision 0486.**
   * Reported live: Account Coding on a non-PO invoice in the Coding
   * queue saved even though the item had not been claimed. This
   * pop-out never joined `canEditAnything` at all — every field inside
   * only ever checked the stage's own configured visibility, the same
   * gap decision 0403 already closed for the line table proper.
   */
  describe("a task that is not the caller's — decision 0486", () => {
    it("shows a stage-editable field as read-only when the task is claimed by someone else", async () => {
      stub({});
      await openAndClickCoding({ ...TASK, ownership: "locked", actions: [] });

      const rows = [...document.querySelectorAll(".popout .editgrid > *")];
      const labelIndex = rows.findIndex((r) => r.textContent === "Project");
      expect(labelIndex).toBeGreaterThanOrEqual(0);
      // A readonly value box, not a live searchable picker.
      expect(rows[labelIndex + 1]?.querySelector(".readonly")).not.toBeNull();
      expect(rows[labelIndex + 1]?.querySelector(".searchbox")).toBeNull();
    });

    it("shows the same field as read-only when the task sits unclaimed, available to anyone", async () => {
      stub({});
      await openAndClickCoding({ ...TASK, ownership: "available", actions: ["claim"] });

      const rows = [...document.querySelectorAll(".popout .editgrid > *")];
      const labelIndex = rows.findIndex((r) => r.textContent === "Project");
      expect(rows[labelIndex + 1]?.querySelector(".searchbox")).toBeNull();
    });

    it("does not show the not-editable-here note for a field that is only unclaimed, not stage-restricted", async () => {
      // The note ("Not editable at this stage") is about the stage's
      // own configuration, not about whose task this is — a claimed-
      // by-someone-else field should read simply as its value, not
      // claim a stage restriction that was never set.
      stub({});
      await openAndClickCoding({ ...TASK, ownership: "locked", actions: [] });

      const rows = [...document.querySelectorAll(".popout .editgrid > *")];
      const labelIndex = rows.findIndex((r) => r.textContent === "Project");
      expect(rows[labelIndex + 1]?.textContent).not.toContain("Not editable at this stage");
    });

    it("still shows the Coding button and opens the pop-out — looking is not editing", async () => {
      stub({});
      await openAndClickCoding({ ...TASK, ownership: "locked", actions: [] });

      expect(document.querySelector(".popout")).not.toBeNull();
    });

    it("still shows a field the stage has not configured editable as read-only, unaffected by ownership", async () => {
      // Commodity Code is `visibility: "read"` regardless of who has
      // the task — this decision must not change that case's own
      // behaviour, only add the ownership check beside it.
      stub({});
      await openAndClickCoding({ ...TASK, ownership: "locked", actions: [] });

      const rows = [...document.querySelectorAll(".popout .editgrid > *")];
      const commodityLabelIndex = rows.findIndex((r) => r.textContent === "Commodity code");
      expect(rows[commodityLabelIndex + 1]?.textContent).not.toContain("Not editable at this stage");
    });

    it("allows the live picker once the task is claimed by the caller — unchanged, pre-existing behaviour", async () => {
      stub({
        "/api/org/cost-centres": { costCentres: [{ id: "cc1", name: "Marketing", filters: [] }], total: 1, page: 1, pageSize: 50 },
      });
      await openAndClickCoding({ ...TASK, ownership: "mine" });

      const rows = [...document.querySelectorAll(".popout .editgrid > *")];
      const labelIndex = rows.findIndex((r) => r.textContent === "Project");
      expect(rows[labelIndex + 1]?.querySelector(".searchbox")).not.toBeNull();
    });
  });
});
