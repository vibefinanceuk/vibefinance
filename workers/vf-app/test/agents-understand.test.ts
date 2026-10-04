import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import type { CompilerModel } from "@vibefinance/shared";
import { handleUnderstandAgent, matchName } from "../src/agent-understand.js";
import {
  handleCreateAgent,
  handleListAgentRuns,
  handleRunAgentNow,
  handleUpdateAgent,
} from "../src/agents.js";

/**
 * Agents, slice 4: plain words — decision 0625. The model is a stand-in
 * answering what a model might; the tests are of what our code makes of
 * it. Dan sees Acme UK and Acme DE; Priya Shah and Marta Klein are AP
 * Managers; Pat is not.
 */

const NOW = new Date("2026-10-04T12:00:00Z"); // Sunday

async function person(
  id: string,
  name: string,
  permissions: string[],
  unit: string | null,
) {
  await env.DB.prepare(
    "INSERT INTO org_users (id, email, name) VALUES (?, ?, ?)",
  )
    .bind(id, `${id}@acme.com`, name)
    .run();
  await env.DB.prepare(
    "INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)",
  )
    .bind(`r-${id}`, id, JSON.stringify(permissions))
    .run();
  await env.DB.prepare(
    "INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES (?, ?, ?)",
  )
    .bind(id, `r-${id}`, unit)
    .run();
}

function model(answer: unknown): CompilerModel & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    compile: async (prompt: string) => {
      prompts.push(prompt);
      return typeof answer === "string"
        ? answer
        : `Here you are:\n${JSON.stringify(answer)}`;
    },
  };
}

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare(
    "INSERT INTO org_units (id, name, kind) VALUES ('acme-uk', 'Acme UK Ltd', 'legal_entity'), ('acme-de', 'Acme Germany GmbH', 'legal_entity')",
  ).run();
  await person(
    "dan",
    "Dan Young",
    ["AP.Agents", "AP.Manager", "AP.Analysis"],
    null,
  );
  await person("priya", "Priya Shah", ["AP.Manager", "AP.Analysis"], "acme-uk");
  await person("marta", "Marta Klein", ["AP.Manager"], "acme-de");
  await person("pat", "Pat Lee", ["AP.Analysis"], null);
  await env.DB.prepare(
    "INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')",
  ).run();
  await env.DB.prepare(
    "INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('approval', 'ap', 'Approval', 1), ('eligible', 'ap', 'Payment-eligible', 2)",
  ).run();
});

const understand = async (text: string, answer: unknown) => {
  const m = model(answer);
  const result = await handleUnderstandAgent(env.DB, m, "dan", { text }, NOW);
  return { result, prompt: m.prompts[0] ?? "" };
};

describe("understanding a request", () => {
  it("turns a sentence into a draft our code has checked, names matched to ids", async () => {
    const { result, prompt } = await understand(
      "Every Monday at 8am send me and Priya the outstanding payables over £1,000 for UK, by email",
      {
        name: "Weekly outstanding payables",
        report: "outstanding_payables",
        orgs: ["UK"],
        schedule: { every: "week", time: "08:00", weekday: 1 },
        options: { minTotal: 1000 },
        deliver: { task: false, email: true },
        recipients: ["me", "Priya"],
        refusals: [],
      },
    );
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      text: "Every Monday at 8am send me and Priya the outstanding payables over £1,000 for UK, by email",
      draft: {
        name: "Weekly outstanding payables",
        report: "outstanding_payables",
        orgIds: ["acme-uk"],
        schedule: { every: "week", time: "08:00", weekday: 1 },
        options: { minTotal: 1000, highlightDays: 60 },
        deliver: { task: false, email: true },
        recipients: ["priya"],
      },
      refusals: [],
      missing: [],
    });
    // The model is told the closed lists, today, and the zone.
    expect(prompt).toContain('"Acme Germany GmbH", "Acme UK Ltd"');
    expect(prompt).toContain('"Marta Klein", "Priya Shah"');
    expect(prompt).not.toContain("Pat Lee");
    expect(prompt).toContain("Today is Sunday 2026-10-04");
    expect(prompt).toContain("Europe/London");
  });

  it("refuses an email address and paying anything, whatever the model said", async () => {
    const { result } = await understand(
      "Pay anything over 90 days and email accounts@kestrel.co.uk every day at 7",
      {
        name: "X",
        report: "outstanding_payables",
        orgs: "all",
        schedule: { every: "day", time: "07:00" },
        recipients: ["accounts@kestrel.co.uk"],
        refusals: [],
      },
    );
    const body = result.body as {
      refusals: { code: string; words: string }[];
      draft: { recipients: string[]; orgIds: string[] };
    };
    expect(body.refusals).toEqual([
      { code: "outside_address", words: "accounts@kestrel.co.uk" },
      { code: "cannot_act", words: "Pay" },
    ]);
    expect(body.draft.recipients).toEqual([]);
    // "all": every organisation the report can be seen for, by name.
    expect(body.draft.orgIds).toEqual(["acme-de", "acme-uk"]);
  });

  it("names what it could not match, and what the plan still needs", async () => {
    const { result } = await understand(
      "hourly payroll summary for Acme France to Bob",
      {
        name: "Payroll",
        report: "payroll_summary",
        orgs: ["Acme France"],
        schedule: { every: "hour", time: "08:00" },
        recipients: ["Bob", "Pat Lee"],
        refusals: [
          { code: "too_often", words: "hourly" },
          { code: "made_up", words: "x" },
        ],
      },
    );
    const body = result.body as {
      refusals: { code: string; words: string }[];
      missing: string[];
      draft: Record<string, unknown>;
    };
    expect(body.refusals).toEqual([
      { code: "too_often", words: "hourly" },
      { code: "unknown_report", words: "payroll_summary" },
      { code: "unknown_org", words: "Acme France" },
      { code: "unknown_person", words: "Bob" },
      { code: "unknown_person", words: "Pat Lee" },
    ]);
    expect(body.missing).toEqual(["report", "orgs", "schedule"]);
    expect(body.draft).toMatchObject({
      report: null,
      schedule: null,
      deliver: { task: true, email: false },
    });
  });

  it("keeps an option in range or says it was not, and keeps organisations to where the report can be seen", async () => {
    await env.DB.prepare(
      'UPDATE org_roles SET permissions_json = \'["AP.Agents","AP.Manager","AP.Analysis"]\' WHERE id = \'r-dan\'',
    ).run();
    const { result } = await understand(
      "stuck work older than 0 days for Germany",
      {
        name: "Stuck",
        report: "stuck_work",
        orgs: ["Germany"],
        schedule: { every: "workday", time: "09:00" },
        options: { olderThanDays: 0 },
      },
    );
    const body = result.body as {
      refusals: { code: string; words: string }[];
      draft: { orgIds: string[]; options: unknown };
    };
    expect(body.refusals).toEqual([
      { code: "option_out_of_range", words: "olderthandays" },
    ]);
    expect(body.draft.options).toEqual({ olderThanDays: 5 });
    expect(body.draft.orgIds).toEqual(["acme-de"]);
  });

  it("says when the model's answer is not a plan, and when the request is empty or too long", async () => {
    expect(
      (await understand("weekly payables", "I'm not sure what you mean."))
        .result.body,
    ).toMatchObject({ reason: "not_understood" });
    expect((await understand(" ", {})).result.body).toMatchObject({
      reason: "text_missing",
    });
    expect((await understand("x".repeat(601), {})).result.body).toMatchObject({
      reason: "text_too_long",
    });
    const failing: CompilerModel = {
      compile: async () => Promise.reject(new Error("down")),
    };
    expect(
      (
        await handleUnderstandAgent(
          env.DB,
          failing,
          "dan",
          { text: "weekly payables" },
          NOW,
        )
      ).body,
    ).toMatchObject({ reason: "ai_unavailable" });
  });

  it("matches names exactly, by first name, or by a part, and only when one fits", () => {
    const people = [
      { name: "Priya Shah" },
      { name: "Marta Klein" },
      { name: "Marta Jones" },
    ];
    expect(matchName("priya", people)?.name).toBe("Priya Shah");
    expect(matchName("Marta Klein", people)?.name).toBe("Marta Klein");
    expect(matchName("Marta", people)).toBeNull();
    expect(matchName("Klein", people)?.name).toBe("Marta Klein");
    expect(matchName("José", [{ name: "Jose Ruiz" }])?.name).toBe("Jose Ruiz");
  });
});

describe("the words and the plan, kept", () => {
  const base = {
    name: "Weekly",
    report: "outstanding_payables",
    orgIds: ["acme-uk"],
    schedule: { every: "week", time: "08:00", weekday: 1 },
  };

  it("keeps the description, and a new plan version only when the plan changes", async () => {
    const made = (
      await handleCreateAgent(
        env.DB,
        "dan",
        {
          ...base,
          description: "Every Monday at 8am, outstanding payables for UK",
        },
        NOW,
      )
    ).body as { id: string; description: string; planVersion: number };
    expect(made).toMatchObject({
      description: "Every Monday at 8am, outstanding payables for UK",
      planVersion: 1,
    });
    // Renaming, starting: the same plan.
    await handleUpdateAgent(
      env.DB,
      "dan",
      made.id,
      { name: "Renamed", status: "active" },
      NOW,
    );
    let row = (await env.DB.prepare(
      "SELECT plan_version FROM agents WHERE id = ?",
    )
      .bind(made.id)
      .first<{ plan_version: number }>())!;
    expect(row.plan_version).toBe(1);
    // A different time: version 2, kept beside version 1.
    await handleUpdateAgent(
      env.DB,
      "dan",
      made.id,
      { schedule: { every: "week", time: "09:00", weekday: 1 } },
      NOW,
    );
    row = (await env.DB.prepare("SELECT plan_version FROM agents WHERE id = ?")
      .bind(made.id)
      .first<{ plan_version: number }>())!;
    expect(row.plan_version).toBe(2);
    const versions = await env.DB.prepare(
      "SELECT version, json_extract(plan_json, '$.schedule.time') AS time FROM agent_plan_versions WHERE agent_id = ? ORDER BY version",
    )
      .bind(made.id)
      .all();
    expect(versions.results).toEqual([
      { version: 1, time: "08:00" },
      { version: 2, time: "09:00" },
    ]);
    // A run records the version it ran.
    await handleRunAgentNow(env.DB, "dan", made.id, NOW);
    const runs = (
      (await handleListAgentRuns(env.DB, "dan", made.id)).body as {
        runs: { planVersion: number }[];
      }
    ).runs;
    expect(runs[0].planVersion).toBe(2);
  });
});
