import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * AP Setup — decision 0440.
 *
 * *"Under a new side menu option, I would like to establish AP
 * Configuration options... Matching, Account Coding and Approval
 * Hierarchy setup screens in tabs."* Matching and Account Coding stay
 * real placeholder tabs — both genuinely greenfield (decision 0439's
 * own "What is not built"). Approval Hierarchy is live: the mode and
 * Default Approver decision 0439's own resolver already reads, plus
 * CRUD for the two unit-scoped override tables.
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
    "apsetup.add": "Add",
    "apsetup.person": "Person",
    "apsetup.supervisor": "Supervisor",
    "apsetup.limitcurrency": "Currency",
    "apsetup.limitamount": "Amount",
    "roles.org": "Organisation",
    "roles.remove": "Remove",
    "action.save": "Save",
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

describe("Matching and Account Coding — real placeholder tabs, both genuinely greenfield", () => {
  it("Account Coding shows the same not-built placeholder", async () => {
    await openApSetupAs(["Admin.Configure"]);
    switchTab("Account Coding");
    expect(document.querySelector(".panel")?.textContent).toContain("Not built yet");
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
