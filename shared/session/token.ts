import type { SessionClaims, SessionVerifyResult } from "./types.js";

/**
 * Session tokens — decision 0086.
 *
 * The same JWT shape and the same ECDSA P-256 as the licence token
 * (`shared/licensing/token.ts`), deliberately: that scheme is proven,
 * its forgery and tampering resistance is tested directly, and Web
 * Crypto behaves identically in workerd and production so nothing here
 * needs a test double.
 *
 * What differs is what the token *says* and how long it lives. Sharing
 * the crypto while separating the claims is the point — one token type
 * carrying both would have a lifetime that suits neither.
 */
const ALG = "ES256";
const KEY_ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN_ALGORITHM = { name: "ECDSA", hash: "SHA-256" } as const;

/**
 * One hour.
 *
 * Long enough for a working session without re-authenticating; short
 * enough that expiry is a meaningful bound on a leaked token, because
 * **there is no revocation**. A token is valid until it expires, and
 * nothing can call it back — which is a reasonable trade at an hour and
 * would not be at a day.
 */
export const SESSION_TTL_SECONDS = 3600;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  const normalized = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function isValidClaimsShape(value: unknown): value is SessionClaims {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.email === "string" &&
    c.email !== "" &&
    typeof c.name === "string" &&
    typeof c.environmentId === "string" &&
    c.environmentId !== "" &&
    typeof c.issuedAt === "string" &&
    typeof c.expiresAt === "string"
  );
}

export async function signSessionToken(
  claims: SessionClaims,
  privateKeyJwk: JsonWebKey
): Promise<string> {
  const header = { alg: ALG, typ: "JWT" };
  const encHeader = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const encPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(claims)));
  const signingInput = `${encHeader}.${encPayload}`;

  const key = await crypto.subtle.importKey("jwk", privateKeyJwk, KEY_ALGORITHM, false, ["sign"]);
  const signature = await crypto.subtle.sign(
    SIGN_ALGORITHM,
    key,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/**
 * Verify a session token **for a named environment**.
 *
 * `expectedEnvironmentId` is required rather than optional, so a caller
 * cannot accidentally verify a token without checking who it was for.
 * An optional audience check is one that eventually goes unpassed.
 *
 * Every failure returns a result rather than throwing: an expired or
 * forged token is an ordinary outcome a caller must handle, not an
 * exceptional one — the same position `verifyLicenceToken` takes.
 */
export async function verifySessionToken(
  token: string,
  publicKeyJwk: JsonWebKey,
  expectedEnvironmentId: string,
  now: Date = new Date()
): Promise<SessionVerifyResult> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, reason: "malformed token: expected 3 dot-separated parts" };
  }
  const [encHeader, encPayload, encSignature] = parts;

  let header: unknown;
  let claims: unknown;
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlDecode(encHeader)));
    claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(encPayload)));
  } catch {
    return { ok: false, reason: "malformed token: header or payload is not valid base64url JSON" };
  }

  const headerAlg = (header as Record<string, unknown> | null)?.alg;
  if (headerAlg !== ALG) {
    return { ok: false, reason: `unsupported algorithm in token header: ${String(headerAlg)}` };
  }

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = base64UrlDecode(encSignature);
  } catch {
    return { ok: false, reason: "malformed token: signature is not valid base64url" };
  }

  // Signature before anything else it asserts. Reporting "wrong
  // environment" or "expired" for a token that was never validly signed
  // would tell an attacker their forgery was structurally right and
  // only mis-addressed — the same ordering decision 0073 makes.
  const key = await crypto.subtle.importKey("jwk", publicKeyJwk, KEY_ALGORITHM, false, ["verify"]);
  const valid = await crypto.subtle.verify(
    SIGN_ALGORITHM,
    key,
    signatureBytes as Uint8Array<ArrayBuffer>,
    new TextEncoder().encode(`${encHeader}.${encPayload}`)
  );
  if (!valid) return { ok: false, reason: "signature does not verify" };

  if (!isValidClaimsShape(claims)) {
    return { ok: false, reason: "token payload is not a valid session claims object" };
  }

  // The audience check. One signing key serves the whole fleet, so a
  // correctly-signed token for another customer's environment is
  // otherwise indistinguishable from a legitimate one.
  if (claims.environmentId !== expectedEnvironmentId) {
    return {
      ok: false,
      reason: `token is for environment ${claims.environmentId}, not ${expectedEnvironmentId}`,
    };
  }

  if (new Date(claims.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, reason: `token expired at ${claims.expiresAt}` };
  }

  return { ok: true, claims };
}
