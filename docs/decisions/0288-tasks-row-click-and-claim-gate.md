# 0288 — Tasks open like Documents now, and editing finally asks whose it is

**Status: built.**

---

## What was asked

> Please can you implement the same behaviour in the Task list. This
> I think will make the "Key" button redundant. This also introduces
> the decision, whether a user can view a document before it has been
> claimed. I think a document can be opened in read-only mode, when it
> is not claimed, however in order to act on the document in Edit
> mode, it must be claimed. Does that make sense?

Two pieces, not one: the same row-click behaviour decision 0287 gave
Documents, and a genuine access-control question underneath it.

## The row itself opens the task

The same pattern, reused rather than reinvented: `tr.clickable`, a
click handler on the row, and the "Key" action filtered out of the
row's own button list since it never did anything Key's own text
didn't already say — open the document. Every other action (Claim,
Release, Complete, Return) stays, because each does something the row
click does not.

**The same double-trigger risk decision 0287 already found, found
again here and fixed the same way.** The document cell used to be its
own clickable `.subjectlink` button; simplified to plain text, since a
second clickable element inside a clickable row fires twice on a
click. The *other* action buttons — Claim, Complete, and the rest —
stay genuinely clickable, so each one's own `onclick` now calls
`event.stopPropagation()` first: without it, clicking Claim would also
open the document mid-claim, using whatever stale ownership the row
was rendered with before the claim had finished.

## Whether viewing requires claiming — the real answer

The proposal was checked against what the code actually does, not
assumed correct on the strength of sounding reasonable. **It wasn't
implemented at all.** `canEditAnything` — the one flag deciding
whether the Save button and every field's own editability show up —
read only the stage's own field-visibility configuration. Nothing
anywhere asked whose task it was. An "available" (unclaimed) or
"locked" (someone else's claim) task on a stage configured as editable
was, before this, editable by anyone who could open it at all.

`task.ownership` already existed to answer exactly this —
`task-list-route.ts`'s own `ownershipOf` already computes `"mine"`
only for a task assigned directly or claimed by the person asking.
`canEditAnything` now requires it. A document opened outside any task
(the Documents screen's own use of this viewer, decision 0167) has no
`ownership` to be `"mine"`, so it stays read-only exactly as it
already did — this adds a real gate where none existed, rather than
changing behaviour that was already right.

**A second bug found while proving the first fix actually worked.**
`canEditAnything` correctly hid the Save button, but each individual
field's own `<input>` or read-only `<div>` was decided separately, by
that field's own visibility setting alone — never consulting
`canEditAnything` at all. The result, caught by a test rather than
shipped: fields that looked and behaved as editable inputs, with no
Save button anywhere to do anything with what was typed into them —
a worse, more confusing state than either genuinely read-only or
genuinely editable. `field()` now renders read-only text when either
the field's own visibility says so, or `canEditAnything` says no —
confirmed as two independent, both-necessary gates by removing each in
turn and watching a different set of tests fail each time.

Claiming remains offered from inside the read-only view — the one
action `actionsFor()` already grants an "available" task — so nobody
has to close the viewer and find the row again just to take it.

## What wasn't changed, stated rather than glossed over

Claiming a task, from inside the viewer, still closes it and returns
to the list — the same behaviour every other action already had,
unchanged here. The list reloads immediately, so the task reappears
marked `"mine"` and ready to open again, editable this time — one
extra click, not a broken path. A seamless in-place switch straight
into edit mode after claiming was considered and set aside for this
pass, on scope rather than difficulty: it would mean reworking how
every action closes the viewer, not just this one.

## What has coverage

Seven new tests. On the list: the row opens the viewer on click; Key
never appears as its own button while Claim, Complete and the rest
still do; and clicking an action does not also open the row underneath
it — probed directly, and the first version of that specific test was
itself wrong, passing regardless of whether the fix worked because a
fixed wait let the assertion run before either async chain had
resolved either way. Rewritten to wait for the action's own POST to
genuinely complete, then reprobed and confirmed it catches the
regression it was written for. On the viewer: an unclaimed task stays
read-only even when the stage permits editing; a locked task does too;
Claim is still offered from that read-only view. Each of the two
independent read-only gates — the flag and the per-field check — was
probed by removing it alone and confirming a different, specific test
fails.

vf-ui: 49 Worker, 349 browser. No migration.
