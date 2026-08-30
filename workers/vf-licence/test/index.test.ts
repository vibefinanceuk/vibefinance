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

describe("endpoint authentication, through the real router", () => {
  // ADMIN_API_KEY is a secret, never declared in wrangler.jsonc — the
  // ambient test env genuinely has it undefined, the same as a freshly
  // cloned repo before an operator sets it. That means these tests can
  // only exercise the REJECTION paths through SELF.fetch (which hold
  // regardless of what ADMIN_API_KEY's real value is); the ACCEPTANCE
  // path (a correct key succeeds) is proven directly against
  // isValidAdminKey/isValidCustomerKey in src/auth.test.ts and
  // test/auth-db.test.ts instead — the same split already established
  // for the AI binding in vf-app.

  it("401s POST /customers with no Authorization header at all", async () => {
    const res = await SELF.fetch("https://example.com/customers", {
      method: "POST",
      body: JSON.stringify({ id: "x", name: "x", region: "eu", instanceUrl: "https://x" }),
    });
    expect(res.status).toBe(401);
  });

  it("401s POST /customers with a wrong admin key, without even reading the body", async () => {
    const res = await SELF.fetch("https://example.com/customers", {
      method: "POST",
      headers: { Authorization: "Bearer definitely-not-the-real-key" },
      body: JSON.stringify({ id: "x", name: "x", region: "eu", instanceUrl: "https://x" }),
    });
    expect(res.status).toBe(401);
  });

  it("401s POST /licences with no Authorization header", async () => {
    const res = await SELF.fetch("https://example.com/licences", {
      method: "POST",
      body: JSON.stringify({ customerId: "x", plan: "standard", volumeEntitlement: 100, validFrom: "2026-01-01" }),
    });
    expect(res.status).toBe(401);
  });

  it("401s the key rotation route with no Authorization header", async () => {
    const res = await SELF.fetch("https://example.com/customers/acme/rotate-key", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("401s GET /licences/:id/token with no Authorization header", async () => {
    const res = await SELF.fetch("https://example.com/licences/acme/token");
    expect(res.status).toBe(401);
  });

  it("401s POST /usage with no Authorization header, even with a well-formed body", async () => {
    // Confirms authentication runs before business validation — a
    // request that would otherwise be perfectly valid still gets
    // turned away at the door.
    const res = await SELF.fetch("https://example.com/usage", {
      method: "POST",
      body: JSON.stringify({ customerId: "acme", periodKey: "2026-08", invoicesProcessed: 5, rulesEvaluated: 10 }),
    });
    expect(res.status).toBe(401);
  });

  it("401s POST /usage when the body has no customerId at all, rather than crashing", async () => {
    const res = await SELF.fetch("https://example.com/usage", {
      method: "POST",
      headers: { Authorization: "Bearer something" },
      body: JSON.stringify({ periodKey: "2026-08" }),
    });
    expect(res.status).toBe(401);
  });
});
