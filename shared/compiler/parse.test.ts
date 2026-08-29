import { describe, expect, it } from "vitest";
import { parseModelOutput } from "./parse.js";

describe("parseModelOutput — compiled shape", () => {
  it("parses a valid compiled response", () => {
    const raw = JSON.stringify({
      status: "compiled",
      conditions: { field: "BT-48", operator: "is_empty" },
      actions: [{ type: "flag" }],
    });
    const outcome = parseModelOutput(raw);
    expect(outcome.kind).toBe("compiled");
    if (outcome.kind === "compiled") {
      expect(outcome.conditions).toEqual({ field: "BT-48", operator: "is_empty" });
      expect(outcome.actions).toEqual([{ type: "flag" }]);
    }
  });

  it("recovers JSON wrapped in a markdown code fence with prose around it", () => {
    const raw =
      "Sure, here's the rule:\n```json\n" +
      JSON.stringify({
        status: "compiled",
        conditions: { field: "BT-3", operator: "is_present" },
        actions: [{ type: "tag" }],
      }) +
      "\n```\nLet me know if you'd like changes.";
    const outcome = parseModelOutput(raw);
    expect(outcome.kind).toBe("compiled");
  });
});

describe("parseModelOutput — refusal boundary", () => {
  it("passes through an explicit model refusal", () => {
    const raw = JSON.stringify({ status: "refused", reason: "no field for that" });
    const outcome = parseModelOutput(raw);
    expect(outcome).toMatchObject({ kind: "refused", reason: "no field for that" });
  });

  it("treats unparseable garbage as a refusal, never a thrown error", () => {
    expect(() => parseModelOutput("not json at all, sorry")).not.toThrow();
    const outcome = parseModelOutput("not json at all, sorry");
    expect(outcome.kind).toBe("refused");
  });

  it("treats a response matching neither shape as a refusal", () => {
    const outcome = parseModelOutput(JSON.stringify({ hello: "world" }));
    expect(outcome.kind).toBe("refused");
  });

  it("refuses a compiled response using a field outside the closed vocabulary — never silently stored", () => {
    const raw = JSON.stringify({
      status: "compiled",
      conditions: { field: "supplier.reputation_score", operator: "greater_than", value: 5 },
      actions: [{ type: "flag" }],
    });
    const outcome = parseModelOutput(raw);
    expect(outcome.kind).toBe("refused");
    if (outcome.kind === "refused") {
      expect(outcome.reason).toContain("closed vocabulary");
    }
  });

  it("refuses a compiled response using an invented action", () => {
    const raw = JSON.stringify({
      status: "compiled",
      conditions: { field: "BT-3", operator: "is_present" },
      actions: [{ type: "call_external_webhook" }],
    });
    const outcome = parseModelOutput(raw);
    expect(outcome.kind).toBe("refused");
  });

  it("refuses a compiled response nested beyond the interpreter's depth bound", () => {
    let node: unknown = { field: "BT-3", operator: "is_present" };
    for (let i = 0; i < 10; i++) node = { all: [node] };
    const raw = JSON.stringify({
      status: "compiled",
      conditions: node,
      actions: [{ type: "flag" }],
    });
    const outcome = parseModelOutput(raw);
    expect(outcome.kind).toBe("refused");
  });

  it("never leaks the internal placeholder id/version used for validation", () => {
    const raw = JSON.stringify({
      status: "compiled",
      conditions: { field: "BT-3", operator: "is_present" },
      actions: [{ type: "flag" }],
    });
    const outcome = parseModelOutput(raw);
    expect(JSON.stringify(outcome)).not.toContain("__unvalidated__");
  });
});
