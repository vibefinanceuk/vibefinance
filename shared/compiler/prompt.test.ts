import { describe, expect, it } from "vitest";
import { buildCompilerPrompt } from "./prompt.js";

describe("buildCompilerPrompt", () => {
  it("includes the customer's sentence verbatim", () => {
    const prompt = buildCompilerPrompt("route anything over 10000 euros to finance");
    expect(prompt).toContain("route anything over 10000 euros to finance");
  });

  it("includes the closed vocabulary — a spot check of fields, operators and actions", () => {
    const prompt = buildCompilerPrompt("test");
    expect(prompt).toContain("BT-48");
    expect(prompt).toContain("greater_than");
    expect(prompt).toContain("route_to");
  });

  it("instructs refusal as an explicit, first-class option rather than approximation", () => {
    const prompt = buildCompilerPrompt("test");
    expect(prompt.toLowerCase()).toContain("refus");
  });

  it("does not silently truncate a long sentence", () => {
    const long = "a".repeat(500);
    const prompt = buildCompilerPrompt(long);
    expect(prompt).toContain(long);
  });
});
