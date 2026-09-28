# 0538 — The Coding pop-out no longer shows "null" under its heading

**Status: built and tested locally, not yet pushed or deployed.** This
session has no push access, so it is delivered as a git bundle. It
changes `vf-ui` only (`viewer.js`), with no migration.

## What was found

While capturing the Coding pop-out as a "before" for a redesign the
operator asked for, the pop-out showed the word "null" under its
heading on every line that can be coded. 0537 added a read-only note
there as `lockedNote ? el(...) : null`, and the shared `el()` helper
(`tasks.js`) appends every child, so `null` became the text "null".
Lines whose coding is read-only showed the note instead and were not
affected.

## What was decided

- The note is spread in only when there is one, the pattern the rest
  of the viewer already uses. `el()` itself is unchanged.

## Verification

- **`vf-ui` `viewer.test.ts`**: opening a codable line's pop-out on a
  PO invoice shows no read-only note and no "null". It **failed** with
  `viewer.js` stashed (the pop-out's text contained "null"). The other
  0537 viewer tests still pass. Browser 1258/1259 (the known `typography.test.ts` 10px gap), worker 75/75.
