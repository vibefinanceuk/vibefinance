import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { getCostObjectRule, handleGetCodingConfig, handleUpdateCodingConfig } from "../src/coding-config-route.js";

/** AP Setup's Account Coding settings — decision 0540. */
describe("the cost centre / project rule (decision 0540)", () => {
  beforeEach(async () => {
    await applyTestSchema();
  });

  it("starts as either/or, the operator's default", async () => {
    expect(await handleGetCodingConfig(env.DB)).toEqual({ status: 200, body: { costObjectRule: "exclusive" } });
  });

  it("is written whole, and refuses anything but the two rules", async () => {
    expect(await handleUpdateCodingConfig(env.DB, { costObjectRule: "both" })).toEqual({ status: 200, body: { costObjectRule: "both" } });
    expect(await getCostObjectRule(env.DB)).toBe("both");
    expect((await handleUpdateCodingConfig(env.DB, { costObjectRule: "sometimes" })).status).toBe(422);
    expect((await handleUpdateCodingConfig(env.DB, {})).status).toBe(422);
    expect(await getCostObjectRule(env.DB)).toBe("both");
  });

  it("imposes nothing when the setting cannot be read (before migration 0098)", async () => {
    await env.DB.prepare("DROP TABLE org_coding_config").run();
    expect(await getCostObjectRule(env.DB)).toBe("both");
  });
});
