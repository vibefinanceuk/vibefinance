# 0338 — A Column of Their Own

**Status: built.** "The Icons can fall into a separate column to the
right of their current respective field, else the row height will
get too large." Reported live with a real screenshot: decision 0337's
own icon-and-label buttons, stacked beneath a cell's own text rather
than beside it, grew every row tall enough to fit both — visible the
moment real data (a person holding several roles) made the difference
obvious.

---

## The fix

Two more columns, not a different icon or a smaller one: "Roles" and
"Properties" each move into their own `<td>`, immediately to the
right of the field they act on, rather than sharing a cell with that
field's own text. The People table is five columns now — Person,
Roles held, (the Roles action), Approval limits, (the Properties
action) — where it was three. The two new header cells are
deliberately blank (`t("")`, which already falls back to the key
itself, `""`, needing no new string): the column exists for an icon a
person already understands from the row it sits in, not a label
repeating what the row already says.

Nothing about which permission gates either action, what each pop-out
holds, or how either one is reached changed — only where the button
itself sits in the row.

## What has coverage

Every existing test for this screen kept passing with no changes at
all: they search for a button by its own text within the row, not by
which cell holds it, so the structural move underneath them was
invisible to what they check. One new test locks the fix in
specifically — the Roles action sits in a different `<td>` than the
roles-held text, and that text's own cell holds no button at all —
probed directly by reverting to the old, combined-cell structure,
which correctly failed exactly this test.

`vf-app`: unchanged (frontend-only). `vf-ui`: 63 Worker (unchanged),
496 browser (was 495).
