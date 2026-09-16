# 0368 — Asks the Click

**Status: built.** Reported live: "the count on the dashboard does
not reflect the count when clicking on the card. Waiting for me,
shows 11 items across 4 stages. If I click on the card it shows 5
items across three stages."

---

## Root cause

`waitingForMe()` ran its own, separate SQL query: open tasks owned by
the person, claimed by them, or sitting in a team they belong to,
narrowed by `unitClause`'s own `AP.Review`-based org scope. The card's
own click opens `openTasksFiltered({ ownership: "mine" })`, which
calls `handleListMyTasks()` — a genuinely different function, with a
genuinely different scoping mechanism: it checks each task's own
`required_permission`, walked up its document's org-unit lineage
(decision 0202), and separately narrows by whichever org is currently
chosen (decision 0314). Neither of those checks has anything to do
with `AP.Review`.

So a task assigned or claimed by someone whose role had since
narrowed — no longer covering that task's own required permission, or
covering a different org than the task sits in — stayed counted on the
dashboard while `handleListMyTasks()` correctly excluded it from the
list the card's own click opens.

**The exact class of bug `items_at_stage` already found and fixed this
same way, four times over** — decisions 0252 through 0255, whose own
record already named the lesson directly: "Two queries for one
question will drift, and the only way a card can promise to say what
its click shows is to ask the click." This decision applies that same,
already-proven fix to a second card.

## Fix

`waitingForMe()` now calls `handleListMyTasks(db, userId, {
ownership: "mine", limit: 1000, currentOrgUnitId: currentOrg })`
directly — the same route the card's own click opens — and derives
`count` from its own `counts.mine`, and the stage breakdown by
grouping its own returned `tasks`. `currentOrg` is threaded through
`runCard()` from `handleDashboard()`'s own top level, since
`waitingForMe()` no longer needs the pre-computed `Scope` at all.
Ordering by each stage's own sequence — the convention
`whereThingsAre()` already established — is asked for separately,
since `handleListMyTasks()` orders by creation time, against only the
handful of stages actually present rather than every stage that exists.

## A real, second consequence, stated plainly

Fixing this exposed a genuine, related divergence: an unclaimed task
sitting in a team's own queue was being counted as "waiting for me,"
even though nobody has taken it yet. `ownership: "mine"` — what the
card's own click actually filters by — only ever means directly
assigned or claimed, the identical distinction `on_my_clock` already
makes for the same reason ("Available, not mine... putting it on
somebody's clock would make every member responsible for all of it").
Matching what the click itself shows means matching this exclusion
too. This narrows the dashboard's own count for anyone whose team has
unclaimed work sitting in its queue — a real, visible change beyond
the reported mismatch itself, not only a bug fix.

## What has coverage

Five existing tests updated, each re-examined against what it was
actually testing rather than patched blindly: three needed
`AP.Validate` — the permission `work()`'s own seeded tasks genuinely
require — granted alongside `AP.Review`, since they were meaningfully
testing org-unit narrowing and had simply been granting the wrong
permission to exercise it; one's own name and expectation ("counts
nothing for somebody permitted nowhere") turned out to be asserting
the exact bug being fixed and was rewritten to demonstrate the
correct behaviour instead; one (the team-queue exclusion) had its
expected count reversed to match the real, now-consistent definition
of "mine." A new test compares the dashboard's own count directly
against `handleListMyTasks()`'s own count for the precise shape of
gap reported — a role that no longer covers the org a task sits in —
probed by reverting to the old implementation and confirming it fails.

`vf-app`: dashboard tests 60 (was 59, net +1: several rewritten, one
new). No other test file has a real dependency on `dashboard-route.ts`
— confirmed directly, not assumed. `vf-ui` and `vf-licence` untouched.
