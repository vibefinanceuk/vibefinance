# 0529 — Night's chart and menu colours apply when Night is chosen, not only when the computer is dark

**Status: built and tested locally, not yet pushed or deployed.** This
session has no push access, so it is delivered as a git bundle. It
changes `vf-ui` only (`tokens.css`), with no migration and no string
change.

## How it was found

Mocking up the Matching stage's PO panel, the operator said the "Already
invoiced" and "This invoice" colours on the used-up bar were hard to tell
apart. Checking the mock-up in Night showed the Day chart blue
(`#1f6fb2`) where Night's own (`#4da3f0`) should have been.

## What was found

`tokens.css` states Night twice, on purpose: once in
`@media (prefers-color-scheme: dark)` for a dark computer, and once in
`:root[data-mood="night"]` for someone who picks Night from the app.

- **The chart palette (0242, 0247) was only in the first.** Decision
  0247 pasted it a second time inside the media query, where the chosen
  block was meant to be.
- **Decision 0527's menu colours followed the same pattern**, so they
  landed in the media query twice as well. 0527's own test counted
  three definitions of each and passed.
- **So:** choosing Night on a computer set to light mode kept Day's
  chart colours (every dashboard and analytics chart) and Day's menu
  colours. A computer already in dark mode was unaffected.
- **The parity test ("says the same thing twice, and they agree")**
  checks a fixed list of tokens, and the chart palette was never on it.

## What was decided

- The misplaced second copy in the media query is removed.
- `--chart-1…5` and `--nav-1…5` are added to `:root[data-mood="night"]`,
  with the same values as the media query.
- The parity test now checks all ten, and fails if a token is missing
  from the media query as well as if the two differ.

## What was verified

- **`mood.test.ts`:** the extended parity test **failed** with
  `tokens.css` stashed and passes with it.
- **In Chromium:** with `data-mood="night"` on a light-mode page,
  `--chart-1` now computes to `#4da3f0` (was `#1f6fb2`).
- **`vf-ui`**: Worker 75/75. Browser 1217/1218. The one failure is the
  known `typography.test.ts` hardcoded-`10px` gap.
