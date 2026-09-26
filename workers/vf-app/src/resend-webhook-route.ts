import type { RouteResult } from "./org-route.js";
import { verifyResendWebhookSignature } from "./resend-client.js";

/**
 * Resend's own delivery-status webhook — decision 0498, "full
 * bounce/delivery tracking now," the operator's own choice over the
 * simpler "record whether the send call itself succeeded" option.
 *
 * **Reached directly, never through `vf-ui`'s `/api/*` proxy.** That
 * proxy (`PROXIED_TO_INSTANCE`) exists for the *browser's* own
 * session-authenticated calls (`handleProxy` 401s anything with no
 * session cookie, and only ever forwards a `Content-Type` header —
 * Resend's `svix-id`/`svix-timestamp`/`svix-signature` headers would
 * never survive it). Resend is not a Cloudflare Worker calling
 * `vf-app`'s `workers.dev` address either, so the "a Worker cannot
 * plain-fetch another Worker's workers.dev URL" anti-loop protection
 * (docs/PROGRESS.md's own "Working notes") does not apply — it is an
 * ordinary external HTTPS client, and `vf-app` still has its own
 * public `https://vf-app.vibefinance.workers.dev` address (decision
 * 0189: "`vf-app` and `vf-licence` are still on `workers.dev`").
 * **A future reader should not "fix" this by adding it to `vf-ui`'s
 * allowlist** — that would break it, not complete it.
 *
 * Verified by HMAC (Svix's own scheme, `resend-client.ts`), not by
 * `authenticatePerson` — there is no user on the other end of this
 * request, only Resend's own delivery infrastructure.
 */
export interface ResendWebhookHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

const RANK: Record<string, number> = {
  queued: 0,
  sent: 1,
  delayed: 2,
  delivered: 3,
  bounced: 4,
  complained: 4,
  send_failed: 4,
};

/**
 * Resend's own event names, mapped to this table's closed vocabulary
 * (migration 0090's CHECK). Anything not recognised is accepted with
 * a 200 (Resend's own retry policy would otherwise keep re-delivering
 * an event this table will never understand) and simply ignored.
 */
function statusForEventType(type: string): string | null {
  switch (type) {
    case "email.sent":
      return "sent";
    case "email.delivery_delayed":
      return "delayed";
    case "email.delivered":
      return "delivered";
    case "email.bounced":
      return "bounced";
    case "email.complained":
      return "complained";
    default:
      return null;
  }
}

export async function handleResendWebhook(
  db: D1Database,
  webhookSecret: string | null,
  headers: ResendWebhookHeaders,
  rawBody: string
): Promise<RouteResult> {
  if (!webhookSecret) {
    // Configured to send but not to verify incoming events is an
    // incomplete setup, not a reason to accept unverified requests —
    // refusing loudly here is what makes the gap visible.
    return { status: 500, body: { error: "RESEND_WEBHOOK_SECRET is not configured" } };
  }
  if (!headers.id || !headers.timestamp || !headers.signature) {
    return { status: 400, body: { error: "missing svix-id/svix-timestamp/svix-signature headers" } };
  }

  const verified = await verifyResendWebhookSignature(
    webhookSecret,
    { id: headers.id, timestamp: headers.timestamp, signature: headers.signature },
    rawBody
  );
  if (!verified) {
    return { status: 401, body: { error: "signature did not verify" } };
  }

  const event = JSON.parse(rawBody) as { type?: unknown; data?: { email_id?: unknown } };
  const type = typeof event.type === "string" ? event.type : "";
  const messageId = typeof event.data?.email_id === "string" ? event.data.email_id : null;

  const newStatus = statusForEventType(type);
  if (!newStatus || !messageId) {
    // Not an error — an event this table has no column for, or one
    // with no message id to key on. Acknowledged so Resend does not
    // keep retrying it.
    return { status: 200, body: { ignored: true } };
  }

  const existing = await db
    .prepare("SELECT status FROM supplier_return_emails WHERE provider_message_id = ?")
    .bind(messageId)
    .first<{ status: string }>();
  if (!existing) {
    // A message id this deployment never recorded — a webhook
    // misconfigured against the wrong instance, most likely. Still
    // acknowledged: retrying will never make the row appear.
    return { status: 200, body: { ignored: true, reason: "no matching send recorded" } };
  }

  // **Forward-only.** A `bounced` already recorded should never be
  // walked back to `sent` by a stale, out-of-order retry — the same
  // reasoning migration 0090's own CHECK exists to make the states
  // closed rather than free text.
  if ((RANK[newStatus] ?? 0) < (RANK[existing.status] ?? 0)) {
    return { status: 200, body: { ignored: true, reason: "older than the status already recorded" } };
  }

  await db
    .prepare("UPDATE supplier_return_emails SET status = ?, last_event_at = ? WHERE provider_message_id = ?")
    .bind(newStatus, new Date().toISOString(), messageId)
    .run();

  return { status: 200, body: { updated: true, status: newStatus } };
}
