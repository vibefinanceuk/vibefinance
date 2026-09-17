# 0373 — Sharing the CSV format itself, and one source of truth for it

**Status: built.** The operator's own observation: the load screen's
one-line hint — *"it needs an order number and a line number
column"* — told a person almost nothing about the other nineteen
columns a file could carry, or which spellings of any of them were
accepted. Without that, preparing a file meant trial and error against
the load endpoint's own refusal messages.

---

## One source of truth, not two lists that could disagree

The real risk in building a "here is the format" reference is that it
becomes a second, hand-maintained copy of what the parser accepts —
and the two drift the first time either is updated without the other,
at which point the documentation actively misleads the person it
exists to help.

So `HEADER_COLUMNS` / `LINE_COLUMNS` — the parser's own alias-to-key
lookup maps, unchanged in what they accept since decision 0370 — are
now *derived* from `HEADER_FIELD_SPECS` / `LINE_FIELD_SPECS`, a richer
structure (`key`, every accepted `columns[]`, `required`, a
`description`) that both the parser and the new format endpoint read
from. `GET /purchase-orders/csv-format` returns those specs verbatim.

Proven, not just asserted: a test builds a CSV using every column the
new endpoint advertises and confirms the real loader accepts every one
of them with zero refusals. If the two ever disagreed, this is the
test that would fail — not a person discovering it against their own
file.

---

## `Admin.Configure`, not `AP.Validate`

The list and detail routes (decision 0372) are `AP.Validate` — reading
what is on file. This one is different: a person with only
`AP.Validate` can look at existing orders but cannot load one, so "what
columns does a file need" has no audience for them at all. Gated by
`Admin.Configure` instead, matching the load action this exists to
help with.

---

## Two affordances, not one

**A reference table**, in a collapsed `<details>` disclosure (the same
native pattern `readback.js`'s own `.morefacts` already uses) — every
field, every accepted spelling, whether it is required. For a person
mapping their own existing ERP export against what is accepted.

**A template download**, built entirely client-side from the same
fetched specs — no new backend capability needed, since the backend
had already told the screen everything required to build one. The
first-listed (recommended) column of every field, header fields before
line fields, assembled into a CSV blob and downloaded via a temporary
anchor element — the first client-side generated-file download
anywhere in this app, so there was no existing pattern to follow; the
standard `Blob` / `createObjectURL` / temporary-`<a>` technique was
used instead. For a person starting from nothing.

**Both degrade independently of the list and load card.** The format
fetch runs alongside `load()` at screen open but is not allowed to
block either: if it fails, the disclosure simply does not render and
the download button disables itself, rather than the whole screen
reporting failure over a help affordance that is not core
functionality.

---

## A new icon, mirrored rather than invented from nothing

`download`, in `icons.js` — the existing `load` icon's own arrow,
flipped, with the bracket moved to the bottom: the same visual language
in reverse, since a person downloads a template before they ever load
a file. Placed as a second `actionLink` beside Load in the same
`cardhead`, not as an ad-hoc text link — matching the app's own
established multi-action-button shape (Save/Close, Load/New Supplier)
rather than introducing a new, unproven link style.

---

## What this does not do

**No per-field examples.** The reference lists what is accepted, not a
worked example value for each — the downloadable template's own header
row is the "here is where to start" affordance instead.

**No CSV validation before upload.** The format reference tells a
person what the file needs; it does not check their file against it
client-side before they click Load. The load button's own refusal
messages remain the actual validation.

---

## Tests

`purchase-order-route.test.ts` — 3 new tests: only `order_number` and
`line_number` are required, every advertised column is genuinely
accepted (the drift-proof test above), and every alias for one field
resolves to the same stored value, not just the recommended one.

`index.test.ts` — 4 new route-level tests: the real shape through the
real router, 401 with no session, 403 for `AP.Validate` alone (proving
the permission choice above is actually enforced, not just documented),
and confirmation the route is not swallowed by the single-order lookup
regex it sits beside.

`purchase-orders.test.ts` (browser) — 6 new tests: the disclosure
absent when the format fetch fails, present and correct when it
succeeds, required fields marked and optional ones left blank rather
than saying "Optional" redundantly, the download button's own disabled
state tracking whether the format loaded, and — the one worth
highlighting — the actual downloaded content verified by spying on
`URL.createObjectURL` and reading the captured `Blob`'s own text,
rather than only asserting the click handler ran.

vf-app: 1,764 tests (was 1,757). vf-ui: 72 worker tests (unchanged),
581 browser tests (was 575). vf-licence: 320 tests, unchanged — the new
migration (`0112`) is new keys only.

---

## Addendum — "Load CSV" and "CSV Template", not the shared generic labels

The operator's own follow-up: the two buttons should read "Load CSV"
and "CSV Template" rather than the generic "Load" / "Download" every
screen sharing `actionLink`'s own `action.load` / `action.download`
gets by default.

**Not done by editing those shared strings.** `action.load` also
labels Suppliers' own load button, and that screen still wants the
plain generic word — changing the shared string would have silently
renamed a button on a screen nobody was looking at. `action.download`
was, as it happened, only used here so far, but the key's own name
promises a generic, reusable label to whatever next screen reaches for
it; putting Purchase-Orders-specific text under a generic-sounding key
would have been a trap for that future caller, not a fix.

`actionLink` gained one small, additive, backward-compatible parameter
instead: an optional `label` that overrides the shared `action.<name>`
text while still using that name's own icon and button styling. Every
existing call site, on every screen, is unaffected — the full 581-test
browser suite re-run afterward confirms it. Purchase Orders' own two
buttons now pass `label` explicitly, backed by two new strings
(`purchaseorders.loadbutton`, `purchaseorders.templatebutton`,
migration `0113`) that belong to this screen alone.

vf-ui: 581 browser tests, unchanged in count — the 13 existing
assertions that named the old button text by string were updated to
match, not replaced with new ones. vf-licence: 320 tests, unchanged —
migration `0113` is two new keys.
