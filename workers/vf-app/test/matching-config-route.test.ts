import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import {
  handleGetMatchingConfig,
  handleUpdateMatchingConfig,
  handleGetStandardMatchingRules,
  STANDARD_MATCHING_RULES,
} from "../src/matching-config-route.js";

/**
 * The write API for AP Setup's own Matching tab — decision 0472.
 *
 * `org_matching_config` has held since migration 0078 (decisions
 * 0465/0468/0469), reachable only by direct SQL until now — these are
 * the routes that give `ap-setup.js`'s own Matching tab a real way to
 * read and write it, tested the same way `approval-config-route.test.ts`
 * already tests its own sibling routes.
 */

beforeEach(async () => {
  await applyTestSchema();
});

describe("handleGetMatchingConfig", () => {
  it("reads the singleton row's own default state — zero-behaviour-preserving", async () => {
    const result = await handleGetMatchingConfig(env.DB);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      amountTolerancePct: 0,
      quantityTolerancePct: 0,
      quantityMatchingEnabled: true,
    });
  });

  it("reflects a value written by handleUpdateMatchingConfig", async () => {
    await handleUpdateMatchingConfig(env.DB, {
      amountTolerancePct: 5,
      quantityTolerancePct: 2.5,
      quantityMatchingEnabled: false,
    });
    const result = await handleGetMatchingConfig(env.DB);
    expect(result.body).toEqual({
      amountTolerancePct: 5,
      quantityTolerancePct: 2.5,
      quantityMatchingEnabled: false,
    });
  });
});

describe("handleUpdateMatchingConfig", () => {
  it("saves all three fields together", async () => {
    const result = await handleUpdateMatchingConfig(env.DB, {
      amountTolerancePct: 10,
      quantityTolerancePct: 1,
      quantityMatchingEnabled: true,
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      amountTolerancePct: 10,
      quantityTolerancePct: 1,
      quantityMatchingEnabled: true,
    });
  });

  it("422s when amountTolerancePct is missing or not a number", async () => {
    const result = await handleUpdateMatchingConfig(env.DB, {
      quantityTolerancePct: 1,
      quantityMatchingEnabled: true,
    });
    expect(result.status).toBe(422);
  });

  it("422s when amountTolerancePct is negative", async () => {
    const result = await handleUpdateMatchingConfig(env.DB, {
      amountTolerancePct: -1,
      quantityTolerancePct: 1,
      quantityMatchingEnabled: true,
    });
    expect(result.status).toBe(422);
  });

  it("422s when quantityTolerancePct is missing or not a number", async () => {
    const result = await handleUpdateMatchingConfig(env.DB, {
      amountTolerancePct: 1,
      quantityMatchingEnabled: true,
    });
    expect(result.status).toBe(422);
  });

  it("422s when quantityTolerancePct is negative", async () => {
    const result = await handleUpdateMatchingConfig(env.DB, {
      amountTolerancePct: 1,
      quantityTolerancePct: -1,
      quantityMatchingEnabled: true,
    });
    expect(result.status).toBe(422);
  });

  it("422s when quantityMatchingEnabled is missing or not a boolean", async () => {
    const result = await handleUpdateMatchingConfig(env.DB, {
      amountTolerancePct: 1,
      quantityTolerancePct: 1,
    });
    expect(result.status).toBe(422);
  });

  it("a failed write leaves the previous configuration untouched", async () => {
    await handleUpdateMatchingConfig(env.DB, {
      amountTolerancePct: 3,
      quantityTolerancePct: 3,
      quantityMatchingEnabled: false,
    });
    const rejected = await handleUpdateMatchingConfig(env.DB, {
      amountTolerancePct: -5,
      quantityTolerancePct: 3,
      quantityMatchingEnabled: false,
    });
    expect(rejected.status).toBe(422);

    const result = await handleGetMatchingConfig(env.DB);
    expect(result.body).toEqual({
      amountTolerancePct: 3,
      quantityTolerancePct: 3,
      quantityMatchingEnabled: false,
    });
  });
});

/**
 * **Standard matching rules — decision 0474.** The checkbox only
 * enables/disables a rule that already exists; nothing here compiles
 * or activates one. Seeding mirrors `rules-list.test.ts`'s own
 * `addRule` helper directly, since this reads the identical tables.
 */
describe("handleGetStandardMatchingRules", () => {
  async function seedStage(stageId: string, ruleSetId: string, processId = "ap", processName = "AP") {
    await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES (?, ?)").bind(processId, processName).run();
    await env.DB.prepare("INSERT INTO rule_sets (id, name, mode) VALUES (?, 'Matching rules', 'all_matches')")
      .bind(ruleSetId)
      .run();
    await env.DB.prepare(
      "INSERT INTO process_stages (id, process_id, name, sequence, rule_set_id) VALUES (?, ?, 'Matching', 1, ?)"
    )
      .bind(stageId, processId, ruleSetId)
      .run();
  }

  async function addRule(
    id: string,
    ruleSetId: string,
    name: string,
    { enabled = 1, approved = false, examples = 0, confirmed = 0 } = {}
  ) {
    await env.DB.prepare("INSERT INTO rules (id, rule_set_id, sort_order, enabled, name) VALUES (?, ?, 0, ?, ?)")
      .bind(id, ruleSetId, enabled, name)
      .run();
    await env.DB.prepare(
      `INSERT INTO rule_versions (rule_id, version, source_text, compiled_json, compiled_by, approved_by, approved_at)
       VALUES (?, 1, 'x', '{}', 'u-dan', ?, ?)`
    )
      .bind(id, approved ? "u-dan" : null, approved ? "2026-09-01" : null)
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

  it("returns all four canonical names with no matches when nothing has been authored yet", async () => {
    const result = await handleGetStandardMatchingRules(env.DB);
    expect(result.status).toBe(200);
    const body = result.body as { standardRules: Array<{ key: string; matches: unknown[] }> };
    expect(body.standardRules).toHaveLength(4);
    expect(body.standardRules.map((r) => r.key)).toEqual(
      STANDARD_MATCHING_RULES.map((r) => r.key)
    );
    expect(body.standardRules.every((r) => r.matches.length === 0)).toBe(true);
  });

  it("finds a live rule (approved and enabled) authored on any stage, by exact name", async () => {
    await seedStage("matching", "rs-match");
    await addRule("r-price", "rs-match", "Standard rule: Price mismatch", { enabled: 1, approved: true, examples: 2, confirmed: 2 });

    const result = await handleGetStandardMatchingRules(env.DB);
    const body = result.body as { standardRules: Array<{ key: string; matches: Array<Record<string, unknown>> }> };
    const priceEntry = body.standardRules.find((r) => r.key === "price_mismatch")!;
    expect(priceEntry.matches).toEqual([
      { ruleId: "r-price", stageName: "Matching", processName: "AP", enabled: true, state: "live" },
    ]);
  });

  it("distinguishes draft, awaiting_confirmation, paused and live", async () => {
    await seedStage("matching", "rs-match");
    await addRule("r-draft", "rs-match", "Standard rule: PO line not found", { enabled: 1, approved: false, examples: 0 });
    await addRule("r-awaiting", "rs-match", "Standard rule: Quantity mismatch", { enabled: 1, approved: false, examples: 2, confirmed: 1 });
    await addRule("r-paused", "rs-match", "Standard rule: Unit of measure mismatch", { enabled: 0, approved: true, examples: 1, confirmed: 1 });

    const result = await handleGetStandardMatchingRules(env.DB);
    const body = result.body as { standardRules: Array<{ key: string; matches: Array<{ state: string }> }> };
    const stateFor = (key: string) => body.standardRules.find((r) => r.key === key)!.matches[0].state;
    expect(stateFor("po_line_not_found")).toBe("draft");
    expect(stateFor("quantity_mismatch")).toBe("awaiting_confirmation");
    expect(stateFor("unit_mismatch")).toBe("paused");
  });

  it("shows more than one match separately, never silently picking one — the same name authored on two stages", async () => {
    await seedStage("matching-eu", "rs-match-eu", "ap-eu", "AP Europe");
    await seedStage("matching-us", "rs-match-us", "ap-us", "AP US");
    await addRule("r-eu", "rs-match-eu", "Standard rule: Price mismatch", { enabled: 1, approved: true, examples: 1, confirmed: 1 });
    await addRule("r-us", "rs-match-us", "Standard rule: Price mismatch", { enabled: 0, approved: true, examples: 1, confirmed: 1 });

    const result = await handleGetStandardMatchingRules(env.DB);
    const body = result.body as { standardRules: Array<{ key: string; matches: Array<Record<string, unknown>> }> };
    const priceEntry = body.standardRules.find((r) => r.key === "price_mismatch")!;
    expect(priceEntry.matches).toHaveLength(2);
    expect(priceEntry.matches.map((m) => m.stageName).sort()).toEqual(["Matching", "Matching"]);
    expect(priceEntry.matches.map((m) => m.processName).sort()).toEqual(["AP Europe", "AP US"]);
  });

  it("ignores a rule with an unrelated name entirely", async () => {
    await seedStage("matching", "rs-match");
    await addRule("r-other", "rs-match", "Hold any invoice over 10,000 euros.", { enabled: 1, approved: true, examples: 1, confirmed: 1 });

    const result = await handleGetStandardMatchingRules(env.DB);
    const body = result.body as { standardRules: Array<{ matches: unknown[] }> };
    expect(body.standardRules.every((r) => r.matches.length === 0)).toBe(true);
  });

  it("every standard rule carries a suggested sentence naming its own fact", async () => {
    const result = await handleGetStandardMatchingRules(env.DB);
    const body = result.body as { standardRules: Array<{ fact: string; suggestedSentence: string }> };
    for (const entry of body.standardRules) {
      expect(entry.suggestedSentence.length).toBeGreaterThan(0);
      expect(entry.fact).toMatch(/^po\.line_/);
    }
  });
});
