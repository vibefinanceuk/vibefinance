import { resolveTenant } from "@vibefinance/shared";
import { evaluateRuleSet, validateRule } from "@vibefinance/shared";
import type { CompiledRuleSet, InvoiceFacts } from "@vibefinance/shared";
import { COMPILER_MODEL_ID, createWorkersAiCompilerModel } from "./compiler-model.js";
import type { AiRunnable } from "./compiler-model.js";
import { handleCompileRequest } from "./compile-route.js";
import { isBlocked, readLicenceState, refreshLicenceCache } from "./licence-cache.js";

export interface Env {
  DB?: D1Database;
  AI?: AiRunnable;
  /** JSON string of a JWK-format ECDSA P-256 public key. Not sensitive
   * — the corresponding private key never leaves vf-licence — so this
   * is a plain `vars` entry in wrangler.jsonc, not a secret. */
  LICENCE_SIGNING_PUBLIC_KEY?: string;
  /** The base URL of this customer's vf-licence instance to fetch a
   * token from, e.g. "https://vf-licence.vibefinance.workers.dev". */
  LICENCE_SERVER_URL?: string;
  /** This customer's id, matching the `customers.id` row in vf-licence. */
  CUSTOMER_ID?: string;
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

    // Licence enforcement, Blueprint: "Blocking for non-payment is a
    // deliberate act... Read-only, not lights out." Applied only to
    // mutating endpoints — /health and any future read-only endpoint
    // are deliberately outside this gate, so a blocked customer can
    // still confirm the instance is up and (once they exist) read past
    // results. Only 'blocked' restricts; 'warned' and unset states
    // that ARE known do not. Absence of any cached state at all is
    // still blocked — see licence-cache.ts's isBlocked() doc comment.
    if (url.pathname === "/rules/evaluate" || url.pathname === "/rules/compile") {
      const { db } = resolveTenant(request, env);
      const licenceState = await readLicenceState(db);
      if (isBlocked(licenceState)) {
        const reason = licenceState.known
          ? licenceState.claims.statusReason ?? "licence blocked"
          : "no licence has been provisioned for this instance yet";
        return json({ error: "processing blocked", reason }, 402);
      }
    }

    if (url.pathname === "/rules/evaluate" && request.method === "POST") {
      return handleEvaluate(request, env);
    }

    if (url.pathname === "/rules/compile" && request.method === "POST") {
      const { db } = resolveTenant(request, env);
      if (!env.AI) {
        return json({ error: "AI binding not configured" }, 500);
      }
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid JSON body" }, 400);
      }
      const model = createWorkersAiCompilerModel(env.AI);
      const result = await handleCompileRequest(
        model,
        COMPILER_MODEL_ID,
        db,
        (body ?? {}) as Record<string, unknown>
      );
      return json(result.body, result.status);
    }

    return json({ error: "not found" }, 404);
  },

  /**
   * The scheduled refresh — Blueprint: "The instance fetches it on a
   * schedule, caches it in its own database, and verifies it locally on
   * every request. No network call in the hot path." This is the only
   * place a network call to vf-licence happens; fetch() never does.
   * See wrangler.jsonc's `triggers.crons` for the actual schedule.
   *
   * Third parameter (ctx) is unused today but part of the real Workers
   * scheduled-handler signature (event, env, ctx) — omitting it is a
   * type-checker-invisible bug that `vitest` (esbuild, no type
   * checking) never caught, only `npx tsc --noEmit` did, since nothing
   * calls this with fewer than 3 arguments in production.
   */
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    if (!env.LICENCE_SIGNING_PUBLIC_KEY || !env.LICENCE_SERVER_URL || !env.CUSTOMER_ID) {
      // Deliberately silent rather than throwing: a misconfigured
      // instance should keep running on its last-known cached state
      // (or stay blocked, if it never had one) exactly as if the fetch
      // had failed — not crash the scheduled trigger entirely, which
      // Cloudflare would then retry and log as a failing cron with no
      // clearer signal than this.
      return;
    }
    // A scheduled trigger has no incoming Request — resolveTenant's
    // request parameter is documented as unused today (reserved for
    // routes 2/3, see shared/tenant.ts), so a synthetic one satisfies
    // the discipline without a scheduled()-specific exception to the
    // no-restricted-properties rule. Every binding access in this
    // Worker goes through resolveTenant, including this one — a
    // missing DB binding surfaces as resolveTenant's own
    // TenantResolutionError, caught here and treated the same as any
    // other misconfiguration (silent, stay on cached state).
    let db: D1Database;
    try {
      ({ db } = resolveTenant(new Request("https://scheduled-trigger.internal/"), env));
    } catch {
      return;
    }
    let publicKeyJwk: JsonWebKey;
    try {
      publicKeyJwk = JSON.parse(env.LICENCE_SIGNING_PUBLIC_KEY);
    } catch {
      return;
    }
    const serverUrl = env.LICENCE_SERVER_URL;
    const customerId = env.CUSTOMER_ID;
    await refreshLicenceCache(db, publicKeyJwk, async () => {
      const res = await fetch(`${serverUrl}/licences/${customerId}/token`);
      if (!res.ok) {
        throw new Error(`licence fetch returned HTTP ${res.status}`);
      }
      const payload = (await res.json()) as { token?: string };
      if (typeof payload.token !== "string") {
        throw new Error("licence fetch response had no token field");
      }
      return payload.token;
    });
  },
};
