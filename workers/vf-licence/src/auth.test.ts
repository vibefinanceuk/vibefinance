import { describe, expect, it } from "vitest";
import {
  extractBearerToken,
  generateApiKey,
  hashApiKey,
  isValidAdminKey,
  timingSafeEqual,
} from "./auth.js";

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
  it("is deterministic — the same key always hashes the same way", async () => {
    const key = generateApiKey();
    const hash1 = await hashApiKey(key);
    const hash2 = await hashApiKey(key);
    expect(hash1).toBe(hash2);
  });

  it("different keys hash to different values", async () => {
    const hash1 = await hashApiKey(generateApiKey());
    const hash2 = await hashApiKey(generateApiKey());
    expect(hash1).not.toBe(hash2);
  });

  it("never returns the plaintext key itself", async () => {
    const key = generateApiKey();
    const hash = await hashApiKey(key);
    expect(hash).not.toBe(key);
    expect(hash).not.toContain(key);
  });
});

describe("timingSafeEqual", () => {
  // Honest limitation: these tests confirm the function's return value
  // is correct (equal → true, unequal → false) — they cannot and do
  // not confirm the actual constant-time property itself, which is
  // only observable via real timing measurement, not a return-value
  // assertion. A naive `a === b` passes every test below identically;
  // confirmed directly by swapping in that exact implementation and
  // watching all these tests still pass. The correctness of the
  // constant-time *loop structure* (no early return based on where a
  // mismatch occurs) has to be verified by reading the implementation,
  // not by a test — recorded here so that's not silently assumed.
  it("returns true for identical strings", () => {
    expect(timingSafeEqual("abc123", "abc123")).toBe(true);
  });

  it("returns false for different strings of the same length", () => {
    expect(timingSafeEqual("abc123", "abc124")).toBe(false);
  });

  it("returns false for strings of different lengths", () => {
    expect(timingSafeEqual("short", "a-much-longer-string")).toBe(false);
  });

  it("returns false when one string is empty and the other isn't", () => {
    expect(timingSafeEqual("", "nonempty")).toBe(false);
  });

  it("returns true for two empty strings", () => {
    expect(timingSafeEqual("", "")).toBe(true);
  });

  it("correctly compares two real generated hashes", async () => {
    const key = generateApiKey();
    const hash = await hashApiKey(key);
    const sameHashAgain = await hashApiKey(key);
    const differentHash = await hashApiKey(generateApiKey());
    expect(timingSafeEqual(hash, sameHashAgain)).toBe(true);
    expect(timingSafeEqual(hash, differentHash)).toBe(false);
  });
});

describe("extractBearerToken", () => {
  it("extracts the token from a well-formed Authorization header", () => {
    const request = new Request("https://x", { headers: { Authorization: "Bearer abc123" } });
    expect(extractBearerToken(request)).toBe("abc123");
  });

  it("returns null when there is no Authorization header", () => {
    const request = new Request("https://x");
    expect(extractBearerToken(request)).toBeNull();
  });

  it("returns null when the header doesn't start with 'Bearer '", () => {
    const request = new Request("https://x", { headers: { Authorization: "Basic abc123" } });
    expect(extractBearerToken(request)).toBeNull();
  });

  it("returns null when the token portion is empty or whitespace-only", () => {
    const request = new Request("https://x", { headers: { Authorization: "Bearer    " } });
    expect(extractBearerToken(request)).toBeNull();
  });

  it("trims surrounding whitespace from the token", () => {
    const request = new Request("https://x", { headers: { Authorization: "Bearer  abc123  " } });
    expect(extractBearerToken(request)).toBe("abc123");
  });
});

describe("isValidAdminKey", () => {
  it("accepts the correct admin key", () => {
    expect(isValidAdminKey("secret123", "secret123")).toBe(true);
  });

  it("rejects a wrong admin key", () => {
    expect(isValidAdminKey("wrong", "secret123")).toBe(false);
  });

  it("rejects when no key was provided", () => {
    expect(isValidAdminKey(null, "secret123")).toBe(false);
  });

  it("rejects when ADMIN_API_KEY is not configured at all", () => {
    expect(isValidAdminKey("anything", undefined)).toBe(false);
  });

  it("rejects when both are somehow empty", () => {
    expect(isValidAdminKey(null, undefined)).toBe(false);
  });
});
