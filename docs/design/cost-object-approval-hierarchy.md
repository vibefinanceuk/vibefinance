# Cost-Object Approval Hierarchy — budget holders per cost object, at line level

**Status: investigated and mocked up, not built.** The operator's own
request: *"now we have built the account coding structure, it makes
the Cost-Object approval more feasible. Please can you investigate how
cost-object approval hierarchy could look mapping budget holders for a
cost-object at line level in configuration. Specifically can you
mock-up how that would look in the AP Setup and Approval Hierarchy
configuration we have."* This is that investigation, and the mock-up
it asked for — no migration, no resolver change, no route, and no
change to the real screens. See `docs/design/mockups/
cost-object-approval.html`.

**The core principle is confirmed**: *"If cost object approval is
needed on the invoice line, the invoice should be routed to the budget
holder for that cost center."* That is exactly what decision 0439's
Cost-Object mode already does today — a line's cost centre, walked up
to the first owner whose limit covers the amount — and the operator
confirmed it is correct as-is, not a request to change it. Nothing in
this document's own proposal touches that base case; it only asks what
should happen once a line can carry a budget holder from more than one
cost-object dimension at once, which the base case alone does not
answer.

---

## What already exists, checked directly rather than assumed

**Cost-Object mode already runs — for exactly one cost object.**
Decision 0439 wired `org_approval_config.mode = 'cost_object'` to
`resolveApprovalChain` (`ledger-route.ts`, decision 0195): starting
from a line's own `BT-133` (its cost centre), climb `cost_centres.
parent_cost_centre_id` while nobody's `approval_limit` covers the
line's own amount, stop at the first `owner_user_id` whose does. This
is real, tested, deployed code — the only cost object it has ever been
able to see is a cost centre.

**Account Coding (decisions 0444/0446) already gave three more lists
the same missing piece, and never connected it to anything.** Project,
Commodity Code, and General Ledger Code (`coding_list_entries`) each
already carry:

- `approver_user_id` — labelled **"Approver"** on screen, the
  operator's own word, matching Cost Centre's own column of the same
  name (which is `cost_centres.owner_user_id` under a different
  column name — decision 0444's own header comment is explicit that
  the two are "different columns, same word on screen").
- `parent_entry_id` — a real, self-referential parent, the same shape
  `cost_centres.parent_cost_centre_id` already is.

What they do **not** carry is `approval_limit` — Cost Centre is the
only one of the four lists with a signing amount attached to its
approver — and nothing in `approval-hierarchy.ts` ever reads any of
the three. A GL Code given an Approver in Account Coding today is
purely descriptive; `resolveCostObject` has never heard of it.

**This is the exact gap decision 0184 named and left open, before any
of this existed.** That record — the project's own original research
into cost-object approval, written long before Account Coding — said
plainly: *"a cost object is a wider thing than a cost centre... a
department, project code, or cost centre"*, and closed with **"what a
cost object is, here"** as an explicitly undecided question, blocked
on *"a project code would need somewhere to come from."* Account
Coding is that somewhere. This document is the follow-up 0184 itself
asked for, now that the blocker is gone.

**One of 0184's other open questions is already answered, by
precedent, and this design keeps that answer rather than reopening
it.** 0184 flagged *"whether the amount tested is the line, the cost
object's portion, or the invoice total"* as unresolved. Decision 0439
resolved it in practice for the one mode that exists today: a
line-scope stage evaluation carries that line's own `BT-131` net
amount (never the invoice total, never an aggregate across lines
sharing a cost object) into `resolveApprovalHierarchy`. Nothing below
proposes changing that — a wider design would need to, the day a line
can be split across several cost-object dimensions charged
differently, but that is future scope, not this one.

**Line-level capture is Cost Centre's alone, and nothing closes that
here.** `shared/ingestion/ubl-parser.ts` parses exactly one per-line
coding fact from a document, `BT-133`
(`cbc:AccountingCost`). Nothing parses, keys, or otherwise attaches a
Project, Commodity Code, or GL Code to a specific invoice line today —
Account Coding manages the *lists*, not what a line is coded *to*.
`AP.Code` (*"Assign GL/cost-centre coding to an invoice"*) is named in
`permissions.ts` and explicitly marked *"not yet built"*, and no
Coding stage exists in any real process (confirmed again during this
investigation, unchanged since 0439's own finding). This is the
single largest reason the mock-up below is a configuration screen and
not a working feature: **configuring which cost object routes
approval is close**; **getting a line coded to one beyond Cost Centre
is a separate, unbuilt piece**, named plainly rather than glossed
over.

---

## The proposed shape

**1. Give every cost object the shape decision 0184 always asked
for** — *"a tree of cost objects, each with an owner and a limit."*
Add `approval_limit` to `coding_list_entries` (same nullable `REAL`,
same `CHECK (approval_limit IS NULL OR approval_limit >= 0)` `cost_
centres.approval_limit` already carries), so Project, Commodity Code
and GL Code entries can each have a signing amount attached to their
existing Approver — the missing half of what Cost Centre already has.

**2. Generalize the chain walk, not rewrite it.** `coding_list_
entries` already gives Project/Commodity Code/GL Code the same
`parent_entry_id` self-reference `cost_centres.parent_cost_centre_id`
is. `resolveApprovalChain`'s own walk — climb while nobody's limit
covers the amount, stop at the first owner whose does — is exactly the
same walk over any of the four; only the table it walks changes. Cost
Centre keeps its own dedicated table (0076's own explicit decision,
unchanged by anything here), so this is a resolver that dispatches to
one of two queries by cost-object type, not a schema migration
collapsing `cost_centres` into `coding_list_entries`.

**3. A configurable priority across the (up to four) cost-object
dimensions a line might one day carry.** 0184's own finding: *"parallel
across cost objects, serial within one"* — each cost object a line
touches raises its own chain, walked independently. Today only one
dimension is ever populated per line (Cost Centre, via `BT-133`), so a
priority order has nothing to arbitrate between yet — but the
configuration should exist and be honest about that limit rather than
implying it already does more than it can. See the mock-up's own
"Not yet captured on invoice lines" badge on three of the four rows.

---

## What the mock-up shows

Two extensions to screens that already exist and are already live —
`docs/design/mockups/cost-object-approval.html`, switchable between
both the way the real screen's own tab bar already works:

**Approval Hierarchy tab.** A new **Cost-Object Priority** panel,
appearing only when the Mode picker above it reads Cost-Object — the
same "only relevant to one mode" placement the two existing override
lists already have implicitly (they matter to Employee-Supervisor,
though today they render regardless of mode; a real build should
decide whether to gate those the same way, out of scope for this
mock-up). One row per eligible cost-object dimension — Cost Centre,
Project, Commodity Code, General Ledger Code, in that configurable
order — each with an on/off toggle and up/down reordering, the same
interaction `processes.js`'s own stage sequence editor already uses
(decision 0352, drag-to-reorder; the mock-up uses plain up/down
buttons for a static file, not drag, but the real build should reuse
that existing component rather than invent a second reordering
control). Three of the four rows carry a plain, undismissable note —
**"Not yet captured on invoice lines"** — because turning them on
today would silently do nothing, and a configuration screen that lets
someone enable a routing rule with no observable effect is worse than
one that says so.

**Account Coding tab.** Project, Commodity Code and General Ledger
Code's own entry tables and edit forms gain an **Approval Limit**
column and field, in the same place Cost Centre's own already sits —
so, on screen, all four lists finally share one shape: Name, Parent,
Approver, Approval Limit, then whatever "Filter by" columns that list
declares.

---

## What this leaves open — the operator's to decide before any of it is built

- **Whether "priority" means first-match-wins or all-must-approve.**
  0184's own *"parallel across cost objects"* reading, taken literally,
  means a line coded to both a GL Code and a Cost Centre could need
  *both* approvers, not just the higher-priority one. The mock-up
  assumes the simpler reading — the highest-priority dimension that
  has a coded value and a resolvable chain wins outright, the rest are
  not consulted — because that is what a single `resolveCostObject`
  call already does today and what the existing multi-task-per-line
  machinery (decision 0439's own "multiple tasks per invoice") does
  not yet generalize to "multiple approvals for one line from
  different cost objects." Worth a direct answer before building
  either way.
- **How a line ever gets coded to a Project, Commodity Code, or GL
  Code at all.** A new Coding stage using `AP.Code` (closest to what
  the vocabulary already names), a customer-defined `custom.*` field
  per dimension (the mechanism already exists and needs nothing new
  built for it), or something else — each has different implications
  for validation, keying, and how a rule can reference the value.
  Genuinely a separate decision, not assumed here.
- **Whether the per-line amount convention (kept as-is above) still
  holds once a line can be coded to more than one dimension at once** —
  named in the "what already exists" section above, restated here
  because it is the one place this design deliberately did not reopen
  a question 0184 left explicitly unresolved.

## What was not built

Everything above is documentation and a static mock-up. No migration
(`approval_limit` on `coding_list_entries` does not exist), no
resolver change (`resolveApprovalChain`/`resolveCostObject` are
unchanged), no route, and `ap-setup.js`/`coding-lists.js` are
unchanged. Nothing here is wired to anything or callable from the real
app.
