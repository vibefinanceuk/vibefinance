import { resolveTenant } from "@vibefinance/shared";
import { evaluateRuleSet, validateRule } from "@vibefinance/shared";
import type { CompiledRuleSet, InvoiceFacts } from "@vibefinance/shared";

export interface Env {
  DB?: D1Database;
}

interface EvaluateRequestBody {
  ruleSet: CompiledRuleSet;
  facts: InvoiceFacts;
  invoiceId: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function handleEvaluate(request: Request, env: Env): Promise<Response> {
  const { db } = resolveTenant(request, env);

  let body: EvaluateRequestBody;
  try {
    body = (await request.json()) as EvaluateRequestBody;
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const { ruleSet, facts, invoiceId } = body;
  if (!ruleSet || !facts || !invoiceId) {
    return json({ error: "ruleSet, facts and invoiceId are required" }, 400);
  }

  // Refusal as a first-class output (Blueprint, "Subsystem one"): a rule
  // that doesn't validate against the closed vocabulary is reported back
  // rather than silently run or silently dropped.
  for (const rule of ruleSet.rules) {
    try {
      validateRule(rule);
    } catch (err) {
      return json(
        { error: `rule ${rule.id} rejected by the closed vocabulary`, detail: String(err) },
        422
      );
    }
  }

  const result = evaluateRuleSet(ruleSet, facts);

  // Append-only execution log — Blueprint, invoice_runs / invoice_run_steps.
  // This is the record that lets a customer problem reproduce from two
  // inputs (their rules and the invoice) without touching their environment.
  const runId = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO invoice_runs (id, invoice_id, rule_set_id, outcome) VALUES (?, ?, ?, ?)"
    )
    .bind(runId, invoiceId, ruleSet.id, result.outcome)
    .run();

  const stepInserts = result.trace.map((step) =>
    db
      .prepare(
        `INSERT INTO invoice_run_steps
           (invoice_run_id, seq, rule_id, rule_version, matched, actions_json)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        runId,
        step.seq,
        step.ruleId,
        step.ruleVersion,
        step.matched ? 1 : 0,
        step.matched ? JSON.stringify(result.actions) : null
      )
  );
  if (stepInserts.length > 0) {
    await db.batch(stepInserts);
  }

  return json({ runId, outcome: result.outcome, actions: result.actions, trace: result.trace });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ status: "ok" });
    }

    if (url.pathname === "/rules/evaluate" && request.method === "POST") {
      return handleEvaluate(request, env);
    }

    return json({ error: "not found" }, 404);
  },
};
