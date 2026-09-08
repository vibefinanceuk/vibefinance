import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import {
  handleListRules,
  handleRuleStages,
  ensureRuleSetForStage,
  handleGetRule,
  handleSetRuleEnabled,
} from "../src/rules-list-route.js";

/**
 * The rules that exist, by stage — decision 0149.
 *
 * **No route listed rules.** Compiling, confirming and activating all
 * have one; seeing what is already running does not — the same gap
 * decision 0128 found with processes.
 */

async function seed() {
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
  await env.DB.prepare(
    "INSERT INTO rule_sets (id, name, mode) VALUES ('rs-val', 'Validation rules', 'all_matches')"
  ).run();
  await env.DB.prepare(
    "INSERT INTO process_stages (id, process_id, name, sequence, rule_set_id) VALUES ('validation', 'ap', 'Validation', 2, 'rs-val')"
  ).run();
  // A stage with no rules at all, which must still appear.
  await env.DB.prepare(
    "INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('coding', 'ap', 'Coding', 3)"
  ).run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO org_users (id, email, name) VALUES ('u-dan', 'd@x.com', 'Dan')"
  ).run();

  /**
   * Membership of the process's current version — decision 0160.
   *
   * `process-route.ts` does this when a stage is created through it.
   * These tests insert directly, so they do it themselves: **a stage in
   * no version is a stage the workflow engine steps straight past.**
   */
  await env.DB.prepare(
    `INSERT OR IGNORE INTO process_stage_versions (process_id, version, stage_id, sequence)
     SELECT p.id, p.version, s.id, s.sequence
     FROM process_stages s JOIN processes p ON p.id = s.process_id`
  ).run();

}

async function addRule(
  id: string,
  sourceText: string,
  { enabled = 1, approved = false, examples = 0, confirmed = 0 } = {}
) {
  await env.DB.prepare(
    "INSERT INTO rules (id, rule_set_id, sort_order, enabled) VALUES (?, 'rs-val', 0, ?)"
  )
    .bind(id, enabled)
    .run();
  await env.DB.prepare(
    `INSERT INTO rule_versions (rule_id, version, source_text, compiled_json, compiled_by, approved_by, approved_at)
     VALUES (?, 1, ?, '{}', 'u-dan', ?, ?)`
  )
    .bind(id, sourceText, approved ? "u-dan" : null, approved ? "2026-09-01" : null)
    .run();

  for (let i = 0; i < examples; i++) {
    await env.DB.prepare(
      `INSERT INTO rule_examples (id, rule_id, rule_version, invoice_json, expect_match, confirmed_by)
       VALUES (?, ?, 1, '{}', 1, ?)`
    )
      .bind(`${id}-e${i}`, id, i < confirmed ? "u-dan" : null)
      .run();
  }
}

beforeEach(async () => {
  await applyTestSchema();
  await seed();
});

describe("what the list shows", () => {
  it("shows the sentence somebody wrote, not the compiled rule", async () => {
    // **A person recognises their own words**; nobody recognises
    // `{"field":"BT-112","operator":"greater_than"}`.
    await addRule("r-1", "Hold any invoice over 10,000 euros from a new supplier.");
    const body = (await handleListRules(env.DB, null)).body as {
      rules: { sourceText: string }[];
    };

    expect(body.rules[0].sourceText).toBe(
      "Hold any invoice over 10,000 euros from a new supplier."
    );
  });

  it("names the stage a rule runs at", async () => {
    // The operator's own point: a rule fires at a stage, and what it
    // can test depends on what has happened by then.
    await addRule("r-1", "A rule");
    const body = (await handleListRules(env.DB, null)).body as {
      rules: { stageName: string }[];
    };
    expect(body.rules[0].stageName).toBe("Validation");
  });

  it("filters to one stage when asked", async () => {
    await addRule("r-1", "A rule");
    const body = (await handleListRules(env.DB, "coding")).body as { rules: unknown[] };
    expect(body.rules).toHaveLength(0);
  });
});

describe("what state a rule is in", () => {
  /**
   * **Four words, not four columns.** The database records `enabled`,
   * `approved_at` and a count of confirmed examples; a person wants to
   * know whether it is running.
   */
  it("calls an approved, enabled rule live", async () => {
    await addRule("r-live", "A rule", { approved: true, enabled: 1 });
    const body = (await handleListRules(env.DB, null)).body as { rules: { state: string }[] };
    expect(body.rules[0].state).toBe("live");
  });

  it("distinguishes paused from draft", async () => {
    // **One was trusted once and the other never has been**, which is
    // a difference worth a word.
    await addRule("r-paused", "A rule", { approved: true, enabled: 0 });
    const body = (await handleListRules(env.DB, null)).body as { rules: { state: string }[] };
    expect(body.rules[0].state).toBe("paused");
  });

  it("says how many examples are still waiting", async () => {
    // So the list can say "2 to confirm" rather than making somebody
    // open the rule to find out.
    await addRule("r-wait", "A rule", { examples: 3, confirmed: 1 });
    const body = (await handleListRules(env.DB, null)).body as {
      rules: { state: string; awaiting: number }[];
    };

    expect(body.rules[0].state).toBe("awaiting_confirmation");
    expect(body.rules[0].awaiting).toBe(2);
  });

  it("calls one with no examples a draft", async () => {
    await addRule("r-draft", "A rule");
    const body = (await handleListRules(env.DB, null)).body as { rules: { state: string }[] };
    expect(body.rules[0].state).toBe("draft");
  });
});

describe("the stages themselves", () => {
  it("shows a stage with no rules rather than hiding it", async () => {
    // **Somebody wondering why nothing happens at Coding** needs to see
    // that Coding is empty, which an omitted row cannot tell them.
    await addRule("r-1", "A rule");
    const body = (await handleRuleStages(env.DB)).body as {
      stages: { id: string; ruleCount: number }[];
    };

    const coding = body.stages.find((s) => s.id === "coding");
    expect(coding).toBeDefined();
    expect(coding?.ruleCount).toBe(0);
  });

  it("returns them in sequence, which is the point", async () => {
    const body = (await handleRuleStages(env.DB)).body as { stages: { id: string }[] };
    expect(body.stages.map((s) => s.id)).toEqual(["validation", "coding"]);
  });

  it("counts the rules at each", async () => {
    await addRule("r-1", "One");
    await addRule("r-2", "Two");
    const body = (await handleRuleStages(env.DB)).body as {
      stages: { id: string; ruleCount: number }[];
    };
    expect(body.stages.find((s) => s.id === "validation")?.ruleCount).toBe(2);
  });
});

describe("giving a stage somewhere to put rules (decision 0154)", () => {
  /**
   * **Nothing created a rule set.** Every one until now came from a
   * migration or by hand, which is why nobody had noticed the screen
   * could only add rules where rules already existed.
   */
  it("creates one for a stage that has none", async () => {
    const result = await ensureRuleSetForStage(env.DB, "coding");
    expect("ruleSetId" in result).toBe(true);

    const stage = await env.DB.prepare(
      "SELECT rule_set_id FROM process_stages WHERE id = 'coding'"
    ).first<{ rule_set_id: string }>();
    expect(stage?.rule_set_id).toBe("rs-coding");
  });

  it("returns the existing one rather than a second", async () => {
    // Called on the way in every time somebody writes a rule, so it
    // must be safe to call twice.
    const first = await ensureRuleSetForStage(env.DB, "validation");
    const second = await ensureRuleSetForStage(env.DB, "validation");
    expect(first).toEqual(second);

    const count = await env.DB.prepare("SELECT count(*) AS n FROM rule_sets").first<{
      n: number;
    }>();
    expect(count?.n).toBe(1);
  });

  it("matches all rules rather than stopping at the first", async () => {
    // **A stage where several rules apply should apply them all.**
    // `first_match` would let the order rules happen to be in decide
    // which ones counted.
    await ensureRuleSetForStage(env.DB, "coding");
    const set = await env.DB.prepare("SELECT mode FROM rule_sets WHERE id = 'rs-coding'").first<{
      mode: string;
    }>();
    expect(set?.mode).toBe("all_matches");
  });

  it("refuses a stage that does not exist", async () => {
    const result = await ensureRuleSetForStage(env.DB, "nowhere");
    expect("error" in result).toBe(true);
  });
});

describe("pausing a rule (decision 0155)", () => {
  /**
   * **Nothing changed `rules.enabled` before this.** A rule was created
   * enabled and stayed so; the only way to stop one was to delete it,
   * which loses the sentence and every confirmed example.
   */
  it("pauses one", async () => {
    await addRule("r-1", "A rule", { approved: true });
    await handleSetRuleEnabled(env.DB, "r-1", false);

    const body = (await handleListRules(env.DB, null)).body as { rules: { state: string }[] };
    expect(body.rules[0].state).toBe("paused");
  });

  it("resumes one without a second trip through the gate", async () => {
    // **Pausing is not unapproving.** The version keeps its approval
    // and its confirmed examples, and the gate exists to prove somebody
    // read the rule — which they did.
    await addRule("r-1", "A rule", { approved: true });
    await handleSetRuleEnabled(env.DB, "r-1", false);
    await handleSetRuleEnabled(env.DB, "r-1", true);

    const body = (await handleListRules(env.DB, null)).body as { rules: { state: string }[] };
    expect(body.rules[0].state).toBe("live");
  });

  it("refuses anything that is not true or false", async () => {
    await addRule("r-1", "A rule");
    expect((await handleSetRuleEnabled(env.DB, "r-1", "yes")).status).toBe(400);
  });

  it("404s a rule that does not exist", async () => {
    expect((await handleSetRuleEnabled(env.DB, "nope", false)).status).toBe(404);
  });
});

describe("opening a rule (decision 0155)", () => {
  it("shows every version, newest first", async () => {
    // **The list shows the latest; this shows the history.** Somebody
    // asking "why did this change" needs to see that v2 replaced v1.
    await addRule("r-1", "The first wording", { approved: true });
    await env.DB.prepare(
      `INSERT INTO rule_versions (rule_id, version, source_text, compiled_json, compiled_by)
       VALUES ('r-1', 2, 'The second wording', '{}', 'u-dan')`
    ).run();

    const body = (await handleGetRule(env.DB, "r-1")).body as {
      versions: { version: number; sourceText: string }[];
    };

    expect(body.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(body.versions[0].sourceText).toBe("The second wording");
  });

  it("says which version is actually running", async () => {
    // **A rule can hold three versions where one is live**, and
    // "which" is the first thing anybody asks.
    await addRule("r-1", "A rule", { approved: true });
    const body = (await handleGetRule(env.DB, "r-1")).body as {
      versions: { isLive: boolean }[];
    };
    expect(body.versions[0].isLive).toBe(true);
  });

  it("says nothing is live when the rule is paused", async () => {
    await addRule("r-1", "A rule", { approved: true });
    await handleSetRuleEnabled(env.DB, "r-1", false);

    const body = (await handleGetRule(env.DB, "r-1")).body as {
      versions: { isLive: boolean }[];
    };
    expect(body.versions.every((v) => !v.isLive)).toBe(true);
  });

  it("survives a version whose compiled rule will not parse", async () => {
    // Saying nothing is better than a crash.
    await addRule("r-1", "A rule");
    await env.DB.prepare("UPDATE rule_versions SET compiled_json = 'not json' WHERE rule_id = 'r-1'").run();

    const result = await handleGetRule(env.DB, "r-1");
    expect(result.status).toBe(200);
  });

  it("404s a rule that does not exist", async () => {
    expect((await handleGetRule(env.DB, "nope")).status).toBe(404);
  });
});

describe("the routes do not shadow each other (decision 0155)", () => {
  /**
   * **`^/rules/([^/]+)$` matches `stages` too.** The rule detail route
   * was placed before the stage list and would have answered it with
   * *"no rule called stages"* — a 404 that looks like a missing rule
   * and is a routing mistake.
   *
   * Caught by reading the pattern rather than by any test, which is
   * why this one exists.
   */
  it("still lists stages, rather than looking for a rule called 'stages'", async () => {
    const res = await SELF.fetch("https://app.example.com/rules/stages");
    // 401 for want of a credential means the route was reached. A 404
    // would mean it was read as a rule id.
    expect(res.status).toBe(401);
  });

  it("still compiles, rather than looking for a rule called 'compile'", async () => {
    const res = await SELF.fetch("https://app.example.com/rules/compile", { method: "POST" });
    expect(res.status).not.toBe(404);
  });
});
