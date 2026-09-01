# 0026 — Peppol BIS Self-Billing 3.0, and the mobile-app mapping question

Status: design note only, 1 September 2026. Nothing in this record is
built. Captured for the same reason decisions 0013's ingestion path
and 0019's auto-loading-facts question were both recorded without
being built: a real, well-reasoned design conversation worth
preserving, deliberately not acted on yet.

## The finding, confirmed by search rather than assumed

Peppol BIS Self-Billing 3.0 is a genuine, fully EN 16931-compliant
CIUS (Core Invoice Usage Specification) — confirmed via its own
specification identifier,
`urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:
selfbilling:3.0`. Same UBL 2.1 syntax, same `BT-*` field structure as
`peppol_bis_billing_3`, `xrechnung`, and `factur_x`, already sitting
in `org_profiles`' closed `CIUS_PROFILES` list (decision 0009). The
only structural difference from an ordinary invoice: the buyer
generates the document on the supplier's behalf, under a prior
agreement — a generation-*workflow* difference, not a different data
model.

## A real correction to how this was first framed, recorded honestly

The first framing offered in this conversation was wrong: "informal
employee expenses" versus "automated contractor/vendor self-billing,"
as if the distinguishing axis were *who* submitted the expense. It
isn't. The same employee mileage/meals/travel scenario decision
0022's `EXPENSE_FIELDS` was built for can *also* be routed through
Self-Billing 3.0, with the employee treated as the "Supplier" for
that one transaction. The real distinguishing axis is **which
pipeline a company chooses to route reimbursement through** — a
configuration decision, not a fact about the submitter. Corrected
directly in conversation before being recorded here, not smoothed
over.

## This validates existing infrastructure more than it demands new infrastructure

`rule_sets.vocabulary` (decision 0022) is already a per-rule-set
choice between `'invoice'` and `'expense'`. Both pipelines this
conversation describes already work today, with zero further changes
to the core mechanism:

- A customer routing reimbursements through formal Peppol
  infrastructure tags their rule sets `vocabulary: 'invoice'` — real
  `BT-*` fields, validated as a genuine EN 16931 document.
- A customer using an internal, non-Peppol workflow tags theirs
  `vocabulary: 'expense'` — `category`, `receipt_attached`, and the
  rest of decision 0022's authored fields.

The workflow engine itself (decisions 0018/0019) needs no changes at
all for either path — it was already genuinely agnostic to which
vocabulary a stage's rule set declares, and to where the facts it
evaluates came from.

## The genuinely new question this surfaces: a fact-shape mapping layer

Could a mobile expense app feed the Self-Billing pipeline, with
workflow stages used only for review and approval? Architecturally,
yes — but this requires something that has never been built anywhere
in this system: a transformation from one fact *shape* (raw,
app-native fields — amount, category, a receipt photo, an employee
identity) into another (formal `BT-*` self-billing fields). Every
prior bundle this session has assumed facts arrive already correctly
shaped for whatever they're evaluated against; nothing has ever
mapped one shape into another.

**This is not a new gap** — it is the same "document ingestion path"
gap decisions 0013, 0015, and 0019 have each separately flagged as
unbuilt, now with a concrete, specific instance (mobile submission →
Self-Billing XML) rather than an abstract placeholder.

Two real architectural clarifications came out of working through
this, both worth keeping even though nothing was built:

- **The mapping has to happen before the workflow engine touches
  anything.** Stages, tasks, and rule evaluation stay completely
  unaware of where a fact set came from or what shape it started in —
  the engine's own design already guarantees this without any change.
- **Which storage table gets used — `invoice_headers` or
  `expense_reports` (decision 0025) — depends on the mapping
  decision, not on the source app.** The exact same app, the exact
  same raw submission, could feasibly feed either path depending on
  how a given customer configures their process. `expense_reports` is
  specifically for the informal path; a self-billing-routed
  submission, once mapped, would never touch that table at all.

Building the mapping layer itself is real, substantial domain
modeling, not infrastructure plumbing — deciding how an employee's
identity maps onto a supplier-shaped field, how VAT is handled for an
internal reimbursement, which `BT-*` fields are even meaningful for a
self-billed line. Explicitly deferred, not attempted here.

## What's still open

- The fact-shape mapping layer itself — the real, substantial piece
  named above.
- `peppol_self_billing_3` as a sixth `CIUS_PROFILES` entry — proposed
  in conversation, small, well-precedented, but not built in this
  bundle.
- The document ingestion path itself (decisions 0013/0015/0019) — this
  conversation gave it a concrete shape; it remains unbuilt.
