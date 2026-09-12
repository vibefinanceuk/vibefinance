import { describe, it, expect } from "vitest";
import { mondayOfThisWeek } from "../src/dates.js";

describe("the Monday of a calendar week (decision 0265)", () => {
  /**
   * **Every day of a real week**, not a hand-picked one — a helper
   * used to decide what a card counts and what its link shows earns a
   * check against the whole week it claims to understand, not just a
   * Tuesday that happened to be convenient.
   */
  const week: [string, string][] = [
    ["2026-09-13", "2026-09-07"], // Sunday -> the Monday that just ended
    ["2026-09-14", "2026-09-14"], // Monday -> itself
    ["2026-09-15", "2026-09-14"],
    ["2026-09-16", "2026-09-14"],
    ["2026-09-17", "2026-09-14"],
    ["2026-09-18", "2026-09-14"],
    ["2026-09-19", "2026-09-14"], // Saturday -> the Monday that started it
    ["2026-09-20", "2026-09-14"], // the following Sunday -> the same Monday
  ];

  it.each(week)("resolves %s to Monday %s", (input, expected) => {
    expect(mondayOfThisWeek(new Date(`${input}T12:00:00Z`))).toBe(expected);
  });

  it("does not drift across a year boundary", () => {
    // Thursday 1 January 2026 belongs to a week that began in December.
    expect(mondayOfThisWeek(new Date("2026-01-01T12:00:00Z"))).toBe("2025-12-29");
  });

  it("is stable at the edge of a day, not sensitive to the hour given", () => {
    // Same calendar day, different times — must resolve identically.
    expect(mondayOfThisWeek(new Date("2026-09-16T00:00:01Z"))).toBe(
      mondayOfThisWeek(new Date("2026-09-16T23:59:59Z"))
    );
  });
});
