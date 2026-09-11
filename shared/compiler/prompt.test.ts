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

describe("what the stage requires (decision 0210)", () => {
  /**
   * **Decision 0200 taught the engine to fill a missing permission from
   * the stage, and nobody taught the compiler that one could be
   * missing.**
   *
   * So a customer writing *"assign a task to the AP team"* was refused
   * — *"assign_task action requires a permission parameter"* — and had
   * to type a value the stage would have supplied anyway, **and could
   * type the wrong one.** The engine would then refuse it for
   * disagreeing.
   *
   * Worst of both, found by writing a rule.
   */
  it("tells the model what the stage requires", () => {
    const prompt = buildCompilerPrompt("assign a task to the AP team", "invoice", "AP.Validate");
    expect(prompt).toContain("AP.Validate");
    expect(prompt).toContain("THIS STAGE'S OWN PERMISSION");
  });

  it("says to use it where the sentence names none", () => {
    const prompt = buildCompilerPrompt("assign a task to the AP team", "invoice", "AP.Validate");
    expect(prompt).toMatch(/does not name a permission/);
  });

  it("says a different one is a contradiction, not a value to override", () => {
    /**
     * **Decision 0033's argument.** Silently preferring the stage's is
     * how a rule comes to mean something other than it says, and the
     * author is the one who should hear about it.
     */
    const prompt = buildCompilerPrompt("assign a task", "invoice", "AP.Validate");
    expect(prompt).toContain("contradiction");
  });

  it("says nothing where the stage declares nothing", () => {
    // Which is every stage today, so this is the ordinary case and the
    // prompt must not grow a section about it.
    const prompt = buildCompilerPrompt("assign a task to the AP team", "invoice", null);
    expect(prompt).not.toContain("THIS STAGE'S OWN PERMISSION");
  });

  it("still documents the parameter as omittable", () => {
    // The model refused on the params description, not on a validator,
    // so the description is where the fix has to land too.
    const prompt = buildCompilerPrompt("assign a task", "invoice");
    expect(prompt).toContain("may be omitted where the stage declares its own");
  });
});
