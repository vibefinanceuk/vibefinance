import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { signLicenceToken } from "@vibefinance/shared";
import type { LicenceClaims } from "@vibefinance/shared";
import { applyTestSchema } from "./setup.js";
import { handleLicenceRefresh } from "../src/licence-refresh-route.js";
import { readLicenceState } from "../src/licence-cache.js";

const KEY_ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;
let privateKeyJwk: JsonWebKey;
let publicKeyJwk: JsonWebKey;

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
});

beforeEach(async () => {
  await applyTestSchema();
});

describe("handleLicenceRefresh — the bootstrap-unblocking case this exists for", () => {
  it("succeeds and returns the resulting state when there was no prior cache at all", async () => {
    const claims = baseClaims();
    const token = await signLicenceToken(claims, privateKeyJwk);
    const fetcher = vi.fn().mockResolvedValue(token);

    const result = await handleLicenceRefresh(env.DB, publicKeyJwk, fetcher);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      status: "refreshed",
      currentState: { known: true, status: "active", plan: "standard" },
    });

    const state = await readLicenceState(env.DB);
    expect(state).toEqual({ known: true, claims });
  });

  it("502s with a clear reason when the fetch itself fails, state stays unknown", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("network error"));
    const result = await handleLicenceRefresh(env.DB, publicKeyJwk, fetcher);

    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({
      status: "not_refreshed",
      currentState: { known: false },
    });
    expect((result.body as { reason: string }).reason).toContain("network error");
  });

  it("502s when the token fails verification, without adopting it", async () => {
    const claims = baseClaims();
    const token = await signLicenceToken(claims, privateKeyJwk);
    // A different keypair — simulates a forged or mismatched response,
    // same as licence-cache.test.ts's own coverage of this case.
    const otherKeyPair = await crypto.subtle.generateKey(KEY_ALGORITHM, true, ["sign", "verify"]);
    const otherPublicKeyJwk = await crypto.subtle.exportKey("jwk", otherKeyPair.publicKey);
    const fetcher = vi.fn().mockResolvedValue(token);

    const result = await handleLicenceRefresh(env.DB, otherPublicKeyJwk, fetcher);
    expect(result.status).toBe(502);

    const state = await readLicenceState(env.DB);
    expect(state).toEqual({ known: false });
  });
});

describe("handleLicenceRefresh — refreshing an already-cached state", () => {
  it("reports the updated state after a successful refresh replaces a prior one", async () => {
    const oldToken = await signLicenceToken(baseClaims({ status: "blocked" }), privateKeyJwk);
    await handleLicenceRefresh(env.DB, publicKeyJwk, vi.fn().mockResolvedValue(oldToken));

    const newToken = await signLicenceToken(baseClaims({ status: "active" }), privateKeyJwk);
    const result = await handleLicenceRefresh(env.DB, publicKeyJwk, vi.fn().mockResolvedValue(newToken));

    expect(result.status).toBe(200);
    expect((result.body as { currentState: { status: string } }).currentState.status).toBe("active");
  });

  it("a failed refresh reports the prior state, not a cleared one — fail-open, not fail-blank", async () => {
    const goodToken = await signLicenceToken(baseClaims({ status: "active" }), privateKeyJwk);
    await handleLicenceRefresh(env.DB, publicKeyJwk, vi.fn().mockResolvedValue(goodToken));

    const failingFetcher = vi.fn().mockRejectedValue(new Error("temporary outage"));
    const result = await handleLicenceRefresh(env.DB, publicKeyJwk, failingFetcher);

    expect(result.status).toBe(502);
    // The critical assertion: currentState still reflects the OLD,
    // still-valid cached licence — a failed on-demand refresh must
    // never look like a loss of entitlement.
    expect(result.body).toMatchObject({ currentState: { known: true, status: "active" } });
  });
});
