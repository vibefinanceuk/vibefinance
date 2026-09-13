# 0312 — The heading names the document, not the stage the Process flow already shows

**Status: built.**

---

## What was asked

> On the document viewer, at the very top of the page, on the left -
> we state the "Stage: <stage name>". I've just realised that this
> information is duplicated, because it is highlighted in the Process
> flow, which shows the current stage highlighted, on the same page.

Confirmed directly before changing anything: `processRow()` already
labels every chevron with its own `stage.name` and marks the current
one with a `.here` class — the heading naming the stage again was
saying the same fact twice on the same screen.

## The one real gap, surfaced and resolved before building

The Process flow only renders when `progress.inProcess` is true — a
task with no real process instance shows neither the chevron row nor
a stage name anywhere. Flagged directly rather than assumed away, with
two options: keep "Stage: X" as a fallback only in that case, or drop
it unconditionally and accept the rare gap. The operator's own choice
was the second — simplicity over covering a case confirmed to be rare
rather than carrying the duplication everywhere else to guard against
it.

## What was built

The heading now shows the document's own reference — `Unique Ref:
inv-1`, the same label and value that used to sit in the subtitle
beneath it — with the same line-number suffix decision 0183 already
added, carried over unchanged. A task with no real subject at all
falls back to `viewer.title`, the same fallback the old stage-based
heading already had for its own edge case.

**`topbar()` itself gained a real improvement along the way.** Moving
the reference into the title left the subtitle always empty, and a
`<p class="sub">` with nothing in it still occupies its own
line-height — a visible gap between the heading and whatever `extra`
renders beneath it. `topbar()` now omits the subtitle paragraph
entirely when there is nothing to put in it, the same "nothing to
show" reasoning decision 0161 already gives a button, applied here to
a line of text. This is a shared function every screen calls, not a
viewer-only fix.

## What has coverage

Three existing tests referenced the old "Stage: X" heading directly
and were rewritten against the new one, rather than left to assert a
claim this change deliberately reverses: one now confirms the heading
names the document by its reference; one confirms the heading is still
labelled, not a bare, ambiguous id (decision 0175's own reasoning,
applied to what replaced the stage name); one — checking a document
with no stage that still renders something real rather than a blank
screen — needed its own expected text updated, since the specific
fallback text it checked for is no longer what a document with a real
reference shows. A new test confirms `topbar()`'s own change directly:
the subtitle paragraph is absent, not merely empty. Each of the three
central claims probed directly — reverting the heading entirely,
reverting `topbar()`'s own subtitle omission, and removing just the
reference's own label prefix — each fails exactly the test written to
catch it.

vf-ui: 49 Worker, 399 browser (unchanged count — three tests rewritten,
one added, one of the four original assertions retired as redundant
once its claim moved into another). No migration — every string reused
is pre-existing; `viewer.stagelabel` remains in the database, unused
from here, per the standing "never delete a string" policy.
