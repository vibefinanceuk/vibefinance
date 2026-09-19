# 0399 — One pill for every tab

**Status: built, not yet pushed.** A direct follow-on to 0398, asked
the same day it shipped: the Access screen's own tabs — Org Units,
Roles, People, Teams — restyled to match.

---

## What was asked

*"Please could the most recent tab select update to pill box, also be
applied to the tabs in the Access screen. There are tabs for Org
Units, Roles, People and Teams."* Decision 0398 restyled the Document
tab row (`.doctabs`/`.doctab`) as a filled, fully rounded segmented
pill; this asks for the same treatment on the Access screen's own
switcher, `tabBar()` in `access.js` — `.tabbar`/`.tab`/`.tab.active`,
the class names decision 0333 gave it.

**This reverses part of 0333's and 0398's own stated reasoning, on
purpose, not by oversight.** 0333 built `.tabbar` underline-only —
*"no pill background, no card wrapper, so it reads as navigation
within the page rather than another set of actions"* — and 0398's own
comment repeated that case for keeping the two components apart,
reasoning Document/XML/Timeline & Chat are *views of one thing* where
Org Units/Roles/People/Teams are *sections of a page*. The operator's
own direct request supersedes that distinction rather than being an
oversight of it — recorded in `SUPERSEDED.md` rather than quietly
edited away, the same discipline every prior reversal in this project
has followed.

---

## What was built

**Styling only — no JS file touched.** `tabBar()` in `access.js`
already builds `.tabbar`/`.tab`/`.tab.active`, the same three class
names before and after; `.tabbar` is used nowhere else in the app
(confirmed by grep), so restyling it in place touches nothing but the
Access screen.

`.tabbar` picks up the exact shape `.doctabs` already has: `display:
flex`, `gap: 2px`, `background: var(--surface-1)`, a `0.5px` border,
`border-radius: 999px`, `padding: 3px`. `.tab` drops its
bottom-border-as-underline for a `0.5px solid transparent` border
matching `.doctab`, padding `6px 14px`, muted text until active.
`.tab.active` fills that border with `--border-strong`, lifts onto
`--surface-2`, and reuses `--tab-active-shadow` — 0398's own token,
not a second one invented for the same job: the same reasoning that
token was built for (a shadow reads as depth on Day's light surfaces,
either invisible or a smear on Night's dark ones) applies exactly as
much here as it did to the Document tabs, so there is nothing this
decision needs to add to `tokens.css`.

Rendered against the real, unmodified stylesheet with Playwright
before being called done — the actual `.tabbar`/`.tab`/`.tab.active`
markup `tabBar()` builds, Day and Night both. Both read correctly: the
active tab lifts with a visible shadow in Day, and reads by contrast
alone (no shadow) at Night, exactly as the Document tabs already do.

---

## Tests

`test-browser/typography.test.ts` — the old test guarding `.tabbar`
as underline-only (decision 0333's own separateness, added at 0398) is
replaced with a new `describe` block mirroring the Document-tabs
tests: the pill container's own background/radius, the active tab's
lift (background, shadow, text colour), and that the existing
`--tab-active-shadow` token is the one reused, not a new one. The
`.doctabs` block's own comment in `app.css` is updated to say plainly
that the separation it once explained no longer holds, rather than
leaving a stale rationale beside a component that no longer follows
it.

Watched to fail first: `app.css` stashed, test file kept, suite run
against the pre-change file — 2 of 3 new assertions failed (the pill
background/radius check, the active-tab lift check); the third
(reusing the existing shadow token) passed vacuously, since that token
already shipped at 0398 and this decision adds no new one. Restored,
reran, full pass.

Full suites: vf-ui 74 Worker (unchanged) + 704 browser (702
pre-existing + 2 net new — one old test removed, three added).
`eslint` clean. `scripts/check-citations.py` clean (399 records).
Touches `vf-ui` (`public/app.css`, `test-browser/typography.test.ts`)
only — no `tokens.css` change, no JS file, no other Worker.

---

## What is not built

The four-piece sequence from decision 0395 (tokens, heading treatment,
document tabs, red/amber/green severity) is unaffected — piece four is
still pending the same upstream investigation it always was. This
decision is a direct, single follow-on request about consistency
between two already-shipped pieces, not a fifth piece of that
sequence.
