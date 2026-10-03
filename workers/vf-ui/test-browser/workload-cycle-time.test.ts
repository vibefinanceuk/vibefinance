import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Claim-to-complete cycle time — decision 0428. */

function mountShell() {
  document.body.innerHTML = `<div id="card-under-test"></div><main id="shell"></main><main id="viewer" hidden></main>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "workload.cycletime": "Claim-to-complete cycle time",
    "workload.cycletimesub": "How long a task sits once somebody has it",
    "workload.nocycletime": "No completed, claimed tasks yet",
    "workload.taskcountnote": "{n} tasks",
    "workload.hourscount": "{n} hours",
    "documents.showing.handledby": "Showing where {name} claimed and completed a task",
  },
};

function stubCycleTime(data: unknown, seen: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url);
      seen.push(path);
      if (path.startsWith("/api/ui-strings")) return { ok: true, json: async () => STRINGS } as Response;
      if (path.startsWith("/api/workload/cycle-time")) return { ok: true, json: async () => data } as Response;
      if (path.startsWith("/api/org/units")) return { ok: true, json: async () => ({ units: [] }) } as Response;
      if (path.startsWith("/api/documents")) return { ok: true, json: async () => ({ documents: [], searched: 0 }) } as Response;
      throw new Error(`no stub for ${path}`);
    })
  );
}

async function renderCycleTime(data: unknown, seen: string[] = []) {
  stubCycleTime(data, seen);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { load, renderCard } = await import("/workload-cycle-time.js");
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
    await renderCycleTime({ users: [] });
    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Claim-to-complete cycle time");
  });

  it("says no completed, claimed tasks rather than drawing an empty list", async () => {
    await renderCycleTime({ users: [] });
    expect(document.body.textContent).toContain("No completed, claimed tasks yet");
    expect(document.querySelector(".barlist-row")).toBeNull();
  });

  it("asks the route for the chosen org", async () => {
    const seen: string[] = [];
    await renderCycleTime({ users: [] }, seen);
    expect(seen.some((u) => u.startsWith("/api/workload/cycle-time"))).toBe(true);
  });
});

describe("the list the route's data draws", () => {
  const DATA = {
    users: [
      { userId: "dana", userName: "Dana R.", avgHours: 6.5, n: 9 },
      { userId: "wei", userName: "Wei C.", avgHours: 2.25, n: 4 },
    ],
  };

  it("draws one bar row per user, ranked in the order the route returned them", async () => {
    await renderCycleTime(DATA);
    expect(document.querySelectorAll(".barlist-row")).toHaveLength(2);
    const names = [...document.querySelectorAll(".barlist-head span:first-child")].map((n) => n.textContent);
    expect(names).toEqual(["Dana R.", "Wei C."]);
  });

  it("shows the average as hours, and the task count as a note", async () => {
    await renderCycleTime(DATA);
    expect(document.body.textContent).toContain("6.5 hours");
    expect(document.body.textContent).toContain("9 tasks");
  });
});

async function documentsAsked(seen: string[]) {
  await vi.waitFor(() => expect(seen.some((u) => u.startsWith("/api/documents"))).toBe(true));
  return new URL(seen.find((u) => u.startsWith("/api/documents"))!, "http://x").searchParams;
}

describe("a person's bar opens Documents (decision 0616)", () => {
  it("asks for what that person claimed and completed, and says so", async () => {
    const seen: string[] = [];
    await renderCycleTime({ users: [{ userId: "alice", userName: "Alice McDonald", avgHours: 10.2, n: 9 }] }, seen);
    document.querySelector<HTMLElement>(".barlist-row.clickable")!.click();
    const q = await documentsAsked(seen);
    expect(q.get("handledBy")).toBe("alice");
    await vi.waitFor(() => expect(document.querySelector(".alertbanner")?.textContent).toContain("Showing where Alice McDonald claimed and completed a task"));
  });

  it("offers it at 0 hours too, where there were tasks", async () => {
    await renderCycleTime({ users: [{ userId: "bo", userName: "Bo", avgHours: 0, n: 2 }] });
    expect(document.querySelectorAll(".barlist-row.clickable")).toHaveLength(1);
  });
});
