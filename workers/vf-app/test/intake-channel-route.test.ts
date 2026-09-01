import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCreateIntakeChannel } from "../src/intake-channel-route.js";
import { handleCreateProcess } from "../src/process-route.js";

beforeEach(async () => {
  await applyTestSchema();
});

describe("handleCreateIntakeChannel", () => {
  it("400s when id or name is missing", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "AP" });
    const result = await handleCreateIntakeChannel(env.DB, "p1", { id: "ic1" });
    expect(result.status).toBe(400);
  });

  it("404s when the process does not exist", async () => {
    const result = await handleCreateIntakeChannel(env.DB, "does-not-exist", { id: "ic1", name: "Email" });
    expect(result.status).toBe(404);
  });

  it("creates a channel scoped to a real process", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "AP" });
    const result = await handleCreateIntakeChannel(env.DB, "p1", { id: "ic1", name: "Email" });
    expect(result.status).toBe(201);
    const row = await env.DB.prepare("SELECT process_id, name FROM intake_channels WHERE id = ?").bind("ic1").first();
    expect(row).toEqual({ process_id: "p1", name: "Email" });
  });

  it("409s on a duplicate id", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "AP" });
    await handleCreateIntakeChannel(env.DB, "p1", { id: "ic1", name: "Email" });
    const result = await handleCreateIntakeChannel(env.DB, "p1", { id: "ic1", name: "Mailroom" });
    expect(result.status).toBe(409);
  });

  it("409s on a duplicate channel NAME within the same process — the real flexibility test: adding a genuinely new one still works fine", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "AP" });
    await handleCreateIntakeChannel(env.DB, "p1", { id: "ic1", name: "Email" });
    const duplicate = await handleCreateIntakeChannel(env.DB, "p1", { id: "ic2", name: "Email" });
    expect(duplicate.status).toBe(409);

    // The actual point of this whole feature: adding a brand new
    // channel — one that was never anticipated when this process was
    // first set up — is just an ordinary, successful API call.
    const genuinelyNew = await handleCreateIntakeChannel(env.DB, "p1", { id: "ic3", name: "WhatsApp Bot" });
    expect(genuinelyNew.status).toBe(201);
  });

  it("the same channel NAME is fine across two DIFFERENT processes — scoped per process, not global", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "AP" });
    await handleCreateProcess(env.DB, { id: "p2", name: "Expense" });
    await handleCreateIntakeChannel(env.DB, "p1", { id: "ic1", name: "Email" });
    const result = await handleCreateIntakeChannel(env.DB, "p2", { id: "ic2", name: "Email" });
    expect(result.status).toBe(201);
  });

  it("a customer can build up a genuinely per-process list, matching the real AP vs AR example from the design conversation", async () => {
    await handleCreateProcess(env.DB, { id: "ap-live", name: "Standard AP" });
    await handleCreateProcess(env.DB, { id: "ar-live", name: "Standard AR" });

    for (const name of ["Email", "Mailroom", "EDI", "Tax Authority", "Supplier Portal"]) {
      const result = await handleCreateIntakeChannel(env.DB, "ap-live", { id: crypto.randomUUID(), name });
      expect(result.status).toBe(201);
    }
    for (const name of ["Billing System A", "Billing System B", "Order Fulfillment A", "Order Fulfillment B"]) {
      const result = await handleCreateIntakeChannel(env.DB, "ar-live", { id: crypto.randomUUID(), name });
      expect(result.status).toBe(201);
    }

    const apCount = await env.DB.prepare("SELECT count(*) AS n FROM intake_channels WHERE process_id = ?")
      .bind("ap-live")
      .first();
    const arCount = await env.DB.prepare("SELECT count(*) AS n FROM intake_channels WHERE process_id = ?")
      .bind("ar-live")
      .first();
    expect(apCount).toEqual({ n: 5 });
    expect(arCount).toEqual({ n: 4 });
  });
});
