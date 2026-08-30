import { describe, expect, it } from "vitest";
import { PERMISSIONS, isKnownPermission, isKnownPermissionList } from "./permissions.js";

describe("isKnownPermission", () => {
  it("accepts every permission in the closed list", () => {
    for (const permission of PERMISSIONS) {
      expect(isKnownPermission(permission)).toBe(true);
    }
  });

  it("rejects an unknown string", () => {
    expect(isKnownPermission("delete_everything")).toBe(false);
  });

  it("rejects non-string values without throwing", () => {
    expect(isKnownPermission(undefined)).toBe(false);
    expect(isKnownPermission(123)).toBe(false);
  });
});

describe("isKnownPermissionList", () => {
  it("accepts an array of entirely known permissions", () => {
    expect(isKnownPermissionList(["Admin.RuleManagement", "AP.Approve"])).toBe(true);
  });

  it("accepts an empty array", () => {
    expect(isKnownPermissionList([])).toBe(true);
  });

  it("rejects an array with even one unknown permission", () => {
    expect(isKnownPermissionList(["Admin.RuleManagement", "delete_everything"])).toBe(false);
  });

  it("rejects a non-array value", () => {
    expect(isKnownPermissionList("Admin.RuleManagement")).toBe(false);
    expect(isKnownPermissionList(undefined)).toBe(false);
  });
});
