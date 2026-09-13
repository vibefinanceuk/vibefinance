# 0303 — Arrange, and what it unhides, moved into the topbar

**Status: built.**

---

## What was asked

> On the Dashboard page - Please can you move the Arrange button to
> the top right, next to the left of the Night / Day button. When the
> Arrange button is pressed, it unhides Done arranging, Add a card,
> and Back to the default. These buttons should also display on the
> top right.

## What was built

All three buttons — Arrange (becoming Done arranging), Add a card, and
Back to the default — used to render in a row of their own, `.actionrow`,
directly beneath the dashboard's own heading. Extracted into
`arrangeButtons()` and passed into `topbar()`'s own `right` parameter:
`topbar(t("dash.heading"), t("dash.sub"), arrangeButtons())`, the same
mechanism decision 0298 already used to move the viewer's own Save
and task-action buttons into its topbar, beside Back.

**Left of Night/Day by construction, not by placement.** `topbar()`
renders whatever `right` array it is given first, followed by
`moodPicker`, `languagePicker`, and Sign out — so passing these three
buttons as `right` puts them to the left of Night/Day without needing
a new insertion point or a change to `topbar()` itself.

**No code duplicated.** `toolButton()`, the shape decision 0262 gave
these buttons to match the viewer's own `.actionlink` family, was
already a standalone function; only the row it was building things
into changed, not how any individual button is built.

## What has coverage

The existing "shows no handles until asked" test already found Arrange
by its own text content, scoped to nowhere in particular — it kept
passing through this change without needing an edit, since it never
checked where the button lived. Two new tests check that specifically:
one confirms Arrange sits inside `.topbar .right`, ahead of whichever
mood button is currently showing, and that no `.actionrow` anywhere on
the page still mentions it; a second confirms Add a card and Back to
the default both appear in the same topbar once arranging starts.
Building the first test surfaced a real, separate gap in this file's
own string fixture — `mood.day` and `mood.night` were never defined
here, so every mood-button title read as the untranslated key and the
test failed for a reason that had nothing to do with the change being
tested. Fixed in the fixture, not worked around in the assertion. Both
new tests probed directly: reverting the buttons to a standalone
`.actionrow` fails both, for the reasons each was written to catch.

vf-ui: 49 Worker, 385 browser (was 383). No migration.
