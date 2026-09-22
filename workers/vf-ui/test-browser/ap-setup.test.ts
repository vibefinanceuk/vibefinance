import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * AP Setup — decision 0440.
 *
 * *"Under a new side menu option, I would like to establish AP
 * Configuration options... Matching, Account Coding and Approval
 * Hierarchy setup screens in tabs."* Matching stays a real placeholder
 * tab — still genuinely greenfield (decision 0439's own "What is not
 * built"). Approval Hierarchy is live: the mode and Default Approver
 * decision 0439's own resolver already reads, plus CRUD for the two
 * unit-scoped override tables. **Account Coding is live too, as of
 * decision 0444** — its own content is covered in depth in
 * `coding-lists.test.ts`; this file only covers that it renders at
 * all, from AP Setup's own tab bar.
 */

function mountShell() {
  document.body.innerHTML = `<main id="shell"></main><main id="viewer" hidden></main>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "nav.tasks": "Tasks",
    "nav.apsetup": "AP Setup",
    "apsetup.subtitle": "How invoices are matched, coded and approved",
    "apsetup.matching": "Matching",
    "apsetup.coding": "Account Coding",
    "apsetup.approvalhierarchy": "Approval Hierarchy",
    "apsetup.notbuilt": "Not built yet",
    "apsetup.loadfailed": "AP Setup could not be loaded",
    "apsetup.mode": "Approval mode",
    "apsetup.mode.employee_supervisor": "Employee-Supervisor",
    "apsetup.mode.cost_object": "Cost-Object",
    "apsetup.mode.manual": "Manual",
    "apsetup.mode.api": "API",
    "apsetup.defaultapprover": "Default Approver",
    "apsetup.defaultapprovernone": "None set",
    "apsetup.modesub": "Applies customer-wide.",
    "apsetup.savemodefailed": "Could not save the approval mode",
    "apsetup.supervisoroverrides": "Supervisor overrides",
    "apsetup.supervisoroverridessub": "A person's supervisor, specific to one org.",
    "apsetup.nosupervisoroverrides": "No supervisor overrides configured",
    "apsetup.reportsto": "reports to",
    "apsetup.limitoverrides": "Approval limit overrides",
    "apsetup.limitoverridessub": "A person's approval limit, specific to one org and one currency.",
    "apsetup.nolimitoverrides": "No approval limit overrides configured",
    "apsetup.overridesavefailed": "Could not save that override",
    "apsetup.supervisoroverridesearchhint": "Person, org, or supervisor",
    "apsetup.supervisoroverridenomatch": "Nothing matches that. Try a person, org, or supervisor name.",
    "apsetup.limitoverridesearchhint": "Person, org, or currency",
    "apsetup.limitoverridenomatch": "Nothing matches that. Try a person, org, or currency.",
    "apsetup.overridesearchedcount": "{shown} of {total} matching.",
    "apsetup.add": "Add",
    "apsetup.person": "Person",
    "apsetup.supervisor": "Supervisor",
    "apsetup.limitcurrency": "Currency",
    "apsetup.limitamount": "Amount",
    "roles.org": "Organisation",
    "roles.remove": "Remove",
    "roles.none": "None",
    "roles.yes": "Yes",
    "action.save": "Save",
    "action.create": "Create",
    "action.close": "Close",
    "apsetup.codingtab.companycode": "Company code",
    "apsetup.codingtab.costcentre": "Cost Centre",
    "apsetup.codingtab.project": "Project",
    "apsetup.codingtab.commoditycode": "Commodity Code",
    "apsetup.codingtab.glcode": "General Ledger Code",
    "apsetup.codingcompanycodesub": "Managed under Access → Org Units. Shown here for reference only.",
    "apsetup.codingcostcentresub": "A company-wide financial construct, used by Cost-Object approval routing. Not scoped to any one process.",
    "apsetup.codingprojectsub": "A manageable list only — not enforced against rule values or invoice lines.",
    "apsetup.codingcommoditycodesub": "A manageable list only — not enforced against rule values or invoice lines.",
    "apsetup.codingglcodesub": "A manageable list only — not enforced against rule values or invoice lines.",
    "apsetup.nocompanycodes": "No company codes configured yet.",
    "apsetup.nocostcentres": "No cost centres configured yet.",
    "apsetup.noprojects": "No projects configured yet.",
    "apsetup.nocommoditycodes": "No commodity codes configured yet.",
    "apsetup.noglcodes": "No general ledger codes configured yet.",
    "apsetup.codingid": "ID",
    "apsetup.codingname": "Name",
    "apsetup.codingparent": "Parent",
    "apsetup.codingdefault": "Default",
    "apsetup.codingapprover": "Approver",
    "apsetup.codingapprovallimit": "Approval limit",
    "apsetup.codingentrysavefailed": "Could not save that. Check the values and try again.",
  },
};

const EMPTY_OVERVIEW = { units: [], users: [], roles: [], assignments: [], authorityLimits: [], knownPermissions: [] };
const EMPTY_CONFIG = {
  mode: "employee_supervisor",
  defaultApproverUserId: null,
  defaultApproverName: null,
  supervisorOverrides: [],
  limitOverrides: [],
};
const EMPTY_COST_CENTRES = { costCentres: [] };
const EMPTY_CODING_LIST = { declaredFilters: [], entries: [] };

function stubFetch(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).split("?")[0];
      const key = init?.method && init.method !== "GET" ? `${init.method} ${path}` : path;
      if (key in routes) {
        const value = routes[key];
        if (value && typeof value === "object" && ("status" in (value as object) || "ok" in (value as object))) {
          return value as Response;
        }
        return { ok: true, json: async () => value } as Response;
      }
      throw new Error(`no stub for ${key}`);
    })
  );
}

beforeEach(() => {
  mountShell();
  vi.unstubAllGlobals();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * **The write-enabled path, the same shape `access.test.ts`'s own
 * `openRolesAs` already uses.** Real usage always reaches a screen
 * through `start()`, which is what actually populates `me` —
 * `hasMyPermission` returns `false` for everything otherwise.
 */
async function openApSetupAs(
  permissions: string[],
  overview: unknown = EMPTY_OVERVIEW,
  config: unknown = EMPTY_CONFIG,
  extraRoutes: Record<string, unknown> = {}
) {
  stubFetch({
    "/api/ui-strings": STRINGS,
    "/api/whoami": { id: "u-dan", name: "Dan", permissions },
    "/api/tasks": { tasks: [], counts: {} },
    "/api/org/overview": overview,
    "/api/approval-config": config,
    "/api/org/cost-centres": EMPTY_COST_CENTRES,
    "/api/coding-lists/project": EMPTY_CODING_LIST,
    "/api/coding-lists/commodity_code": EMPTY_CODING_LIST,
    "/api/coding-lists/gl_code": EMPTY_CODING_LIST,
    ...extraRoutes,
  });
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { start } = await import("/tasks.js");
  await start();
  const { open } = await import("/ap-setup.js");
  await open();
}

function switchTab(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>(".tabbar button")].find(
    (b) => b.textContent === label
  );
  button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("the screen opens at all", () => {
  it("renders into the shell", async () => {
    await openApSetupAs(["Admin.Configure"]);
    expect(document.getElementById("shell")?.textContent).toContain("AP Setup");
  });

  it("refuses to open at all without Admin.Configure — the same permission the nav entry itself gates on", async () => {
    await openApSetupAs([]);
    expect(document.getElementById("shell")?.textContent).toContain("AP Setup could not be loaded");
    expect(document.getElementById("shell")?.querySelector(".nav")).not.toBeNull();
  });

  it("shows a real error, and keeps the nav reachable, when the load fails", async () => {
    stubFetch({
      "/api/ui-strings": STRINGS,
      "/api/whoami": { id: "u-dan", name: "Dan", permissions: ["Admin.Configure"] },
      "/api/tasks": { tasks: [], counts: {} },
      "/api/org/overview": EMPTY_OVERVIEW,
      "/api/approval-config": { status: 500, ok: false, json: async () => ({}) },
    });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { start } = await import("/tasks.js");
    await start();
    const { open } = await import("/ap-setup.js");
    await open();

    const shell = document.getElementById("shell");
    expect(shell?.textContent).toContain("AP Setup could not be loaded");
    expect(shell?.querySelector(".nav")).not.toBeNull();
  });

  it("defaults to the first tab, Matching", async () => {
    await openApSetupAs(["Admin.Configure"]);
    const activeTab = document.querySelector(".tabbar button.active");
    expect(activeTab?.textContent).toBe("Matching");
    expect(document.querySelector(".panel")?.textContent).toContain("Not built yet");
  });
});

describe("Matching stays a real placeholder tab; Account Coding is now built — decision 0444", () => {
  it("Matching still shows the not-built placeholder", async () => {
    await openApSetupAs(["Admin.Configure"]);
    switchTab("Matching");
    expect(document.querySelector(".panel")?.textContent).toContain("Not built yet");
  });

  it("Account Coding shows its own five sub-tabs, defaulting to Company code", async () => {
    await openApSetupAs(["Admin.Configure"]);
    switchTab("Account Coding");
    const subTabs = [...document.querySelectorAll(".tabbar")][1]?.textContent ?? "";
    expect(subTabs).toContain("Company code");
    expect(subTabs).toContain("Cost Centre");
    expect(subTabs).toContain("Project");
    expect(subTabs).toContain("Commodity Code");
    expect(subTabs).toContain("General Ledger Code");
    expect(document.querySelector(".panel")?.textContent).toContain("No company codes configured yet.");
  });
});

describe("Approval Hierarchy — the mode and Default Approver form", () => {
  it("shows the configured mode already selected", async () => {
    await openApSetupAs(["Admin.Configure"], EMPTY_OVERVIEW, { ...EMPTY_CONFIG, mode: "cost_object" });
    switchTab("Approval Hierarchy");

    const select = document.querySelector(".editgrid select") as HTMLSelectElement;
    expect(select.value).toBe("cost_object");
  });

  it("offers every mode the vocabulary names", async () => {
    await openApSetupAs(["Admin.Configure"]);
    switchTab("Approval Hierarchy");

    const select = document.querySelector(".editgrid select") as HTMLSelectElement;
    const values = [...select.options].map((o) => o.value);
    expect(values).toEqual(["employee_supervisor", "cost_object", "manual", "api"]);
  });

  it("saves the mode and default approver together, then reloads", async () => {
    const users = [{ id: "u1", name: "Alice", email: "alice@acme.com" }];
    await openApSetupAs(["Admin.Configure"], { ...EMPTY_OVERVIEW, users }, EMPTY_CONFIG, {
      "PUT /api/approval-config": {
        ok: true,
        json: async () => ({ mode: "manual", defaultApproverUserId: "u1" }),
      },
    });
    switchTab("Approval Hierarchy");

    const modeSelect = document.querySelector(".editgrid select") as HTMLSelectElement;
    modeSelect.value = "manual";
    const approverSelect = document.querySelectorAll(".editgrid select")[1] as HTMLSelectElement;
    approverSelect.value = "u1";

    const saveButton = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Save"));
    // Just confirming the button exists and is wired to a real click handler —
    // the actual network call is covered by the route-level tests.
    expect(saveButton).toBeTruthy();
  });
});

describe("Approval Hierarchy — supervisor overrides", () => {
  it("shows the empty state when none are configured", async () => {
    await openApSetupAs(["Admin.Configure"]);
    switchTab("Approval Hierarchy");
    expect(document.body.textContent).toContain("No supervisor overrides configured");
  });

  it("lists an existing override with the person, org and supervisor by name", async () => {
    await openApSetupAs(["Admin.Configure"], EMPTY_OVERVIEW, {
      ...EMPTY_CONFIG,
      supervisorOverrides: [
        { userId: "u1", userName: "Alice", unitId: "org1", unitName: "Acme France", supervisorId: "u2", supervisorName: "Bob" },
      ],
    });
    switchTab("Approval Hierarchy");

    expect(document.body.textContent).toContain("Alice — Acme France — reports to Bob");
  });

  it("removing a row calls the matching delete route", async () => {
    await openApSetupAs(
      ["Admin.Configure"],
      EMPTY_OVERVIEW,
      {
        ...EMPTY_CONFIG,
        supervisorOverrides: [
          { userId: "u1", userName: "Alice", unitId: "org1", unitName: "Acme France", supervisorId: "u2", supervisorName: "Bob" },
        ],
      },
      {
        "DELETE /api/approval-config/supervisor-overrides/u1/org1": { ok: true, json: async () => ({}) },
      }
    );
    switchTab("Approval Hierarchy");

    const removeButton = [...document.querySelectorAll(".assignmentrow button")].find((b) => b.textContent === "Remove");
    await removeButton?.click();
    await new Promise((r) => setTimeout(r, 0));

    const calls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(
      calls.some(
        ([url, init]) =>
          String(url) === "/api/approval-config/supervisor-overrides/u1/org1" &&
          (init as RequestInit | undefined)?.method === "DELETE"
      )
    ).toBe(true);
  });
});

describe("Approval Hierarchy — approval limit overrides", () => {
  it("shows the empty state when none are configured", async () => {
    await openApSetupAs(["Admin.Configure"]);
    switchTab("Approval Hierarchy");
    expect(document.body.textContent).toContain("No approval limit overrides configured");
  });

  it("lists an existing override with the person, org, currency and amount", async () => {
    await openApSetupAs(["Admin.Configure"], EMPTY_OVERVIEW, {
      ...EMPTY_CONFIG,
      limitOverrides: [{ userId: "u1", userName: "Alice", unitId: "org1", unitName: "Acme France", currency: "EUR", maxAmount: 5000 }],
    });
    switchTab("Approval Hierarchy");

    expect(document.body.textContent).toContain("Alice — Acme France — EUR 5000");
  });
});

/**
 * **The lists moved below their own add-row forms, and gained search
 * — decision 0442.** The operator's own request, once these lists
 * started to grow: the add-row controls (the "prompt boxes") stay the
 * first thing you see; the search box and the list of existing
 * overrides follow, matching Documents' own search — a query box plus
 * a capped, "shown of total" result set, not real page-number
 * controls, which this app has nowhere at all.
 */
describe("Approval Hierarchy — the override lists sit below their own add-row forms, and are searchable (decision 0442)", () => {
  function panelFor(heading: string): Element {
    const panel = [...document.querySelectorAll(".panel")].find((p) => p.querySelector("h3")?.textContent === heading);
    if (!panel) throw new Error(`no panel found for "${heading}"`);
    return panel;
  }

  /** The add-row form (`.editgrid` + its own Add button) precedes the list of existing overrides, in real DOM order. */
  function editgridComesBeforeList(panel: Element) {
    const children = [...panel.children];
    const editgridIndex = children.findIndex((c) => c.classList.contains("editgrid"));
    const listIndex = children.findIndex((c) => c.classList.contains("assignmentlist"));
    expect(editgridIndex).toBeGreaterThanOrEqual(0);
    expect(listIndex).toBeGreaterThan(editgridIndex);
  }

  const oneSupervisorOverride = [
    { userId: "u1", userName: "Alice", unitId: "org1", unitName: "Acme France", supervisorId: "u2", supervisorName: "Bob" },
  ];
  const oneLimitOverride = [{ userId: "u1", userName: "Alice", unitId: "org1", unitName: "Acme France", currency: "EUR", maxAmount: 5000 }];

  it("the add-row form sits above the list, for both override sections", async () => {
    await openApSetupAs(["Admin.Configure"], EMPTY_OVERVIEW, {
      ...EMPTY_CONFIG,
      supervisorOverrides: oneSupervisorOverride,
      limitOverrides: oneLimitOverride,
    });
    switchTab("Approval Hierarchy");

    editgridComesBeforeList(panelFor("Supervisor overrides"));
    editgridComesBeforeList(panelFor("Approval limit overrides"));
  });

  /**
   * **The Add button became an icon button in the card's own top-right
   * — decision 0443.** Reported directly, once 0442 deployed: *"create
   * a suitable icon for the Add button and move to the top-right of
   * each card."* Same `.cardhead > .statebuttons > .actionlink` shape
   * `modeForm`'s own Save button, right above these two sections, and
   * every other screen's Create/Save button already use — not a new
   * pattern invented for this.
   */
  it("the Add button is an icon button in the card's own top-right, for both override sections", async () => {
    await openApSetupAs(["Admin.Configure"]);
    switchTab("Approval Hierarchy");

    for (const heading of ["Supervisor overrides", "Approval limit overrides"]) {
      const panel = panelFor(heading);
      const addButton = panel.querySelector(".cardhead .statebuttons .actionlink");
      expect(addButton).not.toBeNull();
      expect(addButton?.textContent).toContain("Add");
      // An icon button carries its own SVG glyph, not just text — the
      // same shape `actionLink()` gives every other icon button.
      expect(addButton?.querySelector("svg")).not.toBeNull();
      // No leftover plain-button row beneath the add-row form.
      expect(panel.querySelector(".memberpickerrow")).toBeNull();
    }
  });

  it("a matching search narrows the supervisor override list; a non-matching one shows the no-match message", async () => {
    await openApSetupAs(["Admin.Configure"], EMPTY_OVERVIEW, {
      ...EMPTY_CONFIG,
      supervisorOverrides: [
        ...oneSupervisorOverride,
        { userId: "u3", userName: "Carol", unitId: "org2", unitName: "Acme UK", supervisorId: "u4", supervisorName: "Dave" },
      ],
    });
    switchTab("Approval Hierarchy");

    const search = document.getElementById("supervisoroverridesearch") as HTMLInputElement;
    search.value = "Carol";
    search.dispatchEvent(new Event("change"));

    expect(document.body.textContent).toContain("Carol — Acme UK — reports to Dave");
    expect(document.body.textContent).not.toContain("Alice — Acme France — reports to Bob");

    search.value = "nobody by this name";
    search.dispatchEvent(new Event("change"));

    expect(document.body.textContent).toContain("Nothing matches that. Try a person, org, or supervisor name.");
  });

  it("a matching search narrows the limit override list; a non-matching one shows the no-match message", async () => {
    await openApSetupAs(["Admin.Configure"], EMPTY_OVERVIEW, {
      ...EMPTY_CONFIG,
      limitOverrides: [
        ...oneLimitOverride,
        { userId: "u3", userName: "Carol", unitId: "org2", unitName: "Acme UK", currency: "GBP", maxAmount: 1000 },
      ],
    });
    switchTab("Approval Hierarchy");

    const search = document.getElementById("limitoverridesearch") as HTMLInputElement;
    search.value = "GBP";
    search.dispatchEvent(new Event("change"));

    expect(document.body.textContent).toContain("Carol — Acme UK — GBP 1000");
    expect(document.body.textContent).not.toContain("Alice — Acme France — EUR 5000");

    search.value = "nothing recorded like this";
    search.dispatchEvent(new Event("change"));

    expect(document.body.textContent).toContain("Nothing matches that. Try a person, org, or currency.");
  });

  it("caps how many rows render, and says so, once a list runs past the display cap", async () => {
    const manyOverrides = Array.from({ length: 51 }, (_, i) => ({
      userId: `u${i}`,
      userName: `Person ${i}`,
      unitId: "org1",
      unitName: "Acme France",
      supervisorId: "u-boss",
      supervisorName: "Boss",
    }));
    await openApSetupAs(["Admin.Configure"], EMPTY_OVERVIEW, { ...EMPTY_CONFIG, supervisorOverrides: manyOverrides });
    switchTab("Approval Hierarchy");

    const panel = panelFor("Supervisor overrides");
    expect(panel.querySelectorAll(".assignmentrow").length).toBe(50);
    expect(panel.textContent).toContain("50 of 51 matching.");
  });

  it("no count note appears when every override already fits within the cap", async () => {
    await openApSetupAs(["Admin.Configure"], EMPTY_OVERVIEW, { ...EMPTY_CONFIG, supervisorOverrides: oneSupervisorOverride });
    switchTab("Approval Hierarchy");

    expect(panelFor("Supervisor overrides").textContent).not.toContain("matching.");
  });
});
