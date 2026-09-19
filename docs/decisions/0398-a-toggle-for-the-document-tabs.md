# 0398 — A toggle for the document tabs

**Status: built, not yet pushed.** Third of the four decisions from
0395's sequence — the Document tab row, narrow and independent, as
agreed.

---

## What was asked

Decision 0395 set out the four pieces borrowed from
e-invoicingcompliancecorner.com. This is the third: *"the style of
the arrivals board tab feature, which could be applied to our own
document image / timeline chat tab"* — the reference site's own
"Arrivals board / List view" toggle, a filled, fully rounded
segmented control, applied to the Document/XML/Timeline & Chat row.
Narrowed early to exactly this row and nothing else — the operator's
own correction, back when the first pass mocked up a whole theme:
*"i did not necessarily want to capture the arrivals board theme,
moreso... the style of the arrivals board tab feature."* Day and
Night both, the fifth requirement that ran across all four pieces.
Icons unchanged, per *"one thing i like in our current design is the
icons. they should stay."*

Approved in the mock-up canvas as `DocTabs.dc.html`, and shown again
inside the fuller `ValidationScreen.dc.html` mock-up in place.

---

## What was built

**Styling only — no JS file touched.** `buildDocTabs()` in `viewer.js`
already builds `.doctabs`/`.doctab`/`.doctab.on`/`.activitycount`, the
same four class names before and after; `document-window.js`'s own
pop-out window calls the same function (decision 0367's own reasoning
for why it is shared at all), so it picks up the same restyle with no
change of its own.

`.doctabs` becomes the pill: `background: var(--surface-1)`, a
0.5px border, `border-radius: 999px`, `padding: 3px`, tabs spaced by a
2px gap rather than the old 18px margin — each tab's own `6px 14px`
padding is what now gives the row its rhythm, the way the mock-up's
own tabs read. `.doctab` drops its bottom-border-as-underline entirely
(`border: 0.5px solid transparent` in its place, ready to be filled)
and its text sits muted (`--text-muted`) until active. `.doctab.on`
fills that border with `--border-strong`, lifts onto `--surface-2`,
and picks up a new `--tab-active-shadow` token — `0 1px 2px
rgba(18, 26, 38, 0.12)` in Day, `none` in Night, since the same shadow
that reads as depth on a light surface is either invisible or a smear
on a dark one; a token rather than a literal so Night's own right
answer (no shadow, not a different one) lives in `tokens.css` beside
every other mood-specific value rather than as a rule nobody would
find. `.activitycount`, the timeline's own unread count, moves from a
neutral grey pill to `--bg-accent`/`--text-accent` — the same accent
already used for the active document tab's badge in the mock-up,
rather than a colour invented for this one badge.

**A separate component from `.tabbar`/`.tab`, decision 0333 —
deliberately, not by oversight.** `.tabbar` is the Access screen's own
Organizations/Roles/Teams/People switcher, and that decision's own
case for underline-only — *"no pill background, no card wrapper, so
it reads as navigation within the page rather than another set of
actions"* — was made for a row of *sections*, each a different piece
of one screen. Document/XML/Timeline & Chat are not sections of a
page; they are views of one thing, closer to the reference site's own
toggle than to what `.tabbar` is for. The two now carry different
shapes on purpose, and a test guards `.tabbar` staying exactly as
decision 0333 left it, so a future pass at "make the tabs consistent"
finds the reasoning here rather than reopening it from nothing.

Rendered against the real, unmodified stylesheet with Playwright
before being called done — the actual markup `buildDocTabs()` builds
(the doctabs row plus the Expand action, inside `.cardhead`, exactly
as `documentPanel()` returns it), Day and Night both. Decisions
0396/0397's own `align-items: flex-end` and the compacted
`.cardhead > .actionlink` already apply to this exact row (its
`.cardhead` has no `h3`, just the tabs and Expand — the tab row *is*
this card's own head), so the two sat correctly aligned with no
further change needed there.

---

## Tests

`test-browser/typography.test.ts` — a new `describe` block: the pill
container's own background/radius, the active tab's lift, the shadow
token shipped in both moods, the badge's new accent colours, and that
`.tabbar` carries neither a `border-radius` nor a `background` —
guarding decision 0333's own shape rather than merely leaving it
alone by accident. `test-browser/mood.test.ts` — `--tab-active-shadow`
added to the existing "says the same thing twice" duplication loop,
and a new test that Day's value and Night's `none` are each exactly
what is expected, the same shape 0395's own danger-trio tests used.

Watched to fail first: `app.css` and `tokens.css` stashed, test files
kept, suite run against the pre-change files — 5 of 55 combined tests
failed (the shadow-token test in `mood.test.ts`, four of the five new
`typography.test.ts` assertions); the fifth new typography test
(`.tabbar` left alone) and the duplication-loop test both passed
vacuously, the same shape every prior decision's fail-first check in
this file has taken. Restored, reran, 55/55.

Full suites: vf-ui 74 Worker + 702 browser (696 pre-existing + 6 new),
both passing. `eslint` clean. `scripts/check-citations.py` clean (398
records). Touches `vf-ui` (`public/app.css`, `public/tokens.css`,
`test-browser/typography.test.ts`, `test-browser/mood.test.ts`) only
— no change to `viewer.js`, `document-window.js`, `icons.js`, or any
other JS file, and no change to `vf-app`, `vf-admin` or `vf-licence`.

---

## What is not built

Piece four — red/amber/green severity on the validation screen's key
fields and exceptions list — is the one remaining piece, and still
needs the same investigation 0395/0396/0397 all deferred: whether
"mismatch" and "needs review" already exist as separate claims
anywhere upstream of the validation screen, or whether that
distinction has to be added there first. Not yet started.

This is the narrowest of the four pieces by design — one component,
two files — so unlike 0396 it did not get its own dedicated round of
"look at it live across several screens" before being written up here;
that first look is expected to happen the same way it did for 0396,
and any correction it turns up would be recorded the way 0397 was.
