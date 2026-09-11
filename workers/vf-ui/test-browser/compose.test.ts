import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Writing a rule — decision 0153.
 *
 * **The product's actual claim.** A customer writes a sentence and gets
 * an enforced rule, and the whole argument for the closed vocabulary is
 * that it is safe to hand to a customer.
 */

function mountShell() {
  document.body.innerHTML = `<main id="shell"></main><main id="viewer" hidden></main>`;
}

function stubFetch(routes: Record<string, unknown>, posted: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).split("?")[0];
      if (init?.method === "POST") posted.push(path);
      if (!(path in routes)) throw new Error(`no stub for ${path}`);
      const entry = routes[path] as { ok?: boolean; body?: unknown };
      const isEnvelope = entry && typeof entry === "object" && "body" in entry;
      return {
        ok: isEnvelope ? entry.ok !== false : true,
        json: async () => (isEnvelope ? entry.body : entry),
      } as Response;
    })
  );
}

const STRINGS = {
  locale: "en",
  strings: {
    "nav.tasks": "Tasks",
    "nav.sources": "Sources",
    "nav.dashboard": "My work",
    "nav.suppliers": "Suppliers",
    "nav.rules": "Rules",
    "mood.label": "Mood",
    "mood.day": "Day time",
    "mood.night": "Night time",
    "compose.title": "Write a rule",
    "compose.write": "What should happen",
    "compose.compile": "Compile",
    "compose.plain": "Plain English.",
    "compose.needsentence": "Write what should happen first.",
    "compose.compiling": "Working out what you mean.",
    "compose.cannot": "This cannot be expressed",
    "compose.nothingsaved": "Nothing was saved.",
    "compose.willdo": "What this will do",
    "compose.examples": "Worked examples",
    "compose.examplesnote": "Each was run through the real rule.",
    "compose.fires": "Fires",
    "compose.quiet": "Stays quiet",
    "compose.confirm": "Confirm",
    "compose.confirmed": "Confirmed",
    "compose.activate": "Activate this rule",
    "compose.confirmfirst": "Confirm {n} more first.",
    "compose.allconfirmed": "Every example confirmed.",
    "operator.greater_than": "is more than",
    "operator.is": "is",
    "operator.in": "is one of",
    "readback.the": "the",
    "readback.or": "or",
    "readback.then": "Then:",
    "readback.when_all": "When all of these are true:",
    "readback.when_any": "When any of these is true:",
    "readback.nested_any": "and any of these:",
    "readback.check": "Read this before the examples.",
    "action.hold_until": "Hold it",
    "compose.morefacts": "and {n} other fields on this invoice",
  },
};

const FIELDS = {
  fields: [
    { field: "BT-112", description: "total with VAT", visibility: "edit", type: "number", line: false },
    { field: "BT-5", description: "currency", visibility: "edit", type: "text", line: false },
  ],
  // Derived fields the platform computes — decision 0159. A rule can
  // test either, and one rendered raw beside the other.
  derived: {
    "invoice.duplicate_confidence": "how likely this duplicates another invoice",
  },
};

const STAGE = { id: "validation", name: "Validation", ruleSetId: "rs-val", hasRuleSet: true };

const COMPILED = {
  status: "compiled",
  ruleId: "r-1",
  version: 1,
  conditions: {
    all: [
      { field: "BT-112", operator: "greater_than", value: 10000 },
      { field: "BT-5", operator: "is", value: "EUR" },
    ],
  },
  actions: [{ type: "hold_until", params: {} }],
};

function examples(confirmed: number) {
  return {
    examples: [
      { id: "e1", expectMatch: true, invoice: { "BT-112": 12400 }, confirmedBy: confirmed > 0 ? "u-dan" : null },
      { id: "e2", expectMatch: false, invoice: { "BT-112": 800 }, confirmedBy: confirmed > 1 ? "u-dan" : null },
    ],
  };
}

async function openCompose(extra: Record<string, unknown> = {}, posted: string[] = []) {
  stubFetch({ "/api/ui-strings": STRINGS, "/api/field-visibility": FIELDS, ...extra }, posted);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { openCompose: go } = await import("/compose.js");
  await go(STAGE);
  await new Promise((r) => setTimeout(r, 0));
}

async function compileWith(response: unknown, ex = examples(0), posted: string[] = []) {
  await openCompose(
    {
      "/api/rules/compile": response,
      "/api/rules/r-1/versions/1/examples": ex,
      "/api/rules/examples/e1/confirm": {},
      "/api/rules/examples/e2/confirm": {},
      "/api/rules/r-1/versions/1/activate": {},
    },
    posted
  );

  (document.getElementById("sentence") as HTMLTextAreaElement).value =
    "Hold any invoice over 10,000 euros.";
  (document.querySelector("button.primary") as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 20));
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

describe("reading the rule back", () => {
  /**
   * **The hard part of the whole screen.** Somebody has to check the
   * system understood their sentence, and what it produced is
   * `{"field":"BT-112","operator":"greater_than"}`.
   */
  it("says what the rule does, in words", async () => {
    await compileWith(COMPILED);
    const back = document.querySelector(".readback");

    expect(back?.textContent).toContain("When all of these are true");
    expect(back?.textContent).toContain("total with VAT");
    expect(back?.textContent).toContain("is more than");
    expect(back?.textContent).toContain("10000");
  });

  it("names the field in words, not as a Business Term", async () => {
    // **Showing `BT-112` asks somebody to learn EN 16931 to check their
    // own English.**
    await compileWith(COMPILED);
    const term = document.querySelector(".readback .term");
    expect(term?.textContent).toBe("total with VAT");
  });

  it("keeps the Business Term available on hover", async () => {
    // An auditor and an ERP vendor both use it; the person writing the
    // rule does not have to.
    await compileWith(COMPILED);
    const term = document.querySelector(".readback .term") as HTMLElement;
    expect(term.title).toBe("BT-112");
  });

  it("says what happens when it matches", async () => {
    await compileWith(COMPILED);
    expect(document.querySelector(".readback")?.textContent).toContain("Hold it");
  });

  it("reads a list as a sentence, not an array", async () => {
    // A rule about three currencies is a sentence about three
    // currencies.
    await compileWith({
      ...COMPILED,
      conditions: { all: [{ field: "BT-5", operator: "in", value: ["EUR", "GBP", "USD"] }] },
    });

    expect(document.querySelector(".readback")?.textContent).toContain("EUR, GBP or USD");
  });

  it("renders a nested combinator rather than flattening it", async () => {
    // Nesting is bounded at five, and a rule that nests must read as
    // one.
    await compileWith({
      ...COMPILED,
      conditions: {
        all: [
          { field: "BT-112", operator: "greater_than", value: 10000 },
          { any: [{ field: "BT-5", operator: "is", value: "EUR" }] },
        ],
      },
    });

    expect(document.querySelector(".readback .nested")).not.toBeNull();
    expect(document.querySelector(".readback")?.textContent).toContain("and any of these");
  });

  it("tells somebody to check it before the examples", async () => {
    // **If the sentence was misunderstood, confirming three correct
    // examples of the wrong rule is exactly the trap.**
    await compileWith(COMPILED);
    expect(document.body.textContent).toContain("Read this before the examples");
  });
});

describe("a refusal", () => {
  it("is shown as an answer, not swallowed", async () => {
    // **Decision 0033**: the model declining is the vocabulary boundary
    // doing its job.
    await compileWith({
      ok: false,
      body: { status: "refused", reason: "There is no way to compare against other invoices." },
    });

    expect(document.querySelector(".refusal")?.textContent).toContain(
      "no way to compare against other invoices"
    );
  });

  it("offers no examples and no gate", async () => {
    await compileWith({
      ok: false,
      body: { status: "refused", reason: "Cannot express that." },
    });

    expect(document.querySelector(".example")).toBeNull();
    expect(document.querySelector(".gate")).toBeNull();
  });

  it("says nothing was saved", async () => {
    await compileWith({ ok: false, body: { status: "refused", reason: "No." } });
    expect(document.body.textContent).toContain("Nothing was saved");
  });
});

describe("the activation gate", () => {
  /**
   * **Decision 0034.** A rule cannot be activated until every worked
   * example has been confirmed, and the screen has to make somebody
   * read them rather than click through.
   */
  it("refuses to activate while examples are outstanding", async () => {
    await compileWith(COMPILED, examples(0));
    const activate = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Activate")
    ) as HTMLButtonElement;

    expect(activate.disabled).toBe(true);
  });

  it("says how many are left", async () => {
    await compileWith(COMPILED, examples(1));
    expect(document.body.textContent).toContain("Confirm 1 more first");
  });

  it("opens once every one is confirmed", async () => {
    await compileWith(COMPILED, examples(2));
    const activate = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Activate")
    ) as HTMLButtonElement;

    expect(activate.disabled).toBe(false);
    expect(document.body.textContent).toContain("Every example confirmed");
  });

  it("confirms one by asking the server, not by hiding a button", async () => {
    // The confirmation is attributed to a named person (decision 0034),
    // derived from the authenticated caller.
    const posted: string[] = [];
    await compileWith(COMPILED, examples(0), posted);

    const confirm = [...document.querySelectorAll(".example button")][0] as HTMLButtonElement;
    confirm.click();
    await new Promise((r) => setTimeout(r, 20));

    expect(posted).toContain("/api/rules/examples/e1/confirm");
  });
});

describe("the worked examples", () => {
  it("says what happens in plain terms", async () => {
    // **Not `expectMatch: true`.** Somebody confirming is being asked
    // to agree an outcome is right, and a boolean is not something
    // anybody can agree with.
    await compileWith(COMPILED, examples(0));
    const verdicts = [...document.querySelectorAll(".verdict")].map((v) => v.textContent);
    expect(verdicts).toEqual(["Fires", "Stays quiet"]);
  });

  it("shows a confirmed one as confirmed rather than offering it again", async () => {
    await compileWith(COMPILED, examples(1));
    expect(document.querySelector(".confirmed")?.textContent).toBe("Confirmed");
  });
});

describe("before anything is written", () => {
  it("refuses to compile an empty sentence", async () => {
    const posted: string[] = [];
    await openCompose({}, posted);

    (document.querySelector("button.primary") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 20));

    expect(posted).toHaveLength(0);
    expect(document.body.textContent).toContain("Write what should happen first");
  });
});

describe("a rule that is one condition (decision 0158)", () => {
  /**
   * **The interpreter has always allowed it.** `validateNode` falls
   * through to a single condition, and *"if the duplicate probability
   * is over 60%"* compiles to exactly that — no combinator.
   *
   * The read-back assumed a combinator, found no `all`, defaulted to
   * `any`, and rendered an empty list. **So the screen showed a rule
   * with no conditions when the rule had one** — the trap decision 0153
   * exists to prevent.
   *
   * Found on a real rule, in a screenshot.
   */
  const BARE = {
    status: "compiled",
    ruleId: "r-1",
    version: 1,
    conditions: { field: "BT-112", operator: "greater_than", value: 10000 },
    actions: [{ type: "hold_until", params: {} }],
  };

  it("renders the condition rather than an empty list", async () => {
    await compileWith(BARE);
    const back = document.querySelector(".readback");

    expect(back?.textContent).toContain("total with VAT");
    expect(back?.textContent).toContain("is more than");
    expect(back?.textContent).toContain("10000");
  });

  it("does not claim a combinator that is not there", async () => {
    // "When any of these is true:" above nothing was the visible
    // symptom, and it is a different rule from the one that compiled.
    await compileWith(BARE);
    expect(document.querySelector(".readback")?.textContent).not.toContain("any of these");
  });

  it("still says what happens", async () => {
    await compileWith(BARE);
    expect(document.querySelector(".readback")?.textContent).toContain("Hold it");
  });
});

describe("an example somebody can read (decision 0159)", () => {
  /**
   * **It showed everything**, and an invoice carries thirty fields: a
   * wall in which the one number the rule turns on is somewhere in the
   * middle.
   *
   * Somebody confirming is asked *"is this outcome right"*, and they
   * cannot answer without seeing **why** it came out that way.
   */
  const WALL = {
    examples: [
      {
        id: "e1",
        expectMatch: true,
        confirmedBy: null,
        invoice: {
          "BT-1": "INV-2023-00123",
          "BT-3": 380,
          "BT-5": "EUR",
          "BT-112": 1800,
          "invoice.duplicate_confidence": 0.78,
        },
      },
    ],
  };

  const RULE = {
    ...COMPILED,
    conditions: { field: "invoice.duplicate_confidence", operator: "greater_than", value: 0.6 },
  };

  it("leads with the field the rule turns on", async () => {
    await compileWith(RULE, WALL);
    const decisive = document.querySelector(".example .decisive");

    expect(decisive?.textContent).toContain("how likely this duplicates another invoice");
    expect(decisive?.textContent).toContain("0.78");
  });

  it("keeps the rest, folded away", async () => {
    // **An example is evidence**, and evidence somebody cannot inspect
    // is an assertion.
    await compileWith(RULE, WALL);
    const more = document.querySelector(".example .morefacts");

    expect(more).not.toBeNull();
    expect(more?.textContent).toContain("and 4 other fields");
    expect(more?.textContent).toContain("INV-2023-00123");
  });

  it("does not bury the decisive field among the rest", async () => {
    await compileWith(RULE, WALL);
    const decisive = document.querySelector(".example .decisive");
    expect(decisive?.textContent).not.toContain("INV-2023-00123");
  });

  it("names a derived field in words", async () => {
    // **`/field-visibility` serves only INVOICE_FIELDS**, so a derived
    // field rendered raw beside BT-112 reading "total with VAT".
    await compileWith(RULE, WALL);
    expect(document.querySelector(".readback")?.textContent).toContain(
      "how likely this duplicates another invoice"
    );
  });

  it("folds nothing when every field matters", async () => {
    await compileWith(RULE, {
      examples: [
        {
          id: "e1",
          expectMatch: true,
          confirmedBy: null,
          invoice: { "invoice.duplicate_confidence": 0.78 },
        },
      ],
    });

    expect(document.querySelector(".example .morefacts")).toBeNull();
  });
});
