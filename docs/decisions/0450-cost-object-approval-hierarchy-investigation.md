# 0450 — Cost-Object Approval Hierarchy: investigation and mock-up

**Status: investigated, documented, and mocked up. Not built** — no
migration, no resolver change, no route, no screen change. Committed
and delivered as a git bundle for the operator's own pull/push
sequence, the same path decisions 0391, 0415–0449 already used. Unlike
those, there is nothing here to deploy: this is a design record and a
static mock-up, the same kind of deliverable decision 0184 itself was.

---

## What was asked

*"Now we have built the account coding structure, it makes the
Cost-Object approval more feasible. Please can you investigate how
cost-object approval hierarchy could look mapping budget holders for a
cost-object at line level in configuration. Specifically can you
mock-up how that would look in the AP Setup and Approval Hierarchy
configuration we have."*

An investigation and a mock-up, explicitly — not a build. Treated that
way throughout.

**Confirmed as a follow-up, once the mock-up and design were
delivered**: *"If cost object approval is needed on the invoice line,
the invoice should be routed to the budget holder for that cost
center."* Checked directly against the request rather than assumed —
this is exactly what decision 0439's Cost-Object mode already does
today, and the operator confirmed it is correct as-is, a validation of
the base case rather than a change to it. It leaves the design
document's own open questions genuinely open: the base case says
nothing about what happens once a line carries a budget holder from
more than one cost-object dimension at once.

## What was found

Cost-Object mode (decision 0439) has run since it shipped, but has
only ever been able to see one cost object: a line's `BT-133` cost
centre, walked up `cost_centres.parent_cost_centre_id`, stopping at
the first `owner_user_id` whose `approval_limit` covers the amount
(`resolveApprovalChain`, decision 0195). Account Coding (0444/0446)
gave Project, Commodity Code, and General Ledger Code the same
Approver and the same self-referential parent `cost_centres` already
had — and never connected either to the resolver. An entry's Approver
in Account Coding today is descriptive text on a screen; it has no
effect on who a task is assigned to. This is the exact gap decision
0184 — the project's own original cost-object-approval research —
named and left open from the very beginning: *"what a cost object is,
here,"* blocked on *"a project code would need somewhere to come
from."* Account Coding is that somewhere, and this record is the
follow-up 0184 itself called for.

Full findings, the proposed shape, and the questions this deliberately
leaves for the operator to answer before any of it is built are in
`docs/design/cost-object-approval-hierarchy.md` — kept as a separate
design document rather than folded in here, the same split `docs/
design/document-viewer.md` already has alongside its own decision
records, because the reasoning is long enough to want its own file.

## What was built

- `docs/design/cost-object-approval-hierarchy.md` — the investigation:
  what already exists, checked directly against the code rather than
  assumed; the proposed shape (an `approval_limit` column on
  `coding_list_entries`, generalizing the existing chain walk to any
  of the four cost-object dimensions, and a configurable priority
  order across them); and three questions named as genuinely open,
  not quietly assumed — whether priority means first-match-wins or
  all-must-approve, how a line ever gets coded to a Project/Commodity
  Code/GL Code in the first place (no mechanism exists today), and
  whether the existing per-line-amount convention still holds once a
  line can carry more than one cost-object dimension.
- `docs/design/mockups/cost-object-approval.html` — a static,
  standalone mock-up of both affected tabs of the real, live AP Setup
  screen: a **Cost-Object Priority** panel added to Approval Hierarchy
  (reorderable, one row per dimension, each carrying an honest
  "Not yet captured on invoice lines" badge where that is still true),
  a worked example of how a line would resolve through it, and an
  **Approval Limit** column and field added to Account Coding's
  Project/Commodity Code/General Ledger Code tables and forms, in the
  same place Cost Centre's own already sits. Every proposed element is
  marked inline with a dashed amber box and a "Proposed — not built"
  tag, so it cannot be mistaken for the shipped screen in a screenshot.
- `docs/design/mockups/README.md` — a new row for the mock-up, and a
  short note explaining why this one file is a different case from the
  other four already in that folder (it proposes an addition to a
  screen that is already built and live, not a screen sketched before
  anything existed).

## What was not built

Everything named above stays proposal-only: no `approval_limit` column
on `coding_list_entries`, no change to `resolveApprovalChain` or
`resolveCostObject`, no new route, and `ap-setup.js`/`coding-lists.js`
are byte-for-byte unchanged. The three open questions in the design
document are exactly that — open, not decided by default here — and
the biggest of them (how a line gets coded to anything beyond Cost
Centre at all) is real, unbuilt scope of its own, not a detail this
record glossed over to keep the mock-up simple.

## Still to do, operator side

Read `docs/design/cost-object-approval-hierarchy.md` and the mock-up,
and answer the three open questions it names. There is nothing to
deploy or apply — this decision touches no running code and no
migration.
