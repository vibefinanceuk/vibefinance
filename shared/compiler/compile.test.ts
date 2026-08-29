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
