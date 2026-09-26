import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import {
  handleGetApTeamEmail,
  handleSetApTeamEmail,
  handleGetApTeamEmailAvailability,
} from "../src/ap-team-email-route.js";

beforeEach(async () => {
  await applyTestSchema();
});

describe("the AP team's own email address — decision 0498", () => {
  it("is null until an operator sets one", async () => {
    const result = await handleGetApTeamEmail(env.DB);
    expect(result.body).toEqual({ apTeamEmail: null });
  });

  it("reports unconfigured to the narrow availability check too", async () => {
    const result = await handleGetApTeamEmailAvailability(env.DB);
    expect(result.body).toEqual({ configured: false });
  });

  it("can be set, and then read back", async () => {
    const set = await handleSetApTeamEmail(env.DB, { apTeamEmail: "ap-team@acme.com" });
    expect(set.status).toBe(200);

    expect((await handleGetApTeamEmail(env.DB)).body).toEqual({ apTeamEmail: "ap-team@acme.com" });
    expect((await handleGetApTeamEmailAvailability(env.DB)).body).toEqual({ configured: true });
  });

  it("refuses a value that doesn't look like an email address", async () => {
    const result = await handleSetApTeamEmail(env.DB, { apTeamEmail: "not an email" });
    expect(result.status).toBe(422);
  });

  it("clears it back to unconfigured with null", async () => {
    await handleSetApTeamEmail(env.DB, { apTeamEmail: "ap-team@acme.com" });
    const cleared = await handleSetApTeamEmail(env.DB, { apTeamEmail: null });
    expect(cleared.body).toEqual({ apTeamEmail: null });
    expect((await handleGetApTeamEmailAvailability(env.DB)).body).toEqual({ configured: false });
  });

  it("treats a blank string the same as null", async () => {
    const result = await handleSetApTeamEmail(env.DB, { apTeamEmail: "   " });
    expect(result.body).toEqual({ apTeamEmail: null });
  });

  it("rejects a non-string, non-null value", async () => {
    const result = await handleSetApTeamEmail(env.DB, { apTeamEmail: 42 });
    expect(result.status).toBe(400);
  });
});
