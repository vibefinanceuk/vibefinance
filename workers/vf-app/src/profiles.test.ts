import { describe, expect, it } from "vitest";
import { CIUS_PROFILES, PROFILE_DESCRIPTIONS, isKnownCiusProfile } from "./profiles.js";
import type { CiusProfile } from "./profiles.js";

describe("isKnownCiusProfile", () => {
  it("accepts every profile in the closed list", () => {
    for (const profile of CIUS_PROFILES) {
      expect(isKnownCiusProfile(profile)).toBe(true);
    }
  });

  it("rejects an unknown string", () => {
    expect(isKnownCiusProfile("made_up_profile")).toBe(false);
  });

  it("rejects non-string values without throwing", () => {
    expect(isKnownCiusProfile(undefined)).toBe(false);
    expect(isKnownCiusProfile(null)).toBe(false);
    expect(isKnownCiusProfile(42)).toBe(false);
    expect(isKnownCiusProfile({})).toBe(false);
  });
});

describe("PROFILE_DESCRIPTIONS — completeness", () => {
  it("has a non-empty description for every profile in the closed list, and nothing extra", () => {
    // Catches the exact kind of drift the migration's own comment
    // warns about: CIUS_PROFILES and the SQL CHECK constraint are two
    // separate lists a future edit has to update together by hand.
    // This test at least confirms this file's own two exports agree
    // with each other.
    const describedKeys = Object.keys(PROFILE_DESCRIPTIONS) as CiusProfile[];
    expect(describedKeys.sort()).toEqual([...CIUS_PROFILES].sort());
    for (const profile of CIUS_PROFILES) {
      expect(PROFILE_DESCRIPTIONS[profile].length).toBeGreaterThan(0);
    }
  });
});
