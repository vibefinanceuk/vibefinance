import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import type { CompiledRuleSet } from "@vibefinance/shared";

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

beforeEach(async () => {
  await applyTestSchema();
  await seedActiveLicence();
});

describe("GET /health", () => {
  it("responds ok through the real Worker fetch path", async () => {
    const res = await SELF.fetch("https://example.com/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
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
      body: JSON.stringify({ ruleSetId: "rs1", facts: { "BT-40": "US" }, invoiceId: "inv-4" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json() as { outcome: string }).outcome).toBe("no_match");
  });

  it("400s when both ruleSet and ruleSetId are provided — never a silent preference", async () => {
    const res = await SELF.fetch("https://example.com/rules/evaluate", {
      method: "POST",
      body: JSON.stringify({ ruleSet, ruleSetId: "rs1", facts: {}, invoiceId: "inv-5" }),
    });
    expect(res.status).toBe(400);
  });

  it("400s when neither ruleSet nor ruleSetId is provided", async () => {
    const res = await SELF.fetch("https://example.com/rules/evaluate", {
      method: "POST",
      body: JSON.stringify({ facts: {}, invoiceId: "inv-6" }),
    });
    expect(res.status).toBe(400);
  });

  it("404s when ruleSetId refers to a rule set that does not exist", async () => {
    const res = await SELF.fetch("https://example.com/rules/evaluate", {
      method: "POST",
      body: JSON.stringify({ ruleSetId: "does-not-exist", facts: {}, invoiceId: "inv-7" }),
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
    const res = await SELF.fetch(`https://example.com/rules/${ruleId}/versions/1/examples`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { examples: unknown[] };
    expect(body.examples).toHaveLength(2);
  });

  it("listing examples is not blocked by licence status — read-only, not lights out", async () => {
    const { ruleId } = await seedRuleWithExamples();
    await env.DB.prepare("DELETE FROM licence_cache WHERE id = 1").run();
    const res = await SELF.fetch(`https://example.com/rules/${ruleId}/versions/1/examples`);
    expect(res.status).toBe(200);
  });

  it("POST confirms an example through the real router", async () => {
    const { exampleIds } = await seedRuleWithExamples();
    const res = await SELF.fetch(`https://example.com/rules/examples/${exampleIds[0]}/confirm`, {
      method: "POST",
      body: JSON.stringify({ confirmedBy: "alice@example.com" }),
    });
    expect(res.status).toBe(200);

    const row = await env.DB.prepare("SELECT confirmed_by FROM rule_examples WHERE id = ?")
      .bind(exampleIds[0])
      .first();
    expect(row).toEqual({ confirmed_by: "alice@example.com" });
  });

  it("confirming is blocked when the licence is blocked", async () => {
    const { exampleIds } = await seedRuleWithExamples();
    await env.DB.prepare("DELETE FROM licence_cache WHERE id = 1").run();
    const res = await SELF.fetch(`https://example.com/rules/examples/${exampleIds[0]}/confirm`, {
      method: "POST",
      body: JSON.stringify({ confirmedBy: "alice@example.com" }),
    });
    expect(res.status).toBe(402);
  });

  it("POST activates a rule through the real router once every example is confirmed", async () => {
    const { ruleId, exampleIds } = await seedRuleWithExamples();
    for (const id of exampleIds) {
      await SELF.fetch(`https://example.com/rules/examples/${id}/confirm`, {
        method: "POST",
        body: JSON.stringify({ confirmedBy: "alice@example.com" }),
      });
    }

    const res = await SELF.fetch(`https://example.com/rules/${ruleId}/versions/1/activate`, {
      method: "POST",
      body: JSON.stringify({ activatedBy: "alice@example.com" }),
    });
    expect(res.status).toBe(200);

    const row = await env.DB.prepare("SELECT approved_by FROM rule_versions WHERE rule_id = ?")
      .bind(ruleId)
      .first();
    expect(row).toEqual({ approved_by: "alice@example.com" });
  });

  it("activation is refused through the real router when an example is still unconfirmed", async () => {
    const { ruleId } = await seedRuleWithExamples();
    // Neither example confirmed.
    const res = await SELF.fetch(`https://example.com/rules/${ruleId}/versions/1/activate`, {
      method: "POST",
      body: JSON.stringify({ activatedBy: "alice@example.com" }),
    });
    expect(res.status).toBe(409);
  });

  it("activating is blocked when the licence is blocked", async () => {
    const { ruleId } = await seedRuleWithExamples();
    await env.DB.prepare("DELETE FROM licence_cache WHERE id = 1").run();
    const res = await SELF.fetch(`https://example.com/rules/${ruleId}/versions/1/activate`, {
      method: "POST",
      body: JSON.stringify({ activatedBy: "alice@example.com" }),
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
