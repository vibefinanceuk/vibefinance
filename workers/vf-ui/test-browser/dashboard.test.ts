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
    "dash.waiting_for_me": "Waiting for me",
    "dash.waitingsub": "Mine, and work my teams own",
    "dash.acrossstages": "across {n} stages",
    "dash.on_my_clock": "On my clock",
    "dash.myclocksub": "Assigned to me or claimed by me",
    "dash.nothingmine": "Nothing is assigned to you or claimed by you.",
    "dash.supplier": "Supplier",
    "dash.held": "Held",
    "dash.due": "Payment due",
    "dash.value": "Value",
    "dash.today": "today",
    "dash.overdue": "{n}d overdue",
    "dash.duein": "due in {n}d",
    "dash.duetoday": "due today",
    "dash.mine": "Mine",
    "dash.theirs": "Taken",
    "dash.unclaimed": "Unclaimed",
    "dash.showmine": "Show mine",
    "dash.waitinghere": "waiting here",
    "dash.astage": "A stage",
    "dash.sort.held": "Longest held",
    "dash.sort.due": "Soonest due",
    "dash.sort.value": "Highest value",
    "dash.where_things_are": "Where things are",
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
    "dash.needs_somebody": "Needs somebody",
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

  it("draws a ring segment per stage", async () => {
    /**
     * **A whole being divided** — decision 0247. Every in-flight
     * invoice is at exactly one stage, so the question is a proportion.
     * This asserted bars until then.
     */
    await openDashboard([
      {
        id: "b",
        cardType: "where_things_are",
        settings: {},
        position: 0,
        data: { stages: [{ stage_name: "Validation", n: 8 }, { stage_name: "Approval", n: 11 }] },
      },
    ]);

    // One circle per segment, and the legend names them.
    expect(document.querySelectorAll(".donutwrap svg circle")).toHaveLength(2);
    expect(document.body.textContent).toContain("Validation");
    // The total in the middle, so nobody adds up the legend.
    expect(document.body.textContent).toContain("19");
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

  it("saves the sort so the route applies it", async () => {
    /**
     * **Sorted where the data is** — the list is capped at 25 rows by
     * decision 0240, so reordering in the browser would rearrange a
     * sample and call it an order.
     *
     * Which means the server has to be told, and **telling it is saving
     * it** (decision 0250). The first version set a local object and
     * re-fetched, so the buttons highlighted and nothing moved.
     */
    const seen: string[] = [];
    const posted: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = String(url);
        seen.push(path);
        if (init?.method === "PUT") posted.push(init.body as string);
        if (path.startsWith("/api/ui-strings")) {
          return { ok: true, json: async () => STRINGS } as Response;
        }
        return {
          ok: true,
          json: async () => ({
            cards: [
              { id: "g", cardType: "on_my_clock", settings: { sort: "held" }, position: 0, data: { items: [ITEM] } },
            ],
            usingDefault: false,
          }),
        } as Response;
      })
    );

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/dashboard.js");
    await open();

    (document.querySelectorAll(".chip")[1] as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));

    expect(posted).toHaveLength(1);
    expect(JSON.parse(posted[0])).toEqual({
      cards: [{ cardType: "on_my_clock", settings: { sort: "due" } }],
    });
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

describe("a card asks for the room it needs (decision 0244)", () => {
  /**
   * **A count and a table are not the same size of thing.**
   *
   * The first version gave every card an equal half, so *"waiting for
   * me: 3"* sat in a panel the width of a worklist with a void beside
   * it — reported by looking at it.
   */
  it("makes a count a tile and a chart a half", async () => {
    await openDashboard([
      { id: "a", cardType: "waiting_for_me", settings: {}, position: 0, data: { count: 3, stages: 1 } },
      {
        id: "b",
        cardType: "ageing",
        settings: {},
        position: 1,
        data: { buckets: [{ label: "<1d", n: 3 }, { label: "30d+", n: 0 }] },
      },
    ]);

    expect(document.querySelectorAll(".card-tile")).toHaveLength(1);
    expect(document.querySelectorAll(".card-half")).toHaveLength(1);
  });

  it("draws a figure rather than a chart for one stage", async () => {
    /**
     * **A bar chart of one bar is a rectangle**, and the rectangle says
     * nothing the figure does not.
     */
    await openDashboard([
      {
        id: "c",
        cardType: "where_things_are",
        settings: {},
        position: 0,
        data: { stages: [{ stage_name: "Approval", n: 3 }] },
      },
    ]);

    expect(document.querySelector("svg")).toBeNull();
    expect(document.querySelector(".bignum")?.textContent).toBe("3");
    expect(document.body.textContent).toContain("Approval");
  });

  it("still charts two stages", async () => {
    // The same, from the layout side: two stages is a chart and one is
    // a figure.
    await openDashboard([
      {
        id: "d",
        cardType: "where_things_are",
        settings: {},
        position: 0,
        data: { stages: [{ stage_name: "Validation", n: 8 }, { stage_name: "Approval", n: 3 }] },
      },
    ]);

    expect(document.querySelectorAll(".donutwrap svg circle")).toHaveLength(2);
  });

  it("leaves room for the legend beside the ring", async () => {
    /**
     * **A ring has no width to mean anything with** — decision 0248.
     *
     * `svg()` kept `width: 100%` even for a fixed chart, so the donut
     * took the whole flex row and the legend was squeezed to zero:
     * five coloured dots in a column and not one word beside them.
     */
    await openDashboard([
      {
        id: "g2",
        cardType: "where_things_are",
        settings: {},
        position: 0,
        data: { stages: [{ stage_name: "Validation", n: 8 }, { stage_name: "Approval", n: 11 }] },
      },
    ]);

    const ring = document.querySelector(".donutwrap svg");
    expect(ring?.style.width).not.toBe("100%");

    // And the names are actually there, not only the dots.
    const keys = [...document.querySelectorAll(".donutkey")].map((k) => k.textContent);
    expect(keys).toEqual(["Validation8", "Approval11"]);
  });

  it("says due today rather than due in 0d", async () => {
    // **Zero days is a number nobody says out loud**, and it is the
    // most urgent row on the card that decides what to pay.
    await openDashboard([
      {
        id: "g3",
        cardType: "on_my_clock",
        settings: {},
        position: 0,
        data: {
          items: [
            {
              id: "t",
              created_at: daysAgo(1),
              supplier_name: "Acme",
              due_date: new Date().toISOString().slice(0, 10),
              total_with_vat: 100,
              currency: "GBP",
            },
          ],
        },
      },
    ]);

    expect(document.body.textContent).toContain("due today");
    expect(document.body.textContent).not.toContain("due in 0d");
  });

  it("folds a sixth stage into a rest", async () => {
    /**
     * **A ring of nine slices is a colour-matching exercise**, and the
     * palette has five (decision 0242).
     */
    await openDashboard([
      {
        id: "h",
        cardType: "where_things_are",
        settings: {},
        position: 0,
        data: {
          stages: Array.from({ length: 7 }, (_, i) => ({ stage_name: `S${i}`, n: i + 1 })),
        },
      },
    ]);

    expect(document.querySelectorAll(".donutkey")).toHaveLength(5);
    expect(document.body.textContent).toContain("…");
  });
});

describe("the bars are read against something (decision 0244)", () => {
  it("draws a grid behind them", async () => {
    /**
     * Without it the heights are relative to each other and to nothing
     * else — fine for two bars and guesswork for six.
     */
    await openDashboard([
      {
        id: "e",
        cardType: "ageing",
        settings: {},
        position: 0,
        data: { buckets: [{ label: "<1d", n: 21 }, { label: "30d+", n: 2 }] },
      },
    ]);

    expect(document.querySelectorAll("svg line").length).toBeGreaterThanOrEqual(4);
  });

  it("gives a zero a hairline rather than a bar", async () => {
    /**
     * **One pixel of colour reads as "a little"**; nothing reads as
     * nothing, and the number above says which. Four of your five
     * ageing buckets are zero.
     */
    await openDashboard([
      {
        id: "f",
        cardType: "ageing",
        settings: {},
        position: 0,
        data: { buckets: [{ label: "<1d", n: 3 }, { label: "1–3d", n: 0 }] },
      },
    ]);

    const bars = [...document.querySelectorAll("svg rect")];
    const zero = bars[1];
    expect(zero.getAttribute("fill")).toBe("var(--border)");
    expect(Number(zero.getAttribute("height"))).toBeLessThan(1);
  });

  it("gives each bar its own gradient", async () => {
    // The id must be unique in the document, or two charts on one
    // screen share one and the second is drawn in the first's colours.
    await openDashboard([
      {
        id: "g",
        cardType: "ageing",
        settings: {},
        position: 0,
        data: { buckets: [{ label: "a", n: 3 }, { label: "b", n: 5 }] },
      },
    ]);

    const ids = [...document.querySelectorAll("linearGradient")].map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("clicking through (decision 0250)", () => {
  /**
   * **The filters existed and nothing could set them.** A stage card
   * says *"eleven at Approval, three of them mine"*, and the obvious
   * next question is *"show me those three"* — which the task list
   * could already answer and had no way of being asked.
   */
  function stageCard(held: { mine: number; theirs: number; unclaimed: number }) {
    return [
      {
        id: "s",
        cardType: "items_at_stage",
        settings: { stage: "approval" },
        position: 0,
        data: {
          count: held.mine + held.theirs + held.unclaimed,
          stageId: "approval",
          stageName: "Approval",
          missing: false,
          held,
        },
      },
    ];
  }

  it("draws a ring of who holds it, with no legend", async () => {
    /**
     * **No legend in a tile that has no room.** The card's own text
     * carries the meaning; a legend would repeat it.
     */
    await openDashboard(stageCard({ mine: 3, theirs: 5, unclaimed: 3 }));

    expect(document.querySelectorAll(".donutwrap svg circle")).toHaveLength(3);
    expect(document.querySelectorAll(".donutkey")).toHaveLength(0);
    expect(document.querySelector(".bignum")?.textContent).toBe("11");
  });

  it("offers to show mine where any are mine", async () => {
    await openDashboard(stageCard({ mine: 3, theirs: 5, unclaimed: 3 }));

    const card = document.querySelector(".panel.clickable");
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("Show mine");
  });

  it("does not offer it where none are", async () => {
    // **A card that leads nowhere should not look like a link**, which
    // is decision 0161's argument about an action with nothing to do.
    await openDashboard(stageCard({ mine: 0, theirs: 8, unclaimed: 3 }));

    expect(document.querySelector(".panel.clickable")).toBeNull();
    expect(document.body.textContent).not.toContain("Show mine");
  });

  it("scrolls the worklist rather than growing it", async () => {
    /**
     * **Twenty-five rows is a card taller than the screen**, and
     * everything beneath becomes unreachable without scrolling past
     * somebody else's work.
     */
    await openDashboard([
      {
        id: "c",
        cardType: "on_my_clock",
        settings: {},
        position: 0,
        data: {
          items: Array.from({ length: 20 }, (_, i) => ({
            id: `t${i}`,
            invoice_id: `inv${i}`,
            created_at: daysAgo(i),
            supplier_name: `Supplier ${i}`,
            due_date: daysAhead(i),
            total_with_vat: 100,
            currency: "GBP",
          })),
        },
      },
    ]);

    const scroller = document.querySelector(".clockscroll");
    expect(scroller).not.toBeNull();
    expect(document.querySelectorAll(".clocktable tbody tr")).toHaveLength(20);
  });

  it("makes each row openable", async () => {
    // **A row that reads like a link and does nothing is worse than one
    // that does not**, because somebody clicks it twice before
    // believing.
    await openDashboard([
      {
        id: "d",
        cardType: "on_my_clock",
        settings: {},
        position: 0,
        data: {
          items: [
            {
              id: "t1",
              invoice_id: "inv-1",
              stage_id: "approval",
              created_at: daysAgo(2),
              supplier_name: "Northwind",
              due_date: daysAhead(9),
              total_with_vat: 576,
              currency: "GBP",
            },
          ],
        },
      },
    ]);

    const rows = document.querySelectorAll(".clocktable tbody tr.clickable");
    expect(rows).toHaveLength(1);
    expect(typeof (rows[0] as HTMLElement).onclick).toBe("function");
  });
});

describe("a background line, where the data is real (decision 0257)", () => {
  /**
   * **`completed_at` gives Done a genuine week to draw**, and
   * `waiting_for_me` has no equivalent — nothing has ever recorded what
   * the queue depth was on a past day. This asserts the line appears
   * exactly where the history is real and nowhere else.
   */
  it("draws a background line on the Done tile", async () => {
    await openDashboard([
      {
        id: "a",
        cardType: "done",
        settings: {},
        position: 0,
        data: { today: 2, week: 9, mine: 5, trend: [{ day: new Date().toISOString().slice(0, 10), n: 2 }] },
      },
    ]);

    const tile = [...document.querySelectorAll(".panel")].find((p) =>
      p.textContent?.includes("Done")
    );
    expect(tile?.querySelector(".tilebg svg")).not.toBeNull();
  });

  it("draws no background line on Waiting for me", async () => {
    /**
     * **The absence is deliberate, not an oversight.** A line here
     * would have to be invented, since nothing records what this count
     * was yesterday.
     */
    await openDashboard([
      { id: "b", cardType: "waiting_for_me", settings: {}, position: 0, data: { count: 3, stages: 1 } },
    ]);

    const tile = [...document.querySelectorAll(".panel")].find((p) =>
      p.textContent?.includes("Waiting for me")
    );
    expect(tile?.querySelector(".tilebg")).toBeNull();
  });

  it("fills a day with no completions as zero rather than skipping it", async () => {
    /**
     * **Gap-filled to seven points**, so five quiet days do not
     * compress into the same width as two busy ones. The backend only
     * returns rows for days with at least one completion (decision
     * 0257); the screen fills the rest.
     */
    const today = new Date().toISOString().slice(0, 10);
    await openDashboard([
      {
        id: "c",
        cardType: "done",
        settings: {},
        position: 0,
        data: { today: 1, week: 1, mine: 1, trend: [{ day: today, n: 1 }] },
      },
    ]);

    const tile = [...document.querySelectorAll(".panel")].find((p) =>
      p.textContent?.includes("Done")
    );
    const line = tile?.querySelector(".tilebg polyline");
    // Seven days means six segments in the polyline's point list.
    const points = line?.getAttribute("points")?.trim().split(/\s+/) ?? [];
    expect(points).toHaveLength(7);
  });

  it("sits behind the figures rather than on top of them", async () => {
    /**
     * **Stacking asserted from the stylesheet, not from a rendered
     * page** — this app's own established pattern (decision 0223 and
     * the typography test): these browser tests do not load the real
     * CSS into the DOM, so `getComputedStyle` here would only ever
     * report the browser's defaults and pass or fail for the wrong
     * reason.
     *
     * The explicit z-index is the thing decision 0257 relied on rather
     * than paint order, so this checks the rule exists and orders the
     * two layers correctly.
     */
    const stylesheets = (await import("virtual:stylesheets")).default;
    const css = stylesheets["index.html"];

    const bgRule = css.slice(css.indexOf(".tilebg {"), css.indexOf(".tilebg {") + 300);
    const fgRule = css.slice(css.indexOf(".tilefg {"), css.indexOf(".tilefg {") + 300);

    expect(bgRule).toContain("z-index: 0");
    expect(fgRule).toContain("z-index: 1");
  });
});
