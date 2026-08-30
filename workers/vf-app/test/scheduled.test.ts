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

/**
 * A fake Service Binding — production wires env.LICENCE_SERVICE via
 * wrangler.jsonc's `services` block (see its own comment on why: a
 * plain global fetch() to vf-licence's workers.dev URL from inside
 * vf-app silently 404s, confirmed live, since Cloudflare blocks
 * Worker-to-Worker fetches to workers.dev URLs as an anti-loop
 * measure). Declaring a real `services` binding in the test-only
 * wrangler config would need either a live remote connection or a
 * second auxiliary Worker running in the test pool — neither
 * available here — so tests inject this fake directly onto the env
 * object instead, exactly the same pattern already used for AI and
 * the licence public key.
 */
function fakeService(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): Fetcher {
  return { fetch: vi.fn(handler) } as unknown as Fetcher;
}

/** Pulls the first URL argument out of a mock's recorded calls, typed
 * as unknown[] rather than a destructured tuple — avoids fighting
 * TypeScript's Array.find() overloads over a narrower tuple type
 * that mock.calls doesn't actually have. */
function firstCallUrl(calls: unknown[][]): string | undefined {
  const found = calls.find((call) => typeof call[0] === "string");
  return found ? (found[0] as string) : undefined;
}

describe("scheduled() — the licence refresh trigger", () => {
  it("fetches the licence token via the service binding, verifies, and caches the result", async () => {
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

    const service = fakeService(async () => new Response(JSON.stringify({ token }), { status: 200 }));

    const env: Env = {
      ...testEnv,
      LICENCE_SIGNING_PUBLIC_KEY: publicKeyJwk,
      LICENCE_SERVICE: service,
      CUSTOMER_ID: "acme",
    };

    await worker.scheduled?.({} as ScheduledEvent, env, {} as ExecutionContext);

    expect(service.fetch).toHaveBeenCalledWith("https://vf-licence.internal/licences/acme/token");
    const state = await readLicenceState(testEnv.DB);
    expect(state).toEqual({ known: true, claims });
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
    const service = fakeService(async () => new Response("{}", { status: 200 }));
    const env: Env = {
      ...testEnv,
      LICENCE_SIGNING_PUBLIC_KEY: { REPLACE_WITH_REAL_PUBLIC_KEY_JWK: true },
      LICENCE_SERVICE: service,
      CUSTOMER_ID: "acme",
    };
    await expect(
      worker.scheduled?.({} as ScheduledEvent, env, {} as ExecutionContext)
    ).resolves.not.toThrow();

    // The assertion that actually matters: the licence-token URL
    // specifically was never called, rejected by the type guard before
    // any network attempt — not "the service was never called at
    // all", which doesn't hold now that usage push is an independent
    // block that legitimately calls the same service regardless of
    // the licence key.
    const calls = (service.fetch as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const licenceUrl = firstCallUrl(calls.filter((call) => (call[0] as string).includes("/licences/")));
    expect(licenceUrl).toBeUndefined();
    const state = await readLicenceState(testEnv.DB);
    expect(state).toEqual({ known: false });
  });

  it("does not cache anything when the service binding returns a non-2xx status", async () => {
    const keyPair = await crypto.subtle.generateKey(KEY_ALGORITHM, true, ["sign", "verify"]);
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

    const service = fakeService(async () => new Response("unauthorized", { status: 401 }));

    const env: Env = {
      ...testEnv,
      LICENCE_SIGNING_PUBLIC_KEY: publicKeyJwk,
      LICENCE_SERVICE: service,
      CUSTOMER_ID: "acme",
    };

    await worker.scheduled?.({} as ScheduledEvent, env, {} as ExecutionContext);
    const state = await readLicenceState(testEnv.DB);
    expect(state).toEqual({ known: false });
  });
});

describe("scheduled() — the usage push, same cron", () => {
  it("pushes a real usage report via the service binding", async () => {
    const service = fakeService(async () => new Response("{}", { status: 200 }));
    const env: Env = {
      ...testEnv,
      LICENCE_SERVICE: service,
      CUSTOMER_ID: "acme",
    };

    await worker.scheduled?.({} as ScheduledEvent, env, {} as ExecutionContext);

    const calls = (service.fetch as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const usageUrl = firstCallUrl(calls.filter((call) => (call[0] as string).endsWith("/usage")));
    expect(usageUrl).toBeDefined();
    const usageCall = calls.find((call) => (call[0] as string).endsWith("/usage"));
    const init = usageCall?.[1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ customerId: "acme", invoicesProcessed: 0 });
  });

  it("still runs when LICENCE_SIGNING_PUBLIC_KEY is missing — usage push needs none of the licence-verification config", async () => {
    const service = fakeService(async () => new Response("{}", { status: 200 }));
    const env: Env = {
      ...testEnv,
      // Deliberately no LICENCE_SIGNING_PUBLIC_KEY at all.
      LICENCE_SERVICE: service,
      CUSTOMER_ID: "acme",
    };

    await worker.scheduled?.({} as ScheduledEvent, env, {} as ExecutionContext);

    const calls = (service.fetch as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const usageUrl = firstCallUrl(calls.filter((call) => (call[0] as string).endsWith("/usage")));
    expect(usageUrl).toBeDefined();
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

    const service = fakeService(async (input) => {
      if (String(input).endsWith("/usage")) {
        throw new Error("usage endpoint unreachable");
      }
      return new Response(JSON.stringify({ token }), { status: 200 });
    });

    const env: Env = {
      ...testEnv,
      LICENCE_SIGNING_PUBLIC_KEY: publicKeyJwk,
      LICENCE_SERVICE: service,
      CUSTOMER_ID: "acme",
    };

    await expect(
      worker.scheduled?.({} as ScheduledEvent, env, {} as ExecutionContext)
    ).resolves.not.toThrow();

    // The licence refresh, an entirely separate concern, must still
    // have succeeded despite the usage push failing.
    const state = await readLicenceState(testEnv.DB);
    expect(state).toEqual({ known: true, claims });
  });
});
