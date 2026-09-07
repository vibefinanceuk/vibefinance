import type { RouteResult } from "./customers-route.js";

/**
 * Who is acting, and what was done — decision 0140.
 *
 * `decided_by` on a signup request is whatever the caller sent, and
 * `signup-route.ts` says so honestly: `ADMIN_API_KEY` is a single
 * shared secret, so `vf-licence` cannot tell which individual is
 * acting.
 *
 * **That was right for one operator with `curl` and it is not
 * attribution.** ISO 27001 A.8.15 and SOC 2 CC7.2 want privileged
 * actions attributable rather than merely recorded, and an approval
 * decides whether a business gets an accounts-payable system, which
 * brings SOC 1 in as well.
 *
 * This is the discipline decision 0010 already applies in `vf-app` —
 * *who confirmed a worked example is read from the authenticated
 * caller, never from a client-supplied field*, proven by a test that
 * sends a spoofed identity and confirms it is ignored.
 *
 * **The control plane has been the exception.** This ends it.
 */

export type ActorSource = "access" | "admin-key";

export interface Actor {
  actor: string;
  actorSource: ActorSource;
}

/**
 * The identity a request carries, in the order it can be trusted.
 *
 * **A verified Access assertion first.** `vf-admin` (decision 0140)
 * sits behind Cloudflare Access, which authenticates the operator and
 * signs a JWT; the Worker verifies it and forwards the email. That is
 * an identity nobody chose for themselves.
 *
 * **The shared key otherwise**, recorded as exactly that. `admin-key`
 * is not a person and the log should not pretend it is — a reader
 * weighing an entry needs to know which of the two they are looking at,
 * and inventing a name would be worse than admitting there isn't one.
 *
 * `Cf-Access-Authenticated-User-Email` is set by Cloudflare **after**
 * it has verified the assertion, and is stripped from any request that
 * did not come through Access. Reading it here is safe **only because
 * the header cannot survive a direct request** — which is why decision
 * 0140 also requires `vf-admin` to verify the JWT rather than rely on
 * this alone.
 */
export function actorFrom(request: Request): Actor {
  const email = request.headers.get("Cf-Access-Authenticated-User-Email")?.trim();
  if (email) {
    return { actor: email.toLowerCase(), actorSource: "access" };
  }
  return { actor: "admin-key", actorSource: "admin-key" };
}

/**
 * Record a privileged action.
 *
 * **Written by the route, never by the caller.** A log a caller can
 * shape is a log an auditor discounts, which is the whole reason
 * `decided_by` needed replacing.
 *
 * **Refusals too.** A log of successes cannot answer *"did anybody try
 * to provision a customer we rejected"*, which is exactly what gets
 * asked. Decision 0055 made the same choice for intake: every arrival
 * recorded whether or not it succeeded.
 *
 * Never throws. **A failure to log must not become a failure to act**:
 * an operator refused because an audit insert failed would be a control
 * that denies service, and the reverse — acting without a record — is
 * the risk this accepts deliberately rather than by omission.
 */
export async function recordAdminAction(
  db: D1Database,
  request: Request,
  action: string,
  result: RouteResult,
  subject?: string
): Promise<void> {
  const { actor, actorSource } = actorFrom(request);

  try {
    await db
      .prepare(
        `INSERT INTO admin_actions (id, actor, actor_source, action, subject, outcome, status_code, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        actor,
        actorSource,
        action,
        subject ?? null,
        result.status < 400 ? "succeeded" : "refused",
        result.status,
        // **The refusal's own reason, and nothing on success.** A body
        // that succeeded may carry a freshly minted API key (decision
        // 0006) or a credential, and decision 0009 is this project's
        // record of key material reaching a place nobody expected. A
        // log is exactly such a place.
        result.status >= 400 ? summarise(result.body) : null
      )
      .run();
  } catch {
    // Deliberately silent. See above: the alternative is a control that
    // denies service.
  }
}

/**
 * A refusal's reason, short enough to read and shorn of anything else.
 *
 * Takes `error` and `reason` only — the two fields a refusal uses
 * (decision 0132) — rather than serialising a body whose shape nobody
 * has audited.
 */
function summarise(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const { error, reason } = body as { error?: unknown; reason?: unknown };

  const parts = [
    typeof reason === "string" ? reason : null,
    typeof error === "string" ? error.slice(0, 200) : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(": ") : null;
}

/**
 * The log, most recent first — decision 0140.
 *
 * **No delete route, and none is coming.** Append-only in the ordinary
 * path: not tamper-*proof*, since anybody with direct database access
 * can do as they like, but tamper-**evident**, which is what the
 * controls ask of a system this size.
 */
export async function handleListAdminActions(
  db: D1Database,
  limit: number
): Promise<RouteResult> {
  const rows = await db
    .prepare(
      `SELECT id, actor, actor_source, action, subject, outcome, status_code, detail, occurred_at
       FROM admin_actions ORDER BY occurred_at DESC, id DESC LIMIT ?`
    )
    .bind(Math.min(Math.max(limit, 1), 500))
    .all<{
      id: string;
      actor: string;
      actor_source: string;
      action: string;
      subject: string | null;
      outcome: string;
      status_code: number;
      detail: string | null;
      occurred_at: string;
    }>();

  return {
    status: 200,
    body: {
      actions: rows.results.map((r) => ({
        id: r.id,
        actor: r.actor,
        // **Said, not implied.** An entry recorded against the shared
        // key is weaker evidence than one against a verified identity,
        // and a reader cannot tell without being told.
        actorSource: r.actor_source,
        action: r.action,
        subject: r.subject,
        outcome: r.outcome,
        statusCode: r.status_code,
        detail: r.detail,
        occurredAt: r.occurred_at,
      })),
    },
  };
}
