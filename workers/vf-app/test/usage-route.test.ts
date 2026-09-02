import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleUsagePush } from "../src/usage-route.js";

beforeEach(async () => {
  await applyTestSchema();
});

describe("handleUsagePush", () => {
  it("computes and pushes a report, returning it in the response body", async () => {
    const pusher = vi.fn().mockResolvedValue(undefined);
    const result = await handleUsagePush(env.DB, "acme-production", pusher, new Date("2026-08-15T00:00:00Z"));

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      status: "pushed",
      report: { environmentId: "acme-production", periodKey: "2026-08", invoicesProcessed: 0 },
    });
    expect(pusher).toHaveBeenCalledTimes(1);
  });

  it("returns 502 with a diagnosable detail when the pusher fails, rather than throwing", async () => {
    const pusher = vi.fn().mockRejectedValue(new Error("connection refused"));
    const result = await handleUsagePush(env.DB, "acme-production", pusher);

    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ error: "usage push failed" });
    expect((result.body as { detail: string }).detail).toContain("connection refused");
  });
});
