import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleConfirmExample, handleListExamples } from "../src/examples-route.js";

async function seedRuleWithExamples(): Promise<{ ruleId: string; exampleIds: string[] }> {
  await env.DB.prepare("INSERT INTO rule_sets (id, name, mode, status) VALUES (?, ?, ?, ?)")
    .bind("rs1", "test set", "first_match", "draft")
    .run();
  const ruleId = "rule-1";
  await env.DB.prepare("INSERT INTO rules (id, rule_set_id, sort_order, enabled) VALUES (?, ?, ?, 1)")
    .bind(ruleId, "rs1", 0)
    .run();
  await env.DB.prepare(
    "INSERT INTO rule_versions (rule_id, version, source_text, compiled_json, compiled_by) VALUES (?, 1, ?, ?, ?)"
  )
    .bind(ruleId, "test source", "{}", "test-model")
    .run();
  const exampleIds = ["ex-1", "ex-2"];
  await env.DB.prepare(
    "INSERT INTO rule_examples (id, rule_id, rule_version, invoice_json, expect_match) VALUES (?, ?, 1, ?, 1)"
  )
    .bind(exampleIds[0], ruleId, '{"BT-3":"380"}')
    .run();
  await env.DB.prepare(
    "INSERT INTO rule_examples (id, rule_id, rule_version, invoice_json, expect_match) VALUES (?, ?, 1, ?, 0)"
  )
    .bind(exampleIds[1], ruleId, '{"BT-3":"381"}')
    .run();
  return { ruleId, exampleIds };
}

beforeEach(async () => {
  await applyTestSchema();
});

describe("handleListExamples", () => {
  it("lists both examples with their claimed expectMatch and unconfirmed state", async () => {
    const { ruleId } = await seedRuleWithExamples();
    const result = await handleListExamples(env.DB, ruleId, 1);
    expect(result.status).toBe(200);
    const body = result.body as { examples: unknown[] };
    expect(body.examples).toEqual([
      { id: "ex-1", invoice: { "BT-3": "380" }, expectMatch: true, confirmedBy: null },
      { id: "ex-2", invoice: { "BT-3": "381" }, expectMatch: false, confirmedBy: null },
    ]);
  });

  it("returns an empty list for a rule version with no examples", async () => {
    const result = await handleListExamples(env.DB, "does-not-exist", 1);
    expect(result.status).toBe(200);
    expect((result.body as { examples: unknown[] }).examples).toEqual([]);
  });
});

describe("handleConfirmExample", () => {
  it("400s when confirmedBy is missing", async () => {
    const { exampleIds } = await seedRuleWithExamples();
    const result = await handleConfirmExample(env.DB, exampleIds[0], undefined);
    expect(result.status).toBe(400);
  });

  it("404s for an example that doesn't exist", async () => {
    const result = await handleConfirmExample(env.DB, "does-not-exist", "alice@example.com");
    expect(result.status).toBe(404);
  });

  it("confirms an example, persisted in real D1", async () => {
    const { exampleIds } = await seedRuleWithExamples();
    const result = await handleConfirmExample(env.DB, exampleIds[0], "alice@example.com");
    expect(result.status).toBe(200);

    const row = await env.DB.prepare("SELECT confirmed_by FROM rule_examples WHERE id = ?")
      .bind(exampleIds[0])
      .first();
    expect(row).toEqual({ confirmed_by: "alice@example.com" });
  });

  it("confirming one example does not affect another", async () => {
    const { exampleIds } = await seedRuleWithExamples();
    await handleConfirmExample(env.DB, exampleIds[0], "alice@example.com");

    const other = await env.DB.prepare("SELECT confirmed_by FROM rule_examples WHERE id = ?")
      .bind(exampleIds[1])
      .first();
    expect(other).toEqual({ confirmed_by: null });
  });
});
