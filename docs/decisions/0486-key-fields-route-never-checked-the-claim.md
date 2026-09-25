# 0486 — `/invoices/:id/key` never checked the claim

**Status: built and verified locally, not yet committed/pushed at the
time of writing.** No push access from this session — delivered as a
git bundle, per this repo's own established handover mechanism.

---

## What was asked

Reported live: *"I was able to update the account coding for a non-po
invoice in the coding queue - when the item has not been claimed by my
user."*

## What was found

**The gap decision 0403 flagged but explicitly left unverified.** That
decision closed the client-side half of this exact bug for the line
table proper (`lineRow()`'s `cell()`), and said so directly in its own
"What is not built" section: *"No server-side check was added or
audited confirming the save endpoint itself would reject a line edit
posted for an unclaimed document, independent of what the UI shows...
whether the API also refuses one sent directly was not investigated as
part of this decision."* It did not, and this report is that gap made
real.

`POST /invoices/:id/key` (`handleKeyInvoiceFields`,
`key-fields-route.ts`) is the one route every keyed value — header
fields, line fields, and the three Account Coding fields the Coding
pop-out edits — actually saves through. Its authorization checked only
permission *scope* (`AP.Validate` OR `AP.Code`, decision 0456) and
which fields a stage permits editing (decision 0144/0164) — never
whether the invoice's open task at that stage was claimed by, or
assigned to, the caller. Anyone holding the right permission scope
could save onto any invoice sitting in an editable stage, claimed by
somebody else or not claimed at all.

**A real, working claim concept already exists elsewhere in this
codebase**, and this route was simply never wired into it:
`handleCompleteTask` (`task-route.ts`) checks `task.owner_user_id !==
completingUserId` for a named-user task, and `task.claimed_by !==
completingUserId` for a team task, inline — the established pattern,
not a shared middleware. Completing and releasing a task both already
enforce this correctly; only the field-save path never did.

**On the frontend, the matching gap was narrower but present too.**
`canEditAnything` (`viewer.js`) already gates the line table itself
(decision 0403's own fix) and the header fields (decision 0142/0288) on
`task.ownership === "mine"`. The Coding pop-out
(`openLineCodingPopout`, decision 0453) never joined it at all — its
only editability check was the field's own stage-configured
visibility, so an unclaimed task's three Account Coding pickers
rendered live and saveable regardless of who was asking. The pop-out's
own trigger button carried a comment claiming the pop-out "still
refuses to change anything... the same as every field already does" —
true of stage-configured visibility, not true of claim status, until
now.

## What was decided

Mirror `handleCompleteTask`'s exact inline-ownership pattern in
`handleKeyInvoiceFields`, and mirror `cell()`'s exact
`!canEditAnything` join in `openLineCodingPopout` — the same two fixes
decision 0403 already made for the line table, applied to the one path
that route never got either half of.

**Scoped to when an open task actually exists**, not to requiring one.
Every existing test for this route seeds an invoice in a process with
no task row at all, and keying has always succeeded there — that
reflects a real, if implicit, design: this route was never task-gated
to begin with, only field- and stage-gated, and the Documents screen's
own use of the viewer (decision 0167) opens a document with no task
behind it at all, correctly read-only client-side without this route
ever needing to know why. Requiring a task to exist would be a new,
unrelated restriction with no report behind it. What was reported, and
what this closes, is narrower and sharper: a task that **does** exist,
sitting unclaimed or claimed by somebody else, letting the save through
regardless.

## What was built

- **`workers/vf-app/src/key-fields-route.ts`**: a new check in
  `handleKeyInvoiceFields`, right after the invoice's own existence is
  confirmed. When the invoice has a process instance, it looks up
  every **open** task at that instance's **current stage**
  (`tasks -> stage_visits -> process_instances`, the same join
  `currentOpenTaskReason` in `invoice-facts-route.ts` already
  established for a different read) and refuses with 403
  `{"error": "this task is not claimed by you", "reason":
  "not_claimed"}` unless at least one of them has `owner_user_id` or
  `claimed_by` equal to the caller. No open task at that stage at all
  — the pre-existing, untouched case — changes nothing.
- **`workers/vf-ui/public/viewer.js`**: `openLineCodingPopout`'s field
  loop now renders read-only whenever `!canEditAnything`, joining the
  field's own stage-configured visibility exactly as `cell()` already
  does. The trigger button stays visible regardless (decision 0453 —
  opening the lookup is not itself an edit), its own doc comment
  updated to say so accurately.
- Tests: seven new cases in `workers/vf-app/test/key-fields.test.ts`
  (a new `describe` block) covering an unclaimed team task, a team
  task claimed by somebody else (the exact bug reported), a team task
  claimed by the caller, a named-user task belonging to somebody else,
  one belonging to the caller, the unchanged no-task case, and a
  completed task correctly no longer counting. Six new cases in
  `workers/vf-ui/test-browser/viewer.test.ts` covering the pop-out
  rendering read-only for a locked or available (unclaimed) task, not
  showing the unrelated "not editable at this stage" note for a
  claim-only restriction, the button still opening the pop-out, an
  already-stage-read-only field unaffected by ownership, and the
  unchanged claimed-by-caller case.

## What was not built

No change to `handleCompleteTask`/`handleReleaseTask`/`handleClaimTask`
themselves — already correct, and the precedent this fix mirrors. No
new shared `requireClaimedBy` helper — the inline-check-per-handler
shape is this codebase's own established pattern, not something this
decision should generalize unasked. No requirement that a task exist
at all to key fields — see "What was decided" above for why that would
be a different, broader change than what was reported.

## Verification

- `workers/vf-app`: `key-fields.test.ts` **66/66** (7 new, 59
  pre-existing unaffected — confirming the fix is additive, not a
  behaviour change for the untouched no-task case);
  `keying-respects-the-stage.test.ts` **11/11**;
  `task-route.test.ts` + `task-list-route.test.ts` together **90/90**,
  untouched by this change. `tsc --noEmit` shows no new errors in
  `key-fields-route.ts` (only the same pre-existing `cloudflare:test`
  noise this project has already documented repeatedly).
- `workers/vf-ui`: the Coding pop-out's own describe block **32/32**
  (6 new); full `viewer.test.ts` **204/204**; full browser suite
  **1123/1124** (the one failure a pre-existing, unrelated
  `document-window.test.ts` rejection, confirmed via `git stash` to be
  present identically on unmodified `main`); worker suite **74/74**,
  untouched by this change (no route or proxy-allowlist change was
  needed — this fix lives entirely inside an existing route and an
  existing screen).

## Still to do, operator side

Push and deploy `vf-app` and `vf-ui` — no new migration, no
`vf-licence` change. Once live, re-test the original report: open a
non-PO invoice's Coding task without claiming it (or as a second user
while another holds the claim), and confirm the Account Coding fields
now render read-only, both in the line table and inside the Coding
pop-out, and that a save attempt against the route directly would be
refused.
