# 0286 — The mood control, toggled rather than picked

**Status: built.**

---

## What was asked

> Would it be possible to change the theme button which allows Night
> time or Day time, to change to have an icon, reflecting night or day
> perhaps? So it is the same size and width as other buttons. We can
> trim the text to read "Night", or "Day" to reduce text width.

## Why a `<select>` couldn't do this

A native `<select>` cannot show a custom icon inside its own closed
state — only the browser's own default arrow. With only two options,
the deeper problem was the shape itself: a dropdown reads as a
dropdown beside a row of plain buttons, whatever the label says.
Rebuilt as a genuine `.actionlink` button — the same class Sign out
and Back already use — showing the current mood and flipping to the
other on click. Two states need no menu to hold them both.

**`select.mood`'s own CSS is gone, not left dangling.** `.actionlink`
already carries the "quieter than the actions beside it" look decision
0139 gave the select — transparent background, muted text — so the
rule this button used to need doesn't exist for the new one to need
too.

**A new icon per mood, not a static one.** A sun for day, a crescent
moon for night, swapped in place on every click alongside the label —
the button's own appearance is the current state, not just the text
beside it.

## The wording

"Day time" and "Night time" shortened to "Day" and "Night," the
operator's own request, via the established `UPDATE ui_strings`
pattern in both languages. `mood.label` ("Mood") is left exactly as it
was — decision 0071's own precedent, a string kept even once nothing
in the code reads it.

## Built without a new circular import

`moodPicker()` still builds its own DOM with `document.createElement`
rather than `tasks.js`'s `el()` helper, the same reasoning decision
0283 already gave for Sign out: `tasks.js` imports `moodPicker` from
this file, so importing anything back the other way would be
circular. `icon()` from `icons.js` is safe to import — that module
depends on nothing.

## What has coverage

The two tests that were written against the old `<select>` API
(`.options`, a `change` event) could not survive as written — a button
has neither. Rewritten rather than deleted: one confirms the button
carries the shared `.actionlink` class (what actually makes it "the
same size and width as other buttons," not merely styled to look
similar), starts on the system's own mood, and shows a genuinely
different icon after being clicked — not the same mark rendered twice.
The other confirms clicking it actually applies the new mood to the
document. Both probed directly: forcing the icon to stay fixed, and
changing the button's own class away from `.actionlink`, each caught
by exactly the test meant to catch it.

vf-ui: 49 Worker, 342 browser. vf-licence: 320.
