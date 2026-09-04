import { describe, expect, it, beforeAll } from "vitest";
import { signSessionToken, verifySessionToken, SESSION_TTL_SECONDS } from "./token.js";
import type { SessionClaims } from "./types.js";

/**
 * Real keys, real Web Crypto, no test double — the same finding decision
 * 0011 recorded for licence tokens: SubtleCrypto behaves identically in
 * workerd and production, so nothing about signing needed faking.
 */
let privateKey: JsonWebKey;
let publicKey: JsonWebKey;
let otherPrivateKey: JsonWebKey;

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  privateKey = await crypto.subtle.exportKey("jwk", pair.privateKey);
  publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey);

  const other = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  otherPrivateKey = await crypto.subtle.exportKey("jwk", other.privateKey);
});

const NOW = new Date("2026-09-04T12:00:00.000Z");

function claims(overrides: Partial<SessionClaims> = {}): SessionClaims {
  return {
    email: "dan@acme.com",
    name: "Dan Y.",
    environmentId: "Acme-production-eu",
    issuedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + SESSION_TTL_SECONDS * 1000).toISOString(),
    ...overrides,
  };
}

describe("signing and verifying a session token", () => {
  it("round-trips, yielding the person and their environment", async () => {
    const token = await signSessionToken(claims(), privateKey);
    const result = await verifySessionToken(token, publicKey, "Acme-production-eu", NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims.email).toBe("dan@acme.com");
      expect(result.claims.environmentId).toBe("Acme-production-eu");
    }
  });

  it("lives an hour — long enough to work, short enough that expiry bounds a leak", async () => {
    // There is no revocation. A token is valid until it expires and
    // nothing can call it back, which is a reasonable trade at an hour
    // and would not be at a day.
    expect(SESSION_TTL_SECONDS).toBe(3600);
  });

  it("rejects a token past its expiry", async () => {
    const token = await signSessionToken(claims(), privateKey);
    const later = new Date(NOW.getTime() + (SESSION_TTL_SECONDS + 1) * 1000);
    const result = await verifySessionToken(token, publicKey, "Acme-production-eu", later);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("expired");
  });

  it("accepts one a second before it expires", async () => {
    const token = await signSessionToken(claims(), privateKey);
    const almost = new Date(NOW.getTime() + (SESSION_TTL_SECONDS - 1) * 1000);
    expect((await verifySessionToken(token, publicKey, "Acme-production-eu", almost)).ok).toBe(true);
  });
});

describe("the audience check — one signing key serves the whole fleet", () => {
  it("refuses a correctly-signed token addressed to another environment", async () => {
    // The property this claim exists for. vf-licence holds ONE signing
    // key and every instance verifies with the same public half, so
    // without this a session for one customer would open another's
    // data with a perfectly good signature.
    const token = await signSessionToken(claims({ environmentId: "Northwind-production-eu" }), privateKey);
    const result = await verifySessionToken(token, publicKey, "Acme-production-eu", NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("Northwind-production-eu");
  });

  it("refuses a token for the same customer's other region", async () => {
    // Regions are separate instances holding separate data. EU is not
    // US even for one customer (decision 0084).
    const token = await signSessionToken(claims({ environmentId: "Acme-production-us" }), privateKey);
    expect((await verifySessionToken(token, publicKey, "Acme-production-eu", NOW)).ok).toBe(false);
  });

  it("refuses a token whose environment was swapped after signing", async () => {
    const token = await signSessionToken(claims(), privateKey);
    const [header, , signature] = token.split(".");
    const forgedPayload = btoa(JSON.stringify(claims({ environmentId: "Northwind-production-eu" })))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const forged = `${header}.${forgedPayload}.${signature}`;

    const result = await verifySessionToken(forged, publicKey, "Northwind-production-eu", NOW);
    expect(result.ok).toBe(false);
    // The SIGNATURE catches it, not the audience check — reported as
    // such, so a forger is not told their tampering was structurally
    // sound and merely mis-addressed.
    if (!result.ok) expect(result.reason).toContain("signature");
  });
});

describe("forgery and tampering", () => {
  it("rejects a token signed with a different key entirely", async () => {
    const token = await signSessionToken(claims(), otherPrivateKey);
    const result = await verifySessionToken(token, publicKey, "Acme-production-eu", NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("signature");
  });

  it("rejects a token whose expiry was extended after signing", async () => {
    const token = await signSessionToken(claims(), privateKey);
    const [header, , signature] = token.split(".");
    const extended = btoa(JSON.stringify(claims({ expiresAt: "2099-01-01T00:00:00.000Z" })))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect((await verifySessionToken(`${header}.${extended}.${signature}`, publicKey, "Acme-production-eu", NOW)).ok).toBe(false);
  });

  it("rejects a token claiming an unsupported algorithm", async () => {
    const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" })).replace(/=+$/, "");
    const payload = btoa(JSON.stringify(claims())).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const result = await verifySessionToken(`${header}.${payload}.x`, publicKey, "Acme-production-eu", NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("algorithm");
  });

  it("rejects a payload that is valid JSON but not session claims", async () => {
    const notClaims = { hello: "world" } as unknown as SessionClaims;
    const token = await signSessionToken(notClaims, privateKey);
    const result = await verifySessionToken(token, publicKey, "Acme-production-eu", NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("valid session claims");
  });

  it("rejects an empty email — an anonymous session is not a session", async () => {
    const token = await signSessionToken(claims({ email: "" }), privateKey);
    expect((await verifySessionToken(token, publicKey, "Acme-production-eu", NOW)).ok).toBe(false);
  });

  it("rejects malformed input without throwing", async () => {
    for (const bad of ["", "nonsense", "a.b", "a.b.c.d"]) {
      const result = await verifySessionToken(bad, publicKey, "Acme-production-eu", NOW);
      expect(result.ok).toBe(false);
    }
  });
});
