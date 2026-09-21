import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tasks pending action over a configurable period — decision 0428.
 * Only the "pending over a period" half; "approaching/past due" is
 * not built (no due-date column exists anywhere in this schema — see
 * the route's own doc comment).
 */

function mountShell() {
  document.body.innerHTML = `<div id="card-under-test"></div>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "workload.pending": "Tasks pending action",
    "workload.pendingsub": "Open longer than 3, 7 or 14 days",
    "workload.nopending": "Nothing has been open that long",
    "workload.dayplusheader": "{n}+ days",
    "workload.unclaimed": "Unclaimed",
    "workload.user": "User",
  },
};

function stubPending(data: unknown, seen: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url);
      seen.push(path);
      if (path.startsWith("/api/ui-strings")) return { ok: true, json: async () => STRINGS } as Response;
      if (path.startsWith("/api/workload/pending")) return { ok: true, json: async () => data } as Response;
      throw new Error(`no stub for ${path}`);
    })
  );
}

async function renderPending(data: unknown, seen: string[] = []) {
  stubPending(data, seen);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { load, renderCard } = await import("/workload-pending.js");
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
    await renderPending({ thresholdsDays: [3, 7, 14], users: [], unclaimed: [0, 0, 0] });
    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Tasks pending action");
  });

  it("says nothing has been open that long rather than drawing an empty table", async () => {
    await renderPending({ thresholdsDays: [3, 7, 14], users: [], unclaimed: [0, 0, 0] });
    expect(document.body.textContent).toContain("Nothing has been open that long");
    expect(document.querySelector("table")).toBeNull();
  });

  it("asks the route for the chosen org", async () => {
    const seen: string[] = [];
    await renderPending({ thresholdsDays: [3, 7, 14], users: [], unclaimed: [0, 0, 0] }, seen);
    expect(seen.some((u) => u.startsWith("/api/workload/pending"))).toBe(true);
  });
});

describe("the table, built from the route's own thresholds", () => {
  it("headers each column from the route's own thresholdsDays, not a hard-coded list", async () => {
    await renderPending({
      thresholdsDays: [3, 7, 14],
      users: [{ userId: "dana", userName: "Dana R.", counts: [4, 2, 0] }],
      unclaimed: [0, 0, 0],
    });

    const headers = [...document.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(headers).toEqual(["User", "3+ days", "7+ days", "14+ days"]);
  });

  it("draws one row per user with a non-zero bucket, with its own counts", async () => {
    await renderPending({
      thresholdsDays: [3, 7, 14],
      users: [{ userId: "dana", userName: "Dana R.", counts: [4, 2, 0] }],
      unclaimed: [0, 0, 0],
    });

    expect(document.querySelectorAll("tbody tr")).toHaveLength(1);
    const cells = [...document.querySelectorAll("tbody tr td")].map((td) => td.textContent);
    expect(cells).toEqual(["Dana R.", "4", "2", "0"]);
  });

  it("adds an Unclaimed row only when some unclaimed bucket is non-zero", async () => {
    await renderPending({
      thresholdsDays: [3, 7, 14],
      users: [],
      unclaimed: [0, 1, 0],
    });

    const rows = [...document.querySelectorAll("tbody tr")].map((tr) => tr.querySelector("td")?.textContent);
    expect(rows).toEqual(["Unclaimed"]);
  });

  it("omits the Unclaimed row entirely when every unclaimed bucket is zero", async () => {
    await renderPending({
      thresholdsDays: [3, 7, 14],
      users: [{ userId: "dana", userName: "Dana R.", counts: [1, 0, 0] }],
      unclaimed: [0, 0, 0],
    });

    const rows = [...document.querySelectorAll("tbody tr")].map((tr) => tr.querySelector("td")?.textContent);
    expect(rows).toEqual(["Dana R."]);
  });
});
