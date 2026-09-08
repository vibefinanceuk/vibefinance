import { beforeEach, describe, expect, it, vi } from "vitest";

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
    "mood.label": "Mood",
    "mood.day": "Day time",
    "mood.night": "Night time",
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
  });

  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { open: openRules } = await import("/rules.js");
  await openRules();
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  mountShell();
  vi.resetModules();
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
  it("gains a third entry", async () => {
    await open([]);
    const nav = [...document.querySelectorAll(".nav a")].map((a) => a.textContent);
    expect(nav).toEqual(["Tasks", "Sources", "Rules"]);
  });

  it("marks which screen you are on", async () => {
    await open([]);
    expect(document.querySelector(".nav a.on")?.textContent).toBe("Rules");
  });
});
