# 0512 — Route To Approver, scoped to the invoice's own org and checked by the server

**Status: pushed (`f56685d`) and `vf-app` deployed, as confirmed by the operator on 27 September.** There was no migration and no string change.

## What was asked

*"Lets look at Manual approval"*. This is the Handover's next item:
*"Manual and API modes still have no resolver"*.

## What was found

**Manual mode already has a resolver, and has done since decision
0495.** That handover line was out of date. With AP Setup's Approval
Hierarchy set to Manual, the task before a stage that uses the approval
hierarchy offers Route To Approver in place of Complete. Its picker
lists every holder of that stage's permission, and whoever is chosen
gets the Approval task. Decision 0497 added the optional comment.

Five gaps were found and put to the operator. **1 and 2 were chosen**:

1. **The picker offered people who could not approve this invoice.**
   `handleRouteToApproverCandidates` took every holder of the
   permission, anywhere. A role is held at a unit (0199, migration
   0047), and completing a task checks the permission at the invoice's
   own unit (0203, `index.ts`'s complete route). So someone who is an
   approver only at Acme DE could be chosen for an Acme UK invoice, and
   the Approval task then sat with a person who could never complete
   it. 0495's own test pinned the old behaviour: *"a unit-scoped grant
   still counts — this list is org-wide, not filtered by unit"*. That
   test only ever used an invoice with no org.
2. **The server trusted the picker.** `POST /tasks/:id/complete`
   accepted any `targetUserId` that existed. The resolver only checked
   existence. This is decision 0144's "a screen, not a route" gap.
   0495's own end-to-end test says it posts *"to prove the server does
   not merely trust whichever id a client sends"*, but it posted a
   valid candidate, so it never proved that.

Not chosen, and still open:

3. The chosen approver's approval limit is not consulted.
4. `uses_approval_hierarchy` can only be set in SQL.
5. An invoice that reaches Approval without a person completing the
   stage before it still falls back to the Default Approver.

## What was decided

**`approverCandidates` (in `route-to-approver-route.ts`) gives the same
answer `hasPermission` gives, for everyone at once.** A role held with
no unit counts everywhere. A role held at the invoice's unit, or at
anything above it (`unitLineage`), counts. An invoice not placed in any
unit asks "at all", exactly as `hasPermission(…, null)` does. That keeps
0495's no-org behaviour, and its test now says so by name. It is one
query rather than a `hasPermission` call per person.

**`checkChosenApprover` is the server's own check.** It runs in
`index.ts` before `handleCompleteTask`, so a refused choice leaves the
task open and creates no Approval task. It returns a 422 with
`reason: "approver_not_eligible"`. It applies only where Route To
Approver applies: the next stage uses the approval hierarchy, declares
a permission, and the org is on Manual. Anywhere else a stray
`targetUserId` is left exactly as 0495 left it, never read and never
refused. It checks against the same `approverCandidates` list, so the
picker and the check cannot disagree.

The viewer needed no change. Its picker already shows a server error
(0495's own test covers that). A 422 can now only come from a request
the picker would never have made, so its English message is fine.

## What was verified, and how

Every new test was **watched fail** first, with `route-to-approver-route.ts`
and `index.ts` stashed:

- **`route-to-approver-route.test.ts`**:
  - The candidate list is scoped: someone holding the permission at the
    invoice's operating unit, at its legal entity, or everywhere is
    offered, and someone holding it only at another entity is not.
  - `checkChosenApprover` refuses someone the picker would not offer,
    and anyone who doesn't exist.
  - It accepts someone the picker would offer.
  - It never refuses outside Manual mode.
- **`index.test.ts`**, through the real router: a `targetUserId` holding
  no `AP.Approve` gets a 422. The Coding task is still open, and no
  Approval task exists.

One 0511 test fix came along with this. `index.test.ts`'s *"works for
AP.Code alone and returns a real, aggregated suggestion"* seeded history
for a cost centre that didn't exist. It failed once 0511's suggestions
filter was really loaded. 0511's own full run had loaded the file before
that edit, which is why it was missed. It now seeds the cost centre.

## What was not built

Items 3, 4 and 5 above. The resolver in `approval-hierarchy.ts` still
checks only that the chosen user exists. The route is now the gate.
Nothing else calls the resolver with a manual choice.

## Verification

- **`vf-app`**, a full, unfiltered whole-suite run: 125 files and 3055
  tests, of which **3053 passed**. The two failures are the ones
  decision 0511 already confirmed on untouched `origin/main`:
  `capture-pdf.test.ts`'s "writes the corrected value back" and
  `stage-permissions.test.ts`'s "names exactly the permissions the code
  defines". Neither is related to this change.
- **`route-to-approver-route.test.ts` and `index.test.ts` together**:
  213/213. The four new tests all failed with the production change
  stashed.
- **`npx eslint`** on every touched file: clean.
- **`python3 scripts/check-citations.py`**: 512 records, none dangling.
- **`vf-ui` and `vf-licence`**: untouched.
