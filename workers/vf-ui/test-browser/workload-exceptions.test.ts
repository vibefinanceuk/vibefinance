import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Exceptions by user — decision 0428, the last of Workload's own eight
 * key metrics. Reuses decision 0423's own definition of an exception
 * under a coaching framing, not a fraud-review one.
 */

function mountShell() {
  document.body.innerHTML = `<div id="card-under-test"></div>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "workload.exceptions": "Exceptions by user",
    "workload.exceptionssub": "Not to assign blame — to see where extra support or training would help",
    "workload.noexceptions": "No exceptions recorded",
    "workload.exceptioncount": "{n} exceptions",
  },
};

function stubExceptions(data: unknown, seen: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url);
      seen.push(path);
      if (path.startsWith("/api/ui-strings")) return { ok: true, json: async () => STRINGS } as Response;
      if (path.startsWith("/api/workload/exceptions")) return { ok: true, json: async () => data } as Response;
      throw new Error(`no stub for ${path}`);
    })
  );
}

async function renderExceptions(data: unknown, seen: string[] = []) {
  stubExceptions(data, seen);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { load, renderCard } = await import("/workload-exceptions.js");
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
    await renderExceptions({ users: [] });
    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Exceptions by user");
  });

  it("says no exceptions recorded rather than drawing an empty list", async () => {
    await renderExceptions({ users: [] });
    expect(document.body.textContent).toContain("No exceptions recorded");
    expect(document.querySelector(".barlist-row")).toBeNull();
  });

  it("asks the route for the chosen org", async () => {
    const seen: string[] = [];
    await renderExceptions({ users: [] }, seen);
    expect(seen.some((u) => u.startsWith("/api/workload/exceptions"))).toBe(true);
  });
});

describe("the list the route's data draws", () => {
  const DATA = {
    users: [
      { userId: "dana", userName: "Dana R.", n: 5 },
      { userId: "wei", userName: "Wei C.", n: 1 },
    ],
  };

  it("draws one bar row per user, in the order the route returned them", async () => {
    await renderExceptions(DATA);
    expect(document.querySelectorAll(".barlist-row")).toHaveLength(2);
    const names = [...document.querySelectorAll(".barlist-head span:first-child")].map((n) => n.textContent);
    expect(names).toEqual(["Dana R.", "Wei C."]);
  });

  it("shows the exception count as the row's own display figure", async () => {
    await renderExceptions(DATA);
    expect(document.body.textContent).toContain("5 exceptions");
    expect(document.body.textContent).toContain("1 exceptions");
  });
});
