import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleGetMatchingConfig, handleUpdateMatchingConfig } from "../src/matching-config-route.js";

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
