import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleSetStageOffersFieldRestrictions } from "../src/field-visibility-route.js";

/**
 * Whether the Stage Restrictions screen (decision 0483) offers a given
 * stage at all — decision 0485.
 *
 * Reported live: Intake ("only used transitionary so that invoices can
 * be extracted from a source") and Payment Eligible ("another queue
 * pending delivery to the ERP and cannot be retrieved from") both
 * showed an Account Coding restriction checkbox, though neither stage
 * can ever have a person keying a line. The fix is an explicit,
 * per-stage flag an operator sets once — not a heuristic inferred from
 * `rule_set_id` or `required_permission`, which risks hiding a stage
 * that genuinely needs configuring one day (Approval, AP Review).
 */

async function seedStage(id: string, sequence = 1) {
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
  await env.DB.prepare(
    `INSERT INTO process_stages (id, process_id, name, sequence) VALUES (?, 'ap', ?, ?)`
  )
    .bind(id, id, sequence)
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
});

describe("handleSetStageOffersFieldRestrictions", () => {
  it("400s a non-boolean offer", async () => {
    await seedStage("intake");
    const result = await handleSetStageOffersFieldRestrictions(env.DB, "intake", "no");
    expect(result.status).toBe(400);
  });

  it("400s a missing offer", async () => {
    await seedStage("intake");
    const result = await handleSetStageOffersFieldRestrictions(env.DB, "intake", undefined);
    expect(result.status).toBe(400);
  });

  it("404s a stage that does not exist", async () => {
    const result = await handleSetStageOffersFieldRestrictions(env.DB, "does-not-exist", false);
    expect(result.status).toBe(404);
  });

  it("turns a stage off, and it stays off on read", async () => {
    await seedStage("intake");

    const result = await handleSetStageOffersFieldRestrictions(env.DB, "intake", false);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ stageId: "intake", offerFieldRestrictions: false });

    const row = await env.DB.prepare("SELECT offer_field_restrictions FROM process_stages WHERE id = 'intake'").first<{
      offer_field_restrictions: number;
    }>();
    expect(row?.offer_field_restrictions).toBe(0);
  });

  it("turns a stage back on", async () => {
    await seedStage("approval");
    await handleSetStageOffersFieldRestrictions(env.DB, "approval", false);

    const result = await handleSetStageOffersFieldRestrictions(env.DB, "approval", true);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ stageId: "approval", offerFieldRestrictions: true });

    const row = await env.DB.prepare("SELECT offer_field_restrictions FROM process_stages WHERE id = 'approval'").first<{
      offer_field_restrictions: number;
    }>();
    expect(row?.offer_field_restrictions).toBe(1);
  });

  it("leaves every other stage's own flag untouched", async () => {
    // A property of the one stage named, not a global switch.
    await seedStage("intake", 1);
    await seedStage("approval", 2);

    await handleSetStageOffersFieldRestrictions(env.DB, "intake", false);

    const approvalRow = await env.DB.prepare(
      "SELECT offer_field_restrictions FROM process_stages WHERE id = 'approval'"
    ).first<{ offer_field_restrictions: number }>();
    expect(approvalRow?.offer_field_restrictions).toBe(1);
  });
});
