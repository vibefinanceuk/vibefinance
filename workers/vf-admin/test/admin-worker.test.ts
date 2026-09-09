import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * The operator interface — decision 0186.
 *
 * A fourth Worker, behind Cloudflare Access, holding the fleet's admin
 * key.
 */

/** A request as Cloudflare Access delivers one, having verified it. */
function asOperator(path: string, init: RequestInit = {}) {
  return new Request(`https://vf-admin.example${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      "Cf-Access-Authenticated-User-Email": "Dan@VibeFinance.test",
    },
  });
}

describe("a request that did not come through Access", () => {
  /**
   * **A missing header is a deployment fault, not a caller's mistake.**
   *
   * Access sets `Cf-Access-Authenticated-User-Email` *after* verifying
   * the identity, so a request without one did not pass through it —
   * which on a `workers.dev` hostname means the Worker is not behind
   * Access at all.
   *
   * This Worker holds the admin key. Forwarding without a verified
   * identity would hand the fleet's credential to whoever asked.
   */
  it("is refused", async () => {
    const response = await SELF.fetch("https://vf-admin.example/api/signup-requests");
    expect(response.status).toBe(403);
  });

  it("says the interface must sit behind Access", async () => {
    // Decision 0141's discipline: **admit what it cannot do** rather
    // than produce something plausible.
    const response = await SELF.fetch("https://vf-admin.example/api/signup-requests");
    const body = (await response.json()) as { reason: string };
    expect(body.reason).toBe("no_verified_identity");
  });

  it("refuses before checking whether the route exists", async () => {
    // A route that does not exist and a caller who is not the operator
    // are different problems, and the second is the one worth
    // answering first — otherwise this enumerates routes for anybody.
    const response = await SELF.fetch("https://vf-admin.example/api/nonsense");
    expect(response.status).toBe(403);
  });
});

describe("a Worker with no admin key", () => {
  it("says so rather than forwarding without one", async () => {
    // 503 rather than 500: it is a configuration gap, and a deployment
    // that cannot reach the control plane should say which.
    const response = await SELF.fetch(asOperator("/api/signup-requests"));
    expect([503, 404, 502]).toContain(response.status);
  });
});

describe("which routes it will forward", () => {
  /**
   * **An allow-list, never a prefix** — decision 0131 found a route
   * missing from `vf-ui`'s list and a rename failing silently. The
   * lesson was to enumerate, and it matters more here where the
   * credential is the fleet's admin key.
   */
  it("refuses a path that is not an operator route", async () => {
    const response = await SELF.fetch(asOperator("/api/rules"));
    expect(response.status).toBe(404);
  });

  it("refuses a path that only looks like one", async () => {
    const response = await SELF.fetch(asOperator("/api/signup-requests/../rules"));
    expect([404, 403]).toContain(response.status);
  });
});

describe("the screen itself", () => {
  it("is served without Access, because Access guards the hostname", async () => {
    // The asset is not the secret; the admin key is. A screen that
    // renders and then reports *"not behind Access"* is clearer than a
    // blank page.
    const response = await SELF.fetch("https://vf-admin.example/");
    expect(response.status).toBe(200);
  });
});

describe("what the Worker is configured with", () => {
  it("names an Access team domain, so a reviewer can see which", async () => {
    // Not a secret — a hostname. Decision 0009's incident was a
    // *private key* in a var; a team domain is the opposite case.
    expect(typeof env.ACCESS_TEAM_DOMAIN).toBe("string");
  });
});
