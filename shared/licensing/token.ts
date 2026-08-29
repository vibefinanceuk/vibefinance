import type { LicenceClaims, VerifyResult } from "./types.js";

/**
 * A JWT-shaped token (header.payload.signature, base64url, ES256) — not
 * a bespoke format. Standard shape, standard algorithm (ECDSA P-256 +
 * SHA-256), confirmed against Cloudflare's own Web Crypto docs example
 * before use, and round-trip tested with a throwaway key in this
 * sandbox before writing the real implementation. Using JWT's shape
 * rather than inventing one buys nothing operationally today, but
 * costs nothing either and means any future tooling (debuggers,
 * inspectors) that understands JWTs understands this for free.
 */
const ALG = "ES256";
const KEY_ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN_ALGORITHM = { name: "ECDSA", hash: "SHA-256" } as const;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  const normalized = str.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLength);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importSigningKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, KEY_ALGORITHM, false, ["sign"]);
}

async function importVerifyingKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, KEY_ALGORITHM, false, ["verify"]);
}

function isValidClaimsShape(value: unknown): value is LicenceClaims {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.customerId === "string" &&
    typeof c.plan === "string" &&
    Array.isArray(c.features) &&
    c.features.every((f) => typeof f === "string") &&
    typeof c.volumeEntitlement === "number" &&
    (c.status === "active" || c.status === "warned" || c.status === "blocked") &&
    typeof c.issuedAt === "string" &&
    typeof c.expiresAt === "string"
  );
}

export async function signLicenceToken(
  claims: LicenceClaims,
  privateKeyJwk: JsonWebKey
): Promise<string> {
  const header = { alg: ALG, typ: "JWT" };
  const encHeader = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const encPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(claims)));
  const signingInput = `${encHeader}.${encPayload}`;

  const key = await importSigningKey(privateKeyJwk);
  const signature = await crypto.subtle.sign(
    SIGN_ALGORITHM,
    key,
    new TextEncoder().encode(signingInput)
  );

  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/**
 * Verify a licence token. Every failure path returns a VerifyResult
 * rather than throwing — a malformed, forged, or expired token is an
 * ordinary outcome the caller must handle (typically: fall back to the
 * last known-good cached state, per the fail-open contract in
 * licence-cache.ts), not an exceptional one.
 */
export async function verifyLicenceToken(
  token: string,
  publicKeyJwk: JsonWebKey,
  now: Date = new Date()
): Promise<VerifyResult> {
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

  const key = await importVerifyingKey(publicKeyJwk);
  const signingInput = new TextEncoder().encode(`${encHeader}.${encPayload}`);
  const validSignature = await crypto.subtle.verify(
    SIGN_ALGORITHM,
    key,
    // TypeScript's lib.dom types distinguish Uint8Array<ArrayBuffer>
    // from the wider Uint8Array<ArrayBufferLike> that a plain
    // `new Uint8Array(n)` return type infers as, and BufferSource only
    // accepts the former. This is a type-checker strictness quirk, not
    // a runtime concern — a Uint8Array is a valid BufferSource
    // regardless of this generic distinction, confirmed by every test
    // in this file actually passing crypto.subtle.verify() real bytes
    // successfully. `vitest` (esbuild-transpiled, no type checking)
    // never caught this; `npx tsc --noEmit` did.
    signatureBytes as BufferSource,
    signingInput
  );
  if (!validSignature) {
    return { ok: false, reason: "signature verification failed" };
  }

  if (!isValidClaimsShape(claims)) {
    return { ok: false, reason: "token payload does not match the expected claims shape" };
  }

  if (new Date(claims.expiresAt).getTime() < now.getTime()) {
    return { ok: false, reason: `token expired at ${claims.expiresAt}` };
  }

  return { ok: true, claims };
}
