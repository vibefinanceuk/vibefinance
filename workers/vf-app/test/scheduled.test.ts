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
      LICENCE_SIGNING_PUBLIC_KEY: publicKeyJwk, // a real object now, not a JSON string
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

  it("does nothing when LICENCE_SIGNING_PUBLIC_KEY is still the unfilled wrangler.jsonc placeholder", async () => {
    // The exact shape wrangler.jsonc ships with before an operator
    // fills in a real key — { "REPLACE_WITH_REAL_PUBLIC_KEY_JWK": true
    // }, a genuine object, just not a valid JWK. Confirms a
    // newly-cloned, not-yet-configured instance fails safe rather than
    // throwing on deploy or on its first scheduled run.
    //
    // Mocked (not just spied) this time: usage push is now a genuinely
    // independent block (see the "independence" describe further down)
    // and legitimately calls fetch even when the licence key is
    // broken. An unmocked spy here would let that real fetch through
    // to an actual DNS lookup against a fake domain, the same failure
    // mode already caught once before in this file.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const env: Env = {
      ...testEnv,
      LICENCE_SIGNING_PUBLIC_KEY: { REPLACE_WITH_REAL_PUBLIC_KEY_JWK: true },
      LICENCE_SERVER_URL: "https://vf-licence.example.workers.dev",
      CUSTOMER_ID: "acme",
    };
    await expect(
      worker.scheduled?.({} as ScheduledEvent, env, {} as ExecutionContext)
    ).resolves.not.toThrow();

    // The assertion that actually matters: the licence-token URL
    // specifically was never called, rejected by the type guard before
    // any network attempt — not "fetch was never called at all", which
    // no longer holds now that usage push is an independent block that
    // legitimately does call fetch regardless of the licence key.
    const licenceCall = fetchSpy.mock.calls.find(([url]) => String(url).includes("/licences/"));
    expect(licenceCall).toBeUndefined();
    const state = await readLicenceState(testEnv.DB);
    expect(state).toEqual({ known: false });
    fetchSpy.mockRestore();
  });

  it("does not cache anything when the fetch returns a non-2xx status", async () => {
    const keyPair = await crypto.subtle.generateKey(KEY_ALGORITHM, true, ["sign", "verify"]);
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("unauthorized", { status: 401 }));

    const env: Env = {
      ...testEnv,
      LICENCE_SIGNING_PUBLIC_KEY: publicKeyJwk, // a real object now, not a JSON string
      LICENCE_SERVER_URL: "https://vf-licence.example.workers.dev",
      CUSTOMER_ID: "acme",
    };

    await worker.scheduled?.({} as ScheduledEvent, env, {} as ExecutionContext);
    const state = await readLicenceState(testEnv.DB);
    expect(state).toEqual({ known: false });

    fetchSpy.mockRestore();
  });
});

describe("scheduled() — the usage push, same cron", () => {
  it("pushes a real usage report to LICENCE_SERVER_URL/usage", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const env: Env = {
      ...testEnv,
      LICENCE_SERVER_URL: "https://vf-licence.example.workers.dev",
      CUSTOMER_ID: "acme",
    };

    await worker.scheduled?.({} as ScheduledEvent, env, {} as ExecutionContext);

    const usageCall = fetchSpy.mock.calls.find(([url]) => String(url).endsWith("/usage"));
    expect(usageCall).toBeDefined();
    const [, init] = usageCall as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ customerId: "acme", invoicesProcessed: 0 });

    fetchSpy.mockRestore();
  });

  it("still runs when LICENCE_SIGNING_PUBLIC_KEY is missing — usage push needs none of the licence-verification config", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const env: Env = {
      ...testEnv,
      // Deliberately no LICENCE_SIGNING_PUBLIC_KEY at all.
      LICENCE_SERVER_URL: "https://vf-licence.example.workers.dev",
      CUSTOMER_ID: "acme",
    };

    await worker.scheduled?.({} as ScheduledEvent, env, {} as ExecutionContext);

    const usageCall = fetchSpy.mock.calls.find(([url]) => String(url).endsWith("/usage"));
    expect(usageCall).toBeDefined();

    fetchSpy.mockRestore();
  });

  it("a failing usage push does not prevent the licence refresh from succeeding", async () => {
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

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).endsWith("/usage")) {
        throw new Error("usage endpoint unreachable");
      }
      return new Response(JSON.stringify({ token }), { status: 200 });
    });

    const env: Env = {
      ...testEnv,
      LICENCE_SIGNING_PUBLIC_KEY: publicKeyJwk,
      LICENCE_SERVER_URL: "https://vf-licence.example.workers.dev",
      CUSTOMER_ID: "acme",
    };

    await expect(
      worker.scheduled?.({} as ScheduledEvent, env, {} as ExecutionContext)
    ).resolves.not.toThrow();

    // The licence refresh, an entirely separate concern, must still
    // have succeeded despite the usage push failing.
    const state = await readLicenceState(testEnv.DB);
    expect(state).toEqual({ known: true, claims });

    fetchSpy.mockRestore();
  });
});
