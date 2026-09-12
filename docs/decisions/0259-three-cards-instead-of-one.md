# 0259 — Three cards instead of one

**Status: built.** The combined "Needs somebody" card becomes three,
each with a graphic and a real link.

---

## What was asked

> The needs somebody card holds important items. I think it deserves a
> separate card each, with a graphic, and a link to those documents.
> 1) Unplaced Documents 2) Suppliers w/ No ERP Ref 3) Possible
> Duplicates

**A combined count could never honestly offer a link** — decision 0250
already established that a card promising a click has to say what the
click shows, and a click can only land on one kind of thing. Splitting
the card is what makes "and a link" possible at all, not a separate
feature bolted onto the old one.

---

## The split, mechanically

`needsSomebody()`'s three counts become three functions —
`unplacedDocuments()`, `suppliersAwaitingErp()`, `possibleDuplicates()`
— each its own card type: `unplaced_documents`,
`suppliers_awaiting_erp`, `possible_duplicates`.

**Migration 0057 rebuilds `dashboard_cards`' `CHECK` constraint**,
since SQLite cannot alter one in place. Nothing references
`dashboard_cards.id`, confirmed by searching every migration first, so
this is the plain rebuild rather than decision 0055's park-and-restore.

**A saved `needs_somebody` card becomes `unplaced_documents`**, at the
position it already held — tested against a database with a real row
in it, not just an empty replay, per decision 0235's lesson. The other
two are one *Add a card* away, the same distance every other card is
from somebody who wants it.

---

## The link that nearly reproduced the exact bug this project just spent
two days fixing

Tracing where *Unplaced Documents* should actually send a click
surfaced a real conflict between two deliberately-reasoned, previously
correct decisions:

- **Decision 0255** (two days ago) made an unplaced document visible to
  *everyone*, because it is an alert nobody should be permanently blind
  to — the count on the card uses no scope clause at all.
- **Decision 0199** (much earlier) made the *opposite* choice for the
  ordinary Documents list: a document with no unit is hidden from a
  scoped viewer, because it might belong to a region they cannot see.

**Wiring the click through without checking would have made the card
and the list disagree for every scoped person on earth** — the exact
shape of decisions 0252 through 0255, one layer over, in a different
pair of screens.

The fix is a narrow, explicit carve-out in `handleListDocuments`: the
ordinary visibility clause is bypassed only when `unplaced=1` is
explicitly requested, and only for documents that are actually marked
unplaced — not merely null-unit for some other reason, which a first
version got wrong and a test caught directly. Decision 0199's policy is
untouched for every ordinary visit to the screen.

**Duplicates needed no such carve-out.** `possibleDuplicates()` scopes
normally, matching how the documents list already treats a document
that does have a unit.

---

## Suppliers, filtered differently, and said out loud why

`/api/suppliers` already returns everything with no pagination — one
customer's supplier master, not a growing transaction log (decision
0213). Adding a server-side filter for a dataset already entirely on
the client would be a second way to narrow the same list, and decision
0236's whole finding was that two names for one thing drift. The
*Suppliers awaiting the ERP* card filters client-side instead.

**Both screens say when they are filtered.** Arriving from a dashboard
card showing *"1 awaiting the ERP"* and landing on a table that looks
like everybody would be the smaller version of exactly the confusion
decision 0256 fixed for a dropdown that filtered without saying so.

---

## The graphic, and why it stays muted

Three new icons — a pin with no place to land, a tag with nothing
written on it, two offset sheets — drawn purely as tile decoration, not
as `actionLink` glyphs, so they sit outside the `action.*` naming
convention decisions 0229 and 0236 test against.

**The icon does not turn a warning colour when the count is not zero.**
The figure beside it already carries the alert; colouring the graphic
too would say the same thing twice.

**A card is clickable only when there is something to click through
to** — decision 0161's rule, held to consistently rather than making an
exception for cards that happen to be new.

---

## How this was actually built

Partway through, the sandbox turned out to already hold substantial,
uncommitted work from an earlier, abandoned attempt at this exact task
— `documents.js`, `suppliers.js`, `icons.js`, and `index.html` were
already modified, and `documents.test.ts` already had a careful,
well-structured test suite for the drill-through filters, including a
tighter unplaced-document check (requiring the actual failure marker,
not just a null unit) than the fresh version being written from
scratch. Found only because a stray comment in a diff described a bug
being caught by a test that had not, in fact, just been run.

**The leftover version was kept where it was better**, rather than
overwritten to make the work feel authored end-to-end in one sitting. A
duplicate test block from writing both versions was removed once the
better one was identified.

---

## What is not built

- **No caching** on the three new counts, same gap decision 0255
  already recorded for `items_at_stage`.
- **No server-side filter for suppliers**, deliberately — the dataset
  does not need one at today's scale, and adding one anyway would be
  the two-names-for-one-thing risk decision 0236 named.
- **`dash.about.needs_somebody` and its siblings are left in the
  database, unused** — decision 0071's own rule that a string a
  customer may have translated is not something to remove in passing.

vf-app: 1441 tests. vf-ui: 277 browser. vf-licence: 320.
