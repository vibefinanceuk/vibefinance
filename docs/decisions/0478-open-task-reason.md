# 0478 — "Here Because": Why This Task Landed on You

**Status: built and verified locally, not yet committed/pushed at the
time of writing.** No push access from this session — delivered as a
git bundle, per this repo's own established handover mechanism.

---

## What was asked

Reported live, against invoice `TEST-PO-0003`, routed to AP Review:
*"There is an error at the top of the page saying 'This invoice
stopped moving because of a processing error: assign_task fired an
invalid task: {"error":"requiredPermission \"undefined\" is not in the
closed permission vocabulary"}'."* Traced and explained as a genuine
platform bug (below) — but answering it surfaced a broader product
question: *"I'm wondering if it makes sense to leverage the Error
message box at the top of the screen here for a broader set of
purposes. Right now when a task is created in a stage, it is because a
rule fires... However, for a user who retrieves that task, it is
difficult to initially tell why it has been routed to that stage...
Something like 'This item has been routed to you because of a
business rule being triggered - <Rule Name>.'"* Followed by two design
questions this decision settles: whether the rule's name should be
translatable given a customer writes it in their own language (*"the
business rule being the customer's own rule text... inherently in
whatever language they wrote it"*), and where on the page real estate
allows it to live. A mockup was built and shown directly (both
placement options, toggleable) before writing any code; the operator
picked Option A — *"I love option B, but I think it makes more sense
to be option A."*

## The bug that started it (already fixed by rule re-authoring, not code)

`assign_task`'s `requiredPermission` resolves through a three-source
fallback chain in `workflow-engine.ts`: the rule's own action params,
then `process_stages.required_permission`, then a caller-supplied
default. All three were `undefined` for "Supplier Not Matching in
ERP," because that rule's own sentence never named a permission and
AP Review (unlike Validation) has no stage-level default —
`vocabulary.ts`'s own documented convention (decision 0200) allows
omitting it *only* where the stage supplies one. A live diagnostic
query confirmed AP Review is not uniquely misconfigured — every
working rule elsewhere in this system states its own permission
explicitly, so re-authoring the rule to say *"...requiring AP.Review
permission"* is the fix, not a new stage-level default. The operator
did this themselves (*"Okay - I created a new version"*); nothing in
this decision touches permission resolution.

## What was decided

**A rule's own display name is translatable; the sentence it compiles
from is not.** A customer writes a rule in their own language, and an
international deployment still wants to say *why* in whichever
language the person looking at it reads — but only the *name* is short
and closed enough to sensibly hold a second-language variant per rule.
The full sentence stays exactly as authored, in whatever language that
was, shown on request rather than translated on the operator's behalf
— translating a legal/operational instruction without them asking
would put words in their mouth that don't quite match what they
wrote.

**Two different naming problems, two different mechanisms — not one
generalized "translated rule name" system.** The four standard
matching rules (`STANDARD_MATCHING_RULES` in `matching-config-route.ts`)
have code-known, stable names — the same kind of string every other UI
label in this codebase already gets translated through vf-licence's
`ui_strings` table, keyed this time by the rule's own stable `key`
(`po_line_not_found`, etc.), not by a runtime id. A customer's own
authored rule name (*"Supplier Not Matching in ERP"*) is created at
runtime, not known to the codebase ahead of time, and belongs in a new
table this decision adds, `rule_name_translations` — one row per
`(rule_id, locale)`.

**Placement: a slim line above the stage progress bar (Option A),
never merged into `workflowErrorPanel` (decision 0435).** Confirmed by
an interactive mockup shown directly to the operator, toggling between
this and "on the stage chip itself" (Option B) with the existing error
panel overlaid for comparison. Kept structurally separate on purpose:
`workflowErrorPanel` names an engine failure — something is stuck
because it broke. This names an ordinary, working rule outcome —
something is here because it was meant to be. Conflating the two would
make routine routing look like a fault, exactly the confusion this
was built to remove.

**Only the current task's own rule, only while open.** A completed
task, or one raised directly through the manual/API path (`task-route.ts`'s
own `POST /tasks`, no rule involved), has nothing to name — `null`,
not an empty string or a guess.

## What was found while building it

**A pre-existing, real gap in `workflow-engine.ts`, separate from the
permission bug above.** `evaluateRuleSet` (`shared/interpreter/evaluate.ts`)
has always paired each fired action with the rule that fired it
(`attributedActions: { ruleId, action }[]`) — `workflow-engine.ts`'s own
`assign_task` handling read the older, unattributed `actions` list
instead, discarding the rule id before a task was even created. No
existing task in any live deployment has ever recorded which rule
raised it; this decision is what first reads and stores it.

## What was built

- **`migrations/0079_task_rule_attribution_and_name_translations.sql`**:
  `tasks.rule_id` (nullable `TEXT REFERENCES rules(id)` — nullable for
  the same reason `stage_visit_id` is, decision 0009: a manually-raised
  task has no rule) and a new `rule_name_translations` table
  (`rule_id, locale, name`, composite primary key). Three standing
  invariants: a task's `rule_id`, when set, names a real rule; a
  translation names a real rule; a translation's locale is one this
  deployment's `i18n.ts` `SUPPORTED_LOCALES` actually knows. Verified
  via `apply_migrations.py --replay-only` — 79 migrations, all
  assertions held.
- **`workers/vf-app/src/workflow-engine.ts`**: `visitCurrentStage`'s
  `assign_task` handling switched from `result.actions` to
  `result.attributedActions`, threading `ruleId` through to a new
  `UPDATE tasks SET stage_visit_id = ?, line_number = ?, rule_id = ?
  WHERE id = ?` — the actual fix for the gap above.
- **`workers/vf-app/src/invoice-facts-route.ts`**: a new
  `currentOpenTaskReason(db, invoiceId, locale)` helper — joins the
  invoice's currently-open, rule-attributed task through
  `stage_visits`/`process_instances` (the same join `task-list-route.ts`
  already established) to `rules`, the latest `rule_versions` (for the
  raw sentence), and `rule_name_translations` for the requested locale.
  Resolves a standard rule's `standardKey` by matching against
  `STANDARD_MATCHING_RULES`'s own names, so the frontend can translate
  it through `t()` instead. `handleGetInvoice` gained a `locale`
  parameter (default `"en"`) and a new `openTaskReason` field on its
  response, placed directly beside `workflowStageError` — same
  "why, not just that" precedent (decision 0435).
- **`workers/vf-app/src/rules-list-route.ts`**: `handleGetRule` now
  also returns `nameTranslations`; a new `handleSetRuleNameTranslation`
  function, modeled directly on `handleRenameRule` (decision 0266) —
  validate, confirm the rule exists, write one row, return. A blank
  name **deletes** the translation row rather than storing an empty
  string — clearing the field is asking for the fallback, not for a
  visible blank.
- **`workers/vf-app/src/i18n.ts`**: new `unsupportedLocale` message key
  (all six `SUPPORTED_LOCALES`), for a locale path segment that isn't
  one this deployment knows.
- **`workers/vf-app/src/index.ts`**: `GET /invoices/:id` now reads
  `?locale=` from the query string and passes it through — **per
  request, not per deployment**, unlike `resolveLocale(env.LOCALE)`
  used everywhere else in this file for backend error messages: this
  field is read by whoever has the invoice open right now, in
  whichever language their own picker is set to, the same per-viewer
  locale every UI string this session has added already resolves
  against. New route `PUT /rules/:id/name-translations/:locale`,
  modeled on the existing `PUT /rules/:id/name`, gated by
  `Admin.RuleManagement`.
- **`workers/vf-ui/src/index.ts`**: the new name-translations route
  added to `PROXIED_TO_INSTANCE` — closing the proxy-allowlist gap
  before it could recur, the same class of bug decisions 0418–0431,
  0441, 0473, 0474, and 0476 have each found and fixed once already.
- **`workers/vf-licence/migrations/0163_open_task_reason_strings.sql`**:
  EN/DE strings for the banner's own chrome (`invoice.reasonline.label`,
  `invoice.reasonline.expand`) and the four standard rules' own display
  names, keyed by their stable `key` (`matching.standardrule.<key>.name`)
  — deliberately through the ordinary string table, not
  `rule_name_translations`, per the two-mechanism split above. Also:
  `rule.germanname`/`rule.setgermanname`/`rule.editgermanname`/
  `rule.germannameprompt`/`rule.nogermanname` for `rule.js`'s own new
  affordance.
- **`workers/vf-ui/public/viewer.js`**: `loadInvoice` now sends
  `?locale=${currentLocale()}` and stores the new `openTaskReason`
  field. New `reasonLinePanel()` — renders nothing when there is no
  open task reason; otherwise the rule's name (resolved through `t()`
  by `standardKey` for one of the four standard rules, otherwise the
  name the backend already resolved for this locale), with a
  click-to-expand detail showing the raw, never-translated sentence.
  Composed into `.c-process` between `workflowErrorPanel()` and
  `progressRow()`.
- **`workers/vf-ui/public/app.css`**: `.panel.reasonline` and its
  children — deliberately does **not** borrow `.needsattention`'s
  warning-colored left border, since this names the opposite of a
  fault.
- **`workers/vf-ui/public/rule.js`**: a second row beside the existing
  name/rename control (decision 0266), shown only once the rule has an
  English name to translate. **German only**, matching `strings.js`'s
  own `LANGUAGES` list — a control for one of the four
  `SUPPORTED_LOCALES` the language picker doesn't expose would be a
  menu that does nothing, the same reasoning `strings.js`'s own comment
  already gives for keeping those four off the picker. `window.prompt`,
  matching `rename()`'s own established pattern — unlike `rename()`, an
  *empty* answer here is meaningful (clears the translation) rather
  than a no-op; only an actual Cancel (`null`) does nothing.

## What was not built

No third or later language exposed anywhere in this feature — German
is the only locale `rule.js` offers a translation control for, because
it is the only one the language picker offers a person to switch into
(decision 0302). No retroactive backfill: every rule authored before
this migration has `rule_id = NULL` on its existing tasks (the
migration only changes what gets written *from now on*) and no
`rule_name_translations` rows — the banner simply shows nothing for a
task raised before this shipped, same as it does for a manually-raised
one. No change to `ap-setup.js`'s own Standard Matching Rules panel,
which still reads `standard.name` directly rather than through the new
`matching.standardrule.<key>.name` string keys — a real, named
follow-up, not done here.

## Verification

`workers/vf-app`: `test/workflow-engine.test.ts` **60/60** (2 new,
covering rule attribution on a fired `assign_task` and its absence on
a manually-created task), `test/rules-list.test.ts` **43/43** (6 new,
covering translation write/read/overwrite/delete/404/locale-validation),
`test/key-fields.test.ts` **56/56** (6 new, covering `openTaskReason`
absent/present/translated/standard-key/completed-task/manual-task).
`test/invoice-facts-route.test.ts` + `test/fraud-duplicates.test.ts` +
`test/invoice-history.test.ts` together **45/45**. A further 934
tests run in batches across every file touching `tasks`/`rules`/task
routes — all pass except one pre-existing, unrelated failure
(`stage-permissions.test.ts`'s closed-permission-set check, missing
`AP.Manager` from a SQL list — confirmed present on unmodified
`origin/main` via `git stash`, not introduced here). `tsc --noEmit`
shows no new errors in any touched file (only the same pre-existing
`cloudflare:test`/unrelated-file noise already documented repeatedly
in this session).

`workers/vf-licence`: migration chain replays clean —
`apply_migrations.py --replay-only --migrations-dir
workers/vf-licence/migrations`, 163 migrations, all assertions held.

`workers/vf-ui`: browser suite (`vitest.browser.config.ts`)
**1090/1091** — the one failure is `typography.test.ts`'s existing,
unrelated hardcoded-`10px` finding in `.collabchip .activityavatar`,
confirmed present on unmodified `origin/main`. `test-browser/rule.test.ts`
**26/26** (5 new). `test-browser/viewer.test.ts` **186/186** (5 new).
The pre-existing 214 unhandled-rejection warnings across the file
(gaps in older describe blocks' own local fetch stubs, predating
`collaborators.js`/`activity.js`) are unchanged in count from
unmodified `origin/main` — not introduced by this decision, and this
decision's own new describe block uses the file's shared `stubFetch`
helper (which already defaults those two routes) rather than adding to
that class of gap.

`workers/vf-app/test/setup.ts` updated to load migration 0079 into the
test schema (imported, added to the table drop order, applied) — every
test in the suite runs against the real, current schema rather than
one frozen at migration 0078.

## Still to do, operator side

Push and deploy this decision (`shared` untouched; `vf-app`, `vf-ui`,
and a `vf-licence` migration all involved). Apply migration `0079`
against `vf-app-poc` and migration `0163` against `vf-licence-poc`.
Nothing else — no data migration, no re-authoring required; existing
rules and tasks simply show no reason line until a fresh task is
raised against them.
