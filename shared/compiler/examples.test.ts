import { describe, expect, it, vi } from "vitest";
import { generateExamples } from "./examples.js";
import type { CompilerModel } from "./types.js";
import type { RuleNode } from "../interpreter/types.js";

function fakeModel(response: string): CompilerModel {
  return { compile: vi.fn().mockResolvedValue(response) };
}

const CONDITIONS: RuleNode = {
  all: [
    { field: "BT-48", operator: "is_empty" },
    { field: "BT-40", operator: "not_in", value: ["DE", "FR"] },
  ],
};
const ACTIONS = [{ type: "route_to", params: { queue: "tax_review" } }];

describe("generateExamples — the happy path", () => {
  it("accepts a correctly self-consistent set of examples", async () => {
    const model = fakeModel(
      JSON.stringify({
        examples: [
          { invoice: { "BT-40": "US" }, expectMatch: true },
          { invoice: { "BT-40": "DE" }, expectMatch: false },
        ],
      })
    );
    const outcome = await generateExamples(model, CONDITIONS, ACTIONS);
    expect(outcome.kind).toBe("generated");
    if (outcome.kind === "generated") {
      expect(outcome.examples).toHaveLength(2);
    }
  });

  it("passes a prompt containing the referenced fields and both directions", async () => {
    const model = fakeModel(
      JSON.stringify({
        examples: [
          { invoice: { "BT-40": "US" }, expectMatch: true },
          { invoice: { "BT-40": "DE" }, expectMatch: false },
        ],
      })
    );
    await generateExamples(model, CONDITIONS, ACTIONS);
    const promptSent = (model.compile as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(promptSent).toContain("BT-48");
    expect(promptSent).toContain("BT-40");
    expect(promptSent.toLowerCase()).toContain("false");
  });
});

describe("generateExamples — self-verification against the real interpreter", () => {
  it("refuses the whole batch when the model's claimed expectMatch is wrong — never trusted blindly", async () => {
    // BT-40: "US" with BT-48 unset genuinely matches these conditions
    // (is_empty AND not_in ["DE","FR"]) — the model claims false here,
    // which is simply incorrect.
    const model = fakeModel(
      JSON.stringify({
        examples: [
          { invoice: { "BT-40": "US" }, expectMatch: false }, // wrong claim
          { invoice: { "BT-40": "DE" }, expectMatch: false },
        ],
      })
    );
    const outcome = await generateExamples(model, CONDITIONS, ACTIONS);
    expect(outcome.kind).toBe("refused");
    if (outcome.kind === "refused") {
      expect(outcome.reason).toContain("real interpreter evaluates");
    }
  });

  it("a single bad example refuses the entire batch, not just the bad one", async () => {
    const model = fakeModel(
      JSON.stringify({
        examples: [
          { invoice: { "BT-40": "US" }, expectMatch: true }, // correct
          { invoice: { "BT-40": "DE" }, expectMatch: false }, // correct
          { invoice: { "BT-40": "FR" }, expectMatch: true }, // wrong — FR is excluded, so this is actually false
        ],
      })
    );
    const outcome = await generateExamples(model, CONDITIONS, ACTIONS);
    expect(outcome.kind).toBe("refused");
  });
});

describe("generateExamples — coverage of both directions", () => {
  it("refuses when only matching examples are provided", async () => {
    const model = fakeModel(
      JSON.stringify({
        examples: [
          { invoice: { "BT-40": "US" }, expectMatch: true },
          { invoice: { "BT-40": "GB" }, expectMatch: true },
        ],
      })
    );
    const outcome = await generateExamples(model, CONDITIONS, ACTIONS);
    expect(outcome.kind).toBe("refused");
    if (outcome.kind === "refused") {
      expect(outcome.reason).toContain("matching");
    }
  });

  it("refuses when only non-matching examples are provided", async () => {
    const model = fakeModel(
      JSON.stringify({
        examples: [{ invoice: { "BT-40": "DE" }, expectMatch: false }],
      })
    );
    const outcome = await generateExamples(model, CONDITIONS, ACTIONS);
    expect(outcome.kind).toBe("refused");
  });
});

describe("generateExamples — malformed responses", () => {
  it("refuses on unparseable output, without throwing", async () => {
    const model = fakeModel("not json at all");
    await expect(generateExamples(model, CONDITIONS, ACTIONS)).resolves.toMatchObject({
      kind: "refused",
    });
  });

  it("refuses when there is no 'examples' array", async () => {
    const model = fakeModel(JSON.stringify({ something: "else" }));
    const outcome = await generateExamples(model, CONDITIONS, ACTIONS);
    expect(outcome.kind).toBe("refused");
  });

  it("refuses when an example is missing expectMatch", async () => {
    const model = fakeModel(JSON.stringify({ examples: [{ invoice: { "BT-40": "US" } }] }));
    const outcome = await generateExamples(model, CONDITIONS, ACTIONS);
    expect(outcome.kind).toBe("refused");
  });

  it("recovers JSON wrapped in a markdown fence with surrounding prose", async () => {
    const raw =
      "Here are the examples:\n```json\n" +
      JSON.stringify({
        examples: [
          { invoice: { "BT-40": "US" }, expectMatch: true },
          { invoice: { "BT-40": "DE" }, expectMatch: false },
        ],
      }) +
      "\n```\nLet me know if you'd like more.";
    const model = fakeModel(raw);
    const outcome = await generateExamples(model, CONDITIONS, ACTIONS);
    expect(outcome.kind).toBe("generated");
  });
});

describe("generateExamples — vocabulary parameterization (real gap found live)", () => {
  it("defaults to the invoice vocabulary doc when no vocabulary is given — full backward compatibility", async () => {
    const model = fakeModel(JSON.stringify({ examples: [] }));
    await generateExamples(model, CONDITIONS, ACTIONS);
    const promptSent = (model.compile as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(promptSent).toContain("BT-1");
    expect(promptSent).not.toContain("receipt_attached");
  });

  it("passes the real expense vocabulary doc through when the rule set is expense-vocabulary, not the invoice default", async () => {
    const model = fakeModel(JSON.stringify({ examples: [] }));
    await generateExamples(model, CONDITIONS, ACTIONS, "expense");
    const promptSent = (model.compile as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(promptSent).toContain("receipt_attached");
    expect(promptSent).not.toContain("BT-1");
  });

  it("never hardcodes 'invoice-processing' or 'invoices' in the prompt's own framing language, regardless of vocabulary", async () => {
    const model = fakeModel(JSON.stringify({ examples: [] }));
    await generateExamples(model, CONDITIONS, ACTIONS, "expense");
    const promptSent = (model.compile as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(promptSent).not.toContain("invoice-processing rule");
    expect(promptSent).not.toMatch(/example invoice\(s\)/);
  });
});
