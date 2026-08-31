import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleActivateRule } from "../src/activate-route.js";
import { handleConfirmExample } from "../src/examples-route.js";

async function seedRuleSet(): Promise<void> {
  await env.DB.prepare("INSERT INTO rule_sets (id, name, mode, status) VALUES (?, ?, ?, ?)")
    .bind("rs1", "test set", "first_match", "draft")
    .run();
}

async function seedRule(ruleId: string): Promise<void> {
  await env.DB.prepare("INSERT INTO rules (id, rule_set_id, sort_order, enabled) VALUES (?, ?, ?, 1)")
    .bind(ruleId, "rs1", 0)
    .run();
  await env.DB.prepare(
    "INSERT INTO rule_versions (rule_id, version, source_text, compiled_json, compiled_by) VALUES (?, 1, ?, ?, ?)"
  )
    .bind(ruleId, "test source", "{}", "test-model")
    .run();
}

async function seedExample(id: string, ruleId: string, expectMatch: boolean): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO rule_examples (id, rule_id, rule_version, invoice_json, expect_match) VALUES (?, ?, 1, ?, ?)"
  )
    .bind(id, ruleId, "{}", expectMatch ? 1 : 0)
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
  await seedRuleSet();
});

describe("handleActivateRule — validation", () => {
  it("400s when activatedBy is missing", async () => {
    const result = await handleActivateRule(env.DB, "rule-1", 1, undefined);
    expect(result.status).toBe(400);
  });

  it("404s when the rule version does not exist", async () => {
    const result = await handleActivateRule(env.DB, "does-not-exist", 1, "alice@example.com");
    expect(result.status).toBe(404);
  });
});

describe("handleActivateRule — the core safety property: activation requires confirmed examples", () => {
  it("refuses when there are zero examples at all", async () => {
    await seedRule("rule-1");
    const result = await handleActivateRule(env.DB, "rule-1", 1, "alice@example.com");
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ error: expect.stringContaining("no worked examples") });

    const row = await env.DB.prepare("SELECT approved_by FROM rule_versions WHERE rule_id = ?")
      .bind("rule-1")
      .first();
    expect(row).toEqual({ approved_by: null });
  });

  it("refuses when at least one example is unconfirmed", async () => {
    await seedRule("rule-1");
    await seedExample("ex-1", "rule-1", true);
    await seedExample("ex-2", "rule-1", false);
    await handleConfirmExample(env.DB, "ex-1", "alice@example.com");
    // ex-2 is still unconfirmed.

    const result = await handleActivateRule(env.DB, "rule-1", 1, "alice@example.com");
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ error: expect.stringContaining("1 of 2") });

    const row = await env.DB.prepare("SELECT approved_by FROM rule_versions WHERE rule_id = ?")
      .bind("rule-1")
      .first();
    expect(row).toEqual({ approved_by: null });
  });

  it("succeeds once every example is confirmed, and writes real D1 state", async () => {
    await seedRule("rule-1");
    await seedExample("ex-1", "rule-1", true);
    await seedExample("ex-2", "rule-1", false);
    await handleConfirmExample(env.DB, "ex-1", "alice@example.com");
    await handleConfirmExample(env.DB, "ex-2", "alice@example.com");

    const result = await handleActivateRule(env.DB, "rule-1", 1, "alice@example.com");
    expect(result.status).toBe(200);

    const row = await env.DB.prepare(
      "SELECT approved_by, approved_at, effective_from FROM rule_versions WHERE rule_id = ?"
    )
      .bind("rule-1")
      .first<{ approved_by: string; approved_at: string; effective_from: string }>();
    expect(row?.approved_by).toBe("alice@example.com");
    expect(row?.approved_at).toBeTruthy();
    expect(row?.effective_from).toBeTruthy();
  });

  it("refuses a second activation attempt — already approved", async () => {
    await seedRule("rule-1");
    await seedExample("ex-1", "rule-1", true);
    await handleConfirmExample(env.DB, "ex-1", "alice@example.com");
    // Missing the non-matching direction is fine for THIS test's
    // purpose — the first activation succeeding is not what's under
    // test here (it would actually fail coverage-of-both-directions
    // requirements if that were enforced at this layer, but that
    // check lives in generateExamples, not here — activation only
    // requires "all examples that exist are confirmed").
    await handleActivateRule(env.DB, "rule-1", 1, "alice@example.com");

    const second = await handleActivateRule(env.DB, "rule-1", 1, "bob@example.com");
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ error: "already activated", approvedBy: "alice@example.com" });

    // Confirms the second attempt didn't overwrite who actually approved it.
    const row = await env.DB.prepare("SELECT approved_by FROM rule_versions WHERE rule_id = ?")
      .bind("rule-1")
      .first();
    expect(row).toEqual({ approved_by: "alice@example.com" });
  });

  it("translates its messages when given a non-English locale", async () => {
    const result = await handleActivateRule(env.DB, "rule-1", 1, "alice@example.com", "de");
    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: "Regel rule-1, Version 1, existiert nicht" });
  });
});

async function seedNextVersion(ruleId: string, version: number): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO rule_versions (rule_id, version, source_text, compiled_json, compiled_by) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(ruleId, version, "test source", "{}", "test-model")
    .run();
}

async function seedExampleFor(id: string, ruleId: string, version: number, expectMatch: boolean): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO rule_examples (id, rule_id, rule_version, invoice_json, expect_match) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(id, ruleId, version, "{}", expectMatch ? 1 : 0)
    .run();
}

describe("handleActivateRule — versioning: activating a new version closes the previously-open one", () => {
  it("activating v2 sets v1's effective_to to the exact moment v2 becomes effective", async () => {
    await seedRule("rule-1");
    await seedExample("ex-1", "rule-1", true);
    await handleConfirmExample(env.DB, "ex-1", "alice@example.com");
    await handleActivateRule(env.DB, "rule-1", 1, "alice@example.com");

    await seedNextVersion("rule-1", 2);
    await seedExampleFor("ex-2", "rule-1", 2, true);
    await handleConfirmExample(env.DB, "ex-2", "bob@example.com");
    const result = await handleActivateRule(env.DB, "rule-1", 2, "bob@example.com");
    expect(result.status).toBe(200);
    const v2EffectiveFrom = (result.body as { effectiveFrom: string }).effectiveFrom;

    const v1Row = await env.DB.prepare("SELECT approved_by, effective_to FROM rule_versions WHERE rule_id = ? AND version = 1")
      .bind("rule-1")
      .first();
    expect(v1Row).toEqual({ approved_by: "alice@example.com", effective_to: v2EffectiveFrom });

    const v2Row = await env.DB.prepare("SELECT approved_by, effective_to FROM rule_versions WHERE rule_id = ? AND version = 2")
      .bind("rule-1")
      .first();
    expect(v2Row).toEqual({ approved_by: "bob@example.com", effective_to: null });
  });

  it("v1's own approval record is preserved, not erased, when v2 supersedes it", async () => {
    await seedRule("rule-1");
    await seedExample("ex-1", "rule-1", true);
    await handleConfirmExample(env.DB, "ex-1", "alice@example.com");
    await handleActivateRule(env.DB, "rule-1", 1, "alice@example.com");

    await seedNextVersion("rule-1", 2);
    await seedExampleFor("ex-2", "rule-1", 2, true);
    await handleConfirmExample(env.DB, "ex-2", "bob@example.com");
    await handleActivateRule(env.DB, "rule-1", 2, "bob@example.com");

    const v1Row = await env.DB.prepare(
      "SELECT approved_by, approved_at, effective_from FROM rule_versions WHERE rule_id = ? AND version = 1"
    )
      .bind("rule-1")
      .first<{ approved_by: string; approved_at: string; effective_from: string }>();
    expect(v1Row?.approved_by).toBe("alice@example.com");
    expect(v1Row?.approved_at).toBeTruthy();
    expect(v1Row?.effective_from).toBeTruthy();
  });

  it("activating v1 for the first time never-mind-closes anything — no prior version exists to touch", async () => {
    await seedRule("rule-1");
    await seedExample("ex-1", "rule-1", true);
    await handleConfirmExample(env.DB, "ex-1", "alice@example.com");
    // Same exact call as every pre-versioning test above — must
    // behave identically, confirming this feature is purely additive.
    const result = await handleActivateRule(env.DB, "rule-1", 1, "alice@example.com");
    expect(result.status).toBe(200);
    const row = await env.DB.prepare("SELECT effective_to FROM rule_versions WHERE rule_id = ? AND version = 1")
      .bind("rule-1")
      .first();
    expect(row).toEqual({ effective_to: null });
  });

  it("activating v3 only closes v2 (the currently-open one) — v1, already closed, is left untouched", async () => {
    await seedRule("rule-1");
    await seedExample("ex-1", "rule-1", true);
    await handleConfirmExample(env.DB, "ex-1", "alice@example.com");
    await handleActivateRule(env.DB, "rule-1", 1, "alice@example.com");

    await seedNextVersion("rule-1", 2);
    await seedExampleFor("ex-2", "rule-1", 2, true);
    await handleConfirmExample(env.DB, "ex-2", "bob@example.com");
    await handleActivateRule(env.DB, "rule-1", 2, "bob@example.com");
    const v1ClosedAt = (
      await env.DB.prepare("SELECT effective_to FROM rule_versions WHERE rule_id = ? AND version = 1")
        .bind("rule-1")
        .first<{ effective_to: string }>()
    )?.effective_to;

    await seedNextVersion("rule-1", 3);
    await seedExampleFor("ex-3", "rule-1", 3, true);
    await handleConfirmExample(env.DB, "ex-3", "carol@example.com");
    await handleActivateRule(env.DB, "rule-1", 3, "carol@example.com");

    // v1's own closing timestamp is untouched by v3's activation.
    const v1Row = await env.DB.prepare("SELECT effective_to FROM rule_versions WHERE rule_id = ? AND version = 1")
      .bind("rule-1")
      .first();
    expect(v1Row).toEqual({ effective_to: v1ClosedAt });

    // v2, which WAS open, is now closed.
    const v2Row = await env.DB.prepare("SELECT effective_to FROM rule_versions WHERE rule_id = ? AND version = 2")
      .bind("rule-1")
      .first<{ effective_to: string | null }>();
    expect(v2Row?.effective_to).toBeTruthy();
    expect(v2Row?.effective_to).not.toBe(v1ClosedAt);

    // v3 is the new open one.
    const v3Row = await env.DB.prepare("SELECT effective_to FROM rule_versions WHERE rule_id = ? AND version = 3")
      .bind("rule-1")
      .first();
    expect(v3Row).toEqual({ effective_to: null });
  });
});
