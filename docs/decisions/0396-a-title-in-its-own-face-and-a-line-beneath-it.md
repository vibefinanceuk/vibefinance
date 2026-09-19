# 0396 — A title in its own face, and a line beneath it

**Status: built, not yet pushed.** Second of the four decisions from
0395's sequence — the two genuinely global pieces, together, because
both touch every screen.

---

## What was asked

Decision 0395 set out the four pieces borrowed from
e-invoicingcompliancecorner.com and the order agreed to build them in:
tokens first, then this pair, then the document tab row, then the red/
amber/green severity work last. This decision is that pair:

1. A bold condensed heading treatment for panel titles, in a single
   accent colour.
2. A full-width rule beneath every card title — asked for directly,
   after seeing the first mock-ups: *"could you also introduce a
   horizontal line running the width of each card beneath the card
   title in the mock-up?"*

Both had to hold in Day and Night time, the same requirement that ran
across all four pieces in 0395.

Both were designed and approved as mock-ups first, in a canvas built
with the operator directly (outside this repository) — including a
fuller mock-up of the real validation screen, at the operator's own
request, showing all three visual pieces together inside the actual
page layout: Seller, Buyer, Invoice header, Document, Line items and
Exceptions. What follows is that approved design, applied to the real
stylesheet.

---

## What was built

**A second typeface, for titles only.** `tokens.css` now ships Big
Shoulders Display the same way decision 0124 shipped Carlito: an
`@font-face` naming the file rather than hoping a machine already has
it, `font-display: swap` so nobody waits on it, SIL OFL licensed. One
weight only — the mock-up used exactly `wght@800`, and nothing in this
interface asks for any other weight of it, so only 800 was shipped
(14.6KB). A new `--font-heading` token holds it, falling through to
`--font-sans` rather than to a bare `sans-serif`: `--font-sans` is
still the only opinion the app has about its body face, and this adds
a second one for exactly one purpose rather than replacing the first.

**Every panel title: bold, condensed, uppercase, in
`--heading-accent`.** `.panel > h3` — already the rule giving bare
panel titles (the Line items and Exceptions cards, the compose
screen's own panels, and others) their styling — was extended, and a
new `.panel > .cardhead > h3` rule added alongside it for the titles
that carry an action beside them (Document's Expand, Seller's Change
seller, the Access page's list sections, and others). Both now set
`font-family: var(--font-heading)`, `font-weight: 800`,
`text-transform: uppercase`, `letter-spacing: 0.2px`, and
`color: var(--heading-accent)`. Font size moved from `--text-base` to
`--text-lg` — which has read *"Panel headings, a document's identity"*
in its own comment since decision 0124, without anything actually
using it for that until now.

**A rule beneath every card title.** `.panel > h3` and
`.panel > .cardhead` (the row, not just the text, so the line clears
an Expand or Change-seller action sitting beside the title too) both
get `border-bottom: 1px solid var(--border-strong)` and a
`padding-bottom`/`margin-bottom` of 10px/12px, matching the approved
mock-up's own `.vf-hr` spacing. No new markup: every card already had
exactly one element in this position, so this is a CSS-only change.

**Scoped to `.panel`'s own direct children, not bare `.cardhead`.**
`.cardhead` is shared with every "Save"/"Close" pop-out dialog —
access.js, sources.js, suppliers.js, processes.js and
purchase-orders.js all build one — and a dialog is not a card;
`.panel > .cardhead` (not `.cardhead` on its own) is what keeps this
off every one of those titles. The same scoping keeps it off the
dashboard's own KPI tiles without needing to name them: `card-narrow`
wraps its `cardhead` inside `.tilefg`, so it is never a *direct* child
of `.panel`, and the tiles keep the quieter, undecorated titles
decision 0242 gave them on purpose — a coincidence of the existing
markup, not a new exclusion rule written for this.

One panel this does not yet visibly touch: the Exceptions card
(`.panel.exceptions`) has been hidden since decision 0119, at the
operator's own request, without its code being removed. This rule
still applies to it — nothing here changes that visibility — so the
title styling is in place and inert until whatever re-enables it,
which is likely part of the fourth piece still to come.

---

## Tests

`test-browser/typography.test.ts` — the file that already owns every
other claim about fonts and panel titles — got a new
`describe("a card's own title, and a rule beneath it (decision 0396)")`
block: that the font is shipped and not merely named, that
`--font-heading` falls through to `--font-sans` rather than standing
alone, that both new selectors carry the face/colour/transform
together, that the divider uses `--border-strong`, and that the bare
`.cardhead { }` rule — the layout every pop-out dialog head still
relies on — carries neither the accent nor the second face.

Watched to fail first: `app.css` and `tokens.css` stashed (the new
font file and the test file itself kept), suite run against the
pre-change files — 4 of 30 typography tests failed, exactly the four
new assertions about the shipped face, the token, and the two new
selector rules; the fifth new test (the exclusion from bare
`.cardhead`) passed vacuously, since the old rule never carried the
accent either. Restored, reran, 30/30.

Full suites: vf-ui 74 Worker + 691 browser (686 pre-existing + 5 new),
both passing. The pre-existing `document-window.test.ts` stub-fetch
unhandled-rejection noise is the same one decision 0395 already
confirmed present on `origin/main` independent of this change.
`eslint` clean. `scripts/check-citations.py` does not scan `.css`
(same note as 0395); this record exists so the citation inside
`typography.test.ts` resolves.

Touches `vf-ui` only (`public/app.css`, `public/tokens.css`,
`public/fonts/big-shoulders-display-latin-800-normal.woff2`,
`test-browser/typography.test.ts`) — no change to `vf-app`,
`vf-admin` or `vf-licence`.

---

## What is not built

The document tab row (piece three) and the red/amber/green severity
work (piece four) are unchanged — next in the agreed sequence, tab row
first since it is narrow and independent, severity last since it still
needs a look at whether the exception data already carries a
mismatch/needs-review distinction before any UI work can promise one.

No screen was individually reviewed after this change beyond the
stylesheet and its own tests — this is the widest-blast-radius piece
of the four by design, touching every panel title across every screen
at once rather than one screen at a time, and a visual pass across the
app (the "widest visual regression check" 0395 flagged this pair as
needing) has not been done as part of this record.
