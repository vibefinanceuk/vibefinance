# 0234 — The supplier actions

**Status: built.** Hold, release, activate, deactivate and save, as
buttons with icons.

---

## Four of the five glyphs already existed

**`save`** — a down arrow into a tray — and **`activate`** — a toggle
switch — are both from the rules screen (migration 0023). **Saving is
saving, and activating a supplier is the same verb as activating a
rule**, so the strings are reused rather than redefined: two keys for
one word is two places for a translator to disagree with themselves.

---

## Hold and release are pause and play

**A hold is temporary and reversible.** Payment stops while something is
disputed, and resumes.

**A stop square would say *finished*.** A raised hand would say
*refused*. Neither is what a held supplier is.

---

## Deactivate is activate, mirrored

The same toggle with the knob on the other side.

**A pair a person reads without learning anything**: one is the other,
reversed. A slashed circle or an archive box would have been a second
idea to hold.

---

## And each pair replaces the other

> Release Hold and De-activate buttons which appear interchangeably when
> others are selected.

**Which is the honest shape.** A held supplier cannot be held again, and
offering both would make somebody read two buttons to find the one that
applies.

---

## `actionLink` is now shared

It lived in `viewer.js` and was not exported. **A second copy would
drift**, and the first thing to drift would be the `title` attribute —
which is the part that makes an icon legible, and the part decision 0161
called out as *"an icon alone is a guess."*
