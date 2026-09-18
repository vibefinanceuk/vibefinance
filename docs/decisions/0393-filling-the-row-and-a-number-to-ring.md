# 0393 — Filling the row, and a number to ring

**Status: built, not yet pushed.** Corrects two real bugs in decision
0392's own work, and reverses part of decision 0387. This session has
no push access to `origin/main`; delivered as a bundle for the
operator's own pull/push/deploy sequence.

---

## What was asked

Against a screenshot of the deployed decision-0392 layout:

> 1) Align the reduced Document card in the Validation screen, which
> includes "Bring to Front", and "Show here instead" buttons. Evaluate
> the panel height, so that the height matches the height of the
> Process card (to the left). 2) Change the "Bring to Front", and
> "Show here instead" buttons, so that they appear on the right of the
> card in square format, similar to the "Header Fields" button. 3)
> Move the text "Open in a separate window" text to the left, and
> change to read "Document open in a separate window" 4) Change the
> Seller and Buyer cards, so that 2 digit country code appears next to
> the City, on the same line. 5) Reintroduce the Phone: from the
> supplier record to appear below the address field. 6) Change the
> height of the Seller and Buyer card, so that the bottom edge aligns
> with the bottom of the Invoice Header card (when the document image
> is expanded only).

---

## The premise, checked before building anything

A Playwright harness — the same pattern as every prior layout decision
this session — mounted the real production code with a realistic
supplier, buyer and header (enough header fields to genuinely fill its
own two columns, and process stages so Process has real content
rather than nothing), popped the document out, and measured.

**Two genuine bugs confirmed, not assumed.** The placeholder's own
panel measured 44px against Process's 90px — parts 1 and 2's premise
was real. Seller and Buyer measured 244px each while Header measured
421px — part 6's premise was real too, a 177px gap the screenshot
already showed.

**The cause, once traced, was the same shape twice.** Before decision
0392, `.c-document` was unconditionally `position: absolute` (decision
0391), which removes a grid item from the row-sizing algorithm
entirely — it never contributed to row 1's height, and Process's own
panel was always exactly that row's height because it was the row's
only real content. 0392 made `.c-document` a genuine, `position:
static` participant in that row for the first time, and — reasoning
at the time that it needed "neither... a height matched to anything
else" — left its own visible panel at `height: auto`. That reasoning
did not survive a real render: `align-items: stretch` (0388) still
stretches the *outer* grid item (`.c-document`) to the row's real
height regardless, but nothing told the *panel inside it* to fill that
now-taller box, so the badge sat short with a gap beneath it. The
identical shape, once traced, explains part 6: `align-items: stretch`
already stretches `.c-parties` (the outer grid item) to match
Header's row, but nothing told `.parties` — its own child, and the
thing that actually draws Seller and Buyer's borders — to fill it.

**A third instance, found only by re-measuring after fixing the
first.** Giving Document's own panel `height: 100%` did not, on its
own, make it match Process — it made *both* cards fill the row, and
the row's own height is whichever side's *content* is taller. With a
realistic placeholder (badge text plus two buttons) the row can now be
*taller* than Process's own natural content, which left Process's
panel short instead, the same bug moved to the other side. Process's
own panel needed the identical `height: 100%` fix Document's got, so
whichever side turns out to be taller, the other one still fills the
row.

---

## What was built

**Parts 1 and 6 — the height-matching chain, both directions.**
`#viewer .columns.docpoppedout .c-document > .panel:not(.exceptions)`'s
own override (`height: auto; display: block;`, decision 0392) is
deleted outright rather than replaced: removing it lets the *general*
`.c-document > .panel:not(.exceptions)` rule — already `height: 100%`
with `flex: 1` on its own non-`.cardhead` children, written for the
three-row docked case — apply here too, since nothing more specific
competes with it once the override is gone. `#viewer
.columns.docpoppedout .c-process > .panel` gained the matching `height:
100%; box-sizing: border-box;` for the reason above. `#viewer
.columns.docpoppedout .c-parties > .parties` gained `height: 100%` —
`.parties`'s own internal grid (decision 0179's own comment: "its
panels stretch to the same row height") then stretches Seller and
Buyer to fill it without any further rule. All three are scoped to
`.docpoppedout` alone: docked, Process/Document and Parties/Header are
never in the same row (0388's own base areas), so there is nothing
this could affect there, and — asked for directly, "when the document
image is expanded only" — nothing should.

**Parts 2 and 3 — the badge's own layout.** `.vpreview.vpoppedout
.vthumb` changes from a `flex-direction: column; align-items:
flex-end` stack (decision 0392) to a `flex-direction: row;
justify-content: space-between` row: two children, text and actions,
one at each end, rather than one child told to hug an edge.
`.vpoppedoutactions .actionlink`'s own row-format override (decision
0392: `flex-direction: row; min-width: 0; padding: 0; gap: 4px;`) is
deleted entirely rather than replaced — with it gone, the two buttons
fall through to the shared, unmodified `.actionlink` rule every other
cardhead action (including "Header Fields") already uses, which is
exactly the square, icon-above-label format asked for. The text
itself — "Open in a separate window" becoming "Document open in a
separate window" — is a wording change, not a layout one: nothing in
`viewer.js` or `app.css` decides it, `ui_strings` does (migration
0122, below).

**Part 4 — the address line.** `addressBlock()` joins `party.city` and
`party.country` with `", "` into one line before either reaches a
`<div>`, rather than each keeping its own. `party.postalCode` stays a
separate line beneath — not part of what was asked.

**Part 5 — Phone, back beneath the address.** Decision 0387 dropped
Phone along with E-address and E-mail to give the card back a column;
`s.phone` / `b.phone` never stopped being fetched onto
`stored.supplier` / `stored.buyer`, 0387 simply stopped reading them.
`pair(t("viewer.supplier.phone"), s.phone)` (and the Buyer's `b.phone`
equivalent) is added back as the last row in `.sellergrid`, after
`addressBlock()` rather than before it as it sat pre-0387 — the
vertical position asked for this time. `pair()` itself always renders
a row, muted dash and all, when there is nothing to show — the same
rule Name and VAT already follow — so Phone is not a special case.

**Migration 0122 (`vf-licence`).** An `UPDATE`, not an edit to
migration 0121 — that migration is already applied, and an applied
migration is not edited without saying so. Both seeded locales
change: `viewer.openinwindow` becomes "Document open in a separate
window" (`en`) and "Dokument in einem separaten Fenster geöffnet"
(`de`). Wired into `vf-licence/test/setup.ts`'s own migration chain,
the same as every migration before it — nothing in that chain is
optional bookkeeping, and skipping it would leave the test schema one
migration behind the real one.

---

## Tests

Five genuinely new, plus one existing test corrected for a wording
change it did not ask for:

- **"joins the city and country onto the same line, with the postal
  code still its own line below"** — checks the `.sfield`'s own child
  `<div>`s read exactly `["Trinity Wharf", "Felixstowe, GB",
  "IP11 3SL"]`, not two lines that happen to be adjacent.
- **"shows Phone beneath the address, on both the Seller and Buyer
  cards"** — checks both cards render a `Phone` row with the fetched
  value.
- **"still shows a muted dash for Phone when the record has none,
  rather than omitting the row"** — the same always-render rule Name
  and VAT are already trusted to follow, checked rather than assumed
  for the new row too.
- **"no longer overrides the pop-out actions into a row"** — checks
  the stylesheet text no longer defines
  `.vpoppedoutactions .actionlink {` at all, the same shape decision
  0387's own "no longer gives the address its own stacked grid" test
  used for an absent selector. Grid layout itself stays untestable in
  jsdom (decision 0392's own note, still true) — the actual height
  and row-format changes were verified by the Playwright harness
  above, not by this suite.
- **"reads the placeholder's new wording from the same string the
  older, looser test only substring-matches"** — the exact new
  wording, read the same way production reads it: from `t()`, backed
  by the fixture's `STRINGS` (standing in for `ui_strings`).
- **Corrected**: decision 0384's own "shows a placeholder..." test
  asserted the literal substring `"Open in a separate window"`
  (capital *O*, since the sentence used to start there); the new
  wording moves that phrase mid-sentence, lower-cased. Narrowed to the
  substring both wordings share (`"open in a separate window"`) rather
  than widened to the new exact text, since checking the exact text is
  now the newer, more specific test's job — one test should not do
  both.

All five new tests, and the corrected one, were watched fail against
the pre-fix code first (`git stash` on `app.css`/`viewer.js`, test
edits kept, rerun, confirmed genuine assertion failures — including
the deleted-selector check failing by quoting the still-present rule
verbatim — then `git stash pop`).

Full suites: vf-ui 74 Worker + 674 browser (669 pre-existing + 5 new),
both passing; vf-licence 320/320, both the new migration and its
`setup.ts` wiring included. `eslint` clean. Touches `vf-ui`
(`app.css`, `viewer.js`) and `vf-licence` (migration 0122 +
`test/setup.ts`) only — no change to `vf-app` or `vf-admin`.

---

## What is not built

Whether Process's own content can ever be taller than Document's badge
at every screen width, in which case the new `height: 100%` on
`.c-process > .panel` would be doing nothing visible — not checked
beyond the two viewport widths measured (1500px and 900px, the latter
already single-column and unaffected by any of this). The rule is
harmless either way it settles, per the same percentage-height
track-sizing behaviour decisions 0390/0391 already rely on elsewhere.
