# 0466 — Matching Exceptions: The Remaining Six Questions, Answered

**Status: investigated and documented, not built.** A direct follow-up
to decision 0464's own six open questions — all six now answered — and
a new tension surfaced between two of the answers given so far, not
silently resolved either way. No migration, no vocabulary change, no
route, no screen.

---

## What was asked

Six yes/no answers against decision 0464's own list of open questions:
quantity matching as an on/off toggle (**yes**); an org-wide default
tolerance, superseded by a vendor-specific one when set (**yes**); PO
Buyer worth building now, scoped as *"a user setup in the users
section, with permissions. They can view an invoice, comment on
invoices"* (**yes**, with that scope given directly); "PO line not
found" as its own exception (**yes**); unit-of-measure mismatch as its
own surfaced exception (**yes**); and the same route-widening
`AP.Code` got, for `AP.Match` (**yes**).

## What was found

All six land exactly as decision 0464 proposed, with two refinements
the operator's own wording adds beyond a plain yes:

- **The org/supplier tolerance override is explicitly most-specific-
  wins** — "superseded by vendor specific tolerance" — confirming the
  same nullable-override shape already used three times elsewhere in
  this codebase, not a different mechanism.
- **Unit-of-measure mismatch needs a new fact of its own**,
  `po.line_unit_mismatch`, not named in decision 0464's original
  three-fact vocabulary split (`po.line_reference_found`/
  `po.line_price_matched`/`po.line_quantity_matched`) — today a unit
  disagreement silently skips the quantity check rather than failing
  it; splitting it out means quantity matching goes back to only ever
  meaning "compared and agreed," with the unit disagreement surfaced
  honestly rather than hidden inside a pass.
- **The PO Buyer's scope is narrower than "resolve exceptions"** — view
  and comment, not named as including resolving a task themselves.
  This answers two of decision 0465's own four newly-open questions
  directly: access is every invoice naming them as buyer/requester
  (no exception-must-be-open qualifier was given), and it stops at
  Chat.

**A real tension follows from that last point, surfaced rather than
resolved by assumption**: decision 0465's own routing drop-down names
"PO Buyer" as one of three targets a matching exception can route
*to* — but completing a task has always meant holding its
`required_permission` (`onTaskCompleted`'s own gate), and a
read-and-comment-only Business User cannot hold that for a task
that expects to be resolved. Two honest readings are named in the
design document, not decided here: "PO Buyer" as a routing target
really means *notify them, AP still resolves it* (in which case
`assign_task { role: "po_buyer" }` isn't what gets built — `notify`
needs the new per-invoice lookup instead), or a Business User is
meant to actually resolve a matching-exception task, in which case the
`Procurement.*` permission needs real completion rights for that one
task type, not just read-and-comment. **This needs a direct answer
before either `assign_task { role }` or `notify`'s own equivalent gets
built** — the two readings are genuinely different features.

Full reasoning appended to `docs/design/two-way-matching-exceptions.md`,
the same running document decisions 0464 and 0465 already extend.

## What was built

The design document updated in place: all six of decision 0464's open
questions marked answered with the operator's own wording quoted
directly; two of decision 0465's four newly-open questions answered by
the same round (how wide Business User access is, whether it extends
past Chat); a new `po.line_unit_mismatch` fact proposed to cover the
unit-of-measure gap; and a new section naming the PO-Buyer-routing-
versus-Business-User-scope tension explicitly, with two named readings
and no assumption between them.

## What was not built

Everything above is documentation. No schema, no vocabulary change, no
permission, no route, no screen. Two questions remain genuinely open:
where a non-PO invoice's requester is captured, and which of the two
readings of "route to PO Buyer" is correct.

## Still to do, operator side

Read the updated design document's new "tension" section and answer
directly: does routing a matching exception to "PO Buyer" mean the
Business User actually resolves the task, or does the task stay AP's
own and "PO Buyer" means bringing them into the conversation via chat?
That answer decides whether `assign_task` needs a new `{ role }`
resolution mode or `notify` does, and whether `Procurement.*` needs
real task-completion rights. Also still open: where a Non-PO invoice's
own requester gets captured. Nothing to deploy or apply — this
decision touches no running code and no migration.
