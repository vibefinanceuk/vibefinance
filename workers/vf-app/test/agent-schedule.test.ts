import { describe, expect, it } from "vitest";
import { checkSchedule, isTimeZone, nextRunAfter, type AgentSchedule } from "../src/agent-schedule.js";

/**
 * When an agent runs — decision 0622. Times are kept as chosen, in the
 * environment's zone, so "Monday 08:00" stays 08:00 in London across the
 * end of summer time (Sunday 25 October 2026).
 */

const next = (schedule: AgentSchedule, after: string, zone = "Europe/London") => nextRunAfter(schedule, zone, new Date(after));

describe("the next run", () => {
  it("keeps a weekly time in local time across the clocks going back", () => {
    const monday8: AgentSchedule = { every: "week", time: "08:00", weekday: 1 };
    // Saturday 3 October, summer time: Monday 08:00 BST is 07:00 UTC.
    expect(next(monday8, "2026-10-03T12:00:00Z")).toBe("2026-10-05T07:00:00.000Z");
    // After the clocks go back: 08:00 GMT is 08:00 UTC.
    expect(next(monday8, "2026-10-25T12:00:00Z")).toBe("2026-10-26T08:00:00.000Z");
    // In Berlin, 08:00 CEST is 06:00 UTC.
    expect(next(monday8, "2026-10-03T12:00:00Z", "Europe/Berlin")).toBe("2026-10-05T06:00:00.000Z");
  });

  it("is strictly after: the run at that very moment is not the next one", () => {
    const daily: AgentSchedule = { every: "day", time: "09:30" };
    expect(next(daily, "2026-10-05T08:30:00Z")).toBe("2026-10-06T08:30:00.000Z");
    expect(next(daily, "2026-10-05T08:29:00Z")).toBe("2026-10-05T08:30:00.000Z");
  });

  it("skips the weekend for working days", () => {
    // Friday 9 October after 07:30 BST: the next working day is Monday 12.
    expect(next({ every: "workday", time: "07:30" }, "2026-10-09T07:00:00Z")).toBe("2026-10-12T06:30:00.000Z");
  });

  it("finds a date, the last day and the last working day of a month", () => {
    expect(next({ every: "month", time: "16:00", day: 15 }, "2026-10-20T00:00:00Z")).toBe("2026-11-15T16:00:00.000Z");
    // October 2026 ends on a Saturday: its last working day is Friday 30.
    expect(next({ every: "month", time: "16:00", day: "lastWorking" }, "2026-10-01T00:00:00Z")).toBe("2026-10-30T16:00:00.000Z");
    expect(next({ every: "month", time: "16:00", day: "last" }, "2027-02-01T00:00:00Z")).toBe("2027-02-28T16:00:00.000Z");
  });

  it("runs once, and then has no next", () => {
    const once: AgentSchedule = { every: "once", time: "10:00", date: "2026-11-02" };
    expect(next(once, "2026-10-04T00:00:00Z")).toBe("2026-11-02T10:00:00.000Z");
    expect(next(once, "2026-11-02T10:00:00Z")).toBeNull();
  });
});

describe("a schedule as sent", () => {
  it("is refused, in a word, where incomplete", () => {
    expect(checkSchedule(null)).toEqual({ reason: "schedule_missing" });
    expect(checkSchedule({ every: "day", time: "8am" })).toEqual({ reason: "time_invalid" });
    expect(checkSchedule({ every: "hour", time: "08:00" })).toEqual({ reason: "every_invalid" });
    expect(checkSchedule({ every: "week", time: "08:00", weekday: 8 })).toEqual({ reason: "weekday_invalid" });
    expect(checkSchedule({ every: "month", time: "08:00", day: 31 })).toEqual({ reason: "day_invalid" });
    expect(checkSchedule({ every: "once", time: "08:00", date: "2026-13-01" })).toEqual({ reason: "date_invalid" });
    expect(checkSchedule({ every: "week", time: "08:00", weekday: "1", extra: true })).toEqual({ schedule: { every: "week", time: "08:00", weekday: 1 } });
  });

  it("knows a time zone from a made-up one", () => {
    expect(isTimeZone("Europe/London")).toBe(true);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
    expect(isTimeZone("")).toBe(false);
  });
});
