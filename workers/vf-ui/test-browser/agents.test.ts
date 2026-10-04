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
    "agents.when.monthlastworking":
      "On the last working day of each month at {time}",
    "agents.weekday.1": "Monday",
    "agents.status.active": "Started",
    "agents.status.paused": "Paused",
    "agents.paused.author_access": "Paused: its author no longer has access",
    "agents.run.delivered": "Delivered",
    "agents.report.outstanding_payables": "Outstanding payables",
    "agents.report.accruals": "Accruals by stage",
    "agents.report.possible_duplicates": "Possible duplicates",
    "agents.error.limit_reached":
      "Your licence allows {n} agents. Remove one, or ask about a larger plan.",
    "agents.saved.new":
      "Saved, paused. Start it when you are ready, or try it with Run now.",
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
    "agents.deliver.noemailsetup":
      "Email is not set up for this environment yet. Ask your administrator.",
    "agents.notes.stop": "Stop sending me this",
    "agents.understand": "Understand",
    "agents.examples": "Ready-made",
    "agents.examples.heading": "Ready-made agents",
    "agents.examples.use": "Use this",
    "agents.example.weekly_payables.name": "Weekly outstanding payables",
    "agents.example.weekly_payables.words":
      "Every Monday at 8am, outstanding payables by supplier.",
    "agents.example.stuck_digest.name": "Stuck work",
    "agents.example.stuck_digest.words":
      "Every working day at 9am, tasks open more than 5 days.",
    "agents.example.month_end_accruals.name": "Month-end accruals",
    "agents.example.month_end_accruals.words":
      "On the last working day of each month at 4pm, accruals.",
    "agents.page.back": "All agents",
    "agents.page.runs": "Runs",
    "agents.page.versions": "Plan versions",
    "agents.page.current": "current",
    "agents.page.changed": "Changed: {steps}",
    "agents.page.author": "made it",
    "agents.page.stoppedon": "stopped receiving it {when}",
    "agents.page.step.gathered": "Gathered {n} rows",
    "agents.page.step.sent": "sent",
    "agents.event.byvibefinance": "VibeFinance",
    "agents.event.created": "{by} made it (plan v{version})",
    "agents.event.changed": "{by} changed the plan to v{version}",
    "agents.event.paused_access":
      "{by} paused it: its author can no longer see its report",
    "agents.event.stopped_receiving": "{by} stopped receiving it",
    "agents.log.show": "Show the log",
    "agents.notes.failedtag": "Failing",
    "agents.notes.failure.partial": "Some copies could not be sent",
    "agents.notes.failure.times": "Failed {n} times since {since}",
    "agents.notes.openagent": "Open the agent",
    "agents.channel.email": "by email",
    "agents.channel.task": "on the task list",
    "agents.summary.short": "AI summary",
    "agents.summary.label": "AI summary",
    "agents.summary.on": "Write a few sentences on top of each report",
    "agents.summary.hint": "Written by AI from each reader's own copy.",
    "agents.summary.noai":
      "AI is not set up here, so reports go without a summary.",
    "agents.summary.today":
      "AI summaries today: {used} of {max}. Past that, reports go without one.",
    "agents.summary.notelabel": "Summary, written by AI from the table below",
    "agents.summary.run.written": "summary written",
    "agents.summary.run.mismatch":
      "no summary: a number did not match the table",
    "agents.plan.summarise": "Summary",
    "agents.plan.summary.on":
      "A few sentences by AI on top, every number checked against the table",
    "agents.plan.summary.off": "No summary, the table only",
    "agents.plan.when": "When",
    "agents.plan.gather": "Report",
    "agents.plan.shape": "Narrowed",
    "agents.plan.deliver": "Delivered",
    "agents.plan.mintotal": "only suppliers owing at least {n}",
    "agents.plan.highlightdays": "highlighted past {n} days",
    "agents.plan.toyouand": "to you and {names}",
    "agents.plan.missing.schedule":
      "Not understood yet: say when in Edit steps.",
    "agents.refusal.outside_address":
      "Left out \u201c{words}\u201d: agents go only to people in VibeFinance.",
    "agents.error.ai_unavailable":
      "The AI could not be reached just now. Try again, or use Edit steps.",
    "agents.runnowhint":
      "Run now sends only to you, to try an agent. Everyone else gets theirs on the schedule.",
    "agents.notes.up": "up {n} since the last report",
    "agents.notes.highlighted": "Highlighted: {why}.",
    "agents.notes.why.stuck_work": "open {n} days or more",
    "agents.notes.stoppedlink": "You will no longer get \u201c{name}\u201d.",
    "agents.col.open": "Open tasks",
    "agents.notes.skipped":
      "Left out, as the agent's author can no longer see them: {orgs}.",
  },
};

const AGENT = {
  id: "agt-1",
  name: "Weekly payables",
  authorId: "u-dan",
  authorName: "Dan",
  report: "outstanding_payables",
  orgs: [
    { id: "acme-uk", name: "Acme UK" },
    { id: "acme-de", name: "Acme DE" },
  ],
  schedule: { every: "week", time: "08:00", weekday: 1 },
  status: "active",
  pausedReason: null,
  nextRunAt: "2026-10-05T07:00:00.000Z",
  lastRun: {
    status: "delivered",
    startedAt: "2026-09-28T07:00:00.000Z",
    late: false,
    rowCount: 2,
    error: null,
  },
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

function stub(opts: {
  permissions: string[];
  agents?: unknown[];
  notes?: unknown[];
  note?: unknown;
  createReply?: [number, unknown];
  calls?: Call[];
  emailReady?: boolean;
  understandReply?: [number, unknown];
  aiReady?: boolean;
  page?: unknown;
  runs?: unknown[];
  events?: unknown[];
}) {
  const calls = opts.calls ?? [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const [path, qs] = String(url).split("?");
      const method = init?.method ?? "GET";
      calls.push({
        method,
        path: qs ? `${path}?${qs}` : path,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      const reply = (status: number, body: unknown) =>
        ({ ok: status < 400, status, json: async () => body }) as Response;
      if (path === "/api/ui-strings") return reply(200, STRINGS);
      if (path === "/api/whoami")
        return reply(200, {
          id: "u-dan",
          name: "Dan",
          permissions: opts.permissions,
        });
      if (path === "/api/agents" && method === "GET")
        return reply(200, {
          me: "u-dan",
          agents: opts.agents ?? [AGENT],
          reports: [
            {
              id: "outstanding_payables",
              permission: "AP.Analysis",
              orgIds: ["acme-uk", "acme-de"],
              optionKeys: ["minTotal", "highlightDays"],
              options: { highlightDays: 60 },
            },
            {
              id: "accruals",
              permission: "AP.Analysis",
              orgIds: ["acme-uk"],
              optionKeys: [],
              options: {},
            },
            {
              id: "stuck_work",
              permission: "AP.Analysis",
              orgIds: ["acme-uk"],
              optionKeys: ["olderThanDays"],
              options: { olderThanDays: 5 },
            },
            {
              id: "possible_duplicates",
              permission: "AP.FraudReview",
              orgIds: [],
            },
          ],
          orgs: [
            { id: "acme-uk", name: "Acme UK" },
            { id: "acme-de", name: "Acme DE" },
          ],
          limit: { used: 1, max: 5 },
          timeZone: "Europe/London",
          canManageAll: opts.permissions.includes("Admin.UserManagement"),
          canSetTimeZone: false,
          managers: [
            { id: "u-maya", name: "Maya", hasEmail: true },
            { id: "u-olu", name: "Olu", hasEmail: false },
          ],
          emailReady: opts.emailReady ?? true,
          aiReady: opts.aiReady ?? true,
          summaries: { used: 3, max: 100 },
        });
      if (path === "/api/agents" && method === "POST") {
        const [status, body] = opts.createReply ?? [
          201,
          { ...AGENT, id: "agt-2", status: "paused" },
        ];
        return reply(status, body);
      }
      if (path === "/api/agents/understand")
        return reply(
          ...(opts.understandReply ?? [503, { reason: "ai_unavailable" }]),
        );
      if (path === "/api/agents/agt-1/run")
        return reply(200, { status: "delivered" });
      if (path === "/api/agents/agt-1/stop")
        return reply(200, { stopped: true, name: "Weekly payables" });
      if (path === "/api/agents/agt-1/runs")
        return reply(200, { runs: opts.runs ?? [] });
      if (path === "/api/agents/agt-1" && method === "GET" && opts.page)
        return reply(200, opts.page);
      if (path === "/api/agent-events")
        return reply(200, { events: opts.events ?? [] });
      if (path.startsWith("/api/agents/agt-1")) return reply(200, { ...AGENT });
      if (path === "/api/agent-notes")
        return reply(200, { notes: opts.notes ?? [] });
      if (path === "/api/agent-notes/note-1/done")
        return reply(200, { done: true });
      if (path === "/api/agent-notes/note-1")
        return reply(200, opts.note ?? {});
      if (path === "/api/tasks")
        return reply(200, {
          tasks: [],
          total: 0,
          counts: {},
          page: 1,
          pageSize: 25,
        });
      return reply(404, {});
    }),
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
const button = (label: string) =>
  [...shell().querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === label,
  );

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
    expect(
      [...document.querySelectorAll(".navitem")].map((n) => n.textContent),
    ).toContain("Agents");
    document.body.innerHTML = `<main id="shell"></main><main id="viewer" hidden></main>`;
    vi.resetModules();
    await signIn({ permissions: ["AP.TaskView"] });
    expect(
      [...document.querySelectorAll(".navitem")].map((n) => n.textContent),
    ).not.toContain("Agents");
  });

  it("lists each agent: what, where, when in the environment's time zone, and how its last run went", async () => {
    await openAgents({ permissions: ["AP.Agents"] });
    expect(document.getElementById("agent-zone-line")?.textContent).toContain(
      "1 of 5 agents · Times in Europe/London",
    );
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
    expect([...report.options].map((o) => o.value)).toEqual([
      "outstanding_payables",
      "accruals",
      "stuck_work",
    ]);
    // Accruals is held in Acme UK only: Acme DE is not offered.
    report.value = "accruals";
    report.dispatchEvent(new Event("change"));
    expect(
      [...shell().querySelectorAll("#agent-orgs input")].map((i) => i.id),
    ).toEqual(["agent-org-acme-uk"]);

    const every = document.getElementById("agent-every") as HTMLSelectElement;
    every.value = "month";
    every.dispatchEvent(new Event("change"));
    const day = document.getElementById("agent-day") as HTMLSelectElement;
    day.value = "lastWorking";
    day.dispatchEvent(new Event("change"));
    const name = document.getElementById("agent-name") as HTMLInputElement;
    name.value = "Month-end accruals";
    name.dispatchEvent(new Event("input"));
    shell()
      .querySelector<HTMLButtonElement>("#agent-form .actionlink.primary")!
      .click();

    await vi.waitFor(() =>
      expect(
        calls.some((c) => c.method === "POST" && c.path === "/api/agents"),
      ).toBe(true),
    );
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({
      name: "Month-end accruals",
      description: null,
      summary: true,
      report: "accruals",
      orgIds: ["acme-uk"],
      schedule: { every: "month", time: "08:00", day: "lastWorking" },
      deliver: { task: true, email: false },
      recipients: [],
      options: {},
    });
    await vi.waitFor(() =>
      expect(document.getElementById("agents-note")?.textContent).toContain(
        "Saved, paused.",
      ),
    );
  });

  it("says a refusal in words, the licence's count included", async () => {
    await openAgents({
      permissions: ["AP.Agents"],
      createReply: [409, { reason: "limit_reached", max: 5, error: "x" }],
    });
    button("New agent")!.click();
    shell()
      .querySelector<HTMLButtonElement>("#agent-form .actionlink.primary")!
      .click();
    await vi.waitFor(() =>
      expect(document.getElementById("agents-note")?.textContent).toBe(
        "Your licence allows 5 agents. Remove one, or ask about a larger plan.",
      ),
    );
  });

  it("pauses, runs now and removes, asking first", async () => {
    const calls = await openAgents({ permissions: ["AP.Agents"] });
    const pause = shell().querySelector<HTMLButtonElement>(
      'tr[data-agent="agt-1"] .actionlink[title="agents.pause"]',
    )!;
    pause.click();
    await vi.waitFor(() =>
      expect(
        calls.some((c) => c.method === "PATCH" && c.body?.status === "paused"),
      ).toBe(true),
    );

    // Drawn again once the list is read back.
    await vi.waitFor(() => expect(shell().contains(pause)).toBe(false));
    shell()
      .querySelector<HTMLButtonElement>(
        'tr[data-agent="agt-1"] .actionlink[title="agents.runnow"]',
      )!
      .click();
    await vi.waitFor(() =>
      expect(document.getElementById("agents-note")?.textContent).toBe(
        "Done: it is on your task list.",
      ),
    );
    expect(
      calls.some(
        (c) => c.method === "POST" && c.path === "/api/agents/agt-1/run",
      ),
    ).toBe(true);

    shell()
      .querySelector<HTMLButtonElement>(
        'tr[data-agent="agt-1"] .actionlink[title="agents.remove"]',
      )!
      .click();
    expect(shell().textContent).toContain(
      "Remove this agent? Its past runs stay.",
    );
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    shell()
      .querySelector<HTMLButtonElement>(
        ".agentconfirm .actionlink[title='agents.remove']",
      )!
      .click();
    await vi.waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === "DELETE" && c.path === "/api/agents/agt-1",
        ),
      ).toBe(true),
    );
  });

  it("lets an administrator see everyone's agents, without making any", async () => {
    const calls = await openAgents({
      permissions: ["Admin.UserManagement"],
      agents: [{ ...AGENT, authorId: "u-uma", authorName: "Uma" }],
    });
    expect(button("New agent")).toBeUndefined();
    expect(
      shell().querySelector(
        'tr[data-agent="agt-1"] .actionlink[title="agents.pause"]',
      ),
    ).toBeNull();
    button("Everyone's agents")!.click();
    await vi.waitFor(() =>
      expect(calls.some((c) => c.path === "/api/agents?all=1")).toBe(true),
    );
    await vi.waitFor(() =>
      expect(
        shell().querySelector('tr[data-agent="agt-1"]')?.textContent,
      ).toContain("Uma"),
    );
  });
});

describe("From agents, on the Tasks screen", () => {
  const NOTE = {
    id: "note-1",
    agentId: "agt-1",
    agentName: "Weekly payables",
    report: "outstanding_payables",
    createdAt: "2026-10-05T07:00:00Z",
    late: false,
    rowCount: 2,
    totals: [],
  };

  it("is not there when nothing was delivered", async () => {
    await signIn({ permissions: ["AP.TaskView"] });
    await vi.waitFor(() =>
      expect(document.getElementById("agentnotes")).not.toBeNull(),
    );
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
    await vi.waitFor(() =>
      expect(document.getElementById("agentnotes")!.hidden).toBe(false),
    );
    const holder = document.getElementById("agentnotes")!;
    expect(holder.textContent).toContain("From agents");
    expect(holder.textContent).toContain("Weekly payables");

    holder
      .querySelector<HTMLButtonElement>(
        '.actionlink[title="agents.notes.open"]',
      )!
      .click();
    await vi.waitFor(() =>
      expect(holder.querySelector(".agentreporttable")).not.toBeNull(),
    );
    expect(
      [...holder.querySelectorAll(".agentreporttable th")].map(
        (th) => th.textContent,
      ),
    ).toEqual(["Organisation", "Person", "Open tasks"]);
    expect(
      [...holder.querySelectorAll(".agentreporttable tbody tr")][1].textContent,
    ).toContain("Unclaimed, waiting");
    expect(holder.textContent).toContain(
      "Left out, as the agent's author can no longer see them: Acme DE.",
    );

    holder
      .querySelector<HTMLButtonElement>(
        '.actionlink[title="agents.notes.done"]',
      )!
      .click();
    await vi.waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === "POST" && c.path === "/api/agent-notes/note-1/done",
        ),
      ).toBe(true),
    );
    await vi.waitFor(() => expect(holder.hidden).toBe(true));
  });

  it("formats money with two decimals", async () => {
    const { cellText } = await import("/agent-notes.js");
    expect(cellText(1234.5, "money")).toBe(
      (1234.5).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    );
    expect(cellText(0.873, "percent")).toBe("87%");
    expect(cellText(null, "date")).toBe("—");
  });
});

describe("delivery and recipients — decision 0623", () => {
  it("says how and to whom each agent goes, who stopped it included", async () => {
    await openAgents({ permissions: ["AP.Agents"] });
    expect(
      shell().querySelector('tr[data-agent="agt-1"] .agentto')?.textContent,
    ).toBe("Task list and email · AI summary · Dan, Maya (stopped)");
  });

  it("chooses the task list, email, and AP Managers to send to, saying who has no address", async () => {
    const calls = await openAgents({ permissions: ["AP.Agents"], agents: [] });
    button("New agent")!.click();
    expect(document.getElementById("agent-recipients")?.textContent).toContain(
      "Olu (",
    );
    (
      document.getElementById("agent-deliver-email") as HTMLInputElement
    ).click();
    (document.getElementById("agent-to-u-maya") as HTMLInputElement).click();
    const name = document.getElementById("agent-name") as HTMLInputElement;
    name.value = "To Maya";
    name.dispatchEvent(new Event("input"));
    shell()
      .querySelector<HTMLButtonElement>("#agent-form .actionlink.primary")!
      .click();
    await vi.waitFor(() =>
      expect(
        calls.some((c) => c.method === "POST" && c.path === "/api/agents"),
      ).toBe(true),
    );
    expect(calls.find((c) => c.method === "POST")!.body).toMatchObject({
      deliver: { task: true, email: true },
      recipients: ["u-maya"],
    });
  });

  it("offers no email where it is not set up, and says so", async () => {
    await openAgents({
      permissions: ["AP.Agents"],
      agents: [],
      emailReady: false,
    });
    button("New agent")!.click();
    expect(
      (document.getElementById("agent-deliver-email") as HTMLInputElement)
        .disabled,
    ).toBe(true);
    expect(document.getElementById("agent-form")?.textContent).toContain(
      "Email is not set up for this environment yet.",
    );
  });

  it("lets a recipient stop a note's agent, and not its author", async () => {
    const note = {
      id: "note-1",
      agentId: "agt-1",
      agentName: "Weekly payables",
      report: "outstanding_payables",
      createdAt: "2026-10-05T07:00:00Z",
      late: false,
      rowCount: 2,
      totals: [],
    };
    const calls = await signIn({
      permissions: ["AP.TaskView"],
      notes: [
        { ...note, canStop: true },
        { ...note, id: "note-2", agentId: "agt-2", canStop: false },
      ],
    });
    await vi.waitFor(() =>
      expect(document.getElementById("agentnotes")!.hidden).toBe(false),
    );
    const holder = document.getElementById("agentnotes")!;
    expect(
      holder.querySelector(
        '[data-note="note-2"] .actionlink[title="Stop sending me this"]',
      ),
    ).toBeNull();
    holder
      .querySelector<HTMLButtonElement>(
        '[data-note="note-1"] .actionlink[title="Stop sending me this"]',
      )!
      .click();
    await vi.waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === "POST" && c.path === "/api/agents/agt-1/stop",
        ),
      ).toBe(true),
    );
    await vi.waitFor(() =>
      expect(
        holder.querySelector(
          '[data-note="note-1"] .actionlink[title="Stop sending me this"]',
        ),
      ).toBeNull(),
    );
  });

  it("stops an agent from the link in its email, once signed in, and cleans the address", async () => {
    history.replaceState(null, "", "/?stopagent=agt-1");
    const calls = await signIn({ permissions: ["AP.TaskView"] });
    await vi.waitFor(() =>
      expect(document.getElementById("agent-stop-notice")?.textContent).toBe(
        "You will no longer get \u201cWeekly payables\u201d.",
      ),
    );
    expect(
      calls.some(
        (c) => c.method === "POST" && c.path === "/api/agents/agt-1/stop",
      ),
    ).toBe(true);
    expect(location.search).toBe("");
  });
});

describe("options, highlights and comparison — decision 0624", () => {
  it("offers each report's own options with its defaults, and sends them", async () => {
    const calls = await openAgents({ permissions: ["AP.Agents"], agents: [] });
    expect(document.getElementById("agents-runnow-hint")?.textContent).toBe(
      "Run now sends only to you, to try an agent. Everyone else gets theirs on the schedule.",
    );
    button("New agent")!.click();
    expect(
      (
        document.getElementById(
          "agent-option-highlightDays",
        ) as HTMLInputElement
      ).value,
    ).toBe("60");
    const min = document.getElementById(
      "agent-option-minTotal",
    ) as HTMLInputElement;
    expect(min.value).toBe("");
    const report = document.getElementById("agent-report") as HTMLSelectElement;
    report.value = "stuck_work";
    report.dispatchEvent(new Event("change"));
    expect(document.getElementById("agent-option-minTotal")).toBeNull();
    const older = document.getElementById(
      "agent-option-olderThanDays",
    ) as HTMLInputElement;
    expect(older.value).toBe("5");
    older.value = "10";
    older.dispatchEvent(new Event("input"));
    const name = document.getElementById("agent-name") as HTMLInputElement;
    name.value = "Stuck";
    name.dispatchEvent(new Event("input"));
    shell()
      .querySelector<HTMLButtonElement>("#agent-form .actionlink.primary")!
      .click();
    await vi.waitFor(() =>
      expect(
        calls.some((c) => c.method === "POST" && c.path === "/api/agents"),
      ).toBe(true),
    );
    expect(calls.find((c) => c.method === "POST")!.body).toMatchObject({
      report: "stuck_work",
      options: { olderThanDays: 10 },
    });
  });

  it("highlights rows in a note's table, says why, and compares the totals with the last report", async () => {
    const { reportTable } = await import("/agent-notes.js");
    const { loadStrings } = await import("/strings.js");
    stub({ permissions: [] });
    await loadStrings();
    const node = reportTable({
      report: "stuck_work",
      columns: [
        { key: "stage", label: "agents.col.stage", kind: "text" },
        { key: "open", label: "agents.col.open", kind: "count" },
      ],
      rows: [
        { stage: "Approval", open: 4, _highlight: 1 },
        { stage: "Coding", open: 1 },
      ],
      totals: [{ currency: null, total: null, count: 5 }],
      previous: [{ currency: null, total: null, count: 3 }],
      options: { olderThanDays: 5 },
      skippedOrgs: [],
      asAt: "2026-10-05T07:00:00Z",
    });
    const rows = [...node.querySelectorAll("tbody tr")];
    expect(rows[0].classList.contains("agenthighlight")).toBe(true);
    expect(rows[1].classList.contains("agenthighlight")).toBe(false);
    expect(node.textContent).toContain("Highlighted: open 10 days or more.");
    expect(node.textContent).toContain("up 2 since the last report");
  });
});

describe("plain words — decision 0625", () => {
  const understood = {
    text: "Every Monday at 8am send me and Maya outstanding payables over 1,000 for Acme UK by email, and accounts@kestrel.co.uk",
    draft: {
      name: "Weekly payables",
      report: "outstanding_payables",
      orgIds: ["acme-uk"],
      schedule: { every: "week", time: "08:00", weekday: 1 },
      options: { minTotal: 1000, highlightDays: 60 },
      deliver: { task: false, email: true },
      recipients: ["u-maya"],
    },
    refusals: [{ code: "outside_address", words: "accounts@kestrel.co.uk" }],
    missing: [],
  };

  async function describeAndUnderstand(reply: [number, unknown]) {
    const calls = await openAgents({
      permissions: ["AP.Agents"],
      agents: [],
      understandReply: reply,
    });
    button("New agent")!.click();
    const box = document.getElementById(
      "agent-describe",
    ) as HTMLTextAreaElement;
    box.value = understood.text;
    box.dispatchEvent(new Event("input"));
    button("Understand")!.click();
    await vi.waitFor(() =>
      expect(calls.some((c) => c.path === "/api/agents/understand")).toBe(true),
    );
    return calls;
  }

  it("fills the plan from plain words, says it in words, and says what was left out", async () => {
    const calls = await describeAndUnderstand([200, understood]);
    expect(
      calls.find((c) => c.path === "/api/agents/understand")!.body,
    ).toEqual({ text: understood.text });
    await vi.waitFor(() =>
      expect(document.getElementById("agent-plan")?.hidden).toBe(false),
    );
    const rows = Object.fromEntries(
      [...document.querySelectorAll("#agent-plan .agentplanrow")].map((r) => [
        r.getAttribute("data-step"),
        r.textContent,
      ]),
    );
    expect(rows.when).toBe("WhenEvery Monday at 08:00 (Europe/London)");
    expect(rows.gather).toBe("ReportOutstanding payables · Acme UK");
    expect(rows.shape).toContain("only suppliers owing at least");
    expect(rows.shape).toContain("highlighted past 60 days");
    expect(rows.deliver).toBe("DeliveredBy email, to you and Maya");
    expect(document.getElementById("agent-refusals")?.textContent).toBe(
      "Left out \u201caccounts@kestrel.co.uk\u201d: agents go only to people in VibeFinance.",
    );
    // Edit steps holds the same, closed while nothing is missing.
    expect(
      (document.getElementById("agent-steps") as HTMLDetailsElement).open,
    ).toBe(false);
    expect(
      (document.getElementById("agent-name") as HTMLInputElement).value,
    ).toBe("Weekly payables");
    shell()
      .querySelector<HTMLButtonElement>(
        "#agent-form .cardhead .actionlink.primary",
      )!
      .click();
    await vi.waitFor(() =>
      expect(
        calls.some((c) => c.method === "POST" && c.path === "/api/agents"),
      ).toBe(true),
    );
    expect(
      calls.find((c) => c.method === "POST" && c.path === "/api/agents")!.body,
    ).toMatchObject({
      description: understood.text,
      report: "outstanding_payables",
      orgIds: ["acme-uk"],
      options: { minTotal: 1000, highlightDays: 60 },
      deliver: { task: false, email: true },
      recipients: ["u-maya"],
    });
  });

  it("opens Edit steps and says what is missing", async () => {
    await describeAndUnderstand([
      200,
      {
        ...understood,
        draft: { ...understood.draft, schedule: null },
        refusals: [],
        missing: ["schedule"],
      },
    ]);
    await vi.waitFor(() =>
      expect(document.getElementById("agent-plan")?.hidden).toBe(false),
    );
    expect(
      document.querySelector('#agent-plan [data-step="when"]')?.textContent,
    ).toContain("Not understood yet: say when in Edit steps.");
    expect(
      (document.getElementById("agent-steps") as HTMLDetailsElement).open,
    ).toBe(true);
  });

  it("says when the AI cannot be reached, and leaves the form to be filled by hand", async () => {
    await describeAndUnderstand([503, { reason: "ai_unavailable" }]);
    await vi.waitFor(() =>
      expect(document.getElementById("agents-note")?.textContent).toBe(
        "The AI could not be reached just now. Try again, or use Edit steps.",
      ),
    );
    expect(document.getElementById("agent-plan")?.hidden).toBe(true);
  });
});

describe("the AI summary — decision 0626", () => {
  it("is on for a new agent, said in the plan, can be turned off, and today's count is shown", async () => {
    const calls = await openAgents({
      permissions: ["AP.Agents"],
      agents: [],
      understandReply: [
        200,
        {
          text: "Every Monday at 8am, outstanding payables for Acme UK",
          draft: {
            name: "Weekly",
            report: "outstanding_payables",
            orgIds: ["acme-uk"],
            schedule: { every: "week", time: "08:00", weekday: 1 },
            options: { highlightDays: 60 },
            deliver: { task: true, email: false },
            recipients: [],
            summary: true,
          },
          refusals: [],
          missing: [],
        },
      ],
    });
    expect(document.getElementById("agents-summaries")?.textContent).toBe(
      "AI summaries today: 3 of 100. Past that, reports go without one.",
    );
    button("New agent")!.click();
    const box = document.getElementById("agent-summary") as HTMLInputElement;
    expect(box.checked).toBe(true);
    const describe = document.getElementById(
      "agent-describe",
    ) as HTMLTextAreaElement;
    describe.value = "Every Monday at 8am, outstanding payables for Acme UK";
    describe.dispatchEvent(new Event("input"));
    button("Understand")!.click();
    await vi.waitFor(() =>
      expect(
        document.querySelector('#agent-plan [data-step="summarise"]')
          ?.textContent,
      ).toBe(
        "SummaryA few sentences by AI on top, every number checked against the table",
      ),
    );
    const off = document.getElementById("agent-summary") as HTMLInputElement;
    off.checked = false;
    off.dispatchEvent(new Event("change"));
    expect(
      document.querySelector('#agent-plan [data-step="summarise"]')
        ?.textContent,
    ).toBe("SummaryNo summary, the table only");
    shell()
      .querySelector<HTMLButtonElement>(
        "#agent-form .cardhead .actionlink.primary",
      )!
      .click();
    await vi.waitFor(() =>
      expect(
        calls.some((c) => c.method === "POST" && c.path === "/api/agents"),
      ).toBe(true),
    );
    expect(
      calls.find((c) => c.method === "POST" && c.path === "/api/agents")!.body,
    ).toMatchObject({ summary: false });
  });

  it("says where AI is not set up", async () => {
    await openAgents({
      permissions: ["AP.Agents"],
      agents: [],
      aiReady: false,
    });
    button("New agent")!.click();
    expect(
      document.getElementById("agent-summary")?.closest(".field, label, div")
        ?.parentElement?.textContent,
    ).toContain("AI is not set up here, so reports go without a summary.");
  });

  it("says what became of the summaries in a run, once per kind, and nothing when off", async () => {
    const { summaryWords } = await import("/agents.js");
    const { loadStrings } = await import("/strings.js");
    stub({ permissions: [] });
    await loadStrings();
    expect(
      summaryWords([
        { summary: "written" },
        { summary: "written" },
        { summary: "mismatch" },
      ]),
    ).toBe("summary written · no summary: a number did not match the table");
    expect(summaryWords([{ summary: "off" }, { summary: null }])).toBe("");
  });

  it("puts the summary on top of a note's table, marked as the AI's", async () => {
    const { reportTable } = await import("/agent-notes.js");
    const { loadStrings } = await import("/strings.js");
    stub({ permissions: [] });
    await loadStrings();
    const node = reportTable({
      report: "stuck_work",
      columns: [{ key: "stage", label: "agents.col.stage", kind: "text" }],
      rows: [{ stage: "Approval" }],
      totals: [],
      skippedOrgs: [],
      asAt: "2026-10-05T07:00:00Z",
      summary: "1 task is stuck at Approval.",
    });
    const box = node.querySelector("#agent-note-summary")!;
    expect(box.textContent).toBe(
      "Summary, written by AI from the table below1 task is stuck at Approval.",
    );
    expect(
      reportTable({
        report: "stuck_work",
        columns: [],
        rows: [],
        totals: [],
        skippedOrgs: [],
        asAt: "2026-10-05T07:00:00Z",
      }).querySelector("#agent-note-summary"),
    ).toBeNull();
  });
});

describe("the agent's own page and the agent log — decision 0627", () => {
  const RUNS = [
    {
      id: "run-2",
      trigger: "schedule",
      startedAt: "2026-10-05T07:00:00.000Z",
      status: "delivered",
      late: false,
      rowCount: 2,
      totals: [{ currency: "GBP", total: 120, count: 1 }],
      error: null,
      planVersion: 2,
      deliveries: [
        {
          userName: "Dan",
          channel: "task",
          status: "sent",
          error: null,
          summary: "written",
        },
        {
          userName: "Maya",
          channel: "email",
          status: "failed",
          error: "no_email_address",
          summary: "written",
        },
      ],
    },
    {
      id: "run-1",
      trigger: "now",
      startedAt: "2026-10-03T12:00:00.000Z",
      status: "delivered",
      late: false,
      rowCount: 1,
      totals: [],
      error: null,
      planVersion: 1,
      deliveries: [
        {
          userName: "Dan",
          channel: "task",
          status: "sent",
          error: null,
          summary: null,
        },
      ],
    },
  ];
  const plan = (time: string) => ({
    report: "outstanding_payables",
    orgIds: ["acme-uk"],
    schedule: { every: "week", time, weekday: 1 },
    options: { highlightDays: 60 },
    deliver: { task: true, email: true },
    recipients: ["u-maya"],
    orgs: [{ id: "acme-uk", name: "Acme UK" }],
    people: [{ id: "u-maya", name: "Maya" }],
  });
  const PAGE = {
    agent: { ...AGENT, planVersion: 2 },
    versions: [
      {
        version: 2,
        description: null,
        createdAt: "2026-10-03T12:02:00.000Z",
        createdBy: "Dan",
        plan: plan("09:00"),
      },
      {
        version: 1,
        description: "Every Monday at 8am, payables for UK",
        createdAt: "2026-10-03T12:00:00.000Z",
        createdBy: "Dan",
        plan: plan("08:00"),
      },
    ],
    recipients: [
      {
        id: "u-dan",
        name: "Dan",
        author: true,
        addedAt: "2026-10-03T12:00:00.000Z",
        optedOutAt: null,
      },
      {
        id: "u-maya",
        name: "Maya",
        author: false,
        addedAt: "2026-10-03T12:00:00.000Z",
        optedOutAt: "2026-10-04T09:00:00.000Z",
      },
    ],
    events: [
      {
        id: "e2",
        agentId: "agt-1",
        agentName: "Weekly payables",
        at: "2026-10-04T09:00:00.000Z",
        by: { id: "u-maya", name: "Maya" },
        kind: "stopped_receiving",
        detail: {},
      },
      {
        id: "e1",
        agentId: "agt-1",
        agentName: "Weekly payables",
        at: "2026-10-03T12:00:00.000Z",
        by: { id: "u-dan", name: "Dan" },
        kind: "created",
        detail: { version: 1 },
      },
    ],
  };

  it("opens from the agent's name: runs step by step, plan versions and what changed, who gets it, what was changed", async () => {
    await openAgents({ permissions: ["AP.Agents"], page: PAGE, runs: RUNS });
    shell()
      .querySelector<HTMLButtonElement>('tr[data-agent="agt-1"] .agentopen')!
      .click();
    await vi.waitFor(() =>
      expect(document.getElementById("agent-page")).not.toBeNull(),
    );

    // The latest run, opened.
    const steps = () =>
      [...document.querySelectorAll("#agent-page-run .agentsteps li")].map(
        (li) => li.textContent,
      );
    const latest = steps();
    expect(latest.slice(0, 3)).toEqual([
      `Gathered 2 rows · ${(120).toLocaleString(undefined, { minimumFractionDigits: 2 })} GBP`,
      "summary written",
      "Dan on the task list: sent",
    ]);
    // A failed copy says so, and why.
    expect(latest[3]).toMatch(/^Maya by email: .+ \(no_email_address\)$/);
    expect(latest).toHaveLength(4);
    document
      .querySelector<HTMLButtonElement>('.agentrunpick[data-run="run-1"]')!
      .click();
    expect(steps()).toEqual(["Gathered 1 rows", "Dan on the task list: sent"]);

    const v2 = document.querySelector('.agentversion[data-version="2"]')!;
    expect(v2.classList.contains("current")).toBe(true);
    expect(v2.querySelector(".agentversionchanged")?.textContent).toBe(
      "Changed: When",
    );
    expect(v2.querySelector('[data-step="when"]')?.textContent).toContain(
      "09:00",
    );
    const v1 = document.querySelector('.agentversion[data-version="1"]')!;
    expect(v1.querySelector(".agentversionwords")?.textContent).toBe(
      "\u201cEvery Monday at 8am, payables for UK\u201d",
    );
    expect(v1.querySelector('[data-step="deliver"]')?.textContent).toContain(
      "Maya",
    );

    const people = [...document.querySelectorAll("#agent-page-people li")].map(
      (li) => li.textContent,
    );
    expect(people[0]).toBe("Dan · made it");
    expect(people[1]).toMatch(/^Maya · stopped receiving it /);
    const history = [
      ...document.querySelectorAll("#agent-page-history li"),
    ].map((li) => li.textContent!.split(" · ").slice(1).join(" · "));
    expect(history).toEqual([
      "Maya stopped receiving it",
      "Dan made it (plan v1)",
    ]);

    button("All agents")!.click();
    expect(document.getElementById("agent-page")).toBeNull();
    expect(shell().querySelector('tr[data-agent="agt-1"]')).not.toBeNull();
  });

  it("shows administrators the agent log of every change, by VibeFinance too", async () => {
    const calls = await openAgents({
      permissions: ["Admin.UserManagement"],
      events: [
        {
          id: "e3",
          agentId: "agt-1",
          agentName: "Weekly payables",
          at: "2026-10-05T07:00:00.000Z",
          by: null,
          kind: "paused_access",
          detail: { reason: "author_access" },
        },
      ],
    });
    button("Show the log")!.click();
    await vi.waitFor(() =>
      expect(document.getElementById("agents-log")).not.toBeNull(),
    );
    expect(calls.some((c) => c.path === "/api/agent-events")).toBe(true);
    expect(document.querySelector("#agents-log li")!.textContent).toMatch(
      /Weekly payables: VibeFinance paused it: its author can no longer see its report$/,
    );
  });

  it("puts a failing agent on its author's task list, with the way to it", async () => {
    await signIn({
      permissions: ["AP.TaskView", "AP.Agents"],
      notes: [
        {
          id: "note-9",
          agentId: "agt-1",
          agentName: "Weekly payables",
          report: "outstanding_payables",
          createdAt: "2026-10-05T07:00:00Z",
          late: false,
          rowCount: 1,
          totals: [],
          canStop: false,
          kind: "failure",
          failure: {
            error: "Resend said: domain not verified",
            partial: true,
            times: 2,
            firstAt: "2026-10-05T07:00:00Z",
            lastAt: "2026-10-12T07:00:00Z",
          },
        },
      ],
      page: PAGE,
      runs: RUNS,
    });
    await vi.waitFor(() =>
      expect(
        document.querySelector('.agentnote.failure[data-note="note-9"]'),
      ).not.toBeNull(),
    );
    const note = document.querySelector(
      '.agentnote.failure[data-note="note-9"]',
    )!;
    expect(note.querySelector(".agentnotetag")?.textContent).toBe("Failing");
    expect(note.querySelector(".agentnotewhy")?.textContent).toBe(
      "Some copies could not be sent: Resend said: domain not verified",
    );
    expect(note.textContent).toContain("Failed 2 times since");
    note
      .querySelector<HTMLButtonElement>('.actionlink[title="Open the agent"]')!
      .click();
    await vi.waitFor(() =>
      expect(document.getElementById("agent-page")).not.toBeNull(),
    );
  });
});

describe("ready-made agents — decision 0628", () => {
  it("offers only those whose report the person may use", async () => {
    await openAgents({ permissions: ["AP.Agents"], agents: [] });
    button("Ready-made")!.click();
    const offered = [
      ...document.querySelectorAll("#agents-examples .agentexample"),
    ].map((x) => x.getAttribute("data-example"));
    // Possible duplicates needs fraud review here, which this person lacks.
    expect(offered).toEqual([
      "weekly_payables",
      "stuck_digest",
      "month_end_accruals",
    ]);
    expect(
      document.querySelector('[data-example="weekly_payables"]')!.textContent,
    ).toContain("Every Monday at 8am, outstanding payables by supplier.");
  });

  it("fills a new agent with everything chosen, every organisation, the plan in words, and saves it", async () => {
    const calls = await openAgents({ permissions: ["AP.Agents"], agents: [] });
    button("Ready-made")!.click();
    document
      .querySelector<HTMLButtonElement>(
        '[data-example="weekly_payables"] .actionlink',
      )!
      .click();
    expect(document.getElementById("agents-examples")).toBeNull();
    expect(
      (document.getElementById("agent-name") as HTMLInputElement).value,
    ).toBe("Weekly outstanding payables");
    expect(
      (document.getElementById("agent-describe") as HTMLTextAreaElement).value,
    ).toBe("Every Monday at 8am, outstanding payables by supplier.");
    expect(
      document.querySelector('#agent-plan [data-step="gather"]')?.textContent,
    ).toBe("ReportOutstanding payables · Acme UK, Acme DE");
    expect(
      document.querySelector('#agent-plan [data-step="when"]')?.textContent,
    ).toBe("WhenEvery Monday at 08:00 (Europe/London)");
    shell()
      .querySelector<HTMLButtonElement>(
        "#agent-form .cardhead .actionlink.primary",
      )!
      .click();
    await vi.waitFor(() =>
      expect(
        calls.some((c) => c.method === "POST" && c.path === "/api/agents"),
      ).toBe(true),
    );
    expect(
      calls.find((c) => c.method === "POST" && c.path === "/api/agents")!.body,
    ).toMatchObject({
      name: "Weekly outstanding payables",
      report: "outstanding_payables",
      orgIds: ["acme-uk", "acme-de"],
      schedule: { every: "week", time: "08:00", weekday: 1 },
      options: { highlightDays: 60 },
      deliver: { task: true, email: true },
      recipients: [],
      description: "Every Monday at 8am, outstanding payables by supplier.",
      summary: true,
    });
  });

  it("sends to the task list alone where email is not set up", async () => {
    const calls = await openAgents({
      permissions: ["AP.Agents"],
      agents: [],
      emailReady: false,
    });
    button("Ready-made")!.click();
    document
      .querySelector<HTMLButtonElement>(
        '[data-example="month_end_accruals"] .actionlink',
      )!
      .click();
    shell()
      .querySelector<HTMLButtonElement>(
        "#agent-form .cardhead .actionlink.primary",
      )!
      .click();
    await vi.waitFor(() =>
      expect(
        calls.some((c) => c.method === "POST" && c.path === "/api/agents"),
      ).toBe(true),
    );
    expect(
      calls.find((c) => c.method === "POST" && c.path === "/api/agents")!.body,
    ).toMatchObject({
      report: "accruals",
      orgIds: ["acme-uk"],
      schedule: { every: "month", time: "16:00", day: "lastWorking" },
      deliver: { task: true, email: false },
    });
  });
});
