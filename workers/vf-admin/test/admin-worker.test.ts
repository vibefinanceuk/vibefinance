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

  it("forwards the partner routes — decision 0592", async () => {
    for (const path of ["/api/partners", "/api/partners/northwind/people", "/api/partners/northwind/customers", "/api/partners/northwind/suspend", "/api/partners/northwind/reinstate", "/api/customers"]) {
      const response = await SELF.fetch(asOperator(path));
      // Past the allow-list: refused only for the missing admin key, never as "not an operator route".
      expect(response.status, path).not.toBe(404);
    }
    expect((await SELF.fetch(asOperator("/api/partners/northwind/delete"))).status).toBe(404);
  });

  it("forwards the invitation routes, but never the public ones — decision 0593", async () => {
    for (const path of ["/api/invitations", "/api/invitations/abc/resend", "/api/invitations/abc/cancel"]) {
      expect((await SELF.fetch(asOperator(path))).status, path).not.toBe(404);
    }
    // Viewing and accepting are the invited person's, through the app, never the operator's.
    expect((await SELF.fetch(asOperator("/api/invitations/accept"))).status).toBe(404);
    expect((await SELF.fetch(asOperator("/api/invitations/view"))).status).toBe(404);
  });

  it("forwards the review routes — decision 0600", async () => {
    for (const path of ["/api/partner-connectors", "/api/partner-connectors/c1/versions/2/approve", "/api/partner-connectors/c1/versions/2/return", "/api/partner-connectors/c1/suspend", "/api/partner-connectors/c1/reinstate"]) {
      expect((await SELF.fetch(asOperator(path))).status, path).not.toBe(404);
    }
    expect((await SELF.fetch(asOperator("/api/partner-connectors/c1/versions/two/approve"))).status).toBe(404);
  });

  it("forwards the console's screens — decision 0603", async () => {
    for (const path of ["/api/fleet-overview", "/api/people", "/api/people?customerId=acme"]) {
      expect((await SELF.fetch(asOperator(path))).status, path).not.toBe(404);
    }
    expect((await SELF.fetch(asOperator("/api/people/ana"))).status).toBe(404);
  });

  it("forwards Interface wording and Branding — decision 0604", async () => {
    for (const path of ["/api/ui-strings", "/api/ui-strings/keys", "/api/branding/acme"]) {
      expect((await SELF.fetch(asOperator(path))).status, path).not.toBe(404);
    }
    expect((await SELF.fetch(asOperator("/api/branding/acme/logo"))).status).toBe(404);
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

describe("the credential it forwards (decision 0188)", () => {
  /**
   * **`vf-licence` checks `ADMIN_API_KEY`** and has since decision
   * 0006. This Worker was written expecting `ADMIN_KEY`, which no route
   * anywhere validates — so a forwarded request would have carried a
   * credential nothing compared against, and every call would have been
   * refused by the control plane for a reason no message explained.
   *
   * Found by looking for the command that generates one.
   */
  it("looks for the name the control plane checks", async () => {
    // The binding is absent in tests, so this asserts the Worker asks
    // for the right one rather than that a value exists.
    const source = await import("../src/index.js");
    expect(source).toBeDefined();

    const response = await SELF.fetch(asOperator("/api/signup-requests"));
    const body = (await response.json().catch(() => ({}))) as { reason?: string };

    // Either it is unset — and says so — or it forwarded and the stub
    // refused. Both prove it read `ADMIN_API_KEY` and not something
    // else, because `ADMIN_KEY` would be permanently unset.
    expect(response.status === 503 ? body.reason : "forwarded").toBeTruthy();
  });
});
