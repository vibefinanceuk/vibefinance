import { beforeAll, describe, expect, it } from "vitest";
import { signLicenceToken, verifyLicenceToken } from "./token.js";
import type { LicenceClaims } from "./types.js";

const KEY_ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;

let privateKeyJwk: JsonWebKey;
let publicKeyJwk: JsonWebKey;
let otherPublicKeyJwk: JsonWebKey;

function baseClaims(overrides: Partial<LicenceClaims> = {}): LicenceClaims {
  return {
    customerId: "acme",
    plan: "standard",
    features: ["rules_ai_compiler"],
    volumeEntitlement: 10000,
    status: "active",
    issuedAt: new Date("2026-08-01T00:00:00Z").toISOString(),
    expiresAt: new Date("2026-09-01T00:00:00Z").toISOString(),
    ...overrides,
  };
}

beforeAll(async () => {
  const keyPair = await crypto.subtle.generateKey(KEY_ALGORITHM, true, ["sign", "verify"]);
  privateKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

  const otherKeyPair = await crypto.subtle.generateKey(KEY_ALGORITHM, true, ["sign", "verify"]);
  otherPublicKeyJwk = await crypto.subtle.exportKey("jwk", otherKeyPair.publicKey);
});

describe("signLicenceToken / verifyLicenceToken — real Web Crypto round trip", () => {
  it("verifies a token signed with the matching private key", async () => {
    const claims = baseClaims();
    const token = signLicenceToken(claims, privateKeyJwk);
    const result = await verifyLicenceToken(await token, publicKeyJwk);
    expect(result.ok).toBe(true);
    expect(result.claims).toEqual(claims);
  });

  it("produces a three-part, dot-separated, base64url token", async () => {
    const token = await signLicenceToken(baseClaims(), privateKeyJwk);
    const parts = token.split(".");
    expect(parts).toHaveLength(3);
    for (const part of parts) {
      expect(part).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

describe("verifyLicenceToken — forgery and tampering", () => {
  it("rejects a token signed with a different key entirely", async () => {
    const token = await signLicenceToken(baseClaims(), privateKeyJwk);
    const result = await verifyLicenceToken(token, otherPublicKeyJwk);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("signature verification failed");
  });

  it("rejects a token whose payload was tampered with after signing", async () => {
    const token = await signLicenceToken(baseClaims({ status: "blocked" }), privateKeyJwk);
    const [header, , signature] = token.split(".");
    // Forge a more favourable payload without re-signing — this is
    // exactly the attack the signature exists to prevent.
    const forgedClaims = baseClaims({ status: "active" });
    const forgedPayload = btoa(JSON.stringify(forgedClaims))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const forgedToken = `${header}.${forgedPayload}.${signature}`;

    const result = await verifyLicenceToken(forgedToken, publicKeyJwk);
    expect(result.ok).toBe(false);
  });

  it("rejects a malformed token that isn't three parts", async () => {
    const result = await verifyLicenceToken("not.a.valid.token.at.all", publicKeyJwk);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("3 dot-separated parts");
  });

  it("rejects a token with an unsupported algorithm in the header", async () => {
    const forgedHeader = btoa(JSON.stringify({ alg: "none", typ: "JWT" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const claimsB64 = btoa(JSON.stringify(baseClaims()))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const result = await verifyLicenceToken(`${forgedHeader}.${claimsB64}.fakesig`, publicKeyJwk);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("unsupported algorithm");
  });
});

describe("verifyLicenceToken — expiry", () => {
  it("rejects a token whose expiresAt is in the past relative to the check time", async () => {
    const claims = baseClaims({
      issuedAt: new Date("2026-01-01T00:00:00Z").toISOString(),
      expiresAt: new Date("2026-01-08T00:00:00Z").toISOString(),
    });
    const token = await signLicenceToken(claims, privateKeyJwk);
    const result = await verifyLicenceToken(token, publicKeyJwk, new Date("2026-06-01T00:00:00Z"));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("expired");
  });

  it("accepts a token checked before its expiry", async () => {
    const claims = baseClaims({
      issuedAt: new Date("2026-01-01T00:00:00Z").toISOString(),
      expiresAt: new Date("2026-01-08T00:00:00Z").toISOString(),
    });
    const token = await signLicenceToken(claims, privateKeyJwk);
    const result = await verifyLicenceToken(token, publicKeyJwk, new Date("2026-01-05T00:00:00Z"));
    expect(result.ok).toBe(true);
  });
});

describe("verifyLicenceToken — the staged block statuses", () => {
  it("verifies a 'blocked' token as ok — verification is not the same as enforcement", async () => {
    // Blocking is a caller decision (licence-cache.ts / route handlers),
    // not something verifyLicenceToken decides. A blocked token is a
    // perfectly valid, correctly-signed token whose claims say blocked.
    const claims = baseClaims({ status: "blocked", statusReason: "non-payment" });
    const token = await signLicenceToken(claims, privateKeyJwk);
    const result = await verifyLicenceToken(token, publicKeyJwk);
    expect(result.ok).toBe(true);
    expect(result.claims?.status).toBe("blocked");
  });

  it("rejects a claims payload with a status outside the closed set", async () => {
    // Constructed directly (bypassing the type system) to simulate a
    // forged or malformed payload with an invented status value.
    const claims = { ...baseClaims(), status: "super_active" };
    const header = { alg: "ES256", typ: "JWT" };
    const enc = (obj: unknown) =>
      btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const signingInput = `${enc(header)}.${enc(claims)}`;
    const key = await crypto.subtle.importKey("jwk", privateKeyJwk, KEY_ALGORITHM, false, ["sign"]);
    const sig = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new TextEncoder().encode(signingInput)
    );
    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const token = `${signingInput}.${sigB64}`;

    const result = await verifyLicenceToken(token, publicKeyJwk);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("claims shape");
  });
});
