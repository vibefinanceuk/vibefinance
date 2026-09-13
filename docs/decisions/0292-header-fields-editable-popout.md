# 0292 — Header Fields becomes genuinely editable, and empty columns stop pretending to be there

**Status: built.**

---

## What was reported

> I am missing some fields on the card, and the pop-out is read-only
> mode. Perhaps the pop-out should be edit-mode also, if my user
> permissions allow.

Two separate findings from actually using decision 0291, both real.

## The missing fields

Purchase order and Cost centre were absent from both the card and the
pop-out in the screenshot — confirmed, by checking both, to be a
field-visibility configuration matter rather than a rendering bug:
neither field was in this stage's own configured set at all, so
nothing in the frontend has data to show for them. That part isn't
something this change fixes; it would need the field-visibility
configuration for this stage updated if they're meant to be there.

**What this change does fix** is what an entirely empty column looked
like. `HEADER_SUMMARY_COLUMNS.map()` always produced five `<div
class="hscolumn">` elements before this, one per column, whether a
column matched any configured fields or not — an empty `<div>` is
still one more item for `auto-fit` to divide the row into, which is
what turned "Purchase order and Cost centre aren't configured" into a
wide, unexplained gap rather than a card that simply had four columns
instead of five. Columns with nothing in them are no longer rendered
at all now; one field missing from a column that still has another
reads as a made choice, and a card with fewer real columns reads as
complete rather than broken.

## Why the pop-out was read-only in the first place, and what changed

Decision 0291's own reasoning was correct at the time: the pop-out
listed every configured header field, including every field the
summary card already showed, and `field()` renders a live `<input
id="f-${field}">` — a second one for a field already on the card would
put two elements with the same id on the page, with only one of them
ever read back on save.

**The fix removes the overlap that made that true**, rather than
working around it. The pop-out now lists only genuine overflow —
fields configured for this stage that the curated summary doesn't
already show. Nothing it renders has a second copy anywhere else on
the page, which is what makes calling `field()` directly safe: an
overflow field marked `edit` becomes a real, editable input, respecting
the same `canEditAnything` and per-field visibility every other field
on this screen already respects — "if my user permissions allow" was
already true the moment the duplication was gone.

## The part that would have quietly lost data

`save()` reads a field's value from `document.getElementById`,
wherever in the page that element happens to live, and does not care
how it got there. The pop-out's own inputs used to be deleted from the
DOM on close (`backdrop.remove()`) — meaning anything typed into an
overflow field, then the pop-out closed, then Save pressed later,
would silently vanish, since nothing would be left in the page for
`save()` to find. Closing now hides the backdrop instead
(`popoutBackdrop.hidden = true`), and reopening it re-shows the
existing one rather than building a second — which also matters for
its own reason: a second `field()` call for the same spec on a second
open would be exactly the duplicate-id problem this rewrite exists to
avoid, just deferred to a re-open rather than solved by it.

## What has coverage

Ten tests across the two problems. The empty-column fix: a column that
loses one of its two fields still renders (unchanged case, confirming
no regression) and a column that loses both is dropped entirely,
shrinking the grid from five columns to four. The pop-out: lists only
genuine overflow, never a field the card already shows; an editable
overflow field can actually be typed into and Save picks it up; the
same edit survives the pop-out being closed and Save pressed
afterward, which is the scenario that actually matters and was tested
as its own case rather than assumed to follow from the simpler one;
and reopening the pop-out reuses the same backdrop rather than
building a second, confirmed by checking only one `.backdrop` exists
in the page and that a value typed before closing is still there after
reopening.

Every behavioural claim probed directly: disabling the empty-column
filter, reverting close to `remove()`, and removing the reopen guard
each failed exactly the test written for it, and only that test.

vf-ui: 49 Worker, 364 browser. No migration.
