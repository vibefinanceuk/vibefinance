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

describe("licence enforcement — the gate applied to mutating endpoints", () => {
  async function setLicenceStatus(status: "active" | "warned" | "blocked", reason?: string) {
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
});
