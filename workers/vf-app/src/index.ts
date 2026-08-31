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
import { loadActiveRuleSet } from "./rule-set-loader.js";
import { resolveLocale, t } from "./i18n.js";
import type { LicenceState } from "./licence-cache.js";
import type { Locale } from "./i18n.js";
import {
  handleAssignRole,
  handleCreateRole,
  handleCreateUnit,
  handleCreateUser,
  handleSetAuthorityLimit,
  handleSetProfile,
} from "./org-route.js";
import { requirePermission } from "./enforce.js";
import { handleAddTeamMember, handleCreateTeam } from "./team-route.js";
import { handleRotateUserKey } from "./user-rotate-key-route.js";

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
  /**
   * This customer's language for the genuinely customer-facing subset
   * of API messages — see docs/decisions/0008-locale-aware-messages.md
   * and src/i18n.ts's own comment on scope. Any unset or unrecognised
   * value falls back to English (resolveLocale), never an error — a
   * missing or misconfigured LOCALE degrades gracefully rather than
   * breaking anything. Same "one Worker per customer, configured via
   * vars" pattern as CUSTOMER_ID.
   */
  LOCALE?: string;
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
  /** Either this OR ruleSetId, never both — see handleEvaluate. Kept
   * for testing/reproduction: given an exact ruleSet and facts, the
   * outcome is fully reproducible without touching D1 at all. */
  ruleSet?: CompiledRuleSet;
  /** Loads the currently-activated, currently-effective rules for this
   * rule set from D1 — see rule-set-loader.ts. This is what makes an
   * activated rule (docs/decisions/0007-rule-approval.md) actually
   * govern real evaluation, not just sit as an approved database row. */
  ruleSetId?: string;
  facts: InvoiceFacts;
  invoiceId: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Builds the 402 response for a blocked licence state — was three
 * separately-typed-out copies of this exact logic (one per gated
 * route), now one, which is also the only place this needed to learn
 * about locale. `statusReason` (when set) is an operator-authored free
 * text field on the licence token itself, not one of this file's own
 * fixed message keys — deliberately left untranslated, since there is
 * no fixed catalog entry for arbitrary operator prose to look up.
 */
function blockedResponse(licenceState: LicenceState, locale: Locale): Response {
  const reason = licenceState.known
    ? licenceState.claims.statusReason ?? t("licenceBlockedFallback", locale)
    : t("noLicenceProvisioned", locale);
  return json({ error: t("processingBlocked", locale), reason }, 402);
}

async function handleEvaluate(request: Request, env: Env): Promise<Response> {
  const { db } = resolveTenant(request, env);
  const locale = resolveLocale(env.LOCALE);

  const auth = await requirePermission(db, request, "AP.Validate");
  if (!auth.authorized) {
    return json({ error: t(auth.status === 401 ? "unauthorized" : "forbidden", locale) }, auth.status);
  }

  let body: EvaluateRequestBody;
  try {
    body = (await request.json()) as EvaluateRequestBody;
  } catch {
    return json({ error: t("invalidJsonBody", locale) }, 400);
  }

  const { ruleSet: inlineRuleSet, ruleSetId, facts, invoiceId } = body;
  if (!facts || !invoiceId) {
    return json({ error: t("factsInvoiceIdRequired", locale) }, 400);
  }
  // Exactly one of the two, never a silent preference between them —
  // an ambiguous request that supplied both would otherwise have its
  // ruleSetId quietly ignored, which is exactly the kind of thing
  // worth erroring on rather than guessing.
  if ((inlineRuleSet && ruleSetId) || (!inlineRuleSet && !ruleSetId)) {
    return json({ error: t("exactlyOneRuleSetRequired", locale) }, 400);
  }

  let ruleSet: CompiledRuleSet;
  if (inlineRuleSet) {
    ruleSet = inlineRuleSet;
  } else {
    const loaded = await loadActiveRuleSet(db, ruleSetId as string);
    if (!loaded) {
      return json({ error: t("ruleSetDoesNotExist", locale, { ruleSetId: ruleSetId as string }) }, 404);
    }
    ruleSet = loaded;
  }

  // Refusal as a first-class output (Blueprint, "Subsystem one"): a rule
  // that doesn't validate against the closed vocabulary is reported back
  // rather than silently run or silently dropped. Re-validated here even
  // for a D1-loaded rule set, which was already validated once at
  // compile time — never trust your own storage blindly, same
  // discipline as licence-cache.ts's readLicenceState.
  //
  // Only the wrapper message is translated — `detail` (the underlying
  // RuleValidationError's own message, e.g. "unknown field...") comes
  // from shared/interpreter/evaluate.ts, genuinely shared code between
  // both compile and evaluate paths, not something this route owns.
  // Left in English deliberately, not silently glossed over — see
  // docs/decisions/0008-locale-aware-messages.md.
  for (const rule of ruleSet.rules) {
    try {
      validateRule(rule);
    } catch (err) {
      return json(
        { error: t("ruleRejectedByVocabulary", locale, { ruleId: rule.id }), detail: String(err) },
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
        return blockedResponse(licenceState, resolveLocale(env.LOCALE));
      }
    }

    if (url.pathname === "/rules/evaluate" && request.method === "POST") {
      return handleEvaluate(request, env);
    }

    if (url.pathname === "/rules/compile" && request.method === "POST") {
      const { db } = resolveTenant(request, env);
      const locale = resolveLocale(env.LOCALE);
      const auth = await requirePermission(db, request, "Admin.RuleManagement");
      if (!auth.authorized) {
        return json({ error: t(auth.status === 401 ? "unauthorized" : "forbidden", locale) }, auth.status);
      }
      if (!env.AI) {
        return json({ error: "AI binding not configured" }, 500);
      }
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: t("invalidJsonBody", locale) }, 400);
      }
      const model = createWorkersAiCompilerModel(env.AI);
      const result = await handleCompileRequest(
        model,
        COMPILER_MODEL_ID,
        db,
        (body ?? {}) as Record<string, unknown>,
        locale
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
      const locale = resolveLocale(env.LOCALE);
      const auth = await requirePermission(db, request, "AP.Review");
      if (!auth.authorized) {
        return json({ error: t(auth.status === 401 ? "unauthorized" : "forbidden", locale) }, auth.status);
      }
      const result = await handleListExamples(db, examplesListMatch[1], Number(examplesListMatch[2]));
      return json(result.body, result.status);
    }

    const confirmMatch = url.pathname.match(/^\/rules\/examples\/([^/]+)\/confirm$/);
    if (confirmMatch && request.method === "POST") {
      const { db } = resolveTenant(request, env);
      const locale = resolveLocale(env.LOCALE);
      const licenceState = await readLicenceState(db);
      if (isBlocked(licenceState)) {
        return blockedResponse(licenceState, locale);
      }
      const auth = await requirePermission(db, request, "AP.Review");
      if (!auth.authorized) {
        return json({ error: t(auth.status === 401 ? "unauthorized" : "forbidden", locale) }, auth.status);
      }
      // confirmedBy is derived from the authenticated identity, never
      // trusted from the request body — "The customer said yes, this
      // is what I meant" (Blueprint, rule_examples.confirmed_by) has to
      // actually mean the person who confirmed it, not whatever string
      // a client happened to send. Before real auth existed, this field
      // was just a client-supplied claim anyone could spoof for free.
      const result = await handleConfirmExample(db, confirmMatch[1], auth.user.email, locale);
      return json(result.body, result.status);
    }

    const activateMatch = url.pathname.match(/^\/rules\/([^/]+)\/versions\/(\d+)\/activate$/);
    if (activateMatch && request.method === "POST") {
      const { db } = resolveTenant(request, env);
      const locale = resolveLocale(env.LOCALE);
      const licenceState = await readLicenceState(db);
      if (isBlocked(licenceState)) {
        return blockedResponse(licenceState, locale);
      }
      const auth = await requirePermission(db, request, "AP.Approve");
      if (!auth.authorized) {
        return json({ error: t(auth.status === 401 ? "unauthorized" : "forbidden", locale) }, auth.status);
      }
      // Same reasoning as confirmedBy above — "A person activated this"
      // (Blueprint, rule_versions.approved_by) now means the actual
      // authenticated person, not a spoofable request-body string.
      const result = await handleActivateRule(
        db,
        activateMatch[1],
        Number(activateMatch[2]),
        auth.user.email,
        locale
      );
      return json(result.body, result.status);
    }

    // org/authority/profiles (Blueprint's org/authority/profiles
    // subsystem — see docs/decisions/0009-org-authority-profiles.md):
    // minimal CRUD, deliberately no authentication and no permission
    // enforcement — these routes create the data a future bundle
    // would check against, not check it themselves yet. Deliberately
    // NOT licence-gated either: managing a customer's own org
    // structure is an administrative/setup action, not the product
    // usage /rules/compile and /rules/evaluate are gated for — a
    // blocked customer should still be able to manage their own
    // people and roles.
    if (url.pathname === "/org/units" && request.method === "POST") {
      const { db } = resolveTenant(request, env);
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: t("invalidJsonBody", resolveLocale(env.LOCALE)) }, 400);
      }
      const result = await handleCreateUnit(db, (body ?? {}) as Record<string, unknown>);
      return json(result.body, result.status);
    }

    if (url.pathname === "/org/users" && request.method === "POST") {
      const { db } = resolveTenant(request, env);
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: t("invalidJsonBody", resolveLocale(env.LOCALE)) }, 400);
      }
      const result = await handleCreateUser(db, (body ?? {}) as Record<string, unknown>);
      return json(result.body, result.status);
    }

    if (url.pathname === "/org/roles" && request.method === "POST") {
      const { db } = resolveTenant(request, env);
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: t("invalidJsonBody", resolveLocale(env.LOCALE)) }, 400);
      }
      const result = await handleCreateRole(db, (body ?? {}) as Record<string, unknown>);
      return json(result.body, result.status);
    }

    const assignRoleMatch = url.pathname.match(/^\/org\/users\/([^/]+)\/roles$/);
    if (assignRoleMatch && request.method === "POST") {
      const { db } = resolveTenant(request, env);
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: t("invalidJsonBody", resolveLocale(env.LOCALE)) }, 400);
      }
      const roleId = (body as Record<string, unknown> | null)?.roleId;
      const result = await handleAssignRole(db, assignRoleMatch[1], roleId);
      return json(result.body, result.status);
    }

    const authorityLimitMatch = url.pathname.match(/^\/org\/users\/([^/]+)\/authority-limits$/);
    if (authorityLimitMatch && request.method === "POST") {
      const { db } = resolveTenant(request, env);
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: t("invalidJsonBody", resolveLocale(env.LOCALE)) }, 400);
      }
      const result = await handleSetAuthorityLimit(
        db,
        authorityLimitMatch[1],
        (body ?? {}) as Record<string, unknown>
      );
      return json(result.body, result.status);
    }

    if (url.pathname === "/org/profiles" && request.method === "POST") {
      const { db } = resolveTenant(request, env);
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: t("invalidJsonBody", resolveLocale(env.LOCALE)) }, 400);
      }
      const result = await handleSetProfile(db, (body ?? {}) as Record<string, unknown>);
      return json(result.body, result.status);
    }

    // User key rotation — same purpose as vf-licence's
    // POST /customers/:id/rotate-key: the only way to recover from a
    // lost or leaked key. Not authenticated by permission itself
    // (matching the rest of /org/* — see the comment above), since
    // requiring a permission to rotate a key would reintroduce the
    // exact bootstrap problem this whole subsystem avoids elsewhere.
    const rotateUserKeyMatch = url.pathname.match(/^\/org\/users\/([^/]+)\/rotate-key$/);
    if (rotateUserKeyMatch && request.method === "POST") {
      const { db } = resolveTenant(request, env);
      const result = await handleRotateUserKey(db, rotateUserKeyMatch[1]);
      return json(result.body, result.status);
    }

    // Teams — decisions 0015 (process/workflow engine design) and
    // 0016 (teams). Deliberately unauthenticated, same reasoning as
    // every other /org/* route above: administrative/setup activity,
    // not gated product usage, and gating it would risk the same
    // bootstrap deadlock avoided everywhere else in this subsystem.
    if (url.pathname === "/org/teams" && request.method === "POST") {
      const { db } = resolveTenant(request, env);
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: t("invalidJsonBody", resolveLocale(env.LOCALE)) }, 400);
      }
      const result = await handleCreateTeam(db, (body ?? {}) as Record<string, unknown>);
      return json(result.body, result.status);
    }

    const addTeamMemberMatch = url.pathname.match(/^\/org\/teams\/([^/]+)\/members$/);
    if (addTeamMemberMatch && request.method === "POST") {
      const { db } = resolveTenant(request, env);
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: t("invalidJsonBody", resolveLocale(env.LOCALE)) }, 400);
      }
      const userId = (body as Record<string, unknown> | null)?.userId;
      const result = await handleAddTeamMember(db, addTeamMemberMatch[1], userId);
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
