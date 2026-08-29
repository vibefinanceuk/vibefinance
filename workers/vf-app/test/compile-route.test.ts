import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCompileRequest } from "../src/compile-route.js";
import type { CompilerModel } from "@vibefinance/shared";

function fakeModel(response: string): CompilerModel {
  return { compile: vi.fn().mockResolvedValue(response) };
}

async function seedRuleSet(id: string): Promise<void> {
  await env.DB.prepare("INSERT INTO rule_sets (id, name, mode, status) VALUES (?, ?, ?, ?)")
    .bind(id, "test rule set", "first_match", "draft")
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
});

describe("handleCompileRequest — validation, before any model call", () => {
  it("400s when ruleSetId is missing", async () => {
    const model = fakeModel("irrelevant");
    const result = await handleCompileRequest(model, "test-model@v1", env.DB, {
      sourceText: "flag anything over 1000",
    });
    expect(result.status).toBe(400);
    expect(model.compile).not.toHaveBeenCalled();
  });

  it("400s when sourceText is missing", async () => {
    const model = fakeModel("irrelevant");
    const result = await handleCompileRequest(model, "test-model@v1", env.DB, {
      ruleSetId: "rs1",
    });
    expect(result.status).toBe(400);
    expect(model.compile).not.toHaveBeenCalled();
  });

  it("404s when the rule set does not exist, without ever calling the model", async () => {
    const model = fakeModel("irrelevant");
    const result = await handleCompileRequest(model, "test-model@v1", env.DB, {
      ruleSetId: "does-not-exist",
      sourceText: "flag anything over 1000",
    });
    expect(result.status).toBe(404);
    expect(model.compile).not.toHaveBeenCalled();
  });
});

describe("handleCompileRequest — a successful compile", () => {
  it("persists a new rule and rule_version as an unapproved draft in real D1", async () => {
    await seedRuleSet("rs1");
    const model = fakeModel(
      JSON.stringify({
        status: "compiled",
        conditions: { field: "BT-112", operator: "greater_than", value: 1000 },
        actions: [{ type: "require_second_approval" }],
      })
    );

    const result = await handleCompileRequest(model, "test-model@v1", env.DB, {
      ruleSetId: "rs1",
      sourceText: "require a second approval for anything over 1000",
    });

    expect(result.status).toBe(201);
    const body = result.body as { ruleId: string; version: number };
    expect(body.ruleId).toBeTruthy();
    expect(body.version).toBe(1);

    // Measure the rendered result, not the instruction issued (§7):
    // query D1 directly rather than trusting the returned body alone.
    const ruleRow = await env.DB.prepare("SELECT rule_set_id, sort_order, enabled FROM rules WHERE id = ?")
      .bind(body.ruleId)
      .first();
    expect(ruleRow).toEqual({ rule_set_id: "rs1", sort_order: 0, enabled: 1 });

    const versionRow = await env.DB.prepare(
      "SELECT source_text, compiled_by, approved_by, approved_at FROM rule_versions WHERE rule_id = ? AND version = 1"
    )
      .bind(body.ruleId)
      .first();
    expect(versionRow).toEqual({
      source_text: "require a second approval for anything over 1000",
      compiled_by: "test-model@v1",
      // Never auto-promoted — a person has to activate this
      // (Blueprint, rule_versions).
      approved_by: null,
      approved_at: null,
    });
  });

  it("assigns increasing sort_order for successive rules in the same set", async () => {
    await seedRuleSet("rs1");
    const model = fakeModel(
      JSON.stringify({
        status: "compiled",
        conditions: { field: "BT-3", operator: "is_present" },
        actions: [{ type: "flag" }],
      })
    );

    const first = await handleCompileRequest(model, "m", env.DB, {
      ruleSetId: "rs1",
      sourceText: "first rule",
    });
    const second = await handleCompileRequest(model, "m", env.DB, {
      ruleSetId: "rs1",
      sourceText: "second rule",
    });

    const firstId = (first.body as { ruleId: string }).ruleId;
    const secondId = (second.body as { ruleId: string }).ruleId;
    const firstRow = await env.DB.prepare("SELECT sort_order FROM rules WHERE id = ?").bind(firstId).first();
    const secondRow = await env.DB.prepare("SELECT sort_order FROM rules WHERE id = ?").bind(secondId).first();
    expect(firstRow).toEqual({ sort_order: 0 });
    expect(secondRow).toEqual({ sort_order: 1 });
  });
});

describe("handleCompileRequest — a refusal", () => {
  it("stores nothing and returns 422 when the model refuses", async () => {
    await seedRuleSet("rs1");
    const model = fakeModel(
      JSON.stringify({ status: "refused", reason: "no field for supplier reputation" })
    );

    const result = await handleCompileRequest(model, "test-model@v1", env.DB, {
      ruleSetId: "rs1",
      sourceText: "flag disreputable suppliers",
    });

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ status: "refused", reason: "no field for supplier reputation" });

    const count = await env.DB.prepare("SELECT count(*) AS n FROM rules WHERE rule_set_id = ?")
      .bind("rs1")
      .first();
    expect(count).toEqual({ n: 0 });
  });

  it("stores nothing when the model's output fails vocabulary validation", async () => {
    await seedRuleSet("rs1");
    const model = fakeModel(
      JSON.stringify({
        status: "compiled",
        conditions: { field: "supplier.reputation", operator: "is", value: "bad" },
        actions: [{ type: "flag" }],
      })
    );

    const result = await handleCompileRequest(model, "test-model@v1", env.DB, {
      ruleSetId: "rs1",
      sourceText: "flag disreputable suppliers",
    });

    expect(result.status).toBe(422);
    const count = await env.DB.prepare("SELECT count(*) AS n FROM rules WHERE rule_set_id = ?")
      .bind("rs1")
      .first();
    expect(count).toEqual({ n: 0 });
  });
});
