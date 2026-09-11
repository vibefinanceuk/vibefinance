import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The dashboard screen — decision 0242, on decision 0240's queries.
 *
 * **One request, nine cards.** The route computes the scope once and
 * returns everything, so this screen is a render rather than a
 * conversation.
 */

function mountShell() {
  document.body.innerHTML = `<main id="shell"></main><main id="viewer" hidden></main>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "dash.heading": "My work",
    "dash.sub": "What is waiting, and what is on the clock",
    "dash.waiting": "Waiting for me",
    "dash.waitingsub": "Mine, and work my teams own",
    "dash.acrossstages": "across {n} stages",
    "dash.myclock": "On my clock",
    "dash.myclocksub": "Assigned to me or claimed by me",
    "dash.nothingmine": "Nothing is assigned to you or claimed by you.",
    "dash.supplier": "Supplier",
    "dash.held": "Held",
    "dash.due": "Payment due",
    "dash.value": "Value",
    "dash.today": "today",
    "dash.overdue": "{n}d overdue",
    "dash.duein": "due in {n}d",
    "dash.sort.held": "Longest held",
    "dash.sort.due": "Soonest due",
    "dash.sort.value": "Highest value",
    "dash.wherethings": "Where things are",
    "dash.bystage": "Count by stage",
    "dash.nothinginflight": "Nothing is in progress.",
    "dash.astage": "A stage",
    "dash.stagegone": "This stage no longer exists.",
    "dash.waitinghere": "waiting here",
    "dash.ageing": "How long they have waited",
    "dash.ageingsub": "All open work",
    "dash.done": "Done",
    "dash.todaylabel": "today",
    "dash.weeklabel": "this week",
    "dash.minelabel": "by me this week",
    "dash.needssomebody": "Needs somebody",
    "dash.needssomebodysub": "Nothing else surfaces these",
    "dash.unplaced": "Unplaced documents",
    "dash.awaitingerp": "Suppliers awaiting the ERP",
    "dash.duplicates": "Possible duplicates",
    "dash.allclear": "Nothing is stuck.",
    "nav.tasks": "Tasks",
    "nav.dashboard": "My work",
    "nav.sources": "Sources",
    "nav.suppliers": "Suppliers",
    "nav.rules": "Rules",
    "nav.documents": "Documents",
    "dash.arrange": "Arrange",
    "dash.done_arranging": "Done arranging",
    "dash.addcard": "Add a card",
    "dash.add": "Add",
    "dash.remove": "Remove",
    "dash.reset": "Back to the default",
    "dash.whichstage": "Which stage?",
    "dash.pickone": "Choose a card first.",
    "dash.items_at_stage": "Items at a stage",
    "dash.about.ageing": "How long open work has waited",
    "dash.about.items_at_stage": "One stage you choose",
    "viewer.supplier.close": "Close",
  },
};

/** A day offset, as the route would return it. */
function daysAgo(n: number) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 19).replace("T", " ");
}

function daysAhead(n: number) {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}

function stubDashboard(cards: unknown[], seen: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url);
      seen.push(path);
      if (path.startsWith("/api/ui-strings")) {
        return { ok: true, json: async () => STRINGS } as Response;
      }
      if (path.startsWith("/api/dashboard")) {
        return { ok: true, json: async () => ({ cards, usingDefault: true }) } as Response;
      }
      throw new Error(`no stub for ${path}`);
    })
  );
}

async function openDashboard(cards: unknown[], seen: string[] = []) {
  stubDashboard(cards, seen);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { open } = await import("/dashboard.js");
  await open();
}

beforeEach(() => {
  mountShell();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the cards render what the route returned", () => {
  it("shows a count and what it spans", async () => {
    await openDashboard([
      { id: "a", cardType: "waiting_for_me", settings: {}, position: 0, data: { count: 12, stages: 3 } },
    ]);

    expect(document.body.textContent).toContain("12");
    expect(document.body.textContent).toContain("across 3 stages");
  });

  it("draws a bar per stage", async () => {
    await openDashboard([
      {
        id: "b",
        cardType: "where_things_are",
        settings: {},
        position: 0,
        data: { stages: [{ stage_name: "Validation", n: 8 }, { stage_name: "Approval", n: 11 }] },
      },
    ]);

    expect(document.querySelectorAll("svg rect")).toHaveLength(2);
    expect(document.body.textContent).toContain("Validation");
  });

  it("says a stage is gone rather than showing a zero", async () => {
    /**
     * **A zero would look like good news** — decision 0241's finding,
     * which is why the route reports `missing` separately.
     */
    await openDashboard([
      {
        id: "c",
        cardType: "items_at_stage",
        settings: { stage: "removed" },
        position: 0,
        data: { count: 0, stageName: null, missing: true },
      },
    ]);

    expect(document.body.textContent).toContain("no longer exists");
    expect(document.querySelector(".bignum")).toBeNull();
  });

  it("says nothing is stuck when nothing is", async () => {
    // **Nothing to do is an answer**, and a good one.
    await openDashboard([
      {
        id: "d",
        cardType: "needs_somebody",
        settings: {},
        position: 0,
        data: { unplaced: 0, awaitingErp: 0, duplicates: 0 },
      },
    ]);

    expect(document.body.textContent).toContain("Nothing is stuck");
  });
});

describe("both clocks, side by side", () => {
  /**
   * Decision 0239: how long I have held it is my responsiveness, and
   * `BT-9` is the supplier's expectation. **They disagree routinely**,
   * so sorting chooses which leads and does not hide the other.
   */
  const ITEM = {
    id: "t1",
    stage_name: "Approval",
    created_at: daysAgo(31),
    invoice_id: "inv-1",
    invoice_number: "NW-001",
    supplier_name: "Northwind Logistics",
    total_with_vat: 576,
    currency: "GBP",
    due_date: daysAhead(-6),
  };

  it("shows how long it has been held and when it is due", async () => {
    await openDashboard([
      { id: "e", cardType: "on_my_clock", settings: { sort: "held" }, position: 0, data: { items: [ITEM] } },
    ]);

    const text = document.body.textContent ?? "";
    expect(text).toContain("31d");
    expect(text).toContain("6d overdue");
    expect(text).toContain("Northwind Logistics");
  });

  it("marks an overdue invoice and not one due later", async () => {
    await openDashboard([
      {
        id: "f",
        cardType: "on_my_clock",
        settings: { sort: "held" },
        position: 0,
        data: { items: [ITEM, { ...ITEM, id: "t2", due_date: daysAhead(45), created_at: daysAgo(2) }] },
      },
    ]);

    const warned = [...document.querySelectorAll("td.warn")].map((c) => c.textContent);
    expect(warned).toContain("6d overdue");
    expect(warned).not.toContain("due in 45d");
  });

  it("asks the route again when the sort changes", async () => {
    /**
     * **Sorted where the data is.** The list is capped at 25 rows by
     * decision 0240, so sorting in the browser would reorder a sample
     * and call it an order.
     */
    const seen: string[] = [];
    await openDashboard(
      [{ id: "g", cardType: "on_my_clock", settings: { sort: "held" }, position: 0, data: { items: [ITEM] } }],
      seen
    );

    const before = seen.filter((u) => u.startsWith("/api/dashboard")).length;
    (document.querySelectorAll(".chip")[1] as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));

    expect(seen.filter((u) => u.startsWith("/api/dashboard")).length).toBe(before + 1);
  });

  it("says so when nothing is mine", async () => {
    await openDashboard([
      { id: "h", cardType: "on_my_clock", settings: {}, position: 0, data: { items: [] } },
    ]);
    expect(document.body.textContent).toContain("Nothing is assigned to you");
  });
});

describe("one card failing is not the dashboard failing", () => {
  it("skips a card whose data the route could not produce", async () => {
    await openDashboard([
      { id: "i", cardType: "ageing", settings: {}, position: 0, data: null },
      { id: "j", cardType: "waiting_for_me", settings: {}, position: 1, data: { count: 5, stages: 1 } },
    ]);

    expect(document.querySelectorAll(".panel")).toHaveLength(1);
    expect(document.body.textContent).toContain("5");
  });

  it("skips a card type this screen does not know", async () => {
    /**
     * **The route's set can grow ahead of this one**, and a deployment
     * where it does should show eight cards rather than none.
     */
    await openDashboard([
      { id: "k", cardType: "something_new", settings: {}, position: 0, data: { whatever: 1 } },
      { id: "l", cardType: "waiting_for_me", settings: {}, position: 1, data: { count: 2, stages: 1 } },
    ]);

    expect(document.querySelectorAll(".panel")).toHaveLength(1);
  });
});

describe("arranging it (decision 0243)", () => {
  /**
   * **Arranging is a mode, not a screen.** The cards stay where they
   * are and gain a handle — a separate settings page would make a
   * person choose blind, and the whole question is *"do I want this one
   * here."*
   */
  function stubAll(cards: unknown[], seen: { url: string; method?: string; body?: string }[] = []) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = String(url);
        seen.push({ url: path, method: init?.method, body: init?.body as string });

        if (path.startsWith("/api/ui-strings")) {
          return { ok: true, json: async () => STRINGS } as Response;
        }
        if (path === "/api/dashboard/catalogue") {
          return {
            ok: true,
            json: async () => ({
              types: [
                { cardType: "ageing" },
                { cardType: "items_at_stage", parameter: "stage", repeatable: true },
              ],
              stages: [{ id: "triage", name: "Triage", process_name: "AP" }],
            }),
          } as Response;
        }
        if (path.startsWith("/api/dashboard")) {
          return { ok: true, json: async () => ({ cards, usingDefault: false }) } as Response;
        }
        throw new Error(`no stub for ${path}`);
      })
    );
    return seen;
  }

  const ONE = [
    { id: "a", cardType: "waiting_for_me", settings: {}, position: 0, data: { count: 4, stages: 1 } },
  ];

  async function openArranging(cards: unknown[], seen: { url: string; method?: string; body?: string }[] = []) {
    stubAll(cards, seen);
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/dashboard.js");
    await open();

    const arrange = [...document.querySelectorAll("button")].find((b) => b.textContent === "Arrange");
    arrange?.click();
    await new Promise((r) => setTimeout(r, 0));
  }

  it("shows no handles until asked", async () => {
    // **A control with nothing to do should not be there** — decision
    // 0161's argument, applied to a card nobody is moving.
    stubAll(ONE);
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/dashboard.js");
    await open();

    expect(document.querySelectorAll(".cardactions")).toHaveLength(0);
    expect(document.body.textContent).toContain("Arrange");
  });

  it("gives each card a handle while arranging", async () => {
    await openArranging(ONE);
    expect(document.querySelectorAll(".cardactions")).toHaveLength(1);
    expect(document.body.textContent).toContain("Remove");
  });

  it("sends the whole set when a card is removed", async () => {
    /**
     * **Three verbs over one list**, because three endpoints would each
     * have to renumber the positions afterwards.
     */
    const seen = await (async () => {
      const s: { url: string; method?: string; body?: string }[] = [];
      await openArranging(ONE, s);
      return s;
    })();

    const remove = [...document.querySelectorAll("button")].find((b) => b.textContent === "Remove");
    remove?.click();
    await new Promise((r) => setTimeout(r, 0));

    const put = seen.find((r) => r.method === "PUT");
    expect(put).toBeDefined();
    expect(JSON.parse(put!.body!)).toEqual({ cards: [] });
  });

  it("asks which stage when the card takes one", async () => {
    /**
     * **From the customer's own list** — decision 0239's argument that
     * a hardcoded six would be wrong for the second customer.
     */
    await openArranging(ONE);

    const add = [...document.querySelectorAll("button")].find((b) => b.textContent === "Add a card");
    add?.click();
    await new Promise((r) => setTimeout(r, 0));

    const stageCard = [...document.querySelectorAll(".pickcard")].find((c) =>
      c.textContent?.includes("Items at a stage")
    ) as HTMLButtonElement;
    stageCard.click();

    // **Inside the pop-out**, because the page furniture has a mood
    // switcher and the first version of this caught that instead.
    const options = [...document.querySelectorAll(".popout select option")].map((o) => o.textContent);
    expect(options).toEqual(["AP · Triage"]);
  });

  it("does not ask which stage when it takes none", async () => {
    await openArranging(ONE);

    const add = [...document.querySelectorAll("button")].find((b) => b.textContent === "Add a card");
    add?.click();
    await new Promise((r) => setTimeout(r, 0));

    const plain = document.querySelector(".pickcard") as HTMLButtonElement;
    plain.click();

    expect(document.querySelector(".popout select")).toBeNull();
  });
});
