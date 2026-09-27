# 0513 — A chosen approver stops the invoice, Coding must be complete, and AP Setup can exclude who validated or coded it

**Status: pushed (`893d854`), deployed, and both migrations (`vf-app` `0092`, `vf-licence` `0180`) applied, as confirmed by the operator on 27 September.**

## What was asked

The operator tested decision 0512 live and reported:

> I observed sending in an item to validation, I clicked complete and
> the item went to Coding. I retrieved from the Coding stage, and did
> not enter the Account Coding detail on the line. I simply clicked
> Route to Approver, and selected myself as the Approver. The item
> bypassed approval, and went to AP Review, reporting that there was no
> ERP Identifier. So there are multiple issues with this flow.
> 1) The Coding stage does not check Account Coding has been completed.
> 2) The identification of an approver does not cause the item to stop
> in the Approval stage for that user. 3) I was able to select myself
> as an approver

The operator then answered three questions:

- **A chosen approver always stops the invoice at Approval**, even if
  none of the Approval stage's own rules fire.
- **Coding requires every coding field the stage lets a person edit**
  to be filled on every line before Complete or Route To Approver is
  allowed. There is nothing new to configure.
- **Self-approval is handled by configuration, not a blanket rule**:
  *"I would like a configuration option in AP Setup to 'Exclude
  Validation User from Approval of Invoices', and 'Exclude Coding User
  from Approval of Invoices'"*.

## What was found

**2. The choice only applied to a task a rule had already raised.**
`visitCurrentStage` creates a task at a stage only when one of that
stage's rules fires `assign_task`. For a stage marked
`uses_approval_hierarchy`, `resolveApprovalTargets` then decides who
gets it, and that is the only place the manual choice was read (0495).
So:

- An Approval stage whose rules didn't match this invoice raised
  nothing, and the invoice advanced.
- An Approval stage with **no rule set** never reached
  `visitCurrentStage` at all. `onTaskCompleted` walks automatic stages
  itself, and it doesn't know who was chosen.

Either way, the choice was silently dropped. 0480's ERP check at the
next hand-off was the first thing to stop the invoice, which is why it
surfaced at AP Review.

**3. Nothing excluded anyone.** 0512 had just scoped the picker to the
invoice's org, but anyone holding the permission there could be picked,
including the person routing it.

**1. Stage Restrictions controls what can be edited, not what is
required.** 0483 made a coding field editable or read-only per stage.
Neither Complete nor Route To Approver ever looked at whether those
fields held values.

## What was decided

### 2 — A chosen approver always gets the Approval task

- **`workflow-engine.ts`:** `visitCurrentStage` now raises the chosen
  approver's own task (`raiseChosenApproverTask`) at an Approval stage
  whose rules raised none, whether or not that stage has a rule set.
  The conditions are in `chosenApproverApplies`:
  - the stage uses the approval hierarchy and declares a permission;
  - the org is on Manual;
  - the choice hasn't been used yet in this cascade.

  When a rule *does* fire there, the choice already reaches that task
  through `resolveApprovalTargets`, as before. The new task belongs to
  that one person, carries the stage's permission, and has no
  `rule_id`, because no rule raised it.
- **`onTaskCompleted`** gained an `approverChosen` option. When set, it
  hands an approval-hierarchy stage with no rule set back to its
  caller as `needsEvaluationAt`, instead of walking straight past it.
  `index.ts` passes the option whenever a `targetUserId` was posted.
  Nothing changes for any other completion.

### 3 — Two AP Setup options

- **`vf-app` migration `0092`** adds
  `exclude_validation_user_from_approval` and
  `exclude_coding_user_from_approval` to `org_approval_config`. Both
  default to off, so live behaviour is unchanged on deploy.
- **`approval-config-route.ts`** returns both and accepts both as
  optional booleans on `PUT`. A save that omits them leaves them as
  stored, so every existing caller keeps working.
- **AP Setup's Approval Hierarchy form** shows them as two checkboxes
  under Default Approver, saved with the same Save.
- **Who counts** (`excludedApprovers` in
  `route-to-approver-route.ts`):
  - A **Validation user** is anyone who completed a task needing
    `AP.Validate` on this invoice.
  - A **Coding user** is the same for `AP.Code`.
  - The task being completed right now counts too, through its owner or
    claimer, because Route To Approver *is* its completion.
  - A stage is recognised by the permission its tasks carry (0200), not
    by its id, since stage ids are the customer's own choice.
- **Enforced in both places, from one function.** The picker leaves
  them out, and `checkChosenApprover` (0512) refuses them with a 422
  `approver_not_eligible`.

### 1 — Coding must be complete before Complete

`codingGapsForTask` (in `coding-validation.ts`) runs in the complete
route before the task completes, beside 0487's rule recheck.

- For each coding field the task's stage lets a person edit (from
  `resolveFieldVisibility`, at the invoice's own unit), every line must
  hold a value.
- Every value must also pass `checkLineCoding`, so a supplier's own
  invalid BT-133 (0511) has to be fixed here, not carried past the
  stage built to fix it.
- A refusal is a 422 `coding_incomplete` with a structured `gaps`
  list. The viewer shows it in the reader's own language, one line per
  gap (`codingGapsText`), both as Complete's alert and inside Route To
  Approver's picker.
- A stage where no coding field is editable is never affected. Nor is
  a task about no invoice, or an invoice with no lines.

**`vf-licence` migration `0180`** adds four strings in English and
German: the two AP Setup labels, the refusal heading, and "is missing".
A value that is present but not on the lists reuses 0511's own
phrases.

## What was verified, and how

Every new test was **watched fail** first, with the production change
stashed:

- **`vf-app` `-t 0513`:** 9 of 11 failed.
  - The 2 that passed are "a stage where Stage Restrictions made coding
    read-only demands none" and "excludes nobody while both options are
    off". Both are expected to pass either way.
- **`vf-ui` `-t 0513`:** both new tests failed.

The new tests cover:

- **Through the real router, the approver task:**
  - A chosen approver gets the Approval task, and the instance waits at
    Approval. This is tested twice: once when the Approval stage's rule
    never fires, and once when it has no rule set at all.
- **Through the real router, the coding check:**
  - Complete is refused with every editable coding field missing, then
    with a value that isn't on the lists, and allowed once both are
    valid. Nothing completes on a refusal.
  - A stage where Stage Restrictions made coding read-only demands
    nothing.
- **Through the real router, the exclusion:** "Exclude Coding User"
  removes the person completing the Coding task from the candidates,
  and refuses them on Complete.
- **The route directly, for the exclusions:**
  - Nobody is excluded while both options are off.
  - "Exclude Coding User" removes the Coding task's own person.
  - "Exclude Validation User" removes whoever completed an
    `AP.Validate` task on the invoice.
- **The configuration route:**
  - Both options read off by default.
  - A save persists them, and a later save that omits them leaves them
    as stored.
  - A non-boolean value gets a 400.
- **In the browser:**
  - The picker shows the translated gap list, one gap per line.
  - AP Setup shows both checkboxes with their stored state, and sends
    both with Save.

## What was not built, and what to watch for

- **The exclusions apply only to Route To Approver.** Employee-Supervisor,
  Cost-Object and the Default Approver fallback don't consult them. A
  resolved supervisor or cost-object owner who also coded the invoice
  still gets the task. Whether they should, and who it would go to
  instead, is a separate decision.
- **Any stage where coding is still editable now demands coding.** The
  check reads Stage Restrictions as it stands. If a stage *before*
  Coding (Matching, say) still has coding fields editable, completing a
  task there will now be refused until the lines are coded. **Check
  Stage Restrictions after deploying**, and make coding read-only
  anywhere it isn't meant to be done.
- **A refusal only happens once someone clicks.** The picker opens
  before coding is checked, and the refusal appears inside it. Checking
  earlier would need the candidates route to do the same work. It was
  kept to one check, in one place.
- Approval limits, a screen for `uses_approval_hierarchy`, and choosing
  an approver at the Approval stage itself are still open, as recorded
  at 0512.

## Verification

- **`vf-app`**, a full, unfiltered whole-suite run: 125 files and 3066
  tests, of which **3064 passed**. The two failures are the ones
  already confirmed on untouched `origin/main` (0511): `capture-pdf`'s
  "writes the corrected value back" and `stage-permissions`'s "names
  exactly the permissions the code defines". Neither is related.
- **`vf-ui`**: Worker 75/75. Browser 1196/1197. The one failure is the
  known `typography.test.ts` hardcoded-`10px` gap.
- **`vf-licence`**: 320/320, including `string-coverage.test.ts` with
  the four new keys.
- **`apply_migrations.py --replay-only`**: 92 migrations, all
  assertions held.
- **`check-citations.py`**: 513 records, none dangling.
- **`npx eslint`** on every touched file: clean, apart from one error
  that predates this change (`ap-setup.test.ts`'s unused `puts`, also
  present on `HEAD`).
