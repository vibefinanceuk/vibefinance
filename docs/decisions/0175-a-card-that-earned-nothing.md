# 0175 — A card that earned nothing

**Status: built.** The status panel is gone, and what was worth keeping
moved to where somebody looks first.

---

## Four things in a card, and none of them earned it

The viewer carried a status panel with Status, Stage, Waiting and Owner.
Taken one at a time:

**Status** read *"Not yet keyed · 0/4 fields known"* on every document —
counting four fields chosen when the screen was written and never since,
so it said the same thing whether an invoice had been fully read or not
read at all.

**Stage** was already the heading, two inches above it.

**Waiting** and **Owner** were real, and were below the fold.

So a card of four facts contained one duplicate, one falsehood, and two
things somebody actually wanted before the document itself.

---

## Labelled, because a bare word could be anything

The heading read `Validation` and the line beneath it a bare
identifier. Neither said what kind of thing it was: `Stage: Validation`
and `Unique Ref: e075d667…` do.

The same screen serves every stage (decision 0142), so the heading has
to name the stage — and naming it without saying it *is* a stage leaves
somebody guessing at a single word.

---

## "Owner: Mine" told the owner what they knew

It reported the viewer's own relationship to the task, which is the one
thing the person reading it is certain of, and told everybody else
nothing.

**An address is who to ask.** `task-list-route.ts` already joined the
claimant for their name; it now carries their email too.

---

## And the process row moves up a screenful

Which is the point of removing it: decision 0151's chevrons show where a
document has been, and they were below a card that said less.

---

## What is not built

- **An unclaimed task shows no owner at all**, which is honest and
  leaves the row empty where a team name would do.
- **Nothing says how much of a document has been keyed**, which is what
  the status was reaching for and getting wrong. A real version would
  count the fields a stage asks for rather than four somebody picked.
