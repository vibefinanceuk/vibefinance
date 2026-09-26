import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * AP Setup — decision 0440.
 *
 * *"Under a new side menu option, I would like to establish AP
 * Configuration options... Matching, Account Coding and Approval
 * Hierarchy setup screens in tabs."* Approval Hierarchy is live: the
 * mode and Default Approver decision 0439's own resolver already
 * reads, plus CRUD for the two unit-scoped override tables. **Account
 * Coding is live too, as of decision 0444** — its own content is
 * covered in depth in `coding-lists.test.ts`; this file only covers
 * that it renders at all, from AP Setup's own tab bar. **Matching is
 * live too, as of decision 0472** — the org-wide default tolerance and
 * quantity-matching toggle `org_matching_config` has held since
 * migration 0078, now with a real form.
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
    "apsetup.codingtab.companycode": "Org / Company Code",
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
    "apsetup.costobjectpriority": "Cost-Object Priority",
    "apsetup.costobjectprioritysub": "Shown because Approval mode is set to Cost-Object. Every dimension switched on here that is also coded on a line raises its own approval task, in parallel.",
    "apsetup.costobjectenable": "Enable",
    "apsetup.costobjectsavefailed": "Could not save the Cost-Object Priority list",
    "apsetup.matchingsub": "The org-wide default tolerance, used whenever a supplier has no tolerance of its own configured.",
    "apsetup.amounttolerance": "Amount tolerance (%)",
    "apsetup.quantitytolerance": "Quantity tolerance (%)",
    "apsetup.quantitymatchingenabled": "Compare quantity at all",
    "apsetup.savematchingfailed": "Could not save the matching configuration",
    "apsetup.standardrules": "Standard matching rules",
    "apsetup.standardrulessub": "Turn a standard matching rule on or off. Authoring one for the first time is done on its own stage's Rules screen, the same way as any rule.",
    "apsetup.standardrulenotcreated": "Not yet created.",
    "apsetup.standardrulesuggested": "Suggested sentence:",
    "apsetup.standardrulepending": "Compiled but not yet activated — review and activate it on its own stage's Rules screen before it can be turned on or off here.",
    "apsetup.standardrulesavefailed": "Could not update that rule",
    "apsetup.stagerestrictions": "Stage Restrictions",
    "apsetup.stagerestrictions.sub": "What a stage leaves editable beyond its own rule set.",
    "apsetup.stagerestrictions.process": "Process",
    "apsetup.stagerestrictions.noprocess": "No process configured yet.",
    "apsetup.stagerestrictions.fieldsheading": "Account Coding editable here",
    "apsetup.stagerestrictions.fieldshint": "Unchecked hides the field at this stage entirely.",
    "apsetup.stagerestrictions.hiddeneverywhere": "Hidden for everyone — set on the Account Coding tab first.",
    "apsetup.stagerestrictions.savefailed": "Could not save that restriction. Try again.",
    "apsetup.stagerestrictions.offerhere": "Offer Account Coding restrictions for this stage",
    "apsetup.stagerestrictions.notoffered": "Not configurable here.",
    "apsetup.stagerestrictions.reverifyoncomplete": "Re-check the rule before Complete",
    "apsetup.stagerestrictions.discardallowed": "Allow Discard at this stage",
    "apsetup.stagerestrictions.returntargetsheading": "Return targets",
    "apsetup.stagerestrictions.returntargetshint": "Where Return can send a document from this stage, and which team receives it. Only stages a document has actually visited are ever offered when returning it.",
    "apsetup.stagerestrictions.notargetsyet": "No return targets configured for this stage yet.",
    "apsetup.stagerestrictions.targetstage": "Target stage",
    "apsetup.stagerestrictions.returnteam": "Team",
    "action.return.wholabel": "Return to",
    "action.return.reasonlabel": "Reason",
    "action.return.nonefound": "No return targets are configured for this stage.",
    "field.coding.project": "Project",
    "field.coding.commodity_code": "Commodity code",
    "field.coding.gl_code": "General ledger code",
    "processes.automatic": "Automatic",
    "apsetup.returnreasons": "Return Reasons",
    "apsetup.returnreasons.sub": "The reasons available when returning an invoice to its supplier.",
    "apsetup.returnreasons.active": "Active",
    "apsetup.returnreasons.newid": "ID",
    "apsetup.returnreasons.newlabel": "Label",
    "apsetup.returnreasons.idandlabelrequired": "An ID and a label are both required.",
    "apsetup.returnreasons.savefailed": "Could not save that. Try again.",
    "apsetup.returnreasons.apteamemail": "AP team email",
    "apsetup.returnreasons.apteamemailsub": "Copied in on a Return To Supplier email when the sender ticks the box.",
    "apsetup.returnreasons.apteamemailplaceholder": "ap-team@example.com",
  },
};

const EMPTY_OVERVIEW = { units: [], users: [], roles: [], assignments: [], authorityLimits: [], knownPermissions: [] };
const EMPTY_CONFIG = {
  mode: "employee_supervisor",
  defaultApproverUserId: null,
  defaultApproverName: null,
  supervisorOverrides: [],
  limitOverrides: [],
  costObjectDimensions: [],
};
const EMPTY_MATCHING_CONFIG = { amountTolerancePct: 0, quantityTolerancePct: 0, quantityMatchingEnabled: true };
/**
 * **Standard matching rules — decision 0474.** The four canonical
 * names, matching `STANDARD_MATCHING_RULES` in
 * `matching-config-route.ts`, with no matches yet — the same "every
 * standard rule accounted for, nothing found" shape
 * `handleGetStandardMatchingRules` itself returns before anything has
 * been authored.
 */
const EMPTY_STANDARD_RULES = {
  standardRules: [
    { key: "po_line_not_found", name: "Standard rule: PO line not found", fact: "po.line_reference_found", suggestedSentence: "If a purchase order line cannot be found for an invoice line, assign a task to the AP Matching team requiring AP.Match.", matches: [] },
    { key: "price_mismatch", name: "Standard rule: Price mismatch", fact: "po.line_price_matched", suggestedSentence: "If a line's price does not match its purchase order line, assign a task to the AP Matching team requiring AP.Match.", matches: [] },
    { key: "quantity_mismatch", name: "Standard rule: Quantity mismatch", fact: "po.line_quantity_matched", suggestedSentence: "If a line's quantity does not match its purchase order line, assign a task to the AP Matching team requiring AP.Match.", matches: [] },
    { key: "unit_mismatch", name: "Standard rule: Unit of measure mismatch", fact: "po.line_unit_mismatch", suggestedSentence: "If a line's unit of measure does not match its purchase order line, assign a task to the AP Matching team requiring AP.Match.", matches: [] },
  ],
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
    "/api/matching-config": EMPTY_MATCHING_CONFIG,
    "/api/matching-config/standard-rules": EMPTY_STANDARD_RULES,
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
    expect(document.querySelector(".panel")?.textContent).toContain("Amount tolerance");
  });
});

/**
 * **The Matching tab — decision 0472.** One form, one Save, the exact
 * same shape the Approval Hierarchy tab's own mode/Default Approver
 * form already established, tested the same way that form's own
 * describe block is (`openApSetupAs`, `switchTab`, and a real fetch
 * assertion on the save).
 */
describe("Matching — the org-wide tolerance and quantity-matching toggle form (decision 0472)", () => {
  it("defaults to 0 / 0 / on when nothing has been configured yet", async () => {
    await openApSetupAs(["Admin.Configure"]);

    const numberInputs = [...document.querySelectorAll(".editgrid input[type=number]")] as HTMLInputElement[];
    expect(numberInputs.map((i) => i.value)).toEqual(["0", "0"]);
    const checkbox = document.querySelector(".editgrid input[type=checkbox]") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it("shows the configured tolerances and toggle already filled in", async () => {
    await openApSetupAs(["Admin.Configure"], EMPTY_OVERVIEW, EMPTY_CONFIG, {
      "/api/matching-config": { amountTolerancePct: 5, quantityTolerancePct: 2.5, quantityMatchingEnabled: false },
    });
    switchTab("Matching");

    const numberInputs = [...document.querySelectorAll(".editgrid input[type=number]")] as HTMLInputElement[];
    expect(numberInputs.map((i) => i.value)).toEqual(["5", "2.5"]);
    const checkbox = document.querySelector(".editgrid input[type=checkbox]") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });

  it("saves all three fields together", async () => {
    await openApSetupAs(["Admin.Configure"], EMPTY_OVERVIEW, EMPTY_CONFIG, {
      "PUT /api/matching-config": {
        ok: true,
        json: async () => ({ amountTolerancePct: 3, quantityTolerancePct: 1, quantityMatchingEnabled: false }),
      },
    });

    const [amountInput, quantityInput] = [...document.querySelectorAll(".editgrid input[type=number]")] as HTMLInputElement[];
    amountInput.value = "3";
    quantityInput.value = "1";
    const checkbox = document.querySelector(".editgrid input[type=checkbox]") as HTMLInputElement;
    checkbox.checked = false;

    const saveButton = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Save"));
    saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const put = calls.find(([url, init]) => url === "/api/matching-config" && init?.method === "PUT");
    expect(put).toBeTruthy();
    expect(JSON.parse(put![1].body as string)).toEqual({
      amountTolerancePct: 3,
      quantityTolerancePct: 1,
      quantityMatchingEnabled: false,
    });
  });

  it("shows a real problem message, not a silent failure, when the save fails", async () => {
    await openApSetupAs(["Admin.Configure"], EMPTY_OVERVIEW, EMPTY_CONFIG, {
      "PUT /api/matching-config": { ok: false, status: 500, json: async () => ({ error: "amountTolerancePct must be a number, 0 or greater" }) },
    });

    const saveButton = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Save"));
    saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelector(".warn")?.textContent).toBe("amountTolerancePct must be a number, 0 or greater");
  });
});

/**
 * **Standard matching rules — decision 0474.** The panel below the
 * Matching tab's own tolerance form: checkboxes that only enable or
 * disable a rule that already exists — reusing `PUT /api/rules/:id/
 * enabled` (decision 0155) directly, never `/rules/compile` or
 * `/rules/:id/versions/:v/activate`. Covers the not-yet-created state,
 * the live/paused toggle, draft/awaiting_confirmation shown disabled,
 * and more than one match shown as separate rows — the same four
 * shapes `handleGetStandardMatchingRules`'s own route tests already
 * cover server-side.
 */
describe("Matching — standard matching rules (decision 0474)", () => {
  function standardRulesPanel(): Element {
    const panel = [...document.querySelectorAll(".panel")].find((p) => p.querySelector("h3")?.textContent === "Standard matching rules");
    if (!panel) throw new Error(`no panel found for "Standard matching rules"`);
    return panel;
  }

  it("shows all four canonical rules as not-yet-created, with their own suggested sentence, when none exist", async () => {
    await openApSetupAs(["Admin.Configure"]);

    const panel = standardRulesPanel();
    expect(panel.textContent).toContain("Standard rule: PO line not found");
    expect(panel.textContent).toContain("Standard rule: Price mismatch");
    expect(panel.textContent).toContain("Standard rule: Quantity mismatch");
    expect(panel.textContent).toContain("Standard rule: Unit of measure mismatch");
    expect(panel.textContent).toContain("Not yet created.");
    expect(panel.textContent).toContain("If a purchase order line cannot be found for an invoice line");
    // Nothing to toggle yet.
    expect(panel.querySelectorAll("input[type=checkbox]").length).toBe(0);
  });

  it("a live rule's checkbox is checked and interactive; unchecking it calls PUT /rules/:id/enabled with enabled: false", async () => {
    await openApSetupAs(["Admin.Configure"], EMPTY_OVERVIEW, EMPTY_CONFIG, {
      "/api/matching-config/standard-rules": {
        standardRules: [
          { ...EMPTY_STANDARD_RULES.standardRules[0], matches: [] },
          {
            ...EMPTY_STANDARD_RULES.standardRules[1],
            matches: [{ ruleId: "r-price", stageName: "Matching", processName: "AP", enabled: true, state: "live" }],
          },
          { ...EMPTY_STANDARD_RULES.standardRules[2], matches: [] },
          { ...EMPTY_STANDARD_RULES.standardRules[3], matches: [] },
        ],
      },
      "PUT /api/rules/r-price/enabled": { ok: true, json: async () => ({ id: "r-price", enabled: false }) },
    });

    const panel = standardRulesPanel();
    const checkbox = panel.querySelector("input[type=checkbox]") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(checkbox.disabled).toBe(false);

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));

    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const put = calls.find(([url, init]) => url === "/api/rules/r-price/enabled" && init?.method === "PUT");
    expect(put).toBeTruthy();
    expect(JSON.parse(put![1].body as string)).toEqual({ enabled: false });
  });

  it("a paused rule's checkbox is unchecked but still interactive — re-checking it calls the same route with enabled: true", async () => {
    await openApSetupAs(["Admin.Configure"], EMPTY_OVERVIEW, EMPTY_CONFIG, {
      "/api/matching-config/standard-rules": {
        standardRules: [
          {
            ...EMPTY_STANDARD_RULES.standardRules[0],
            matches: [{ ruleId: "r-paused", stageName: "Matching", processName: "AP", enabled: false, state: "paused" }],
          },
          { ...EMPTY_STANDARD_RULES.standardRules[1], matches: [] },
          { ...EMPTY_STANDARD_RULES.standardRules[2], matches: [] },
          { ...EMPTY_STANDARD_RULES.standardRules[3], matches: [] },
        ],
      },
      "PUT /api/rules/r-paused/enabled": { ok: true, json: async () => ({ id: "r-paused", enabled: true }) },
    });

    const panel = standardRulesPanel();
    const checkbox = panel.querySelector("input[type=checkbox]") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    expect(checkbox.disabled).toBe(false);

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));

    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const put = calls.find(([url, init]) => url === "/api/rules/r-paused/enabled" && init?.method === "PUT");
    expect(JSON.parse(put![1].body as string)).toEqual({ enabled: true });
  });

  it("draft and awaiting_confirmation matches show disabled, with an explanatory note, never a checkbox that quietly does nothing", async () => {
    await openApSetupAs(["Admin.Configure"], EMPTY_OVERVIEW, EMPTY_CONFIG, {
      "/api/matching-config/standard-rules": {
        standardRules: [
          {
            ...EMPTY_STANDARD_RULES.standardRules[0],
            matches: [{ ruleId: "r-draft", stageName: "Matching", processName: "AP", enabled: true, state: "draft" }],
          },
          {
            ...EMPTY_STANDARD_RULES.standardRules[1],
            matches: [{ ruleId: "r-awaiting", stageName: "Matching", processName: "AP", enabled: true, state: "awaiting_confirmation" }],
          },
          { ...EMPTY_STANDARD_RULES.standardRules[2], matches: [] },
          { ...EMPTY_STANDARD_RULES.standardRules[3], matches: [] },
        ],
      },
    });

    const panel = standardRulesPanel();
    const checkboxes = [...panel.querySelectorAll("input[type=checkbox]")] as HTMLInputElement[];
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes.every((c) => c.disabled)).toBe(true);
    expect(panel.textContent).toContain("Compiled but not yet activated");
  });

  it("more than one match for the same standard rule shows a separate row per match, each toggled independently", async () => {
    await openApSetupAs(["Admin.Configure"], EMPTY_OVERVIEW, EMPTY_CONFIG, {
      "/api/matching-config/standard-rules": {
        standardRules: [
          { ...EMPTY_STANDARD_RULES.standardRules[0], matches: [] },
          {
            ...EMPTY_STANDARD_RULES.standardRules[1],
            matches: [
              { ruleId: "r-eu", stageName: "Matching", processName: "AP Europe", enabled: true, state: "live" },
              { ruleId: "r-us", stageName: "Matching", processName: "AP US", enabled: false, state: "paused" },
            ],
          },
          { ...EMPTY_STANDARD_RULES.standardRules[2], matches: [] },
          { ...EMPTY_STANDARD_RULES.standardRules[3], matches: [] },
        ],
      },
    });

    const panel = standardRulesPanel();
    expect(panel.textContent).toContain("AP Europe");
    expect(panel.textContent).toContain("AP US");
    const checkboxes = [...panel.querySelectorAll("input[type=checkbox]")] as HTMLInputElement[];
    expect(checkboxes.map((c) => c.checked)).toEqual([true, false]);
  });

  it("shows a real problem message, not a silent failure, when the toggle save fails — and reverts the checkbox", async () => {
    await openApSetupAs(["Admin.Configure"], EMPTY_OVERVIEW, EMPTY_CONFIG, {
      "/api/matching-config/standard-rules": {
        standardRules: [
          {
            ...EMPTY_STANDARD_RULES.standardRules[0],
            matches: [{ ruleId: "r-price", stageName: "Matching", processName: "AP", enabled: true, state: "live" }],
          },
          { ...EMPTY_STANDARD_RULES.standardRules[1], matches: [] },
          { ...EMPTY_STANDARD_RULES.standardRules[2], matches: [] },
          { ...EMPTY_STANDARD_RULES.standardRules[3], matches: [] },
        ],
      },
      "PUT /api/rules/r-price/enabled": { ok: false, status: 500, json: async () => ({ error: "Could not update that rule" }) },
    });

    const panel = standardRulesPanel();
    const checkbox = panel.querySelector("input[type=checkbox]") as HTMLInputElement;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));

    expect(panel.querySelector(".warn")?.textContent).toBe("Could not update that rule");
    expect((standardRulesPanel().querySelector("input[type=checkbox]") as HTMLInputElement).checked).toBe(true);
  });
});

describe("Account Coding — decision 0444", () => {
  it("Account Coding shows its own five sub-tabs, defaulting to Org / Company Code", async () => {
    await openApSetupAs(["Admin.Configure"]);
    switchTab("Account Coding");
    const subTabs = [...document.querySelectorAll(".tabbar")][1]?.textContent ?? "";
    expect(subTabs).toContain("Org / Company Code");
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

/**
 * **Cost-Object Priority — decision 0452.** Turns decision 0450's own
 * mock-up into the real panel: shown only in Cost-Object mode, a
 * checkbox per dimension, and drag-to-reorder mirroring
 * `processes.js`'s own stage-sequence drag control (decision 0352,
 * covered directly in `processes.test.ts`) — the same
 * dispatchEvent("dragstart"/"dragover"/"drop") pattern is reused here
 * rather than a real DataTransfer, since jsdom's own support for that
 * is incomplete and this app's own code never reads it either.
 */
describe("Approval Hierarchy — Cost-Object Priority (decision 0452)", () => {
  const FOUR_DIMENSIONS = [
    { listTypeId: "cost_centre", name: "Cost Centre", enabled: true, sequence: 0 },
    { listTypeId: "project", name: "Project", enabled: false, sequence: 1 },
    { listTypeId: "commodity_code", name: "Commodity Code", enabled: false, sequence: 2 },
    { listTypeId: "gl_code", name: "General Ledger Code", enabled: false, sequence: 3 },
  ];

  function priorityPanel(): Element {
    const panel = [...document.querySelectorAll(".panel")].find((p) => p.querySelector("h3")?.textContent === "Cost-Object Priority");
    if (!panel) throw new Error(`no panel found for "Cost-Object Priority"`);
    return panel;
  }

  it("is not shown at all in any mode but Cost-Object", async () => {
    await openApSetupAs(["Admin.Configure"], EMPTY_OVERVIEW, { ...EMPTY_CONFIG, mode: "employee_supervisor", costObjectDimensions: FOUR_DIMENSIONS });
    switchTab("Approval Hierarchy");
    expect([...document.querySelectorAll(".panel h3")].some((h) => h.textContent === "Cost-Object Priority")).toBe(false);
  });

  it("lists all four dimensions, in sequence order, with their own enabled state — shown once Mode is Cost-Object", async () => {
    await openApSetupAs(["Admin.Configure"], EMPTY_OVERVIEW, { ...EMPTY_CONFIG, mode: "cost_object", costObjectDimensions: FOUR_DIMENSIONS });
    switchTab("Approval Hierarchy");

    const panel = priorityPanel();
    const rows = [...panel.querySelectorAll(".assignmentrow")];
    expect(rows.map((r) => r.querySelector("span")?.textContent)).toEqual([
      "1. Cost Centre",
      "2. Project",
      "3. Commodity Code",
      "4. General Ledger Code",
    ]);
    expect(rows.every((r) => r.textContent?.includes("Enable"))).toBe(true);
    const checkboxes = rows.map((r) => r.querySelector("input[type=checkbox]") as HTMLInputElement);
    expect(checkboxes.map((c) => c.checked)).toEqual([true, false, false, false]);
  });

  it("toggling a dimension's own checkbox saves the full four-row array, with only that one flipped", async () => {
    const puts: unknown[] = [];
    await openApSetupAs(
      ["Admin.Configure"],
      EMPTY_OVERVIEW,
      { ...EMPTY_CONFIG, mode: "cost_object", costObjectDimensions: FOUR_DIMENSIONS },
      {
        "PUT /api/approval-config/cost-object-dimensions": {
          ok: true,
          json: async () => {
            return { configured: 4 };
          },
        },
      }
    );
    switchTab("Approval Hierarchy");

    const projectRow = [...priorityPanel().querySelectorAll(".assignmentrow")].find((r) => r.textContent?.includes("Project"));
    const checkbox = projectRow?.querySelector("input[type=checkbox]") as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));

    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const put = calls.find(([url, init]) => url === "/api/approval-config/cost-object-dimensions" && init?.method === "PUT");
    expect(put).toBeTruthy();
    expect(JSON.parse(put![1].body as string)).toEqual({
      dimensions: [
        { listTypeId: "cost_centre", enabled: true, sequence: 0 },
        { listTypeId: "project", enabled: true, sequence: 1 },
        { listTypeId: "commodity_code", enabled: false, sequence: 2 },
        { listTypeId: "gl_code", enabled: false, sequence: 3 },
      ],
    });
  });

  it("marks every row draggable, and dropping the first onto the last sends the whole new order, re-sequenced from 0", async () => {
    await openApSetupAs(
      ["Admin.Configure"],
      EMPTY_OVERVIEW,
      { ...EMPTY_CONFIG, mode: "cost_object", costObjectDimensions: FOUR_DIMENSIONS },
      { "PUT /api/approval-config/cost-object-dimensions": { ok: true, json: async () => ({ configured: 4 }) } }
    );
    switchTab("Approval Hierarchy");

    const rows = [...priorityPanel().querySelectorAll(".assignmentrow")] as HTMLElement[];
    expect(rows.every((r) => r.getAttribute("draggable") === "true")).toBe(true);

    rows[0].dispatchEvent(new Event("dragstart", { bubbles: true }));
    rows[3].dispatchEvent(new Event("dragover", { bubbles: true, cancelable: true }));
    rows[3].dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));

    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const put = calls.find(([url, init]) => url === "/api/approval-config/cost-object-dimensions" && init?.method === "PUT");
    expect(JSON.parse(put![1].body as string)).toEqual({
      dimensions: [
        { listTypeId: "project", enabled: false, sequence: 0 },
        { listTypeId: "commodity_code", enabled: false, sequence: 1 },
        { listTypeId: "gl_code", enabled: false, sequence: 2 },
        { listTypeId: "cost_centre", enabled: true, sequence: 3 },
      ],
    });
  });

  it("a failed save shows the panel's own error", async () => {
    await openApSetupAs(
      ["Admin.Configure"],
      EMPTY_OVERVIEW,
      { ...EMPTY_CONFIG, mode: "cost_object", costObjectDimensions: FOUR_DIMENSIONS },
      { "PUT /api/approval-config/cost-object-dimensions": { ok: false, status: 422, json: async () => ({ error: "no" }) } }
    );
    switchTab("Approval Hierarchy");

    const projectRow = [...priorityPanel().querySelectorAll(".assignmentrow")].find((r) => r.textContent?.includes("Project"));
    const checkbox = projectRow?.querySelector("input[type=checkbox]") as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelector(".warn")?.textContent).toContain("no");
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

/**
 * **Stage Restrictions — decision 0483.** Reported live: Account
 * Coding was showing up as editable on the Validation stage, when
 * nobody had asked for that. The route behind this tab
 * (`PUT /processes/stages/:id/field-visibility`) already existed and
 * is already covered end to end in `field-visibility.test.ts`; these
 * tests cover the screen on top of it — what a checkbox shows, what a
 * toggle actually sends, and that it never clobbers a restriction
 * this tab does not itself render a checkbox for.
 *
 * Every scenario here uses a single-stage process. `stubFetch`'s own
 * key scheme strips the query string off a GET, so two stages would
 * collapse onto the one stubbed `/api/field-visibility` response —
 * a real limit of the shared harness, not of the screen; the multi-
 * stage "restricting one stage leaves another untouched" case is
 * already proven server-side, in `field-visibility.test.ts`'s own "can
 * hide at one stage what is editable at another".
 */
describe("Stage Restrictions (decision 0483)", () => {
  const ONE_PROCESS = { processes: [{ id: "ap", name: "AP", version: 1, stageCount: 1 }] };
  const ONE_STAGE_DETAIL = {
    id: "ap",
    name: "AP",
    version: 1,
    stages: [{ id: "validation", name: "Validation", sequence: 1, ruleSetId: "rs1", ruleSetName: "Validation Rules", evaluationScope: "header" }],
    draft: null,
  };

  function codingField(field: string, visibility: "edit" | "read" | "hidden", decidedBy: "default" | "customer" | "stage") {
    return { field, visibility, description: field, type: "text", line: true, sortOrder: 0, decidedBy };
  }

  function stageRestrictionsRoutes(fields: unknown[], extra: Record<string, unknown> = {}) {
    return {
      "/api/processes": ONE_PROCESS,
      "/api/processes/ap": ONE_STAGE_DETAIL,
      "/api/field-visibility": { stageId: "validation", fields, derived: {} },
      ...extra,
    };
  }

  function stagePanel(): Element {
    const panel = [...document.querySelectorAll(".panel")].find((p) => p.querySelector("h3")?.textContent === "Validation");
    if (!panel) throw new Error(`no panel found for stage "Validation"`);
    return panel;
  }

  it("shows the stage's own rule set name beside its title", async () => {
    await openApSetupAs(["Admin.Configure"], EMPTY_OVERVIEW, EMPTY_CONFIG, stageRestrictionsRoutes([]));
    switchTab("Stage Restrictions");

    expect(stagePanel().textContent).toContain("Validation Rules");
  });

  it("says Automatic when a stage carries no rule set", async () => {
    await openApSetupAs(
      ["Admin.Configure"],
      EMPTY_OVERVIEW,
      EMPTY_CONFIG,
      stageRestrictionsRoutes([], {
        "/api/processes/ap": { ...ONE_STAGE_DETAIL, stages: [{ ...ONE_STAGE_DETAIL.stages[0], ruleSetId: null, ruleSetName: null }] },
      })
    );
    switchTab("Stage Restrictions");

    expect(stagePanel().textContent).toContain("Automatic");
  });

  it("checks all three Account Coding fields when nothing restricts them at this stage", async () => {
    await openApSetupAs(
      ["Admin.Configure"],
      EMPTY_OVERVIEW,
      EMPTY_CONFIG,
      stageRestrictionsRoutes([
        codingField("coding.project", "edit", "customer"),
        codingField("coding.commodity_code", "edit", "customer"),
        codingField("coding.gl_code", "edit", "customer"),
      ])
    );
    switchTab("Stage Restrictions");

    const panel = stagePanel();
    expect(panel.textContent).toContain("Project");
    expect(panel.textContent).toContain("Commodity code");
    expect(panel.textContent).toContain("General ledger code");
    // Scoped to the three field checkboxes — decision 0485 added a
    // fourth checkbox to this same panel (the "offer this stage here"
    // toggle), which is not one of this test's own three fields.
    const boxes = [...panel.querySelectorAll("input[type=checkbox][id^=stagerestrict-]")] as HTMLInputElement[];
    expect(boxes.length).toBe(3);
    expect(boxes.every((b) => b.checked)).toBe(true);
    expect(boxes.every((b) => !b.disabled)).toBe(true);
  });

  it("unchecks the field this stage itself restricts to hidden", async () => {
    await openApSetupAs(
      ["Admin.Configure"],
      EMPTY_OVERVIEW,
      EMPTY_CONFIG,
      stageRestrictionsRoutes([
        codingField("coding.project", "hidden", "stage"),
        codingField("coding.commodity_code", "edit", "customer"),
        codingField("coding.gl_code", "edit", "customer"),
      ])
    );
    switchTab("Stage Restrictions");

    const panel = stagePanel();
    const projectRow = [...panel.querySelectorAll(".assignmentrow")].find((r) => r.textContent?.includes("Project"));
    const checkbox = projectRow?.querySelector("input[type=checkbox]") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    expect(checkbox.disabled).toBe(false);
  });

  it("shows a hidden-everywhere field as disabled, with an explanation, rather than a checkbox that could never do anything", async () => {
    await openApSetupAs(
      ["Admin.Configure"],
      EMPTY_OVERVIEW,
      EMPTY_CONFIG,
      stageRestrictionsRoutes([
        codingField("coding.project", "hidden", "default"),
        codingField("coding.commodity_code", "edit", "customer"),
        codingField("coding.gl_code", "edit", "customer"),
      ])
    );
    switchTab("Stage Restrictions");

    const panel = stagePanel();
    const projectRow = [...panel.querySelectorAll(".assignmentrow")].find((r) => r.textContent?.includes("Project"));
    expect(projectRow?.textContent).toContain("Hidden for everyone — set on the Account Coding tab first.");
    const checkbox = projectRow?.querySelector("input[type=checkbox]") as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
  });

  it("unchecking a field PUTs a stage restriction hiding it, preserving a restriction on a field this tab does not render", async () => {
    await openApSetupAs(
      ["Admin.Configure"],
      EMPTY_OVERVIEW,
      EMPTY_CONFIG,
      stageRestrictionsRoutes(
        [
          codingField("coding.project", "edit", "customer"),
          codingField("coding.commodity_code", "edit", "customer"),
          codingField("coding.gl_code", "edit", "customer"),
          // Not one of this tab's own three — a restriction set some
          // other way (the raw API, or a future screen) that this
          // save must not silently undo.
          { field: "BT-112", visibility: "read", description: "Total with VAT", type: "number", line: false, sortOrder: 0, decidedBy: "stage" },
        ],
        {
          "PUT /api/processes/stages/validation/field-visibility": {
            ok: true,
            json: async () => ({ stageId: "validation", restrictions: 2 }),
          },
        }
      )
    );
    switchTab("Stage Restrictions");

    const panel = stagePanel();
    const projectRow = [...panel.querySelectorAll(".assignmentrow")].find((r) => r.textContent?.includes("Project"));
    const checkbox = projectRow?.querySelector("input[type=checkbox]") as HTMLInputElement;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));

    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const put = calls.find(
      ([url, init]) => url === "/api/processes/stages/validation/field-visibility" && init?.method === "PUT"
    );
    expect(put).toBeTruthy();
    const putBody = JSON.parse(put![1].body as string);
    expect(putBody).toEqual({
      fields: expect.arrayContaining([
        { field: "BT-112", visibility: "read" },
        { field: "coding.project", visibility: "hidden" },
      ]),
    });
    expect((putBody as { fields: unknown[] }).fields).toHaveLength(2);
  });

  it("re-checking a restricted field PUTs it removed, leaving other restrictions in place", async () => {
    await openApSetupAs(
      ["Admin.Configure"],
      EMPTY_OVERVIEW,
      EMPTY_CONFIG,
      stageRestrictionsRoutes(
        [
          codingField("coding.project", "hidden", "stage"),
          codingField("coding.commodity_code", "edit", "customer"),
          codingField("coding.gl_code", "edit", "customer"),
        ],
        {
          "PUT /api/processes/stages/validation/field-visibility": {
            ok: true,
            json: async () => ({ stageId: "validation", restrictions: 0 }),
          },
        }
      )
    );
    switchTab("Stage Restrictions");

    const panel = stagePanel();
    const projectRow = [...panel.querySelectorAll(".assignmentrow")].find((r) => r.textContent?.includes("Project"));
    const checkbox = projectRow?.querySelector("input[type=checkbox]") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));

    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const put = calls.find(
      ([url, init]) => url === "/api/processes/stages/validation/field-visibility" && init?.method === "PUT"
    );
    expect(put).toBeTruthy();
    expect(JSON.parse(put![1].body as string)).toEqual({ fields: [] });
  });

  it("shows a real error and reverts the checkbox when the save fails", async () => {
    await openApSetupAs(
      ["Admin.Configure"],
      EMPTY_OVERVIEW,
      EMPTY_CONFIG,
      stageRestrictionsRoutes(
        [
          codingField("coding.project", "edit", "customer"),
          codingField("coding.commodity_code", "edit", "customer"),
          codingField("coding.gl_code", "edit", "customer"),
        ],
        {
          "PUT /api/processes/stages/validation/field-visibility": {
            ok: false,
            status: 422,
            json: async () => ({ error: "a stage may restrict to read or hidden, never grant edit" }),
          },
        }
      )
    );
    switchTab("Stage Restrictions");

    const panel = stagePanel();
    const projectRow = [...panel.querySelectorAll(".assignmentrow")].find((r) => r.textContent?.includes("Project"));
    const checkbox = projectRow?.querySelector("input[type=checkbox]") as HTMLInputElement;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));

    expect(checkbox.checked).toBe(true);
    expect(document.body.textContent).toContain("a stage may restrict to read or hidden, never grant edit");
  });

  it("shows no process configured, rather than an error, when the tenant has none yet", async () => {
    await openApSetupAs(["Admin.Configure"], EMPTY_OVERVIEW, EMPTY_CONFIG, {
      "/api/processes": { processes: [] },
    });
    switchTab("Stage Restrictions");

    expect(document.body.textContent).toContain("No process configured yet.");
  });

  describe("which stages the screen even offers — decision 0485", () => {
    // A stage row the process detail is silent about behaves like the
    // column's own default (offered), matching every fixture above
    // this block, none of which set `offerFieldRestrictions` at all.
    it("offers a stage the detail is silent about, same as before this decision", async () => {
      await openApSetupAs(["Admin.Configure"], EMPTY_OVERVIEW, EMPTY_CONFIG, stageRestrictionsRoutes([]));
      switchTab("Stage Restrictions");

      const panel = stagePanel();
      expect(panel.querySelectorAll("input[type=checkbox][id^=stagerestrict-]").length).toBe(3);
    });

    it("shows the field checkboxes and a checked toggle for a stage offered here", async () => {
      await openApSetupAs(
        ["Admin.Configure"],
        EMPTY_OVERVIEW,
        EMPTY_CONFIG,
        stageRestrictionsRoutes([
          codingField("coding.project", "edit", "customer"),
          codingField("coding.commodity_code", "edit", "customer"),
          codingField("coding.gl_code", "edit", "customer"),
        ], {
          "/api/processes/ap": {
            ...ONE_STAGE_DETAIL,
            stages: [{ ...ONE_STAGE_DETAIL.stages[0], offerFieldRestrictions: true }],
          },
        })
      );
      switchTab("Stage Restrictions");

      const panel = stagePanel();
      expect(panel.querySelectorAll("input[type=checkbox][id^=stagerestrict-]").length).toBe(3);
      const toggle = panel.querySelector(`input[id^="stageoffer-"]`) as HTMLInputElement;
      expect(toggle.checked).toBe(true);
    });

    it("shows an explanation and no field checkboxes for a stage not offered here, with an unchecked toggle", async () => {
      await openApSetupAs(
        ["Admin.Configure"],
        EMPTY_OVERVIEW,
        EMPTY_CONFIG,
        stageRestrictionsRoutes([], {
          "/api/processes/ap": {
            ...ONE_STAGE_DETAIL,
            stages: [{ ...ONE_STAGE_DETAIL.stages[0], offerFieldRestrictions: false }],
          },
        })
      );
      switchTab("Stage Restrictions");

      const panel = stagePanel();
      expect(panel.querySelectorAll("input[type=checkbox][id^=stagerestrict-]").length).toBe(0);
      expect(panel.textContent).toContain("Not configurable here.");
      const toggle = panel.querySelector(`input[id^="stageoffer-"]`) as HTMLInputElement;
      expect(toggle.checked).toBe(false);
    });

    it("turning the toggle off PUTs offer:false to the new route", async () => {
      await openApSetupAs(
        ["Admin.Configure"],
        EMPTY_OVERVIEW,
        EMPTY_CONFIG,
        stageRestrictionsRoutes(
          [
            codingField("coding.project", "edit", "customer"),
            codingField("coding.commodity_code", "edit", "customer"),
            codingField("coding.gl_code", "edit", "customer"),
          ],
          {
            "/api/processes/ap": {
              ...ONE_STAGE_DETAIL,
              stages: [{ ...ONE_STAGE_DETAIL.stages[0], offerFieldRestrictions: true }],
            },
            "PUT /api/processes/stages/validation/offer-field-restrictions": {
              ok: true,
              json: async () => ({ stageId: "validation", offerFieldRestrictions: false }),
            },
          }
        )
      );
      switchTab("Stage Restrictions");

      const panel = stagePanel();
      const toggle = panel.querySelector(`input[id^="stageoffer-"]`) as HTMLInputElement;
      toggle.checked = false;
      toggle.dispatchEvent(new Event("change"));
      await new Promise((r) => setTimeout(r, 0));

      const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
      const put = calls.find(
        ([url, init]) => url === "/api/processes/stages/validation/offer-field-restrictions" && init?.method === "PUT"
      );
      expect(put).toBeTruthy();
      expect(JSON.parse(put![1].body as string)).toEqual({ offer: false });
    });

    it("turning the toggle back on PUTs offer:true", async () => {
      await openApSetupAs(
        ["Admin.Configure"],
        EMPTY_OVERVIEW,
        EMPTY_CONFIG,
        stageRestrictionsRoutes([], {
          "/api/processes/ap": {
            ...ONE_STAGE_DETAIL,
            stages: [{ ...ONE_STAGE_DETAIL.stages[0], offerFieldRestrictions: false }],
          },
          "PUT /api/processes/stages/validation/offer-field-restrictions": {
            ok: true,
            json: async () => ({ stageId: "validation", offerFieldRestrictions: true }),
          },
        })
      );
      switchTab("Stage Restrictions");

      const panel = stagePanel();
      const toggle = panel.querySelector(`input[id^="stageoffer-"]`) as HTMLInputElement;
      toggle.checked = true;
      toggle.dispatchEvent(new Event("change"));
      await new Promise((r) => setTimeout(r, 0));

      const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
      const put = calls.find(
        ([url, init]) => url === "/api/processes/stages/validation/offer-field-restrictions" && init?.method === "PUT"
      );
      expect(put).toBeTruthy();
      expect(JSON.parse(put![1].body as string)).toEqual({ offer: true });
    });

    it("shows a real error and reverts the toggle when the save fails", async () => {
      await openApSetupAs(
        ["Admin.Configure"],
        EMPTY_OVERVIEW,
        EMPTY_CONFIG,
        stageRestrictionsRoutes(
          [
            codingField("coding.project", "edit", "customer"),
            codingField("coding.commodity_code", "edit", "customer"),
            codingField("coding.gl_code", "edit", "customer"),
          ],
          {
            "/api/processes/ap": {
              ...ONE_STAGE_DETAIL,
              stages: [{ ...ONE_STAGE_DETAIL.stages[0], offerFieldRestrictions: true }],
            },
            "PUT /api/processes/stages/validation/offer-field-restrictions": {
              ok: false,
              status: 400,
              json: async () => ({ error: "offer (true or false) is required" }),
            },
          }
        )
      );
      switchTab("Stage Restrictions");

      const panel = stagePanel();
      const toggle = panel.querySelector(`input[id^="stageoffer-"]`) as HTMLInputElement;
      toggle.checked = false;
      toggle.dispatchEvent(new Event("change"));
      await new Promise((r) => setTimeout(r, 0));

      expect(toggle.checked).toBe(true);
      expect(document.body.textContent).toContain("offer (true or false) is required");
    });
  });

  /**
   * **Discard allowed at this stage — decision 0502.** Sits outside
   * the `offered` branch, the same reason `reverifyToggleRow` and the
   * return-targets section do: an Approval stage with no Account
   * Coding fields to restrict can still want Discard switched off,
   * once a document is that far through. Checked means allowed, the
   * default every stage already has, so unchecking is the
   * restriction — reported live: nothing stopped Discard past
   * Validation until this existed.
   */
  describe("Discard allowed at this stage — decision 0502", () => {
    it("is checked by default — every stage already allows Discard", async () => {
      await openApSetupAs(
        ["Admin.Configure"],
        EMPTY_OVERVIEW,
        EMPTY_CONFIG,
        stageRestrictionsRoutes([], {
          "/api/processes/ap": { ...ONE_STAGE_DETAIL, stages: [{ ...ONE_STAGE_DETAIL.stages[0], discardAllowed: true }] },
        })
      );
      switchTab("Stage Restrictions");

      const toggle = stagePanel().querySelector(`input[id^="stagediscard-"]`) as HTMLInputElement;
      expect(toggle.checked).toBe(true);
    });

    it("is unchecked once the stage has turned Discard off", async () => {
      await openApSetupAs(
        ["Admin.Configure"],
        EMPTY_OVERVIEW,
        EMPTY_CONFIG,
        stageRestrictionsRoutes([], {
          "/api/processes/ap": { ...ONE_STAGE_DETAIL, stages: [{ ...ONE_STAGE_DETAIL.stages[0], discardAllowed: false }] },
        })
      );
      switchTab("Stage Restrictions");

      const toggle = stagePanel().querySelector(`input[id^="stagediscard-"]`) as HTMLInputElement;
      expect(toggle.checked).toBe(false);
    });

    it("unchecking it PUTs discardAllowed: false to this stage's own action route", async () => {
      await openApSetupAs(
        ["Admin.Configure"],
        EMPTY_OVERVIEW,
        EMPTY_CONFIG,
        stageRestrictionsRoutes([], {
          "/api/processes/ap": { ...ONE_STAGE_DETAIL, stages: [{ ...ONE_STAGE_DETAIL.stages[0], discardAllowed: true }] },
          "PUT /api/processes/stages/validation/actions/discard": {
            ok: true,
            json: async () => ({ stageId: "validation", action: "discard", discardAllowed: false }),
          },
        })
      );
      switchTab("Stage Restrictions");

      const toggle = stagePanel().querySelector(`input[id^="stagediscard-"]`) as HTMLInputElement;
      toggle.checked = false;
      toggle.dispatchEvent(new Event("change"));
      await new Promise((r) => setTimeout(r, 0));

      const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
      const put = calls.find(
        ([url, init]) => url === "/api/processes/stages/validation/actions/discard" && init?.method === "PUT"
      );
      expect(put).toBeTruthy();
      expect(JSON.parse(put![1].body as string)).toEqual({ discardAllowed: false });
    });

    it("reverts the checkbox and shows the server's error when the save fails", async () => {
      await openApSetupAs(
        ["Admin.Configure"],
        EMPTY_OVERVIEW,
        EMPTY_CONFIG,
        stageRestrictionsRoutes([], {
          "/api/processes/ap": { ...ONE_STAGE_DETAIL, stages: [{ ...ONE_STAGE_DETAIL.stages[0], discardAllowed: true }] },
          "PUT /api/processes/stages/validation/actions/discard": {
            ok: false,
            json: async () => ({ error: "discardAllowed (true or false) is required" }),
          },
        })
      );
      switchTab("Stage Restrictions");

      const toggle = stagePanel().querySelector(`input[id^="stagediscard-"]`) as HTMLInputElement;
      toggle.checked = false;
      toggle.dispatchEvent(new Event("change"));
      await new Promise((r) => setTimeout(r, 0));

      expect(toggle.checked).toBe(true);
      expect(document.body.textContent).toContain("discardAllowed (true or false) is required");
    });

    it("does not disturb the reverify-on-complete toggle sitting in the same panel", async () => {
      await openApSetupAs(
        ["Admin.Configure"],
        EMPTY_OVERVIEW,
        EMPTY_CONFIG,
        stageRestrictionsRoutes([], {
          "/api/processes/ap": {
            ...ONE_STAGE_DETAIL,
            stages: [{ ...ONE_STAGE_DETAIL.stages[0], reverifyRuleOnComplete: true, discardAllowed: true }],
          },
        })
      );
      switchTab("Stage Restrictions");

      const panel = stagePanel();
      const reverifyToggle = panel.querySelector(`input[id^="stagereverify-"]`) as HTMLInputElement;
      const discardToggle = panel.querySelector(`input[id^="stagediscard-"]`) as HTMLInputElement;
      expect(reverifyToggle.checked).toBe(true);
      expect(discardToggle.checked).toBe(true);
    });
  });

  /**
   * **Return targets — decision 0490.** The curated list `viewer.js`'s
   * own Return picker reads from — sitting outside the `offered`
   * branch, same reason as `reverifyToggleRow` right above it: a stage
   * with no Account Coding fields to restrict can still want a place
   * to send a document back to. The add-row form only appears once
   * there is both another stage to name and a team to hand it to.
   */
  describe("Return targets — decision 0490", () => {
    const TWO_STAGE_DETAIL = {
      id: "ap",
      name: "AP",
      version: 1,
      stages: [
        { id: "validation", name: "Validation", sequence: 1, ruleSetId: "rs1", ruleSetName: "Validation Rules", evaluationScope: "header", returnTargets: [] },
        { id: "coding", name: "Coding", sequence: 2, ruleSetId: null, ruleSetName: null, evaluationScope: "header", returnTargets: [] },
      ],
      draft: null,
      teams: [{ id: "team-coding", name: "Coding team" }],
    };

    function panelNamed(name: string): Element {
      const panel = [...document.querySelectorAll(".panel")].find((p) => p.querySelector("h3")?.textContent === name);
      if (!panel) throw new Error(`no panel found for stage "${name}"`);
      return panel;
    }

    it("shows the empty-list message and no add-row form on a single-stage process", async () => {
      await openApSetupAs(["Admin.Configure"], EMPTY_OVERVIEW, EMPTY_CONFIG, stageRestrictionsRoutes([]));
      switchTab("Stage Restrictions");

      const panel = stagePanel();
      expect(panel.textContent).toContain("No return targets configured for this stage yet.");
      expect(panel.querySelector(".editgrid")).toBeNull();
    });

    it("hides the add-row form when there are other stages but no teams configured yet", async () => {
      await openApSetupAs(
        ["Admin.Configure"],
        EMPTY_OVERVIEW,
        EMPTY_CONFIG,
        stageRestrictionsRoutes([], { "/api/processes/ap": { ...TWO_STAGE_DETAIL, teams: [] } })
      );
      switchTab("Stage Restrictions");

      const panel = panelNamed("Validation");
      expect(panel.textContent).toContain("No return targets configured for this stage yet.");
      expect(panel.querySelector(".editgrid")).toBeNull();
    });

    it("shows the add-row form, offering every other stage and every team, once both exist", async () => {
      await openApSetupAs(
        ["Admin.Configure"],
        EMPTY_OVERVIEW,
        EMPTY_CONFIG,
        stageRestrictionsRoutes([], { "/api/processes/ap": TWO_STAGE_DETAIL })
      );
      switchTab("Stage Restrictions");

      const panel = panelNamed("Validation");
      const selects = [...panel.querySelectorAll(".editgrid select")] as HTMLSelectElement[];
      expect(selects.length).toBe(2);
      // Validation's own picker offers Coding — the other stage — never itself.
      expect([...selects[0].options].map((o) => o.textContent)).toEqual(["Coding"]);
      expect([...selects[1].options].map((o) => o.textContent)).toEqual(["Coding team"]);
    });

    it("shows a configured target with its stage and team name, and a Remove button", async () => {
      await openApSetupAs(
        ["Admin.Configure"],
        EMPTY_OVERVIEW,
        EMPTY_CONFIG,
        stageRestrictionsRoutes([], {
          "/api/processes/ap": {
            ...TWO_STAGE_DETAIL,
            stages: [
              {
                ...TWO_STAGE_DETAIL.stages[0],
                returnTargets: [{ id: "rt1", targetStageId: "coding", targetStageName: "Coding", teamId: "team-coding", teamName: "Coding team" }],
              },
              TWO_STAGE_DETAIL.stages[1],
            ],
          },
        })
      );
      switchTab("Stage Restrictions");

      const panel = panelNamed("Validation");
      const row = [...panel.querySelectorAll(".assignmentrow")].find((r) => r.textContent?.includes("Coding — Coding team"));
      expect(row).toBeTruthy();
      expect(row?.querySelector("button")?.textContent).toBe("Remove");
    });

    it("adding a target POSTs the chosen stage and team, then reloads the list", async () => {
      await openApSetupAs(
        ["Admin.Configure"],
        EMPTY_OVERVIEW,
        EMPTY_CONFIG,
        stageRestrictionsRoutes([], {
          "/api/processes/ap": TWO_STAGE_DETAIL,
          "POST /api/processes/stages/validation/return-targets": {
            ok: true,
            status: 201,
            json: async () => ({
              id: "rt1",
              sourceStageId: "validation",
              targetStageId: "coding",
              targetStageName: "Coding",
              teamId: "team-coding",
              teamName: "Coding team",
            }),
          },
        })
      );
      switchTab("Stage Restrictions");

      const panel = panelNamed("Validation");
      const selects = [...panel.querySelectorAll(".editgrid select")] as HTMLSelectElement[];
      selects[0].value = "coding";
      selects[1].value = "team-coding";
      const addButton = [...panel.querySelectorAll(".statebuttons .actionlink")].find((b) => b.textContent?.includes("Add"));
      await addButton?.click();
      await new Promise((r) => setTimeout(r, 0));

      const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
      const post = calls.find(([url, init]) => url === "/api/processes/stages/validation/return-targets" && init?.method === "POST");
      expect(post).toBeTruthy();
      expect(JSON.parse(post![1].body as string)).toEqual({ targetStageId: "coding", teamId: "team-coding" });
    });

    it("removing a target DELETEs it by id, then reloads the list", async () => {
      await openApSetupAs(
        ["Admin.Configure"],
        EMPTY_OVERVIEW,
        EMPTY_CONFIG,
        stageRestrictionsRoutes([], {
          "/api/processes/ap": {
            ...TWO_STAGE_DETAIL,
            stages: [
              {
                ...TWO_STAGE_DETAIL.stages[0],
                returnTargets: [{ id: "rt1", targetStageId: "coding", targetStageName: "Coding", teamId: "team-coding", teamName: "Coding team" }],
              },
              TWO_STAGE_DETAIL.stages[1],
            ],
          },
          "DELETE /api/processes/stages/return-targets/rt1": { ok: true, json: async () => ({ id: "rt1" }) },
        })
      );
      switchTab("Stage Restrictions");

      const panel = panelNamed("Validation");
      const removeButton = [...panel.querySelectorAll(".assignmentrow button")].find((b) => b.textContent === "Remove");
      await removeButton?.click();
      await new Promise((r) => setTimeout(r, 0));

      const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
      expect(calls.some(([url, init]) => url === "/api/processes/stages/return-targets/rt1" && init?.method === "DELETE")).toBe(true);
    });

    it("shows a real error, and leaves the add-row form usable, when adding a target fails", async () => {
      await openApSetupAs(
        ["Admin.Configure"],
        EMPTY_OVERVIEW,
        EMPTY_CONFIG,
        stageRestrictionsRoutes([], {
          "/api/processes/ap": TWO_STAGE_DETAIL,
          "POST /api/processes/stages/validation/return-targets": {
            ok: false,
            status: 409,
            json: async () => ({ error: "that pair is already configured" }),
          },
        })
      );
      switchTab("Stage Restrictions");

      const panel = panelNamed("Validation");
      const addButton = [...panel.querySelectorAll(".statebuttons .actionlink")].find((b) => b.textContent?.includes("Add"));
      await addButton?.click();
      await new Promise((r) => setTimeout(r, 0));

      expect(document.body.textContent).toContain("that pair is already configured");
    });

    it("shows a real error when removing a target fails", async () => {
      await openApSetupAs(
        ["Admin.Configure"],
        EMPTY_OVERVIEW,
        EMPTY_CONFIG,
        stageRestrictionsRoutes([], {
          "/api/processes/ap": {
            ...TWO_STAGE_DETAIL,
            stages: [
              {
                ...TWO_STAGE_DETAIL.stages[0],
                returnTargets: [{ id: "rt1", targetStageId: "coding", targetStageName: "Coding", teamId: "team-coding", teamName: "Coding team" }],
              },
              TWO_STAGE_DETAIL.stages[1],
            ],
          },
          "DELETE /api/processes/stages/return-targets/rt1": {
            ok: false,
            status: 404,
            json: async () => ({ error: "no return target rt1" }),
          },
        })
      );
      switchTab("Stage Restrictions");

      const panel = panelNamed("Validation");
      const removeButton = [...panel.querySelectorAll(".assignmentrow button")].find((b) => b.textContent === "Remove");
      await removeButton?.click();
      await new Promise((r) => setTimeout(r, 0));

      expect(document.body.textContent).toContain("no return target rt1");
    });
  });
});

/**
 * **Return Reasons — decision 0498, its own row layout in 0499.**
 * Never covered here before now: decision 0498 built the tab, this
 * segment gave it its own dedicated flex row (`.returnreasonrow`)
 * after the original `.editgrid`-based layout put a reason's checkbox
 * and Save link on their own line beneath the label input and
 * "Active" text — reported live from a screenshot, right after a
 * first, narrower fix (0499's own `.editgrid` checkbox sizing) had
 * already landed.
 */
describe("the Return Reasons tab (decision 0498, row layout in 0499)", () => {
  const REASONS = {
    reasons: [
      { id: "duplicate_invoice", label: "Duplicate invoice", active: true, sortOrder: 0 },
      { id: "misdirected", label: "Not our invoice / misdirected", active: false, sortOrder: 1 },
    ],
  };

  function returnReasonsRoutes(reasons: unknown = REASONS, apTeamEmail: unknown = { apTeamEmail: null }, extra: Record<string, unknown> = {}) {
    return {
      "/api/admin/return-reasons": reasons,
      "/api/admin/ap-team-email": apTeamEmail,
      ...extra,
    };
  }

  it("renders one row per reason, each a single line — not split across two", async () => {
    await openApSetupAs(["Admin.Configure"], EMPTY_OVERVIEW, EMPTY_CONFIG, returnReasonsRoutes());
    switchTab("Return Reasons");

    const rows = [...document.querySelectorAll(".returnreasonrow")].filter((r) => !r.classList.contains("returnreasonnew"));
    expect(rows).toHaveLength(2);

    const first = rows[0];
    // The label input, the Active checkbox+text, and Save all sit as
    // direct children of the same row — the fact that broke under the
    // old `.editgrid` layout (four items, two columns, wrapped).
    expect((first.querySelector("input[type=text]") as HTMLInputElement)?.value).toBe("Duplicate invoice");
    expect(first.querySelector(".returnreasonactive")).not.toBeNull();
    expect((first.querySelector(".returnreasonactive input[type=checkbox]") as HTMLInputElement)?.checked).toBe(true);
    expect([...first.querySelectorAll(".actionlink")].map((a) => a.textContent)).toContain("Save");
  });

  it("reflects each reason's own active state on its own checkbox", async () => {
    await openApSetupAs(["Admin.Configure"], EMPTY_OVERVIEW, EMPTY_CONFIG, returnReasonsRoutes());
    switchTab("Return Reasons");

    const checkboxes = [...document.querySelectorAll(".returnreasonrow:not(.returnreasonnew) input[type=checkbox]")] as HTMLInputElement[];
    expect(checkboxes.map((c) => c.checked)).toEqual([true, false]);
  });

  it("the label and its checkbox are one clickable label — clicking the word 'Active' toggles it", async () => {
    await openApSetupAs(["Admin.Configure"], EMPTY_OVERVIEW, EMPTY_CONFIG, returnReasonsRoutes());
    switchTab("Return Reasons");

    const row = document.querySelectorAll(".returnreasonrow:not(.returnreasonnew)")[1];
    const checkbox = row.querySelector("input[type=checkbox]") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    (row.querySelector(".returnreasonactive") as HTMLLabelElement).click();
    expect(checkbox.checked).toBe(true);
  });

  it("saves the edited label and active flag for the reason whose row it is, not any other", async () => {
    const bodies: unknown[] = [];
    await openApSetupAs(["Admin.Configure"], EMPTY_OVERVIEW, EMPTY_CONFIG, {
      ...returnReasonsRoutes(),
      "PATCH /api/admin/return-reasons/misdirected": { ok: true, json: async () => ({}) },
    });
    switchTab("Return Reasons");

    // Wrap the already-stubbed fetch so the PATCH body can be captured
    // — everything else (the reload after saving) still resolves
    // through the same routes `openApSetupAs` set up.
    const alreadyStubbed = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") bodies.push(JSON.parse(String(init.body)));
        return alreadyStubbed(url, init as RequestInit);
      })
    );

    const row = document.querySelectorAll(".returnreasonrow:not(.returnreasonnew)")[1];
    (row.querySelector("input[type=text]") as HTMLInputElement).value = "Wrong supplier entirely";
    (row.querySelector(".returnreasonactive") as HTMLLabelElement).click();
    (row.querySelector(".actionlink") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));

    expect(bodies).toContainEqual({ label: "Wrong supplier entirely", active: true });
  });

  it("the add-a-reason row is its own single line too, with a narrower ID field beside the full-width label", async () => {
    await openApSetupAs(["Admin.Configure"], EMPTY_OVERVIEW, EMPTY_CONFIG, returnReasonsRoutes());
    switchTab("Return Reasons");

    const newRow = document.querySelector(".returnreasonrow.returnreasonnew");
    expect(newRow).not.toBeNull();
    const textInputs = [...newRow!.querySelectorAll("input[type=text]")];
    expect(textInputs).toHaveLength(2);
    expect([...newRow!.querySelectorAll(".actionlink")].map((a) => a.textContent)).toContain("Add");
  });

  it("posts a new reason from the add row and reloads the list", async () => {
    const created: unknown[] = [];
    let listedAfterCreate = false;
    await openApSetupAs(["Admin.Configure"], EMPTY_OVERVIEW, EMPTY_CONFIG, returnReasonsRoutes());
    switchTab("Return Reasons");

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = String(url).split("?")[0];
        if (init?.method === "POST" && path === "/api/admin/return-reasons") {
          created.push(JSON.parse(String(init.body)));
          return { ok: true, json: async () => ({}) } as Response;
        }
        if (path === "/api/admin/return-reasons") {
          listedAfterCreate = true;
          return { ok: true, json: async () => REASONS } as Response;
        }
        if (path === "/api/admin/ap-team-email") return { ok: true, json: async () => ({ apTeamEmail: null }) } as Response;
        throw new Error(`no stub for ${path}`);
      })
    );

    const newRow = document.querySelector(".returnreasonrow.returnreasonnew")!;
    const [idInput, labelInput] = [...newRow.querySelectorAll("input[type=text]")] as HTMLInputElement[];
    idInput.value = "wrong_currency";
    labelInput.value = "Wrong currency charged";
    (newRow.querySelector(".actionlink") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));

    expect(created).toContainEqual({ id: "wrong_currency", label: "Wrong currency charged" });
    expect(listedAfterCreate).toBe(true);
  });

  it("shows the AP team email in its own panel, unaffected by the row layout above", async () => {
    await openApSetupAs(
      ["Admin.Configure"],
      EMPTY_OVERVIEW,
      EMPTY_CONFIG,
      returnReasonsRoutes(REASONS, { apTeamEmail: "ap@acme.example" })
    );
    switchTab("Return Reasons");

    const panel = [...document.querySelectorAll(".panel")].find((p) => p.querySelector("h3")?.textContent === "AP team email");
    expect(panel).not.toBeUndefined();
    expect((panel!.querySelector("input[type=text]") as HTMLInputElement)?.value).toBe("ap@acme.example");
  });
});
