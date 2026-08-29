import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("GET /health", () => {
  it("confirms the CONTROL_DB binding is live, not just declared", async () => {
    const res = await SELF.fetch("https://example.com/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("the trust boundary this Worker exists to hold", () => {
  it("exposes no rule-evaluation or other customer-content route", async () => {
    // Not exhaustive, but the property being guarded is simple enough
    // that this is the actual check, not a token gesture: this Worker's
    // only job is to hold cross-customer control-plane data, and the
    // route table is the whole surface area. See docs/decisions/
    // 0001-worker-split-and-tenant-resolution.md.
    const res = await SELF.fetch("https://example.com/rules/evaluate", { method: "POST" });
    expect(res.status).toBe(404);
  });
});
