import { describe, expect, it } from "vitest";
import { TenantResolutionError, resolveTenant } from "./tenant.js";

const dummyRequest = new Request("https://example.invalid/");

describe("resolveTenant", () => {
  it("throws when no DB binding is present", () => {
    expect(() => resolveTenant(dummyRequest, {})).toThrow(TenantResolutionError);
  });

  it("returns the binding when present", () => {
    const fakeDb = {} as D1Database;
    const ctx = resolveTenant(dummyRequest, { DB: fakeDb });
    expect(ctx.db).toBe(fakeDb);
  });
});

describe("resolveTenant — DOCUMENTS (decision 0035), genuinely optional unlike DB", () => {
  it("returns documents as undefined, not an error, when DOCUMENTS is not configured", () => {
    const fakeDb = {} as D1Database;
    const ctx = resolveTenant(dummyRequest, { DB: fakeDb });
    expect(ctx.documents).toBeUndefined();
  });

  it("returns the real DOCUMENTS binding when present", () => {
    const fakeDb = {} as D1Database;
    const fakeBucket = {} as R2Bucket;
    const ctx = resolveTenant(dummyRequest, { DB: fakeDb, DOCUMENTS: fakeBucket });
    expect(ctx.documents).toBe(fakeBucket);
  });
});
