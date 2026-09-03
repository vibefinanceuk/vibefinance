# Design: The Operator Interface

**Status: design only — nothing here is built.** Written 3 September
2026 from a mockup session. The system has been driven entirely by
`curl` until now; this is the first attempt at what a person would see.

The purpose is to record the design decisions the mockups forced, and
the constraints they exposed. Several of those constraints block work
that looked ready to start.

---

> **The mockups are saved.** `docs/design/mockups/` holds them as static
> HTML, openable directly in a browser. They were produced in
> conversation and would otherwise have been lost; the reasoning is here,
> the layouts are there.

## 1. What the mockups were for

Key-from-image is the third provenance class (decision 0055 section 8)
and the capability that makes an undetectable document useful rather
than merely visible. Decision 0063 built the path that gets such a
document in front of a person; nothing lets them act on it.

Drawing the screen surfaced four things prose had not.

---

## 2. The blocker: captured documents are not stored

**`intake-capture-route.ts` has no R2 access at all.** A document
arriving at `/sources/:id/capture` is read, extracted from or not, and
discarded. Only the multi-page pending-document flow writes to R2, and
it deletes on finalise.

Document 1 records long-term document retention as *"proposed design
only, no code exists for this yet"*, and that is still accurate for the
capture path.

**Keying cannot be built until this is.** The screen's premise is that
an operator reads the document and types what they see; there is no
document to read.

This also has a compliance dimension Document 1 already flags: most
jurisdictions require the original retained for years, and the retention
period is an open question rather than an implementation detail.

---

## 3. The keying screen

### The field list is a decision, not a given

The closed vocabulary declares 21 invoice fields plus customer-defined
ones. Showing all of them makes the screen unusable; showing a subset
means choosing which — and the right subset differs by process, since AR
and Expense want different things from AP.

That may be another thing an intake channel carries, alongside the
mapping rules of decision 0058.

### Partial keying should be allowed

An operator who can read the invoice number and total but not the VAT
breakdown should be able to save what they have. Validation then reports
honestly on what is missing, and the document comes back.

The alternative — requiring every field — leaves someone stuck on a
document that genuinely does not show a value.

### Line items are not optional

`line_sum` cannot run without lines (decision 0044), so a keying screen
without a line table produces documents that can never fully validate.
The table needs description and amount at minimum; quantity, cost centre
and line VAT are in the vocabulary and would make each row four inputs
wide.

### The running total is the design decision worth defending

The screen sums the keyed lines and compares them against the keyed net
**as the operator types**.

Validation would report the same mismatch afterwards — but afterwards is
too late in a specific way: the operator has moved on, and the document
is no longer in front of them. Showing it live is the only moment they
can resolve it.

Two constraints follow:

- **The tolerance must be the channel's own** (decision 0053/0057), not
  a hardcoded penny. If the screen and the validator disagreed, an
  operator would see "matches" and validation would fail — worse than no
  feedback at all.
- **It must be advisory, never blocking.** An operator whose lines
  genuinely do not sum to the printed total is looking at a bad invoice,
  and the system's job is to record that faithfully rather than prevent
  them entering what the document says.

### Keyed lines are indistinguishable from parsed ones

Header facts get a provenance class. Lines are stored in `invoice_lines`
rather than `facts_json`, so a keyed line and a parsed line look
identical in storage. Unresolved.

---

## 4. Opening the document in a separate window

For split-screen keying: the document in one window, the form in
another.

**A pop-out cannot authenticate the way the app does.** `window.open`
sends no `Authorization` header, so a route protected like the rest of
the API returns 401 in the new window.

| Approach | Survives refresh | New endpoint | Notes |
| --- | --- | --- | --- |
| Short-lived signed URL | Yes | Yes | Scoped to one document; expires in minutes |
| Blob URL from the parent | No | No | Dies on refresh, cannot be bookmarked |
| Cookie-authenticated route | Yes | Yes | A second auth mechanism alongside the bearer token |

The signed URL looks right. A window left open across a split screen for
several minutes needs to survive a refresh, which rules out the blob;
and a second auth mechanism is the kind of divergence that causes
trouble later.

**Unresolved:** a PDF in a pop-out relies on the browser's own viewer,
which differs across browsers and cannot be controlled. An image is
simple. A PDF may want a page-rasterisation step that does not exist —
and cannot exist inside a Worker (decision 0042).

---

## 5. The activity panel

A collapsible panel, right-hand side, scoped to the document —
**interleaving system events and human messages in one chronology**.

Read top to bottom for a real document: received from AP mailbox, no
structure detected, validation failed on `total_missing`, a rule raised
a task, two people established what the total was, someone keyed it,
validation passed.

### Why one stream rather than two

The justification for a decision sits beside the decision. *"Confirmed
3,137.47 with their AR desk"* is the only explanation for a keyed value
that validation cannot derive — the number came from a phone call, not
the page.

Six months later, *"why does this invoice say 3,137.47 when the scan is
unreadable?"* has an answer only if the thread survives with the record.

**Which makes it an audit-trail participant rather than a chat
feature**, and that changes three things:

- **Messages are immutable.** Same reasoning as `field_overrides`
  (decision 0049): if a keyed value traces to a conversation, editing the
  conversation breaks the trace. Deletion is probably a tombstone.
- **Authorship derives from the authenticated caller**, with the same
  spoofed-identity test as keying and rule approval.
- **Visibility follows the process**, not a separate access model. A
  second permission scheme would drift from the first.

### The system side needs no new recording

Everything is already in the database: `intake_capture_events`,
`stage_visit_steps`, `field_overrides`, the validation verdicts from
0051, tasks. The panel is a read that merges them into one chronology.

### Which events earn a place

Not every rule evaluated. Six rules ran on the Morrison document and five
declined; those are in `stage_visit_steps` for anyone querying and would
be noise here.

**An entry earns its place if it changed something or explains
something**: a rule that fired, a field that changed, a verdict, a state
transition.

A filter matters more than it looks — someone catching up wants the
conversation, someone auditing wants everything.

### Unresolved

`@mention` implies notification, and email is not built at all — nothing
is sent on approval or expiry either.

The panel is drawn on the keying screen, but a thread about an invoice is
useful at approval, at matching, and after payment. It probably belongs
to the **process instance** rather than any one screen.

---

## 6. The stage rail

An expandable left menu: completed stages with what happened, the
current stage highlighted, and the remainder greyed.

The completed half is a read of `stage_visits`. The greyed half comes
from the process definition's stage sequence.

> **The greyed half is a prediction, and must look like one.** `route_to`
> lets a rule advance an instance to a *named* stage (decision 0019), so
> a document can legitimately skip Matching and land at Approval. Showing
> upcoming stages without ticks and without times is enough; showing them
> as a guaranteed path would be quietly wrong on exactly the invoices
> where routing did something interesting.

> **The rail found three engine gaps —** Drawing tasks per stage visit
> raised the question of what happens when the last one completes, and
> the answer is narrower than expected: advancement is sequence-only, so
> `route_to` cannot fire and send-back does not exist in any form;
> `require_second_approval` is declared and implemented nowhere; and an
> instance advanced onto a rule-bearing stage sits there until something
> calls `visitCurrentStage` with facts. Recorded as decision 0064.

Two smaller points:

- **Source is not a stage** (decision 0055 section 3), so its row in the
  rail is provenance presented stage-like for the reader. Defensible, but
  it means the rail assembles from two places rather than one query.
- **A revisited stage produces a second `stage_visits` row.** The rail
  should show it as a repeat rather than collapsing — a document that
  came back from Approval twice is telling you something.

---

## 7. White-labelling

Per customer and per partner.

**The isolation already makes this nearly free.** Document 1 establishes
one D1 database and one Worker per customer, so branding is
per-deployment configuration with no shared-tenant concern.

### What varies, and what must not

| Themed | Fixed |
| --- | --- |
| Mark, wordmark, accent colour | Layout and structure |
| Footer attribution | Warning and success treatments |
| Product name | Field semantics |

**If branding can only reach tokens, a customer cannot break a screen**,
and a new screen is themed for everyone without extra work. That
requires the UI to have a token layer of its own and never a hardcoded
colour — a discipline that is cheap to keep and expensive to retrofit.

### Two things beyond colour

**Partner and customer are different layers.** A partner reselling to a
customer means two brands in play; whose appears is a commercial
question, and the relationship would live in `vf-licence` where customers
and their arrangements already do.

**Terminology may matter more than colour.** A customer calling them
"supplier bills", or naming their AP process something else, is a deeper
form of white-labelling — and it collides with the closed vocabulary,
where `BT-112` has a fixed meaning by design. **Labels can be themed;
field semantics cannot.**

---

## 8. What would have to happen first

In order:

1. **Store captured documents in R2.** Blocks everything in section 3
   and 4. Carries an open retention-period question (Document 1 section
   6.4).
2. **A document-fetch route with signed URLs**, for the pop-out.
3. **Keying itself** — the endpoint, the provenance class, the
   identity discipline and its spoofed-claim test.
4. **The activity read**, merging existing tables into one chronology.
5. **A token layer**, before any real UI is built rather than after.

Nothing above is scheduled. The mockups exist to make these decisions
cheap when they arrive, not to bring them forward.
