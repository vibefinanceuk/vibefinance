import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * One rule, opened — decision 0155.
 *
 * The list says what exists; this says **what it does, which version is
 * running, and what happened before.**
 */

function mountShell() {
  document.body.innerHTML = `<main id="shell"></main><main id="viewer" hidden></main>`;
}

function stubFetch(routes: Record<string, unknown>, calls: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).split("?")[0];
      if (init?.method && init.method !== "GET") calls.push(`${init.method} ${path}`);
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
    "nav.suppliers": "Suppliers",
    "nav.rules": "Rules",
    "mood.label": "Mood",
    "mood.day": "Day time",
    "mood.night": "Night time",
    "rule.title": "Rule",
    "rule.version": "Version {n}",
    "rule.pause": "Pause",
    "rule.resume": "Resume",
    "rule.newversion": "Write a new version",
    "rule.running": "This rule runs on invoices reaching this stage.",
    "rule.notrunning": "Paused.",
    "rule.approvedby": "Confirmed by {who} on {when}.",
    "rulestate.live": "Live",
    "rulestate.paused": "Paused",
    "rulestate.awaiting_confirmation": "To confirm",
    "rulestate.draft": "Draft",
    "operator.greater_than": "is more than",
    "readback.the": "the",
    "readback.when_all": "When all of these are true:",
    "readback.then": "Then:",
    "action.hold_until": "Hold it",
    "compose.examples": "Worked examples",
    "compose.examplesnote": "Each was run through the real rule.",
    "compose.fires": "Fires",
    "compose.quiet": "Stays quiet",
    "compose.confirm": "Confirm",
    "compose.confirmed": "Confirmed",
    "compose.activate": "Activate this rule",
    "compose.confirmfirst": "Confirm {n} more first.",
    "compose.allconfirmed": "Every example confirmed.",
  },
};

const FIELDS = {
  fields: [{ field: "BT-112", description: "total with VAT", visibility: "edit", type: "number", line: false }],
};

function ruleWith(overrides = {}) {
  return {
    id: "r-1",
    ruleSetId: "rs-val",
    enabled: true,
    stageId: "validation",
    stageName: "Validation",
    versions: [
      {
        version: 2,
        sourceText: "The second wording",
        conditions: { all: [{ field: "BT-112", operator: "greater_than", value: 10000 }] },
        actions: [{ type: "hold_until", params: {} }],
        approvedBy: "u-dan",
        approvedAt: "2026-09-05",
        isLive: true,
        examplesTotal: 2,
        examplesConfirmed: 2,
      },
      {
        version: 1,
        sourceText: "The first wording",
        approvedBy: "u-dan",
        approvedAt: "2026-09-01",
        isLive: false,
        examplesTotal: 2,
        examplesConfirmed: 2,
      },
    ],
    ...overrides,
  };
}

async function open(rule = ruleWith(), calls: string[] = []) {
  stubFetch(
    {
      "/api/ui-strings": STRINGS,
      "/api/field-visibility": FIELDS,
      "/api/rules/r-1": rule,
      "/api/rules/r-1/enabled": { ruleId: "r-1", enabled: false },
      "/api/rules/r-1/versions/3/examples": {
        examples: [
          { id: "e1", expectMatch: true, invoice: { "BT-112": 12400 }, confirmedBy: null },
          { id: "e2", expectMatch: false, invoice: { "BT-112": 800 }, confirmedBy: null },
        ],
      },
      "/api/rules/examples/e1/confirm": {},
      "/api/rules/r-1/versions/3/activate": {},
    },
    calls
  );

  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { openRule } = await import("/rule.js");
  await openRule("r-1", { id: "validation", name: "Validation" });
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  mountShell();
  vi.resetModules();
});

describe("what the screen says", () => {
  it("shows every version, newest first", async () => {
    // Somebody asking "why did this change" needs to see that v2
    // replaced v1.
    await open();
    const headings = [...document.querySelectorAll(".versionhead h3")].map((h) => h.textContent);
    expect(headings).toEqual(["Version 2", "Version 1"]);
  });

  it("names which version is running", async () => {
    await open();
    const live = document.querySelector(".rulestate.live");
    expect(live?.textContent).toContain("Live");
  });

  it("reads back only the version being looked at", async () => {
    // **Every version rendered in full would bury the current one.**
    await open();
    expect(document.querySelectorAll(".readback")).toHaveLength(1);
    expect(document.querySelector(".readback")?.textContent).toContain("total with VAT");
  });

  it("shows the sentence for every version", async () => {
    // The words are what somebody recognises, and the older one is how
    // they see what changed.
    await open();
    expect(document.body.textContent).toContain("The second wording");
    expect(document.body.textContent).toContain("The first wording");
  });

  it("says who confirmed it and when", async () => {
    await open();
    expect(document.body.textContent).toContain("Confirmed by u-dan on 2026-09-05");
  });
});

describe("pausing", () => {
  it("offers Pause while it is running", async () => {
    // **The word the list already uses.** Two names for one act is an
    // interface somebody has to learn twice.
    await open();
    const labels = [...document.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels.some((l) => l?.includes("Pause"))).toBe(true);
    expect(labels.some((l) => l?.includes("Deactivate"))).toBe(false);
  });

  it("offers Resume once it is paused", async () => {
    await open(ruleWith({ enabled: false }));
    const labels = [...document.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels.some((l) => l?.includes("Resume"))).toBe(true);
  });

  it("says plainly what paused means for an invoice", async () => {
    await open(ruleWith({ enabled: false }));
    expect(document.body.textContent).toContain("Paused.");
  });

  it("asks the server rather than only changing the label", async () => {
    const calls: string[] = [];
    await open(ruleWith(), calls);

    const pause = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Pause")
    ) as HTMLButtonElement;
    pause.click();
    await new Promise((r) => setTimeout(r, 20));

    expect(calls).toContain("PUT /api/rules/r-1/enabled");
  });
});

describe("writing a new version", () => {
  it("offers it", async () => {
    await open();
    const labels = [...document.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels.some((l) => l?.includes("Write a new version"))).toBe(true);
  });
});

describe("confirming from the rule screen (decision 0157)", () => {
  /**
   * **The detail screen showed a count and no way to act on it.**
   * Decision 0153 put confirmation on the compose screen, immediately
   * after compiling; navigating away stranded the rule, and the list
   * said *"2 to confirm"* with nowhere to do it.
   *
   * Reported exactly that way.
   */
  function waiting() {
    return ruleWith({
      versions: [
        {
          version: 3,
          sourceText: "A new wording",
          conditions: { all: [{ field: "BT-112", operator: "greater_than", value: 10000 }] },
          actions: [{ type: "hold_until", params: {} }],
          approvedBy: null,
          approvedAt: null,
          isLive: false,
          examplesTotal: 2,
          examplesConfirmed: 0,
        },
      ],
    });
  }

  it("shows the examples waiting on somebody", async () => {
    await open(waiting());
    expect(document.querySelectorAll(".example")).toHaveLength(2);
  });

  it("says what each does, in plain terms", async () => {
    await open(waiting());
    const verdicts = [...document.querySelectorAll(".verdict")].map((v) => v.textContent);
    expect(verdicts).toEqual(["Fires", "Stays quiet"]);
  });

  it("offers the gate, closed until they are confirmed", async () => {
    await open(waiting());
    const activate = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Activate")
    ) as HTMLButtonElement;

    expect(activate.disabled).toBe(true);
    expect(document.body.textContent).toContain("Confirm 2 more first");
  });

  it("confirms one by asking the server", async () => {
    const calls: string[] = [];
    await open(waiting(), calls);

    const confirm = [...document.querySelectorAll(".example button")][0] as HTMLButtonElement;
    confirm.click();
    await new Promise((r) => setTimeout(r, 20));

    expect(calls).toContain("POST /api/rules/examples/e1/confirm");
  });

  it("shows nothing to confirm for a rule already approved", async () => {
    // **An approved version's examples were confirmed once and are
    // history.** Loading them would invite somebody to confirm what is
    // already running.
    await open();
    expect(document.querySelectorAll(".example")).toHaveLength(0);
    expect(document.querySelector(".gate button.primary")).toBeNull();
  });

  it("puts them above the version history", async () => {
    // **This is what somebody came to do**; the history can wait its
    // turn.
    await open(waiting());
    const body = document.body.textContent ?? "";
    expect(body.indexOf("Worked examples")).toBeLessThan(body.indexOf("Version 3"));
  });
});
