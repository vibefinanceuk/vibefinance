# 0280 — The address, stacked under its own label

**Status: built.**

---

## What was asked

> Please could you move the position of the Seller and Buyer address,
> so that the address appears under the Address title, rather than to
> the right of it. This is screen space I would like to make better
> use of.

A marked-up screenshot with the current position boxed in red on both
cards.

## What changed, and what didn't

`addressBlock()` is shared by both the Seller and Buyer cards, so one
fix reaches both — matching the boxes drawn on both halves of the
screenshot. Every other field on both cards (Name, VAT no, E-address,
E-mail, Phone) keeps its existing side-by-side layout from decision
0221; only the address field itself changes shape.

**A modifier class, not a change to `.sfield` itself.** `.sfield`'s
own 88px-label grid is what every other field on both cards still
uses correctly. Changing it directly would have restacked all six
fields instead of the one that was asked about. `.sfield.address`
overrides just the grid to a single column, leaving the base rule —
and every field still using it — untouched.

## The screen space, put to use

A single grid column means the address lines are no longer sharing
their row with an 88px label column — they get the full width of the
card's own second grid track instead. *United Kingdom of Great Britain
and Northern Ireland*, which wrapped across five narrow lines in the
reported screenshot, now wraps across fewer, wider ones. This is what
"screen space I would like to make better use of" asked for directly,
without inventing an additional restructuring nobody asked about.

## What has coverage

Two tests: one reads the real stylesheet and confirms
`.sfield.address` genuinely overrides the grid to a single column —
probed by deleting the rule and confirming the test fails. The second
renders both cards with a real, long country name and confirms the
`.sfield.address` class actually reaches the DOM on both the Seller
and the Buyer — probed by removing the class from the JS that builds
it and confirming that test, and only that one, fails. Neither test
alone would have caught both classes of regression; together they
check the rule exists and that the markup actually uses it.

vf-ui: 49 Worker, 333 browser. No migration.
