import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Workload balance — decision 0428. `.teamgroup`/`.teamgrouphead`, not
 * `.spendcurrency` reused — see `app.css`'s own doc comment for why.
 */

function mountShell() {
  document.body.innerHTML = `<div id="card-under-test"></div><main id="shell"></main><main id="viewer" hidden></main>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "workload.balance": "Workload balance",
    "workload.balancesub": "Who has each team's open work, most uneven first",
    "workload.nobalance": "No team has open work right now",
    "workload.balancequiet": "{n} teams with nothing open are not shown",
    "workload.balanceothers": "Others",
    "documents.showing.team": "Showing what is open in {team}'s queue",
    "documents.showing.openforteam": "Showing what is open for {name} in {team}'s queue",
  },
};

function stubBalance(data: unknown, seen: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url);
      seen.push(path);
      if (path.startsWith("/api/ui-strings")) return { ok: true, json: async () => STRINGS } as Response;
      if (path.startsWith("/api/workload/balance")) return { ok: true, json: async () => data } as Response;
      if (path.startsWith("/api/org/units")) return { ok: true, json: async () => ({ units: [] }) } as Response;
      if (path.startsWith("/api/documents")) return { ok: true, json: async () => ({ documents: [], searched: 0 }) } as Response;
      throw new Error(`no stub for ${path}`);
    })
  );
}

async function renderBalance(data: unknown, seen: string[] = []) {
  stubBalance(data, seen);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { load, renderCard } = await import("/workload-balance.js");
  await load();
  document.getElementById("card-under-test")!.replaceChildren(renderCard());
}

beforeEach(() => {
  mountShell();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the card the route returned", () => {
  it("titles the card with the route's own heading", async () => {
    await renderBalance({ teams: [] });
    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Workload balance");
  });

  it("says no team has open work rather than drawing an empty group", async () => {
    await renderBalance({ teams: [] });
    expect(document.body.textContent).toContain("No team has open work right now");
    expect(document.querySelector(".teamgroup")).toBeNull();
  });

  it("asks the route for the chosen org", async () => {
    const seen: string[] = [];
    await renderBalance({ teams: [] }, seen);
    expect(seen.some((u) => u.startsWith("/api/workload/balance"))).toBe(true);
  });
});

describe("one bar per team, a section per member (decision 0615)", () => {
  const team = (teamId: string, teamName: string, members: Array<[string, number]>, stdDev = 0) => ({
    teamId,
    teamName,
    members: members.map(([name, n]) => ({ userId: name.toLowerCase(), userName: name, openCount: n })),
    mean: 0,
    variance: 0,
    stdDev,
  });
  const DATA = {
    teams: [
      team("t1", "AP Processing", [["Dana", 6], ["Wei", 2], ["Sam", 0]], 2.5),
      team("t2", "Exceptions", [["Sam", 3]]),
      team("t3", "AP Review", [["Dana", 0]]),
      team("t4", "Supplier Maintenance", [["Dana", 0], ["Wei", 0]]),
    ],
  };

  it("draws one bar per team with open work, most uneven first, and counts the teams left out", async () => {
    await renderBalance(DATA);
    const rows = [...document.querySelectorAll(".teamgroup .stackrow")];
    expect(rows.map((r) => r.querySelector(".stackrow-name")?.textContent)).toEqual(["AP Processing", "Exceptions"]);
    expect(rows.map((r) => r.querySelector(".stackrow-total")?.textContent)).toEqual(["8", "3"]);
    expect(document.querySelector(".balancequiet")?.textContent).toBe("2 teams with nothing open are not shown");
    expect(document.body.textContent).not.toContain("±");
  });

  it("splits a team's bar by who has the work, on one scale across teams", async () => {
    await renderBalance(DATA);
    const [first, second] = [...document.querySelectorAll(".teamgroup .stackrow")];
    const widths = (row: Element) => [...row.querySelectorAll<HTMLElement>(".stackrow-seg")].map((n) => parseFloat(n.style.width));
    expect(widths(first)).toEqual([75, 25]);
    // Exceptions' 3 is 3 of the largest team's 8, not a full bar.
    expect(widths(second)[0]).toBeCloseTo(37.5, 1);
    expect(first.querySelector(".stackrow-seg")?.getAttribute("title")).toBe("Dana: 6");
  });

  it("names every member beneath their team's bar, including one with none", async () => {
    await renderBalance(DATA);
    const key = document.querySelector(".teamgroup .chartlegend")!;
    expect([...key.querySelectorAll(".chartkey")].map((k) => k.textContent)).toEqual(["Dana6", "Wei2", "Sam0"]);
    expect(key.querySelectorAll(".chartkey.clickable")).toHaveLength(2);
  });

  it("folds a sixth member onwards into others", async () => {
    await renderBalance({ teams: [team("t1", "Big", [["A", 6], ["B", 5], ["C", 4], ["D", 3], ["E", 2], ["F", 1]])] });
    const keys = [...document.querySelectorAll(".teamgroup .chartkey")].map((k) => k.textContent);
    expect(keys).toEqual(["A6", "B5", "C4", "D3", "Others3"]);
    expect(document.querySelectorAll(".teamgroup .stackrow-seg.clickable")).toHaveLength(4);
  });
});

describe("the bars open Documents (decision 0615)", () => {
  const DATA = {
    teams: [
      {
        teamId: "t1",
        teamName: "AP Processing",
        members: [
          { userId: "dana", userName: "Dana", openCount: 6 },
          { userId: "wei", userName: "Wei", openCount: 2 },
        ],
        mean: 4,
        variance: 4,
        stdDev: 2,
      },
    ],
  };
  async function asked(seen: string[]) {
    await vi.waitFor(() => expect(seen.some((u) => u.startsWith("/api/documents"))).toBe(true));
    return new URL(seen.find((u) => u.startsWith("/api/documents"))!, "http://x").searchParams;
  }

  it("a member's section opens their open tasks in that team's queue", async () => {
    const seen: string[] = [];
    await renderBalance(DATA, seen);
    document.querySelectorAll<HTMLElement>(".stackrow-seg")[1].click();
    const q = await asked(seen);
    expect([q.get("openFor"), q.get("openTeam"), q.get("team")]).toEqual(["wei", "t1", null]);
    await vi.waitFor(() => expect(document.querySelector(".alertbanner")?.textContent).toContain("Showing what is open for Wei in AP Processing's queue"));
  });

  it("their name in the key does the same, from the keyboard too", async () => {
    const seen: string[] = [];
    await renderBalance(DATA, seen);
    const dana = [...document.querySelectorAll<HTMLElement>(".chartkey")].find((k) => k.textContent?.startsWith("Dana"))!;
    dana.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const q = await asked(seen);
    expect([q.get("openFor"), q.get("openTeam")]).toEqual(["dana", "t1"]);
  });

  it("the team's name or total opens the whole queue", async () => {
    const seen: string[] = [];
    await renderBalance(DATA, seen);
    document.querySelector<HTMLElement>(".stackrow-name")!.click();
    const q = await asked(seen);
    expect([q.get("team"), q.get("openFor")]).toEqual(["t1", null]);
  });
});
