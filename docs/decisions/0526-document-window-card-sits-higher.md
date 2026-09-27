# 0526 — The document window's card sits higher, with its bottom on screen

**Status: pushed (`c49c39c`) and `vf-ui` deployed, as confirmed by the operator on 27 September.** It
changes `vf-ui` only (`app.css`), with no migration and no string
change.

## What was asked

Reported live, with a screenshot of the expanded document window:

> can you adjust the spacing at the top of the expanded document viewer
> window, to reduce the space at the top, and move any reclaimed space
> to the bottom of the screen. Right now the card sits a little low

## What was found

Measured in Chromium against the real stylesheet (1000×580 window):

- `tokens.css`'s bare `body` rule gives every page `padding: 2rem 1rem`.
  `body.docwindowbody` reset the sign-in page's `display` and
  `place-items`, but not this padding.
- `body.docwindowbody` is `height: 100vh` with the default
  `content-box` sizing, so the padding sat *outside* that height. The
  body was 644px tall in a 580px window.
- So the card started 52px from the top (32px of page padding plus
  20px of `#docwindow-root`'s own), and its bottom ran past the window,
  cut off by 0505's `overflow: hidden`. That is why it "sits low".

## What was decided

- **`body.docwindowbody` gets `padding: 0`.** The window is now exactly
  one screen tall.
- **`#docwindow-root`'s padding is now `12px 24px 20px`**, from
  `20px 24px`. Less above the card than below, as asked; the sides are
  unchanged.

After the change, in the same window: the card starts 12px from the
top (was 52px) and ends 20px above the bottom (was cut off).

## What was verified

- **`document-window.test.ts`:** a new test reads the real stylesheet
  for `padding: 0` on `body.docwindowbody` and `12px 24px 20px` on
  `#docwindow-root`. It **failed** with `app.css` stashed. 0505's
  height test still passes.
- **Browser suite:** 1213/1214. The one failure is the known
  `typography.test.ts` `10px` gap.

## Not changed

The main app's own shell (`body.working`) was not touched; this
decision is only the pop-out document window.
