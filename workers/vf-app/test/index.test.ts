import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import type { CompiledRuleSet } from "@vibefinance/shared";
import worker from "../src/index.js";
import type { Env } from "../src/index.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";
import { PERMISSIONS } from "../src/permissions.js";

async function seedActiveLicence(): Promise<void> {
  // Every existing test below predates the licence gate and expects to
  // reach its own handler, not be turned away at 402 — this keeps them
  // testing what they were written to test. The gate itself gets its
  // own describe block further down.
  const claims = {
    customerId: "test-customer",
    plan: "standard",
    features: [],
    volumeEntitlement: 10000,
    status: "active",
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
  };
  await env.DB.prepare(
    "INSERT INTO licence_cache (id, claims_json, fetched_at) VALUES (1, ?, ?)"
  )
    .bind(JSON.stringify(claims), new Date().toISOString())
    .run();
}

/**
 * Seeds a user holding every known permission and returns their real
 * API key — same reasoning as seedActiveLicence: every test below
 * predates real auth and expects to reach its own handler, not be
 * turned away at 401/403. The permission gate itself gets its own
 * describe block further down, testing 401/403 specifically with a
 * deliberately under-permissioned or unauthenticated request.
 */
async function seedFullyAuthorizedUser(): Promise<string> {
  const apiKey = generateApiKey();
  const hash = await hashApiKey(apiKey);
  await env.DB.prepare("INSERT INTO org_users (id, email, name, api_key_hash) VALUES (?, ?, ?, ?)")
    .bind("test-user", "test-user@example.com", "Test User", hash)
    .run();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)")
    .bind("test-role", "Test Role", JSON.stringify(PERMISSIONS))
    .run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES (?, ?)")
    .bind("test-user", "test-role")
    .run();
  return apiKey;
}

let authorizedApiKey: string;

/** For 403 tests specifically: a real, authenticated user who simply
 * lacks the permission a route requires — distinct from an
 * unauthenticated request (401), and needed to prove the two are
 * genuinely told apart, not collapsed into one generic rejection. */
async function seedUserWithPermissions(permissions: string[]): Promise<string> {
  const id = crypto.randomUUID();
  const apiKey = generateApiKey();
  const hash = await hashApiKey(apiKey);
  await env.DB.prepare("INSERT INTO org_users (id, email, name, api_key_hash) VALUES (?, ?, ?, ?)")
    .bind(id, `${id}@example.com`, "Limited User", hash)
    .run();
  const roleId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)")
    .bind(roleId, "Limited Role", JSON.stringify(permissions))
    .run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES (?, ?)").bind(id, roleId).run();
  return apiKey;
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${authorizedApiKey}` };
}

beforeEach(async () => {
  await applyTestSchema();
  await seedActiveLicence();
  authorizedApiKey = await seedFullyAuthorizedUser();
});

describe("GET /health", () => {
  it("responds ok through the real Worker fetch path", async () => {
    const res = await SELF.fetch("https://example.com/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("malformed URL paths, through the real router", () => {
  it("400s cleanly on invalid percent-encoding rather than throwing a raw 500", async () => {
    // A lone "%" not followed by two valid hex digits makes
    // decodeURIComponent throw — confirmed refused cleanly, not left
    // to crash the request.
    const res = await SELF.fetch("https://example.com/org/teams/%E0%A4%A/members", { method: "POST" });
    expect(res.status).toBe(400);
  });
});

describe("POST /rules/evaluate", () => {
  const ruleSet: CompiledRuleSet = {
    id: "rs1",
    mode: "first_match",
    rules: [
      {
        id: "tax-review-non-eu",
        version: 1,
        conditions: {
          all: [
            { field: "BT-48", operator: "is_empty" },
            { field: "BT-40", operator: "not_in", value: ["DE", "FR"] },
          ],
        },
        actions: [{ type: "route_to", params: { queue: "tax_review" } }],
      },
    ],
  };

  beforeEach(async () => {
    // invoice_runs.rule_set_id is a real foreign key (Blueprint: "every
    // invoice records the rule version that decided it") — in the real
    // system a rule set is authored and activated before any invoice is
    // ever evaluated against it, so the test has to model that instead
    // of asserting against an unpersisted rule set the schema correctly
    // refuses to reference.
    await env.DB.prepare("INSERT INTO rule_sets (id, name, mode, status) VALUES (?, ?, ?, ?)")
      .bind(ruleSet.id, "tax review", ruleSet.mode, "active")
      .run();
  });

  it("evaluates and writes an append-only execution log to real D1", async () => {
    const res = await SELF.fetch("https://example.com/rules/evaluate", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        ruleSet,
        facts: { "BT-40": "US" },
        invoiceId: "inv-1",
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { runId: string; outcome: string };
    expect(body.outcome).toBe("matched");
    expect(body.runId).toBeTruthy();

    // The rendered result was measured, not the instruction issued (§7):
    // query the real D1 binding directly to confirm the row actually
    // landed, rather than trusting the 200 response alone.
    const row = await env.DB.prepare(
      "SELECT invoice_id, rule_set_id, outcome FROM invoice_runs WHERE id = ?"
    )
      .bind(body.runId)
      .first();
    expect(row).toEqual({ invoice_id: "inv-1", rule_set_id: "rs1", outcome: "matched" });

    const steps = await env.DB.prepare(
      "SELECT rule_id, matched FROM invoice_run_steps WHERE invoice_run_id = ?"
    )
      .bind(body.runId)
      .all();
    expect(steps.results).toEqual([{ rule_id: "tax-review-non-eu", matched: 1 }]);
  });

  it("refuses a rule outside the closed vocabulary rather than silently running it", async () => {
    const badRuleSet = {
      id: "rs2",
      mode: "first_match",
      rules: [
        {
          id: "bad",
          version: 1,
          conditions: { field: "BT-3", operator: "is_present" },
          actions: [{ type: "run_arbitrary_script" }],
        },
      ],
    };

    const res = await SELF.fetch("https://example.com/rules/evaluate", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ ruleSet: badRuleSet, facts: {}, invoiceId: "inv-2" }),
    });

    expect(res.status).toBe(422);

    // Confirm nothing was written for the refused rule — a partial write
    // on refusal would be worse than an outright 500.
    const row = await env.DB.prepare(
      "SELECT count(*) as n FROM invoice_runs WHERE invoice_id = ?"
    )
      .bind("inv-2")
      .first();
    expect(row).toEqual({ n: 0 });
  });

  it("404s a route that does not exist, through the real router", async () => {
    const res = await SELF.fetch("https://example.com/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("loads and evaluates against activated rules from D1 when given ruleSetId instead of ruleSet", async () => {
    await env.DB.prepare("INSERT INTO rules (id, rule_set_id, sort_order, enabled) VALUES (?, ?, ?, 1)")
      .bind("tax-review-non-eu", "rs1", 0)
      .run();
    await env.DB.prepare(
      `INSERT INTO rule_versions
         (rule_id, version, source_text, compiled_json, compiled_by, approved_by, approved_at, effective_from)
       VALUES (?, 1, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        "tax-review-non-eu",
        "test source",
        JSON.stringify({ conditions: ruleSet.rules[0].conditions, actions: ruleSet.rules[0].actions }),
        "test-model",
        "alice@example.com",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z"
      )
      .run();

    const res = await SELF.fetch("https://example.com/rules/evaluate", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ ruleSetId: "rs1", facts: { "BT-40": "US" }, invoiceId: "inv-3" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { outcome: string };
    expect(body.outcome).toBe("matched");
  });

  it("reports no_match — not an error — for a rule set with no activated rules yet", async () => {
    // rs1 exists (seeded in beforeEach) but has no rules at all in
    // this test — a legitimate state before anything is activated,
    // not a failure.
    const res = await SELF.fetch("https://example.com/rules/evaluate", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ ruleSetId: "rs1", facts: { "BT-40": "US" }, invoiceId: "inv-4" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json() as { outcome: string }).outcome).toBe("no_match");
  });

  it("400s when both ruleSet and ruleSetId are provided — never a silent preference", async () => {
    const res = await SELF.fetch("https://example.com/rules/evaluate", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ ruleSet, ruleSetId: "rs1", facts: {}, invoiceId: "inv-5" }),
    });
    expect(res.status).toBe(400);
  });

  it("400s when neither ruleSet nor ruleSetId is provided", async () => {
    const res = await SELF.fetch("https://example.com/rules/evaluate", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ facts: {}, invoiceId: "inv-6" }),
    });
    expect(res.status).toBe(400);
  });

  it("404s when ruleSetId refers to a rule set that does not exist", async () => {
    const res = await SELF.fetch("https://example.com/rules/evaluate", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ ruleSetId: "does-not-exist", facts: {}, invoiceId: "inv-7" }),
    });
    expect(res.status).toBe(404);
  });

  it("loads persisted facts by invoiceId when facts is omitted (decision 0017)", async () => {
    // Deliberately a rule that requires an EXACT, present value — not
    // reusing the outer `ruleSet`, whose is_empty/not_in conditions
    // both evaluate true even on completely empty facts, which would
    // make this test pass whether or not real persisted facts were
    // actually loaded at all.
    const exactMatchRuleSet: CompiledRuleSet = {
      id: "rs-exact",
      mode: "first_match",
      rules: [
        {
          id: "us-supplier",
          version: 1,
          conditions: { field: "BT-40", operator: "is", value: "US" },
          actions: [{ type: "flag" }],
        },
      ],
    };
    await env.DB.prepare("INSERT INTO rule_sets (id, name, mode, status) VALUES (?, ?, ?, ?)")
      .bind("rs-exact", "exact match test", "first_match", "active")
      .run();
    await SELF.fetch("https://example.com/invoices", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ id: "inv-8", facts: { "BT-40": "US" } }),
    });
    const res = await SELF.fetch("https://example.com/rules/evaluate", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ ruleSet: exactMatchRuleSet, invoiceId: "inv-8" }), // no `facts` at all
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { outcome: string };
    expect(body.outcome).toBe("matched"); // only possible if BT-40: "US" was genuinely loaded from storage
  });

  it("prefers inline facts over persisted ones when both could apply — inline always wins when explicitly given", async () => {
    await SELF.fetch("https://example.com/invoices", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ id: "inv-9", facts: { "BT-40": "US" } }), // persisted: would match
    });
    const res = await SELF.fetch("https://example.com/rules/evaluate", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ ruleSet, facts: { "BT-40": "DE" }, invoiceId: "inv-9" }), // inline: DE never matches this ruleSet
    });
    const body = (await res.json()) as { outcome: string };
    expect(body.outcome).toBe("no_match");
  });

  it("404s when facts is omitted and no invoice with that id has ever been stored", async () => {
    const res = await SELF.fetch("https://example.com/rules/evaluate", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ ruleSet, invoiceId: "never-stored" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /rules/compile", () => {
  it("500s cleanly when the AI binding is not configured, through the real router", async () => {
    // wrangler.test.jsonc deliberately omits the `ai` binding (see its
    // own comment: declaring it makes vitest-pool-workers require a
    // real remote connection this session has no credentials for). So
    // in this test environment, env.AI genuinely is undefined — this
    // exercises the real guard against that real condition, not a
    // simulated one. The deeper compile logic (validation, D1 writes,
    // refusal handling) is tested directly against handleCompileRequest
    // in test/compile-route.test.ts with a fake model, since a request
    // that reaches the model here would need real AI credentials.
    const res = await SELF.fetch("https://example.com/rules/compile", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ ruleSetId: "rs1", sourceText: "anything" }),
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "AI binding not configured" });
  });
});

describe("licence enforcement — the gate applied to mutating endpoints", () => {  async function setLicenceStatus(status: "active" | "warned" | "blocked", reason?: string) {
    await env.DB.prepare("DELETE FROM licence_cache WHERE id = 1").run();
    const claims = {
      customerId: "test-customer",
      plan: "standard",
      features: [],
      volumeEntitlement: 10000,
      status,
      statusReason: reason,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    };
    await env.DB.prepare(
      "INSERT INTO licence_cache (id, claims_json, fetched_at) VALUES (1, ?, ?)"
    )
      .bind(JSON.stringify(claims), new Date().toISOString())
      .run();
  }

  it("402s /rules/evaluate when the cached licence is blocked", async () => {
    await setLicenceStatus("blocked", "non-payment");
    const res = await SELF.fetch("https://example.com/rules/evaluate", {
      method: "POST",
      body: JSON.stringify({ ruleSet: { id: "x", mode: "first_match", rules: [] }, facts: {}, invoiceId: "i1" }),
    });
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: "processing blocked", reason: "non-payment" });
  });

  it("402s /rules/compile when no licence has ever been cached — the bootstrap default", async () => {
    await env.DB.prepare("DELETE FROM licence_cache WHERE id = 1").run();
    const res = await SELF.fetch("https://example.com/rules/compile", {
      method: "POST",
      body: JSON.stringify({ ruleSetId: "rs1", sourceText: "anything" }),
    });
    expect(res.status).toBe(402);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toContain("no licence has been provisioned");
  });

  it("does not block on a 'warned' status — only 'blocked' restricts", async () => {
    await setLicenceStatus("warned", "payment overdue");
    // Seed a real rule_sets row for the FK the invoice_runs write
    // depends on — otherwise a missing-FK 500 would make this test
    // accidentally pass the "not 402" assertion for the wrong reason.
    await env.DB.prepare("INSERT INTO rule_sets (id, name, mode, status) VALUES (?, ?, ?, ?)")
      .bind("x", "test set", "first_match", "active")
      .run();
    const res = await SELF.fetch("https://example.com/rules/evaluate", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ ruleSet: { id: "x", mode: "first_match", rules: [] }, facts: {}, invoiceId: "i1" }),
    });
    // Reaches the real handler and succeeds — confirms the gate let it
    // through, not just that something other than a 402 came back.
    expect(res.status).toBe(200);
  });

  it("leaves /health unaffected by a blocked licence — read-only, not lights out", async () => {
    await setLicenceStatus("blocked", "non-payment");
    const res = await SELF.fetch("https://example.com/health");
    expect(res.status).toBe(200);
  });

  it("does NOT block /usage/push even when the licence is blocked", async () => {
    // Deliberately outside the enforcement gate — see usage-route.ts's
    // own comment on why. Config isn't set in wrangler.test.jsonc, so
    // this hits the 500 "not configured" guard, not a 402 — the
    // property under test is that it's never 402, regardless of what
    // else stops it.
    await setLicenceStatus("blocked", "non-payment");
    const res = await SELF.fetch("https://example.com/usage/push", { method: "POST" });
    expect(res.status).not.toBe(402);
  });
});

describe("POST /usage/push", () => {
  it("500s cleanly when LICENCE_SERVICE/CUSTOMER_ID/VF_LICENCE_API_KEY are not configured, through the real router", async () => {
    // wrangler.test.jsonc declares no `services` binding and no secret
    // — this exercises the real guard against that real condition. The
    // deeper push logic (computing the report, calling the pusher,
    // handling a pusher failure) is tested directly against
    // handleUsagePush in test/usage-route.test.ts with a fake pusher,
    // since a request that reaches the pusher here would need a real
    // vf-licence to talk to.
    const res = await SELF.fetch("https://example.com/usage/push", { method: "POST" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "LICENCE_SERVICE, CUSTOMER_ID and VF_LICENCE_API_KEY must be configured",
    });
  });
});

describe("worked examples & activation routes, through the real router", () => {
  async function seedRuleWithExamples(): Promise<{ ruleId: string; exampleIds: string[] }> {
    await env.DB.prepare("INSERT INTO rule_sets (id, name, mode, status) VALUES (?, ?, ?, ?)")
      .bind("rs1", "test set", "first_match", "draft")
      .run();
    const ruleId = "rule-1";
    await env.DB.prepare("INSERT INTO rules (id, rule_set_id, sort_order, enabled) VALUES (?, ?, ?, 1)")
      .bind(ruleId, "rs1", 0)
      .run();
    await env.DB.prepare(
      "INSERT INTO rule_versions (rule_id, version, source_text, compiled_json, compiled_by) VALUES (?, 1, ?, ?, ?)"
    )
      .bind(ruleId, "test source", "{}", "test-model")
      .run();
    const exampleIds = ["ex-1", "ex-2"];
    await env.DB.prepare(
      "INSERT INTO rule_examples (id, rule_id, rule_version, invoice_json, expect_match) VALUES (?, ?, 1, ?, 1)"
    )
      .bind(exampleIds[0], ruleId, "{}")
      .run();
    await env.DB.prepare(
      "INSERT INTO rule_examples (id, rule_id, rule_version, invoice_json, expect_match) VALUES (?, ?, 1, ?, 0)"
    )
      .bind(exampleIds[1], ruleId, "{}")
      .run();
    return { ruleId, exampleIds };
  }

  it("GET lists examples through the real router, unauthenticated by licence status", async () => {
    const { ruleId } = await seedRuleWithExamples();
    // Deliberately no seedActiveLicence override here beyond the
    // top-level beforeEach's — this route is meant to work regardless,
    // proven properly further down in its own blocked-licence test.
    const res = await SELF.fetch(`https://example.com/rules/${ruleId}/versions/1/examples`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { examples: unknown[] };
    expect(body.examples).toHaveLength(2);
  });

  it("listing examples is not blocked by licence status — read-only, not lights out", async () => {
    const { ruleId } = await seedRuleWithExamples();
    await env.DB.prepare("DELETE FROM licence_cache WHERE id = 1").run();
    const res = await SELF.fetch(`https://example.com/rules/${ruleId}/versions/1/examples`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
  });

  it("401s listing examples with no credentials at all", async () => {
    const { ruleId } = await seedRuleWithExamples();
    const res = await SELF.fetch(`https://example.com/rules/${ruleId}/versions/1/examples`);
    expect(res.status).toBe(401);
  });

  it("POST confirms an example through the real router, recording the authenticated identity", async () => {
    const { exampleIds } = await seedRuleWithExamples();
    const res = await SELF.fetch(`https://example.com/rules/examples/${exampleIds[0]}/confirm`, {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);

    const row = await env.DB.prepare("SELECT confirmed_by FROM rule_examples WHERE id = ?")
      .bind(exampleIds[0])
      .first();
    // The authenticated user's own email, not anything a client could
    // put in a request body.
    expect(row).toEqual({ confirmed_by: "test-user@example.com" });
  });

  it("ignores a spoofed confirmedBy in the request body — identity comes from the authenticated key, never the client", async () => {
    const { exampleIds } = await seedRuleWithExamples();
    const res = await SELF.fetch(`https://example.com/rules/examples/${exampleIds[0]}/confirm`, {
      method: "POST",
      headers: authHeaders(),
      // A client claiming to be someone else entirely — before real
      // auth existed, this field was trusted outright.
      body: JSON.stringify({ confirmedBy: "someone-else@attacker.example" }),
    });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare("SELECT confirmed_by FROM rule_examples WHERE id = ?")
      .bind(exampleIds[0])
      .first();
    expect(row).toEqual({ confirmed_by: "test-user@example.com" });
  });

  it("401s confirming an example with no credentials at all", async () => {
    const { exampleIds } = await seedRuleWithExamples();
    const res = await SELF.fetch(`https://example.com/rules/examples/${exampleIds[0]}/confirm`, {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });

  it("403s confirming an example when authenticated but lacking the AP.Review permission", async () => {
    const { exampleIds } = await seedRuleWithExamples();
    const key = await seedUserWithPermissions(["Admin.RuleManagement"]); // wrong permission on purpose
    const res = await SELF.fetch(`https://example.com/rules/examples/${exampleIds[0]}/confirm`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
  });

  it("confirming is blocked when the licence is blocked", async () => {
    const { exampleIds } = await seedRuleWithExamples();
    await env.DB.prepare("DELETE FROM licence_cache WHERE id = 1").run();
    const res = await SELF.fetch(`https://example.com/rules/examples/${exampleIds[0]}/confirm`, {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(402);
  });

  it("POST activates a rule through the real router once every example is confirmed, recording the authenticated identity", async () => {
    const { ruleId, exampleIds } = await seedRuleWithExamples();
    for (const id of exampleIds) {
      await SELF.fetch(`https://example.com/rules/examples/${id}/confirm`, {
        method: "POST",
        headers: authHeaders(),
      });
    }

    const res = await SELF.fetch(`https://example.com/rules/${ruleId}/versions/1/activate`, {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);

    const row = await env.DB.prepare("SELECT approved_by FROM rule_versions WHERE rule_id = ?")
      .bind(ruleId)
      .first();
    expect(row).toEqual({ approved_by: "test-user@example.com" });
  });

  it("401s activating a rule with no credentials at all", async () => {
    const { ruleId } = await seedRuleWithExamples();
    const res = await SELF.fetch(`https://example.com/rules/${ruleId}/versions/1/activate`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("403s activating a rule when authenticated but lacking the AP.Approve permission", async () => {
    const { ruleId } = await seedRuleWithExamples();
    const key = await seedUserWithPermissions(["AP.Review"]); // wrong permission on purpose
    const res = await SELF.fetch(`https://example.com/rules/${ruleId}/versions/1/activate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
  });

  it("activation is refused through the real router when an example is still unconfirmed", async () => {
    const { ruleId } = await seedRuleWithExamples();
    // Neither example confirmed.
    const res = await SELF.fetch(`https://example.com/rules/${ruleId}/versions/1/activate`, {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(409);
  });

  it("activating is blocked when the licence is blocked", async () => {
    const { ruleId } = await seedRuleWithExamples();
    await env.DB.prepare("DELETE FROM licence_cache WHERE id = 1").run();
    const res = await SELF.fetch(`https://example.com/rules/${ruleId}/versions/1/activate`, {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(402);
  });
});

describe("POST /licence/refresh", () => {
  it("500s cleanly when required config is missing, through the real router", async () => {
    // wrangler.test.jsonc declares no `services` binding and no
    // secrets — this exercises the real guard against that real
    // condition, matching /usage/push's own equivalent test. The
    // deeper refresh logic (real fetch, real verify, real fail-open
    // behaviour) is tested directly against handleLicenceRefresh in
    // test/licence-refresh-route.test.ts, since a request that reaches
    // that logic here would need a real vf-licence to talk to.
    const res = await SELF.fetch("https://example.com/licence/refresh", { method: "POST" });
    expect(res.status).toBe(500);
  });

  it("is reachable even when the cached licence state is already blocked — the bootstrap-recovery case this exists for", async () => {
    // The property that actually matters: this route must never be
    // gated by isBlocked(), or the exact state it exists to fix
    // (no cache, or a stale blocked cache) would make it permanently
    // unreachable via the API. Confirms it reaches the real "config
    // missing" 500 rather than a 402 — proving the licence gate never
    // ran at all for this route.
    await env.DB.prepare("DELETE FROM licence_cache WHERE id = 1").run();
    const res = await SELF.fetch("https://example.com/licence/refresh", { method: "POST" });
    expect(res.status).not.toBe(402);
  });
});

describe("rule versioning end-to-end, through the real router (decision 0014)", () => {
  // Seeded directly via D1, not through POST /rules/compile — that
  // route needs the real env.AI binding, which this test environment
  // doesn't have (see the existing "500s cleanly when the AI binding
  // is not configured" test above), and compile-route.ts's own
  // versioning logic is already thoroughly covered at the unit level
  // in test/compile-route.test.ts. What's genuinely new and worth
  // proving through the real router here is what happens AFTER a
  // rule compiles: does activating v2 actually change what live
  // evaluation returns, end to end, through real HTTP requests.
  async function seedVersion(ruleId: string, version: number, threshold: number): Promise<void> {
    await env.DB.prepare(
      "INSERT INTO rule_versions (rule_id, version, source_text, compiled_json, compiled_by) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(
        ruleId,
        version,
        `flag anything over ${threshold}`,
        JSON.stringify({
          conditions: { field: "BT-112", operator: "greater_than", value: threshold },
          actions: [{ type: "flag" }],
        }),
        "test-model"
      )
      .run();
    await env.DB.prepare(
      "INSERT INTO rule_examples (id, rule_id, rule_version, invoice_json, expect_match) VALUES (?, ?, ?, ?, 1)"
    )
      .bind(crypto.randomUUID(), ruleId, version, JSON.stringify({ "BT-112": threshold + 500 }))
      .run();
  }

  it("activating v2 of a rule changes what live evaluation returns — v1 is superseded, not deleted", async () => {
    await env.DB.prepare("INSERT INTO rule_sets (id, name, mode, status) VALUES (?, ?, ?, ?)")
      .bind("rs1", "test set", "first_match", "draft")
      .run();
    const ruleId = "rule-1";
    await env.DB.prepare("INSERT INTO rules (id, rule_set_id, sort_order, enabled) VALUES (?, ?, ?, 1)")
      .bind(ruleId, "rs1", 0)
      .run();

    // v1: flags anything over 5000.
    await seedVersion(ruleId, 1, 5000);
    const v1Examples = (
      await (
        await SELF.fetch(`https://example.com/rules/${ruleId}/versions/1/examples`, { headers: authHeaders() })
      ).json()
    ) as { examples: { id: string }[] };
    for (const ex of v1Examples.examples) {
      const res = await SELF.fetch(`https://example.com/rules/examples/${ex.id}/confirm`, {
        method: "POST",
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
    }
    const v1ActivateRes = await SELF.fetch(`https://example.com/rules/${ruleId}/versions/1/activate`, {
      method: "POST",
      headers: authHeaders(),
    });
    expect(v1ActivateRes.status).toBe(200);

    // Confirm v1 genuinely governs evaluation before v2 exists at all.
    const beforeV2 = await SELF.fetch("https://example.com/rules/evaluate", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ ruleSetId: "rs1", facts: { "BT-112": 6000 }, invoiceId: "inv-1" }),
    });
    expect((await beforeV2.json() as { outcome: string }).outcome).toBe("matched");

    // v2 of the SAME rule: flags anything over 1000 instead.
    await seedVersion(ruleId, 2, 1000);

    // v2 compiled but not yet activated — evaluation must still use v1.
    const stillV1 = await SELF.fetch("https://example.com/rules/evaluate", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ ruleSetId: "rs1", facts: { "BT-112": 2000 }, invoiceId: "inv-2" }),
    });
    // 2000 is below v1's 5000 threshold — v1, still the only active
    // version, must not match.
    expect((await stillV1.json() as { outcome: string }).outcome).toBe("no_match");

    const v2Examples = (
      await (
        await SELF.fetch(`https://example.com/rules/${ruleId}/versions/2/examples`, { headers: authHeaders() })
      ).json()
    ) as { examples: { id: string }[] };
    for (const ex of v2Examples.examples) {
      await SELF.fetch(`https://example.com/rules/examples/${ex.id}/confirm`, {
        method: "POST",
        headers: authHeaders(),
      });
    }
    const v2ActivateRes = await SELF.fetch(`https://example.com/rules/${ruleId}/versions/2/activate`, {
      method: "POST",
      headers: authHeaders(),
    });
    expect(v2ActivateRes.status).toBe(200);

    // Now v2 governs: the same 2000-value invoice that was a no_match
    // under v1's 5000 threshold now matches under v2's 1000 threshold.
    const afterV2 = await SELF.fetch("https://example.com/rules/evaluate", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ ruleSetId: "rs1", facts: { "BT-112": 2000 }, invoiceId: "inv-3" }),
    });
    expect((await afterV2.json() as { outcome: string }).outcome).toBe("matched");

    // v1 is superseded, never deleted — its full history remains
    // directly queryable, matching the append-only reproducibility
    // guarantee this whole system is built around.
    const v1Row = await env.DB.prepare(
      "SELECT approved_by, effective_to FROM rule_versions WHERE rule_id = ? AND version = 1"
    )
      .bind(ruleId)
      .first<{ approved_by: string; effective_to: string | null }>();
    expect(v1Row?.approved_by).toBe("test-user@example.com");
    expect(v1Row?.effective_to).toBeTruthy(); // closed, not deleted

    const v2Row = await env.DB.prepare(
      "SELECT approved_by, effective_to FROM rule_versions WHERE rule_id = ? AND version = 2"
    )
      .bind(ruleId)
      .first<{ approved_by: string; effective_to: string | null }>();
    expect(v2Row?.approved_by).toBe("test-user@example.com");
    expect(v2Row?.effective_to).toBeNull(); // the one currently open
  });
});

describe("LOCALE — genuinely customer-facing messages translate through the real router", () => {
  // SELF.fetch can't inject a custom env per request (it uses the
  // ambient wrangler.test.jsonc config, which declares no LOCALE at
  // all) — so these call the exported Worker's fetch() directly with
  // a custom env, spreading the real ambient testEnv for DB/etc, the
  // exact same pattern already used for scheduled()'s own tests
  // elsewhere in this file's sibling, scheduled.test.ts.

  it("translates the licence-blocked message when LOCALE is set", async () => {
    await env.DB.prepare("DELETE FROM licence_cache WHERE id = 1").run();
    const customEnv: Env = { ...env, LOCALE: "de" };
    const request = new Request("https://example.com/rules/evaluate", {
      method: "POST",
      body: JSON.stringify({ ruleSet: { id: "x", mode: "first_match", rules: [] }, facts: {}, invoiceId: "i1" }),
    });
    const res = await worker.fetch(request, customEnv);
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: string; reason: string };
    expect(body.error).toBe("Verarbeitung blockiert");
    expect(body.reason).toBe("Für diese Instanz wurde noch keine Lizenz bereitgestellt");
  });

  it("falls back to English for an unrecognised LOCALE, never throwing", async () => {
    await env.DB.prepare("DELETE FROM licence_cache WHERE id = 1").run();
    const customEnv: Env = { ...env, LOCALE: "not-a-real-locale" };
    const request = new Request("https://example.com/rules/evaluate", {
      method: "POST",
      body: JSON.stringify({ ruleSet: { id: "x", mode: "first_match", rules: [] }, facts: {}, invoiceId: "i1" }),
    });
    const res = await worker.fetch(request, customEnv);
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("processing blocked");
  });

  it("translates a validation message from handleEvaluate itself", async () => {
    // seedActiveLicence() already ran in the top-level beforeEach —
    // no need to call it again here, and doing so would violate
    // licence_cache's own primary key.
    const customEnv: Env = { ...env, LOCALE: "fr" };
    const request = new Request("https://example.com/rules/evaluate", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ facts: {}, invoiceId: "i1" }), // neither ruleSet nor ruleSetId
    });
    const res = await worker.fetch(request, customEnv);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Un seul des deux, ruleSet ou ruleSetId, est requis");
  });

  it("defaults to English when LOCALE is not set at all", async () => {
    await env.DB.prepare("DELETE FROM licence_cache WHERE id = 1").run();
    const customEnv: Env = { ...env, LOCALE: undefined };
    const request = new Request("https://example.com/rules/evaluate", {
      method: "POST",
      body: JSON.stringify({ ruleSet: { id: "x", mode: "first_match", rules: [] }, facts: {}, invoiceId: "i1" }),
    });
    const res = await worker.fetch(request, customEnv);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("processing blocked");
  });
});

describe("org/authority/profiles routes, through the real router", () => {
  it("creates a unit through the real router", async () => {
    const res = await SELF.fetch("https://example.com/org/units", {
      method: "POST",
      body: JSON.stringify({ id: "u1", name: "Finance" }),
    });
    expect(res.status).toBe(201);
    const row = await env.DB.prepare("SELECT name FROM org_units WHERE id = ?").bind("u1").first();
    expect(row).toEqual({ name: "Finance" });
  });

  it("is not blocked by licence status — an administrative action, not gated product usage", async () => {
    await env.DB.prepare("DELETE FROM licence_cache WHERE id = 1").run();
    const res = await SELF.fetch("https://example.com/org/units", {
      method: "POST",
      body: JSON.stringify({ id: "u1", name: "Finance" }),
    });
    expect(res.status).not.toBe(402);
  });

  it("creates a user through the real router", async () => {
    const res = await SELF.fetch("https://example.com/org/users", {
      method: "POST",
      body: JSON.stringify({ id: "usr1", email: "a@b.com", name: "Alice" }),
    });
    expect(res.status).toBe(201);
  });

  it("creates a role through the real router", async () => {
    const res = await SELF.fetch("https://example.com/org/roles", {
      method: "POST",
      body: JSON.stringify({ id: "r1", name: "Admin", permissions: ["AP.Approve"] }),
    });
    expect(res.status).toBe(201);
  });

  it("422s a role with an unknown permission through the real router", async () => {
    const res = await SELF.fetch("https://example.com/org/roles", {
      method: "POST",
      body: JSON.stringify({ id: "r1", name: "Admin", permissions: ["not_a_real_permission"] }),
    });
    expect(res.status).toBe(422);
  });

  it("assigns a role to a user through the real router", async () => {
    await SELF.fetch("https://example.com/org/users", {
      method: "POST",
      body: JSON.stringify({ id: "usr1", email: "a@b.com", name: "Alice" }),
    });
    await SELF.fetch("https://example.com/org/roles", {
      method: "POST",
      body: JSON.stringify({ id: "r1", name: "Admin" }),
    });
    const res = await SELF.fetch("https://example.com/org/users/usr1/roles", {
      method: "POST",
      body: JSON.stringify({ roleId: "r1" }),
    });
    expect(res.status).toBe(201);
  });

  it("sets an authority limit through the real router", async () => {
    await SELF.fetch("https://example.com/org/users", {
      method: "POST",
      body: JSON.stringify({ id: "usr1", email: "a@b.com", name: "Alice" }),
    });
    const res = await SELF.fetch("https://example.com/org/users/usr1/authority-limits", {
      method: "POST",
      body: JSON.stringify({ currency: "EUR", maxAmount: 5000 }),
    });
    expect(res.status).toBe(200);
  });

  it("sets a CIUS profile through the real router", async () => {
    const res = await SELF.fetch("https://example.com/org/profiles", {
      method: "POST",
      body: JSON.stringify({ id: "p1", ciusProfile: "xrechnung" }),
    });
    expect(res.status).toBe(201);
  });

  it("422s an unknown CIUS profile through the real router", async () => {
    const res = await SELF.fetch("https://example.com/org/profiles", {
      method: "POST",
      body: JSON.stringify({ id: "p1", ciusProfile: "not_a_real_profile" }),
    });
    expect(res.status).toBe(422);
  });
});

describe("team routes, through the real router (decision 0016)", () => {
  it("creates a team through the real router", async () => {
    const res = await SELF.fetch("https://example.com/org/teams", {
      method: "POST",
      body: JSON.stringify({ id: "t1", name: "AP Team" }),
    });
    expect(res.status).toBe(201);
    const row = await env.DB.prepare("SELECT name FROM org_teams WHERE id = ?").bind("t1").first();
    expect(row).toEqual({ name: "AP Team" });
  });

  it("a team id containing a space works correctly through a real, percent-encoded URL — a real live-caught bug", async () => {
    // URL.pathname preserves percent-encoding rather than decoding it
    // — a genuine gotcha that let every dynamic path segment in this
    // file silently receive raw, still-encoded text until a real
    // compiler-generated team name ("AP team") broke it live.
    await SELF.fetch("https://example.com/org/teams", {
      method: "POST",
      body: JSON.stringify({ id: "AP team", name: "AP Team" }),
    });
    await SELF.fetch("https://example.com/org/users", {
      method: "POST",
      body: JSON.stringify({ id: "usr1", email: "a@b.com", name: "Alice" }),
    });
    const res = await SELF.fetch("https://example.com/org/teams/AP%20team/members", {
      method: "POST",
      body: JSON.stringify({ userId: "usr1" }),
    });
    expect(res.status).toBe(201);
    const row = await env.DB.prepare("SELECT * FROM org_team_members WHERE team_id = ? AND user_id = ?")
      .bind("AP team", "usr1")
      .first();
    expect(row).toEqual({ team_id: "AP team", user_id: "usr1" });
  });

  it("is not blocked by licence status — an administrative action, not gated product usage", async () => {
    await env.DB.prepare("DELETE FROM licence_cache WHERE id = 1").run();
    const res = await SELF.fetch("https://example.com/org/teams", {
      method: "POST",
      body: JSON.stringify({ id: "t1", name: "AP Team" }),
    });
    expect(res.status).not.toBe(402);
  });

  it("adds a member to a team through the real router", async () => {
    await SELF.fetch("https://example.com/org/teams", {
      method: "POST",
      body: JSON.stringify({ id: "t1", name: "AP Team" }),
    });
    await SELF.fetch("https://example.com/org/users", {
      method: "POST",
      body: JSON.stringify({ id: "usr1", email: "a@b.com", name: "Alice" }),
    });
    const res = await SELF.fetch("https://example.com/org/teams/t1/members", {
      method: "POST",
      body: JSON.stringify({ userId: "usr1" }),
    });
    expect(res.status).toBe(201);
    const row = await env.DB.prepare("SELECT * FROM org_team_members WHERE team_id = ? AND user_id = ?")
      .bind("t1", "usr1")
      .first();
    expect(row).toEqual({ team_id: "t1", user_id: "usr1" });
  });

  it("409s adding a duplicate member through the real router", async () => {
    await SELF.fetch("https://example.com/org/teams", {
      method: "POST",
      body: JSON.stringify({ id: "t1", name: "AP Team" }),
    });
    await SELF.fetch("https://example.com/org/users", {
      method: "POST",
      body: JSON.stringify({ id: "usr1", email: "a@b.com", name: "Alice" }),
    });
    await SELF.fetch("https://example.com/org/teams/t1/members", {
      method: "POST",
      body: JSON.stringify({ userId: "usr1" }),
    });
    const res = await SELF.fetch("https://example.com/org/teams/t1/members", {
      method: "POST",
      body: JSON.stringify({ userId: "usr1" }),
    });
    expect(res.status).toBe(409);
  });
});

describe("task routes, through the real router (decision 0018)", () => {
  async function seedProcessStageAndTeamTask(): Promise<{ taskId: string }> {
    await SELF.fetch("https://example.com/processes", {
      method: "POST",
      body: JSON.stringify({ id: "p1", name: "AP" }),
    });
    await SELF.fetch("https://example.com/processes/p1/stages", {
      method: "POST",
      body: JSON.stringify({ id: "s1", name: "Approval", sequence: 1 }),
    });
    await SELF.fetch("https://example.com/org/teams", {
      method: "POST",
      body: JSON.stringify({ id: "team1", name: "AP Team" }),
    });
    // authHeaders()'s own user, "test-user", holds every permission —
    // added to the team here specifically so claim/complete can be
    // exercised as that identity through the real, authenticated
    // router path.
    await SELF.fetch("https://example.com/org/teams/team1/members", {
      method: "POST",
      body: JSON.stringify({ userId: "test-user" }),
    });
    await SELF.fetch("https://example.com/tasks", {
      method: "POST",
      body: JSON.stringify({ id: "task1", stageId: "s1", teamId: "team1", requiredPermission: "AP.Approve" }),
    });
    return { taskId: "task1" };
  }

  it("401s claiming a task with no credentials at all", async () => {
    const { taskId } = await seedProcessStageAndTeamTask();
    const res = await SELF.fetch(`https://example.com/tasks/${taskId}/claim`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("403s claiming a task when authenticated but lacking the task's own required permission", async () => {
    const { taskId } = await seedProcessStageAndTeamTask();
    // The permission gate runs before team membership is ever
    // checked, so this 403s for the right reason regardless of team
    // membership — a real key, just missing AP.Approve specifically.
    const limitedKey = await seedUserWithPermissions(["AP.Validate"]);
    const res = await SELF.fetch(`https://example.com/tasks/${taskId}/claim`, {
      method: "POST",
      headers: { Authorization: `Bearer ${limitedKey}` },
    });
    expect(res.status).toBe(403);
  });

  it("claims and completes a task through the real router, recording the real authenticated identity", async () => {
    const { taskId } = await seedProcessStageAndTeamTask();
    const claimRes = await SELF.fetch(`https://example.com/tasks/${taskId}/claim`, {
      method: "POST",
      headers: authHeaders(),
    });
    expect(claimRes.status).toBe(200);
    const claimBody = (await claimRes.json()) as { claimedBy: string };
    expect(claimBody.claimedBy).toBe("test-user");

    const completeRes = await SELF.fetch(`https://example.com/tasks/${taskId}/complete`, {
      method: "POST",
      headers: authHeaders(),
    });
    expect(completeRes.status).toBe(200);
    const row = await env.DB.prepare("SELECT claimed_by, completed_by FROM tasks WHERE id = ?")
      .bind(taskId)
      .first();
    expect(row).toEqual({ claimed_by: "test-user", completed_by: "test-user" });
  });

  it("404s claiming a task that does not exist, through the real router", async () => {
    const res = await SELF.fetch("https://example.com/tasks/does-not-exist/claim", {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });
});

describe("intake channels, through the real router (decision 0024)", () => {
  it("creates a channel through the real router", async () => {
    await SELF.fetch("https://example.com/processes", { method: "POST", body: JSON.stringify({ id: "ap-live", name: "Standard AP" }) });
    const res = await SELF.fetch("https://example.com/processes/ap-live/intake-channels", {
      method: "POST",
      body: JSON.stringify({ id: "ic1", name: "Email" }),
    });
    expect(res.status).toBe(201);
  });

  it("the real point of this feature: adding a genuinely new, previously unanticipated channel is an ordinary successful call, live", async () => {
    await SELF.fetch("https://example.com/processes", { method: "POST", body: JSON.stringify({ id: "ap-live", name: "Standard AP" }) });
    for (const name of ["Email", "Mailroom", "EDI"]) {
      await SELF.fetch("https://example.com/processes/ap-live/intake-channels", {
        method: "POST",
        body: JSON.stringify({ id: crypto.randomUUID(), name }),
      });
    }
    // A channel nobody anticipated when this process was first set
    // up — no code change, no deployment, just a normal API call.
    const res = await SELF.fetch("https://example.com/processes/ap-live/intake-channels", {
      method: "POST",
      body: JSON.stringify({ id: crypto.randomUUID(), name: "New Supplier Integration" }),
    });
    expect(res.status).toBe(201);
    const count = await env.DB.prepare("SELECT count(*) AS n FROM intake_channels WHERE process_id = 'ap-live'").first();
    expect(count).toEqual({ n: 4 });
  });

  it("is not blocked by licence status — an administrative action, not gated product usage", async () => {
    await env.DB.prepare("DELETE FROM licence_cache WHERE id = 1").run();
    await SELF.fetch("https://example.com/processes", { method: "POST", body: JSON.stringify({ id: "p1", name: "AP" }) });
    const res = await SELF.fetch("https://example.com/processes/p1/intake-channels", {
      method: "POST",
      body: JSON.stringify({ id: "ic1", name: "Email" }),
    });
    expect(res.status).not.toBe(402);
  });
});

describe("mandate_channel and expense report storage, through the real router (decision 0025)", () => {
  it("POST /invoices persists mandateChannel as a real column", async () => {
    const res = await SELF.fetch("https://example.com/invoices", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ id: "inv-mc-1", facts: { "BT-3": "380" }, mandateChannel: "Mailroom" }),
    });
    expect(res.status).toBe(201);
    const row = await env.DB.prepare("SELECT mandate_channel FROM invoice_headers WHERE id = ?").bind("inv-mc-1").first();
    expect(row).toEqual({ mandate_channel: "Mailroom" });
  });

  it("401s POST /invoices with no credentials, same as before this change", async () => {
    const res = await SELF.fetch("https://example.com/invoices", {
      method: "POST",
      body: JSON.stringify({ id: "inv-mc-2", facts: {}, mandateChannel: "Mailroom" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /expenses persists a real expense report, requiring Expense.Submit", async () => {
    const res = await SELF.fetch("https://example.com/expenses", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        id: "exp-live-1",
        employeeId: "dana",
        category: "Travel",
        amount: 850,
        receiptAttached: false,
        intakeChannel: "iPhone App",
        facts: {},
      }),
    });
    expect(res.status).toBe(201);
    const row = await env.DB.prepare("SELECT category, amount, receipt_attached, intake_channel FROM expense_reports WHERE id = ?")
      .bind("exp-live-1")
      .first();
    expect(row).toEqual({ category: "Travel", amount: 850, receipt_attached: 0, intake_channel: "iPhone App" });
  });

  it("401s POST /expenses with no credentials", async () => {
    const res = await SELF.fetch("https://example.com/expenses", {
      method: "POST",
      body: JSON.stringify({ id: "exp-live-2", category: "Travel" }),
    });
    expect(res.status).toBe(401);
  });

  it("403s POST /expenses for a user lacking Expense.Submit specifically", async () => {
    const limitedKey = await seedUserWithPermissions(["AP.Validate"]); // real key, wrong permission
    const res = await SELF.fetch("https://example.com/expenses", {
      method: "POST",
      headers: { Authorization: `Bearer ${limitedKey}` },
      body: JSON.stringify({ id: "exp-live-3", category: "Travel" }),
    });
    expect(res.status).toBe(403);
  });

  it("is blocked when the licence is blocked, matching /invoices's own gate", async () => {
    await env.DB.prepare("DELETE FROM licence_cache WHERE id = 1").run();
    const res = await SELF.fetch("https://example.com/expenses", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ id: "exp-live-4", category: "Travel" }),
    });
    expect(res.status).toBe(402);
  });
});

describe("process instances and stage visits, through the real router (decision 0019)", () => {
  async function seedActivatedRuleSet(id: string, compiledJson: Record<string, unknown>): Promise<void> {
    await env.DB.prepare("INSERT INTO rule_sets (id, name, mode, status) VALUES (?, ?, ?, ?)")
      .bind(id, "test", "first_match", "active")
      .run();
    const ruleId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO rules (id, rule_set_id, sort_order, enabled) VALUES (?, ?, 0, 1)").bind(ruleId, id).run();
    await env.DB.prepare(
      `INSERT INTO rule_versions (rule_id, version, source_text, compiled_json, compiled_by, approved_by, approved_at, effective_from)
       VALUES (?, 1, ?, ?, ?, ?, ?, ?)`
    )
      .bind(ruleId, "test rule", JSON.stringify(compiledJson), "test-model", "test-user", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")
      .run();
  }

  it("a real invoice moves through a full process end to end, an approval task blocking until completed", async () => {
    // Standard AP: Received (automatic) -> Approval (spawns a task
    // above 1000) -> Payment-eligible (automatic terminal stage).
    await seedActivatedRuleSet("rs-approval", {
      conditions: { field: "BT-112", operator: "greater_than", value: 1000 },
      actions: [{ type: "assign_task", params: { team: "ap-team", permission: "AP.Approve" } }],
    });
    await SELF.fetch("https://example.com/processes", { method: "POST", body: JSON.stringify({ id: "p1", name: "Standard AP" }) });
    await SELF.fetch("https://example.com/processes/p1/stages", {
      method: "POST",
      body: JSON.stringify({ id: "s1", name: "Received", sequence: 1 }),
    });
    await SELF.fetch("https://example.com/processes/p1/stages", {
      method: "POST",
      body: JSON.stringify({ id: "s2", name: "Approval", sequence: 2, ruleSetId: "rs-approval" }),
    });
    await SELF.fetch("https://example.com/processes/p1/stages", {
      method: "POST",
      body: JSON.stringify({ id: "s3", name: "Payment-eligible", sequence: 3 }),
    });
    await SELF.fetch("https://example.com/org/teams", { method: "POST", body: JSON.stringify({ id: "ap-team", name: "AP team" }) });
    await SELF.fetch("https://example.com/org/teams/ap-team/members", {
      method: "POST",
      body: JSON.stringify({ userId: "test-user" }),
    });

    const createRes = await SELF.fetch("https://example.com/processes/p1/instances", {
      method: "POST",
      body: JSON.stringify({ subjectType: "invoice", subjectId: "real-inv-1" }),
    });
    expect(createRes.status).toBe(201);
    const instanceId = (await createRes.json() as { id: string }).id;

    const visitRes = await SELF.fetch(`https://example.com/process-instances/${instanceId}/visit`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ facts: { "BT-112": 3000 } }),
    });
    expect(visitRes.status).toBe(200);
    const visitBody = (await visitRes.json()) as { status: string; currentStageId: string };
    expect(visitBody.status).toBe("in_progress");
    expect(visitBody.currentStageId).toBe("s2"); // blocked at Approval, a real task now exists

    const taskRow = await env.DB.prepare("SELECT id FROM tasks WHERE stage_id = 's2'").first<{ id: string }>();
    expect(taskRow).toBeTruthy();

    const claimRes = await SELF.fetch(`https://example.com/tasks/${taskRow!.id}/claim`, { method: "POST", headers: authHeaders() });
    expect(claimRes.status).toBe(200);
    const completeRes = await SELF.fetch(`https://example.com/tasks/${taskRow!.id}/complete`, { method: "POST", headers: authHeaders() });
    expect(completeRes.status).toBe(200);

    // Completing the task, through the real route, should have
    // automatically pushed the instance all the way to completion —
    // no further explicit call needed.
    const instanceRow = await env.DB.prepare("SELECT status, current_stage_id FROM process_instances WHERE id = ?")
      .bind(instanceId)
      .first();
    expect(instanceRow).toEqual({ status: "completed", current_stage_id: "s3" });
  });

  it("401s visiting a stage with no credentials at all", async () => {
    await SELF.fetch("https://example.com/processes", { method: "POST", body: JSON.stringify({ id: "p1", name: "AP" }) });
    await SELF.fetch("https://example.com/processes/p1/stages", { method: "POST", body: JSON.stringify({ id: "s1", name: "Received", sequence: 1 }) });
    const created = await SELF.fetch("https://example.com/processes/p1/instances", {
      method: "POST",
      body: JSON.stringify({ subjectType: "invoice", subjectId: "inv-1" }),
    });
    const instanceId = (await created.json() as { id: string }).id;
    const res = await SELF.fetch(`https://example.com/process-instances/${instanceId}/visit`, {
      method: "POST",
      body: JSON.stringify({ facts: {} }),
    });
    expect(res.status).toBe(401);
  });

  it("is blocked when the licence is blocked, matching /rules/evaluate's own gate", async () => {
    await env.DB.prepare("DELETE FROM licence_cache WHERE id = 1").run();
    await SELF.fetch("https://example.com/processes", { method: "POST", body: JSON.stringify({ id: "p1", name: "AP" }) });
    await SELF.fetch("https://example.com/processes/p1/stages", { method: "POST", body: JSON.stringify({ id: "s1", name: "Received", sequence: 1 }) });
    const res = await SELF.fetch("https://example.com/process-instances/anything/visit", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ facts: {} }),
    });
    expect(res.status).toBe(402);
  });
});
