# 0304 — A boundary line between a page's own controls and every screen's own

**Status: built.**

---

## What was asked

> I wondered if you could create a small vertical line, to the left of
> the Night / Day button, which distinguishes the standard set of
> icons, Night / Day, Language & Sign out, from the other page
> specific icons which would appear to the left of the vertical line.

Confirmed from a mock-up first, built against the real `.actionlink`
icon size and the real `.topbar .right` spacing rather than generic
defaults.

## What was built

`.topbardivider` — a 1px rule, 28px tall (shorter than the row itself,
the way a divider inside a menu never touches its own edges) — sits in
`topbar()`'s own `right` array, between whatever a screen passed in
and `moodPicker`/`languagePicker`/Sign out. Placed in `topbar()`
itself rather than in each screen, the same reasoning decision 0108
already gave Sign out and Night/Day: a boundary drawn by one screen
and not another is one screen a person has to relearn.

**Conditional on `right.length > 0`, not always drawn.** Flagged
before building: most screens — Documents, Suppliers, Tasks itself —
pass nothing of their own into `topbar()`'s third argument, and a rule
with nothing to its left is a stray mark, not a boundary. Only the
viewer (Back, and since decision 0298 its own Save and task actions)
and the dashboard (Arrange, and since decision 0303 what it unhides)
currently draw one.

**A genuine, adjacent bug, caught while building this and fixed
first.** `right`'s own array could already end with a `null` — the
divider itself is conditional — and `el()`'s `node.append(child)`
treats `null` as the literal three-character string to append, not as
"nothing." The array closing `.right`'s own children needed
`.filter(Boolean)`, which it had never needed before since nothing in
it had ever been conditional.

## What has coverage

Two tests, one per direction, each against a real screen rather than
a synthetic fixture: the Tasks screen's own topbar (no third argument
to `topbar()` at all) shows no `.topbardivider`; the dashboard, once
Arrange is showing, does. Both probed directly — removing the divider
entirely fails the dashboard's own test, and rendering it
unconditionally fails Tasks's own test — confirming each checks the
direction it claims to, not just that a divider exists somewhere.

vf-ui: 49 Worker, 387 browser (was 385). No migration.
