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

/**
 * The first day of the calendar month containing `now`, as `YYYY-MM-DD`
 * — decision 0430's second addendum, for the AP Assistant's own
 * `invoice_search` tool answering "received this month."
 *
 * Calendar month, not a rolling thirty days — the same choice
 * `mondayOfThisWeek` already made for "this week," for the same
 * reason: a person asking "this month" means the one on the
 * calendar, not a window that silently slides across a month
 * boundary.
 *
 * `now` is a parameter rather than read fresh internally so a test can
 * hand it a fixed date without waiting for a particular day to arrive.
 */
export function firstOfThisMonth(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

/**
 * The first day of the calendar quarter containing `now`
 * (1 Jan/Apr/Jul/Oct), as `YYYY-MM-DD` — decision 0430's fourth
 * addendum, for the AP Assistant's own `invoice_search` tool answering
 * "this quarter." A live test asked for a total "for this quarter" and
 * found only `this_month` support — the same calendar-boundary
 * reasoning `firstOfThisMonth` and `mondayOfThisWeek` already apply,
 * just one bucket coarser.
 *
 * `now` is a parameter rather than read fresh internally so a test can
 * hand it a fixed date without waiting for a particular day to arrive.
 */
export function firstOfThisQuarter(now: Date = new Date()): string {
  const quarterStartMonth = Math.floor(now.getUTCMonth() / 3) * 3;
  return new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth, 1)).toISOString().slice(0, 10);
}
