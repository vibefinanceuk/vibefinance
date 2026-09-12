# 0264 — A link, where the link is honest

**Status: built, for two of four.** Read the last section for the
other two, and why they are not here yet.

---

## What was asked

> For each of the dashboard cards, would it be possible to provide a
> link from the card to the underlying items. Waiting for me, Done,
> Where things are and How long they have waited, are all static
> images currently.

---

## Waiting for me → Tasks, mine, every stage

`waitingForMe()` has no stage filter of its own — it counts open tasks
assigned to me, claimed by me, or owned by a team I am on, at any
stage. The click asks for exactly that: `ownership: "mine"`, no stage.

**The first test that ever clicked this all the way through.**
Decision 0250 built the stage card's own "Show mine" link on the same
underlying function and every test for it only checked the text
appeared — never that clicking actually landed anywhere. It does now,
and doing so surfaced that `render()` needs `me` populated
(`/api/whoami` resolved) before it can run at all — true on a real
page because `boot.js` always gets there first, and something a test
reaching the dashboard directly has to do on purpose.

---

## Where things are → Documents, by stage — and a wrong version caught
before it shipped

**The first attempt routed through Tasks, and it was wrong.**
`handleListMyTasks` carries a mandatory base clause —
`owner_user_id = me OR owner_team_id IN my teams` — with no way to ask
it for anyone else's work. `whereThingsAre()` counts every in-flight
document at a stage, regardless of who owns anything on it. Shipping
that link would have meant clicking a stage showing eight items and
seeing zero, because none of the eight happened to be assigned to the
viewer's own team — the exact disagreement decisions 0252 through 0260
spent real effort eliminating, reintroduced here by not checking a
route's own scope before reusing it.

**Documents is the honest target.** It is scoped by org unit
(decision 0199), not by personal ownership — the same way
`whereThingsAre()` itself is scoped. A new `stage` filter was added to
`handleListDocuments`, matching the card's own definition exactly:
`process_instances` at that stage with `status = 'in_progress'`. Not
merely `current_stage_id = X` — an instance whose `current_stage_id`
still names its last stage after completing must not appear, or the
list would show a document the card's own count never included.
Tested directly: seeded a completed instance at the target stage and
confirmed it is excluded, watched to fail when the status restriction
is removed.

The donut's legend rows are the click target, not the ring's stroke —
a few pixels of arc is a poor place to ask for a tap, and the legend
already exists to be read.

---

## What is not built yet

**Done** and **How long they have waited** are not here. Both need
real, separate backend work rather than reuse of what exists:

- **Done** counts *completed* tasks, split by today / this week / by
  me this week. The task list can already list completed tasks
  (`includeCompleted`), but has no date-range filter and the app has
  no screen that shows one today.
- **How long they have waited** counts *tasks*, by age, org-wide — not
  documents. A document's own age is not the same thing as the age of
  a task sitting on it, and there is currently no screen that shows
  every open task across the org regardless of owner — Tasks is
  permanently mine-only, the same limit found and worked around for
  "Where things are." Working around it the same way is not available
  here, because the underlying thing being counted is genuinely a
  task, not a document — an org-wide task view would be new,
  structural work, not a filter added to an existing screen.

vf-app: 1447 tests. vf-ui: 49 Worker, 289 browser. vf-licence: 320.
