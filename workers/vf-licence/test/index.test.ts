import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";

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
      body: JSON.stringify({ id: "x", name: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("401s POST /customers with a wrong admin key, without even reading the body", async () => {
    const res = await SELF.fetch("https://example.com/customers", {
      method: "POST",
      headers: { Authorization: "Bearer definitely-not-the-real-key" },
      body: JSON.stringify({ id: "x", name: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("401s POST /licences with no Authorization header", async () => {
    const res = await SELF.fetch("https://example.com/licences", {
      method: "POST",
      body: JSON.stringify({ environmentId: "x", plan: "standard", volumeEntitlement: 100, validFrom: "2026-01-01" }),
    });
    expect(res.status).toBe(401);
  });

  it("401s POST /environments with no Authorization header — the new route this decision introduced", async () => {
    const res = await SELF.fetch("https://example.com/environments", {
      method: "POST",
      body: JSON.stringify({ customerId: "x", kind: "production", region: "eu", instanceUrl: "https://x" }),
    });
    expect(res.status).toBe(401);
  });

  it("401s the key rotation route with no Authorization header", async () => {
    const res = await SELF.fetch("https://example.com/environments/acme-production/rotate-key", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("401s GET /licences/:id/token with no Authorization header", async () => {
    const res = await SELF.fetch("https://example.com/licences/acme-production/token");
    expect(res.status).toBe(401);
  });

  it("401s POST /usage with no Authorization header, even with a well-formed body", async () => {
    // Confirms authentication runs before business validation — a
    // request that would otherwise be perfectly valid still gets
    // turned away at the door.
    const res = await SELF.fetch("https://example.com/usage", {
      method: "POST",
      body: JSON.stringify({ environmentId: "acme-production", periodKey: "2026-08", invoicesProcessed: 5, rulesEvaluated: 10 }),
    });
    expect(res.status).toBe(401);
  });

  it("401s POST /usage when the body has no environmentId at all, rather than crashing", async () => {
    const res = await SELF.fetch("https://example.com/usage", {
      method: "POST",
      headers: { Authorization: "Bearer something" },
      body: JSON.stringify({ periodKey: "2026-08" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("the fleet manifest, through the real router", () => {
  it("401s GET /environments with no Authorization header", async () => {
    const res = await SELF.fetch("https://example.com/environments");
    expect(res.status).toBe(401);
  });

  it("401s GET /environments with a wrong admin key", async () => {
    const res = await SELF.fetch("https://example.com/environments", {
      headers: { Authorization: "Bearer definitely-not-the-real-key" },
    });
    expect(res.status).toBe(401);
  });

  it("401s PATCH .../fleet-metadata with no Authorization header", async () => {
    const res = await SELF.fetch("https://example.com/environments/acme-production/fleet-metadata", {
      method: "PATCH",
      body: JSON.stringify({ workerName: "vf-app-acme" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("the signup request flow's auth boundary, through the real router (decision 0038)", () => {
  // The only block in this file that genuinely writes to D1 — every
  // other test here asserts a 401 that never reaches the database.
  beforeEach(async () => {
    await applyTestSchema();
  });

  it("POST /signup-requests is genuinely reachable with NO Authorization header — the one deliberately public write endpoint", async () => {
    const res = await SELF.fetch("https://example.com/signup-requests", {
      method: "POST",
      body: JSON.stringify({
        companyName: "Northwind Trading",
        contactName: "Dana Reyes",
        contactEmail: "dana@northwind.example",
      }),
    });
    // Specifically NOT 401 — a prospective customer has no credential
    // by definition. 201 is the real, expected outcome here.
    expect(res.status).toBe(201);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("pending");
  });

  it("still validates the public submission rather than accepting anything", async () => {
    const res = await SELF.fetch("https://example.com/signup-requests", {
      method: "POST",
      body: JSON.stringify({ companyName: "Northwind" }),
    });
    expect(res.status).toBe(400);
  });

  it("401s GET /signup-requests — the operator's review queue is admin-only", async () => {
    const res = await SELF.fetch("https://example.com/signup-requests");
    expect(res.status).toBe(401);
  });

  it("401s approving a request with no Authorization header", async () => {
    const res = await SELF.fetch("https://example.com/signup-requests/some-id/approve", {
      method: "POST",
      body: JSON.stringify({ decidedBy: "whoever" }),
    });
    expect(res.status).toBe(401);
  });

  it("401s rejecting a request with no Authorization header", async () => {
    const res = await SELF.fetch("https://example.com/signup-requests/some-id/reject", {
      method: "POST",
      body: JSON.stringify({ decidedBy: "whoever" }),
    });
    expect(res.status).toBe(401);
  });

  it("401s recording provisioning with no Authorization header", async () => {
    const res = await SELF.fetch("https://example.com/signup-requests/some-id/provisioned", {
      method: "POST",
      body: JSON.stringify({ customerId: "x", environmentId: "x-sandbox" }),
    });
    expect(res.status).toBe(401);
  });
});
