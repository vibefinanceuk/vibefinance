/**
 * **One timeline, one clock — decision 0674.**
 *
 * A timeline gathers moments written in two forms: SQLite's
 * `datetime('now')` (`2026-10-07 15:37:20`, UTC with no marker), and
 * JavaScript's `toISOString()` (`2026-10-07T15:37:19.973Z`). Sorted as
 * text, every ISO moment came after every SQLite one of the same day,
 * because "T" sorts after a space, so a document's *Received* line sat
 * below a rule that fired a second later and a chat posted a minute
 * later. A moment with milliseconds also sorted before the same second
 * without them.
 *
 * `instant()` reads either form (and an offset, if one is ever given)
 * as UTC, and `toIso()` writes it back in exactly one form, so what is
 * sent sorts as text and reads as time. `byTime` orders by the instant
 * itself; at the same instant the order written is kept (`sort` is
 * stable).
 */
export function instant(at: string | null | undefined): number {
  if (!at) return Number.NaN;
  const s = String(at).trim();
  const withT = s.includes("T") ? s : s.replace(" ", "T");
  const zoned = /(Z|[+-]\d\d:?\d\d)$/.test(withT) ? withT : `${withT}Z`;
  return Date.parse(zoned);
}

/** The moment as `YYYY-MM-DDTHH:MM:SS.sssZ`, or as given when it cannot be read. */
export function toIso(at: string): string;
export function toIso(at: string | null | undefined): string | null;
export function toIso(at: string | null | undefined): string | null {
  if (!at) return null;
  const ms = instant(at);
  return Number.isNaN(ms) ? at : new Date(ms).toISOString();
}

/** Oldest first; a moment that cannot be read goes last. */
export function byTime<T extends { at: string }>(a: T, b: T): number {
  const x = instant(a.at);
  const y = instant(b.at);
  if (Number.isNaN(x) || Number.isNaN(y)) return Number.isNaN(x) ? (Number.isNaN(y) ? 0 : 1) : -1;
  return x - y;
}

/** Every item's `at` in the one form, oldest first. */
export function chronological<T extends { at: string }>(items: T[]): T[] {
  return items.map((item) => ({ ...item, at: toIso(item.at) })).sort(byTime);
}
