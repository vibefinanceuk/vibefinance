# 0377 — A real status lifecycle, reversing what decision 0372 deliberately left out

**Status: built.** The operator's own request: a donut chart beside the
Load card, reporting Active, Closed, On-Hold, Invoiced (Part), and
Invoiced (Full). The harder finding, surfaced before any code was
written: purchase order status did not exist anywhere. Decision 0372's
own words, from when this screen was first built — *"unlike Suppliers
there is no Change, no hold, no status"* — were a real, deliberate
choice, not an oversight. This decision reverses it, on purpose.

---

## Two different kinds of "status," settled before building

The five values the operator named split into two genuinely different
things, confirmed directly rather than assumed:

- **Active, On-Hold, Closed** — a real, assignable lifecycle. *"Active
  is by default, Closed / Hold, should be set both manually, and
  automatically... I would expect these status to be overridden by
  uploading a spreadsheet from the ERP, as the ERP is the system of
  truth."*
- **Invoiced (Part), Invoiced (Full)** — not stored at all. Derived
  live, by comparing what real invoices reference this order against
  its own payable amount — the same "computed fresh, because a
  purchase order can arrive after its invoice" reasoning decision 0370
  already established for `po.matched`.

Only the first three are a real column. The other two are a live
computation layered on top, and only apply while the real status is
Active — an order already On-Hold or Closed keeps that status
regardless of how much has been invoiced against it.

---

## The ERP wins — deliberately the opposite of Suppliers' own precedent

Suppliers' own hold flag survives its next load; only a `PUT`'s own
fields are overwritten (decision 0230). The operator's words for
purchase orders were the opposite, and the reasoning holds: the ERP is
the system of truth, so an explicit status in a CSV load replaces
whatever was there — even a closed order — while a re-upload that says
nothing about status at all preserves whatever the order already had,
rather than silently resetting a held or closed order back to Active.
"Terminal" is a rule for the manual Hold/Release/Close actions below,
not a rule the source of record is bound by.

---

## No schema change on the invoice side

An invoice's own purchase order reference (`BT-13`) has never been a
structured column — only ever a fact inside `facts_json`. Rather than
add one, the derivation reuses the exact `json_extract` pattern already
proven in `dashboard-route.ts` and `documents-route.ts` for `BT-1`,
`BT-9`, and `BT-27`. A derived table (order number, summed invoiced
amount, grouped once) is joined in, and a single, shared `CASE`
expression — used identically by the list's own optional status filter
and the chart's own aggregate, so the two can never disagree about
what "Invoiced (Part)" means — decides the five-value status a person
actually sees.

**A real bug, found by running the tests rather than trusting the
SQL:** the status-counts aggregate initially returned wrong counts —
three orders folded into "Active" that should have split across
Active, Invoiced (Part), and Invoiced (Full). `GROUP BY status`,
written assuming it grouped by the computed `SELECT`-list alias,
actually grouped by the real, underlying `po.status` column instead —
SQL resolves an unqualified name against a real column before an alias
of the same name, and three orders sharing `po.status = 'active'` were
silently collapsed into one group regardless of how their own
invoicing-derived status actually differed. Fixed by grouping on the
full `CASE` expression explicitly, and caught only because a test
built the exact scenario (several orders, several real statuses) and
checked the actual counts, not because the SQL looked wrong on
inspection.

---

## Hold, Release Hold, Close — mirroring Suppliers' own mechanism, not reinventing one

*"A Hold and Release Hold button on the pop-out, similar to viewing
supplier records."* Built as a direct mirror of decision 0230's own
pattern: `Admin.Configure`, the same permission; a hold requires a
real reason, the same requirement migration 0049 already placed on a
supplier's own hold; both icons (`hold`, `releasehold`) and both
generic strings (`action.hold`, `action.releasehold`) already existed
and needed no new work at all.

**Closed is genuinely terminal.** Once set, no further call through
this route may change it — a 422, not a silent no-op, so a person
attempting it learns why. The one deliberate exception is the ERP
override path above, which is not bound by this rule.

**A distinct label for the order's own Close, not the pop-out's.**
`action.close` already means "close this pop-out" throughout the app.
Reusing it for "close this order permanently" would have meant the
same word doing two unrelated things on the same screen — `Admin.Configure`'s
own `actionLink("close", { label: ... })` override (decision 0373's own
addendum) supplied exactly the mechanism needed: the same icon, a
genuinely different label.

---

## The chart itself — org-wide, click filters the paginated list

Reuses `donutChart()` directly — the ring, the legend, the palette,
`onSelect` — the same component Tasks, the Dashboard, and Suppliers
already share, laid out beside the Load card through a new
`.poloadhead` grid, a straight copy of `.supplierhead`'s own layout
under a name for this screen rather than one that says "supplier."

**Deliberately independent of the search term.** *"The chart should
show Org wide values"* — its own counts come from a separate fetch,
`loadStatusCounts()`, never touched by whatever is currently typed
into the search box beside it. It still respects the chosen org and
the real permission scope from decisions 0374 and 0375, both genuine
visibility boundaries rather than something the person applied
themselves.

**Clicking a segment reuses the list's own existing filter mechanism**
— decision 0376's `status` query parameter, not a new one — resetting
to page 1 and reloading, exactly *"upon clicking the results, the
paginated values should be loaded into the list to scroll through."*

---

## Tests

`purchase-order-route.test.ts` — roughly 35 new tests: every lifecycle
transition (Hold requiring a reason, Release clearing it, Close being
terminal, a 404 for a nonexistent order, a 400 for an unrecognised
status); the CSV `status` column (default Active, an explicit value,
the ERP-wins override even against a closed order, preservation when
the column is absent, refusal of an unrecognised value with a sibling
order still loading, every human-friendly alias); the three invoicing-
derivation cases plus On-Hold and Closed both overriding it regardless
of invoicing progress; the status-counts aggregate (every bucket
correct, org-scoped, permission-scoped); and the list's own new status
filter, including filtering by a derived value, not just the stored
column.

`purchase-orders.test.ts` (browser) — 8 new tests: the chart showing
every real, non-zero segment; its own distinct empty state; a segment
click filtering the list; the correct buttons for Active, On-Hold
(with its reason shown), and Closed (no lifecycle action at all); a
real hold reason reaching the request body; and Close requiring
confirmation before anything is sent.

vf-app: 1,827 tests (was 1,804). vf-ui: 72 worker tests (unchanged),
603 browser tests (was 595). vf-licence: 320 tests, unchanged — the
new migration (`0116`) is new keys only.
