import { resolveTenant } from "@vibefinance/shared";
import { evaluateRuleSet, validateRule } from "@vibefinance/shared";
import type { CompiledRuleSet, InvoiceFacts } from "@vibefinance/shared";
import { COMPILER_MODEL_ID, createWorkersAiCompilerModel } from "./compiler-model.js";
import type { AiRunnable } from "./compiler-model.js";
import { handleCompileRequest } from "./compile-route.js";
import { isBlocked, readLicenceState, refreshLicenceCache } from "./licence-cache.js";
import { handleUsagePush } from "./usage-route.js";
import { pushUsage } from "./usage.js";
import { handleConfirmExample, handleListExamples } from "./examples-route.js";
import { handleActivateRule } from "./activate-route.js";
import { handleLicenceRefresh } from "./licence-refresh-route.js";

export interface Env {
  DB?: D1Database;
  AI?: AiRunnable;
  /**
   * A JWK-format ECDSA P-256 public key, as a genuine nested JSON
   * object in wrangler.jsonc's `vars` — not a JSON-string-inside-a-
   * string. Cloudflare delivers a JSON `vars` value to the Worker
   * already parsed (confirmed against their own docs: "JSON variable
   * values that evaluate to string values are exposed as the parsed
   * value" — the same applies to object values on the native `env`
   * binding, not just the process.env compatibility shim). Not
   * sensitive — the corresponding private key never leaves vf-licence
   * — so this is a plain var, not a secret.
   *
   * Typed as `unknown` rather than `JsonWebKey` because there's no
   * schema enforcement between wrangler.jsonc and this interface — a
   * wrong or placeholder value must be validated at the point of use
   * (isPublicKeyJwk, below), not trusted from the type system.
   */
  LICENCE_SIGNING_PUBLIC_KEY?: unknown;
  /**
   * No longer used by any code path in this Worker — see
   * LICENCE_SERVICE's comment for why. Kept declared, not removed,
   * because it's still useful for a human to know where this
   * instance's vf-licence actually lives (manual `curl` debugging,
   * exactly how the workers.dev restriction below was first
   * diagnosed), and removing it would be unnecessary config churn for
   * no functional benefit.
   */
  LICENCE_SERVER_URL?: string;
  /** This customer's id, matching the `customers.id` row in vf-licence. */
  CUSTOMER_ID?: string;
  /**
   * A Service Binding to vf-licence — the correct, Cloudflare-documented
   * way for one Worker to call another within the same account.
   * Confirmed live: a plain global `fetch()` to vf-licence's
   * `*.workers.dev` URL from *inside* vf-app silently 404s — Cloudflare
   * blocks a Worker from fetching another Worker's workers.dev URL as
   * an anti-loop measure, and the request never even reaches the
   * target Worker (confirmed with `wrangler tail` showing nothing).
   * Calls from outside a Worker (a browser, curl, this session's own
   * verify-live-key-match.mjs) are unaffected — only Worker-to-Worker
   * calls hit this. See docs/decisions/0005-service-binding.md.
   *
   * This binding only works because vf-app and vf-licence are
   * deployed to the same Cloudflare account — a genuinely self-hosted
   * customer instance in a *different* account cannot use a service
   * binding at all and would need a different mechanism entirely
   * (a real public hostname plus the `global_fetch_strictly_public`
   * compatibility flag, or a custom domain). Out of scope for now;
   * flagged in the decision doc as a real limitation, not silently
   * assumed to be solved by this fix.
   */
  LICENCE_SERVICE?: Fetcher;
  /**
   * This customer's own API key for vf-licence's per-customer
   * endpoints (GET /licences/:id/token, POST /usage) — see
   * docs/decisions/0006-endpoint-authentication.md. Unlike the signing
   * public key, this genuinely is sensitive: whoever holds it can
   * fetch this customer's licence token and push usage numbers as
   * this customer. Set via `wrangler secret put VF_LICENCE_API_KEY`,
   * using the plaintext key shown exactly once when this customer was
   * created (or last had its key rotated) on vf-licence — never a var,
   * never committed.
   */
  VF_LICENCE_API_KEY?: string;
}

/**
 * A minimal structural check, not full JWK validation — just enough to
 * distinguish "a real public key" from "the wrangler.jsonc placeholder,
 * still unfilled" or "genuinely missing", both of which
 * scheduled() below treats identically (do nothing, stay on cached
 * state). crypto.subtle.importKey() is the actual authority on whether
 * this is a well-formed key; this only decides whether it's worth
 * calling that at all.
 */
function isPublicKeyJwk(value: unknown): value is JsonWebKey {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.kty === "EC" && typeof v.crv === "string" && typeof v.x === "string" && typeof v.y === "string";
}

/**
 * Builds the real LicenceTokenFetcher — used by both the scheduled
 * cron and the on-demand POST /licence/refresh route (see
 * licence-refresh-route.ts's own comment on why that endpoint exists:
 * the same "cron hasn't fired yet" problem already found and fixed for
 * usage telemetry). Extracted here specifically so both call sites
 * share one implementation rather than two copies that could drift.
 */
function createLicenceFetcher(service: Fetcher, customerId: string, apiKey: string) {
  return async () => {
    const res = await service.fetch(`https://vf-licence.internal/licences/${customerId}/token`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      throw new Error(`licence fetch returned HTTP ${res.status}`);
    }
    const payload = (await res.json()) as { token?: string };
    if (typeof payload.token !== "string") {
      throw new Error("licence fetch response had no token field");
    }
    return payload.token;
  };
}

/**
 * Builds the real UsagePusher — the only place this Worker sends usage
 * data to vf-licence, via the Service Binding (see Env.LICENCE_SERVICE's
 * own comment on why not a plain fetch to a workers.dev URL). The host
 * portion of the URL is never actually used for routing by a service
 * binding — the binding itself determines which Worker receives the
 * request — but a well-formed URL is still needed so vf-licence's own
 * `new URL(request.url)` parsing has something valid to read the path
 * from.
 */
function createUsagePusher(service: Fetcher, apiKey: string): import("./usage.js").UsagePusher {
  return async (report) => {
    const res = await service.fetch("https://vf-licence.internal/usage", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(report),
    });
    if (!res.ok) {
      throw new Error(`usage push returned HTTP ${res.status}`);
    }
  };
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

    // On-demand licence refresh — the same fix already applied to
    // usage telemetry, for the identical class of problem: the only
    // thing that otherwise populates licence_cache is the 6-hourly
    // scheduled() cron, and a freshly deployed instance has no way to
    // force that sooner. Found live: a real deploy needed this before
    // its first cron fire ever happened. Deliberately NOT licence-
    // gated — see licence-refresh-route.ts's own comment on why that
    // would make the exact state this endpoint exists to fix
    // permanently unrecoverable.
    if (url.pathname === "/licence/refresh" && request.method === "POST") {
      const { db } = resolveTenant(request, env);
      if (!isPublicKeyJwk(env.LICENCE_SIGNING_PUBLIC_KEY) || !env.LICENCE_SERVICE || !env.CUSTOMER_ID || !env.VF_LICENCE_API_KEY) {
        return json(
          { error: "LICENCE_SIGNING_PUBLIC_KEY, LICENCE_SERVICE, CUSTOMER_ID and VF_LICENCE_API_KEY must all be configured" },
          500
        );
      }
      const result = await handleLicenceRefresh(
        db,
        env.LICENCE_SIGNING_PUBLIC_KEY,
        createLicenceFetcher(env.LICENCE_SERVICE, env.CUSTOMER_ID, env.VF_LICENCE_API_KEY)
      );
      return json(result.body, result.status);
    }

    // On-demand usage push (Blueprint's usage_periods, made idempotent
    // and "as fresh as asked for" rather than a once-per-period batch —
    // see docs/decisions/0004-usage-telemetry.md). Deliberately not
    // licence-gated; see usage-route.ts's own comment. A real
    // product-facing endpoint from the start, not an operator-only
    // debug route — the response includes the full report just pushed,
    // so a future "sync now" UI can show it immediately.
    if (url.pathname === "/usage/push" && request.method === "POST") {
      const { db } = resolveTenant(request, env);
      if (!env.LICENCE_SERVICE || !env.CUSTOMER_ID || !env.VF_LICENCE_API_KEY) {
        return json({ error: "LICENCE_SERVICE, CUSTOMER_ID and VF_LICENCE_API_KEY must be configured" }, 500);
      }
      const result = await handleUsagePush(
        db,
        env.CUSTOMER_ID,
        createUsagePusher(env.LICENCE_SERVICE, env.VF_LICENCE_API_KEY)
      );
      return json(result.body, result.status);
    }

    // Worked examples & activation (Blueprint build order step 3): the
    // enforcement point for "A person activated this. Never
    // auto-promote a generated rule." Confirming and activating are
    // gated the same way /rules/compile is — a blocked customer
    // shouldn't be able to keep authoring and promoting new rules
    // either. Listing is a plain read of existing draft state, not
    // gated, matching "read-only, not lights out" elsewhere in this
    // file. Scope boundary, stated in activate-route.ts's own
    // comment: activating updates rule_versions in D1 but does not,
    // on its own, change what /rules/evaluate does above — that
    // endpoint still takes its ruleSet from the request body.
    const examplesListMatch = url.pathname.match(/^\/rules\/([^/]+)\/versions\/(\d+)\/examples$/);
    if (examplesListMatch && request.method === "GET") {
      const { db } = resolveTenant(request, env);
      const result = await handleListExamples(db, examplesListMatch[1], Number(examplesListMatch[2]));
      return json(result.body, result.status);
    }

    const confirmMatch = url.pathname.match(/^\/rules\/examples\/([^/]+)\/confirm$/);
    if (confirmMatch && request.method === "POST") {
      const { db } = resolveTenant(request, env);
      const licenceState = await readLicenceState(db);
      if (isBlocked(licenceState)) {
        const reason = licenceState.known
          ? licenceState.claims.statusReason ?? "licence blocked"
          : "no licence has been provisioned for this instance yet";
        return json({ error: "processing blocked", reason }, 402);
      }
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid JSON body" }, 400);
      }
      const confirmedBy = (body as Record<string, unknown> | null)?.confirmedBy;
      const result = await handleConfirmExample(db, confirmMatch[1], confirmedBy);
      return json(result.body, result.status);
    }

    const activateMatch = url.pathname.match(/^\/rules\/([^/]+)\/versions\/(\d+)\/activate$/);
    if (activateMatch && request.method === "POST") {
      const { db } = resolveTenant(request, env);
      const licenceState = await readLicenceState(db);
      if (isBlocked(licenceState)) {
        const reason = licenceState.known
          ? licenceState.claims.statusReason ?? "licence blocked"
          : "no licence has been provisioned for this instance yet";
        return json({ error: "processing blocked", reason }, 402);
      }
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid JSON body" }, 400);
      }
      const activatedBy = (body as Record<string, unknown> | null)?.activatedBy;
      const result = await handleActivateRule(db, activateMatch[1], Number(activateMatch[2]), activatedBy);
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
    // Two independent jobs, same cron trigger (see wrangler.jsonc's
    // triggers.crons) — deliberately not one combined guard. A missing
    // or invalid public key must not also block usage reporting, which
    // needs none of the licence-verification config; likewise a usage
    // push failure must never prevent the licence refresh from being
    // attempted. Each block resolves its own db (a scheduled trigger
    // has no incoming Request; see the comment further down on why a
    // synthetic one is used) and swallows its own failures — retried
    // next cron cycle regardless of what the other block did.

    if (
      isPublicKeyJwk(env.LICENCE_SIGNING_PUBLIC_KEY) &&
      env.LICENCE_SERVICE &&
      env.CUSTOMER_ID &&
      env.VF_LICENCE_API_KEY
    ) {
      // A scheduled trigger has no incoming Request — resolveTenant's
      // request parameter is documented as unused today (reserved for
      // routes 2/3, see shared/tenant.ts), so a synthetic one satisfies
      // the discipline without a scheduled()-specific exception to the
      // no-restricted-properties rule. Every binding access in this
      // Worker goes through resolveTenant, including this one — a
      // missing DB binding surfaces as resolveTenant's own
      // TenantResolutionError, caught here and treated the same as any
      // other misconfiguration (silent, stay on cached state).
      try {
        const { db } = resolveTenant(new Request("https://scheduled-trigger.internal/"), env);
        const publicKeyJwk = env.LICENCE_SIGNING_PUBLIC_KEY;
        const service = env.LICENCE_SERVICE;
        const customerId = env.CUSTOMER_ID;
        const apiKey = env.VF_LICENCE_API_KEY;
        await refreshLicenceCache(db, publicKeyJwk, createLicenceFetcher(service, customerId, apiKey));
      } catch {
        // Deliberately silent — see the block comment above.
      }
    }

    // Usage push (Blueprint's usage_periods — see
    // docs/decisions/0004-usage-telemetry.md). Needs only the service
    // binding, CUSTOMER_ID and this customer's own API key — not the
    // signing key at all, since pushing doesn't verify anything.
    if (env.LICENCE_SERVICE && env.CUSTOMER_ID && env.VF_LICENCE_API_KEY) {
      try {
        const { db } = resolveTenant(new Request("https://scheduled-trigger.internal/"), env);
        await pushUsage(
          db,
          new Date(),
          env.CUSTOMER_ID,
          createUsagePusher(env.LICENCE_SERVICE, env.VF_LICENCE_API_KEY)
        );
      } catch {
        // Deliberately silent — retried next cron cycle, or via the
        // on-demand /usage/push endpoint at any time in between.
      }
    }
  },
};
