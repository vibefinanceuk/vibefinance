import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCreateCostCentre } from "../src/cost-centre-route.js";

beforeEach(async () => {
  await applyTestSchema();
});

describe("handleCreateCostCentre", () => {
  it("400s when id or name is missing", async () => {
    const result = await handleCreateCostCentre(env.DB, { id: "cc1" });
    expect(result.status).toBe(400);
  });

  it("creates a real, global cost centre", async () => {
    const result = await handleCreateCostCentre(env.DB, { id: "CC-100", name: "Engineering" });
    expect(result.status).toBe(201);
    const row = await env.DB.prepare("SELECT id, name FROM cost_centres WHERE id = ?").bind("CC-100").first();
    expect(row).toEqual({ id: "CC-100", name: "Engineering" });
  });

  it("409s on a duplicate id", async () => {
    await handleCreateCostCentre(env.DB, { id: "CC-101", name: "Sales" });
    const result = await handleCreateCostCentre(env.DB, { id: "CC-101", name: "Marketing" });
    expect(result.status).toBe(409);
  });

  it("409s on a duplicate name, even with a different id", async () => {
    await handleCreateCostCentre(env.DB, { id: "CC-102", name: "Facilities" });
    const result = await handleCreateCostCentre(env.DB, { id: "CC-103", name: "Facilities" });
    expect(result.status).toBe(409);
  });

  it("is genuinely global — not scoped to any process at all, unlike intake_channels", async () => {
    // No process needs to exist at all for this to work — there is
    // no process_id column, deliberately, since a cost centre is a
    // company-wide financial construct, not tied to any one process.
    const result = await handleCreateCostCentre(env.DB, { id: "CC-200", name: "Shared IT Budget" });
    expect(result.status).toBe(201);
  });

  it("a customer can build up a real, meaningful list — the actual point of this feature", async () => {
    for (const [id, name] of [
      ["CC-300", "Engineering — Backend"],
      ["CC-301", "Engineering — Frontend"],
      ["CC-302", "Sales — EMEA"],
    ] as const) {
      const result = await handleCreateCostCentre(env.DB, { id, name });
      expect(result.status).toBe(201);
    }
    const count = await env.DB.prepare("SELECT count(*) AS n FROM cost_centres").first<{ n: number }>();
    expect(count?.n).toBe(3);
  });
});
