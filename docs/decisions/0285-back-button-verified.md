# 0285 — "Back" was checked, not just renamed

**Status: built.**

---

## What was said

> the back appears in the viewer launched from Tasks and Documents
> links, so Back is generic as you may not return to the Task

Not a bug report — the operator naming exactly why decision 0284's
shortened wording was the right call: the viewer opens from two
different screens, and a label naming one of them would be wrong the
other half of the time.

## What that observation actually deserved

A label being honestly generic is not the same claim as the button
underneath it behaving correctly for both callers. Read as a prompt to
check the second thing, not just agree with the first: does clicking
"Back" from a document opened through Documents actually return to
Documents, or does it — cosmetically relabelled but not actually
fixed — still assume Tasks underneath?

**It was already correct**, confirmed by reading both call sites
rather than assumed from the generic wording alone. `tasks.js` passes
its own `onClose`, which re-shows the task list and reloads it.
`documents.js` passes a genuinely different one, which re-shows the
document list and reloads *that*. `#shell` is one shared element both
screens render into, and each caller's own callback is what decides
what it shows next — the same reasoning that made the frame itself
shared in decision 0108, applied here to what happens on the way out
rather than the way in.

## What had no coverage before this

Confirmed by checking, not assumed by inspection alone: no test
anywhere exercised the round trip from Documents through the viewer
and back. One added — opens a document from the Documents screen,
clicks Back, and checks not just that the viewer closes but that what
reappears is genuinely the document list (`.searchrow`, a marker
unique to that screen) rather than the task table. Probed by breaking
`documents.js`'s own `onClose` and confirming the test catches
precisely that regression, not some other one.

No production code changed — this record exists because the
verification itself was the work, and a claim checked and confirmed is
worth writing down the same as a bug found and fixed.

vf-ui: 49 Worker, 342 browser. No migration.
