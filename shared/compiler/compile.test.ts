import { describe, expect, it, vi } from "vitest";
import { compileRule } from "./compile.js";
import type { CompilerModel } from "./types.js";

function fakeModel(response: string): CompilerModel {
  return { compile: vi.fn().mockResolvedValue(response) };
}

describe("compileRule", () => {
  it("builds a prompt containing the source text and passes it to the model", async () => {
    const model = fakeModel(
      JSON.stringify({
        status: "compiled",
        conditions: { field: "BT-3", operator: "is_present" },
        actions: [{ type: "flag" }],
      })
    );
    await compileRule(model, "flag anything missing a type code");

    expect(model.compile).toHaveBeenCalledTimes(1);
    const promptSent = (model.compile as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(promptSent).toContain("flag anything missing a type code");
  });

  it("returns the parsed, validated outcome from the model's response", async () => {
    const model = fakeModel(
      JSON.stringify({
        status: "compiled",
        conditions: { field: "BT-3", operator: "is_present" },
        actions: [{ type: "flag" }],
      })
    );
    const outcome = await compileRule(model, "anything");
    expect(outcome.kind).toBe("compiled");
  });

  it("surfaces an explicit model refusal", async () => {
    const model = fakeModel(
      JSON.stringify({ status: "refused", reason: "cannot express supplier reputation" })
    );
    const outcome = await compileRule(model, "flag disreputable suppliers");
    expect(outcome).toMatchObject({ kind: "refused", reason: "cannot express supplier reputation" });
  });

  it("does not swallow an error thrown by the model itself", async () => {
    const model: CompilerModel = {
      compile: vi.fn().mockRejectedValue(new Error("network error")),
    };
    await expect(compileRule(model, "anything")).rejects.toThrow("network error");
  });
});

describe("compileRule — multi-vocabulary support (decision 0022)", () => {
  it("defaults to the invoice vocabulary — an existing caller passing no third argument sees unchanged behaviour", async () => {
    const model = fakeModel(
      JSON.stringify({
        status: "compiled",
        conditions: { field: "BT-112", operator: "greater_than", value: 1000 },
        actions: [{ type: "flag" }],
      })
    );
    const outcome = await compileRule(model, "flag anything over 1000");
    expect(outcome.kind).toBe("compiled");
    const promptSent = (model.compile as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(promptSent).toContain("BT-112");
    expect(promptSent).not.toContain("EXPENSE FIELDS");
  });

  it("compiling against 'expense' sends a prompt with the expense field vocabulary, not invoice fields", async () => {
    const model = fakeModel(
      JSON.stringify({
        status: "compiled",
        conditions: { field: "category", operator: "is", value: "Travel" },
        actions: [{ type: "flag" }],
      })
    );
    await compileRule(model, "flag Travel expenses", "expense");
    const promptSent = (model.compile as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(promptSent).toContain("EXPENSE FIELDS");
    expect(promptSent).toContain("category");
    expect(promptSent).not.toContain("BT-112");
  });

  it("the critical property: a model output referencing an invoice field is REFUSED when compiling against the expense vocabulary", async () => {
    // Simulates the model hallucinating an invoice field while
    // compiling an expense rule — validateRule's own vocabulary
    // parameter is what catches this, not anything in compileRule
    // itself.
    const model = fakeModel(
      JSON.stringify({
        status: "compiled",
        conditions: { field: "BT-112", operator: "greater_than", value: 1000 },
        actions: [{ type: "flag" }],
      })
    );
    const outcome = await compileRule(model, "flag large expenses", "expense");
    expect(outcome.kind).toBe("refused");
  });

  it("a genuine expense rule compiles and validates cleanly end to end, including assign_task with Expense.Review", async () => {
    const model = fakeModel(
      JSON.stringify({
        status: "compiled",
        conditions: {
          all: [
            { field: "category", operator: "is", value: "Travel" },
            { field: "receipt_attached", operator: "is", value: false },
          ],
        },
        actions: [{ type: "assign_task", params: { team: "finance team", permission: "Expense.Review" } }],
      })
    );
    const outcome = await compileRule(model, "flag Travel expenses with no receipt", "expense");
    expect(outcome.kind).toBe("compiled");
  });
});
