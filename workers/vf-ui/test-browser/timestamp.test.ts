import { describe, it, expect } from "vitest";
import { stamp } from "/timestamp.js";

/** Decision 0674: one way to show a timeline's moment, in the viewer's own time zone. */
describe("a timeline's moment, shown", () => {
  const local = (iso: string) => {
    const d = new Date(iso);
    const two = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
  };

  it("drops the T, the Z and the milliseconds, and shows local time to the second", () => {
    const shown = stamp("2026-10-07T15:37:19.973Z");
    expect(shown).toBe(local("2026-10-07T15:37:19.973Z"));
    expect(shown).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
  });

  it("reads SQLite's own form as UTC, so both forms of one moment show alike", () => {
    expect(stamp("2026-10-07 15:37:19")).toBe(stamp("2026-10-07T15:37:19.000Z"));
  });

  it("gives back what it cannot read, and nothing for nothing", () => {
    expect(stamp("soon")).toBe("soon");
    expect(stamp(null)).toBe("");
  });
});
