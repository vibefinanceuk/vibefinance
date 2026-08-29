import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { signLicenceToken } from "@vibefinance/shared";
import type { LicenceClaims } from "@vibefinance/shared";
import { applyTestSchema } from "./setup.js";
import { isBlocked, readLicenceState, refreshLicenceCache } from "../src/licence-cache.js";

const KEY_ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;
let privateKeyJwk: JsonWebKey;
let publicKeyJwk: JsonWebKey;
let otherPublicKeyJwk: JsonWebKey;

function baseClaims(overrides: Partial<LicenceClaims> = {}): LicenceClaims {
  return {
    customerId: "acme",
    plan: "standard",
    features: [],
    volumeEntitlement: 1000,
    status: "active",
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
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

beforeEach(async () => {
  await applyTestSchema();
});

describe("readLicenceState — before any successful fetch", () => {
  it("reports unknown when nothing has ever been cached", async () => {
    const state = await readLicenceState(env.DB);
    expect(state).toEqual({ known: false });
  });

  it("isBlocked treats unknown state as blocked — the bootstrap default", async () => {
    const state = await readLicenceState(env.DB);
    expect(isBlocked(state)).toBe(true);
  });
});

describe("refreshLicenceCache — the happy path", () => {
  it("caches a valid, correctly-signed token", async () => {
    const claims = baseClaims();
    const token = await signLicenceToken(claims, privateKeyJwk);
    const fetcher = vi.fn().mockResolvedValue(token);

    const result = await refreshLicenceCache(env.DB, publicKeyJwk, fetcher);
    expect(result.refreshed).toBe(true);

    const state = await readLicenceState(env.DB);
    expect(state).toEqual({ known: true, claims });
  });

  it("isBlocked is false for a cached 'active' status", async () => {
    const token = await signLicenceToken(baseClaims({ status: "active" }), privateKeyJwk);
    await refreshLicenceCache(env.DB, publicKeyJwk, vi.fn().mockResolvedValue(token));
    const state = await readLicenceState(env.DB);
    expect(isBlocked(state)).toBe(false);
  });

  it("isBlocked is true for a cached 'blocked' status", async () => {
    const token = await signLicenceToken(baseClaims({ status: "blocked" }), privateKeyJwk);
    await refreshLicenceCache(env.DB, publicKeyJwk, vi.fn().mockResolvedValue(token));
    const state = await readLicenceState(env.DB);
    expect(isBlocked(state)).toBe(true);
  });

  it("isBlocked is false for a cached 'warned' status — only 'blocked' restricts", async () => {
    const token = await signLicenceToken(baseClaims({ status: "warned" }), privateKeyJwk);
    await refreshLicenceCache(env.DB, publicKeyJwk, vi.fn().mockResolvedValue(token));
    const state = await readLicenceState(env.DB);
    expect(isBlocked(state)).toBe(false);
  });
});

describe("refreshLicenceCache — the fail-open contract", () => {
  it("a fetch failure leaves prior cached state untouched", async () => {
    const originalClaims = baseClaims({ status: "active" });
    const goodToken = await signLicenceToken(originalClaims, privateKeyJwk);
    await refreshLicenceCache(env.DB, publicKeyJwk, vi.fn().mockResolvedValue(goodToken));

    const failingFetcher = vi.fn().mockRejectedValue(new Error("network error"));
    const result = await refreshLicenceCache(env.DB, publicKeyJwk, failingFetcher);
    expect(result.refreshed).toBe(false);

    // The critical assertion: still the OLD state, not blocked, not
    // cleared. "Your own outage must not become the customer's outage."
    // Compares against the exact claims object that was signed, not a
    // freshly-constructed one — baseClaims() stamps issuedAt/expiresAt
    // from Date.now() internally, so two calls a millisecond apart
    // produce different values and would make this assertion flaky for
    // reasons that have nothing to do with the code under test.
    const state = await readLicenceState(env.DB);
    expect(state).toEqual({ known: true, claims: originalClaims });
    expect(isBlocked(state)).toBe(false);
  });

  it("a token that fails signature verification does not overwrite prior state", async () => {
    const originalClaims = baseClaims({ status: "active" });
    const goodToken = await signLicenceToken(originalClaims, privateKeyJwk);
    await refreshLicenceCache(env.DB, publicKeyJwk, vi.fn().mockResolvedValue(goodToken));

    // Signed with the WRONG key — simulates a forged or corrupted response.
    const forgedToken = await signLicenceToken(baseClaims({ status: "active" }), privateKeyJwk);
    const result = await refreshLicenceCache(
      env.DB,
      otherPublicKeyJwk, // verifying against the wrong public key on purpose
      vi.fn().mockResolvedValue(forgedToken)
    );
    expect(result.refreshed).toBe(false);

    const state = await readLicenceState(env.DB);
    expect(state).toEqual({ known: true, claims: originalClaims });
  });

  it("an expired token does not overwrite prior state", async () => {
    const originalClaims = baseClaims({ status: "active" });
    const goodToken = await signLicenceToken(originalClaims, privateKeyJwk);
    await refreshLicenceCache(env.DB, publicKeyJwk, vi.fn().mockResolvedValue(goodToken));

    const expiredClaims = baseClaims({
      status: "active",
      issuedAt: new Date("2020-01-01").toISOString(),
      expiresAt: new Date("2020-01-02").toISOString(),
    });
    const expiredToken = await signLicenceToken(expiredClaims, privateKeyJwk);
    const result = await refreshLicenceCache(env.DB, publicKeyJwk, vi.fn().mockResolvedValue(expiredToken));
    expect(result.refreshed).toBe(false);

    const state = await readLicenceState(env.DB);
    expect(state).toEqual({ known: true, claims: originalClaims });
  });

  it("silence never unlocks: a fetch failure with NO prior state stays unknown, not active", async () => {
    // The other half of the fail-open contract: absence of a reachable
    // server must not silently unlock anything either. A brand-new
    // instance whose very first fetch fails stays blocked, exactly as
    // if it had never tried.
    const failingFetcher = vi.fn().mockRejectedValue(new Error("network error"));
    const result = await refreshLicenceCache(env.DB, publicKeyJwk, failingFetcher);
    expect(result.refreshed).toBe(false);

    const state = await readLicenceState(env.DB);
    expect(state).toEqual({ known: false });
    expect(isBlocked(state)).toBe(true);
  });

  it("a genuine upgrade (blocked to active) DOES take effect on a successful refresh", async () => {
    // Confirms the fail-open contract isn't accidentally "never update
    // anything" — a real, verified, newer state must still replace the
    // old one. Only failures are ignored, not legitimate changes.
    const blockedToken = await signLicenceToken(baseClaims({ status: "blocked" }), privateKeyJwk);
    await refreshLicenceCache(env.DB, publicKeyJwk, vi.fn().mockResolvedValue(blockedToken));
    expect(isBlocked(await readLicenceState(env.DB))).toBe(true);

    const activeToken = await signLicenceToken(baseClaims({ status: "active" }), privateKeyJwk);
    const result = await refreshLicenceCache(env.DB, publicKeyJwk, vi.fn().mockResolvedValue(activeToken));
    expect(result.refreshed).toBe(true);
    expect(isBlocked(await readLicenceState(env.DB))).toBe(false);
  });
});
