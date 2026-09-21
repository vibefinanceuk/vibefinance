import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Average handling time by stage and by user — decision 0428. */

function mountShell() {
  document.body.innerHTML = `<div id="card-under-test"></div>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "workload.handlingtime": "Average handling time",
    "workload.handlingtimesub": "Claim to complete, by stage and by user",
    "workload.nohandlingtime": "No completed, claimed tasks yet",
    "workload.stage": "Stage",
    "workload.user": "User",
    "workload.avghandlingtime": "Avg. handling time",
    "workload.taskcount": "Tasks",
    "workload.hourscount": "{n} hours",
  },
};

function stubHandlingTime(data: unknown, seen: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url);
      seen.push(path);
      if (path.startsWith("/api/ui-strings")) return { ok: true, json: async () => STRINGS } as Response;
      if (path.startsWith("/api/workload/handling-time")) return { ok: true, json: async () => data } as Response;
      throw new Error(`no stub for ${path}`);
    })
  );
}

async function renderHandlingTime(data: unknown, seen: string[] = []) {
  stubHandlingTime(data, seen);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { load, renderCard } = await import("/workload-handling-time.js");
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
    await renderHandlingTime({ rows: [] });
    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Average handling time");
  });

  it("says no completed, claimed tasks rather than drawing an empty table", async () => {
    await renderHandlingTime({ rows: [] });
    expect(document.body.textContent).toContain("No completed, claimed tasks yet");
    expect(document.querySelector("table")).toBeNull();
  });

  it("asks the route for the chosen org", async () => {
    const seen: string[] = [];
    await renderHandlingTime({ rows: [] }, seen);
    expect(seen.some((u) => u.startsWith("/api/workload/handling-time"))).toBe(true);
  });
});

describe("the table, already ordered by the route", () => {
  it("draws one row per (stage, user), with its own average and count", async () => {
    await renderHandlingTime({
      rows: [
        { stageId: "st1", stageName: "Matching & Coding", userId: "dana", userName: "Dana R.", avgHours: 4.2, n: 6 },
      ],
    });

    expect(document.querySelectorAll("tbody tr")).toHaveLength(1);
    const cells = [...document.querySelectorAll("tbody tr td")].map((td) => td.textContent);
    expect(cells).toEqual(["Matching & Coding", "Dana R.", "4.2 hours", "6"]);
  });

  it("draws one row per pairing across more than one stage and user, in the order the route returned them", async () => {
    await renderHandlingTime({
      rows: [
        { stageId: "st2", stageName: "Validation", userId: "wei", userName: "Wei C.", avgHours: 1.1, n: 3 },
        { stageId: "st1", stageName: "Matching & Coding", userId: "dana", userName: "Dana R.", avgHours: 4.2, n: 6 },
      ],
    });

    const stages = [...document.querySelectorAll("tbody tr td:first-child")].map((td) => td.textContent);
    expect(stages).toEqual(["Validation", "Matching & Coding"]);
  });
});
