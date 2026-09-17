# 0386 — The pop-out never stopped being the sign-in page's shape

**Status: built.** A follow-on fix to decision 0384, phase 4 of
`docs/design/document-viewer.md`.

---

## What was asked

The operator, with a screenshot of the pop-out window attached:

> the card appears to float in centre screen rather than filling the
> page. Can we have it use all available space, and resize as needed?

---

## The premise, checked before fixing anything

`app.css`'s bare `body`/`main` rules are the sign-in page's own,
narrow and centred — decision 0384's own comment already names this:
*"every page loading this stylesheet inherits them by default (nothing
scopes them to index.html)."* `index.html` gets its own reset
(`#shell`, `#viewer`: `width: auto; padding: 0;`, no cap on either).
`document-window.html` got a reset too, and it was not the same one:

```css
body.docwindowbody { display: block; place-items: initial; background: var(--surface-0); }
#docwindow-root { width: auto; padding: 22px 26px 60px; max-width: 1100px; margin: 0 auto; }
```

`display: block` did stop the sign-in page's `grid; place-items:
center` from centring the box *vertically*. Nothing stopped it
horizontally: `max-width: 1100px; margin: 0 auto` is exactly the sign-in
page's own centring technique, just with a bigger number. Checked
against the rest of this stylesheet before assuming that was
deliberate: **no other page has a width cap anywhere in `app.css`.**
`#viewer`'s own `.columns` grid runs edge to edge at every width down
to 1100px, where it reflows rather than shrinks. `document-window.html`
was the one page capped like a login form.

Height had the opposite problem: nothing gave the pop-out's own root
element a height to fill, so `.panel` sat exactly as tall as its
content and the space below it — sometimes most of the window, on a
tall monitor — was just background, same as the horizontal margins.

---

## What was built

**The cap removed, not raised.** `#docwindow-root`'s `max-width:
1100px; margin: 0 auto` is gone. `body.docwindowbody` is `display:
flex` rather than `block`, with `min-height: 100vh`; the single root
element takes `flex: 1`, which fills the row's width by growing and
the column's height by the flex container's own default
`align-items: stretch` — the same one-line mechanism, not two.

**A flex chain down to the document box, rather than a second fixed
height to guess at.** `.vpreview`'s `height: calc(100vh - 300px)` is a
real number, measured against the *main app's* topbar, tabs and
action row sitting above it — decision 0271's own comment says so.
This page has none of that chrome. Typing a different constant here
would be exactly the mistake decision 0380's own record warns against:
a guessed number standing in for a measurement. `.panel`,
`.docwindowbody`-scoped, is `flex: 1; display: flex; flex-direction:
column`; its own children other than `.cardhead` get `flex: 1;
min-height: 0`; `.vpreview`'s own height is reset to `auto` inside
this page specifically, so flex-grow — not a second calculation —
decides how tall it actually is. Every rule is scoped under
`.docwindowbody`, so the embedded card's own `.panel`/`.vpreview`
elsewhere in the app are untouched.

**Measured, not just reasoned about.** Loaded the page in a headless
Chromium at two window sizes rather than trusting the CSS cascade on
paper. At 1600×900, `.panel` filled to 1520×860 (the viewport minus
this page's own padding, exactly); at 1000×650, 920×610 — the same
arithmetic, confirming it tracks the window rather than a fixed
number. `.vpreview`'s own height moved from 772.6px to 522.6px between
the two, a difference of exactly 250px against a 250px change in
viewport height. Screenshots at both sizes, and in the dark mood the
operator's own screenshot was in, confirm the card now fills the
window rather than floating in it.

**One thing noticed and left alone, worth naming rather than quietly
fixing.** The Timeline / Chat tab, once its own pane stretches to fill
the frame the same way the Document tab's does, leaves visible empty
space beneath the activity feed and its input box — `.activityfeed`
has its own `max-height: 300px` scroll cap (shared with the embedded
card, not new here) and nothing inside that tab grows further to use
the rest of the space. Not a regression this fix caused so much as one
this fix made visible for the first time — before, the whole card sat
small and centred on every tab, this one included. Left as a question
for the operator rather than decided here: growing the feed to fill
the space would touch shared CSS the embedded card also uses.

---

## Tests

CSS-only; no test in this suite asserts on the rules changed, checked
by `grep` before editing, so there was nothing to watch fail here in
the usual sense. Full suites, run together: `vf-ui` browser 665/665,
unchanged (this fix touched no test file). `eslint` clean across the
whole repository. The headless-Chromium measurement above stands in
for a test this project's own jsdom suite cannot make — jsdom lays
out nothing, so a real browser was the only way to check a claim about
pixels rather than about markup.

---

## What is not built

Whether the Timeline / Chat tab's own content should grow to fill the
same space the Document tab now does — noted above, not decided.
