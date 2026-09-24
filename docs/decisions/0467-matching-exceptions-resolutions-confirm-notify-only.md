# 0467 — Matching Exceptions: Three Resolutions, and the Routing Tension Resolved

**Status: investigated and documented, not built.** Answers decision
0466's own open tension directly, with good news: all three named
resolutions map onto mechanisms that already exist and are already
fully built. No migration, no vocabulary change, no route, no screen.

---

## What was asked

*"There are limited actions that a Business User can perform in the
system. Resolutions should include 1) Changing the PO, outside of
VibeFinance. PO Changes uploaded to VibeFinance and matching exception
clears 2) Decision to proceed with payment, regardless of exception —
Business User to confirm in Chat 3) Return to supplier — Business User
to confirm in Chat."*

## What was found

Checked one at a time against the code, not assumed:

1. **PO corrected and reloaded** needs nothing new —
   `po-matching.ts` already recomputes every fact fresh on every
   evaluation, from decision 0081/0370's own PO load. The
   already-created task still needs completing (nothing auto-closes a
   task because the fact it was raised against later changed), but
   that is an AP holder completing an ordinary, now-agreeing task.
2. **Proceed with payment regardless** *is* ordinary task completion,
   exactly as it already works. Decision 0064 found this directly:
   *"Completion is completion... someone who reviews [it] and thinks
   it wrong has no way to say so through the task — they complete it
   and the instance advances."* Nothing checks the matching facts at
   completion time today, and nothing needs to for this to work — the
   Business User's chat confirmation is a process input read before
   completion, not a system gate.
3. **Return to supplier** maps exactly onto `AP.ReturnToSupplier`
   (decision 0075, `return-route.ts`) — real, enforced infrastructure,
   not a reserved-but-unused permission the way `AP.Match` still is.
   `checkStanding()` already requires the actor to hold
   `AP.ReturnToSupplier`, the task's own `required_permission`, and be
   holding the task (or `AP.ReturnAny`) — a read-and-comment-only
   Business User could not invoke this even if offered the chance,
   which matches "confirm in Chat" exactly.

**This resolves decision 0466's own tension in favour of the
notify-only reading, confirmed by all three examples, not assumed
from one**: a Business User never performs the system action for any
named resolution. "Route to PO Buyer" means bring them into the
conversation, not hand them a task — `assign_task { role: "po_buyer"
}` is no longer proposed. What "PO Buyer" routing actually needs is
the per-invoice ownership check already proposed for Chat access, so
that invoice's own named buyer can see and post to it.

**One real gap surfaced, not named before**: nothing today tells a
Business User an invoice needs their attention. The ownership check
gives them the *right* to look, not a reason to. `notify`'s own
delivery mechanism (email) is unbuilt — the same gap named in
`HANDOVER.md`'s own list. For a first version, a Business User checks
back on their own invoices rather than being told.

Full reasoning appended to `docs/design/two-way-matching-exceptions.md`.

## What was built

The design document updated in place: the three resolutions checked
against the code one at a time, the routing tension resolved in favour
of "notify, don't assign," `assign_task { role }` withdrawn as a
proposal, and the notification gap named plainly.

## What was not built

Everything above is documentation. No schema, no vocabulary change, no
permission, no route, no screen. Two questions remain from decision
0466: where a Non-PO invoice's own requester is captured, and whether
a real notification (versus check-back-yourself) is wanted for a first
version.

## Still to do, operator side

Nothing blocking — this decision closed the one open tension rather
than opening a new one. The two remaining open questions above are
worth an answer before build starts, but neither blocks starting on
the pieces already fully settled (schema, vocabulary split, tolerance
configuration, standard rules). Nothing to deploy or apply — this
decision touches no running code and no migration.
