/**
 * Talking to Resend — decision 0498.
 *
 * **Chosen over Cloudflare's own native Email Service deliberately.**
 * That binding (`env.EMAIL.send()`) is Beta, Workers-Paid-plan-only,
 * and its free sending path is scoped to pre-verified destination
 * addresses — unsuited to a button whose entire point is emailing real
 * suppliers nobody pre-verified. Resend is GA, needs only an HTTP
 * `fetch()` (no SMTP, no extra binding), and has a documented
 * Cloudflare Workers integration path. Checked directly before
 * choosing, and confirmed with the operator.
 *
 * **No SDK dependency.** Resend ships an npm package, but the whole of
 * what this file needs is one POST and one webhook signature check —
 * pulling in a dependency for that would be more surface than the
 * two calls it replaces.
 */

export interface SendEmailInput {
  from: string;
  to: string;
  cc?: string | null;
  subject: string;
  text: string;
}

export type SendEmailResult = { ok: true; messageId: string } | { ok: false; error: string };

/**
 * One send, one attempt. Never retried in here — a retry belongs to
 * whoever decides retrying is even the right response to a given
 * failure (a bad address should not be retried; a timeout might be),
 * and that decision does not belong inside the transport.
 */
export async function sendEmailViaResend(apiKey: string, input: SendEmailInput): Promise<SendEmailResult> {
  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: input.from,
        to: [input.to],
        ...(input.cc ? { cc: [input.cc] } : {}),
        subject: input.subject,
        text: input.text,
      }),
    });
  } catch (err) {
    return { ok: false, error: `could not reach Resend: ${err instanceof Error ? err.message : String(err)}` };
  }

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    return {
      ok: false,
      error: typeof body.message === "string" ? body.message : `Resend refused the send (HTTP ${response.status})`,
    };
  }
  if (typeof body.id !== "string" || !body.id) {
    return { ok: false, error: "Resend accepted the request but returned no message id" };
  }
  return { ok: true, messageId: body.id };
}

/**
 * Typed `Uint8Array<ArrayBuffer>`, not the bare `Uint8Array` (whose
 * generic defaults to `ArrayBufferLike`, which also covers
 * `SharedArrayBuffer`) — TypeScript 5.7's stricter `BufferSource`
 * refuses that wider type at `crypto.subtle.importKey` below, even
 * though the value itself is always a fresh, non-shared buffer.
 */
function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Constant-time string comparison. A signature check that returns
 * early on the first mismatched character leaks, over enough attempts,
 * how much of a guess was right — the standard reason every webhook
 * verification guide insists on this instead of `===`.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface SvixHeaders {
  id: string;
  timestamp: string;
  signature: string;
}

/**
 * Resend signs its webhooks the Svix way: HMAC-SHA256 over
 * `{id}.{timestamp}.{body}`, keyed by the part of `whsec_...` after
 * the prefix (base64), compared against a space-separated list of
 * `v1,<base64 signature>` values — more than one version can appear
 * during a secret rotation, and any match is enough.
 *
 * Takes the **raw body string**, not a re-parsed object — the
 * signature is computed over exact bytes, and JSON.stringify(JSON.
 * parse(body)) is not guaranteed to reproduce them.
 */
export async function verifyResendWebhookSignature(
  secret: string,
  headers: SvixHeaders,
  rawBody: string
): Promise<boolean> {
  const secretB64 = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  const key = await crypto.subtle.importKey(
    "raw",
    base64ToBytes(secretB64),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signedContent = `${headers.id}.${headers.timestamp}.${rawBody}`;
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedContent));
  const expected = bytesToBase64(new Uint8Array(mac));

  return headers.signature
    .split(" ")
    .map((part) => part.split(",")[1])
    .filter((sig): sig is string => Boolean(sig))
    .some((sig) => timingSafeEqual(sig, expected));
}
