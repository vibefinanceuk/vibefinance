/**
 * Short-lived signed document tokens — decision 0073.
 *
 * A pop-out window cannot authenticate the way the rest of the API
 * does: `window.open` sends no `Authorization` header, so a route
 * protected like every other one returns 401 in the new window
 * (`docs/design/operator-interface.md` section 4).
 *
 * Three options were costed there. A blob URL avoids any new endpoint
 * and dies on refresh, which a window left open across a split screen
 * for several minutes cannot afford. A cookie introduces a second
 * authentication mechanism alongside the bearer token — the kind of
 * divergence that causes trouble later. So: a token that carries its
 * own authority, scoped to one document and expiring in minutes.
 *
 * HMAC-SHA256 rather than the ECDSA the licence tokens use (decision
 * 0011), because the asymmetry that decision needed does not apply
 * here. A licence token is verified by a DIFFERENT worker that must
 * never be able to mint one; a document token is minted and verified by
 * the same deployment, so a shared secret is the honest fit and the
 * simpler one.
 *
 * Web Crypto's SubtleCrypto works identically in workerd and in
 * production, so nothing here needs a test double.
 */

const TOKEN_TTL_SECONDS = 300;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function hmac(secret: string, payload: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return new Uint8Array(sig);
}

/**
 * Constant-time comparison. A plain `===` on a signature leaks, through
 * response timing, how many leading bytes a guess got right — the same
 * reasoning decision 0006 applies to API key comparison, and the same
 * reason that one is timing-safe too.
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function mintDocumentToken(
  secret: string,
  invoiceId: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = nowSeconds + TOKEN_TTL_SECONDS;
  const payload = `${invoiceId}.${expiresAt}`;
  const sig = await hmac(secret, payload);
  return { token: `${payload}.${base64UrlEncode(sig)}`, expiresAt };
}

export type TokenVerification =
  | { valid: true; invoiceId: string }
  | { valid: false; reason: "malformed" | "expired" | "bad signature" };

export async function verifyDocumentToken(
  secret: string,
  token: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<TokenVerification> {
  const parts = token.split(".");
  if (parts.length !== 3) return { valid: false, reason: "malformed" };
  const [invoiceId, expiryText, providedSig] = parts;

  const expiresAt = Number(expiryText);
  if (!Number.isFinite(expiresAt) || !invoiceId) return { valid: false, reason: "malformed" };

  // Signature before expiry, deliberately. Reporting "expired" for a
  // token whose signature was never valid would tell an attacker their
  // forgery was structurally right and only mistimed.
  const expected = await hmac(secret, `${invoiceId}.${expiresAt}`);
  let provided: Uint8Array;
  try {
    provided = base64UrlDecode(providedSig);
  } catch {
    return { valid: false, reason: "malformed" };
  }
  if (!timingSafeEqual(expected, provided)) return { valid: false, reason: "bad signature" };

  if (nowSeconds >= expiresAt) return { valid: false, reason: "expired" };

  return { valid: true, invoiceId };
}

export { TOKEN_TTL_SECONDS };
