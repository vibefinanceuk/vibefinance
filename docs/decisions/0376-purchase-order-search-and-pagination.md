# 0376 — Search and pagination, pushed to the database, not the browser

**Status: built.** The operator's own layout request, confirmed before
building: a search box and pagination in one row, above the list —
"I've known some customers with thousands." That last detail decided
the architecture: both had to be real, server-side operations, because
loading everything and narrowing it in the browser is exactly the
approach that stops working at the scale being described.

---

## What the search matches, decided directly rather than assumed

The operator asked for order number, seller name, seller VAT
reference, and line item description. Checked against the real schema
before building anything: **seller name does not exist anywhere** —
the parser has only ever read the seller's identifier, never a
`PartyName` element, so this would have meant a new column, a new CSV
field, and new XML parsing, not just a new `WHERE` clause. Deferred,
by the operator's own choice, to VAT reference alone. **Line item
description**, taken literally, would have matched almost nothing in
practice: most CSVs, including the sample file already in this
conversation, only ever populate `item_name`, leaving
`item_description` empty. Both are searched together.

Final fields: `order_number`, `seller_party_id` (header), `item_name`,
`item_description` (line).

---

## The line-level fields needed an `EXISTS`, not a join

`order_number` and `seller_party_id` live on the header; the item
fields live on `purchase_order_lines`. The list query already joins
lines once, for `line_count` — reusing that same join for search would
have meant a header with three matching lines appearing three times,
or `line_count` reporting only the lines that matched rather than
every line the order actually has. An `EXISTS` subquery answers "does
at least one line match" as a single boolean, entirely independent of
the header join and its own `GROUP BY`, so a match never duplicates
its own order and `line_count` stays honest regardless of how many of
an order's lines matched.

**The term itself is escaped**, not treated as SQL wildcards — a `%`
or `_` typed by a person searching for a literal percent sign or
order-number underscore matches itself, via `LIKE ... ESCAPE '\'`, not
"any character" or "any run of characters."

---

## Real pagination, with a real total

`LIMIT`/`OFFSET`, page sizes restricted to what the UI actually offers
(25/50/100/200) rather than trusting whatever a request asks for, and
a second, independent `count(*)` query for `total` — a page of 50 rows
says nothing on its own about how many exist altogether, and the "51–
120 of 340" text the row asked for needs the real number, not a guess
built from the page size and whether the page happened to be full.

Both search and pagination compose with the org scoping and the real
permission enforcement from decisions 0374 and 0375 without any
special-casing: the same `WHERE` clause construction, the same
`unitClause`, applied before the `LIMIT` and counted in the same
`total` query.

---

## The frontend reused an existing pattern rather than inventing one

`documents.js`'s own search box already established the shape: a
`type="search"` input using `onchange` — fires once typing is done
(blur or Enter), not on every keystroke — followed by a full `render()`
and an explicit re-focus of the input by id, since rebuilding the
whole screen would otherwise drop focus out of whatever the person was
using. This screen's own search box, page-size picker, and all four
pagination buttons follow the identical shape, rather than a debounced
`oninput` handler and partial DOM patching invented fresh for this
screen alone.

**Four new icons** (`chevronleft`, `chevronright`, `chevronsleft`,
`chevronsright`) and a new, small `.iconbutton` class — `.actionlink`'s
own icon-above-text stack is built for a cardhead action and is
noticeably wider than four arrows sitting in one row beside a search
box need to be.

**A distinct empty message.** "No purchase orders match your search"
is a different fact from "nothing has ever been loaded," and the two
are told apart rather than sharing one line.

**Search and pagination reset on every fresh open**, the same "a clean
view each time" choice this screen already made once the org switcher
arrived: switching orgs re-dispatches through this same `open()`, and
a page 3 search left over from a different org would not mean anything
in the new one. A successful CSV load also resets to page 1, since a
newly-loaded order sorts to the top and a person left on page 3 would
never see it appear.

---

## Tests

`purchase-order-route.test.ts` — 28 new tests. Search: each field
individually (including the line-level `EXISTS`), case-insensitivity,
no duplicate header when several of an order's own lines match (with
`line_count` still counting all of them), literal `%`/`_` handling,
empty term returning everything, no matches returning an empty array
cleanly, and combination with the real permission scope from decision
0375. Pagination: default and requested page sizes, the next page
having no overlap and no gap with the first, a genuinely partial last
page, invalid page/page-size falling back to sane defaults, every
allowed page size, and `total` reflecting the full matching count
under both plain pagination and a narrowing search.

`purchase-order-route.test.ts` also gained a small refactor: the
group-hierarchy and role-scoping helpers decision 0375's own tests
introduced were local to one `describe` block; moved to module scope
so decision 0376's own tests — needing the identical hierarchy and a
role-scoped caller — could reuse them rather than duplicate them.

`purchase-orders.test.ts` (browser) — 11 new tests: the search box's
own placeholder, a real search reload with the page reset to 1, focus
surviving that reload, the distinct "no matches" message, every page
size actually rendered, a page-size change resetting to page 1, both
pagination edges (first page, last page) disabling the correct
buttons, every button enabled in the middle of a multi-page result,
the range text itself, and a page-forward click preserving the active
search term rather than clearing it.

vf-app: 1,804 tests (was 1,786). vf-ui: 72 worker tests (unchanged),
595 browser tests (was 584). vf-licence: 320 tests, unchanged — the
new migration (`0115`) is new keys only.
