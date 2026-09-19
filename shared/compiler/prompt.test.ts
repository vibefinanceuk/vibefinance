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

describe("real teams to resolve against — the compiler's own team-id bug", () => {
  /**
   * **The bug this parameter exists to fix.** WORKED_EXAMPLE taught the
   * model, by example, to write `"team": "AP team"` — the sentence's own
   * words — instead of a real `org_teams.id` like `"ap-team"`. Worse,
   * the compiler was never given the real team list at all, so even a
   * model that ignored the bad example had nothing to resolve against.
   * task-route.ts's `handleCreateTask` 404s on anything that isn't a
   * real id, and workflow-engine.ts turns that 404 into a silently
   * swallowed 500 — meaning task creation had never worked for any rule
   * whose sentence named a team by a phrase rather than its id.
   */
  const TEAMS = [
    { id: "ap-team", name: "AP Team" },
    { id: "ap-review", name: "AP Review" },
  ];

  it("lists each real team's id and name when teams are given", () => {
    const prompt = buildCompilerPrompt("assign a task to the AP team", "invoice", null, TEAMS);
    expect(prompt).toContain('"ap-team"');
    expect(prompt).toContain("AP Team");
    expect(prompt).toContain('"ap-review"');
    expect(prompt).toContain("AP Review");
  });

  it("instructs the model to resolve by meaning, never by copying the sentence's words", () => {
    const prompt = buildCompilerPrompt("assign a task to the AP team", "invoice", null, TEAMS);
    expect(prompt).toMatch(/not by copying its words/);
    expect(prompt).toContain('never the literal phrase "AP team"');
  });

  it("tells the model to refuse rather than invent an id when nothing matches", () => {
    const prompt = buildCompilerPrompt("assign a task to the AP team", "invoice", null, TEAMS);
    expect(prompt.toLowerCase()).toContain("refuse rather than invent");
  });

  it("says nothing where no teams are given, which is every call site before this fix", () => {
    const prompt = buildCompilerPrompt("assign a task to the AP team");
    expect(prompt).not.toContain("REAL TEAMS");
  });

  it("says nothing for an explicitly empty team list", () => {
    const prompt = buildCompilerPrompt("assign a task to the AP team", "invoice", null, []);
    expect(prompt).not.toContain("REAL TEAMS");
  });

  it("the worked example itself resolves to a real id, not the sentence's words", () => {
    // This is the other half of the original bug: the few-shot example
    // shown to the model on every single compile, independent of
    // whether a live teams list is passed at all.
    const prompt = buildCompilerPrompt("test");
    expect(prompt).toContain('"team": "ap-team"');
    expect(prompt).not.toContain('"team": "AP team"');
  });

  it("the expense worked example resolves to a real id too", () => {
    const prompt = buildCompilerPrompt("test", "expense");
    expect(prompt).toContain('"team": "finance-team"');
    expect(prompt).not.toContain('"team": "finance team"');
  });
});

describe("real stages to resolve against — the same bug, found in route_to", () => {
  /**
   * **Found independently of the teams bug**, in a live rule: "route
   * the invoice to AP Review" compiled to `"stage": "AP Review"` — the
   * stage's *name*, not its real id `"review"`. Unlike the teams bug,
   * WORKED_EXAMPLE's own route_to example already used a real id
   * ("payment-eligible"), so this wasn't taught by a bad example — the
   * compiler simply had no real stage list to resolve a sentence's
   * stage mention against, so it guessed from the words themselves.
   * workflow-engine.ts 422s a route_to naming an unknown stage, so
   * this failure is loud rather than silent, but still means the rule
   * can never do what it says.
   */
  const STAGES = [
    { id: "review", name: "AP Review" },
    { id: "payment-eligible", name: "Payment-eligible" },
  ];

  it("lists each real stage's id and name when stages are given", () => {
    const prompt = buildCompilerPrompt("route to AP Review", "invoice", null, [], STAGES);
    expect(prompt).toContain('"review"');
    expect(prompt).toContain("AP Review");
    expect(prompt).toContain('"payment-eligible"');
  });

  it("instructs the model to resolve by meaning, never by copying the sentence's words", () => {
    const prompt = buildCompilerPrompt("route to AP Review", "invoice", null, [], STAGES);
    expect(prompt).toMatch(/not by copying its words/);
    expect(prompt).toContain("never the display name itself");
  });

  it("tells the model to refuse rather than invent an id when nothing matches", () => {
    const prompt = buildCompilerPrompt("route to AP Review", "invoice", null, [], STAGES);
    expect(prompt.toLowerCase()).toContain("refuse rather than invent");
  });

  it("says nothing where no stages are given, which is every call site before this fix", () => {
    const prompt = buildCompilerPrompt("route to AP Review");
    expect(prompt).not.toContain("REAL STAGES");
  });

  it("says nothing for an explicitly empty stage list", () => {
    const prompt = buildCompilerPrompt("route to AP Review", "invoice", null, [], []);
    expect(prompt).not.toContain("REAL STAGES");
  });

  it("the REAL TEAMS and REAL STAGES sections coexist without interfering", () => {
    const prompt = buildCompilerPrompt(
      "route to AP Review and assign a task to the AP team",
      "invoice",
      null,
      [{ id: "ap-team", name: "AP Team" }],
      STAGES
    );
    expect(prompt).toContain("REAL TEAMS");
    expect(prompt).toContain("REAL STAGES");
  });
});
