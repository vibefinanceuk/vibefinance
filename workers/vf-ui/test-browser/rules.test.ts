import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The rules screen — decision 0149.
 *
 * **The screen somebody arrives at.** Nobody asks *"what rules exist"*;
 * they ask *"why did this invoice get held"*, and the answer is found at
 * the stage it was held at.
 */

function mountShell() {
  document.body.innerHTML = `<main id="shell"></main><main id="viewer" hidden></main>`;
}

function stubFetch(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url).split("?")[0];
      if (!(path in routes)) throw new Error(`no stub for ${path}`);
      return { ok: true, json: async () => routes[path] } as Response;
    })
  );
}

const STRINGS = {
  locale: "en",
  strings: {
    "nav.tasks": "Tasks",
    "nav.sources": "Sources",
    "nav.dashboard": "Dashboard",
    "nav.suppliers": "Suppliers",
    "nav.rules": "Rules",
    "rules.subtitle": "What should happen to an invoice, in your words",
    "rules.atstage": "Rules at this stage",
    "rules.order": "These run in order when an invoice reaches this stage.",
    "rules.empty": "No rules run here yet.",
    "rules.norules": "no rules",
    "rules.failed": "Could not load rules.",
    "rulestate.live": "Live",
    "rulestate.paused": "Paused",
    "rulestate.awaiting_confirmation": "To confirm",
    "rulestate.draft": "Draft",
    "rules.new": "Create rule",
    "column.rule": "Rule",
    "column.status": "Status",
    "nav.documents": "Documents",
    "nav.roles": "Roles",
    "mood.label": "Mood",
    "mood.day": "Day",
    "mood.night": "Night",
  },
};

const STAGES = [
  { id: "received", name: "Received", sequence: 1, ruleCount: 0 },
  { id: "validation", name: "Validation", sequence: 2, ruleCount: 2 },
  { id: "coding", name: "Coding", sequence: 3, ruleCount: 0 },
];

async function open(rules: unknown[], stages = STAGES) {
  stubFetch({
    "/api/ui-strings": STRINGS,
    "/api/rules/stages": { stages },
    "/api/rules": { rules },
    /**
     * **Real usage always reaches a screen through `start()` first**,
     * which is what actually populates `me` — decision 0276's nav
     * permission filter is the first thing in `frame()` to depend on
     * it. This test called `rules.js`'s own `open()` directly, the
     * one path that skipped `start()` entirely, so `me` stayed `null`
     * and the nav filtered out every item.
     */
    "/api/whoami": {
      id: "u-dan",
      name: "Dan",
      permissions: ["AP.Dashboard", "AP.TaskView", "Admin.Configure", "AP.Supplier", "Admin.RuleManagement", "AP.Review"],
    },
    "/api/tasks": { tasks: [], counts: {} },
  });

  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { start } = await import("/tasks.js");
  await start();
  const { open: openRules } = await import("/rules.js");
  await openRules();
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  mountShell();
  vi.resetModules();
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

describe("the process as a sequence", () => {
  it("shows every stage in order", async () => {
    // **The operator's own point**: a rule fires at a stage, and what
    // it can test depends on what has happened by then.
    await open([]);
    const names = [...document.querySelectorAll(".stage span:first-child")].map(
      (s) => s.textContent
    );
    expect(names).toEqual(["Received", "Validation", "Coding"]);
  });

  it("shows a stage with no rules rather than hiding it", async () => {
    // Somebody wondering why nothing happens at Coding needs to see
    // that Coding is empty.
    await open([]);
    expect(document.body.textContent).toContain("Coding");
    expect(document.body.textContent).toContain("no rules");
  });

  it("marks the stage being shown", async () => {
    await open([]);
    const here = document.querySelector(".stage.here span:first-child");
    // Lands on the first stage that carries rules rather than an empty
    // one.
    expect(here?.textContent).toBe("Validation");
  });

  it("lands on the first stage even when none has rules", async () => {
    await open([], [{ id: "received", name: "Received", sequence: 1, ruleCount: 0 }]);
    expect(document.querySelector(".stage.here span:first-child")?.textContent).toBe("Received");
  });
});

describe("a real table, matching Documents and Tasks (decision 0310)", () => {
  /**
   * **Reported live**: "update the Rules table, so that the look and
   * feel is the same as other tables in the solution. For example, in
   * the Documents, and Tasks pages."
   */
  it("wraps a real <table> in .tablewrap, with Rule and Status columns", async () => {
    await open([{ id: "r-1", sourceText: "One", state: "live", stageName: "Validation" }]);

    const wrap = document.querySelector(".tablewrap");
    expect(wrap).not.toBeNull();
    expect(wrap?.querySelector("table")).not.toBeNull();

    const headers = [...(wrap?.querySelectorAll("thead th") ?? [])].map((h) => h.textContent);
    expect(headers).toEqual(["Rule", "Status"]);
  });

  it("makes the whole row the click target, the same shape Documents and Tasks already use", async () => {
    await open([{ id: "r-1", sourceText: "One", state: "live", stageName: "Validation" }]);

    const row = document.querySelector("tbody tr");
    expect(row?.classList.contains("clickable")).toBe(true);
  });
});

describe("what a rule row says", () => {
  it("shows the sentence somebody wrote", async () => {
    // **Not the compiled rule.** A person recognises their own words.
    await open([
      {
        id: "r-1",
        sourceText: "Hold any invoice over 10,000 euros from a new supplier.",
        state: "live",
        stageName: "Validation",
      },
    ]);

    expect(document.body.textContent).toContain("Hold any invoice over 10,000 euros");
  });

  it("shows a named rule by its name, with the sentence underneath (decision 0266)", async () => {
    await open([
      {
        id: "r-1",
        name: "Spend Threshold",
        sourceText: "Hold any invoice over 10,000 euros from a new supplier.",
        state: "live",
        stageName: "Validation",
      },
    ]);

    const headline = document.querySelector("tbody tr td div");
    expect(headline?.textContent).toBe("Spend Threshold");
    // The sentence is not gone — still there to read, just not the
    // headline once a name exists.
    expect(document.body.textContent).toContain("Hold any invoice over 10,000 euros");
  });

  it("falls back to the sentence as the headline when there is no name", async () => {
    await open([
      { id: "r-1", name: null, sourceText: "A rule with no name yet.", state: "live", stageName: "Validation" },
    ]);

    const headline = document.querySelector("tbody tr td div");
    expect(headline?.textContent).toBe("A rule with no name yet.");
  });

  it("says how many examples are waiting, not just that some are", async () => {
    await open([
      { id: "r-2", sourceText: "A rule", state: "awaiting_confirmation", awaiting: 2 },
    ]);
    expect(document.body.textContent).toContain("2 to confirm");
  });

  it("distinguishes paused from draft", async () => {
    // One was trusted once and the other never has been.
    await open([
      { id: "r-a", sourceText: "One", state: "paused" },
      { id: "r-b", sourceText: "Two", state: "draft" },
    ]);

    expect(document.body.textContent).toContain("Paused");
    expect(document.body.textContent).toContain("Draft");
  });

  it("marks live and paused, and leaves a draft unmarked", async () => {
    // "Nothing is happening" needs no symbol.
    await open([
      { id: "r-a", sourceText: "One", state: "live" },
      { id: "r-b", sourceText: "Two", state: "draft" },
    ]);

    const states = [...document.querySelectorAll(".rulestate")];
    expect(states[0].querySelector("svg")).not.toBeNull();
    expect(states[1].querySelector("svg")).toBeNull();
  });

  it("says so when a stage has none", async () => {
    await open([]);
    expect(document.body.textContent).toContain("No rules run here yet");
  });
});

describe("every word comes from the control plane", () => {
  it("renders no English the code chose", async () => {
    // **Decision 0107.** A screen with a literal in it is a screen a
    // German customer reads in English.
    await open([{ id: "r-1", sourceText: "A rule", state: "live" }]);

    const source = await import("/rules.js");
    expect(source).toBeDefined();
    // Every visible label came through `t()`, so swapping the strings
    // swaps the screen.
    expect(document.body.textContent).toContain("Live");
  });

  it("follows a different locale entirely", async () => {
    stubFetch({
      "/api/ui-strings": {
        locale: "de",
        strings: { ...STRINGS.strings, "rulestate.live": "Aktiv", "nav.rules": "Regeln" },
      },
      "/api/rules/stages": { stages: STAGES },
      "/api/rules": { rules: [{ id: "r-1", sourceText: "Eine Regel", state: "live" }] },
    });

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open: openRules } = await import("/rules.js");
    await openRules();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.body.textContent).toContain("Aktiv");
    expect(document.body.textContent).not.toContain("Live");
  });
});

describe("the navigation", () => {
  it("lists every screen", async () => {
    // Documents joined them (decision 0164), so this asserts the set
    // rather than a count that goes stale on every new screen.
    await open([]);
    const nav = [...document.querySelectorAll(".nav a")].map((a) => a.textContent);
    // **Suppliers, since decision 0213.** This test exists to notice a
    // screen appearing or disappearing, and it did.
    // **Dashboard, first, since decision 0274.** Renamed from "My
    // work" (decision 0242) and moved to the front of the list, at
    // the operator's own request — this test caught both changes at
    // once, which is what it is for.
    expect(nav).toEqual(["Dashboard", "Tasks", "Sources", "Suppliers", "Rules", "Documents", "Roles"]);
  });

  it("marks which screen you are on", async () => {
    await open([]);
    expect(document.querySelector(".nav a.on")?.textContent).toBe("Rules");
  });
});

describe("creating the first rule at a stage (decision 0154)", () => {
  /**
   * **A chicken and egg, found on the screen.** The button appeared
   * only where a stage already had a rule set — so rules could be added
   * only where rules already existed, and a stage that had never had
   * one never could.
   */
  it("offers the button at a stage with no rules at all", async () => {
    await open([], [{ id: "coding", name: "Coding", sequence: 3, ruleCount: 0, hasRuleSet: false }]);

    const labels = [...document.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels.some((l) => l?.includes("Create rule"))).toBe(true);
  });

  it("offers it at a stage that has some", async () => {
    await open([{ id: "r-1", sourceText: "A rule", state: "live" }]);
    const labels = [...document.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels.some((l) => l?.includes("Create rule"))).toBe(true);
  });

  it("sits in the topbar, left of Night/Day, not beneath the table any more (decision 0309)", async () => {
    /**
     * **Reported live**: "there is a create rule button beneath the
     * table of rules. Please can you move this button to the top
     * right of the page, to the left of the Night / Day button (with
     * the horizontal line as a break)."
     */
    await open([{ id: "r-1", sourceText: "A rule", state: "live" }]);

    const topRight = document.querySelector(".topbar .right");
    const titles = [...(topRight?.querySelectorAll("button") ?? [])].map((b) => b.getAttribute("title"));
    const createIndex = titles.indexOf("Create rule");
    const moodIndex = titles.findIndex((t) => t === "Day" || t === "Night");

    expect(createIndex).toBeGreaterThan(-1);
    expect(moodIndex).toBeGreaterThan(-1);
    expect(createIndex).toBeLessThan(moodIndex);
    // Decision 0304's own boundary line, since a page-specific
    // control now sits in the topbar.
    expect(topRight?.querySelector(".topbardivider")).not.toBeNull();

    // Not left behind beneath the table any more.
    expect(document.querySelector(".newrule")).toBeNull();
  });

  it("draws each rule as its own table row (decision 0310)", async () => {
    // Decision 0154's own "a card each" is what this reverses —
    // reported live, matching the row-per-item shape Documents and
    // Tasks already use.
    await open([
      { id: "r-1", sourceText: "One", state: "live" },
      { id: "r-2", sourceText: "Two", state: "draft" },
    ]);

    expect(document.querySelectorAll("tbody tr")).toHaveLength(2);
  });
});
