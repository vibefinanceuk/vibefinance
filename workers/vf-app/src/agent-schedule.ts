/**
 * **When an agent runs — decision 0622.**
 *
 * A schedule is kept as the person chose it, in the environment's own
 * time zone, and turned into the next moment in UTC only when needed:
 * so "every Monday at 08:00" stays 08:00 across a change to or from
 * summer time.
 *
 * - `day`: every day at `time`.
 * - `workday`: Monday to Friday at `time`. Public holidays are not known.
 * - `week`: on `weekday` (1 Monday … 7 Sunday) at `time`.
 * - `month`: on `day` (1–28), the `last` day, or the `lastWorking` day.
 * - `once`: on `date` (YYYY-MM-DD) at `time`, and then not again.
 *
 * Nothing runs more often than daily, inside the hourly floor the
 * design set.
 */

export type AgentSchedule =
  | { every: "day"; time: string }
  | { every: "workday"; time: string }
  | { every: "week"; time: string; weekday: number }
  | { every: "month"; time: string; day: number | "last" | "lastWorking" }
  | { every: "once"; time: string; date: string };

export const DEFAULT_TIME_ZONE = "Europe/London";

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether this runtime knows the zone, e.g. `Europe/Berlin`. */
export function isTimeZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || zone.trim() === "") return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** A schedule as sent, checked: the schedule, or a reason it was refused. */
export function checkSchedule(input: unknown): { schedule: AgentSchedule } | { reason: string } {
  if (!input || typeof input !== "object") return { reason: "schedule_missing" };
  const s = input as Record<string, unknown>;
  if (typeof s.time !== "string" || !TIME_RE.test(s.time)) return { reason: "time_invalid" };
  const time = s.time;
  switch (s.every) {
    case "day":
    case "workday":
      return { schedule: { every: s.every, time } };
    case "week": {
      const weekday = Number(s.weekday);
      if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) return { reason: "weekday_invalid" };
      return { schedule: { every: "week", time, weekday } };
    }
    case "month": {
      if (s.day === "last" || s.day === "lastWorking") return { schedule: { every: "month", time, day: s.day } };
      const day = Number(s.day);
      if (!Number.isInteger(day) || day < 1 || day > 28) return { reason: "day_invalid" };
      return { schedule: { every: "month", time, day } };
    }
    case "once": {
      if (typeof s.date !== "string" || !DATE_RE.test(s.date) || Number.isNaN(Date.parse(`${s.date}T00:00:00Z`))) {
        return { reason: "date_invalid" };
      }
      return { schedule: { every: "once", time, date: s.date } };
    }
    default:
      return { reason: "every_invalid" };
  }
}

interface LocalParts {
  y: number;
  m: number; // 1–12
  d: number;
  h: number;
  mi: number;
}

function partsIn(ms: number, zone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour") % 24, mi: get("minute") };
}

/** The zone's offset from UTC at `ms`, in milliseconds (London in summer: +3,600,000). */
function offsetAt(ms: number, zone: string): number {
  const p = partsIn(ms, zone);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
  return asUtc - Math.floor(ms / 60_000) * 60_000;
}

/** A wall-clock time in the zone, as a UTC instant. */
export function localToUtc(y: number, m: number, d: number, h: number, mi: number, zone: string): number {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = guess - offsetAt(guess, zone);
  const second = guess - offsetAt(first, zone);
  return second;
}

/** Monday 1 … Sunday 7, for a calendar date. */
function weekdayOf(y: number, m: number, d: number): number {
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return js === 0 ? 7 : js;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function lastWorkingDay(y: number, m: number): number {
  let d = daysInMonth(y, m);
  while (weekdayOf(y, m, d) > 5) d -= 1;
  return d;
}

function runsOn(schedule: AgentSchedule, y: number, m: number, d: number): boolean {
  switch (schedule.every) {
    case "day":
      return true;
    case "workday":
      return weekdayOf(y, m, d) <= 5;
    case "week":
      return weekdayOf(y, m, d) === schedule.weekday;
    case "month":
      if (schedule.day === "last") return d === daysInMonth(y, m);
      if (schedule.day === "lastWorking") return d === lastWorkingDay(y, m);
      return d === schedule.day;
    case "once": {
      const [, yy, mm, dd] = DATE_RE.exec(schedule.date)!;
      return Number(yy) === y && Number(mm) === m && Number(dd) === d;
    }
  }
}

/**
 * The first moment strictly after `after` that the schedule names, as an
 * ISO string in UTC; null when there is none (a `once` already past).
 */
export function nextRunAfter(schedule: AgentSchedule, zone: string, after: Date): string | null {
  const [h, mi] = schedule.time.split(":").map(Number);
  const start = partsIn(after.getTime(), zone);
  // A year and a little: enough for any monthly day, and a `once` within it.
  for (let i = 0; i < 400; i++) {
    const day = new Date(Date.UTC(start.y, start.m - 1, start.d + i));
    const y = day.getUTCFullYear();
    const m = day.getUTCMonth() + 1;
    const d = day.getUTCDate();
    if (!runsOn(schedule, y, m, d)) continue;
    const at = localToUtc(y, m, d, h, mi, zone);
    if (at > after.getTime()) return new Date(at).toISOString();
  }
  return null;
}
