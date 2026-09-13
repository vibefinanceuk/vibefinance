# 0294 — A broken Close button, a header row, and the same [hidden] bug found twice

**Status: built.**

---

## What was reported

> 1) Can you list the field in a single row stacked, with field name
> on the left and field value on the right... 2) The Close button does
> not work currently. So when I open the pop-out, I cannot get away
> from the screen unless I refresh the browser. 3) Please can you move
> the fixed close button to the top right of the pop-out... 4) Does the
> pop-out need a save button?

## The broken Close button — the same bug found twice

`.backdrop { display: flex }` and the browser's own default `[hidden]
{ display: none }` land at equal specificity, and the author's own
rule wins the tie — the exact pattern decision 0271 already found and
fixed once, in a completely different element
(`.activitytabcontent`). `popoutBackdrop.hidden = true` was setting
the attribute correctly the whole time; nothing was reading it,
because `.backdrop` itself never yielded to it. The person clicking
Close saw nothing happen, because visually nothing did.

**This bug is new to decision 0292, not inherited from before it.**
The Supplier screen's own pop-out — the pattern this one was built to
match — has never hidden anything; it only ever removes the backdrop
from the page entirely on close, which never runs into this at all.
Deciding to hide rather than remove (so `save()` could still find a
field's value after the pop-out closed) introduced a genuinely new way
for `[hidden]` to matter here, and nothing checked whether it still
worked. Fixed with `.backdrop[hidden] { display: none; }`, the same
fix decision 0271 already used.

## The header row

"Close" moves from its own row at the foot of the pop-out into the
same header row as the title — top right, matching Change Seller,
Change Buyer, and Header Fields itself. Not built with `cardHead()`
directly: that helper gates its own action on `canEditAnything`,
correct for a real edit and wrong here — closing has to stay reachable
even when nothing on the page can be edited, the same reasoning
"Header Fields" itself already carries.

## The field layout

Each field is now its own row — name on the left, value or entry box
on the right — rather than `field()`'s own default of a label stacked
above its control. Scoped to `.hffields .kf` specifically, not `.kf`
itself: `field()` is shared with the curated summary card and the
Seller card's own unmatched-state fallback, and changing its default
layout would have changed both of those too. A field that can be
edited still renders its own real `<input>`, exactly as before — only
where it sits in the row changed.

## Whether the pop-out needs its own Save

It doesn't, and this is worth being direct about rather than adding
one by default. `save()` reads a field's value from
`document.getElementById`, wherever in the page that element actually
lives — the main form's own Save button already covers every editable
field the pop-out shows, the same way it already covers the summary
card's own fields, because both live in the same page and neither is
treated specially. Adding a second Save inside the pop-out would mean
either two buttons doing the exact same thing, or one of them doing
something narrower in a way that would need its own explanation. If
there's a reason to want one anyway — confirming an edit landed before
navigating elsewhere, say — that's a real, separate request rather
than something this pop-out was missing by omission.

## What has coverage

Three new tests: the `.backdrop[hidden]` rule exists in the real
stylesheet, checked directly rather than inferred from the bug
description; Close renders inside the pop-out's own header rather than
a footer row; and each field renders as a `.kf` row inside `.hffields`.
Each probed by reverting the specific fix and confirming exactly that
test, and no other, fails.

vf-ui: 49 Worker, 368 browser. No migration.
