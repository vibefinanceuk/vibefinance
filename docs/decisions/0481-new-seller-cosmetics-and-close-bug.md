# 0481 — New Seller: Icon and Placement, Pop-out Header, and a Real Close Bug

**Status: built and verified locally, not yet committed/pushed at the
time of writing.** No push access from this session — delivered as a
git bundle, per this repo's own established handover mechanism.

---

## What was asked

Reported live, right after testing decision 0480's own invoices: *"I
would like, when an invoice is received, for the Seller, and Buyer
records to me identified at the validation stage... Could you apply
some cosmetic changes? I would like the New Seller button, to have an
icon and reside next to the Change Seller button, in the same card.
Upon launching the New Seller pop-out, please can you relocate the
Save and Close buttons to the top right of the pop-out. Please can you
add an icon for the Save button. Also, the Close button does not
work."*

## What was found

**The Close button was genuinely broken, not merely unstyled.** The
previous code called `actionLink("close")` with no `onclick` at all —
`actionLink` treats a missing `onclick` as "nothing to do" and marks
the button `disabled`, exactly its own documented behaviour for every
other action link on the screen. A handler was then patched on
afterwards by querying the DOM for the last `<button>` in the pop-out
and assigning `.onclick` directly — but a `disabled` button never
dispatches a click event at all, regardless of whether a handler is
attached, so that patched-on handler was reachable and simply never
ran. Fixed by passing `onclick: close` straight into `actionLink`, the
same way every other pop-out's own Close button already does — no
special case, no post-hoc DOM query.

## What was decided

**Move both requests onto conventions this codebase already has,
rather than inventing new ones.** A card needing two actions in its
header — title left, both actions right — is exactly what
`suppliers.js`'s own Load/New-supplier header already does (decision
0300), built from `.cardhead` wrapping an `.statebuttons` group rather
than `cardHead()`'s own single-action helper. A pop-out's Save and
Close sitting top right beside its own heading, in that same
`.cardhead`/`.statebuttons` shape, is the pattern `access.js`'s org and
role forms and `coding-lists.js`'s own edit pop-out already use — New
Seller was simply built (decision 0480) before that convention was
reached for this particular form. Neither change needed new CSS.

**A new icon key, not a reused one under a different label.** The
"person with a plus" shape already exists as `newsupplier` (decision
0237, "record a supplier the ERP does not have"), and New Seller means
exactly that same thing — but decision 0328 already established the
convention for this exact situation: the same visual under its own key
when the two actions never appear on the same screen (`newperson`
reusing `newsupplier`'s path). Followed here as `newseller`, same
path, own key, own comment recording why.

## What was built

- **`workers/vf-ui/public/icons.js`**: new `newseller` icon — the same
  path as `newsupplier`/`newperson`, under its own key per decision
  0328's established reuse convention.
- **`workers/vf-ui/public/viewer.js`**:
  - `sellerPanel()`'s unmatched branch no longer calls `cardHead()`
    (which only ever renders one action). Builds its own
    `.cardhead`/`.statebuttons` row instead — `actionLink("changeseller", ...)`
    and, when `!hasPoReference`, `actionLink("newseller", { label: t("viewer.supplier.newseller"), ... })`
    beside it — both still gated behind `canEditAnything`, the same
    guard `cardHead()` itself already applied.
  - `openNewSellerForm()`: `close` now declared once, wired directly
    into `actionLink("close", { onclick: close })` — the actual bug
    fix. Save switched from a plain `<button class="primary">` to
    `actionLink("save", { onclick: doSave, primary: true })`, which
    carries its own icon for free, the same shared glyph every other
    Save button on this screen already shows (`action.save`, existing
    since migration `0023`, needed no new string). Both moved into a
    `.cardhead` row beside the pop-out's own heading, replacing the
    previous plain button row at the bottom of the form.

## What was not built

No change to `cardHead()` itself — extending it to accept more than
one action would have changed the margin behaviour of every other
card using it (`.cardhead > .actionlink`'s own `-6px` pull, which only
applies to a bare direct-child action link, not one wrapped in
`.statebuttons`). The one card that needs two actions builds its own
header manually instead, the same way `suppliers.js`'s own two-button
header already does — not a new shared abstraction for a pattern used
in exactly one more place. No change to `openSupplierSearch()`'s own
pop-out, which already puts Close correctly at the bottom in its own
established layout and was not reported as broken.

## Verification

`workers/vf-ui/test-browser/viewer.test.ts`: **3 new tests** in the
existing "New Seller" describe block — the button carries an `<svg>`
and shares its `.cardhead` with Change Seller; Save and Close both sit
inside the pop-out's own `.cardhead`, Save with an icon; and a direct
regression test for the bug — clicking Close (confirmed not
`disabled`) actually removes the backdrop. All existing tests in the
block updated for nothing (button text and identity unchanged; the
DOM restructuring is transparent to every assertion that was already
matching by visible text). **198/198** in the file (10 in the New
Seller block, up from 7). Full browser suite **1102/1103** — the one
failure is `typography.test.ts`'s pre-existing, unrelated
hardcoded-`10px` finding (decision 0470, untouched here), confirmed
present before this decision's own changes. `node --check` on both
touched files.

## Still to do, operator side

Push and deploy `vf-ui` only — no `vf-app`/`vf-licence` change, no new
migration, no new string (`action.save`/`action.close` both already
shipped).
