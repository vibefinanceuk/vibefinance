# 0103 — The Task Manager

**Status: proposed.** Nothing built. The first screen after signing in,
and the first read-oriented endpoint in a system that has been entirely
write-oriented.

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

## Deliberately not in this

- **Out-of-office reassignment.** Needs a notion of absence that does
  not exist, and manager unlock covers the case meanwhile.
- **The all-users view itself.** The permission is named here; the
  screen is a separate piece.
- **Anything a task opens.** The keying screen is mocked and unbuilt;
  approval has no mockup at all.
