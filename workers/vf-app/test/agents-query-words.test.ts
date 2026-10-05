import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import type { CompilerModel } from "@vibefinance/shared";
import { handleUnderstandAgent } from "../src/agent-understand.js";
import { handleCreateAgent, handleListAgents } from "../src/agents.js";

/**
 * Agents ask the data, slice 2: plain words write the question — decision
 * 0634. The model is a stand-in answering what a model might; the tests
 * are of what our code makes of it. Dan sees Acme UK and Acme GmbH; Uma
 * only the UK; Ned may make agents but analyse nothing.
 */

const NOW = new Date("2026-10-05T11:00:00Z"); // Monday

async function person(id: string, name: string, permissions: string[], unit: string | null) {
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES (?, ?, ?)").bind(id, `${id}@acme.com`, name).run();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)").bind(`r-${id}`, id, JSON.stringify(permissions)).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES (?, ?, ?)").bind(id, `r-${id}`, unit).run();
}

function model(answer: unknown): CompilerModel & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    compile: async (prompt: string) => {
      prompts.push(prompt);
      return `Here you are:\n${JSON.stringify(answer)}`;
    },
  };
}

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_units (id, name, kind) VALUES ('acme-uk', 'Acme UK Ltd', 'legal_entity'), ('acme-de', 'Acme GmbH', 'legal_entity')").run();
  await person("dan", "Dan Young", ["AP.Agents", "AP.Manager", "AP.Analysis"], null);
  await person("uma", "Uma Becker", ["AP.Agents", "AP.Manager", "AP.Analysis"], "acme-uk");
  await person("ned", "Ned", ["AP.Agents"], null);
});

const MONDAY_WORDS = "Every Monday at 12.10pm, check for invoices over £100,000 and email";

/** What a model might answer for Dan's Monday words. */
const MONDAY_ANSWER = {
  name: "Invoices over £100,000",
  report: "query",
  query: {
    dataset: "invoices",
    where: [
      { field: "total", op: "over", value: 100000, currency: "GBP" },
      { field: "status", op: "is", value: "in_progress" },
    ],
    show: ["supplier", "invoice", "total", "stage", "daysAtStage"],
    sort: [{ key: "total", dir: "desc" }],
  },
  assumed: ["status", "sort"],
  orgs: "all",
  schedule: { every: "week", time: "12:10", weekday: 1 },
  deliver: { task: false, email: true },
  recipients: [],
  summary: true,
  refusals: [],
};

type Understood = {
  draft: { report: string | null; orgIds: string[]; options: { query?: Record<string, unknown> }; schedule: unknown };
  refusals: { code: string; words: string }[];
  missing: string[];
  assumed: string[];
};

describe("plain words write a question", () => {
  it("asks exactly what was said, and marks what was not said as usual", async () => {
    const m = model(MONDAY_ANSWER);
    const r = await handleUnderstandAgent(env.DB, m, "dan", { text: MONDAY_WORDS }, NOW);
    expect(r.status).toBe(200);
    const body = r.body as Understood;
    expect(body.draft.report).toBe("query");
    expect(body.draft.orgIds.sort()).toEqual(["acme-de", "acme-uk"]);
    expect(body.draft.options.query).toMatchObject({
      dataset: "invoices",
      where: [
        { field: "total", op: "over", value: 100000, currency: "GBP" },
        { field: "status", op: "is", value: "in_progress" },
      ],
      show: ["supplier", "invoice", "total", "currency", "stage", "daysAtStage"],
      since: "all",
      limit: 100,
    });
    expect(body.assumed.sort()).toEqual(["limit", "since", "sort", "where:status"]);
    expect(body.missing).toEqual([]);
    expect(body.refusals).toEqual([]);

    // The model was shown what may be asked, and told never to approximate.
    expect(m.prompts[0]).toContain('Dataset "invoices"');
    expect(m.prompts[0]).toContain("total (money): the total including VAT");
    expect(m.prompts[0]).toContain("Never approximate.");

    // Saved as drafted, it is an agent with that question.
    const made = await handleCreateAgent(env.DB, "dan", { name: "Over £100,000", report: "query", orgIds: body.draft.orgIds, schedule: body.draft.schedule, options: body.draft.options, deliver: { task: true, email: false } }, NOW);
    expect(made.status).toBe(201);
  });

  it("refuses a question it cannot ask, in words, rather than guessing", async () => {
    const r = await handleUnderstandAgent(
      env.DB,
      model({ ...MONDAY_ANSWER, query: { dataset: "invoices", where: [{ field: "paymentMethod", op: "is", value: "card" }], show: ["invoice"] } }),
      "dan",
      { text: "invoices paid by card" },
      NOW,
    );
    const body = r.body as Understood;
    expect(body.draft.report).toBeNull();
    expect(body.missing).toContain("report");
    expect(body.refusals).toContainEqual({ code: "cannot_ask", words: "paymentMethod" });

    const noCurrency = await handleUnderstandAgent(
      env.DB,
      model({ ...MONDAY_ANSWER, query: { dataset: "invoices", where: [{ field: "total", op: "over", value: 100000 }], show: ["invoice"] } }),
      "dan",
      { text: "invoices over 100,000" },
      NOW,
    );
    // Decision 0635: an amount with no currency at all is unclear, said by what it means, after one retry.
    expect((noCurrency.body as Understood).refusals).toContainEqual({ code: "question_unclear", words: "the total including VAT" });
  });

  it("reads an amount however the model wrote it, when its currency is plain", async () => {
    for (const filter of [
      { field: "total", op: "over", value: "£100,000" },
      { field: "total", op: "over", value: { amount: 100000, currency: "GBP" } },
      { field: "total", op: "over", value: "100k", currency: "£" },
      { field: "total", op: "over", value: "100000 GBP" },
    ]) {
      const r = await handleUnderstandAgent(env.DB, model({ ...MONDAY_ANSWER, query: { ...MONDAY_ANSWER.query, where: [filter] } }), "dan", { text: MONDAY_WORDS }, NOW);
      const body = r.body as Understood;
      expect(body.refusals).toEqual([]);
      expect(body.draft.options.query?.where).toEqual([{ field: "total", op: "over", value: 100000, currency: "GBP" }]);
    }
  });

  it("sends a refused question back once, with why, and uses the answer put right", async () => {
    const answers = [
      { ...MONDAY_ANSWER, query: { ...MONDAY_ANSWER.query, where: [{ field: "amount", op: "over", value: 100000, currency: "GBP" }] } },
      MONDAY_ANSWER,
    ];
    const prompts: string[] = [];
    const m: CompilerModel = { compile: async (p: string) => (prompts.push(p), JSON.stringify(answers[prompts.length - 1])) };
    const body = (await handleUnderstandAgent(env.DB, m, "dan", { text: MONDAY_WORDS }, NOW)).body as Understood;
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("Its query was refused by the checker: query_field_unknown (amount)");
    expect(body.draft.report).toBe("query");
    expect(body.refusals).toEqual([]);
  });

  it("keeps to the organisations and fields this person may ask about", async () => {
    const uma = (await handleUnderstandAgent(env.DB, model(MONDAY_ANSWER), "uma", { text: MONDAY_WORDS }, NOW)).body as Understood;
    expect(uma.draft.orgIds).toEqual(["acme-uk"]);

    // Ned may make agents but analyse nothing: no question is offered, and none is taken.
    const m = model(MONDAY_ANSWER);
    const ned = (await handleUnderstandAgent(env.DB, m, "ned", { text: MONDAY_WORDS }, NOW)).body as Understood;
    expect(m.prompts[0]).toContain("(none: this person may not ask questions)");
    expect(ned.draft.report).toBeNull();
    expect(ned.refusals).toContainEqual({ code: "cannot_ask", words: "invoices" });

    // A field hidden here is neither shown to the model nor asked about.
    await env.DB.prepare("INSERT INTO field_visibility (field, visibility) VALUES ('BT-27', 'hidden')").run();
    const m2 = model(MONDAY_ANSWER);
    const hidden = (await handleUnderstandAgent(env.DB, m2, "dan", { text: MONDAY_WORDS }, NOW)).body as Understood;
    expect(m2.prompts[0]).not.toContain("supplier (text");
    expect(hidden.draft.report).toBeNull();
    expect(hidden.refusals[0].code).toBe("cannot_ask");
  });

  it("marks a ready-made report's options the words did not give as usual", async () => {
    const r = await handleUnderstandAgent(
      env.DB,
      model({ name: "Payables", report: "outstanding_payables", orgs: "all", schedule: { every: "week", time: "08:00", weekday: 1 }, options: { minTotal: 1000 }, refusals: [{ code: "approximate", words: "per invoice" }] }),
      "dan",
      { text: "Every Monday at 8am, outstanding payables over 1,000 per invoice" },
      NOW,
    );
    const body = r.body as Understood;
    expect(body.assumed).toEqual(["option:highlightDays"]);
    expect(body.refusals).toContainEqual({ code: "approximate", words: "per invoice" });
  });

  it("tells the screen what a question may ask, so the plan can be said in words", async () => {
    const body = (await handleListAgents(env.DB, "dan")).body as { catalogue: { datasets: { id: string; fields: { key: string; words: string }[] }[] } };
    expect(body.catalogue.datasets.map((d) => d.id)).toEqual(["invoices", "tasks", "lines", "coding", "stage_visits", "returns"]); // decision 0637: all an AP.Analysis holder may ask
    expect(body.catalogue.datasets[0].fields.find((f) => f.key === "total")?.words).toBe("the total including VAT");
  });
});
