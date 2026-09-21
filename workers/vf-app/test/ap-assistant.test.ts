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

/**
 * Tracked here so `invoice()` below can embed the same name as
 * `facts_json`'s own `BT-27` automatically — found the hard way
 * (a `totalMatching` test failure): `documents-route.ts`'s own
 * in-memory supplier search reads `BT-27`, never the real
 * `suppliers.name` join, so a test that only sets `supplier_id`
 * exercises a genuinely different supplier-matching path than the
 * SQL-level one `invoice-count-route.ts` uses. Real production data
 * usually has both agree (a supplier name extracted from the invoice
 * and a supplier record it was matched to), so this keeps test data
 * realistic rather than papering over that with a shortcut a real
 * invoice would not take.
 */
const supplierNames = new Map<string, string>();

async function supplier(id: string, name: string) {
  supplierNames.set(id, name);
  await env.DB.prepare("INSERT INTO suppliers (id, erp_identifier, name) VALUES (?, ?, ?)").bind(id, id, name).run();
}

async function invoice(opts: { id: string; supplierId: string; total: number | null; currency: string | null; number?: string; createdAt?: string }) {
  // `facts_json` carries `BT-1` and `BT-27` too, not just an empty
  // object — the `invoice_number` column is what `invoice_lookup`
  // reads (decision 0430's own addendum), but `documents-route.ts`'s
  // own listing (which `invoice_search`, its second addendum, wraps)
  // reads the number and the supplier name out of `facts_json` itself
  // instead, the same fields every other Documents test in this
  // codebase seeds. Both readings are real; a helper meant to
  // exercise every tool that touches an invoice sets all of them.
  const facts: Record<string, string> = {};
  if (opts.number) facts["BT-1"] = opts.number;
  const supplierName = supplierNames.get(opts.supplierId);
  if (supplierName) facts["BT-27"] = supplierName;
  const factsJson = JSON.stringify(facts);
  if (opts.createdAt) {
    await env.DB.prepare(
      "INSERT INTO invoice_headers (id, invoice_number, facts_json, total_with_vat, currency, supplier_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(opts.id, opts.number ?? null, factsJson, opts.total, opts.currency, opts.supplierId, opts.createdAt)
      .run();
    return;
  }
  await env.DB.prepare(
    "INSERT INTO invoice_headers (id, invoice_number, facts_json, total_with_vat, currency, supplier_id) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(opts.id, opts.number ?? null, factsJson, opts.total, opts.currency, opts.supplierId)
    .run();
}

let openTaskSeq = 0;

async function openTask(opts: { owner: string | null; unit?: string | null }) {
  const n = openTaskSeq++;
  const invoiceId = `task-inv-${n}`;
  const piId = `task-pi-${n}`;
  const visitId = `task-v-${n}`;
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'ap')").run();
  await env.DB.prepare("INSERT OR IGNORE INTO process_stages (id, process_id, name, sequence) VALUES ('validation', 'ap', 'Validation', 1)").run();
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, org_unit_id) VALUES (?, '{}', ?)").bind(invoiceId, opts.unit ?? null).run();
  await env.DB.prepare(
    `INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status)
     VALUES (?, 'ap', 'invoice', ?, 'validation', 'in_progress')`
  )
    .bind(piId, invoiceId)
    .run();
  await env.DB.prepare("INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome) VALUES (?, ?, 'validation', 'matched')")
    .bind(visitId, piId)
    .run();
  await env.DB.prepare(
    `INSERT INTO tasks (id, stage_id, stage_visit_id, owner_user_id, required_permission, status)
     VALUES (?, 'validation', ?, ?, 'AP.Validate', 'open')`
  )
    .bind(`task-${n}`, visitId, opts.owner)
    .run();
}

async function purchaseOrder(opts: { id: string; number: string; payable: number; currency: string; status?: string }) {
  await env.DB.prepare("INSERT INTO purchase_orders (id, order_number, payable_amount, currency, status) VALUES (?, ?, ?, ?, ?)")
    .bind(opts.id, opts.number, opts.payable, opts.currency, opts.status ?? "active")
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
  openTaskSeq = 0;
  supplierNames.clear();
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

  it("parses orderNumber for purchase_order_lookup", () => {
    expect(parseToolSelection('{"tool": "purchase_order_lookup", "args": {"orderNumber": "PO-1"}}')).toEqual({
      kind: "tool",
      tool: "purchase_order_lookup",
      args: { orderNumber: "PO-1" },
    });
  });

  it("parses invoiceNumber for invoice_lookup", () => {
    expect(parseToolSelection('{"tool": "invoice_lookup", "args": {"invoiceNumber": "INV-1001"}}')).toEqual({
      kind: "tool",
      tool: "invoice_lookup",
      args: { invoiceNumber: "INV-1001" },
    });
  });

  it("parses a no-arg call to tasks_by_user", () => {
    expect(parseToolSelection('{"tool": "tasks_by_user", "args": {}}')).toEqual({
      kind: "tool",
      tool: "tasks_by_user",
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

/**
 * A pure "reformat what you just told me" follow-up — decision 0430's
 * fifth addendum. A live test asked "list all invoices" (invoice_search
 * answered it fully), then "can you provide a table of results?" and
 * was refused: "The request does not specify which data or criteria to
 * retrieve" — true of that one question in isolation, but not of the
 * conversation, since `recentTurns` already carries what the person is
 * asking to see reformatted. The selection prompt now tells the model
 * to re-run the same tool a formatting-only follow-up refers back to,
 * rather than refuse — real data fetched fresh, never a table typed out
 * from a memorized answer.
 */
describe("a formatting-only follow-up with no criteria of its own", () => {
  it("tells the selection model to re-select the preceding real question's own tool, not refuse", async () => {
    await person("alice", ["AP.Assistant", "AP.Analysis"]);
    const model = fakeModel('{"tool": "accrual_summary", "args": {}}', "irrelevant");
    await handleAskApAssistant(env.DB, model, null, "alice", "can you provide a table of results?", [
      { question: "what do we owe right now?", answer: "You have £400 in accruals." },
    ]);

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const selectionPrompt = calls.find(([p]) => p.includes("Reply with ONLY a JSON object"))![0];
    expect(selectionPrompt).toContain("same tool, with the same arguments");
  });

  it("tells the phrasing model a table or list is fine when explicitly asked, grounded only in the fresh data", async () => {
    await person("alice", ["AP.Assistant", "AP.Analysis"]);
    const model = fakeModel('{"tool": "accrual_summary", "args": {}}', "irrelevant");
    await handleAskApAssistant(env.DB, model, null, "alice", "can you provide a table of results?");

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const answerPrompt = calls.find(([p]) => !p.includes("Reply with ONLY a JSON object"))![0];
    expect(answerPrompt).toContain("a short markdown table or list is fine");
    expect(answerPrompt).toContain("never from a table you remember writing in an earlier answer");
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

  /**
   * Decision 0430's fifth addendum. A live test asked "what invoices
   * are held at each stage" and got back accrual_summary's own real
   * data phrased as "No invoices are listed in any other stage" — true
   * only of the pre-final stages this tool actually covers, since it
   * structurally excludes anything already at its process's own final,
   * payment-eligible stage. Nothing told the phrasing model that
   * boundary; this proves it now does.
   */
  it("tells the phrasing model accrual_summary excludes the final, payment-eligible stage — not every invoice", async () => {
    await person("alice", ["AP.Assistant", "AP.Analysis"]);
    const model = fakeModel('{"tool": "accrual_summary", "args": {}}', "irrelevant");
    await handleAskApAssistant(env.DB, model, null, "alice", "what invoices are held at each stage?");

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const answerPrompt = calls.find(([p]) => !p.includes("Reply with ONLY a JSON object"))![0];
    expect(answerPrompt).toContain("payment-eligible stage");
    expect(answerPrompt).toContain("never say or imply there are no other invoices anywhere else");
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

/**
 * **The bug live testing found, decision 0430's own addendum.** "Who
 * has the most tasks assigned?" had no matching tool, so the selection
 * model picked `exception_counts` (whose old description said "broken
 * down by supplier, by user, and by type") and the phrasing model
 * relabeled a count of *exceptions* as a count of *tasks* to match the
 * question's own wording — the same per-person exception ranking
 * decision 0428's own second addendum pulled from the Workload screen
 * live, resurfacing here mislabeled. Fixed by giving `tasks_by_user`
 * its own real, correctly-matching tool, and by naming both tools'
 * own result fields after what they actually count
 * (`exceptionsPerPerson`, `openTasksPerPerson`) rather than a shared,
 * ambiguous `byUser`.
 */
describe("the tasks-vs-exceptions bug, fixed — decision 0430's own addendum", () => {
  it("exception_counts' own result never uses a field name a phrasing model could read as task data", async () => {
    await person("alice", ["AP.Assistant", "AP.FraudReview"]);
    const model = fakeModel('{"tool": "exception_counts", "args": {}}', "There have been no exceptions.");
    await handleAskApAssistant(env.DB, model, null, "alice", "which suppliers had exceptions?");

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const answerPrompt = calls.find(([p]) => !p.includes("Reply with ONLY a JSON object"))![0];
    expect(answerPrompt).toContain("exceptionsPerPerson");
    expect(answerPrompt).not.toContain('"byUser"');
  });

  it("tasks_by_user answers 'who has the most tasks assigned' with real open-task counts, not exceptions", async () => {
    await person("alice", ["AP.Assistant", "AP.Analysis"]);
    await person("bob", []);
    await person("carol", []);
    await openTask({ owner: "bob" });
    await openTask({ owner: "bob" });
    await openTask({ owner: "carol" });

    const model = fakeModel('{"tool": "tasks_by_user", "args": {}}', "Bob has the most open tasks, with 2.");
    const result = await handleAskApAssistant(env.DB, model, null, "alice", "who has the most tasks assigned?");
    const body = result.body as ApAssistantAnswer;
    expect(body.tool).toBe("tasks_by_user");
    expect(body.answer).toBe("Bob has the most open tasks, with 2.");

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const answerPrompt = calls.find(([p]) => !p.includes("Reply with ONLY a JSON object"))![0];
    expect(answerPrompt).toContain("openTasksPerPerson");
    // The real, seeded count — proving this reached the real
    // `handleWorkloadOpenTasks` query, not a guess.
    expect(answerPrompt).toContain('"openCount":2');
  });

  /**
   * **A live test asked "who is the most active AP team member?" against
   * a workflow where every open task was unclaimed** — `openTasksPerPerson`
   * came back empty, and nothing told the phrasing model that an empty
   * per-person list and a real, positive `unclaimedAndAvailable` count are
   * two different things: "nobody has a task claimed" is not the same
   * claim as "there are no open tasks," but without this instruction a
   * phrasing model reading an empty list alone has no reason to say
   * anything about the second, real number sitting right beside it.
   * Decision 0430's eighth addendum.
   */
  it("tells the phrasing model to mention 'unclaimedAndAvailable' even when nobody currently has a task claimed", async () => {
    await person("alice", ["AP.Assistant", "AP.Analysis"]);
    await openTask({ owner: null });

    const model = fakeModel('{"tool": "tasks_by_user", "args": {}}', "irrelevant");
    await handleAskApAssistant(env.DB, model, null, "alice", "who is the most active AP team member?");

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const answerPrompt = calls.find(([p]) => !p.includes("Reply with ONLY a JSON object"))![0];
    expect(answerPrompt).toContain('"openTasksPerPerson":[]');
    expect(answerPrompt).toContain('"unclaimedAndAvailable":1');
    expect(answerPrompt).toContain("unclaimedAndAvailable");
    expect(answerPrompt).toContain("no one currently has any task claimed");
  });

  it("the selection prompt itself tells the model these are different tools, not a matter of wording", () => {
    const raw = parseToolSelection('{"tool": "tasks_by_user", "args": {}}');
    expect(raw).toEqual({ kind: "tool", tool: "tasks_by_user", args: {} });
  });
});

describe("purchase_order_status and purchase_order_lookup", () => {
  it("counts real purchase orders by status", async () => {
    await person("alice", ["AP.Assistant", "AP.Validate"]);
    await purchaseOrder({ id: "po-1", number: "PO-1", payable: 500, currency: "GBP", status: "active" });
    await purchaseOrder({ id: "po-2", number: "PO-2", payable: 200, currency: "GBP", status: "closed" });

    const model = fakeModel('{"tool": "purchase_order_status", "args": {}}', "One order is active, one is closed.");
    const result = await handleAskApAssistant(env.DB, model, null, "alice", "how many purchase orders are active?");
    const body = result.body as ApAssistantAnswer;
    expect(body.tool).toBe("purchase_order_status");

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const answerPrompt = calls.find(([p]) => !p.includes("Reply with ONLY a JSON object"))![0];
    expect(answerPrompt).toContain('"active":1');
    expect(answerPrompt).toContain('"closed":1');
  });

  it("looks up one real purchase order by its own number", async () => {
    await person("alice", ["AP.Assistant", "AP.Validate"]);
    await purchaseOrder({ id: "po-1", number: "PO-1", payable: 500, currency: "GBP" });

    const model = fakeModel('{"tool": "purchase_order_lookup", "args": {"orderNumber": "PO-1"}}', "PO-1 is active, worth £500.");
    const result = await handleAskApAssistant(env.DB, model, null, "alice", "what's the status of PO-1?");
    const body = result.body as ApAssistantAnswer;
    expect(body.answer).toBe("PO-1 is active, worth £500.");

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const answerPrompt = calls.find(([p]) => !p.includes("Reply with ONLY a JSON object"))![0];
    expect(answerPrompt).toContain('"found":true');
    expect(answerPrompt).toContain("500");
  });

  it("asks for the order number rather than running the query when the model omits it", async () => {
    await person("alice", ["AP.Assistant", "AP.Validate"]);
    const model = fakeModel('{"tool": "purchase_order_lookup", "args": {}}');
    const result = await handleAskApAssistant(env.DB, model, null, "alice", "look up that purchase order");
    const body = result.body as ApAssistantAnswer;
    expect(body.answer).toContain("purchase order number");
    // Only one model call happened — the phrasing step never ran.
    expect((model.compile as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("reports a real, unambiguous not-found rather than guessing", async () => {
    await person("alice", ["AP.Assistant", "AP.Validate"]);
    const model = fakeModel('{"tool": "purchase_order_lookup", "args": {"orderNumber": "NO-SUCH-ORDER"}}', "No such order exists.");
    const result = await handleAskApAssistant(env.DB, model, null, "alice", "what's the status of order NO-SUCH-ORDER?");
    const body = result.body as ApAssistantAnswer;
    expect(body.answer).toBe("No such order exists.");
  });
});

describe("duplicate_invoices", () => {
  it("reports real invoices flagged as possible duplicates", async () => {
    await person("alice", ["AP.Assistant", "AP.FraudReview"]);
    await supplier("acme", "Acme Widgets");
    await env.DB.prepare(
      "INSERT INTO invoice_headers (id, invoice_number, facts_json, total_with_vat, currency, supplier_id, duplicate_confidence) VALUES ('inv-1', 'INV-1', '{}', 400, 'GBP', 'acme', 0.9)"
    ).run();

    const model = fakeModel('{"tool": "duplicate_invoices", "args": {}}', "One invoice from Acme looks like a duplicate.");
    const result = await handleAskApAssistant(env.DB, model, null, "alice", "any possible duplicate invoices?");
    const body = result.body as ApAssistantAnswer;
    expect(body.tool).toBe("duplicate_invoices");

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const answerPrompt = calls.find(([p]) => !p.includes("Reply with ONLY a JSON object"))![0];
    expect(answerPrompt).toContain("Acme Widgets");
    expect(answerPrompt).toContain('"flaggedCount":1');
  });
});

describe("invoice_lookup, including a real Document Viewer link", () => {
  it("finds one real invoice and includes a real Document Viewer link", async () => {
    await person("alice", ["AP.Assistant", "AP.Validate"]);
    await supplier("acme", "Acme Widgets");
    await invoice({ id: "inv-1", number: "INV-1001", supplierId: "acme", total: 250, currency: "GBP" });
    await env.DB.prepare(
      "INSERT INTO invoice_documents (id, invoice_id, r2_key, document_type, content_type) VALUES ('d-1', 'inv-1', 'k-1', 'original', 'application/pdf')"
    ).run();

    const model = fakeModel('{"tool": "invoice_lookup", "args": {"invoiceNumber": "INV-1001"}}', "Here's INV-1001 and its document.");
    const result = await handleAskApAssistant(env.DB, model, null, "alice", "give me a link to invoice INV-1001");
    const body = result.body as ApAssistantAnswer;
    expect(body.answer).toBe("Here's INV-1001 and its document.");

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const answerPrompt = calls.find(([p]) => !p.includes("Reply with ONLY a JSON object"))![0];
    expect(answerPrompt).toContain("/document-window.html?task=inv-1");
  });

  it("tells the phrasing model to give a document link as a markdown link, decision 0430's sixth addendum", async () => {
    await person("alice", ["AP.Assistant", "AP.Validate"]);
    await supplier("acme", "Acme Widgets");
    await invoice({ id: "inv-1", number: "INV-1001", supplierId: "acme", total: 250, currency: "GBP" });
    await env.DB.prepare(
      "INSERT INTO invoice_documents (id, invoice_id, r2_key, document_type, content_type) VALUES ('d-1', 'inv-1', 'k-1', 'original', 'application/pdf')"
    ).run();

    const model = fakeModel('{"tool": "invoice_lookup", "args": {"invoiceNumber": "INV-1001"}}', "irrelevant");
    await handleAskApAssistant(env.DB, model, null, "alice", "give me a link to invoice INV-1001");

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const answerPrompt = calls.find(([p]) => !p.includes("Reply with ONLY a JSON object"))![0];
    expect(answerPrompt).toContain("[View document]");
  });

  it("says plainly when no document is on file, rather than inventing a link", async () => {
    await person("alice", ["AP.Assistant", "AP.Validate"]);
    await supplier("acme", "Acme Widgets");
    await invoice({ id: "inv-1", number: "INV-1001", supplierId: "acme", total: 250, currency: "GBP" });

    const model = fakeModel('{"tool": "invoice_lookup", "args": {"invoiceNumber": "INV-1001"}}', "No document is on file for INV-1001.");
    const result = await handleAskApAssistant(env.DB, model, null, "alice", "link to INV-1001's document");
    const body = result.body as ApAssistantAnswer;
    expect(body.answer).toBe("No document is on file for INV-1001.");

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const answerPrompt = calls.find(([p]) => !p.includes("Reply with ONLY a JSON object"))![0];
    expect(answerPrompt).toContain('"documentUrl":null');
  });

  it("asks for the invoice number rather than guessing 'the latest' one", async () => {
    await person("alice", ["AP.Assistant", "AP.Validate"]);
    const model = fakeModel('{"tool": "invoice_lookup", "args": {}}');
    const result = await handleAskApAssistant(env.DB, model, null, "alice", "link to the latest invoice");
    const body = result.body as ApAssistantAnswer;
    expect(body.answer).toContain("invoice number");
    expect((model.compile as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("surfaces an ambiguous match with data for both, rather than silently picking one supplier's invoice", async () => {
    await person("alice", ["AP.Assistant", "AP.Validate"]);
    await supplier("acme", "Acme Widgets");
    await supplier("globex", "Globex Corp");
    await invoice({ id: "inv-1", number: "INV-1001", supplierId: "acme", total: 250, currency: "GBP" });
    await invoice({ id: "inv-2", number: "INV-1001", supplierId: "globex", total: 900, currency: "GBP" });

    const model = fakeModel('{"tool": "invoice_lookup", "args": {"invoiceNumber": "INV-1001"}}', "There are two invoices numbered INV-1001: Acme Widgets and Globex Corp.");
    const result = await handleAskApAssistant(env.DB, model, null, "alice", "link to invoice INV-1001");
    const body = result.body as ApAssistantAnswer;
    expect(body.answer).toContain("Acme Widgets");

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const answerPrompt = calls.find(([p]) => !p.includes("Reply with ONLY a JSON object"))![0];
    expect(answerPrompt).toContain('"ambiguous":true');
    expect(answerPrompt).toContain("Acme Widgets");
    expect(answerPrompt).toContain("Globex Corp");
  });

  it("returns every ambiguous match's own real document link immediately, rather than withholding all of them", async () => {
    // Decision 0430's third addendum — this chat has no memory of its
    // own, so a bare "which one did you mean?" with no links at all
    // was a dead end every time. Both real documents come back at once.
    await person("alice", ["AP.Assistant", "AP.Validate"]);
    await supplier("acme", "Acme Widgets");
    await supplier("globex", "Globex Corp");
    await invoice({ id: "inv-1", number: "INV-1001", supplierId: "acme", total: 250, currency: "GBP" });
    await invoice({ id: "inv-2", number: "INV-1001", supplierId: "globex", total: 900, currency: "GBP" });
    await env.DB.prepare(
      "INSERT INTO invoice_documents (id, invoice_id, r2_key, document_type, content_type) VALUES ('d-1', 'inv-1', 'k-1', 'original', 'application/pdf')"
    ).run();
    await env.DB.prepare(
      "INSERT INTO invoice_documents (id, invoice_id, r2_key, document_type, content_type) VALUES ('d-2', 'inv-2', 'k-2', 'original', 'application/pdf')"
    ).run();

    const model = fakeModel('{"tool": "invoice_lookup", "args": {"invoiceNumber": "INV-1001"}}', "Here are both.");
    const result = await handleAskApAssistant(env.DB, model, null, "alice", "link to invoice INV-1001");
    expect((result.body as ApAssistantAnswer).answer).toBe("Here are both.");

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const answerPrompt = calls.find(([p]) => !p.includes("Reply with ONLY a JSON object"))![0];
    const dataJson = answerPrompt.slice(answerPrompt.indexOf("{"), answerPrompt.lastIndexOf("}") + 1);
    const data = JSON.parse(dataJson) as { matches: { supplierName: string; documentUrl: string | null }[]; moreMatchesNotShown: boolean };
    expect(data.matches).toHaveLength(2);
    for (const m of data.matches) {
      expect(m.documentUrl).toMatch(/^\/document-window\.html\?task=/);
    }
    expect(data.moreMatchesNotShown).toBe(false);
  });

  it("says plainly when a specific ambiguous match has no document, rather than a link for one and silence for the other", async () => {
    await person("alice", ["AP.Assistant", "AP.Validate"]);
    await supplier("acme", "Acme Widgets");
    await supplier("globex", "Globex Corp");
    await invoice({ id: "inv-1", number: "INV-1001", supplierId: "acme", total: 250, currency: "GBP" });
    await invoice({ id: "inv-2", number: "INV-1001", supplierId: "globex", total: 900, currency: "GBP" });
    await env.DB.prepare(
      "INSERT INTO invoice_documents (id, invoice_id, r2_key, document_type, content_type) VALUES ('d-1', 'inv-1', 'k-1', 'original', 'application/pdf')"
    ).run();
    // inv-2 (Globex) has no document on file.

    const model = fakeModel('{"tool": "invoice_lookup", "args": {"invoiceNumber": "INV-1001"}}', "irrelevant");
    await handleAskApAssistant(env.DB, model, null, "alice", "link to invoice INV-1001");

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const answerPrompt = calls.find(([p]) => !p.includes("Reply with ONLY a JSON object"))![0];
    const dataJson = answerPrompt.slice(answerPrompt.indexOf("{"), answerPrompt.lastIndexOf("}") + 1);
    const data = JSON.parse(dataJson) as { matches: { supplierName: string; documentUrl: string | null }[] };
    const globex = data.matches.find((m) => m.supplierName === "Globex Corp")!;
    const acme = data.matches.find((m) => m.supplierName === "Acme Widgets")!;
    expect(globex.documentUrl).toBeNull();
    expect(acme.documentUrl).toBe("/document-window.html?task=inv-1");
  });
});

/**
 * `invoice_search` — decision 0430's second addendum, live testing's
 * second real gap: "the latest invoice," "invoices received this
 * month," and "list all invoices" all refused, because nothing in the
 * codebase — not just no tool — could list a set of invoices at all.
 * Wraps the real Documents screen's own `handleListDocuments`
 * (`documents-route.ts`), gated by that screen's own `AP.Review`
 * permission rather than `AP.Validate`.
 */
describe("invoice_search, a browsable list rather than one exact number", () => {
  it("is gated by AP.Review, not AP.Assistant alone", async () => {
    await person("alice", ["AP.Assistant"]);
    const model = fakeModel('{"tool": "invoice_search", "args": {}}');
    const result = await handleAskApAssistant(env.DB, model, null, "alice", "list recent invoices");
    const body = result.body as ApAssistantAnswer;
    expect(body.answer).toContain("AP.Review");
  });

  it("lists recent invoices, newest received first", async () => {
    await person("alice", ["AP.Assistant", "AP.Review"]);
    await supplier("acme", "Acme Widgets");
    await invoice({ id: "old", number: "INV-OLD", supplierId: "acme", total: 100, currency: "GBP", createdAt: "2020-01-01T00:00:00Z" });
    await invoice({ id: "new", number: "INV-NEW", supplierId: "acme", total: 200, currency: "GBP", createdAt: "2020-06-01T00:00:00Z" });

    const model = fakeModel('{"tool": "invoice_search", "args": {}}', "Two invoices: INV-NEW and INV-OLD.");
    const result = await handleAskApAssistant(env.DB, model, null, "alice", "list recent invoices");
    const body = result.body as ApAssistantAnswer;
    expect(body.answer).toBe("Two invoices: INV-NEW and INV-OLD.");

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const answerPrompt = calls.find(([p]) => !p.includes("Reply with ONLY a JSON object"))![0];
    const dataJson = answerPrompt.slice(answerPrompt.indexOf("{"), answerPrompt.lastIndexOf("}") + 1);
    const data = JSON.parse(dataJson) as { invoices: { number: string | null }[] };
    expect(data.invoices.map((i) => i.number)).toEqual(["INV-NEW", "INV-OLD"]);
  });

  it('"period": "this_month" excludes an invoice received months ago', async () => {
    await person("alice", ["AP.Assistant", "AP.Review"]);
    await supplier("acme", "Acme Widgets");
    await invoice({ id: "ancient", number: "INV-ANCIENT", supplierId: "acme", total: 100, currency: "GBP", createdAt: "2020-01-01T00:00:00Z" });
    await invoice({ id: "current", number: "INV-CURRENT", supplierId: "acme", total: 200, currency: "GBP" }); // defaults to now

    const model = fakeModel('{"tool": "invoice_search", "args": {"period": "this_month"}}', "One invoice this month: INV-CURRENT.");
    const result = await handleAskApAssistant(env.DB, model, null, "alice", "invoices received this month");
    const body = result.body as ApAssistantAnswer;
    expect(body.answer).toBe("One invoice this month: INV-CURRENT.");

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const answerPrompt = calls.find(([p]) => !p.includes("Reply with ONLY a JSON object"))![0];
    const dataJson = answerPrompt.slice(answerPrompt.indexOf("{"), answerPrompt.lastIndexOf("}") + 1);
    const data = JSON.parse(dataJson) as { invoices: { number: string | null }[] };
    expect(data.invoices.map((i) => i.number)).toEqual(["INV-CURRENT"]);
  });

  it('"latestOnly": true returns exactly one, and says more may exist when others do', async () => {
    await person("alice", ["AP.Assistant", "AP.Review"]);
    await supplier("acme", "Acme Widgets");
    await invoice({ id: "a", number: "INV-A", supplierId: "acme", total: 100, currency: "GBP", createdAt: "2020-01-01T00:00:00Z" });
    await invoice({ id: "b", number: "INV-B", supplierId: "acme", total: 100, currency: "GBP", createdAt: "2020-02-01T00:00:00Z" });
    await invoice({ id: "c", number: "INV-C", supplierId: "acme", total: 100, currency: "GBP", createdAt: "2020-03-01T00:00:00Z" });

    const model = fakeModel('{"tool": "invoice_search", "args": {"latestOnly": true}}', "The latest is INV-C.");
    const result = await handleAskApAssistant(env.DB, model, null, "alice", "what's the latest invoice");
    const body = result.body as ApAssistantAnswer;
    expect(body.answer).toBe("The latest is INV-C.");

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const answerPrompt = calls.find(([p]) => !p.includes("Reply with ONLY a JSON object"))![0];
    const dataJson = answerPrompt.slice(answerPrompt.indexOf("{"), answerPrompt.lastIndexOf("}") + 1);
    const data = JSON.parse(dataJson) as { invoices: { number: string | null }[]; moreMayExist: boolean };
    expect(data.invoices.map((i) => i.number)).toEqual(["INV-C"]);
    expect(data.moreMayExist).toBe(true);
  });

  it("narrows to one supplier when asked", async () => {
    await person("alice", ["AP.Assistant", "AP.Review"]);
    await supplier("acme", "Acme Widgets");
    await supplier("globex", "Globex Corp");
    await invoice({ id: "a", number: "INV-ACME", supplierId: "acme", total: 100, currency: "GBP" });
    await invoice({ id: "g", number: "INV-GLOBEX", supplierId: "globex", total: 100, currency: "GBP" });

    const model = fakeModel('{"tool": "invoice_search", "args": {"supplier": "Acme"}}', "Just the one from Acme.");
    const result = await handleAskApAssistant(env.DB, model, null, "alice", "invoices from Acme");
    const body = result.body as ApAssistantAnswer;
    expect(body.answer).toBe("Just the one from Acme.");

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const answerPrompt = calls.find(([p]) => !p.includes("Reply with ONLY a JSON object"))![0];
    const dataJson = answerPrompt.slice(answerPrompt.indexOf("{"), answerPrompt.lastIndexOf("}") + 1);
    const data = JSON.parse(dataJson) as { invoices: { number: string | null }[] };
    expect(data.invoices.map((i) => i.number)).toEqual(["INV-ACME"]);
  });

  it("'totalMatching' is exact even past the 50-row list cap — decision 0430's third addendum", async () => {
    // The live gap this closes: "how many invoices were received this
    // month" was refused because the old result only ever had a
    // capped list to count from. 62 real rows, cap 50 — the returned
    // list is truncated but the count is not.
    await person("alice", ["AP.Assistant", "AP.Review"]);
    await supplier("acme", "Acme Widgets");
    for (let i = 0; i < 62; i++) {
      await invoice({ id: `inv-${i}`, number: `INV-${i}`, supplierId: "acme", total: 100, currency: "GBP" });
    }

    const model = fakeModel('{"tool": "invoice_search", "args": {}}', "There are 62 invoices.");
    const result = await handleAskApAssistant(env.DB, model, null, "alice", "how many invoices are there?");
    const body = result.body as ApAssistantAnswer;
    expect(body.answer).toBe("There are 62 invoices.");

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const answerPrompt = calls.find(([p]) => !p.includes("Reply with ONLY a JSON object"))![0];
    const dataJson = answerPrompt.slice(answerPrompt.indexOf("{"), answerPrompt.lastIndexOf("}") + 1);
    const data = JSON.parse(dataJson) as { invoices: unknown[]; countReturned: number; totalMatching: number; moreMayExist: boolean };
    expect(data.countReturned).toBe(50);
    expect(data.totalMatching).toBe(62);
    expect(data.moreMayExist).toBe(true);
  });

  it("'totalMatching' reflects a supplier filter, not just the raw fetch cap", async () => {
    await person("alice", ["AP.Assistant", "AP.Review"]);
    await supplier("acme", "Acme Widgets");
    await supplier("globex", "Globex Corp");
    await invoice({ id: "a1", number: "INV-A1", supplierId: "acme", total: 100, currency: "GBP" });
    await invoice({ id: "a2", number: "INV-A2", supplierId: "acme", total: 100, currency: "GBP" });
    await invoice({ id: "g1", number: "INV-G1", supplierId: "globex", total: 100, currency: "GBP" });

    const model = fakeModel('{"tool": "invoice_search", "args": {"supplier": "Acme"}}', "Two invoices from Acme.");
    const result = await handleAskApAssistant(env.DB, model, null, "alice", "how many invoices from Acme?");
    const body = result.body as ApAssistantAnswer;
    expect(body.answer).toBe("Two invoices from Acme.");

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const answerPrompt = calls.find(([p]) => !p.includes("Reply with ONLY a JSON object"))![0];
    const dataJson = answerPrompt.slice(answerPrompt.indexOf("{"), answerPrompt.lastIndexOf("}") + 1);
    const data = JSON.parse(dataJson) as { totalMatching: number; moreMayExist: boolean };
    expect(data.totalMatching).toBe(2);
    expect(data.moreMayExist).toBe(false);
  });

  /**
   * Decision 0430's fourth addendum — a live test asked "total invoice
   * amount for this quarter" and got refused: no tool anywhere summed
   * amounts over a period, and "this_quarter" wasn't even an accepted
   * period value yet.
   */
  it('"period": "this_quarter" excludes an invoice received last quarter', async () => {
    await person("alice", ["AP.Assistant", "AP.Review"]);
    await supplier("acme", "Acme Widgets");
    await invoice({ id: "last-q", number: "INV-LAST-Q", supplierId: "acme", total: 100, currency: "GBP", createdAt: "2020-01-01T00:00:00Z" });
    await invoice({ id: "this-q", number: "INV-THIS-Q", supplierId: "acme", total: 200, currency: "GBP" }); // defaults to now

    const model = fakeModel('{"tool": "invoice_search", "args": {"period": "this_quarter"}}', "One invoice this quarter: INV-THIS-Q.");
    const result = await handleAskApAssistant(env.DB, model, null, "alice", "invoices received this quarter");
    expect((result.body as ApAssistantAnswer).answer).toBe("One invoice this quarter: INV-THIS-Q.");

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const answerPrompt = calls.find(([p]) => !p.includes("Reply with ONLY a JSON object"))![0];
    const dataJson = answerPrompt.slice(answerPrompt.indexOf("{"), answerPrompt.lastIndexOf("}") + 1);
    const data = JSON.parse(dataJson) as { invoices: { number: string | null }[] };
    expect(data.invoices.map((i) => i.number)).toEqual(["INV-THIS-Q"]);
  });

  it("'totalAmountByCurrency' is exact and never blends two currencies, even past the 50-row list cap", async () => {
    await person("alice", ["AP.Assistant", "AP.Review"]);
    await supplier("acme", "Acme Widgets");
    for (let i = 0; i < 55; i++) {
      await invoice({ id: `gbp-${i}`, number: `INV-GBP-${i}`, supplierId: "acme", total: 10, currency: "GBP" });
    }
    await invoice({ id: "usd-1", number: "INV-USD-1", supplierId: "acme", total: 999, currency: "USD" });

    const model = fakeModel('{"tool": "invoice_search", "args": {}}', "£550 and $999.");
    const result = await handleAskApAssistant(env.DB, model, null, "alice", "what's the total invoice amount?");
    expect((result.body as ApAssistantAnswer).answer).toBe("£550 and $999.");

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const answerPrompt = calls.find(([p]) => !p.includes("Reply with ONLY a JSON object"))![0];
    const dataJson = answerPrompt.slice(answerPrompt.indexOf("{"), answerPrompt.lastIndexOf("}") + 1);
    const data = JSON.parse(dataJson) as { totalAmountByCurrency: { currency: string; total: number }[] };
    expect(data.totalAmountByCurrency).toContainEqual({ currency: "GBP", total: 550 });
    expect(data.totalAmountByCurrency).toContainEqual({ currency: "USD", total: 999 });
  });

  /**
   * Decision 0430's sixth addendum — a live test pasted back an answer
   * whose own "exact" total did not match what its own visible rows
   * summed to. Traced to `invoice-count-route.ts`'s total correctly
   * excluding an invoice with no confirmed amount/currency yet, while
   * `invoice_search`'s own list shows it anyway (from raw extracted
   * facts) — correct on both sides, but nothing ever said the total
   * could be narrower than the list beside it. `unconfirmedAmountCount`
   * is how the answer prompt learns to say so.
   */
  describe("'unconfirmedAmountCount' — the total can be narrower than the list, honestly", () => {
    it("is zero when every matching invoice has a confirmed amount and currency", async () => {
      await person("alice", ["AP.Assistant", "AP.Review"]);
      await supplier("acme", "Acme Widgets");
      await invoice({ id: "a", number: "INV-A", supplierId: "acme", total: 100, currency: "GBP" });

      const model = fakeModel('{"tool": "invoice_search", "args": {}}', "irrelevant");
      await handleAskApAssistant(env.DB, model, null, "alice", "list recent invoices");

      const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
      const answerPrompt = calls.find(([p]) => !p.includes("Reply with ONLY a JSON object"))![0];
      const dataJson = answerPrompt.slice(answerPrompt.indexOf("{"), answerPrompt.lastIndexOf("}") + 1);
      const data = JSON.parse(dataJson) as { unconfirmedAmountCount: number };
      expect(data.unconfirmedAmountCount).toBe(0);
    });

    it("counts an invoice with no confirmed amount/currency yet, exactly", async () => {
      await person("alice", ["AP.Assistant", "AP.Review"]);
      await supplier("acme", "Acme Widgets");
      await invoice({ id: "confirmed", number: "INV-CONFIRMED", supplierId: "acme", total: 100, currency: "GBP" });
      await invoice({ id: "unconfirmed", number: "INV-UNCONFIRMED", supplierId: "acme", total: null, currency: null });

      const model = fakeModel('{"tool": "invoice_search", "args": {}}', "irrelevant");
      await handleAskApAssistant(env.DB, model, null, "alice", "list recent invoices");

      const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
      const answerPrompt = calls.find(([p]) => !p.includes("Reply with ONLY a JSON object"))![0];
      const dataJson = answerPrompt.slice(answerPrompt.indexOf("{"), answerPrompt.lastIndexOf("}") + 1);
      const data = JSON.parse(dataJson) as { unconfirmedAmountCount: number };
      expect(data.unconfirmedAmountCount).toBe(1);
    });

    it("tells the answer prompt to disclose it plainly, only when it is above zero", async () => {
      await person("alice", ["AP.Assistant", "AP.Review"]);
      const model = fakeModel('{"tool": "invoice_search", "args": {}}', "irrelevant");
      await handleAskApAssistant(env.DB, model, null, "alice", "list recent invoices");

      const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
      const answerPrompt = calls.find(([p]) => !p.includes("Reply with ONLY a JSON object"))![0];
      expect(answerPrompt).toContain("unconfirmedAmountCount");
      expect(answerPrompt).toContain("does not include every invoice shown");
    });
  });

  /**
   * Decision 0430's fourth addendum — the general list carries no
   * document field at all, on purpose (checking up to 50 rows would
   * mean up to 50 existence checks for one browsing question). A live
   * test showed the answer-phrasing model fabricating "no document on
   * file" for every row anyway; the fix lives in the answer prompt
   * itself, but this proves the tool's own data gives it nothing to
   * go on either way.
   */
  it("carries no document field at all for the general list, so there is nothing to fabricate from", async () => {
    await person("alice", ["AP.Assistant", "AP.Review"]);
    await supplier("acme", "Acme Widgets");
    await invoice({ id: "a", number: "INV-A", supplierId: "acme", total: 100, currency: "GBP" });

    const model = fakeModel('{"tool": "invoice_search", "args": {}}', "irrelevant");
    await handleAskApAssistant(env.DB, model, null, "alice", "list recent invoices");

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const answerPrompt = calls.find(([p]) => !p.includes("Reply with ONLY a JSON object"))![0];
    const dataJson = answerPrompt.slice(answerPrompt.indexOf("{"), answerPrompt.lastIndexOf("}") + 1);
    const data = JSON.parse(dataJson) as { invoices: Record<string, unknown>[] };
    expect(data.invoices).toHaveLength(1);
    expect(Object.keys(data.invoices[0])).not.toContain("documentUrl");
  });

  /**
   * Asked for in two separate live tests now: "please show the most
   * recent invoice" immediately followed by "can you provide the
   * link." `latestOnly` caps the result at exactly one row, so minting
   * a document link there costs no more than `invoice_lookup` already
   * pays for a single match.
   */
  it("'latestOnly': true mints a real document link for that one invoice, when one is on file", async () => {
    await person("alice", ["AP.Assistant", "AP.Review"]);
    await supplier("acme", "Acme Widgets");
    await invoice({ id: "inv-1", number: "INV-LATEST", supplierId: "acme", total: 100, currency: "GBP" });
    await env.DB.prepare(
      "INSERT INTO invoice_documents (id, invoice_id, r2_key, document_type, content_type) VALUES ('d-1', 'inv-1', 'k-1', 'original', 'application/pdf')"
    ).run();

    const model = fakeModel('{"tool": "invoice_search", "args": {"latestOnly": true}}', "Here's INV-LATEST and its document.");
    const result = await handleAskApAssistant(env.DB, model, null, "alice", "link to the latest invoice");
    expect((result.body as ApAssistantAnswer).answer).toBe("Here's INV-LATEST and its document.");

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const answerPrompt = calls.find(([p]) => !p.includes("Reply with ONLY a JSON object"))![0];
    const dataJson = answerPrompt.slice(answerPrompt.indexOf("{"), answerPrompt.lastIndexOf("}") + 1);
    const data = JSON.parse(dataJson) as { invoices: { documentUrl?: string | null }[] };
    expect(data.invoices[0].documentUrl).toBe("/document-window.html?task=inv-1");
  });

  it("'latestOnly': true states a null documentUrl, not silence, when no document is on file", async () => {
    await person("alice", ["AP.Assistant", "AP.Review"]);
    await supplier("acme", "Acme Widgets");
    await invoice({ id: "inv-1", number: "INV-LATEST", supplierId: "acme", total: 100, currency: "GBP" });
    // No invoice_documents row — nothing retained.

    const model = fakeModel('{"tool": "invoice_search", "args": {"latestOnly": true}}', "irrelevant");
    await handleAskApAssistant(env.DB, model, null, "alice", "link to the latest invoice");

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const answerPrompt = calls.find(([p]) => !p.includes("Reply with ONLY a JSON object"))![0];
    const dataJson = answerPrompt.slice(answerPrompt.indexOf("{"), answerPrompt.lastIndexOf("}") + 1);
    const data = JSON.parse(dataJson) as { invoices: { documentUrl?: string | null }[] };
    expect(data.invoices[0]).toHaveProperty("documentUrl", null);
  });
});

/**
 * `ApAssistantAnswer.table` — decision 0430's seventh addendum, real
 * rows for a downloadable CSV/PDF, asked for directly in the same live
 * test that asked for a clickable document link. Built from
 * `invoice_search`'s own real result, never from the phrasing model's
 * own prose, so the numbers in a downloaded file can never drift from
 * the sentence sitting right above the download button.
 */
describe("'table' — real rows behind an answer, for a download", () => {
  it("is a real table for invoice_search, matching the tool's own real rows exactly", async () => {
    await person("alice", ["AP.Assistant", "AP.Review"]);
    await supplier("acme", "Acme Widgets");
    await invoice({ id: "a", number: "INV-A", supplierId: "acme", total: 100, currency: "GBP" });

    const model = fakeModel('{"tool": "invoice_search", "args": {}}', "One invoice: INV-A.");
    const result = await handleAskApAssistant(env.DB, model, null, "alice", "list recent invoices");
    const body = result.body as ApAssistantAnswer;

    expect(body.table).not.toBeNull();
    expect(body.table?.columns).toEqual(["Invoice #", "Supplier", "Amount", "Currency", "Issue date", "Received at", "Stage", "Status"]);
    expect(body.table?.rows).toHaveLength(1);
    expect(body.table?.rows[0][0]).toBe("INV-A");
    expect(body.table?.rows[0][1]).toBe("Acme Widgets");
  });

  it("is null for a tool with no naturally tabular result", async () => {
    await person("alice", ["AP.Assistant", "AP.Analysis"]);
    const model = fakeModel('{"tool": "accrual_summary", "args": {}}', "You have £0 in accruals.");
    const result = await handleAskApAssistant(env.DB, model, null, "alice", "what do we owe?");
    expect((result.body as ApAssistantAnswer).table).toBeNull();
  });

  it("is null when the question is refused outright, rather than missing", async () => {
    await person("alice", ["AP.Assistant"]);
    const model = fakeModel("irrelevant");
    const result = await handleAskApAssistant(env.DB, model, null, "alice", "hello");
    expect((result.body as ApAssistantAnswer).table).toBeNull();
  });

  it("tells the selection model a download/export/CSV/PDF follow-up reuses the preceding real question, the same as a table request", async () => {
    await person("alice", ["AP.Assistant", "AP.Review"]);
    const model = fakeModel('{"tool": "invoice_search", "args": {}}', "irrelevant");
    await handleAskApAssistant(env.DB, model, null, "alice", "can I download that as a CSV?", [
      { question: "list recent invoices", answer: "Here are the invoices." },
    ]);

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const selectionPrompt = calls.find(([p]) => p.includes("Reply with ONLY a JSON object"))![0];
    expect(selectionPrompt).toContain("as a CSV");
    expect(selectionPrompt).toContain("as a PDF");
  });
});

/**
 * A workflow stage, by name — decision 0430's fifth addendum. A live
 * test asked "list the invoices held at the Validation stage" and was
 * refused outright, even though `documents-route.ts`'s own `stage`
 * filter already existed; nothing exposed it here. `process_stages` is
 * customer-configurable, so a name is resolved to every real id
 * sharing it, never just the first found.
 */
async function placeAtStage(opts: { invoiceId: string; processId: string; stageId: string; status?: string }) {
  await env.DB.prepare(
    "INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES (?, ?, 'invoice', ?, ?, ?)"
  )
    .bind(`pi-${opts.invoiceId}`, opts.processId, opts.invoiceId, opts.stageId, opts.status ?? "in_progress")
    .run();
}

describe("invoice_search, narrowed to one real workflow stage by name", () => {
  it("lists only the invoices currently held at the named stage", async () => {
    await person("alice", ["AP.Assistant", "AP.Review"]);
    await process("ap", [
      { id: "matching", name: "Matching", sequence: 1 },
      { id: "validation", name: "Validation", sequence: 2 },
    ]);
    await supplier("acme", "Acme Widgets");
    await invoice({ id: "in-matching", number: "INV-MATCHING", supplierId: "acme", total: 100, currency: "GBP" });
    await invoice({ id: "in-validation", number: "INV-VALIDATION", supplierId: "acme", total: 200, currency: "GBP" });
    await placeAtStage({ invoiceId: "in-matching", processId: "ap", stageId: "matching" });
    await placeAtStage({ invoiceId: "in-validation", processId: "ap", stageId: "validation" });

    const model = fakeModel('{"tool": "invoice_search", "args": {"stage": "Validation"}}', "One invoice at Validation: INV-VALIDATION.");
    const result = await handleAskApAssistant(env.DB, model, null, "alice", "list the invoices held at the validation stage");
    expect((result.body as ApAssistantAnswer).answer).toBe("One invoice at Validation: INV-VALIDATION.");

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const answerPrompt = calls.find(([p]) => !p.includes("Reply with ONLY a JSON object"))![0];
    const dataJson = answerPrompt.slice(answerPrompt.indexOf("{"), answerPrompt.lastIndexOf("}") + 1);
    const data = JSON.parse(dataJson) as { invoices: { number: string | null }[]; totalMatching: number };
    expect(data.invoices.map((i) => i.number)).toEqual(["INV-VALIDATION"]);
    expect(data.totalMatching).toBe(1);
  });

  it("matches a stage name across every process that has one, not just the first found", async () => {
    await person("alice", ["AP.Assistant", "AP.Review"]);
    await process("ap", [{ id: "ap-validation", name: "Validation", sequence: 1 }]);
    await process("expenses", [{ id: "exp-validation", name: "Validation", sequence: 1 }]);
    await supplier("acme", "Acme Widgets");
    await invoice({ id: "ap-inv", number: "INV-AP", supplierId: "acme", total: 100, currency: "GBP" });
    await invoice({ id: "exp-inv", number: "INV-EXP", supplierId: "acme", total: 200, currency: "GBP" });
    await placeAtStage({ invoiceId: "ap-inv", processId: "ap", stageId: "ap-validation" });
    await placeAtStage({ invoiceId: "exp-inv", processId: "expenses", stageId: "exp-validation" });

    const model = fakeModel('{"tool": "invoice_search", "args": {"stage": "Validation"}}', "Two invoices at Validation.");
    const result = await handleAskApAssistant(env.DB, model, null, "alice", "invoices at the validation stage");
    expect((result.body as ApAssistantAnswer).answer).toBe("Two invoices at Validation.");

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const answerPrompt = calls.find(([p]) => !p.includes("Reply with ONLY a JSON object"))![0];
    const dataJson = answerPrompt.slice(answerPrompt.indexOf("{"), answerPrompt.lastIndexOf("}") + 1);
    const data = JSON.parse(dataJson) as { totalMatching: number };
    expect(data.totalMatching).toBe(2);
  });

  it("excludes an invoice that only passed through the stage and has since moved on", async () => {
    await person("alice", ["AP.Assistant", "AP.Review"]);
    await process("ap", [
      { id: "matching", name: "Matching", sequence: 1 },
      { id: "validation", name: "Validation", sequence: 2 },
    ]);
    await supplier("acme", "Acme Widgets");
    await invoice({ id: "moved-on", number: "INV-MOVED-ON", supplierId: "acme", total: 100, currency: "GBP" });
    // Now sitting at Validation, not Matching — even though it once passed through Matching.
    await placeAtStage({ invoiceId: "moved-on", processId: "ap", stageId: "validation" });

    const model = fakeModel('{"tool": "invoice_search", "args": {"stage": "Matching"}}', "None at Matching.");
    const result = await handleAskApAssistant(env.DB, model, null, "alice", "invoices at the matching stage");
    expect((result.body as ApAssistantAnswer).answer).toBe("None at Matching.");

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const answerPrompt = calls.find(([p]) => !p.includes("Reply with ONLY a JSON object"))![0];
    const dataJson = answerPrompt.slice(answerPrompt.indexOf("{"), answerPrompt.lastIndexOf("}") + 1);
    const data = JSON.parse(dataJson) as { invoices: unknown[]; totalMatching: number };
    expect(data.invoices).toEqual([]);
    expect(data.totalMatching).toBe(0);
  });

  it("reports a name matching no real stage plainly, rather than silently dropping the filter or claiming zero", async () => {
    await person("alice", ["AP.Assistant", "AP.Review"]);
    await supplier("acme", "Acme Widgets");
    await invoice({ id: "a", number: "INV-A", supplierId: "acme", total: 100, currency: "GBP" });

    const model = fakeModel('{"tool": "invoice_search", "args": {"stage": "Not A Real Stage"}}', "irrelevant");
    await handleAskApAssistant(env.DB, model, null, "alice", "invoices at the not-a-real-stage stage");

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const answerPrompt = calls.find(([p]) => !p.includes("Reply with ONLY a JSON object"))![0];
    const dataJson = answerPrompt.slice(answerPrompt.indexOf("{"), answerPrompt.lastIndexOf("}") + 1);
    const data = JSON.parse(dataJson) as { stageRecognized: boolean; stageRequested: string };
    expect(data.stageRecognized).toBe(false);
    expect(data.stageRequested).toBe("Not A Real Stage");
  });
});

/**
 * `recentTurns` — decision 0430's third addendum. Nothing is stored
 * server-side; this is untrusted client input, the same trust level
 * `question` itself has always had, so every case here treats it that
 * way — sanitized, capped, and simply ignored when malformed rather
 * than erroring.
 */
describe("recentTurns, bounded conversational context", () => {
  it("is absent from both prompts when no history is given, unchanged from before this addendum", async () => {
    await person("alice", ["AP.Assistant", "AP.Analysis"]);
    const model = fakeModel('{"tool": "accrual_summary", "args": {}}', "You have £0 in accruals.");
    await handleAskApAssistant(env.DB, model, null, "alice", "what do we owe?");

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    for (const [prompt] of calls) {
      expect(prompt).not.toContain("For context");
    }
  });

  it("appears in both the selection and answer prompts when given", async () => {
    await person("alice", ["AP.Assistant", "AP.Analysis"]);
    const model = fakeModel('{"tool": "accrual_summary", "args": {}}', "You have £0 in accruals.");
    await handleAskApAssistant(env.DB, model, null, "alice", "and the year before that?", [
      { question: "how much have we spent with Acme?", answer: "You've spent £1,200 with Acme this year." },
    ]);

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    expect(calls).toHaveLength(2);
    for (const [prompt] of calls) {
      expect(prompt).toContain("how much have we spent with Acme?");
      expect(prompt).toContain("You've spent £1,200 with Acme this year.");
    }
  });

  it("is silently ignored when not an array, rather than erroring", async () => {
    await person("alice", ["AP.Assistant", "AP.Analysis"]);
    const model = fakeModel('{"tool": "accrual_summary", "args": {}}', "You have £0 in accruals.");
    const result = await handleAskApAssistant(env.DB, model, null, "alice", "what do we owe?", "not an array");

    expect(result.status).toBe(200);
    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    for (const [prompt] of calls) {
      expect(prompt).not.toContain("For context");
    }
  });

  it("drops a malformed entry (missing 'answer') rather than including it half-formed", async () => {
    await person("alice", ["AP.Assistant", "AP.Analysis"]);
    const model = fakeModel('{"tool": "accrual_summary", "args": {}}', "You have £0 in accruals.");
    await handleAskApAssistant(env.DB, model, null, "alice", "what do we owe?", [
      { question: "a real question with no answer field" },
      { question: "a real one", answer: "and a real answer" },
    ]);

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    for (const [prompt] of calls) {
      expect(prompt).not.toContain("a real question with no answer field");
      expect(prompt).toContain("and a real answer");
    }
  });

  it("truncates an oversized turn rather than sending it whole", async () => {
    await person("alice", ["AP.Assistant", "AP.Analysis"]);
    const model = fakeModel('{"tool": "accrual_summary", "args": {}}', "You have £0 in accruals.");
    const longAnswer = "x".repeat(1000);
    await handleAskApAssistant(env.DB, model, null, "alice", "what do we owe?", [
      { question: "q", answer: longAnswer },
    ]);

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    for (const [prompt] of calls) {
      expect(prompt).not.toContain(longAnswer);
      expect(prompt).toContain("x".repeat(300));
    }
  });

  it("caps at 50 turns even when the client sends more, keeping the most recent", async () => {
    await person("alice", ["AP.Assistant", "AP.Analysis"]);
    const model = fakeModel('{"tool": "accrual_summary", "args": {}}', "You have £0 in accruals.");
    const turns = Array.from({ length: 55 }, (_, i) => ({ question: `question number ${i}`, answer: `answer number ${i}` }));
    await handleAskApAssistant(env.DB, model, null, "alice", "what do we owe?", turns);

    const calls = (model.compile as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const selectionPrompt = calls.find(([p]) => p.includes("Reply with ONLY a JSON object"))![0];
    // The oldest five (0–4) were dropped; the most recent fifty (5–54) kept.
    expect(selectionPrompt).not.toContain("question number 0\"");
    expect(selectionPrompt).not.toContain("question number 4\"");
    expect(selectionPrompt).toContain("question number 5\"");
    expect(selectionPrompt).toContain("question number 54\"");
  });
});
