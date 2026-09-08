# 0151 — Where an invoice has been

**Status: built.** The process as a sequence at the head of the viewer,
with the current stage marked and how long each took.

---

## The operator's idea

From seeing the chevrons on the rules screen (decision 0149):

> It might be a good idea to include the very same display at the head
> of the invoice viewer, with the current stage highlighted... Enter and
> Leave timestamps, so it's clear the progression through the process,
> and also the duration at each stage.

**Nothing had to be recorded for it.** `stage_visits` has held a
timestamp per visit since decision 0009. **Leaving is the next visit's
arrival**, and the duration is the gap between them.

So the data existed, and nobody had asked it this question.

---

## Drawn once, used twice

Decision 0149 built the chevron row for rules. The viewer needed the
same shape — so it moved to `process-row.js` rather than being drawn
again.

That is the argument decision 0149 itself made about the icons, and the
one decision 0136 made about the manifest: **a thing drawn twice is a
thing that can differ in two places.**

The **detail line beneath each chevron** is what differs. On the rules
screen it counts the rules that run there; in the viewer it is how long
the document stayed. The shape is shared; what it says is the screen's
own.

### And the viewer's chevrons do not click

The rules screen's are buttons: picking a stage is how you browse. The
viewer's are `div`s, because **a chevron there reports where the
document has been.** It is not a place to send it.

---

## What is shown, and what is not

**Every stage, including ones ahead.** Dimmed rather than hidden, so the
sequence reads as a whole and somebody can see what is left — the same
reasoning decision 0149 applied to a stage with no rules.

**How long, in the unit a person would use.** *"4d 5h"*, *"40m"*, and
**"under a minute"** for an automatic stage that passed through in
seconds — because *"0m"* reads like a missing value.

**And the stage it is at has no duration**, because it has not been
left. It says *"here since"* instead.

### An invoice that came back

Decision 0075 makes returning a first-class action, so **a stage can be
visited more than once.** A timeline showing one visit per stage would
quietly lose the fact that somebody sent it back.

So the latest visit is described, and the count is carried where it is
more than one. Watched to fail: describing the first visit instead
breaks the test that walks a returned invoice.

---

## An invoice in no process

Shows nothing at all, rather than an empty row of chevrons — **which
would imply it had not started.** An invoice captured outside a process
is a real state (decision 0071 keeps the inline path deliberately), not
a failure.

And a path that cannot be loaded does not stop the screen: **a path
nobody can show is not a document nobody can key.**

---

## What is not built

- **Nothing records which rule versions fired.** Decision 0150 names
  this: an invoice can pass Validation under one rule version and
  Approval under another, and the timeline shows when it was there
  without showing what was in force. *"Why was this held"* is answerable
  only from what the rules say today.
- **No outcome is shown.** `stage_visits.outcome` records whether a
  stage was automatic or returned, and the row does not say — so a
  return looks like an ordinary visit that happened to be second.
- **Times are as recorded, in UTC.** Decision 0057 keeps timestamps in
  UTC deliberately; nothing converts them, so a customer in Berlin reads
  an hour they did not experience.
- **The row does not scroll well with eight stages.** It scrolls; it
  does not do so gracefully, and a process with a dozen stages would be
  worse.
