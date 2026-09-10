# 0193 — Which part of the business

**Status: built.** A document says which unit it belongs to, and can be
narrowed to one. **Not a boundary** — see the end.

---

## A column that has existed since September and never been shown

`invoice_headers.org_unit_id` arrived with decision 0036. The invoice
route has reported it as `orgUnitId` ever since. **No screen has ever
read it.**

So a customer with France, Germany and UK sees **one undifferentiated
list** and cannot tell which invoices are theirs to care about.

**The same shape as decision 0171's line description**: extracted on
every line, stored on every line, displayed on none — because the screen
renders only what it is given, and nobody gave it this.

---

## Shown, not enforced

**This is the first of three steps** decision 0192 describes, and
deliberately the one that claims nothing.

A unit is a **label a person can read and filter by**. Everybody still
sees everything. No permission changes, no query becomes security-
critical, and nothing breaks if it is wrong.

**Which is the point of doing it first.** It surfaces whether the data
is even right — whether invoices are reaching the units they should —
before anything depends on the answer. Making it a boundary while the
assignment is wrong would hide invoices from the people who need them.

---

## Filtered in the query, unlike the search

The text search reads only what was loaded: the facts live in a JSON
blob, and `LIKE` would match a key as readily as a value (decision
0164).

**A unit is a real column**, so this narrows the SQL itself. A person
asking for France gets **France's most recent**, not France's share of
everybody's most recent — a difference that is invisible at ten
documents and decisive at ten thousand.

---

## The filter appears only where there is a choice

A customer with one operating unit would get a dropdown with one entry,
which is a control that cannot do anything. It appears when a second
exists.

**And only operating units.** An invoice may belong to one and never to
a legal entity — decision 0036's own invariant, and the filter would
otherwise offer France's parent company as somewhere to look.

---

## A route the proxy did not know about

`/org/units` existed and was **not in `vf-ui`'s allow-list**, so the
screen would have called it and received a 404.

**Decision 0131 recorded this exact fault** — a route missing from the
list, a rename failing silently — and the lesson was to enumerate. The
list is enumerated and this is the second time something was added to
the instance and not to it.

---

## What is not built

- **The task list does not show a unit**, so work is still
  undifferentiated even where documents are not.
- **Nothing assigns a unit except a source's default** (decision 0036's
  `default_org_unit_id`) and a manual edit. A customer whose invoices
  all arrive at one address gets one unit for everything, and the column
  will read the same on every row.
- **`org_assigned_by` records `rule`** as a possible source and **no
  rule can assign one** — the vocabulary has no action for it.
- **It is not a boundary**, and decision 0192 records in full what
  making it one would take: twelve permission checks, thirty files, and
  a decision about whether a unit is a filing label or a security
  boundary.
