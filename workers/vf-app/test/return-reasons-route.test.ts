import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import {
  handleListActiveReturnReasons,
  handleListAllReturnReasons,
  handleCreateReturnReason,
  handleUpdateReturnReason,
} from "../src/return-reasons-route.js";

beforeEach(async () => {
  await applyTestSchema();
});

describe("the seeded defaults — migration 0087", () => {
  it("ships six active reasons, so the picker is never empty on day one", async () => {
    const result = await handleListActiveReturnReasons(env.DB);
    expect(result.status).toBe(200);
    const reasons = (result.body as { reasons: { id: string; active: boolean }[] }).reasons;
    expect(reasons).toHaveLength(6);
    expect(reasons.every((r) => r.active)).toBe(true);
  });
});

describe("creating a reason", () => {
  it("adds it, active by default", async () => {
    const result = await handleCreateReturnReason(env.DB, { id: "vat_dispute", label: "VAT dispute" });
    expect(result.status).toBe(201);
    expect((result.body as { active: boolean }).active).toBe(true);

    const active = (await handleListActiveReturnReasons(env.DB).then((r) => r.body)) as {
      reasons: { id: string }[];
    };
    expect(active.reasons.map((r) => r.id)).toContain("vat_dispute");
  });

  it("refuses a duplicate id", async () => {
    const result = await handleCreateReturnReason(env.DB, { id: "duplicate_invoice", label: "Another label" });
    expect(result.status).toBe(409);
  });

  it("requires both id and label", async () => {
    expect((await handleCreateReturnReason(env.DB, { id: "", label: "x" })).status).toBe(400);
    expect((await handleCreateReturnReason(env.DB, { id: "x", label: "" })).status).toBe(400);
    expect((await handleCreateReturnReason(env.DB, {})).status).toBe(400);
  });
});

describe("updating a reason", () => {
  it("renames it, leaving active and sortOrder untouched", async () => {
    const result = await handleUpdateReturnReason(env.DB, "other", { label: "Other reason (renamed)" });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ id: "other", label: "Other reason (renamed)", active: true, sortOrder: 60 });
  });

  it("deactivates it, without deleting it — decision 0498's own 'never delete' rule", async () => {
    const result = await handleUpdateReturnReason(env.DB, "other", { active: false });
    expect(result.status).toBe(200);
    expect((result.body as { active: boolean }).active).toBe(false);

    // Gone from the active list the picker reads...
    const active = (await handleListActiveReturnReasons(env.DB).then((r) => r.body)) as {
      reasons: { id: string }[];
    };
    expect(active.reasons.map((r) => r.id)).not.toContain("other");

    // ...but still resolvable by the admin screen and by anything that
    // recorded it in the past.
    const all = (await handleListAllReturnReasons(env.DB).then((r) => r.body)) as { reasons: { id: string }[] };
    expect(all.reasons.map((r) => r.id)).toContain("other");
  });

  it("404s on a reason id that does not exist", async () => {
    const result = await handleUpdateReturnReason(env.DB, "not-real", { label: "x" });
    expect(result.status).toBe(404);
  });

  it("rejects a non-boolean active or non-integer sortOrder", async () => {
    expect((await handleUpdateReturnReason(env.DB, "other", { active: "yes" })).status).toBe(400);
    expect((await handleUpdateReturnReason(env.DB, "other", { sortOrder: 1.5 })).status).toBe(400);
  });
});
