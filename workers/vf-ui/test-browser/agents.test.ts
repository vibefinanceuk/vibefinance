import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Agents — decision 0622**, slice 1: the Agents screen under Accounts
 * payable, its form, and what agents deliver on the Tasks screen.
 */

const STRINGS = {
  locale: "en",
  strings: {
    "nav.agents": "Agents",
    "agents.limit": "{used} of {max} agents",
    "agents.zone": "Times in {zone}",
    "agents.new": "New agent",
    "agents.when.week": "Every {weekday} at {time}",
    "agents.when.monthlastworking": "On the last working day of each month at {time}",
    "agents.weekday.1": "Monday",
    "agents.status.active": "Started",
    "agents.status.paused": "Paused",
    "agents.paused.author_access": "Paused: its author no longer has access",
    "agents.run.delivered": "Delivered",
    "agents.report.outstanding_payables": "Outstanding payables",
    "agents.report.accruals": "Accruals by stage",
    "agents.report.possible_duplicates": "Possible duplicates",
    "agents.error.limit_reached": "Your licence allows {n} agents. Remove one, or ask about a larger plan.",
    "agents.saved.new": "Saved, paused. Start it when you are ready, or try it with Run now.",
    "agents.ranow.delivered": "Done: it is on your task list.",
    "agents.removeconfirm": "Remove this agent? Its past runs stay.",
    "agents.showall": "Everyone's agents",
    "agents.notes.heading": "From agents",
    "agents.notes.unclaimed": "Unclaimed, waiting",
    "agents.col.org": "Organisation",
    "agents.col.supplier": "Supplier",
    "agents.col.total": "Total",
    "agents.col.person": "Person",
    "agents.deliver.task": "On the task list",
    "agents.deliver.email": "By email",
    "agents.deliver.both": "Task list and email",
    "agents.deliver.stopped": "stopped",
    "agents.deliver.noemailsetup": "Email is not set up for this environment yet. Ask your administrator.",
    "agents.notes.stop": "Stop sending me this",
    "agents.notes.stoppedlink": "You will no longer get \u201c{name}\u201d.",
    "agents.col.open": "Open tasks",
    "agents.notes.skipped": "Left out, as the agent's author can no longer see them: {orgs}.",
  },
};

const AGENT = {
  id: "agt-1",
  name: "Weekly payables",
  authorId: "u-dan",
  authorName: "Dan",
  report: "outstanding_payables",
  orgs: [{ id: "acme-uk", name: "Acme UK" }, { id: "acme-de", name: "Acme DE" }],
  schedule: { every: "week", time: "08:00", weekday: 1 },
  status: "active",
  pausedReason: null,
  nextRunAt: "2026-10-05T07:00:00.000Z",
  lastRun: { status: "delivered", startedAt: "2026-09-28T07:00:00.000Z", late: false, rowCount: 2, error: null },
  deliver: { task: true, email: true },
  recipients: [
    { id: "u-dan", name: "Dan", optedOut: false },
    { id: "u-maya", name: "Maya", optedOut: true },
  ],
};

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

function stub(opts: { permissions: string[]; agents?: unknown[]; notes?: unknown[]; note?: unknown; createReply?: [number, unknown]; calls?: Call[]; emailReady?: boolean }) {
  const calls = opts.calls ?? [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const [path, qs] = String(url).split("?");
      const method = init?.method ?? "GET";
      calls.push({ method, path: qs ? `${path}?${qs}` : path, body: init?.body ? JSON.parse(String(init.body)) : null });
      const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response;
      if (path === "/api/ui-strings") return reply(200, STRINGS);
      if (path === "/api/whoami") return reply(200, { id: "u-dan", name: "Dan", permissions: opts.permissions });
      if (path === "/api/agents" && method === "GET")
        return reply(200, {
          me: "u-dan",
          agents: opts.agents ?? [AGENT],
          reports: [
            { id: "outstanding_payables", permission: "AP.Analysis", orgIds: ["acme-uk", "acme-de"] },
            { id: "accruals", permission: "AP.Analysis", orgIds: ["acme-uk"] },
            { id: "possible_duplicates", permission: "AP.FraudReview", orgIds: [] },
          ],
          orgs: [{ id: "acme-uk", name: "Acme UK" }, { id: "acme-de", name: "Acme DE" }],
          limit: { used: 1, max: 5 },
          timeZone: "Europe/London",
          canManageAll: opts.permissions.includes("Admin.UserManagement"),
          canSetTimeZone: false,
          managers: [{ id: "u-maya", name: "Maya", hasEmail: true }, { id: "u-olu", name: "Olu", hasEmail: false }],
          emailReady: opts.emailReady ?? true,
        });
      if (path === "/api/agents" && method === "POST") {
        const [status, body] = opts.createReply ?? [201, { ...AGENT, id: "agt-2", status: "paused" }];
        return reply(status, body);
      }
      if (path === "/api/agents/agt-1/run") return reply(200, { status: "delivered" });
      if (path === "/api/agents/agt-1/stop") return reply(200, { stopped: true, name: "Weekly payables" });
      if (path.startsWith("/api/agents/agt-1")) return reply(200, { ...AGENT });
      if (path === "/api/agent-notes") return reply(200, { notes: opts.notes ?? [] });
      if (path === "/api/agent-notes/note-1/done") return reply(200, { done: true });
      if (path === "/api/agent-notes/note-1") return reply(200, opts.note ?? {});
      if (path === "/api/tasks") return reply(200, { tasks: [], total: 0, counts: {}, page: 1, pageSize: 25 });
      return reply(404, {});
    })
  );
  return calls;
}

async function signIn(opts: Parameters<typeof stub>[0]) {
  const calls = stub(opts);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { start } = await import("/tasks.js");
  await start();
  return calls;
}

async function openAgents(opts: Parameters<typeof stub>[0]) {
  const calls = await signIn(opts);
  const { open } = await import("/agents.js");
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

describe("the Agents screen", () => {
  it("is in the menu for those who make agents, and not for others", async () => {
    await signIn({ permissions: ["AP.Agents", "AP.TaskView"] });
    expect([...document.querySelectorAll(".navitem")].map((n) => n.textContent)).toContain("Agents");
    document.body.innerHTML = `<main id="shell"></main><main id="viewer" hidden></main>`;
    vi.resetModules();
    await signIn({ permissions: ["AP.TaskView"] });
    expect([...document.querySelectorAll(".navitem")].map((n) => n.textContent)).not.toContain("Agents");
  });

  it("lists each agent: what, where, when in the environment's time zone, and how its last run went", async () => {
    await openAgents({ permissions: ["AP.Agents"] });
    expect(document.getElementById("agent-zone-line")?.textContent).toContain("1 of 5 agents · Times in Europe/London");
    const row = shell().querySelector('tr[data-agent="agt-1"]')!;
    expect(row.textContent).toContain("Weekly payables");
    expect(row.textContent).toContain("Outstanding payables");
    expect(row.textContent).toContain("Acme UK, Acme DE");
    expect(row.textContent).toContain("Every Monday at 08:00");
    expect(row.textContent).toContain("Started");
    expect(row.textContent).toContain("Delivered");
    // 07:00 UTC on 5 October is 08:00 in London.
    expect(row.textContent).toMatch(/08:00/);
  });

  it("makes one from the form: only reports and organisations the person may use, saved paused", async () => {
    const calls = await openAgents({ permissions: ["AP.Agents"], agents: [] });
    button("New agent")!.click();
    const report = document.getElementById("agent-report") as HTMLSelectElement;
    expect([...report.options].map((o) => o.value)).toEqual(["outstanding_payables", "accruals"]);
    // Accruals is held in Acme UK only: Acme DE is not offered.
    report.value = "accruals";
    report.dispatchEvent(new Event("change"));
    expect([...shell().querySelectorAll("#agent-orgs input")].map((i) => i.id)).toEqual(["agent-org-acme-uk"]);

    const every = document.getElementById("agent-every") as HTMLSelectElement;
    every.value = "month";
    every.dispatchEvent(new Event("change"));
    const day = document.getElementById("agent-day") as HTMLSelectElement;
    day.value = "lastWorking";
    day.dispatchEvent(new Event("change"));
    const name = document.getElementById("agent-name") as HTMLInputElement;
    name.value = "Month-end accruals";
    name.dispatchEvent(new Event("input"));
    shell().querySelector<HTMLButtonElement>("#agent-form .actionlink.primary")!.click();

    await vi.waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/agents")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({
      name: "Month-end accruals",
      report: "accruals",
      orgIds: ["acme-uk"],
      schedule: { every: "month", time: "08:00", day: "lastWorking" },
      deliver: { task: true, email: false },
      recipients: [],
    });
    await vi.waitFor(() => expect(document.getElementById("agents-note")?.textContent).toContain("Saved, paused."));
  });

  it("says a refusal in words, the licence's count included", async () => {
    await openAgents({ permissions: ["AP.Agents"], createReply: [409, { reason: "limit_reached", max: 5, error: "x" }] });
    button("New agent")!.click();
    shell().querySelector<HTMLButtonElement>("#agent-form .actionlink.primary")!.click();
    await vi.waitFor(() => expect(document.getElementById("agents-note")?.textContent).toBe("Your licence allows 5 agents. Remove one, or ask about a larger plan."));
  });

  it("pauses, runs now and removes, asking first", async () => {
    const calls = await openAgents({ permissions: ["AP.Agents"] });
    const pause = shell().querySelector<HTMLButtonElement>('tr[data-agent="agt-1"] .actionlink[title="agents.pause"]')!;
    pause.click();
    await vi.waitFor(() => expect(calls.some((c) => c.method === "PATCH" && c.body?.status === "paused")).toBe(true));

    // Drawn again once the list is read back.
    await vi.waitFor(() => expect(shell().contains(pause)).toBe(false));
    shell().querySelector<HTMLButtonElement>('tr[data-agent="agt-1"] .actionlink[title="agents.runnow"]')!.click();
    await vi.waitFor(() => expect(document.getElementById("agents-note")?.textContent).toBe("Done: it is on your task list."));
    expect(calls.some((c) => c.method === "POST" && c.path === "/api/agents/agt-1/run")).toBe(true);

    shell().querySelector<HTMLButtonElement>('tr[data-agent="agt-1"] .actionlink[title="agents.remove"]')!.click();
    expect(shell().textContent).toContain("Remove this agent? Its past runs stay.");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    shell().querySelector<HTMLButtonElement>(".agentconfirm .actionlink[title='agents.remove']")!.click();
    await vi.waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.path === "/api/agents/agt-1")).toBe(true));
  });

  it("lets an administrator see everyone's agents, without making any", async () => {
    const calls = await openAgents({ permissions: ["Admin.UserManagement"], agents: [{ ...AGENT, authorId: "u-uma", authorName: "Uma" }] });
    expect(button("New agent")).toBeUndefined();
    expect(shell().querySelector('tr[data-agent="agt-1"] .actionlink[title="agents.pause"]')).toBeNull();
    button("Everyone's agents")!.click();
    await vi.waitFor(() => expect(calls.some((c) => c.path === "/api/agents?all=1")).toBe(true));
    await vi.waitFor(() => expect(shell().querySelector('tr[data-agent="agt-1"]')?.textContent).toContain("Uma"));
  });
});

describe("From agents, on the Tasks screen", () => {
  const NOTE = { id: "note-1", agentId: "agt-1", agentName: "Weekly payables", report: "outstanding_payables", createdAt: "2026-10-05T07:00:00Z", late: false, rowCount: 2, totals: [] };

  it("is not there when nothing was delivered", async () => {
    await signIn({ permissions: ["AP.TaskView"] });
    await vi.waitFor(() => expect(document.getElementById("agentnotes")).not.toBeNull());
    await new Promise((r) => setTimeout(r, 20));
    expect(document.getElementById("agentnotes")!.hidden).toBe(true);
  });

  it("shows each note, opens its table in the reader's words, and leaves when done", async () => {
    const calls = await signIn({
      permissions: ["AP.TaskView"],
      notes: [NOTE],
      note: {
        id: "note-1",
        agentName: "Weekly payables",
        table: {
          report: "open_tasks",
          columns: [
            { key: "org", label: "agents.col.org", kind: "text" },
            { key: "person", label: "agents.col.person", kind: "text" },
            { key: "open", label: "agents.col.open", kind: "count" },
          ],
          rows: [
            { org: "Acme UK", person: "Uma", open: 4 },
            { org: "Acme UK", person: null, open: 2 },
          ],
          totals: [{ currency: null, total: null, count: 6 }],
          skippedOrgs: ["Acme DE"],
          asAt: "2026-10-05T07:00:00Z",
        },
      },
    });
    await vi.waitFor(() => expect(document.getElementById("agentnotes")!.hidden).toBe(false));
    const holder = document.getElementById("agentnotes")!;
    expect(holder.textContent).toContain("From agents");
    expect(holder.textContent).toContain("Weekly payables");

    holder.querySelector<HTMLButtonElement>('.actionlink[title="agents.notes.open"]')!.click();
    await vi.waitFor(() => expect(holder.querySelector(".agentreporttable")).not.toBeNull());
    expect([...holder.querySelectorAll(".agentreporttable th")].map((th) => th.textContent)).toEqual(["Organisation", "Person", "Open tasks"]);
    expect([...holder.querySelectorAll(".agentreporttable tbody tr")][1].textContent).toContain("Unclaimed, waiting");
    expect(holder.textContent).toContain("Left out, as the agent's author can no longer see them: Acme DE.");

    holder.querySelector<HTMLButtonElement>('.actionlink[title="agents.notes.done"]')!.click();
    await vi.waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/agent-notes/note-1/done")).toBe(true));
    await vi.waitFor(() => expect(holder.hidden).toBe(true));
  });

  it("formats money with two decimals", async () => {
    const { cellText } = await import("/agent-notes.js");
    expect(cellText(1234.5, "money")).toBe((1234.5).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    expect(cellText(0.873, "percent")).toBe("87%");
    expect(cellText(null, "date")).toBe("—");
  });
});

describe("delivery and recipients — decision 0623", () => {
  it("says how and to whom each agent goes, who stopped it included", async () => {
    await openAgents({ permissions: ["AP.Agents"] });
    expect(shell().querySelector('tr[data-agent="agt-1"] .agentto')?.textContent).toBe("Task list and email · Dan, Maya (stopped)");
  });

  it("chooses the task list, email, and AP Managers to send to, saying who has no address", async () => {
    const calls = await openAgents({ permissions: ["AP.Agents"], agents: [] });
    button("New agent")!.click();
    expect(document.getElementById("agent-recipients")?.textContent).toContain("Olu (");
    (document.getElementById("agent-deliver-email") as HTMLInputElement).click();
    (document.getElementById("agent-to-u-maya") as HTMLInputElement).click();
    const name = document.getElementById("agent-name") as HTMLInputElement;
    name.value = "To Maya";
    name.dispatchEvent(new Event("input"));
    shell().querySelector<HTMLButtonElement>("#agent-form .actionlink.primary")!.click();
    await vi.waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/agents")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body).toMatchObject({ deliver: { task: true, email: true }, recipients: ["u-maya"] });
  });

  it("offers no email where it is not set up, and says so", async () => {
    await openAgents({ permissions: ["AP.Agents"], agents: [], emailReady: false });
    button("New agent")!.click();
    expect((document.getElementById("agent-deliver-email") as HTMLInputElement).disabled).toBe(true);
    expect(document.getElementById("agent-form")?.textContent).toContain("Email is not set up for this environment yet.");
  });

  it("lets a recipient stop a note's agent, and not its author", async () => {
    const note = { id: "note-1", agentId: "agt-1", agentName: "Weekly payables", report: "outstanding_payables", createdAt: "2026-10-05T07:00:00Z", late: false, rowCount: 2, totals: [] };
    const calls = await signIn({ permissions: ["AP.TaskView"], notes: [{ ...note, canStop: true }, { ...note, id: "note-2", agentId: "agt-2", canStop: false }] });
    await vi.waitFor(() => expect(document.getElementById("agentnotes")!.hidden).toBe(false));
    const holder = document.getElementById("agentnotes")!;
    expect(holder.querySelector('[data-note="note-2"] .actionlink[title="Stop sending me this"]')).toBeNull();
    holder.querySelector<HTMLButtonElement>('[data-note="note-1"] .actionlink[title="Stop sending me this"]')!.click();
    await vi.waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/agents/agt-1/stop")).toBe(true));
    await vi.waitFor(() => expect(holder.querySelector('[data-note="note-1"] .actionlink[title="Stop sending me this"]')).toBeNull());
  });

  it("stops an agent from the link in its email, once signed in, and cleans the address", async () => {
    history.replaceState(null, "", "/?stopagent=agt-1");
    const calls = await signIn({ permissions: ["AP.TaskView"] });
    await vi.waitFor(() => expect(document.getElementById("agent-stop-notice")?.textContent).toBe("You will no longer get \u201cWeekly payables\u201d."));
    expect(calls.some((c) => c.method === "POST" && c.path === "/api/agents/agt-1/stop")).toBe(true);
    expect(location.search).toBe("");
  });
});
