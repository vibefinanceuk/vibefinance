import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Workload balance — decision 0428. `.teamgroup`/`.teamgrouphead`, not
 * `.spendcurrency` reused — see `app.css`'s own doc comment for why.
 */

function mountShell() {
  document.body.innerHTML = `<div id="card-under-test"></div>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "workload.balance": "Workload balance",
    "workload.balancesub": "Variance in open-task count across each team's own members",
    "workload.nobalance": "No teams to compare yet",
    "workload.balancestddev": "±{n} tasks",
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

  it("says no teams to compare rather than drawing an empty group", async () => {
    await renderBalance({ teams: [] });
    expect(document.body.textContent).toContain("No teams to compare yet");
    expect(document.querySelector(".teamgroup")).toBeNull();
  });

  it("asks the route for the chosen org", async () => {
    const seen: string[] = [];
    await renderBalance({ teams: [] }, seen);
    expect(seen.some((u) => u.startsWith("/api/workload/balance"))).toBe(true);
  });
});

describe("one labelled group per team, in the order the route returned them", () => {
  const DATA = {
    teams: [
      {
        teamId: "t1",
        teamName: "AP Processing",
        members: [
          { userId: "dana", userName: "Dana R.", openCount: 4 },
          { userId: "wei", userName: "Wei C.", openCount: 0 },
        ],
        mean: 2,
        variance: 4,
        stdDev: 2,
      },
      {
        teamId: "t2",
        teamName: "Exceptions",
        members: [{ userId: "sam", userName: "Sam T.", openCount: 1 }],
        mean: 1,
        variance: 0,
        stdDev: 0,
      },
    ],
  };

  it("draws one .teamgroup per team, most imbalanced first, as the route ordered them", async () => {
    await renderBalance(DATA);
    const groups = [...document.querySelectorAll(".teamgroup")];
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.querySelector(".teamgrouphead span:first-child")?.textContent)).toEqual([
      "AP Processing",
      "Exceptions",
    ]);
  });

  it("labels each group with its own standard deviation", async () => {
    await renderBalance(DATA);
    const groups = [...document.querySelectorAll(".teamgroup")];
    const notes = groups.map((g) => g.querySelector(".teamgrouphead span:last-child")?.textContent);
    expect(notes).toEqual(["±2 tasks", "±0 tasks"]);
  });

  it("lists every member of a team, including one with zero open tasks", async () => {
    await renderBalance(DATA);
    const firstGroup = document.querySelector(".teamgroup");
    const names = [...firstGroup!.querySelectorAll(".barlist-head span:first-child")].map((n) => n.textContent);
    expect(names).toEqual(["Dana R.", "Wei C."]);
  });
});
