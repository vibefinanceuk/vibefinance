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
    "dash.unplaced_documents": "Unplaced documents",
    "dash.about.unplaced_documents": "No business unit could be assigned",
    "dash.suppliers_awaiting_erp": "Suppliers awaiting the ERP",
    "dash.about.suppliers_awaiting_erp": "No identifier from the system of record",
    "dash.possible_duplicates": "Possible duplicates",
    "dash.about.possible_duplicates": "Invoices that may already be on file",
    "dash.allclear": "Nothing is stuck.",
    // The suppliers screen's own strings, needed because navigating
    // there is exactly what one of these tests does.
    "suppliers.showingawaiting": "Showing suppliers awaiting the ERP only",
    "documents.clearfilter": "Clear filter",
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
    "dash.hiddencards": "Hidden cards",
    "dash.displayedcards": "Displayed cards",
    "dash.savechanges": "Save changes",
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

  it("links to my tasks across every stage", async () => {
    /**
     * **`waitingForMe()` has no stage filter of its own** — it counts
     * open tasks assigned to me, claimed by me, or owned by a team I am
     * on, at any stage — so the click asks for exactly that: every
     * stage, `ownership: "mine"`.
     *
     * **The first test ever to click a dashboard link through to
     * Tasks.** Decision 0250 built the stage card's own "Show mine"
     * link on the same `openTasksFiltered`, and every test for it only
     * ever checked the text appeared — never that clicking it actually
     * landed anywhere. `tasks.js`'s `render()` reads `me.name`, which
     * only exists once `/api/whoami` has resolved; a real page always
     * gets there via `boot.js` before the dashboard is ever shown, but
     * a test reaching the dashboard directly has to stub it too or
     * `render()` throws on a null `me`.
     */
    const seen: string[] = [];
    stubDashboard(
      [{ id: "a", cardType: "waiting_for_me", settings: {}, position: 0, data: { count: 4, stages: 2 } }],
      seen
    );
    const real = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = String(url);
        seen.push(path);
        if (path.startsWith("/api/whoami"))
          return { ok: true, json: async () => ({ id: "u1", name: "Dan", permissions: [] }) } as Response;
        if (path.startsWith("/api/tasks")) return { ok: true, json: async () => ({ tasks: [], counts: {} }) } as Response;
        return real(url);
      })
    );

    const { loadStrings } = await import("/strings.js");
    await loadStrings();

    /**
     * **`start()` first, as a real page always has by the time the
     * dashboard is on screen.** `boot.js` calls it before anything else
     * renders; a test that jumps straight to the dashboard has to do
     * the same, or `render()` throws on a null `me` the instant the
     * click lands.
     */
    const { start } = await import("/tasks.js");
    await start();

    const { open } = await import("/dashboard.js");
    await open();

    const card = [...document.querySelectorAll(".panel.clickable")].find((p) =>
      p.textContent?.includes("Waiting for me")
    ) as HTMLElement;
    expect(card).toBeDefined();
    card.click();
    await new Promise((r) => setTimeout(r, 0));

    /**
     * **The last `/api/tasks` request, not the first.** `start()`'s own
     * call to `loadTasks()` already issued one, unfiltered — the one
     * that matters here is the one the click causes afterward.
     */
    const request = seen.filter((u) => u.startsWith("/api/tasks")).pop();
    expect(request).toContain("ownership=mine");
    expect(request).not.toContain("stage=");
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
        data: {
          stages: [
            { stage_id: "validation", stage_name: "Validation", n: 8 },
            { stage_id: "approval", stage_name: "Approval", n: 11 },
          ],
        },
      },
    ]);

    // One circle per segment, and the legend names them.
    expect(document.querySelectorAll(".donutwrap svg circle")).toHaveLength(2);
    expect(document.body.textContent).toContain("Validation");
    // The total in the middle, so nobody adds up the legend.
    expect(document.body.textContent).toContain("19");
  });

  it("links a stage's legend row to the documents at that stage", async () => {
    /**
     * **Documents, not Tasks** — decision 0264. `whereThingsAre()`
     * counts every document at a stage regardless of who owns any work
     * on it; the only task list in the app is permanently scoped to
     * the viewer's own work, which would silently narrow this card to
     * a fraction of what it actually counts. Confirmed here by the
     * fetch landing on `/api/documents`, not `/api/tasks`.
     */
    const seen: string[] = [];
    stubDashboard(
      [
        {
          id: "w",
          cardType: "where_things_are",
          settings: {},
          position: 0,
          data: {
            stages: [
              { stage_id: "validation", stage_name: "Validation", n: 8 },
              { stage_id: "approval", stage_name: "Approval", n: 11 },
            ],
          },
        },
      ],
      seen
    );
    const real = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = String(url);
        seen.push(path);
        if (path.startsWith("/api/org/units")) return { ok: true, json: async () => ({ units: [] }) } as Response;
        if (path.startsWith("/api/documents"))
          return { ok: true, json: async () => ({ documents: [], searched: 0 }) } as Response;
        return real(url);
      })
    );

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/dashboard.js");
    await open();

    const row = [...document.querySelectorAll(".donutkey")].find((r) => r.textContent?.includes("Approval"));
    (row as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));

    const request = seen.find((u) => u.startsWith("/api/documents"));
    expect(request).toContain("stage=approval");
    expect(seen.some((u) => u.startsWith("/api/tasks"))).toBe(false);
  });

  it("links the tile figure to its stage when only one is in flight", async () => {
    const seen: string[] = [];
    stubDashboard(
      [
        {
          id: "w",
          cardType: "where_things_are",
          settings: {},
          position: 0,
          data: { stages: [{ stage_id: "approval", stage_name: "Approval", n: 5 }] },
        },
      ],
      seen
    );
    const real = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = String(url);
        seen.push(path);
        if (path.startsWith("/api/org/units")) return { ok: true, json: async () => ({ units: [] }) } as Response;
        if (path.startsWith("/api/documents"))
          return { ok: true, json: async () => ({ documents: [], searched: 0 }) } as Response;
        return real(url);
      })
    );

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/dashboard.js");
    await open();

    const card = [...document.querySelectorAll(".panel.clickable")].find((p) =>
      p.textContent?.includes("Approval")
    ) as HTMLElement;
    expect(card).toBeDefined();
    card.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(seen.find((u) => u.startsWith("/api/documents"))).toContain("stage=approval");
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
    /**
     * **Reversed by decision 0259**: one combined card became three, so
     * "nothing is stuck" is now three separate quiet tiles rather than
     * one row saying so. Each shows its own count and stays unclickable
     * at zero — decision 0161's rule, applied here as everywhere else a
     * tile links out.
     */
    await openDashboard([
      { id: "d1", cardType: "unplaced_documents", settings: {}, position: 0, data: { count: 0 } },
      { id: "d2", cardType: "suppliers_awaiting_erp", settings: {}, position: 1, data: { count: 0 } },
      { id: "d3", cardType: "possible_duplicates", settings: {}, position: 2, data: { count: 0 } },
    ]);

    expect(document.body.textContent).toContain("Unplaced documents");
    expect(document.body.textContent).toContain("Suppliers awaiting the ERP");
    expect(document.body.textContent).toContain("Possible duplicates");
    expect(document.querySelectorAll(".panel.clickable")).toHaveLength(0);
  });

  it("draws a graphic on each of the three split-out alert cards", async () => {
    // **"With a graphic"**, per the operator's own words. Each renderer
    // includes an icon, distinct from the figure it sits beside.
    await openDashboard([
      { id: "u", cardType: "unplaced_documents", settings: {}, position: 0, data: { count: 6 } },
      { id: "s", cardType: "suppliers_awaiting_erp", settings: {}, position: 1, data: { count: 1 } },
      { id: "p", cardType: "possible_duplicates", settings: {}, position: 2, data: { count: 2 } },
    ]);

    expect(document.querySelectorAll(".tileicon svg")).toHaveLength(3);
    expect(document.querySelector(".bignum")?.textContent).toBe("6");
  });

  it("links unplaced documents to the documents screen, filtered", async () => {
    const seen: string[] = [];
    stubDashboard(
      [{ id: "u", cardType: "unplaced_documents", settings: {}, position: 0, data: { count: 6 } }],
      seen
    );
    // openDocumentsFiltered's own dependencies, beyond the dashboard's:
    // the unit picker and the document list itself.
    const real = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = String(url);
        seen.push(path);
        if (path.startsWith("/api/org/units")) return { ok: true, json: async () => ({ units: [] }) } as Response;
        if (path.startsWith("/api/documents"))
          return { ok: true, json: async () => ({ documents: [], searched: 0 }) } as Response;
        return real(url);
      })
    );

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/dashboard.js");
    await open();

    const card = document.querySelector(".panel.clickable") as HTMLElement;
    expect(card).not.toBeNull();
    card.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(seen.some((u) => u.includes("/api/documents") && u.includes("unplaced=1"))).toBe(true);
  });

  it("links possible duplicates to the documents screen, filtered", async () => {
    const seen: string[] = [];
    stubDashboard(
      [{ id: "p", cardType: "possible_duplicates", settings: {}, position: 0, data: { count: 2 } }],
      seen
    );
    const real = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = String(url);
        seen.push(path);
        if (path.startsWith("/api/org/units")) return { ok: true, json: async () => ({ units: [] }) } as Response;
        if (path.startsWith("/api/documents"))
          return { ok: true, json: async () => ({ documents: [], searched: 0 }) } as Response;
        return real(url);
      })
    );

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/dashboard.js");
    await open();

    (document.querySelector(".panel.clickable") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));

    expect(seen.some((u) => u.includes("/api/documents") && u.includes("duplicates=1"))).toBe(true);
  });

  it("links suppliers awaiting the ERP to the suppliers screen, filtered", async () => {
    /**
     * **Client-side, unlike the documents filters** — decision 0259.
     * `/api/suppliers` already returns everything, so the click fetches
     * the plain list and the screen filters what it already has. The
     * banner it renders is the only observable evidence the filter is
     * in force, since the request itself carries no filter parameter.
     */
    stubDashboard(
      [{ id: "s", cardType: "suppliers_awaiting_erp", settings: {}, position: 0, data: { count: 1 } }]
    );
    const real = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = String(url);
        if (path.startsWith("/api/suppliers"))
          return {
            ok: true,
            json: async () => ({ suppliers: [{ id: "s1", name: "Acme", erpIdentifier: null, status: "active" }] }),
          } as Response;
        return real(url);
      })
    );

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/dashboard.js");
    await open();

    (document.querySelector(".panel.clickable") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(document.body.textContent).toContain("awaiting the ERP only");
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
          /**
           * **A fresh copy, not the fixture itself** — decision 0262.
           *
           * `remove()` and the mover's "Save changes" both mutate
           * `cards` in place (`splice`, `length = 0` then `push`). A
           * real `fetch().json()` always hands back a freshly
           * deserialised object; this mock was handing back the exact
           * `ONE` array reference the test file's constant points to,
           * so mutating "the response" silently mutated the fixture
           * itself — permanently, for every later test in the file,
           * however many tests away the mutation happened to run.
           *
           * Found because two mover tests failed only when run after
           * an unrelated, already-passing test that removes a card —
           * a fixed extra wait did not help, because the fault was
           * never about timing.
           */
          return { ok: true, json: async () => ({ cards: [...cards], usingDefault: false }) } as Response;
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

  /**
   * **The two-column mover** — decision 0262, the operator's own
   * picture: "Hidden cards on the left and Displayed cards on the
   * right... center arrows to add or remove."
   */
  async function openMover(cards: unknown[], seen: { url: string; method?: string; body?: string }[] = []) {
    await openArranging(cards, seen);
    const add = [...document.querySelectorAll("button")].find((b) => b.textContent === "Add a card");
    add?.click();
    await new Promise((r) => setTimeout(r, 0));
  }

  function columnRows(label: string) {
    const heading = [...document.querySelectorAll(".movercollabel")].find((h) => h.textContent === label);
    return [...(heading?.parentElement?.querySelectorAll(".pickcard") ?? [])];
  }

  it("puts an already-displayed card in the right column, not the left", async () => {
    await openMover(ONE);

    expect(columnRows("Hidden cards").some((r) => r.textContent?.includes("Waiting for me"))).toBe(false);
    expect(columnRows("Displayed cards").some((r) => r.textContent?.includes("Waiting for me"))).toBe(true);
  });

  it("keeps the add arrow disabled until something hidden is selected", async () => {
    await openMover(ONE);

    const add = document.querySelectorAll(".moverarrow")[0] as HTMLButtonElement;
    expect(add.disabled).toBe(true);

    const hidden = columnRows("Hidden cards").find((r) => r.textContent?.includes("How long they have waited"));
    (hidden as HTMLButtonElement)?.click();

    expect(add.disabled).toBe(false);
  });

  it("moves a card from hidden to displayed without touching the server", async () => {
    /**
     * **A working copy, not the live one.** Decision 0262's whole
     * reason for not reusing `save()` per click: it reloads and
     * re-renders the entire page, which would tear down this popout on
     * the first move if every arrow-press saved immediately.
     */
    const seen: { url: string; method?: string; body?: string }[] = [];
    await openMover(ONE, seen);

    const before = seen.filter((r) => r.method === "PUT").length;

    const hidden = columnRows("Hidden cards").find((r) => r.textContent?.includes("How long they have waited")) as HTMLButtonElement;
    hidden.click();
    (document.querySelectorAll(".moverarrow")[0] as HTMLButtonElement).click();

    expect(columnRows("Displayed cards").some((r) => r.textContent?.includes("How long they have waited"))).toBe(true);
    expect(columnRows("Hidden cards").some((r) => r.textContent?.includes("How long they have waited"))).toBe(false);
    expect(seen.filter((r) => r.method === "PUT").length).toBe(before);
  });

  it("moves a card back from displayed to hidden", async () => {
    /**
     * **Uses a type the catalogue actually offers.** `waiting_for_me`
     * is not in this file's stubbed catalogue (only `ageing` and
     * `items_at_stage` are), so removing it could never legitimately
     * make it reappear on the hidden side — the first version of this
     * test asserted an outcome its own fixture could not produce.
     */
    const AGEING_DISPLAYED = [{ id: "b", cardType: "ageing", settings: {}, position: 0, data: {} }];
    await openMover(AGEING_DISPLAYED);

    const displayed = columnRows("Displayed cards").find((r) =>
      r.textContent?.includes("How long they have waited")
    ) as HTMLButtonElement;
    displayed.click();
    (document.querySelectorAll(".moverarrow")[1] as HTMLButtonElement).click();

    expect(columnRows("Hidden cards").some((r) => r.textContent?.includes("How long they have waited"))).toBe(
      true
    );
    expect(
      columnRows("Displayed cards").some((r) => r.textContent?.includes("How long they have waited"))
    ).toBe(false);
  });

  it("keeps a repeatable type in the hidden column after adding one instance", async () => {
    /**
     * **`items_at_stage` never runs out.** A stage card added for
     * Validation does not use up the ability to add one for Approval —
     * unlike every other type here, which disappears from hidden once
     * it is displayed.
     */
    await openMover(ONE);

    const stageRow = columnRows("Hidden cards").find((r) =>
      r.textContent?.includes("Items at a stage")
    ) as HTMLButtonElement;
    stageRow.click();
    (document.querySelectorAll(".moverarrow")[0] as HTMLButtonElement).click();

    expect(columnRows("Hidden cards").some((r) => r.textContent?.includes("Items at a stage"))).toBe(true);
    expect(columnRows("Displayed cards").filter((r) => r.textContent?.includes("Items at a stage"))).toHaveLength(1);
  });

  it("saves the whole working set only when told to", async () => {
    const seen: { url: string; method?: string; body?: string }[] = [];
    await openMover(ONE, seen);

    const hidden = columnRows("Hidden cards").find((r) => r.textContent?.includes("How long they have waited")) as HTMLButtonElement;
    hidden.click();
    (document.querySelectorAll(".moverarrow")[0] as HTMLButtonElement).click();

    const saveButton = [...document.querySelectorAll("button")].find((b) => b.textContent === "Save changes");
    saveButton?.click();
    await new Promise((r) => setTimeout(r, 0));

    const put = seen.filter((r) => r.method === "PUT").pop();
    expect(put).toBeDefined();
    expect(JSON.parse(put!.body!).cards.map((c: { cardType: string }) => c.cardType)).toEqual([
      "waiting_for_me",
      "ageing",
    ]);
  });

  it("discards the working copy on close, without saving", async () => {
    const seen: { url: string; method?: string; body?: string }[] = [];
    await openMover(ONE, seen);

    const hidden = columnRows("Hidden cards").find((r) => r.textContent?.includes("How long they have waited")) as HTMLButtonElement;
    hidden.click();
    (document.querySelectorAll(".moverarrow")[0] as HTMLButtonElement).click();

    const close = [...document.querySelectorAll("button")].find((b) => b.textContent === "Close");
    close?.click();

    expect(seen.some((r) => r.method === "PUT")).toBe(false);
    expect(document.querySelector(".popout")).toBeNull();
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
     *
     * **Scoped to the card, not the page** — decision 0262 gave the
     * toolbar its own icons, so `document.querySelector("svg")` now
     * finds the toolbar's icon regardless of what the card drew. The
     * assertion was always about this one card's content, not about
     * whether an svg exists anywhere on the screen.
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

    const card = [...document.querySelectorAll(".panel")].find((p) =>
      p.textContent?.includes("Approval")
    );
    expect(card?.querySelector("svg")).toBeNull();
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

describe("a panel's own margin does not add to the grid's gap (decision 0261)", () => {
  /**
   * **Decision 0246 recorded this fix and only ever wrote half of it.**
   * The record's own words — "twenty-six between rows" — describe
   * exactly the bug reported live: the base panel's 14px margin adding
   * to the grid's 12px gap. The override was written for `.dashstrip`
   * and never for `.dashgrid`, so every row inside the grid carried the
   * extra 14px the whole time, unnoticed until a tall enough neighbour
   * made 26px look wrong next to a correct 12px above it.
   *
   * Read from the stylesheet's own text, not measured computed style —
   * this codebase's established pattern (decision 0257's stacking
   * test), since these browser tests do not load real CSS into the
   * DOM.
   */
  it("zeroes a dashgrid panel's own margin", async () => {
    const stylesheets = (await import("virtual:stylesheets")).default;
    const css = stylesheets["index.html"];

    const rule = css.slice(css.indexOf(".dashgrid > .panel {"), css.indexOf(".dashgrid > .panel {") + 700);
    expect(rule).toContain("margin: 0");
  });

  it("pins a donut to the bottom of its card, like a bar chart", async () => {
    /**
     * **`donutChart()` returns a `.donutwrap`, not a raw `svg`.** The
     * existing `margin-top: auto` rule only ever matched a bar chart's
     * direct-child svg, so a donut sat at the top of a stretched card
     * with visible empty space below it, while its row sibling's bar
     * chart sat pinned to the bottom — two cards of equal border height
     * that read as different because their content was anchored
     * opposite ends of it.
     *
     * **Checked as the exact compound selector, not a substring.** A
     * first version of this test only looked for the text ".donutwrap"
     * somewhere nearby, which is still true even if the selector were
     * renamed to something that targets nothing real — caught by
     * probing it directly, which is why this checks the full selector
     * string instead.
     */
    const stylesheets = (await import("virtual:stylesheets")).default;
    const css = stylesheets["index.html"];

    expect(css).toContain(".dashgrid > .panel > .donutwrap {");

    const rule = css.slice(
      css.indexOf(".dashgrid > .panel > .donutwrap {"),
      css.indexOf(".dashgrid > .panel > .donutwrap {") + 60
    );
    expect(rule).toContain("margin-top: auto");
  });
});
