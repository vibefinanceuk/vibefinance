import { describe, it, expect } from "vitest";
import { toIso, byTime, chronological } from "../src/timeline-time.js";

describe("one timeline, one clock (decision 0674)", () => {
  it("writes SQLite, ISO and offset moments in the one ISO form", () => {
    expect(toIso("2026-10-07 15:37:20")).toBe("2026-10-07T15:37:20.000Z");
    expect(toIso("2026-10-07T15:37:19.973Z")).toBe("2026-10-07T15:37:19.973Z");
    expect(toIso("2026-10-07T15:37:19")).toBe("2026-10-07T15:37:19.000Z");
    expect(toIso("2026-10-07T16:37:19+01:00")).toBe("2026-10-07T15:37:19.000Z");
    expect(toIso(null)).toBeNull();
  });

  it("orders by the moment, not the text", () => {
    const items = [
      { at: "2026-10-07 15:37:20.848", n: "rule" },
      { at: "2026-10-07 15:38:34", n: "chat" },
      { at: "2026-10-07T15:37:19.973Z", n: "received" },
      { at: "2026-10-07 15:37:20", n: "same second, no ms" },
    ];
    expect(chronological(items).map((i) => i.n)).toEqual(["received", "same second, no ms", "rule", "chat"]);
  });

  it("keeps the order written at the same moment, and puts an unreadable one last", () => {
    const items = [{ at: "nonsense" }, { at: "2026-01-01 00:00:00", n: 1 }, { at: "2026-01-01T00:00:00Z", n: 2 }];
    expect(items.slice().sort(byTime)).toEqual([items[1], items[2], items[0]]);
  });
});
