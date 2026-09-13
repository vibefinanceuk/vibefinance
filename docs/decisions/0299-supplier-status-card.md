# 0299 — A Supplier status ring, and a real ambiguity resolved before building it

**Status: built.**

---

## What was asked

> The "Load a supplier file" card is wide, and takes up space. I
> wondered if we could introduce a card with a diagram indicating some
> Supplier KPI's. For example, Suppliers Status, those which are
> Active, Inactive, On Hold, Awaiting ERP Identifier.

Followed by, once a mock-up confirmed the direction: *"clicking on a
row could update the list below with those suppliers identified by
the card... an All Suppliers row, at the bottom, to allow a user to
launch all suppliers again."*

## The ambiguity, found and resolved before writing any code

Flagged in the mock-up and checked directly against the real data
model rather than assumed away: `status`, `onHold`, and whether
`erpIdentifier` is set are three independent fields. A supplier can
genuinely be active, on hold, and missing its own ERP identifier all
at once — the four categories the operator named are not naturally
exclusive, and a ring needs every supplier counted exactly once.

`supplierBucket(s)` gives one priority order, used identically by the
ring's own counts and the list's own filter: **Awaiting ERP first** —
nothing else about a supplier decision 0209 never matched to an ERP
identifier is really settled yet — **then On hold**, the state
decision 0208's own column already treats as the reason an invoice
routes differently, **then the plain Active/Inactive split** for
whatever's left. The same function answers both questions, so the
list a click reveals can never disagree with the count that produced
it.

## What was built

`supplierStatusCard()` reuses `charts.js`'s own `donutChart()` — the
same component already drawing the dashboard's stage and ownership
rings — rather than a second chart built to look similar. Its own
`onSelect` sets `statusFilter` and re-renders; `supplierRows()`'s own
filter reads the identical `supplierBucket()` the ring counted with.

`awaitingErpOnly`, a single boolean serving one dashboard
drill-through, became `statusFilter` — one of four bucket names, or
`null` — since the same mechanism now serves all four. The "showing a
filtered view" banner generalised the same way documents.js's own
`documents.showing.${key}` already works: `suppliers.showing.${key}`,
one string per bucket, rather than four hand-wired conditionals.

**"All suppliers" is its own row, not a fifth arc.** It is every
supplier, not one more mutually exclusive bucket alongside the real
four, and `donutChart()`'s own legend only ever draws what it was
actually given segments for — built separately, in the same
`.donutkey` markup, so it reads as part of the same list without being
part of the ring's own math.

**The load-file card lost half its own width, not its own content.**
`.supplierhead` gives it and the new status card the same auto-fit,
equal-column shape `.parties` already gives the Seller and Buyer
cards — reused rather than reinvented, under its own name since this
screen has no parties.

## What has coverage

Three tests, built around six suppliers chosen specifically to prove
the priority order rather than just each label once: two of the six
would land in a different bucket entirely under the wrong priority — one
missing its own identifier and on hold (awaiting ERP wins), one
inactive and on hold (on hold wins). One test confirms all four counts
against that fixture; one clicks a slice and confirms the list below
shows exactly the two suppliers that slice counted, with the correct
banner text; one confirms "All suppliers" shows the true total and
clears the filter. Each probed directly — reversing the priority
order, removing the list's own filter, and removing the "All
suppliers" row's own click handler each failed exactly the test
written to catch it. One existing dashboard test broke as a direct,
expected consequence of the banner's generalisation (its own string
fixture didn't yet know the new, dynamic key) and was fixed rather
than the assertion loosened.

vf-ui: 49 Worker, 375 browser (was 372). vf-licence: 320. One
migration (0088), all new strings, no existing ones changed.
