# 0103 — The Task Manager

**Status: the listing endpoint is built** —
`GET /tasks` on `vf-app`. **Not built:** unlocking, the manager view,
and the screen itself.

---

## The finding that prompted it

**There is no way to list tasks.**

A task can be created, claimed, completed, returned, discarded — every
verb — and nothing answers *"what is waiting for me?"*

Every task in this system so far was created by a rule and found by
querying D1 directly. **A person has never had a way to discover their
own work.** The screen is not blocked on rendering; it is blocked on a
query that does not exist.

That is the tenth instance of this project's recurring pattern in a new
direction: not a declared value nothing reads, but **a workflow with no
way to see itself.**

---

## The broader intent: one table, filtered by stage

**Stated because it decides more than this screen.**

> One task table, filtered by stage. One UI per stage, chosen by what a
> task points at. **Never a table per stage.**

Each stage gets an interface suited to the work done there — keying at
Validation, approving at Approval — and each feeds items to whoever
holds the right permission. But they all draw from **one list**.

### What that buys

**The listing query never grows.** Adding a Coding stage adds no table,
no column and no branch in the endpoint. A task at Coding appears
because it is a task, and its `required_permission` decides who sees
it — which is already how `assign_task` works (decision 0018).

**The stage-specific part is entirely presentation.** A task carries
`stage_id` and `required_permission`; the interface maps a stage to a
screen. Nothing on the server needs to know that Validation means keying
and Approval means approving.

This is also what the schema already assumes: `tasks` is one table with
a `stage_id`, and the workflow engine is deliberately generic about what
a stage means.

### What a table per stage would cost

The queue joining across them; every new stage touching the endpoint;
*"my tasks"* becoming a union that grows with the process. It is the
shape that looks natural early and becomes the thing that cannot be
changed later.

### One consequence to be deliberate about

If the interface maps a stage to a screen, **an unrecognised stage needs
a sensible default rather than a blank page** — a generic view showing
the document and the stage history.

Customers define their own stages. One that nobody wrote a screen for
should still be workable, not broken.

---

## One list, across every stage

Not a screen per stage. A person may hold work at Validation and at
Approval simultaneously, and a queue that made them choose a stage first
would ask them to know something they are trying to find out.

So: **one Task Manager, listing tasks available to me**, whatever stage
each sits at. Opening a task launches whatever that stage needs — the
Validation keying screen (`docs/design/mockups/key-from-document.html`),
an approval screen, and so on.

The listing is therefore **stage-agnostic**. The stage decides what
opens, not what is listed.

---

## Ownership is a column, not three lists

Three cases, distinguished rather than merged, because they mean
different things to the person reading:

| Column reads | Means |
| --- | --- |
| **Mine** | Assigned to me directly, or claimed by me. Nobody else can act. |
| **Available** | Assigned to a team I am in, unclaimed. I can take it; so can a colleague. |
| **`Sarah K.` (locked)** | A team task claimed by a colleague. Visible, not actionable by me. |

Three separate lists would lose the difference between *my work* and
*work I could take*, which is the difference between a to-do list and a
pool. One column carries it and can be sorted on.

### Why the third case is included

It could be hidden. Including it means somebody can see that a
colleague's three approvals have sat for two days, which is most of the
point of a shared queue.

**And the mechanism already exists.** `tasks.claimed_by` is exactly a
lock — decision 0064 established that claiming is what stops two people
doing the same thing, and the completion route only accepts a claim from
its holder. *"Locked by Sarah"* is `claimed_by` rendered honestly rather
than anything new.

### A claim only exists on a team task, already

Migration 0008 carries the invariant:

```sql
-- ASSERT ALWAYS: count(*) FROM tasks
--   WHERE claimed_by IS NOT NULL AND owner_team_id IS NULL == 0
```

A task assigned to a **person** needs no claim: it is already theirs and
nobody else could take it. So locking is a team-task concept in the
schema before it is one in the interface, which is the right way round.

---

## Read-only is not a new permission

Opening a locked task shows the document, the facts, the stage history —
all reads. What is withheld is *acting*: keying, returning, discarding.

**Those are already refused server-side.** `handleKeyInvoiceFields`
derives identity from the caller, and the return routes require holding
the task (decision 0075). So read-only is the interface reflecting a
refusal that already exists, rather than letting somebody fill in a form
and discover it on submit.

---

## Locks do not expire

**Considered and rejected: a lease with a timeout.** A claim valid for
fifteen minutes, refreshed while the page is open.

The argument for it is that a browser closing is undetectable —
`beforeunload` does not fire on a crash, a sleeping laptop or a killed
tab, and cannot reliably make a network request even when it does. Any
release that depends on the browser announcing its departure will leak
locks.

But a lease has its own failure: somebody reading a difficult invoice
loses their claim mid-thought, and the timeout is a number nobody can
choose correctly.

**A lock that never expires is at least predictable.** Nobody loses a
claim while working, and a lock left over a weekend is visibly
somebody's rather than ambiguously stale. Recovery is explicit instead:

- **A person releases their own** — an unlock action in the list, for
  when they realise it is not theirs to do.
- **A manager releases anyone's** — the case of somebody on holiday.

No timer to tune, no background sweep, no guessing whether a browser is
still there.

---

## Manager unlock needs its own permission

**Not `AP.ReturnAny`.** That returns a *document to a previous stage* on
somebody else's behalf — the document moves. Unlocking is smaller: the
task stays exactly where it is and merely becomes available again.

Bundling them would mean anybody who can unlock a task can also send
documents backwards through the workflow. Different powers, so a
different permission — and the same one should gate **seeing every
user's tasks**, since viewing the whole team's work and being able to
release it are one job.

---

## What a row needs, and the join it forces

A task id is useless to a person. A row needs the supplier, the amount,
how long it has waited, and why it is there.

That means joining through `stage_visits` to `process_instances`, which
carries `subject_id` and `subject_type` — and then to
`invoice_headers` for an invoice.

**The engine is deliberately generic** (decision 0018): it does not know
what an invoice is, only that a subject has an id. So this join is
invoice-specific and an expense would need its own.

Rather than pretend otherwise, the response should carry a `subject`
block **populated for invoices and absent for anything else**. The
alternative — forty rows each fetching their own subject — is forty
round trips for one screen.

That is the generic engine's cost landing where a person can see it, and
it is worth paying visibly rather than by hardcoding the invoice case
and discovering it later.

---

## Recording an unlock

`claimed_by` going null loses who released it and when. *"Alice released
Sarah's claim on Tuesday"* is worth having when Sarah asks why her task
moved, and **a person unlocking their own is a different act from a
manager unlocking another's** even though the effect is identical.

Where that record lives is open: the task row could carry it, or it
could join whatever eventually records task history.

---

## Built: `GET /tasks`

Accepts a session or an API key, and orders **oldest first** — age costs
money in accounts payable, so anything else would have to justify
itself.

**No permission gate beyond being a real user**, deliberately. What
somebody may see is decided by the query, not by a check afterwards: it
returns their own tasks and their teams', and there is nothing to
withhold from somebody already entitled to all of it. A gate would
suggest otherwise.

Watched to fail in both directions that matter:

- **Removing the ownership restriction** shows a person tasks belonging
  to teams they are not in, and colleagues' directly assigned work.
- **Treating a colleague's claim as available** invites two people to
  work the same document — the thing claiming exists to prevent
  (decision 0064).

**Completed and returned tasks are omitted.** A queue is work, not
history, and one showing both would need filtering before it was useful.

---

## One viewer, with actions that appear or do not

**Not a screen per stage.** One document viewer, and the actions
available change with the stage and the person's permissions — an
approve button only at Approval, only for somebody permitted to approve.

Less to build, and it degrades sensibly for a stage nobody wrote a
screen for, which is the consequence flagged above.

### The actions are reported, not inferred

Every one is **already enforced**: `AP.Return` plus the stage's own
permission plus holding the task (decision 0075), `AP.Discard` likewise,
`AP.Validate` for keying (0071).

If the interface re-derived those rules they would drift — a permission
changes and a button lingers, or vanishes while the action still works.
So each task **reports its own actions**, from the same conditions that
refuse them:

```json
"ownership": "mine",
"actions": ["complete", "key", "return", "discard"]
```

**A button that appears is one the server will honour.**

> **Presentation, not security.** A client can still call anything, and
> hiding a button withholds nothing. Enforcement stays in the routes;
> this only stops somebody being offered an action that would then be
> refused — the same distinction drawn above about read-only.

Watched to fail: offering actions on a task a colleague holds, and
ignoring the permission the task itself demands.

Permissions are read **once for the list** rather than per row — forty
tasks would otherwise mean forty identical queries — and a role with
unparseable permissions grants nothing rather than emptying the queue.

---

## Filtering, because a real queue is not thirty rows

The first live run returned **39 tasks across three stages**, several of
them the same invoice — `all_matches` firing multiple rules on one stage
visit, which is the multiple-approvers case working. A list that long is
already awkward; a customer with thousands would find it useless.

So `GET /tasks` takes `stage`, `ownership`, `limit` and `offset`.

**Stage is filtered in SQL; ownership afterwards.** A stage is stored on
the row. Ownership is *derived* — a task is "mine" or "locked" depending
on who is asking — and expressing that comparison in SQL as well as in
TypeScript would mean two versions of one rule, which drift.

**The limit is capped at 200.** An unbounded list works for one customer
and not the next.

**The counts survive paging, but not filtering** — and the difference is
deliberate rather than incidental.

Paging past a task must not change the count: that would be telling
somebody about the page rather than about their work. **Filtering to a
stage should**, because the question has changed — a Validation view
reporting 39 available would be answering about a queue the person is
not looking at.

So the counts are computed after the filters and before the page. Worth
stating precisely, because "counts describe the queue" is the sort of
claim that reads as true and is only half of it.

> **That last one had a test which proved nothing.** It filtered by
> ownership rather than paging, and passed even when the counts were
> computed over the page — because the page happened to contain the one
> task being counted. **The fail-watch showing nothing is what exposed
> it**, which is the second time in this project that a check not
> failing was the useful signal.

---

## Deliberately not in this

- **Out-of-office reassignment.** Needs a notion of absence that does
  not exist, and manager unlock covers the case meanwhile.
- **The all-users view itself.** The permission is named here; the
  screen is a separate piece.
- **Anything a task opens.** The keying screen is mocked and unbuilt;
  approval has no mockup at all.
