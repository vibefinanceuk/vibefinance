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

  it("teaches assign_task's real params shape and route_to's current meaning — the exact gap a live compile once fell through", () => {
    const prompt = buildCompilerPrompt("test");
    expect(prompt).toContain('"team": "<team id>"');
    expect(prompt).toContain('"user": "<user id>"');
    expect(prompt).not.toContain('"queue"'); // the retired route_to JSON shape, never shown as an example again
    expect(prompt).toContain('"stage": "<stage id>"');
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

describe("buildCompilerPrompt — Intake channel examples (decision 0023)", () => {
  it("the invoice prompt shows real AP and AR mandate.channel example values", () => {
    const prompt = buildCompilerPrompt("test");
    expect(prompt).toContain("Mailroom");
    expect(prompt).toContain("Billing System A");
  });

  it("the expense prompt shows real intake.channel example values, including the anticipated iPhone App channel", () => {
    const prompt = buildCompilerPrompt("test", "expense");
    expect(prompt).toContain("intake.channel");
    expect(prompt).toContain("iPhone App");
    expect(prompt).not.toContain("Mailroom"); // an AP-specific example, not expense's
  });
});
