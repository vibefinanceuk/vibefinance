import { describe, expect, it } from "vitest";
import { extractBearerToken, generateApiKey, hashApiKey, timingSafeEqual } from "./user-auth.js";

describe("generateApiKey", () => {
  it("generates a non-empty, URL-safe string", () => {
    const key = generateApiKey();
    expect(key.length).toBeGreaterThan(0);
    expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates a different key every time", () => {
    const keys = new Set(Array.from({ length: 20 }, () => generateApiKey()));
    expect(keys.size).toBe(20);
  });
});

describe("hashApiKey", () => {
  it("is deterministic", async () => {
    const key = generateApiKey();
    expect(await hashApiKey(key)).toBe(await hashApiKey(key));
  });

  it("different keys hash to different values", async () => {
    expect(await hashApiKey(generateApiKey())).not.toBe(await hashApiKey(generateApiKey()));
  });

  it("never returns the plaintext key itself", async () => {
    const key = generateApiKey();
    const hash = await hashApiKey(key);
    expect(hash).not.toBe(key);
    expect(hash).not.toContain(key);
  });
});

describe("timingSafeEqual", () => {
  // Same honest limitation as vf-licence's own auth.test.ts: these
  // tests confirm correctness of the return value, not the actual
  // constant-time property, which is only observable via real timing
  // measurement.
  it("returns true for identical strings", () => {
    expect(timingSafeEqual("abc123", "abc123")).toBe(true);
  });

  it("returns false for different strings of the same length", () => {
    expect(timingSafeEqual("abc123", "abc124")).toBe(false);
  });

  it("returns false for strings of different lengths", () => {
    expect(timingSafeEqual("short", "a-much-longer-string")).toBe(false);
  });
});

describe("extractBearerToken", () => {
  it("extracts the token from a well-formed Authorization header", () => {
    const request = new Request("https://x", { headers: { Authorization: "Bearer abc123" } });
    expect(extractBearerToken(request)).toBe("abc123");
  });

  it("returns null when there is no Authorization header", () => {
    expect(extractBearerToken(new Request("https://x"))).toBeNull();
  });

  it("returns null when the header doesn't start with 'Bearer '", () => {
    const request = new Request("https://x", { headers: { Authorization: "Basic abc123" } });
    expect(extractBearerToken(request)).toBeNull();
  });
});
