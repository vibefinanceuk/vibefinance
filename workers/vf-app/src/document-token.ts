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

import type { DocumentType } from "./document-storage.js";

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

/**
 * **The document type travels inside the token now, not recomputed at
 * fetch time** — decision 0273.
 *
 * Before this, `/documents/:token` re-derived "which document" via
 * `preferredDocumentType()`, and the route minting the token had
 * already made that same choice once — two call sites the code's own
 * comment already flagged as needing to "agree," which is exactly the
 * shape of thing that drifts. Embedding the type in the signed payload
 * means there is only one choice made, ever, for a given token.
 */
export async function mintDocumentToken(
  secret: string,
  invoiceId: string,
  documentType: DocumentType,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = nowSeconds + TOKEN_TTL_SECONDS;
  const payload = `${invoiceId}.${documentType}.${expiresAt}`;
  const sig = await hmac(secret, payload);
  return { token: `${payload}.${base64UrlEncode(sig)}`, expiresAt };
}

export type TokenVerification =
  | { valid: true; invoiceId: string; documentType: DocumentType }
  | { valid: false; reason: "malformed" | "expired" | "bad signature" };

export async function verifyDocumentToken(
  secret: string,
  token: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<TokenVerification> {
  const parts = token.split(".");
  if (parts.length !== 4) return { valid: false, reason: "malformed" };
  const [invoiceId, documentTypeText, expiryText, providedSig] = parts;

  const expiresAt = Number(expiryText);
  if (!Number.isFinite(expiresAt) || !invoiceId) return { valid: false, reason: "malformed" };
  if (documentTypeText !== "original" && documentTypeText !== "generated_rendering") {
    return { valid: false, reason: "malformed" };
  }
  const documentType = documentTypeText;

  // Signature before expiry, deliberately. Reporting "expired" for a
  // token whose signature was never valid would tell an attacker their
  // forgery was structurally right and only mistimed.
  const expected = await hmac(secret, `${invoiceId}.${documentType}.${expiresAt}`);
  let provided: Uint8Array;
  try {
    provided = base64UrlDecode(providedSig);
  } catch {
    return { valid: false, reason: "malformed" };
  }
  if (!timingSafeEqual(expected, provided)) return { valid: false, reason: "bad signature" };

  if (nowSeconds >= expiresAt) return { valid: false, reason: "expired" };

  return { valid: true, invoiceId, documentType };
}

/**
 * A signed URL for one page of a multi-page scan — decision 0381 (the
 * first phase of `docs/design/document-viewer.md`).
 *
 * **A separate token, not a third `DocumentType`.** `DocumentType` is
 * `"original" | "generated_rendering"`, matching `invoice_documents`'s
 * own `CHECK` constraint exactly — a page is neither; it lives in
 * `pending_document_pages`, a different table, addressed by a page
 * *number* rather than a fixed type. Widening `DocumentType` to include
 * it would make that closed vocabulary describe something it does not
 * gate, for the sake of reusing four lines. A leading `"page"` literal
 * makes the two token shapes unambiguous at a glance and lets this
 * function change independently of the one above without either
 * having to reason about the other's shape.
 */
export async function mintPageToken(
  secret: string,
  invoiceId: string,
  pageNumber: number,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = nowSeconds + TOKEN_TTL_SECONDS;
  const payload = `page.${invoiceId}.${pageNumber}.${expiresAt}`;
  const sig = await hmac(secret, payload);
  return { token: `${payload}.${base64UrlEncode(sig)}`, expiresAt };
}

export type PageTokenVerification =
  | { valid: true; invoiceId: string; pageNumber: number }
  | { valid: false; reason: "malformed" | "expired" | "bad signature" };

export async function verifyPageToken(
  secret: string,
  token: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<PageTokenVerification> {
  const parts = token.split(".");
  if (parts.length !== 5 || parts[0] !== "page") return { valid: false, reason: "malformed" };
  const [, invoiceId, pageNumberText, expiryText, providedSig] = parts;

  const pageNumber = Number(pageNumberText);
  const expiresAt = Number(expiryText);
  if (!invoiceId || !Number.isInteger(pageNumber) || pageNumber < 1 || !Number.isFinite(expiresAt)) {
    return { valid: false, reason: "malformed" };
  }

  // Signature before expiry, deliberately, for the same reason as
  // above: an attacker's forgery should be told it is wrong, never
  // told it merely arrived late.
  const expected = await hmac(secret, `page.${invoiceId}.${pageNumber}.${expiresAt}`);
  let provided: Uint8Array;
  try {
    provided = base64UrlDecode(providedSig);
  } catch {
    return { valid: false, reason: "malformed" };
  }
  if (!timingSafeEqual(expected, provided)) return { valid: false, reason: "bad signature" };

  if (nowSeconds >= expiresAt) return { valid: false, reason: "expired" };

  return { valid: true, invoiceId, pageNumber };
}

export { TOKEN_TTL_SECONDS };
