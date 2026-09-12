/**
 * **One definition of "this week," used by both ends of a link** —
 * decision 0265.
 *
 * The dashboard's `done()` card and the documents route's own
 * "completed by me this week" filter both need the same Monday. Two
 * routes each computing it independently is exactly the class of drift
 * decision 0236 already cost a morning — a one-day difference in
 * either calculation would make the card's count and the list it links
 * to disagree, quietly, only on the days it matters.
 */

/**
 * The Monday of the calendar week containing `now`, as `YYYY-MM-DD`.
 *
 * **Calendar week, not a rolling seven days** — the operator's own
 * choice: Monday to Sunday, resetting Monday, not "the last seven
 * days ending today."
 *
 * `now` is a parameter rather than read fresh internally so a test can
 * hand it a fixed date without waiting for a particular day to arrive.
 */
export function mondayOfThisWeek(now: Date = new Date()): string {
  const day = now.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const daysSinceMonday = (day + 6) % 7;
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday)
  );
  return monday.toISOString().slice(0, 10);
}
