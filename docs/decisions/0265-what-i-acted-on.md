# 0265 — What I acted on, and a Monday two routes agree on

**Status: built.** "Done" redefined and linked. "How long they have
waited" is still the one card left from decision 0264 — read the end
of that record, unchanged here.

---

## What was asked

> I think we need to define what Done actually means — I should have
> specified. I'm thinking is perhaps a daily count of items I have
> acted upon... The card could display this week M, T, W, T, F, S, S
> and a count, which can link to the Documents tab to launch those
> items?

Two choices confirmed directly: a **calendar week** (Monday–Sunday,
resetting Monday, not a rolling seven days), and **the whole card**
links to one filtered view rather than each day separately.

---

## One Monday, not two

The card counts a week of completions; the link has to show the same
week. Two routes each computing "the Monday of this week" independently
is exactly the class of drift decision 0236 already cost a morning — a
one-day difference in either calculation would make the count and the
list disagree, quietly, only on the days it mattered.

**`dates.ts`** exports `mondayOfThisWeek()`, used by both
`dashboard-route.ts`'s `done()` and `documents-route.ts`'s new
`doneByMe` filter. Tested against every day of a real week, a year
boundary, and confirmed insensitive to the hour given — ten tests
before either caller was written.

---

## The redefinition

`done()` now counts `completed_by = userId` alone — never anyone
else's completions, unlike the three-number split decision 0257 built.
**That narrowing is what makes the link honest without a workaround.**
"Where things are" needed Documents instead of Tasks because Tasks is
permanently scoped to the viewer's own work and the card counted
everyone's; "Done" was redefined to be personal from the start, so it
sits inside that same scope rather than needing to route around it.

Seven entries, Monday through Sunday, gap-filled with zero — a person
who did nothing on Tuesday sees a zero under Tuesday, not a Tuesday
silently missing, the same discipline decision 0257 applied to the
rolling trend this replaces.

**The card's old test suite used `daysAgo` offsets from "now."**
Rewritten to seed by offset from the real Monday instead — a fixed
`-2 days` would silently land in the wrong calendar week depending on
which day of the week the suite happened to run on, passing or failing
by accident rather than by what it claimed to test.

---

## The link, and what the server already knows

`handleListDocuments` gained an optional `userId` parameter and a
`doneByMe=1` filter — an `EXISTS` against `tasks` matching
`completed_by` and the same `mondayOfThisWeek()`. **The client sends no
userId of its own.** The server already authenticates every request;
`auth.user.id` was already sitting in `index.ts` and simply had not
been threaded through to this one route before.

**A real D1 constraint found while probing this**, worth recording:
placeholder count and bind-argument count must match exactly, or the
whole query fails to prepare — not the lenient "extra bindings are
ignored" behaviour assumed at first, which broke every test in the file
rather than the three that should have failed, and had to be
diagnosed and redone properly before the probe meant anything.

---

## The card itself

Half-weight now, not a tile — three small numbers fit a tile; seven
real daily counts and a total do not, and `barChart` already does this
job for `received` and `ageing`. Reused rather than a second way to
draw a week invented for one card.

Dead code removed rather than left stale: `last7Days()`'s client-side
gap-filling is now done once, server-side, in the query itself;
`sparkline`'s import went with it, since nothing in this file calls it
anymore. The `.tilebg`/`.tilefg` CSS stays — real, shipped, tested
infrastructure for whichever card next has genuine history and no room
to show it plainly, the same reasoning that already applied to
`donutChart` sitting unused between decisions 0242 and 0247.

vf-app: 1464 tests. vf-ui: 49 Worker, 290 browser. vf-licence: 320.
