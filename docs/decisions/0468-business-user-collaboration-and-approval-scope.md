# 0468 — Business User: A Real Collaboration Mechanism, and Approval Task Scope

**Status: investigated and documented, not built.** Two corrections to
decisions 0466/0467, not contradictions of them — each narrows what
those findings actually established rather than overturning them. No
migration, no vocabulary change, no route, no screen.

---

## What was asked

*"Business User can have assigned tasks, for Approval of Non-PO
invoices for example. I foresee expanding the Timeline / Chat to
include functionality to 'Add person to conversation', which would
permit the addition of a business user to 'Collaborate' on an
invoice."*

## What was found

**Access should be explicit invitation, not derived ownership.** The
per-invoice ownership check proposed in decision 0464 (does this
person hold a Procurement permission and match the invoice's own PO
`buyer_user_id`) is superseded by a better, more general mechanism the
operator named directly: an "Add person to conversation" action,
recorded per invoice. Checked directly: no collaborator/participant/
watcher/share concept exists anywhere in this schema today — this is
genuinely new storage, the same shape `document_comments` (decision
0267) already is. A new `invoice_collaborators` table (`invoice_id`,
`user_id`, `added_by`, `added_at`) becomes what Chat access actually
checks. This quietly removes the need for a separate
`invoice_headers.requested_by_user_id` column for Non-PO invoices —
whoever processes one simply adds the requester as a collaborator
directly, PO or not, the same action either way.
`purchase_orders.buyer_user_id` is still worth building — still real
data the operator asked for by name — but becomes a sensible default
to pre-fill "add to conversation" with, not the access gate itself.

**"Business User" is an ordinary, general permission, not deliberately
read-only.** Decisions 0466/0467 found, correctly, that none of the
three named matching-exception resolutions has a Business User
performing the system action — that finding stays true, scoped to
those three resolutions. It was never a constraint that the
permission itself can't hold or complete a task, and the operator's
own example — approving a Non-PO invoice — is exactly a task a
Business User needs to complete. The single `Procurement.Respond`
permission first proposed is the wrong shape for this: two
permissions fit this codebase's own established pattern of splitting
AP's own verbs (`AP.Validate` vs. `AP.Approve`, never one blob) —
`Procurement.Collaborate` (view an invoice you've been added to, post
to its chat) and `Procurement.Approve` (hold and complete an approval
task), grantable independently or together, the same as any other
role here.

**A real, separate piece of new scope follows from the Approval
example**: routing an Approval task to "whoever requested this
invoice" needs a dynamic, per-invoice person the way none of
`approval-hierarchy.ts`'s four existing modes (Employee-Supervisor,
Cost-Object, Manual, API) resolve to today — checked directly, none of
them reach "the requester, whoever that is for this one invoice." This
is the same *kind* of per-invoice dynamic `assign_task` target this
document proposed and withdrew for Matching (decision 0467) — not
wasted, aimed at the wrong stage. For Approval it may be needed after
all. **This is Approval-stage scope, genuinely adjacent to this
investigation and not the same piece of work** — worth its own
explicit scoping before folding into what gets built here.

Full reasoning appended to `docs/design/two-way-matching-exceptions.md`.

## What was built

The design document updated in place: the ownership-check proposal
withdrawn in favour of an explicit `invoice_collaborators` mechanism;
the Non-PO requester field withdrawn as unnecessary given that
mechanism; the single `Procurement.Respond` permission split into
`Procurement.Collaborate` and `Procurement.Approve`; and the Non-PO
Approval routing requirement named as real, separate, adjacent scope
rather than folded silently into Matching's own build.

## What was not built

Everything above is documentation. No `invoice_collaborators` table,
no "Add person to conversation" route or UI, no `buyer_user_id`, no
`Procurement.*` permissions of either shape, no change to
`approval-hierarchy.ts`, no route, no screen.

## Still to do, operator side

One scoping decision before build starts: is Non-PO Approval routing
(a Business User resolving their own invoice's approval task) part of
this build now, or a separate, later piece of work? Everything else in
the Matching investigation (decisions 0464–0468) is settled and ready
to build regardless of the answer. Nothing to deploy or apply — this
decision touches no running code and no migration.
