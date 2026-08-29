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
