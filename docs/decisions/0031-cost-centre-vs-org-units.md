# 0031 — Cost centre vs. `org_units`

Status: settled, 1 September 2026. The single most-repeated open
question in this entire project — named in eight separate decisions
(0015, 0017, 0018, 0019, 0022, 0027, 0028, and implicitly 0029/0030's
own line-level data) without ever being resolved.

## The conceptual question has a real, non-arbitrary answer

A cost centre and an `org_unit` are genuinely different axes, not
one concept wearing two names. Confirmed against what the real
EN 16931 standard itself says: `BT-133`, "Invoice line Buyer
accounting reference," is described as *"a textual value that
specifies where to book the relevant data into the Buyer's financial
accounts"* — a financial/accounting construct. `org_units` (decision
0009) is a structural/organizational construct, tied to authority
limits and approval hierarchies. The two often correlate in simple
organizations, but aren't guaranteed to: a single `org_unit` can span
multiple cost centres (one per project), and a single cost centre can
be shared across several `org_units` (a common IT or facilities
budget line, say). Forcing them into one concept — a foreign key from
`cost_centre` into `org_units` — would be a real modeling error for a
lot of real organizations, even though it happens to work for simple
ones. They are kept deliberately, permanently separate.

## A concrete gap this surfaced, mirroring `BT-1`'s own story exactly

`invoice_lines.cost_centre` has existed as a real database column
since decision 0017 — but `cost_centre` had never once been added to
`INVOICE_FIELDS`. It only ever lived in `EXPENSE_FIELDS` (decision
0022), a completely separate vocabulary. No AP or AR rule has ever
been able to reference it, even though the data has been storable
this whole time — the exact same class of gap `BT-1` turned out to be
before decision 0028 closed it.

Closed here: `BT-133` added to `INVOICE_FIELDS`, using the real EN
16931 code rather than the informal `cost_centre` name the expense
vocabulary uses. `parseUblInvoice` (decision 0030) extended to
extract it per line (`InvoiceLine/AccountingCost` in UBL, confirmed
against the real spec before adding it, the same discipline as every
other field that parser handles). Proven end to end, not just at the
parser level: a real UBL document with `BT-133` on one line, sent as
raw XML through a real intake channel, correctly matched a real,
per-line-scope rule and spawned a real task — the full pipeline from
raw document to fired rule, deliberately broken and confirmed to fail
(the invoice silently completing instead of blocking) before the fix
was trusted.

## A real, deliberate scoping deviation from the obvious precedent

The instruction was to build a real, customer-managed list "mirroring
`intake_channels`." Followed for the *shape* (real CRUD, not wired
into rule validation), but deliberately **not** for the *scoping*:
`intake_channels` is scoped per-process, because which channel
something arrived through is inherently tied to how it enters one
specific process. A cost centre isn't like that — it's a company-wide
financial construct, defined once by finance/accounting and used
consistently across AP, AR, and Expense alike. `cost_centres` is
therefore global, with no `process_id` at all, matching how
`org_units` itself has always worked. Stated explicitly here rather
than silently deviating from the given precedent without explanation.

## Deliberately not wired into rule validation — the same declined scope as intake channels

This makes the cost centre *list* manageable; it does not make a
rule's `BT-133` *value* enforced against it. The same closed-value-
enforcement question decisions 0023/0024 already raised and declined
for intake channels — declined again here for the same reason, not
silently resolved either way.

## What's still open

- Closed-value enforcement, again — now with two real, concrete
  candidate sources of truth (`intake_channels`, `cost_centres`) if
  it's ever built.
- Whether a cost centre should ever be allowed to *reference* an
  `org_unit` optionally, for customers whose structures do happen to
  align 1:1 — not proposed here, deliberately; the two stay
  unconnected unless a real, later need for that correlation emerges.
- No `GET`/list route — matches the "raw API for now" precedent
  elsewhere in this project.
