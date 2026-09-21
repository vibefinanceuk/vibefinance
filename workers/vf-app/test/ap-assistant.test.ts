import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleAskApAssistant, parseToolSelection, type ApAssistantAnswer } from "../src/ap-assistant.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";
import type { CompilerModel } from "@vibefinance/shared";

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

/**
 * Talk to an AP Expert — decision 0430. `parseToolSelection` is
 * tested directly as a pure function, the same refusal-by-default
 * discipline `shared/compiler/parse.test.ts` already proves for
 * `parseModelOutput`. `handleAskApAssistant` is tested end to end
 * against a fake model (this sandbox has no way to exercise the real
 * `env.AI` binding, the same limitation decision 0002's own tests
 * already accept) and the real test DB, so every tool call is a real
 * query, never mocked.
 */

function fakeModel(selectionResponse: string, answerResponse = "irrelevant"): CompilerModel {
  return {
    compile: vi.fn().mockImplementation(async (prompt: string) => {
      return prompt.includes("Reply with ONLY a JSON object") ? selectionResponse : answerResponse;
    }),
  };
}

async function person(id: string, permissions: string[]): Promise<void> {
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES (?, ?, ?)").bind(id, `${id}@acme.com`, id).run();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)")
    .bind(`r-${id}`, id, JSON.stringify(permissions))
    .run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES (?, ?, NULL)").bind(id, `r-${id}`).run();
}

async function process(id: string, stages: { id: string; name: string; sequence: number }[]) {
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES (?, ?)").bind(id, id).run();
  for (const stage of stages) {
    await env.DB.prepare("INSERT INTO process_stages (id, process_id, name, sequence) VALUES (?, ?, ?, ?)")
      .bind(stage.id, id, stage.name, stage.sequence)
      .run();
  }
}

async function supplier(id: string, name: string) {
  await env.DB.prepare("INSERT INTO suppliers (id, erp_identifier, name) VALUES (?, ?, ?)").bind(id, id, name).run();
}

async function invoice(opts: { id: string; supplierId: string; total: number; currency: string }) {
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, total_with_vat, currency, supplier_id) VALUES (?, '{}', ?, ?, ?)")
    .bind(opts.id, opts.total, opts.currency, opts.supplierId)
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
});

describe("parseToolSelection — refusal by default, the same discipline parseModelOutput already established", () => {
  it("parses a valid tool call with no args", () => {
    expect(parseToolSelection('{"tool": "accrual_summary", "args": {}}')).toEqual({
      kind: "tool",
      tool: "accrual_summary",
      args: {},
    });
  });

  it("parses a valid tool call with a supplier arg", () => {
    expect(parseToolSelection('{"tool": "supplier_spend", "args": {"supplier": "Acme"}}')).toEqual({
      kind: "tool",
      tool: "supplier_spend",
      args: { supplier: "Acme" },
    });
  });

  it("tolerates prose around the JSON, the same recovery extractJson already gives the compiler", () => {
    expect(parseToolSelection('Sure, here you go:\n{"tool": "accrual_summary", "args": {}}\nHope that helps!')).toEqual({
      kind: "tool",
      tool: "accrual_summary",
      args: {},
    });
  });

  it("becomes a refusal when the model explicitly declines", () => {
    expect(parseToolSelection('{"tool": "none", "reason": "I can\'t see who approved that invoice."}')).toEqual({
      kind: "none",
      reason: "I can't see who approved that invoice.",
    });
  });

  it("becomes a refusal with a default reason when the model names a tool outside the closed vocabulary", () => {
    const result = parseToolSelection('{"tool": "delete_all_invoices", "args": {}}');
    expect(result.kind).toBe("none");
  });

  it("becomes a refusal when the response is not JSON at all", () => {
    const result = parseToolSelection("I'm not sure what you mean.");
    expect(result.kind).toBe("none");
  });

  it("drops a non-string supplier arg rather than trusting it", () => {
    expect(parseToolSelection('{"tool": "supplier_spend", "args": {"supplier": 12345}}')).toEqual({
      kind: "tool",
      tool: "supplier_spend",
      args: {},
    });
  });
});

describe("the chat's own permission gate (decision 0430) — checked before the AI binding is ever touched", () => {
  it("POST /ap-assistant/ask 401s with no credentials", async () => {
    const res = await SELF.fetch("https://example.com/ap-assistant/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "what do we owe?" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /ap-assistant/ask 403s authenticated but lacking AP.Assistant — holding AP.Analysis is not enough", async () => {
    const key = await seedUserWithPermissions(["AP.Analysis"]);
    const res = await SELF.fetch("https://example.com/ap-assistant/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ question: "what do we owe?" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("handleAskApAssistant — validation before any model call", () => {
  it("400s on an empty question", async () => {
    await person("alice", ["AP.Assistant"]);
    const result = await handleAskApAssistant(env.DB, fakeModel("irrelevant"), null, "alice", "   ");
    expect(result.status).toBe(400);
  });

  it("400s on a non-string question", async () => {
    await person("alice", ["AP.Assistant"]);
    const result = await handleAskApAssistant(env.DB, fakeModel("irrelevant"), null, "alice", 12345);
    expect(result.status).toBe(400);
  });

  it("400s on a question well past a real, typed one", async () => {
    await person("alice", ["AP.Assistant"]);
    const result = await handleAskApAssistant(env.DB, fakeModel("irrelevant"), null, "alice", "a".repeat(600));
    expect(result.status).toBe(400);
  });
});

describe("a refused question — the model's own reason shown directly, no tool ever run", () => {
  it("returns the model's reason verbatim, tool: null", async () => {
    await person("alice", ["AP.Assistant"]);
    const model = fakeModel('{"tool": "none", "reason": "This system has no record of when an invoice was actually paid."}');
    const result = await handleAskApAssistant(env.DB, model, null, "alice", "was this paid on time?");
    const body = result.body as ApAssistantAnswer;
    expect(body.tool).toBeNull();
    expect(body.answer).toBe("This system has no record of when an invoice was actually paid.");
  });
});

describe("a tool the person doesn't hold the permission for — refused before the query ever runs", () => {
  it("names the missing permission rather than silently returning nothing", async () => {
    // Holds AP.Assistant (can use the chat) but not AP.FraudReview
    // (the exception_counts tool's own real gate).
    await person("alice", ["AP.Assistant"]);
    const model = fakeModel('{"tool": "exception_counts", "args": {}}');
    const result = await handleAskApAssistant(env.DB, model, null, "alice", "which suppliers had the most exceptions?");
    const body = result.body as ApAssistantAnswer;
    expect(body.tool).toBe("exception_counts");
    expect(body.answer).toContain("AP.FraudReview");
  });
});

describe("a real tool call — real data, real permission check, the model only phrases the answer", () => {
  it("runs accrual_summary for real and hands the phrasing model its real result", async () => {
    await person("alice", ["AP.Assistant", "AP.Analysis"]);
    await process("ap", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "eligible", name: "Eligible", sequence: 2 },
    ]);
    await supplier("acme", "Acme Widgets");
    await invoice({ id: "inv-1", supplierId: "acme", total: 400, currency: "GBP" });
    await env.DB.prepare(
      "INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES ('pi-1', 'ap', 'invoice', 'inv-1', 'received', 'in_progress')"
    ).run();

    const model = fakeModel('{"tool": "accrual_summary", "args": {}}', "You have £400 in accruals right now.");
    const result = await handleAskApAssistant(env.DB, model, null, "alice", "what do we owe right now?");
    const body = result.body as ApAssistantAnswer;
    expect(body.tool).toBe("accrual_summary");
    expect(body.answer).toBe("You have £400 in accruals right now.");

    // The second call really did receive the real, computed total —
    // not a guess or a placeholder.
    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const answerPrompt = calls.find(([p]) => !p.includes("Reply with ONLY a JSON object"))![0];
    expect(answerPrompt).toContain("400");
  });

  it("filters supplier_spend to the named supplier only, from the real ranked list", async () => {
    await person("alice", ["AP.Assistant", "AP.Supplier"]);
    await supplier("acme", "Acme Widgets");
    await supplier("globex", "Globex Corp");
    await invoice({ id: "inv-1", supplierId: "acme", total: 100, currency: "GBP" });
    await invoice({ id: "inv-2", supplierId: "globex", total: 900, currency: "GBP" });

    const model = fakeModel('{"tool": "supplier_spend", "args": {"supplier": "Acme"}}', "You've spent £100 with Acme.");
    const result = await handleAskApAssistant(env.DB, model, null, "alice", "how much have we spent with Acme?");
    const body = result.body as ApAssistantAnswer;
    expect(body.answer).toBe("You've spent £100 with Acme.");

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const answerPrompt = calls.find(([p]) => !p.includes("Reply with ONLY a JSON object"))![0];
    expect(answerPrompt).toContain("Acme Widgets");
    expect(answerPrompt).not.toContain("Globex");
  });

  it("falls back to a plain message when the phrasing model returns nothing usable", async () => {
    await person("alice", ["AP.Assistant", "AP.Analysis"]);
    const model = fakeModel('{"tool": "accrual_summary", "args": {}}', "   ");
    const result = await handleAskApAssistant(env.DB, model, null, "alice", "what do we owe?");
    const body = result.body as ApAssistantAnswer;
    expect(body.answer.length).toBeGreaterThan(0);
  });
});
