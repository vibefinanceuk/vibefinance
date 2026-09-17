# 0387 — The Seller and Buyer cards give up a column

**Status: built.** Supersedes decision 0280 in part.

---

## What was asked

> Let's work on releasing some real estate for the viewer. To start
> with - please can we remove E-address, E-mail, Phone from the seller
> and buyer boxes? Would it be possible to remove the dual columns and
> instead have stacked name, and data only to reduce the wrapping that
> is occurring. The Order should be in the vertical order - Name, VAT
> no. Address. Reclaim the extra space by making the card height
> smaller if possible.

And, once the change was in front of the operator: *"now the address
can sit to the right of the address title, rather than beneath it."*

---

## The premise, checked before building anything

"Making the card height smaller if possible" was hedged for a real
reason, worth naming rather than quietly assuming away: `.sellergrid`'s
two columns ran **in parallel**, so the card's rendered height was
`max(left column, address)`, not their sum. Dropping to one column
makes every row **sequential** — Name, then VAT, then Address, stacked
— and the three removed fields' own height, previously hidden behind
whichever column was taller, was a real risk of coming back once
nothing hid it.

Reasoned about on paper this could have gone either way, so it wasn't
trusted on paper. A Playwright harness — the same pattern built for
decision 0386's pop-out fix, mounting the real `#shell`/`#viewer`
markup and calling `openViewer()` against a stubbed API, a realistic
supplier and buyer (UK Office Supplies Direct Ltd / McDonald's
Restaurants Limited, both with a long country name) — measured the
Seller card at **421px before, 263px after**, in a real headless
Chromium, not assumed. **Removing the fields won**: the two half-width
columns were forcing "UK Office Supplies Direct Ltd" across four lines
and an email across four more, in an 88px-label / half-card-width value
column. Full width and three fewer rows cost less than that wrapping
was costing.

---

## What was built

**`viewer.js`.** `buyerPanel()` and `sellerPanel()` each built
`.sellergrid` from a wrapper `<div>` of five `pair()` calls (Name, VAT,
E-address, E-mail, Phone) beside `addressBlock()`. Both now build it
from three children directly — `pair(Name)`, `pair(VAT)`,
`addressBlock()` — no wrapper, no Endpoint/Email/Phone row, same order
the operator asked for. `pair()` and `addressBlock()` themselves are
unchanged; `s.electronicAddress` / `s.email` / `s.phone` (and the
Buyer's `b.` equivalents) are still fetched onto `stored.supplier` /
`stored.buyer` and simply never read into the DOM now — nothing else in
this file used them, checked with `grep` before deleting the rows.

**`app.css`.** `.sellergrid`'s `grid-template-columns` narrowed from
`minmax(0, 1fr) minmax(0, 1fr)` to one `minmax(0, 1fr)` — a real track,
not a bare `1fr`: a single explicit column has exactly the same
`auto`-minimum problem decision 0223 fixed on the first one, so the
`minmax(0, …)` pattern is kept rather than dropped along with the
second column. The `gap` and the now-pointless
`@media (max-width: 520px) { .sellergrid { grid-template-columns: 1fr; } }`
override (single-column at every width already, once this landed) are
gone.

**The address, superseding decision 0280.** 0280 moved the address
from beside its label to beneath it, in the operator's own words: "so
that the address appears under the Address title, rather than to the
right of it... screen space I would like to make better use of." That
reasoning was about a column that was **half the card's own width** —
stacking gave the address the full half-column instead of sharing it
with an 88px label. `.sellergrid` is one column now, the card's full
width, so the same trade no longer holds: reported live, once the
operator saw the wider card, *"now the address can sit to the right of
the address title, rather than beneath it."* `addressBlock()` now
returns a plain `.sfield` — the same 88px-label grid Name and VAT
already use — rather than `.sfield.address`; its address lines still
stack as `<div>`s, just inside that grid's value column rather than in
a row of their own beneath the label. `.sfield.address` had nothing
left to select, so it's deleted from `app.css` rather than left dormant
for someone to wonder about later.

---

## Tests

Three genuinely changed, each watched fail against the reverted code
before trusting it:

- **"shows our record inside the Seller card when matched"** (decision
  0220) asserted an email address rendered on the card. It now asserts
  the opposite — a value present in the fetched record must not reach
  the screen — and asserts the VAT number instead, since that row
  stayed.
- **"no longer gives the address its own stacked grid"**, replacing
  the decision-0280 test that read `.sfield.address {`'s own rule text
  (which no longer exists to read) — checks the stylesheet no longer
  defines that selector at all.
- **"the address sits beside its label, not beneath it"**, replacing
  the decision-0280 DOM test that asserted `.sfield.address` reached
  both cards — now asserts the opposite (zero elements carry that
  class) and that the address's own label and value still land in the
  same element, beside each other, on both cards.

The `.sellergrid` `minmax(0, …)` test from decision 0223 needed no
logic change, only a shorter inline CSS comment: the original one
pushed the actual `grid-template-columns` line outside the 400-character
window that test slices from the selector, which would have been a
false pass on the next edit rather than a true one now — caught by
running the suite, not assumed clean.

vf-ui: 74 Worker, 665 browser (662 unchanged, 3 changed as above), all
passing. `eslint` clean. No migration — this is markup and CSS only,
the `ui_strings` rows the removed labels drew from are untouched and
may still be read elsewhere.

---

## What is not built

Whether "E-address", "E-mail" and "Phone" as `ui_strings` rows and as
data fields on `supplier`/`buyer` are still needed anywhere else (a
Suppliers screen, say) was not checked — out of scope for a viewer-card
change, and nothing here deletes the underlying data or vocabulary,
only these two cards' own rows.
