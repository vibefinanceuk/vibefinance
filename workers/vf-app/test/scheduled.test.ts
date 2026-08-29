import { env as testEnv } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signLicenceToken } from "@vibefinance/shared";
import worker from "../src/index.js";
import type { Env } from "../src/index.js";
import { readLicenceState } from "../src/licence-cache.js";
import { applyTestSchema } from "./setup.js";

const KEY_ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;

beforeEach(async () => {
  await applyTestSchema();
});

describe("scheduled() — the licence refresh trigger", () => {
  it("fetches from LICENCE_SERVER_URL, verifies, and caches the result", async () => {
    const keyPair = await crypto.subtle.generateKey(KEY_ALGORITHM, true, ["sign", "verify"]);
    const privateKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

    const claims = {
      customerId: "acme",
      plan: "standard",
      features: [],
      volumeEntitlement: 1000,
      status: "active" as const,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
    const token = await signLicenceToken(claims, privateKeyJwk);

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ token }), { status: 200 }));

    const env: Env = {
      ...testEnv,
      LICENCE_SIGNING_PUBLIC_KEY: JSON.stringify(publicKeyJwk),
      LICENCE_SERVER_URL: "https://vf-licence.example.workers.dev",
      CUSTOMER_ID: "acme",
    };

    await worker.scheduled?.({} as ScheduledEvent, env, {} as ExecutionContext);

    expect(fetchSpy).toHaveBeenCalledWith("https://vf-licence.example.workers.dev/licences/acme/token");
    const state = await readLicenceState(testEnv.DB);
    expect(state).toEqual({ known: true, claims });

    fetchSpy.mockRestore();
  });

  it("does nothing and does not throw when required env vars are missing", async () => {
    const env: Env = { ...testEnv, LICENCE_SIGNING_PUBLIC_KEY: undefined };
    await expect(
      worker.scheduled?.({} as ScheduledEvent, env, {} as ExecutionContext)
    ).resolves.not.toThrow();
    const state = await readLicenceState(testEnv.DB);
    expect(state).toEqual({ known: false });
  });

  it("does not cache anything when the fetch returns a non-2xx status", async () => {
    const keyPair = await crypto.subtle.generateKey(KEY_ALGORITHM, true, ["sign", "verify"]);
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("unauthorized", { status: 401 }));

    const env: Env = {
      ...testEnv,
      LICENCE_SIGNING_PUBLIC_KEY: JSON.stringify(publicKeyJwk),
      LICENCE_SERVER_URL: "https://vf-licence.example.workers.dev",
      CUSTOMER_ID: "acme",
    };

    await worker.scheduled?.({} as ScheduledEvent, env, {} as ExecutionContext);
    const state = await readLicenceState(testEnv.DB);
    expect(state).toEqual({ known: false });

    fetchSpy.mockRestore();
  });
});
