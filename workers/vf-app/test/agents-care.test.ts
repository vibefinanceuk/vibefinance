import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import {
  handleAgentNoteDone,
  handleCreateAgent,
  handleGetAgent,
  handleListAgentEvents,
  handleListAgentNotes,
  handleRemoveAgent,
  handleRunAgentNow,
  handleStopAgent,
  handleUpdateAgent,
  runDueAgents,
  type AgentDeps,
} from "../src/agents.js";

/**
 * Agents, slice 6: run history and care — decision 0627. Dan makes
 * agents; Maya is an AP Manager in Acme UK; Ada is an administrator.
 */

const MONDAY_8 = { every: "week", time: "08:00", weekday: 1 };
const SATURDAY = new Date("2026-10-03T12:00:00Z");
const MONDAY = new Date("2026-10-05T07:00:00Z");
const NEXT_MONDAY = new Date("2026-10-12T07:00:00Z");
const TUESDAY = new Date("2026-10-13T09:00:00Z");

async function person(id: string, name: string, permissions: string[], unit: string | null) {
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES (?, ?, ?)").bind(id, `${id}@acme.com`, name).run();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)").bind(`r-${id}`, id, JSON.stringify(permissions)).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES (?, ?, ?)").bind(id, `r-${id}`, unit).run();
}

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_units (id, name, kind) VALUES ('acme-uk', 'Acme UK', 'legal_entity'), ('acme-de', 'Acme DE', 'legal_entity')").run();
  await person("dan", "Dan", ["AP.Agents", "AP.Manager", "AP.Analysis"], null);
  await person("maya", "Maya", ["AP.Manager", "AP.Analysis"], "acme-uk");
  await person("ada", "Ada", ["Admin.UserManagement"], null);
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
  await env.DB.prepare("INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('approval', 'ap', 'Approval', 1), ('eligible', 'ap', 'Payment-eligible', 2)").run();
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, org_unit_id, invoice_number, currency, total_with_vat) VALUES ('inv-a', ?, 'acme-uk', 'inv-a', 'GBP', 120)")
    .bind(JSON.stringify({ "BT-1": "inv-a", "BT-9": "2026-09-01", "BT-27": "Kingsway" }))
    .run();
  await env.DB.prepare("INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES ('pi-a', 'ap', 'invoice', 'inv-a', 'eligible', 'completed')").run();
});

const make = async (input: Record<string, unknown> = {}) =>
  ((await handleCreateAgent(env.DB, "dan", { name: "Weekly payables", report: "outstanding_payables", orgIds: ["acme-uk"], schedule: MONDAY_8, ...input }, SATURDAY)).body as { id: string }).id;

const emailing = (ok: boolean): AgentDeps => ({
  email: { apiKey: "re_test", from: "agents@vibefinance-ai.com" },
  appUrl: null,
  bucket: null,
  send: async () => (ok ? { ok: true, messageId: "msg-1" } : { ok: false, error: "Resend said: domain not verified" }),
});

type Note = { id: string; kind: string; canStop: boolean; failure: { error: string; times: number; partial: boolean; firstAt: string; lastAt: string } | null };
const notes = async (user: string) => ((await handleListAgentNotes(env.DB, user)).body as { notes: Note[] }).notes;

describe("the agent log: changes only", () => {
  it("records each change, by whom, on the agent's page and in the log for administrators", async () => {
    const id = await make({ recipients: ["maya"] });
    await handleUpdateAgent(env.DB, "dan", id, { name: "Monday payables" }, SATURDAY);
    await handleUpdateAgent(env.DB, "dan", id, { status: "active" }, new Date("2026-10-03T12:01:00Z"));
    await handleUpdateAgent(env.DB, "dan", id, { schedule: { every: "week", time: "09:00", weekday: 1 } }, new Date("2026-10-03T12:02:00Z"));
    await handleStopAgent(env.DB, "maya", id, new Date("2026-10-03T12:03:00Z"));
    await handleStopAgent(env.DB, "maya", id, new Date("2026-10-03T12:04:00Z"));
    await handleUpdateAgent(env.DB, "dan", id, { status: "paused" }, new Date("2026-10-03T12:05:00Z"));
    await handleRemoveAgent(env.DB, "ada", id, new Date("2026-10-03T12:06:00Z"));

    const page = (await handleGetAgent(env.DB, "dan", id)).body as {
      events: { kind: string; by: { name: string } | null; detail: Record<string, unknown> }[];
      versions: { version: number; plan: { orgs: { name: string }[]; people: { name: string }[]; schedule: { time: string } } }[];
      recipients: { name: string; author: boolean; optedOutAt: string | null }[];
    };
    expect(page.events.map((e) => [e.kind, e.by?.name ?? null, e.detail])).toEqual([
      ["removed", "Ada", { authorId: "dan" }],
      ["paused", "Dan", {}],
      ["stopped_receiving", "Maya", {}],
      ["changed", "Dan", { version: 2, from: 1 }],
      ["started", "Dan", {}],
      ["renamed", "Dan", { from: "Weekly payables", to: "Monday payables" }],
      ["created", "Dan", { version: 1 }],
    ]);
    // Every version of the plan, newest first, with the names it named.
    expect(page.versions.map((v) => [v.version, v.plan.schedule.time, v.plan.orgs.map((o) => o.name), v.plan.people.map((p) => p.name)])).toEqual([
      [2, "09:00", ["Acme UK"], ["Maya"]],
      [1, "08:00", ["Acme UK"], ["Maya"]],
    ]);
    expect(page.recipients).toMatchObject([
      { name: "Dan", author: true, optedOutAt: null },
      { name: "Maya", author: false, optedOutAt: "2026-10-03T12:03:00.000Z" },
    ]);

    // The page is for its author or an administrator; the log for administrators.
    expect((await handleGetAgent(env.DB, "maya", id)).status).toBe(403);
    expect((await handleGetAgent(env.DB, "ada", id)).status).toBe(200);
    expect((await handleListAgentEvents(env.DB, "dan")).status).toBe(403);
    const log = (await handleListAgentEvents(env.DB, "ada")).body as { events: { agentName: string; kind: string }[] };
    expect(log.events).toHaveLength(7);
    expect(log.events[0]).toMatchObject({ agentName: "Monday payables", kind: "removed" });
  });

  it("says when VibeFinance paused it because its author lost access", async () => {
    const id = await make();
    await handleUpdateAgent(env.DB, "dan", id, { status: "active" }, SATURDAY);
    await env.DB.prepare("UPDATE org_roles SET permissions_json = '[\"AP.Manager\"]' WHERE id = 'r-dan'").run();
    await runDueAgents(env.DB, MONDAY);
    const page = (await handleGetAgent(env.DB, "ada", id)).body as { events: { kind: string; by: unknown; detail: unknown }[] };
    expect(page.events[0]).toEqual(expect.objectContaining({ kind: "paused_access", by: null, detail: { reason: "author_access" } }));
    // And the author is told, on their task list.
    expect((await notes("dan")).map((n) => [n.kind, n.failure?.error])).toEqual([["failure", "author_access"]]);
  });
});

describe("a failing agent is a task for its author", () => {
  it("one note while it keeps failing, how many times, done by itself when a run succeeds", async () => {
    const id = await make({ deliver: { task: false, email: true } });
    await handleUpdateAgent(env.DB, "dan", id, { status: "active" }, SATURDAY);

    await runDueAgents(env.DB, MONDAY, emailing(false));
    let mine = await notes("dan");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ kind: "failure", canStop: false, failure: { error: "Resend said: domain not verified", times: 1, partial: false } });

    await runDueAgents(env.DB, NEXT_MONDAY, emailing(false));
    mine = await notes("dan");
    expect(mine).toHaveLength(1);
    expect(mine[0].failure).toMatchObject({ times: 2, firstAt: MONDAY.toISOString(), lastAt: NEXT_MONDAY.toISOString() });

    // Run now failing again adds nothing; succeeding marks it done.
    await handleRunAgentNow(env.DB, "dan", id, TUESDAY, emailing(false));
    expect((await notes("dan"))[0].failure?.times).toBe(2);
    await handleRunAgentNow(env.DB, "dan", id, TUESDAY, emailing(true));
    expect(await notes("dan")).toEqual([]);
  });

  it("is told when some copies failed though others went, and can be marked done by hand", async () => {
    const id = await make({ deliver: { task: true, email: true } });
    await handleUpdateAgent(env.DB, "dan", id, { status: "active" }, SATURDAY);
    await runDueAgents(env.DB, MONDAY, emailing(false));
    const mine = await notes("dan");
    const failure = mine.find((n) => n.kind === "failure")!;
    expect(failure.failure).toMatchObject({ partial: true, error: "Resend said: domain not verified" });
    expect(mine.filter((n) => n.kind === "report")).toHaveLength(1);
    await handleAgentNoteDone(env.DB, "dan", failure.id, TUESDAY);
    expect((await notes("dan")).map((n) => n.kind)).toEqual(["report"]);
  });
});
