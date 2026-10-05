import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Absence and cover — decision 0641.** The Absence screen: one's own
 * absences and, for an AP Manager, the team's; marking oneself away;
 * amending and cancelling; what became of the tasks, in words.
 */

const STRINGS = {
  locale: "en",
  strings: {
    "nav.absence": "Absence",
    "absence.button.none": "Absence",
    "absence.button.away": "Away",
    "absence.button.covering": "Covering",
    "absence.button.awaytitle": "Away until {day}",
    "absence.subtitle": "When you are away, and who covers your tasks.",
    "absence.new": "I will be away",
    "absence.newfor": "For someone in my team",
    "absence.me": "Me",
    "absence.mine": "My absences",
    "absence.mine.empty": "No absence planned.",
    "absence.team": "My team",
    "absence.team.empty": "Nobody in your team is away now or planning to be.",
    "absence.covering": "You are covering for {who}. Their tasks are on your task list.",
    "absence.coveringone": "{name} until {day}",
    "absence.state.away": "Away now",
    "absence.state.planned": "Planned",
    "absence.tasks.moved": "{n} with {cover}",
    "absence.tasks.kept.limit": "{n} stayed: above {cover}'s approval limit in {what}",
    "absence.tasks.willpass": "Will pass to {cover}",
    "absence.amend": "Amend",
    "absence.cancel": "Cancel absence",
    "absence.save": "Save",
    "absence.saved.new": "Saved. Tasks pass to the cover on the first day away.",
    "absence.saved.cancelled": "Cancelled. Anything passed on has been handed back.",
    "absence.form.cover": "Who covers",
    "absence.form.nocover": "Nobody",
    "absence.error.cover_away": "The cover is away for some of that time.",
  },
};

const UMA_AWAY = {
  id: "abs-1",
  userId: "u-uma",
  userName: "Uma",
  startsOn: "2026-10-05",
  returnsOn: "2026-10-08",
  coverUserId: "u-ben",
  coverName: "Ben",
  passTasks: true,
  handBack: true,
  note: null,
  state: "away",
  tasks: { moved: 2, returned: 0, kept: [{ reason: "limit:GBP", count: 1 }] },
  mayChange: true,
};

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

function stub(opts: { permissions: string[]; list?: Record<string, unknown>; createReply?: [number, unknown] }) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).split("?")[0];
      const method = init?.method ?? "GET";
      calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : null });
      const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response;
      if (path === "/api/ui-strings") return reply(200, STRINGS);
      if (path === "/api/whoami") return reply(200, { id: "u-maya", name: "Maya", permissions: opts.permissions });
      if (path === "/api/absences" && method === "GET")
        return reply(200, {
          me: "u-maya",
          today: "2026-10-05",
          timeZone: "Europe/London",
          mine: [],
          team: [],
          canManage: false,
          covering: [],
          people: [],
          covers: { "u-maya": [{ id: "u-ben", name: "Ben" }] },
          ...opts.list,
        });
      if (path === "/api/absences" && method === "POST") return reply(...(opts.createReply ?? [201, { id: "abs-2" }]));
      if (path.endsWith("/cancel")) return reply(200, { id: "abs-1" });
      if (path === "/api/tasks") return reply(200, { tasks: [], total: 0, counts: {}, page: 1, pageSize: 25 });
      return reply(404, {});
    }),
  );
  return calls;
}

async function openAbsence(opts: Parameters<typeof stub>[0]) {
  const calls = stub(opts);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { start } = await import("/tasks.js");
  await start();
  const { open } = await import("/absence.js");
  await open();
  return calls;
}

const shell = () => document.getElementById("shell")!;
const button = (label: string) => [...shell().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label);

beforeEach(() => {
  document.body.innerHTML = `<main id="shell"></main><main id="viewer" hidden></main>`;
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the Absence screen", () => {
  it("is in the top bar for anyone who works tasks, not in a workflow's menu — decision 0642", async () => {
    await openAbsence({ permissions: ["AP.TaskView"] });
    expect(document.getElementById("absence-button")?.textContent).toBe("Absence");
    expect([...shell().querySelectorAll(".navitem")].some((n) => n.textContent?.includes("Absence"))).toBe(false);
    expect(document.getElementById("absence-mine")?.textContent).toBe("No absence planned.");
    // Not an AP Manager: no team panel, and no arranging for others.
    expect(document.getElementById("absence-team")).toBeNull();
    expect(button("For someone in my team")).toBeUndefined();
  });

  it("marks oneself away with a cover, and says what was refused", async () => {
    const calls = await openAbsence({ permissions: ["AP.TaskView"], createReply: [422, { reason: "cover_away" }] });
    button("I will be away")!.click();
    const set = (id: string, v: string) => {
      const n = document.getElementById(id) as HTMLInputElement;
      n.value = v;
      n.dispatchEvent(new Event("input"));
    };
    set("absence-starts", "2026-10-06");
    set("absence-returns", "2026-10-09");
    const cover = document.getElementById("absence-cover") as HTMLSelectElement;
    expect([...cover.options].map((o) => o.textContent)).toEqual(["Nobody", "Ben"]);
    cover.value = "u-ben";
    cover.dispatchEvent(new Event("change"));
    button("Save")!.click();
    await vi.waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/absences")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ startsOn: "2026-10-06", returnsOn: "2026-10-09", coverUserId: "u-ben", passTasks: true, handBack: true, note: null, userId: "u-maya" });
    await vi.waitFor(() => expect(document.getElementById("absence-note-line")?.textContent).toBe("The cover is away for some of that time."));
  });

  it("shows an AP Manager the team, what became of the tasks, and cancels an absence", async () => {
    const calls = await openAbsence({
      permissions: ["AP.TaskView", "AP.Manager"],
      list: { canManage: true, team: [UMA_AWAY], people: [{ id: "u-uma", name: "Uma" }], covering: [{ userId: "u-olu", name: "Olu", returnsOn: "2026-10-09" }] },
    });
    const row = document.querySelector('#absence-team [data-absence="abs-1"]')!;
    expect(row.textContent).toContain("Uma");
    expect(row.textContent).toContain("Away now");
    expect(row.textContent).toContain("2 with Ben · 1 stayed: above Ben's approval limit in GBP");
    expect(document.getElementById("absence-covering")?.textContent).toContain("You are covering for Olu until");
    expect(button("For someone in my team")).toBeDefined();
    [...row.querySelectorAll("button")].find((b) => b.textContent?.includes("Cancel absence"))!.click();
    await vi.waitFor(() => expect(calls.some((c) => c.path === "/api/absences/abs-1/cancel")).toBe(true));
  });
});

describe("the top bar's Absence button — decision 0642", () => {
  it("says Away while one is away, and Covering while someone's tasks are with one", async () => {
    await openAbsence({ permissions: ["AP.TaskView"], list: { mine: [{ ...UMA_AWAY, userId: "u-maya" }] } });
    expect(document.getElementById("absence-button")?.textContent).toBe("Away");
    expect(document.getElementById("absence-button")?.getAttribute("title")).toBe("Away until 2026-10-08");
    document.body.innerHTML = `<main id="shell"></main><main id="viewer" hidden></main>`;
    vi.resetModules();
    await openAbsence({ permissions: ["AP.TaskView"], list: { covering: [{ userId: "u-uma", name: "Uma", returnsOn: "2026-10-08" }] } });
    expect(document.getElementById("absence-button")?.textContent).toBe("Covering");
  });
});
