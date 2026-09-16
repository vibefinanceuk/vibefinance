# 0372 — Browsing loaded purchase orders, and a bug found doing it

**Status: built.** A list beneath the load card, in the shape and style
of Suppliers — the operator's own request, after decision 0371 shipped
load-only. Clicking a row opens a pop-out with everything on file for
that order, header and lines both — "all PO and PO Line information,"
verbatim.

---

## `AP.Validate`, not `Admin.Configure` — reused, not reconsidered

The new list route (`GET /purchase-orders`) is gated by `AP.Validate`,
the exact permission `handleGetPurchaseOrder` already settled on in
decision 0081 for reading a single order back — *"that is who needs to
see it."* Loading is configuration; looking at what was loaded is a
different act, and giving it a second permission just because it now
has a screen would drift from the one already established the moment
either changed without the other. The screen's own nav entry stays
`Admin.Configure`, unchanged from decision 0371 — the asymmetry (nav
gated tighter than the API it opens) already existed for the
single-order lookup before any screen existed to expose it; this does
not introduce it, it finally gives the existing permission a UI.

---

## A summary list, a full detail — two different reads, on purpose

`GET /purchase-orders` returns order headers with a **line count**, not
the lines themselves — a list row is a summary. The detail pop-out
needs no new backend route at all: `GET /purchase-orders/:orderNumber`
already returns the full order and every line (decision 0081), sitting
unused by any screen until now. Clicking a row fetches it fresh, the
same "ask again rather than duplicate" reasoning decision 0372
mirrors from decision 0081's own line-count-not-lines choice at the
list level.

**No pagination**, deliberately following `handleListSuppliers`' own
precedent for the same stated reason: a reference set read in full by
an AP screen, not a growing transaction log — worth revisiting if
real volume ever makes that assumption wrong, the same honest
limitation Suppliers' own screen states rather than hides.

**Newest first.** Ordered by `created_at DESC` rather than
`issue_date`, since the latter is optional and the former never is —
and because the scenario this most directly serves is "I just loaded a
file, show me what landed."

---

## Every field, because that is what was asked for

The pop-out's header grid and line table show every column
`purchase_orders` and `purchase_order_lines` actually carry — order
type code, currency, all three totals, the requisition reference on the
header; SKU, standard item id, price, both descriptions on every line —
not a curated subset. "All PO and PO Line information" was explicit,
and a screen that quietly picked the fields it considered interesting
would not be answering the question asked.

Nine columns on the line table needed more room than the default
pop-out gives — 520px, sized for the Suppliers edit form's single
column of inputs. A new `.popout.wide` variant (900px) exists now for
exactly this; both tables use the existing `.tablewrap` for horizontal
scroll rather than letting a wide table blow out the box.

---

## A real bug, found by the first test that could have caught it

`purchase-orders.js`'s own `open()` — mirroring `suppliers.js`'s,
closely — called `note()` before `render()` had ever run when the
initial list load failed. `note()` writes to an element `render()`
creates; calling it first means the element does not exist yet, and
the message goes nowhere. Silent, on both screens, since neither had a
test exercising a failed first load until this one did.

Fixed in both files: `render()` always runs first, so the note element
exists regardless of whether the load behind it succeeded — a person
sees the full screen shape with an honest error banner, rather than
either a blank screen or (the original bug) nothing said about a
failure at all.

---

## Tests

`purchase-order-route.test.ts` — 5 new tests for `handleListPurchaseOrders`:
empty before anything loads, a correct line count per order across both
CSV and XML ingestion, the list never carries the lines themselves,
newest-first ordering (with `created_at` backdated explicitly in the
test rather than trusting two real inserts to land in different
seconds), and a header row with zero lines still appears rather than
being silently dropped by the join.

`purchase-orders.test.ts` (browser) — rewritten with a flexible
path-to-response stub rather than the single-purpose one decision 0371
used, since the screen now calls three different endpoints. 21 tests:
the list's own empty and populated states, the pop-out opening with
every header and line field checked individually, the wide variant,
both ways of closing it (the Close button and a click outside the box,
proven distinct from a click inside it), a failed detail fetch reported
rather than silent, and the list genuinely refreshing after a load
(proven with a call-counted stub returning different content on the
second call, not merely asserted).

`vf-ui/test/index.test.ts` — `GET /api/purchase-orders` added to
`CALLED_BY_A_SCREEN`, documenting the real call this screen now makes;
already covered by the `/purchase-orders` pattern decision 0371 added
to the allowlist itself, since `mayProxy()` does not distinguish by
method.

vf-app: 1,756 tests (was 1,751). vf-ui: 72 worker tests (unchanged),
575 browser tests (was 564). vf-licence: 320 tests, unchanged — this
decision's own migration (`0111`) added new keys only, no schema
change.
