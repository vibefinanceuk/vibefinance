# 0291 — Invoice header becomes a curated summary, with a pop-out for the rest

**Status: built.**

---

## What was asked

> Could you update the Invoice Header card... There are some fields
> which I think do not display well and overlap... Business Process
> and Specification. Also could the other fields be oriented in a more
> user friendly way? Can you mock up for me?

Followed by several rounds of real design iteration — a first mock-up
that solved the overlap but added height back with group headings; a
flatter version that kept the height down; the operator's own two
hand-drawn layouts settling on a five-column arrangement; and a final
question about a pop-out, modelled on the one the Supplier screen
already has, for whatever the card itself doesn't show.

## What was actually wrong

Business process (BT-23) and Specification (BT-24) are EN 16931's own
technical identifiers — URNs naming which e-invoicing profile the XML
conforms to, meant for system-to-system interoperability, not a person
reviewing an invoice. Their values are long, unbroken strings with no
spaces to wrap at. `.vfields`'s auto-fit grid (`minmax(150px, 1fr)`,
no overflow handling) let them spill straight into whatever sat beside
them — the same class of problem decision 0290 had already found and
fixed once, for the Seller card's own sub-line.

## The layout

Five fixed columns, matching the operator's own second mock-up
exactly: Invoice number and Currency; Issue date and Due date;
Purchase order and Cost centre; Net before VAT and VAT amount; Total
with VAT and Amount due. `auto-fit` rather than a rigid `repeat(5,
1fr)` — the card shares a column with the document panel, narrower
than the mock-up's own full-width canvas, so the grid wraps to fewer,
wider columns on anything less than a wide desktop rather than
crushing every value.

**A field a customer's own configuration doesn't use leaves its own
slot empty**, rather than the five columns reflowing around it — the
same shape for every customer, whether they use Cost centre or not.

## Where the build deviated from the mock-up, and why

The operator's own sketch paired Amount due alone in the last column.
Total with VAT (BT-112) stayed alongside it instead of being dropped,
found by running the existing suite rather than assumed safe: decision
0119's own VAT-arithmetic check highlights Net before VAT, VAT amount
and Total with VAT together as the one relationship it validates.
Dropping Total with VAT from the card would have left a third of that
highlight invisible on the one check most likely to actually fail,
reachable only by opening Header Fields first. The column holds both
rather than either being sacrificed for the other — flagged to the
operator directly rather than shipped silently.

## The pop-out

Reuses `suppliers.js`'s own established pattern — `.popout` inside
`.backdrop`, the same box already used for a supplier's own detail
view — rather than inventing a new one. Lists every field the current
stage's configuration includes, in field order, so it needs no
separate decision about what happens to a field beyond the curated
nine or ten: whatever isn't in the summary card is simply here.
"Header Fields" only renders when there is something in it — a
customer whose configuration fits entirely inside the curated set gets
no action promising a pop-out with nothing behind it.

**Deliberately read-only, never `field()`.** That function renders a
live `<input id="f-${field}">` when a field is editable, and the
summary card already renders one for every field it shows. A second
`field()` call for the same spec inside the pop-out would put two
elements with the same id on the page at once — only one of which
would ever be read back on save, silently discarding whatever was
typed into the other. Built as its own, separate read-only row instead
— not a second place to edit the same value, only somewhere to look
one up.

**Not `cardHead()`.** That helper gates its own action on
`canEditAnything`, correct for Change Seller and Change Buyer — real
edits, rightly locked behind decision 0289's ownership gate. Looking
up a field's own value is not an edit; "Header Fields" stays available
the same way Expand does regardless of `canEditAnything`, so it builds
its own header rather than inheriting a gate written for a different
kind of action.

## The icon

A bordered panel with rows inside, deliberately distinct from the
existing `documents` icon (a page with a folded corner, meaning "a
document" generally) — this specifically means the fields themselves,
laid out as rows in a panel, matching what the pop-out it opens
actually contains.

## What has coverage

All 353 tests already covering the old flat grid pass unchanged — the
eight that initially broke on the switch to a curated card all traced
to the same cause (BT-112 no longer rendering in the main form), and
all eight were resolved by the single decision to keep it rather than
by editing the tests. Seven new tests: the curated columns render in
order; Business process and Specification never appear in the summary
card itself; "Header Fields" appears exactly when a customer's
configuration has more than the curated set and stays absent
otherwise; the pop-out lists everything configured, including what the
card omits; the pop-out is read-only, with no `<input>` inside it; the
pop-out closes from its own action; and an unused field leaves its own
slot empty without the column count changing. Each behavioural claim
probed directly — disabling overflow detection, switching the pop-out
to `field()`, disabling its close handler — and each probe caught by
exactly the test written for it. The read-only probe needed a second
pass: the first version's fixture had every field marked `"read"`,
which meant `field()` would have produced the same read-only markup
either way and the probe passed for the wrong reason. Fixed by giving
the fixture one genuinely editable field, then reprobed and confirmed
it fails correctly.

vf-ui: 49 Worker, 360 browser. vf-licence: 320.
