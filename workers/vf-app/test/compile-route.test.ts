import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCompileRequest } from "../src/compile-route.js";
import type { CompilerModel } from "@vibefinance/shared";

function fakeModel(response: string): CompilerModel {
  return { compile: vi.fn().mockResolvedValue(response) };
}

/** A model that responds differently to the compile prompt vs. the
 * examples prompt, distinguished by content — the two calls happen in
 * a fixed order in practice, but keying off content rather than call
 * count keeps this robust to that changing. */
function fakeModelWithExamples(compileResponse: string, examplesResponse: string): CompilerModel {
  return {
    compile: vi.fn().mockImplementation(async (prompt: string) => {
      return prompt.includes("worked examples") ? examplesResponse : compileResponse;
    }),
  };
}

async function seedRuleSet(id: string): Promise<void> {
  await env.DB.prepare("INSERT INTO rule_sets (id, name, mode, status) VALUES (?, ?, ?, ?)")
    .bind(id, "test rule set", "first_match", "draft")
    .run();
}

async function seedExpenseRuleSet(id: string): Promise<void> {
  await env.DB.prepare("INSERT INTO rule_sets (id, name, mode, status, vocabulary) VALUES (?, ?, ?, ?, ?)")
    .bind(id, "test expense rule set", "first_match", "draft", "expense")
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
        actions: [{ type: "flag", params: { reason: "needs a look" } }],
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

describe("handleCompileRequest — worked examples (Blueprint build order step 3)", () => {
  it("generates and stores examples alongside a successful compile", async () => {
    await seedRuleSet("rs1");
    const model = fakeModelWithExamples(
      JSON.stringify({
        status: "compiled",
        conditions: { field: "BT-112", operator: "greater_than", value: 1000 },
        actions: [{ type: "flag", params: { reason: "needs a look" } }],
      }),
      JSON.stringify({
        examples: [
          { invoice: { "BT-112": 5000 }, expectMatch: true },
          { invoice: { "BT-112": 200 }, expectMatch: false },
        ],
      })
    );

    const result = await handleCompileRequest(model, "test-model@v1", env.DB, {
      ruleSetId: "rs1",
      sourceText: "require a second approval for anything over 1000",
    });

    expect(result.status).toBe(201);
    expect(result.body.examples).toEqual({ status: "generated", count: 2 });

    const body = result.body as { ruleId: string };
    const rows = await env.DB.prepare(
      "SELECT invoice_json, expect_match, confirmed_by FROM rule_examples WHERE rule_id = ? ORDER BY expect_match DESC"
    )
      .bind(body.ruleId)
      .all();
    expect(rows.results).toEqual([
      { invoice_json: '{"BT-112":5000}', expect_match: 1, confirmed_by: null },
      { invoice_json: '{"BT-112":200}', expect_match: 0, confirmed_by: null },
    ]);
  });

  it("still stores the rule when example generation is refused — the rule is not undone", async () => {
    await seedRuleSet("rs1");
    // Reusing the compile response for the examples call means
    // parseExamplesResponse sees a shape with no "examples" array —
    // a genuine refusal, not a contrived one.
    const model = fakeModel(
      JSON.stringify({
        status: "compiled",
        conditions: { field: "BT-3", operator: "is_present" },
        actions: [{ type: "flag" }],
      })
    );

    const result = await handleCompileRequest(model, "test-model@v1", env.DB, {
      ruleSetId: "rs1",
      sourceText: "flag anything with a type code",
    });

    expect(result.status).toBe(201);
    expect((result.body.examples as { status: string }).status).toBe("refused");

    const body = result.body as { ruleId: string };
    const ruleRow = await env.DB.prepare("SELECT id FROM rules WHERE id = ?").bind(body.ruleId).first();
    expect(ruleRow).toBeTruthy();
    const exampleCount = await env.DB.prepare("SELECT count(*) AS n FROM rule_examples WHERE rule_id = ?")
      .bind(body.ruleId)
      .first();
    expect(exampleCount).toEqual({ n: 0 });
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

describe("handleCompileRequest — locale", () => {
  it("translates its static validation messages when given a non-English locale", async () => {
    const model = fakeModel("irrelevant");
    const result = await handleCompileRequest(
      model,
      "test-model@v1",
      env.DB,
      { sourceText: "some rule" }, // ruleSetId missing
      "it"
    );
    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      error: "ruleSetId e sourceText (entrambi come stringhe) sono obbligatori",
    });
  });
});

describe("handleCompileRequest — rule versioning", () => {
  const compiledResponse = (threshold: number) =>
    JSON.stringify({
      status: "compiled",
      conditions: { field: "BT-112", operator: "greater_than", value: threshold },
      actions: [{ type: "flag" }],
    });

  async function compileNewRule(ruleSetId: string, threshold: number): Promise<string> {
    const model = fakeModel(compiledResponse(threshold));
    const result = await handleCompileRequest(model, "test-model@v1", env.DB, {
      ruleSetId,
      sourceText: `flag anything over ${threshold}`,
    });
    return (result.body as { ruleId: string }).ruleId;
  }

  it("400s when ruleId is not a string", async () => {
    await seedRuleSet("rs1");
    const model = fakeModel("irrelevant");
    const result = await handleCompileRequest(model, "test-model@v1", env.DB, {
      ruleSetId: "rs1",
      sourceText: "flag anything over 1000",
      ruleId: 42,
    });
    expect(result.status).toBe(400);
    expect(model.compile).not.toHaveBeenCalled();
  });

  it("404s when ruleId does not exist at all, without ever calling the model", async () => {
    await seedRuleSet("rs1");
    const model = fakeModel("irrelevant");
    const result = await handleCompileRequest(model, "test-model@v1", env.DB, {
      ruleSetId: "rs1",
      sourceText: "flag anything over 1000",
      ruleId: "does-not-exist",
    });
    expect(result.status).toBe(404);
    expect(model.compile).not.toHaveBeenCalled();
  });

  it("404s when ruleId exists but belongs to a different rule set — refuses to silently move a rule", async () => {
    await seedRuleSet("rs1");
    await seedRuleSet("rs2");
    const ruleId = await compileNewRule("rs1", 1000);

    const model = fakeModel(compiledResponse(2000));
    const result = await handleCompileRequest(model, "test-model@v1", env.DB, {
      ruleSetId: "rs2", // wrong rule set for this ruleId
      sourceText: "flag anything over 2000",
      ruleId,
    });
    expect(result.status).toBe(404);
    expect(model.compile).not.toHaveBeenCalled();
  });

  it("with no ruleId, always creates a new rule at version 1 — the original, unchanged behaviour", async () => {
    await seedRuleSet("rs1");
    const ruleIdA = await compileNewRule("rs1", 1000);
    const ruleIdB = await compileNewRule("rs1", 2000);
    expect(ruleIdA).not.toBe(ruleIdB);
    const versions = await env.DB.prepare("SELECT version FROM rule_versions WHERE rule_id IN (?, ?)")
      .bind(ruleIdA, ruleIdB)
      .all();
    expect(versions.results).toEqual([{ version: 1 }, { version: 1 }]);
  });

  it("with a real ruleId, compiles version 2 of the SAME rule — not a new rule", async () => {
    await seedRuleSet("rs1");
    const ruleId = await compileNewRule("rs1", 1000);

    const model = fakeModel(compiledResponse(2000));
    const result = await handleCompileRequest(model, "test-model@v1", env.DB, {
      ruleSetId: "rs1",
      sourceText: "flag anything over 2000",
      ruleId,
    });

    expect(result.status).toBe(201);
    const body = result.body as { ruleId: string; version: number; isNewVersionOfExistingRule: boolean };
    expect(body.ruleId).toBe(ruleId); // same rule id, not a new one
    expect(body.version).toBe(2);
    expect(body.isNewVersionOfExistingRule).toBe(true);

    // Only one row in `rules` — recompiling never creates a second one.
    const ruleCount = await env.DB.prepare("SELECT count(*) AS n FROM rules WHERE id = ?").bind(ruleId).first();
    expect(ruleCount).toEqual({ n: 1 });

    // Both versions genuinely exist side by side in rule_versions.
    const versions = await env.DB.prepare("SELECT version FROM rule_versions WHERE rule_id = ? ORDER BY version")
      .bind(ruleId)
      .all();
    expect(versions.results).toEqual([{ version: 1 }, { version: 2 }]);
  });

  it("computes the next version as MAX(version) + 1, not count + 1 — confirmed with a real v3", async () => {
    await seedRuleSet("rs1");
    const ruleId = await compileNewRule("rs1", 1000);
    await handleCompileRequest(
      fakeModel(compiledResponse(2000)),
      "test-model@v1",
      env.DB,
      { ruleSetId: "rs1", sourceText: "v2", ruleId }
    );
    const result = await handleCompileRequest(
      fakeModel(compiledResponse(3000)),
      "test-model@v1",
      env.DB,
      { ruleSetId: "rs1", sourceText: "v3", ruleId }
    );
    expect((result.body as { version: number }).version).toBe(3);
  });

  it("a new version's worked examples are tied to the new version only, never mixed with the old version's", async () => {
    await seedRuleSet("rs1");
    const examplesResponse = (threshold: number) =>
      JSON.stringify({
        examples: [
          { invoice: { "BT-112": threshold + 500 }, expectMatch: true },
          { invoice: { "BT-112": threshold - 500 }, expectMatch: false },
        ],
      });

    const v1Model = fakeModelWithExamples(compiledResponse(1000), examplesResponse(1000));
    const v1Result = await handleCompileRequest(v1Model, "test-model@v1", env.DB, {
      ruleSetId: "rs1",
      sourceText: "v1",
    });
    const ruleId = (v1Result.body as { ruleId: string }).ruleId;

    const v1ExampleCount = await env.DB.prepare(
      "SELECT count(*) AS n FROM rule_examples WHERE rule_id = ? AND rule_version = 1"
    )
      .bind(ruleId)
      .first();
    expect((v1ExampleCount as { n: number }).n).toBeGreaterThan(0);

    const v2Model = fakeModelWithExamples(compiledResponse(2000), examplesResponse(2000));
    await handleCompileRequest(v2Model, "test-model@v1", env.DB, {
      ruleSetId: "rs1",
      sourceText: "v2",
      ruleId,
    });
    const v2ExampleCount = await env.DB.prepare(
      "SELECT count(*) AS n FROM rule_examples WHERE rule_id = ? AND rule_version = 2"
    )
      .bind(ruleId)
      .first();
    expect((v2ExampleCount as { n: number }).n).toBeGreaterThan(0);

    // v1's examples are still there too — recompiling never touches
    // or deletes a prior version's data.
    const v1Again = await env.DB.prepare(
      "SELECT count(*) AS n FROM rule_examples WHERE rule_id = ? AND rule_version = 1"
    )
      .bind(ruleId)
      .first();
    expect((v1Again as { n: number }).n).toEqual((v1ExampleCount as { n: number }).n);
  });

  it("a refused recompile leaves the existing rule and its versions completely untouched", async () => {
    await seedRuleSet("rs1");
    const ruleId = await compileNewRule("rs1", 1000);

    const refusingModel = fakeModel(JSON.stringify({ status: "refused", reason: "can't express this" }));
    const result = await handleCompileRequest(refusingModel, "test-model@v1", env.DB, {
      ruleSetId: "rs1",
      sourceText: "something unexpressable",
      ruleId,
    });

    expect(result.status).toBe(422);
    const versions = await env.DB.prepare("SELECT version FROM rule_versions WHERE rule_id = ?")
      .bind(ruleId)
      .all();
    expect(versions.results).toEqual([{ version: 1 }]); // still just v1, no partial v2 row
  });
});

describe("handleCompileRequest — rule sets carry their own vocabulary (decision 0022)", () => {
  it("compiling against a plain rule set (defaulted to 'invoice') uses the invoice vocabulary in the prompt", async () => {
    await seedRuleSet("rs-invoice");
    const model = fakeModel(
      JSON.stringify({
        status: "compiled",
        conditions: { field: "BT-112", operator: "greater_than", value: 1000 },
        actions: [{ type: "flag" }],
      })
    );
    await handleCompileRequest(model, "test-model@v1", env.DB, { ruleSetId: "rs-invoice", sourceText: "flag over 1000" });
    const promptSent = (model.compile as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(promptSent).toContain("BT-112");
    expect(promptSent).not.toContain("EXPENSE FIELDS");
  });

  it("compiling against an expense rule set sends the expense field vocabulary in the prompt, not invoice fields", async () => {
    await seedExpenseRuleSet("rs-expense");
    const model = fakeModel(
      JSON.stringify({
        status: "compiled",
        conditions: { field: "category", operator: "is", value: "Travel" },
        actions: [{ type: "flag" }],
      })
    );
    const result = await handleCompileRequest(model, "test-model@v1", env.DB, {
      ruleSetId: "rs-expense",
      sourceText: "flag Travel expenses",
    });
    expect(result.status).toBe(201);
    const promptSent = (model.compile as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(promptSent).toContain("EXPENSE FIELDS");
    expect(promptSent).toContain("category");
    expect(promptSent).not.toContain("BT-112");
  });

  it("the critical property: a hallucinated invoice field is refused when compiling against an expense rule set — through the real route, not just the compiler function directly", async () => {
    await seedExpenseRuleSet("rs-expense-2");
    const model = fakeModel(
      JSON.stringify({
        status: "compiled",
        conditions: { field: "BT-112", operator: "greater_than", value: 1000 },
        actions: [{ type: "flag" }],
      })
    );
    const result = await handleCompileRequest(model, "test-model@v1", env.DB, {
      ruleSetId: "rs-expense-2",
      sourceText: "flag large amounts",
    });
    expect(result.status).toBe(422);
    const ruleCount = await env.DB.prepare("SELECT count(*) AS n FROM rules WHERE rule_set_id = ?")
      .bind("rs-expense-2")
      .first();
    expect(ruleCount).toEqual({ n: 0 }); // refused — nothing stored
  });
});
