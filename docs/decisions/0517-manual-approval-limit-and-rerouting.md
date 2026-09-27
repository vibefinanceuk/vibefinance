# 0517 — Manual approval: the approver needs a covering limit, or routes it on

**Status: pushed (`f064eea`), deployed, and migration `0182` applied, as confirmed by the operator on 27 September.**

## What was asked

*"Can we look at Manual limit check with re-routing"*. This is the
first gap decision 0516 recorded against the operator's own definition
of Manual:

> The user submitting this for approval can freely select among users
> in the company. The selected user needs approval limit to approve the
> document, and if that is not the case the selected user needs to
> select freely among the users in the company.

## What was decided

**`rerouteContext` (in `route-to-approver-route.ts`) is the single
test.** It returns a value only when all of these hold:

- the task's own stage uses the approval hierarchy and declares a
  permission;
- the org is on Manual;
- this person's approval limit, at the invoice's unit and in its
  currency (`resolveApprovalLimit`, decision 0439), does not cover the
  invoice total.

"Covers" is read exactly as Employee-Supervisor reads it:

- no limit recorded means no authority;
- an invoice with no total is covered by any limit;
- the amount is the header total (`total_with_vat`), because a Manual
  approval is of the document, not of one line.

Everything below uses that one test:

- **Complete is refused** with a 422 `approval_limit_insufficient`,
  giving the limit and the amount, before anything completes.
- **The task list swaps Complete for Route To Approver** on that task,
  the same swap 0495 makes on the stage before Approval.
- **The candidates route answers `reroute: true`** for that task. It
  offers the same list as the first Route To Approver (0512 org
  scoping, 0513 exclusions), minus the person themselves. The limit,
  amount and currency are returned alongside.
- **`POST /tasks/:id/route-to-approver`** (`handleRerouteApprover`)
  hands **the same task** on:
  - `owner_user_id` becomes the target, and any team or claim is
    cleared;
  - it records a `route_to_approver` task action event, with the
    optional comment, so the Timeline shows each hand-off.

  A new task would have meant completing this one, and completing the
  last open task at a stage advances the invoice. Handing the same task
  on keeps the invoice at Approval without any cascade. The target must
  be someone the picker would offer. The route is refused (409) when
  the person's own limit already covers the invoice, because they
  should approve it.
- **The chain continues naturally.** If the new approver's limit is
  also too low, the same test applies to them, and they route it on in
  turn.
- **`vf-ui`**:
  - The picker posts to the re-route route when the server says
    `reroute`, and shows why above the list.
  - The route is added to the proxy allowlist in this same change (the
    0484/0496 lesson).
- **`vf-licence` migration `0182`** adds that one note, in English and
  German.

## What to know before deploying

**In Manual mode, an approver with no approval limit recorded can no
longer approve.** Limits are set per person (Access → a person's
properties, 0334) or per org (AP Setup's limit overrides, 0440). Anyone
who approves in Manual mode today without a limit will be offered Route
To Approver instead of Complete. **Check that your approvers have
limits in the invoice currencies before deploying.**

## What was verified

Every new test was **watched fail** first, with the production change
stashed.

- **`index.test.ts`, through the real router:**
  - An approver over their limit gets a 422 on Complete. The task list
    offers Route To Approver instead, and the candidates answer
    `reroute`, never including the approver themselves.
  - Routing on hands the same task to the new approver, and the invoice
    stays at Approval with the comment recorded.
  - An approver whose limit covers the invoice completes normally, and
    can't route it on.
  - Routing on to someone who can't approve at the invoice's org is
    refused, and the task stays put.
- **`viewer.test.ts`:** the picker shows the note and posts to
  `route-to-approver`.

## Verification

- **`vf-app`**, a full, unfiltered whole-suite run: 125 files and 3074
  tests, of which **3072 passed**. The two failures are the ones
  confirmed on untouched `origin/main` since 0511.
- **`vf-ui`**: Worker 75/75. Browser 1198/1199. The one failure is the
  known `typography.test.ts` `10px` gap.
- **`vf-licence`**: 320/320.
- **`npx eslint`** on every touched file: clean, apart from the unused
  `loadStoredInvoiceLines` import in `index.ts`, which predates this
  change.
- **`check-citations.py`**: 517 records, none dangling.
