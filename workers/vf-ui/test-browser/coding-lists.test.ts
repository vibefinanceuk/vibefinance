import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Account Coding — decision 0444.
 *
 * *"Cost-Center Lists should be maintained under the Account Coding
 * tab, with other valid coding lists. This would include Company code
 * (Org), Cost-Center; Project, Commodity Code, General Ledger Code for
 * example."* `ap-setup.test.ts` covers that this tab renders at all
 * from AP Setup's own tab bar; this file covers what it actually does:
 * Company code stays read-only, Cost Centre keeps its own existing
 * routes with a real screen for the first time, and Project, Commodity
 * Code, and General Ledger Code share one generic CRUD, filtered by
 * whatever `declaredFilters` the server says a type carries.
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
    "apsetup.supervisoroverridenomatch": "Nothing matches that.",
    "apsetup.limitoverridesearchhint": "Person, org, or currency",
    "apsetup.limitoverridenomatch": "Nothing matches that.",
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
    "apsetup.codingcostcentresub": "A company-wide financial construct, used by Cost-Object approval routing.",
    "apsetup.codingprojectsub": "A manageable list only.",
    "apsetup.codingcommoditycodesub": "A manageable list only.",
    "apsetup.codingglcodesub": "A manageable list only.",
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
    "apsetup.codingentrysavefailed": "Could not save that.",
    "apsetup.csvloadheading": "Load from file",
    "apsetup.csvloadhelp": "Load entries from a CSV export.",
    "apsetup.csvloadbutton": "Load",
    "apsetup.csvtemplatebutton": "Template",
    "apsetup.csvnofile": "Choose a file first.",
    "apsetup.csvloadfailed": "Could not reach the server. Try again.",
    "apsetup.csvloadbroke": "Something went wrong after the file loaded:",
    "apsetup.csventriescreated": "{n} entries created",
    "apsetup.csventriesupdated": "{n} entries updated",
    "apsetup.csvrefusedheading": "Not loaded",
    "apsetup.csvrefusedentry": "{id}: {reason}",
    "apsetup.csvrefusedmore": "+{n} more",
    "apsetup.csvviewformat": "View CSV format",
    "apsetup.csvfieldname": "Field",
    "apsetup.csvacceptedcolumns": "Accepted columns",
    "apsetup.csvrequired": "Required",
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

/**
 * A CSV format response, decision 0445 — the same base fields every
 * type carries plus whatever filter columns it declares, mirroring
 * `coding-list-csv-route.ts`'s own `fieldSpecsFor()` shape closely
 * enough for a test double without depending on its exact wording.
 */
function csvFormat(listType: string, filterListTypeIds: string[] = []) {
  return {
    listType,
    fields: [
      { key: "id", columns: ["id"], required: true, description: "The list's own code." },
      { key: "name", columns: ["name", "path"], required: true, description: "Display name." },
      { key: "is_default", columns: ["default"], required: false, description: "Default." },
      { key: "approver_email", columns: ["approver", "owner"], required: false, description: "Approver." },
      { key: "parent_entry_id", columns: ["parent entry id"], required: false, description: "Parent." },
      ...filterListTypeIds.map((f) => ({ key: `filter_${f}`, columns: [`filter by - ${f}`], required: false, description: f })),
    ],
  };
}

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

async function openApSetupAs(
  overview: unknown = EMPTY_OVERVIEW,
  costCentres: unknown = EMPTY_COST_CENTRES,
  codingLists: Record<string, unknown> = {},
  extraRoutes: Record<string, unknown> = {}
) {
  stubFetch({
    "/api/ui-strings": STRINGS,
    "/api/whoami": { id: "u-dan", name: "Dan", permissions: ["Admin.Configure"] },
    "/api/tasks": { tasks: [], counts: {} },
    "/api/org/overview": overview,
    "/api/approval-config": EMPTY_CONFIG,
    "/api/org/cost-centres": costCentres,
    "/api/coding-lists/project": EMPTY_CODING_LIST,
    "/api/coding-lists/commodity_code": EMPTY_CODING_LIST,
    "/api/coding-lists/gl_code": EMPTY_CODING_LIST,
    "/api/coding-lists/cost_centre/csv-format": csvFormat("cost_centre", ["company_code"]),
    "/api/coding-lists/project/csv-format": csvFormat("project"),
    "/api/coding-lists/commodity_code/csv-format": csvFormat("commodity_code"),
    "/api/coding-lists/gl_code/csv-format": csvFormat("gl_code", ["company_code", "commodity_code"]),
    ...codingLists,
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
  const button = [...document.querySelectorAll<HTMLButtonElement>(".tabbar button")].find((b) => b.textContent === label);
  button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

/** A file picker cannot be filled by a test, so the file is supplied — mirrors purchase-orders.test.ts's own chooseFile(). */
function chooseFile(text: string) {
  const picker = document.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(picker, "files", { value: [{ text: async () => text }], configurable: true });
}

function switchCodingSubTab(label: string) {
  switchTab("Account Coding");
  const bars = [...document.querySelectorAll<HTMLButtonElement>(".tabbar button")];
  const button = bars.find((b) => b.textContent === label);
  button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function fetchCalls() {
  return (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
}

describe("Company code — read-only, decision 0444", () => {
  it("lists the org units already managed under Access, with no Add button", async () => {
    await openApSetupAs({ ...EMPTY_OVERVIEW, units: [{ id: "UK01", name: "Acme UK" }] });
    switchCodingSubTab("Company code");
    const panelText = document.querySelector(".panel")?.textContent ?? "";
    expect(panelText).toContain("Acme UK");
    expect(panelText).toContain("Managed under Access → Org Units");
    expect([...document.querySelectorAll(".cardhead button")].some((b) => b.textContent?.includes("Add"))).toBe(false);
  });
});

describe("Cost Centre — decision 0444", () => {
  it("shows the empty state when none exist", async () => {
    await openApSetupAs();
    switchCodingSubTab("Cost Centre");
    // csvLoaderPanel (decision 0445) is itself a `.panel`, rendered before the list
    // section's own `.panel` — scope to the LAST one so this keeps testing the list.
    const listPanel = [...document.querySelectorAll(".panel")].at(-1);
    expect(listPanel?.textContent).toContain("No cost centres configured yet.");
  });

  it("lists an existing cost centre with its resolved parent, approver, limit, and company code", async () => {
    await openApSetupAs(EMPTY_OVERVIEW, {
      costCentres: [
        {
          id: "UK150001",
          name: "Local IT department",
          ledgerId: null,
          ledgerName: null,
          parentCostCentreId: "group",
          parentName: "Group",
          ownerUserId: "u1",
          ownerName: "Alice",
          approvalLimit: 5000,
          filters: [{ filterListTypeId: "company_code", filterEntryId: "UK01", filterEntryName: "Acme UK" }],
        },
      ],
    });
    switchCodingSubTab("Cost Centre");
    // Scope to the list section's own `.panel` — see the empty-state test above
    // for why a bare `tbody tr` can otherwise match the csvLoaderPanel's own
    // (collapsed but DOM-present) format-reference table instead.
    const listPanel = [...document.querySelectorAll(".panel")].at(-1);
    const rowText = listPanel?.querySelector("tbody tr")?.textContent ?? "";
    expect(rowText).toContain("Local IT department");
    expect(rowText).toContain("Group");
    expect(rowText).toContain("Alice");
    expect(rowText).toContain("5000");
    expect(rowText).toContain("Acme UK");
  });

  it("creates a cost centre with only id and name — the same minimal shape the existing route already takes", async () => {
    await openApSetupAs(EMPTY_OVERVIEW, EMPTY_COST_CENTRES, {}, { "POST /api/org/cost-centres": { ok: true, json: async () => ({}) } });
    switchCodingSubTab("Cost Centre");
    const addButton = [...document.querySelectorAll(".cardhead button")].find((b) => b.textContent?.includes("Add"));
    addButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const inputs = document.querySelectorAll<HTMLInputElement>(".editgrid input");
    inputs[0].value = "CC-1";
    inputs[1].value = "Engineering";
    const submit = [...document.querySelectorAll(".cardhead button")].find((b) => b.textContent?.includes("Create"));
    await submit?.click();
    await new Promise((r) => setTimeout(r, 0));

    const postCall = fetchCalls().find(([url, init]) => url === "/api/org/cost-centres" && (init as RequestInit)?.method === "POST");
    expect(JSON.parse((postCall?.[1] as RequestInit).body as string)).toEqual({ id: "CC-1", name: "Engineering" });
  });

  it("editing an existing cost centre sends its parent, approver, limit and company-code filter through the extended PUT route", async () => {
    await openApSetupAs(
      { ...EMPTY_OVERVIEW, units: [{ id: "UK01", name: "Acme UK" }], users: [{ id: "u1", name: "Alice" }] },
      {
        costCentres: [
          { id: "cc1", name: "Sales", ledgerId: null, ledgerName: null, parentCostCentreId: null, parentName: null, ownerUserId: null, ownerName: null, approvalLimit: null, filters: [] },
        ],
      },
      {},
      { "PUT /api/cost-centres/cc1": { ok: true, json: async () => ({}) } }
    );
    switchCodingSubTab("Cost Centre");
    const editListPanel = [...document.querySelectorAll(".panel")].at(-1);
    editListPanel?.querySelector("tbody tr")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const selects = document.querySelectorAll<HTMLSelectElement>(".editgrid select");
    // parent, approver, company code — no cost centres to be a parent of itself.
    selects[1].value = "u1"; // approver
    selects[2].value = "UK01"; // company code
    const limitInput = document.querySelector<HTMLInputElement>(".editgrid input[type=number]");
    limitInput!.value = "9000";

    const submit = [...document.querySelectorAll(".cardhead button")].find((b) => b.textContent?.includes("Save"));
    await submit?.click();
    await new Promise((r) => setTimeout(r, 0));

    const putCall = fetchCalls().find(([url, init]) => url === "/api/cost-centres/cc1" && (init as RequestInit)?.method === "PUT");
    expect(JSON.parse((putCall?.[1] as RequestInit).body as string)).toEqual({
      parentCostCentreId: null,
      ownerUserId: "u1",
      approvalLimit: 9000,
      filters: { company_code: "UK01" },
    });
  });
});

describe("Project — a real hierarchy, decision 0444", () => {
  it("shows the empty state, and no filter columns — project declares none", async () => {
    await openApSetupAs();
    switchCodingSubTab("Project");
    const panel = [...document.querySelectorAll(".panel")].at(-1);
    expect(panel?.textContent).toContain("No projects configured yet.");
    expect([...(panel?.querySelectorAll("th") ?? [])].some((h) => h.textContent === "Company code")).toBe(false);
  });

  it("indents a child entry under its own parent", async () => {
    await openApSetupAs(EMPTY_OVERVIEW, EMPTY_COST_CENTRES, {
      "/api/coding-lists/project": {
        declaredFilters: [],
        entries: [
          { id: "DE01MJO", name: "Mjolner", isDefault: false, approverUserId: null, approverName: null, parentEntryId: null, parentName: null, filters: [] },
          { id: "DE01MJO.10", name: "Investigation", isDefault: false, approverUserId: null, approverName: null, parentEntryId: "DE01MJO", parentName: "Mjolner", filters: [] },
        ],
      },
    });
    switchCodingSubTab("Project");
    const rows = [...document.querySelectorAll("tbody tr")];
    const childSpan = rows.find((r) => r.textContent?.includes("Investigation"))?.querySelector("span");
    expect(childSpan?.getAttribute("style")).toContain("padding-left: 20px");
    expect(rows.find((r) => r.textContent?.includes("Investigation"))?.textContent).toContain("Mjolner");
  });

  it("creates a project entry with a parent and default flag, posting the full field set at once", async () => {
    await openApSetupAs(
      EMPTY_OVERVIEW,
      EMPTY_COST_CENTRES,
      {
        "/api/coding-lists/project": {
          declaredFilters: [],
          entries: [{ id: "DE01MJO", name: "Mjolner", isDefault: false, approverUserId: null, approverName: null, parentEntryId: null, parentName: null, filters: [] }],
        },
      },
      { "POST /api/coding-lists/project": { ok: true, json: async () => ({}) } }
    );
    switchCodingSubTab("Project");
    const addButton = [...document.querySelectorAll(".cardhead button")].find((b) => b.textContent?.includes("Add"));
    addButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const inputs = document.querySelectorAll<HTMLInputElement>(".editgrid input[type=text]");
    inputs[0].value = "DE01MJO.10";
    inputs[1].value = "Investigation";
    const parentSelect = document.querySelector<HTMLSelectElement>(".editgrid select");
    parentSelect!.value = "DE01MJO";
    const defaultCheckbox = document.querySelector<HTMLInputElement>(".editgrid input[type=checkbox]");
    defaultCheckbox!.checked = true;

    const submit = [...document.querySelectorAll(".cardhead button")].find((b) => b.textContent?.includes("Create"));
    await submit?.click();
    await new Promise((r) => setTimeout(r, 0));

    const postCall = fetchCalls().find(([url, init]) => url === "/api/coding-lists/project" && (init as RequestInit)?.method === "POST");
    expect(JSON.parse((postCall?.[1] as RequestInit).body as string)).toEqual({
      id: "DE01MJO.10",
      name: "Investigation",
      parentEntryId: "DE01MJO",
      isDefault: true,
      approverUserId: null,
      filters: {},
    });
  });
});

describe("General Ledger Code — the two declared filters, decision 0444", () => {
  it("shows Company code and Commodity Code as real columns, sourced from the server's own declaredFilters", async () => {
    await openApSetupAs(EMPTY_OVERVIEW, EMPTY_COST_CENTRES, {
      "/api/coding-lists/gl_code": {
        declaredFilters: ["company_code", "commodity_code"],
        entries: [
          {
            id: "800100",
            name: "Plant Suppliers",
            isDefault: false,
            approverUserId: null,
            approverName: null,
            parentEntryId: null,
            parentName: null,
            filters: [
              { filterListTypeId: "company_code", filterEntryId: "UK01", filterEntryName: "Acme UK" },
              { filterListTypeId: "commodity_code", filterEntryId: "10000000", filterEntryName: "Live Plant & Animal Material" },
            ],
          },
        ],
      },
    });
    switchCodingSubTab("General Ledger Code");
    const panel = [...document.querySelectorAll(".panel")].at(-1);
    const headers = [...(panel?.querySelectorAll("th") ?? [])].map((h) => h.textContent);
    expect(headers).toContain("Company code");
    expect(headers).toContain("Commodity Code");
    const rowText = panel?.querySelector("tbody tr")?.textContent ?? "";
    expect(rowText).toContain("Acme UK");
    expect(rowText).toContain("Live Plant & Animal Material");
  });

  it("the create form offers pickers for both declared filters, sourced from units and the commodity code list", async () => {
    await openApSetupAs(
      { ...EMPTY_OVERVIEW, units: [{ id: "UK01", name: "Acme UK" }] },
      EMPTY_COST_CENTRES,
      {
        "/api/coding-lists/gl_code": { declaredFilters: ["company_code", "commodity_code"], entries: [] },
        "/api/coding-lists/commodity_code": {
          declaredFilters: [],
          entries: [{ id: "10000000", name: "Live Plant & Animal Material", isDefault: false, approverUserId: null, approverName: null, parentEntryId: null, parentName: null, filters: [] }],
        },
      },
      { "POST /api/coding-lists/gl_code": { ok: true, json: async () => ({}) } }
    );
    switchCodingSubTab("General Ledger Code");
    const addButton = [...document.querySelectorAll(".cardhead button")].find((b) => b.textContent?.includes("Add"));
    addButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const selects = document.querySelectorAll<HTMLSelectElement>(".editgrid select");
    // parent, approver, company code (filter), commodity code (filter)
    expect(selects).toHaveLength(4);
    const companyCodeOptions = [...selects[2].options].map((o) => o.textContent);
    const commodityCodeOptions = [...selects[3].options].map((o) => o.textContent);
    expect(companyCodeOptions).toContain("Acme UK");
    expect(commodityCodeOptions).toContain("Live Plant & Animal Material");

    const inputs = document.querySelectorAll<HTMLInputElement>(".editgrid input[type=text]");
    inputs[0].value = "800100";
    inputs[1].value = "Plant Suppliers";
    selects[2].value = "UK01";
    selects[3].value = "10000000";

    const submit = [...document.querySelectorAll(".cardhead button")].find((b) => b.textContent?.includes("Create"));
    await submit?.click();
    await new Promise((r) => setTimeout(r, 0));

    const postCall = fetchCalls().find(([url, init]) => url === "/api/coding-lists/gl_code" && (init as RequestInit)?.method === "POST");
    expect(JSON.parse((postCall?.[1] as RequestInit).body as string)).toEqual({
      id: "800100",
      name: "Plant Suppliers",
      parentEntryId: null,
      isDefault: false,
      approverUserId: null,
      filters: { company_code: "UK01", commodity_code: "10000000" },
    });
  });
});

describe("CSV Template and Load — decision 0445", () => {
  it("appears on Cost Centre, Project, Commodity Code, and General Ledger Code", async () => {
    await openApSetupAs();
    for (const label of ["Cost Centre", "Project", "Commodity Code", "General Ledger Code"]) {
      switchCodingSubTab(label);
      const buttons = [...document.querySelectorAll("button")].map((b) => b.textContent);
      expect(buttons, `${label} should have a Load button`).toContain("Load");
      expect(buttons, `${label} should have a Template button`).toContain("Template");
    }
  });

  it("does not appear on Company code — that list stays read-only, generated from the org structure", async () => {
    await openApSetupAs();
    switchCodingSubTab("Company code");
    const buttons = [...document.querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons).not.toContain("Load");
    expect(buttons).not.toContain("Template");
  });

  it("Template is disabled until the format has loaded, and enabled once it has", async () => {
    await openApSetupAs(EMPTY_OVERVIEW, EMPTY_COST_CENTRES, {}, { "/api/coding-lists/project/csv-format": { ok: false, status: 500, json: async () => ({}) } });
    switchCodingSubTab("Project");
    const templateButton = [...document.querySelectorAll("button")].find((b) => b.textContent === "Template") as HTMLButtonElement;
    expect(templateButton.disabled).toBe(true);

    switchCodingSubTab("Commodity Code"); // its own csv-format stub succeeds by default
    const commodityTemplateButton = [...document.querySelectorAll("button")].find((b) => b.textContent === "Template") as HTMLButtonElement;
    expect(commodityTemplateButton.disabled).toBe(false);
  });

  it("Template downloads a CSV built from the format's own recommended columns, including declared filters", async () => {
    await openApSetupAs();
    switchCodingSubTab("General Ledger Code");

    let capturedBlob: Blob | undefined;
    const createSpy = vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      capturedBlob = blob as Blob;
      return "blob:mock";
    });
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const templateButton = [...document.querySelectorAll("button")].find((b) => b.textContent === "Template");
    templateButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(createSpy).toHaveBeenCalledOnce();
    const text = await capturedBlob?.text();
    expect(text).toBe("id,name,default,approver,parent entry id,filter by - company_code,filter by - commodity_code\n");

    createSpy.mockRestore();
    revokeSpy.mockRestore();
    clickSpy.mockRestore();
  });

  it("shows a message when Load is clicked with no file chosen", async () => {
    await openApSetupAs();
    switchCodingSubTab("Project");
    const loadButton = [...document.querySelectorAll("button")].find((b) => b.textContent === "Load");
    loadButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(document.body.textContent).toContain("Choose a file first.");
  });

  it("posts the file's raw text, then refreshes the list and shows what loaded", async () => {
    let projectCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = String(url).split("?")[0];
        if (path === "/api/ui-strings") return { ok: true, json: async () => STRINGS } as Response;
        if (path === "/api/whoami") return { ok: true, json: async () => ({ id: "u-dan", name: "Dan", permissions: ["Admin.Configure"] }) } as Response;
        if (path === "/api/tasks") return { ok: true, json: async () => ({ tasks: [], counts: {} }) } as Response;
        if (path === "/api/org/overview") return { ok: true, json: async () => EMPTY_OVERVIEW } as Response;
        if (path === "/api/approval-config") return { ok: true, json: async () => EMPTY_CONFIG } as Response;
        if (path === "/api/org/cost-centres") return { ok: true, json: async () => EMPTY_COST_CENTRES } as Response;
        if (path === "/api/coding-lists/cost_centre/csv-format") return { ok: true, json: async () => csvFormat("cost_centre", ["company_code"]) } as Response;
        if (path === "/api/coding-lists/project/csv-format") return { ok: true, json: async () => csvFormat("project") } as Response;
        if (path === "/api/coding-lists/commodity_code/csv-format") return { ok: true, json: async () => csvFormat("commodity_code") } as Response;
        if (path === "/api/coding-lists/gl_code/csv-format") return { ok: true, json: async () => csvFormat("gl_code", ["company_code", "commodity_code"]) } as Response;
        if (path === "/api/coding-lists/commodity_code") return { ok: true, json: async () => EMPTY_CODING_LIST } as Response;
        if (path === "/api/coding-lists/gl_code") return { ok: true, json: async () => EMPTY_CODING_LIST } as Response;
        if (path === "/api/coding-lists/project/csv-load") {
          return { ok: true, json: async () => ({ entriesCreated: 1, entriesUpdated: 0, refused: [] }) } as Response;
        }
        if (path === "/api/coding-lists/project") {
          projectCalls++;
          const body =
            projectCalls > 1
              ? {
                  declaredFilters: [],
                  entries: [{ id: "p1", name: "One", isDefault: false, approverUserId: null, approverName: null, parentEntryId: null, parentName: null, filters: [] }],
                }
              : EMPTY_CODING_LIST;
          return { ok: true, json: async () => body } as Response;
        }
        throw new Error(`no stub for ${path}`);
      })
    );
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { start } = await import("/tasks.js");
    await start();
    const { open } = await import("/ap-setup.js");
    await open();
    switchCodingSubTab("Project");
    expect(document.body.textContent).toContain("No projects configured yet.");

    chooseFile("id,name\np1,One");
    const loadButton = [...document.querySelectorAll("button")].find((b) => b.textContent === "Load");
    loadButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(document.body.textContent).toContain("1 entries created");
    expect(document.body.textContent).toContain("0 entries updated");
    expect(document.body.textContent).toContain("One"); // the refreshed list
    expect(document.body.textContent).not.toContain("No projects configured yet.");

    const postCall = fetchCalls().find(([url, init]) => url === "/api/coding-lists/project/csv-load" && (init as RequestInit)?.method === "POST");
    expect((postCall?.[1] as RequestInit).body).toBe("id,name\np1,One");
    expect((postCall?.[1] as RequestInit).headers).toEqual({ "Content-Type": "text/csv" });
  });

  it("shows a refused row with its own id and reason, not a generic failure", async () => {
    await openApSetupAs(EMPTY_OVERVIEW, EMPTY_COST_CENTRES, {}, {
      "POST /api/coding-lists/project/csv-load": {
        entriesCreated: 1,
        entriesUpdated: 0,
        refused: [{ id: "p2", reason: "approver email nobody@acme.com does not exist" }],
      },
    });
    switchCodingSubTab("Project");
    chooseFile("id,name\np1,One\np2,Two");
    const loadButton = [...document.querySelectorAll("button")].find((b) => b.textContent === "Load");
    loadButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(document.body.textContent).toContain("p2: approver email nobody@acme.com does not exist");
  });

  it("shows the route's own error, not a generic message, when the file is structurally refused", async () => {
    await openApSetupAs(EMPTY_OVERVIEW, EMPTY_COST_CENTRES, {}, {
      "POST /api/coding-lists/project/csv-load": { ok: false, status: 400, json: async () => ({ error: "the file needs an id column" }) },
    });
    switchCodingSubTab("Project");
    chooseFile("name\nOne");
    const loadButton = [...document.querySelectorAll("button")].find((b) => b.textContent === "Load");
    loadButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(document.body.textContent).toContain("the file needs an id column");
  });

  it("names the network layer, not the route, when the request never reached the service", async () => {
    stubFetch({
      "/api/ui-strings": STRINGS,
      "/api/whoami": { id: "u-dan", name: "Dan", permissions: ["Admin.Configure"] },
      "/api/tasks": { tasks: [], counts: {} },
      "/api/org/overview": EMPTY_OVERVIEW,
      "/api/approval-config": EMPTY_CONFIG,
      "/api/org/cost-centres": EMPTY_COST_CENTRES,
      "/api/coding-lists/project": EMPTY_CODING_LIST,
      "/api/coding-lists/commodity_code": EMPTY_CODING_LIST,
      "/api/coding-lists/gl_code": EMPTY_CODING_LIST,
      "/api/coding-lists/cost_centre/csv-format": csvFormat("cost_centre", ["company_code"]),
      "/api/coding-lists/project/csv-format": csvFormat("project"),
      "/api/coding-lists/commodity_code/csv-format": csvFormat("commodity_code"),
      "/api/coding-lists/gl_code/csv-format": csvFormat("gl_code", ["company_code", "commodity_code"]),
    });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { start } = await import("/tasks.js");
    await start();
    const { open } = await import("/ap-setup.js");
    await open();
    switchCodingSubTab("Project");

    vi.mocked(fetch).mockImplementationOnce(async () => {
      throw new Error("should not be called");
    });
    // Replace fetch with one that throws only for the csv-load call —
    // every other route this screen already resolved stays a no-op.
    const realFetch = fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url) === "/api/coding-lists/project/csv-load") throw new Error("network down");
        return (realFetch as unknown as (u: string, i?: RequestInit) => Promise<Response>)(url, init);
      })
    );

    chooseFile("id,name\np1,One");
    const loadButton = [...document.querySelectorAll("button")].find((b) => b.textContent === "Load");
    loadButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(document.body.textContent).toContain("Could not reach the server. Try again.");
  });
});

describe("saving fails", () => {
  it("shows the generic coding-entry error, and leaves the form open", async () => {
    await openApSetupAs(EMPTY_OVERVIEW, EMPTY_COST_CENTRES, {}, {
      "POST /api/coding-lists/project": { ok: false, status: 400, json: async () => ({}) },
    });
    switchCodingSubTab("Project");
    const addButton = [...document.querySelectorAll(".cardhead button")].find((b) => b.textContent?.includes("Add"));
    addButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const inputs = document.querySelectorAll<HTMLInputElement>(".editgrid input[type=text]");
    inputs[0].value = "p1";
    inputs[1].value = "P1";
    const submit = [...document.querySelectorAll(".cardhead button")].find((b) => b.textContent?.includes("Create"));
    await submit?.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelector(".popout")).not.toBeNull();
    expect(document.querySelector(".warn")?.textContent).toContain("Could not save that.");
  });
});
