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

/**
 * **Signs any payload with the fleet key, under a named `typ`** — decision
 * 0713. Staff sessions are `JWT` (as they always were); a supplier
 * portal's tokens carry their own `typ`, so neither can be read as the
 * other. Exported for `portal-token.ts`; nothing else should need it.
 */
export async function signJws(payload: object, typ: string, privateKeyJwk: JsonWebKey): Promise<string> {
  const header = { alg: ALG, typ };
  const encHeader = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const encPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
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
 * **Opens a token: shape, algorithm, then signature** — and only then its
 * header's `typ` and payload, for the caller to judge. The signature is
 * checked before anything the token asserts is reported (decision 0073).
 */
export async function openJws(
  token: string,
  publicKeyJwk: JsonWebKey
): Promise<{ ok: true; typ: unknown; claims: unknown } | { ok: false; reason: string }> {
  const parts = typeof token === "string" ? token.split(".") : [];
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

  const key = await crypto.subtle.importKey("jwk", publicKeyJwk, KEY_ALGORITHM, false, ["verify"]);
  const valid = await crypto.subtle.verify(
    SIGN_ALGORITHM,
    key,
    signatureBytes as Uint8Array<ArrayBuffer>,
    new TextEncoder().encode(`${encHeader}.${encPayload}`)
  );
  if (!valid) return { ok: false, reason: "signature does not verify" };
  return { ok: true, typ: (header as Record<string, unknown>).typ, claims };
}

export async function signSessionToken(
  claims: SessionClaims,
  privateKeyJwk: JsonWebKey
): Promise<string> {
  return signJws(claims, "JWT", privateKeyJwk);
}

export async function verifySessionToken(
  token: string,
  publicKeyJwk: JsonWebKey,
  expectedEnvironmentId: string,
  now: Date = new Date()
): Promise<SessionVerifyResult> {
  // Signature before anything else it asserts. Reporting "wrong
  // environment" or "expired" for a token that was never validly signed
  // would tell an attacker their forgery was structurally right and
  // only mis-addressed — the same ordering decision 0073 makes.
  const opened = await openJws(token, publicKeyJwk);
  if (!opened.ok) return opened;
  const claims = opened.claims;

  /**
   * **A staff session, and nothing else signed with the same key** —
   * decision 0713. A supplier portal token is signed by the same fleet
   * key; it has its own `typ` and a `kind`, and is refused here, so a
   * supplier can never be taken for somebody who works at the customer.
   */
  if (opened.typ !== "JWT" || (typeof claims === "object" && claims !== null && "kind" in claims)) {
    return { ok: false, reason: "not a staff session token" };
  }

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
