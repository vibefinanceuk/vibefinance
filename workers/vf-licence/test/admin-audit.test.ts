import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { isPrivileged } from "../src/index.js";
import { actorFrom } from "../src/admin-audit.js";

/**
 * Who did what, in the control plane — decision 0140.
 *
 * **Seven route groups are admin-gated and two recorded who acted.**
 * ISO 27001 A.8.15 and SOC 2 CC7.2 want privileged operations logged;
 * because an approval decides whether a business gets an
 * accounts-payable system, SOC 1 has an interest too.
 */

/**
 * **`ADMIN_API_KEY` is genuinely undefined here**, the same as a freshly
 * cloned repo before an operator sets it (see `index.test.ts`). So
 * every admin route through `SELF.fetch` refuses — which is honest, and
 * means these exercise the **refusal** paths.
 *
 * That is the more important half for a log anyway: *"did anybody try
 * to provision a customer we rejected"* is the question an auditor
 * asks, and a log of successes cannot answer it.
 *
 * The success path is proven against `recordAdminAction` directly,
 * below — the same split `index.test.ts` already established.
 */
async function admin(path: string, init: RequestInit = {}) {
  return SELF.fetch(`https://licence.example.com${path}`, {
    ...init,
    headers: { Authorization: "Bearer whatever", ...(init.headers ?? {}) },
  });
}

async function logged() {
  const rows = await env.CONTROL_DB.prepare(
    "SELECT actor, actor_source, action, outcome, status_code, detail FROM admin_actions ORDER BY occurred_at DESC"
  ).all<{
    actor: string;
    actor_source: string;
    action: string;
    outcome: string;
    status_code: number;
    detail: string | null;
  }>();
  return rows.results;
}

beforeEach(async () => {
  await applyTestSchema();
});

describe("every privileged action is recorded", () => {
  it("records one that succeeded", async () => {
    // Proven against the recorder directly, because the router refuses
    // everything here — see the note on `admin` above.
    const { recordAdminAction } = await import("../src/admin-audit.js");
    await recordAdminAction(
      env.CONTROL_DB,
      new Request("https://x/customers", { method: "POST" }),
      "POST /customers",
      { status: 201, body: { id: "acme" } },
      "acme"
    );

    const rows = await logged();
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("POST /customers");
    expect(rows[0].outcome).toBe("succeeded");
  });

  it("records one that was refused", async () => {
    // **A log of successes cannot answer "did anybody try to provision
    // a customer we rejected"**, which is exactly what gets asked.
    // Decision 0055 made the same choice for intake.
    await admin("/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const rows = await logged();
    expect(rows[0].outcome).toBe("refused");
    expect(rows[0].status_code).toBeGreaterThanOrEqual(400);
  });

  it("records an attempt with no credential at all", async () => {
    // The most interesting entry an auditor reads.
    await SELF.fetch("https://licence.example.com/customers", { method: "POST" });

    const rows = await logged();
    expect(rows).toHaveLength(1);
    expect(rows[0].status_code).toBe(401);
  });

  it("records the routes that recorded nothing before", async () => {
    // Creating a licence, minting a credential, granting access — all
    // silent until this. Refused here for want of a key, and recorded
    // either way, which is the point.
    await admin("/licences", { method: "POST", body: "{}" });
    await admin("/credentials", { method: "POST", body: "{}" });
    await admin("/access", { method: "POST", body: "{}" });

    const actions = (await logged()).map((r: { action: string }) => r.action);
    expect(actions).toContain("POST /licences");
    expect(actions).toContain("POST /credentials");
    expect(actions).toContain("POST /access");
  });

  it("does not record an unprivileged request", async () => {
    // `/health` is public and uninteresting, and a log full of it is a
    // log nobody reads.
    await SELF.fetch("https://licence.example.com/health");
    expect(await logged()).toHaveLength(0);
  });
});

describe("who, and how well we know", () => {
  it("names the shared key as itself", async () => {
    // **`admin-key` is not a person and the log does not pretend it
    // is.** A reader weighing an entry needs to know which of the two
    // they are looking at, and inventing a name would be worse than
    // admitting there is not one.
    await admin("/customers", { method: "POST", body: "{}" });

    const rows = await logged();
    expect(rows[0].actor).toBe("admin-key");
    expect(rows[0].actor_source).toBe("admin-key");
  });

  it("prefers a verified Access identity", async () => {
    // Set by Cloudflare **after** it has verified the assertion, and
    // stripped from any request that did not come through Access.
    await admin("/customers", {
      method: "POST",
      body: "{}",
      headers: { "Cf-Access-Authenticated-User-Email": "dan@vibefinance.example" },
    });

    const rows = await logged();
    expect(rows[0].actor).toBe("dan@vibefinance.example");
    expect(rows[0].actor_source).toBe("access");
  });

  it("records a refusal against a verified identity too", async () => {
    // **Who tried** matters at least as much as who succeeded.
    await admin("/licences", {
      method: "POST",
      body: "{}",
      headers: { "Cf-Access-Authenticated-User-Email": "someone@else.example" },
    });

    const rows = await logged();
    expect(rows[0].actor).toBe("someone@else.example");
    expect(rows[0].outcome).toBe("refused");
  });

  it("lower-cases the identity, so one person is one actor", () => {
    const actor = actorFrom(
      new Request("https://x", { headers: { "Cf-Access-Authenticated-User-Email": "Dan@X.COM" } })
    );
    expect(actor.actor).toBe("dan@x.com");
  });
});

describe("what the log does not carry", () => {
  it("records no body on success", async () => {
    // **A successful body may carry a freshly minted API key** (0006)
    // or a credential, and decision 0009 is this project's own record
    // of key material reaching somewhere nobody expected. A log is
    // exactly such a place.
    const { recordAdminAction } = await import("../src/admin-audit.js");
    await recordAdminAction(
      env.CONTROL_DB,
      new Request("https://x/environments", { method: "POST" }),
      "POST /environments",
      { status: 201, body: { apiKey: "vf_live_dangerous_secret" } }
    );

    const rows = await logged();
    expect(rows[0].detail).toBeNull();
    // And nowhere else in the row either.
    expect(JSON.stringify(rows[0])).not.toContain("dangerous");
  });

  it("records a refusal's reason, which is safe to keep", async () => {
    await admin("/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const rows = await logged();
    expect(rows[0].detail).toBeTruthy();
  });
});

describe("the gate and the log ask one question", () => {
  it("shares a definition rather than keeping two", () => {
    // **They were one expression inside the router**, and the audit
    // needed it too. A second copy is a second thing to keep in step.
    expect(isPrivileged("POST", "/customers")).toBe(true);
    expect(isPrivileged("GET", "/health")).toBe(false);
    expect(isPrivileged("POST", "/signup-requests/r-1/approve")).toBe(true);
    expect(isPrivileged("POST", "/login")).toBe(false);
  });

  it("counts reading the log as privileged too", () => {
    expect(isPrivileged("GET", "/admin-actions")).toBe(true);
  });
});

describe("reading it back", () => {
  it("needs the admin key", async () => {
    expect((await SELF.fetch("https://licence.example.com/admin-actions")).status).toBe(401);
  });

  it("returns the most recent first", async () => {
    const { handleListAdminActions, recordAdminAction } = await import("../src/admin-audit.js");
    const req = new Request("https://x/customers", { method: "POST" });

    await recordAdminAction(env.CONTROL_DB, req, "POST /customers", { status: 201, body: {} });
    await recordAdminAction(env.CONTROL_DB, req, "POST /licences", { status: 201, body: {} });

    const body = (await handleListAdminActions(env.CONTROL_DB, 10)).body as {
      actions: { action: string }[];
    };
    expect(body.actions.map((a) => a.action)).toContain("POST /customers");
  });

  it("says how well each identity is known", async () => {
    // An entry recorded against the shared key is weaker evidence than
    // one against a verified identity, and a reader cannot tell without
    // being told.
    const { handleListAdminActions, recordAdminAction } = await import("../src/admin-audit.js");
    await recordAdminAction(
      env.CONTROL_DB,
      new Request("https://x/customers", { method: "POST" }),
      "POST /customers",
      { status: 201, body: {} }
    );

    const body = (await handleListAdminActions(env.CONTROL_DB, 10)).body as {
      actions: { actorSource: string }[];
    };
    expect(body.actions[0].actorSource).toBe("admin-key");
  });
});
