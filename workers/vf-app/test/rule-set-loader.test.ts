import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { loadActiveRuleSet } from "../src/rule-set-loader.js";

async function seedRuleSet(id: string, mode: "first_match" | "all_matches" = "first_match"): Promise<void> {
  await env.DB.prepare("INSERT INTO rule_sets (id, name, mode, status) VALUES (?, ?, ?, ?)")
    .bind(id, "test set", mode, "active")
    .run();
}

interface RuleSeed {
  ruleId: string;
  ruleSetId: string;
  sortOrder: number;
  enabled?: boolean;
  compiledJson?: string;
  approvedBy?: string | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  version?: number;
}

async function seedRule(seed: RuleSeed): Promise<void> {
  await env.DB.prepare("INSERT INTO rules (id, rule_set_id, sort_order, enabled) VALUES (?, ?, ?, ?)")
    .bind(seed.ruleId, seed.ruleSetId, seed.sortOrder, seed.enabled === false ? 0 : 1)
    .run();
  await env.DB.prepare(
    `INSERT INTO rule_versions
       (rule_id, version, source_text, compiled_json, compiled_by, approved_by, approved_at, effective_from, effective_to)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      seed.ruleId,
      seed.version ?? 1,
      "test source",
      seed.compiledJson ?? JSON.stringify({ conditions: { field: "BT-3", operator: "is_present" }, actions: [{ type: "flag" }] }),
      "test-model",
      seed.approvedBy ?? null,
      seed.approvedBy ? "2026-01-01T00:00:00.000Z" : null,
      seed.effectiveFrom ?? null,
      seed.effectiveTo ?? null
    )
    .run();
}

const NOW = new Date("2026-08-30T12:00:00.000Z");

beforeEach(async () => {
  await applyTestSchema();
});

describe("loadActiveRuleSet — the not-found case", () => {
  it("returns null when the rule set does not exist", async () => {
    const result = await loadActiveRuleSet(env.DB, "does-not-exist", NOW);
    expect(result).toBeNull();
  });

  it("returns a rule set with an empty rules array when it exists but nothing is activated yet", async () => {
    await seedRuleSet("rs1");
    const result = await loadActiveRuleSet(env.DB, "rs1", NOW);
    expect(result).toEqual({ id: "rs1", mode: "first_match", rules: [] });
  });
});

describe("loadActiveRuleSet — the filtering conditions, each proven independently", () => {
  it("includes a rule that is enabled, approved, and within its effective window", async () => {
    await seedRuleSet("rs1");
    await seedRule({
      ruleId: "r1",
      ruleSetId: "rs1",
      sortOrder: 0,
      approvedBy: "alice",
      effectiveFrom: "2026-08-01T00:00:00.000Z",
    });
    const result = await loadActiveRuleSet(env.DB, "rs1", NOW);
    expect(result?.rules).toHaveLength(1);
    expect(result?.rules[0].id).toBe("r1");
  });

  it("excludes a rule that was never approved — a compiled but unconfirmed draft", async () => {
    await seedRuleSet("rs1");
    // Isolating the approval check specifically: effective_from is
    // set to a valid past date, so only approved_by being null can be
    // responsible for exclusion here — otherwise this test would pass
    // even with the approval check entirely removed, since the
    // default null effective_from would exclude the row anyway for an
    // unrelated reason. Confirmed this distinction matters: an earlier
    // version of this test left effective_from at its null default
    // and passed even with both approval checks in the real query
    // deliberately removed.
    await seedRule({
      ruleId: "r1",
      ruleSetId: "rs1",
      sortOrder: 0,
      approvedBy: null,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
    });
    const result = await loadActiveRuleSet(env.DB, "rs1", NOW);
    expect(result?.rules).toEqual([]);
  });

  it("excludes a rule that is disabled, even if approved and effective", async () => {
    await seedRuleSet("rs1");
    await seedRule({
      ruleId: "r1",
      ruleSetId: "rs1",
      sortOrder: 0,
      enabled: false,
      approvedBy: "alice",
      effectiveFrom: "2026-08-01T00:00:00.000Z",
    });
    const result = await loadActiveRuleSet(env.DB, "rs1", NOW);
    expect(result?.rules).toEqual([]);
  });

  it("excludes a rule whose effective_from is still in the future", async () => {
    await seedRuleSet("rs1");
    await seedRule({
      ruleId: "r1",
      ruleSetId: "rs1",
      sortOrder: 0,
      approvedBy: "alice",
      effectiveFrom: "2026-09-15T00:00:00.000Z", // after NOW
    });
    const result = await loadActiveRuleSet(env.DB, "rs1", NOW);
    expect(result?.rules).toEqual([]);
  });

  it("excludes a rule whose effective_to has already passed", async () => {
    await seedRuleSet("rs1");
    await seedRule({
      ruleId: "r1",
      ruleSetId: "rs1",
      sortOrder: 0,
      approvedBy: "alice",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: "2026-06-01T00:00:00.000Z", // before NOW
    });
    const result = await loadActiveRuleSet(env.DB, "rs1", NOW);
    expect(result?.rules).toEqual([]);
  });

  it("includes a rule with a null effective_to — no expiry set", async () => {
    await seedRuleSet("rs1");
    await seedRule({
      ruleId: "r1",
      ruleSetId: "rs1",
      sortOrder: 0,
      approvedBy: "alice",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: null,
    });
    const result = await loadActiveRuleSet(env.DB, "rs1", NOW);
    expect(result?.rules).toHaveLength(1);
  });
});

describe("loadActiveRuleSet — ordering and content", () => {
  it("orders rules by sort_order, not insertion order", async () => {
    await seedRuleSet("rs1");
    await seedRule({
      ruleId: "second",
      ruleSetId: "rs1",
      sortOrder: 1,
      approvedBy: "alice",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
    });
    await seedRule({
      ruleId: "first",
      ruleSetId: "rs1",
      sortOrder: 0,
      approvedBy: "alice",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
    });
    const result = await loadActiveRuleSet(env.DB, "rs1", NOW);
    expect(result?.rules.map((r) => r.id)).toEqual(["first", "second"]);
  });

  it("returns the rule set's real mode, not a hardcoded default", async () => {
    await seedRuleSet("rs1", "all_matches");
    const result = await loadActiveRuleSet(env.DB, "rs1", NOW);
    expect(result?.mode).toBe("all_matches");
  });

  it("parses conditions and actions out of the stored compiled_json correctly", async () => {
    await seedRuleSet("rs1");
    await seedRule({
      ruleId: "r1",
      ruleSetId: "rs1",
      sortOrder: 0,
      approvedBy: "alice",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      compiledJson: JSON.stringify({
        conditions: { field: "BT-112", operator: "greater_than", value: 5000 },
        actions: [{ type: "route_to", params: { queue: "finance" } }],
      }),
    });
    const result = await loadActiveRuleSet(env.DB, "rs1", NOW);
    expect(result?.rules[0]).toEqual({
      id: "r1",
      version: 1,
      conditions: { field: "BT-112", operator: "greater_than", value: 5000 },
      actions: [{ type: "route_to", params: { queue: "finance" } }],
    });
  });

  it("includes only activated rules alongside unactivated drafts in the same set", async () => {
    await seedRuleSet("rs1");
    await seedRule({
      ruleId: "activated",
      ruleSetId: "rs1",
      sortOrder: 0,
      approvedBy: "alice",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
    });
    await seedRule({ ruleId: "draft", ruleSetId: "rs1", sortOrder: 1, approvedBy: null });
    const result = await loadActiveRuleSet(env.DB, "rs1", NOW);
    expect(result?.rules.map((r) => r.id)).toEqual(["activated"]);
  });
});
