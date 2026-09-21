# 0430 — "Talk to an AP Expert," Screen 6, the sixth and last AP Analytics tab

**Status: original build pushed and deployed, confirmed directly —
addendum below not yet delivered.** `origin/main` fetched directly
reads `df32830`, matching this session's own commit exactly for the
original four-tool build; the operator separately confirmed vf-licence
migration `0140` applied remotely too. The addendum below (five more
tools, and a real bug from live testing) is built and tested but not
yet committed or delivered as of this note — see its own section for
what changed and why. This session still has no push access to
`vibefinanceuk/vibefinance`; delivered as a git bundle for the
operator's own pull/push/deploy sequence, the same path decisions
0391, 0415–0429 already used.

---

## What was asked

The operator's own words, following decision 0426's discovery that the
design document names a sixth screen this repo had never once tracked:

> okay thank you I think lets try part 6 next. "Talk to an AP Expert -
> needs a new `AP.Assistant` permission, sequenced last by design"

The design document itself (read directly — `mcp__Claude_Docs__read`
against the live artifact, not this repo's own prior summary of it,
the same discipline decision 0426 established) describes a
conversational tab inside AP Analytics: a person types a plain-language
question about live AP data and gets a plain-language answer back,
without first finding the right screen or report. Its own worked
example: *"what's our overdue balance with Acme this month."* Its own
Role-Based Access Model row: a new, dedicated `AP.Assistant`
permission, *"deliberately not implied by any existing grant, since
this is the one screen that answers open-ended questions rather than
rendering a fixed, reviewed report,"* with *"each tool call [running]
through the same `hasPermission`/`unitClause` checks as the screen it
stands in for."* Its own architecture: a small, fixed, reviewed set of
named tool calls — explicitly **not** open text-to-SQL against D1. Its
own Recommended Phasing sequences it last, Phase 5, because its tool
palette wraps the scoped query functions the other five screens' own
routes already build — it has the least to stand on until they exist,
which by decision 0429 they now do.

## Three genuine forks, surfaced rather than assumed

The design's own worked example — *"overdue balance with Acme"* —
matches no existing concept in this codebase, and closing that gap
plus the tab's own answer style and its persistence both had more than
one reasonable resolution. Each was put to the operator directly
rather than decided silently:

1. **What "overdue" honestly means here.** Checked directly: this
   codebase has no concept of "overdue" anywhere (confirmed by grep),
   and — established earlier in this same session, researching Peppol
   BIS Billing 3.0 for decision 0429 — no payment-execution data at
   all, so there is no way to know whether an invoice was actually
   paid late. **Chosen: "still-open invoices past their due date"** —
   an invoice still accruing (decision 0417/0418's own definition:
   `process_instances.status = 'in_progress'` and its current stage's
   `sequence` is not yet the process's own final stage) whose `BT-9`
   due date has already passed. Never a claim about payment; the tool
   and the model's own answer-phrasing prompt both say so explicitly.
2. **How the final answer gets phrased.** Once a tool call returns
   real, verified numbers, does the assistant's reply show that
   structured result directly, or does a second model call phrase a
   sentence around it? **Chosen: the model phrases the final answer**
   — closer to what "talk to an expert" implies, at the cost of a
   second model call per question.
3. **Whether this first build persists chat history anywhere.**
   **Chosen: ephemeral for now** — resets on reload, no new table, no
   `localStorage`. The simplest thing that could work for a first
   build behind a brand-new permission nobody has been granted yet.

## What was built

**A new permission, `AP.Assistant`** (`permissions.ts`), gating the
chat tab itself, not any of the data behind it — the design's own
distinction, quoted above. Nobody is granted this by any migration;
who holds it is an operator decision made through the Access screen,
like every other permission in this system.

**`GET /liabilities/overdue-balance`** (`overdue-balance-route.ts`), a
standalone, independently-permissioned, independently-tested route —
gated on `AP.Analysis`, not `AP.Assistant`, and **deliberately not
wired into the Financial Performance tab**: the design's own
Liabilities & Accruals key-metrics list (Screen 4) names six metrics,
and "overdue balance" is not one of them. It exists solely to back the
assistant's own `overdue_balance` tool call, said so in its own doc
comment, to avoid the mistake of quietly growing a screen nobody asked
to extend. Implementation: still-accruing invoices (reusing decision
0417/0418's own definition directly, not a new one) whose `BT-9` has
passed today, grouped by `(supplier, currency)`, ranked largest first.

**`POST /ap-assistant/ask`** (`ap-assistant.ts`), gated `AP.Assistant`.
Two model calls per question, both built on decision 0002's own
existing `CompilerModel`/`AiRunnable`/`createWorkersAiCompilerModel`
infrastructure — reused verbatim rather than duplicated, the same
"swappable, provider-agnostic" interface that infrastructure's own doc
comment already promises, and the same discipline `extractJson`'s own
reuse across the rule compiler and this feature already follows:

1. **Tool selection.** The question, plus a hand-written description
   of exactly four tools and nothing else, goes to the model with
   strict instructions to reply with only a JSON object naming one
   tool (and, optionally, a supplier name to filter by) or refusing
   with a plain-language reason. `parseToolSelection` (pure function,
   directly tested) treats anything else — unparseable JSON, an
   unknown tool name, no tool at all — as a refusal, never a guess.
2. **Permission check, per tool, at call time.** Before running
   anything, the selected tool's own real permission is checked —
   `AP.Supplier` for `supplier_spend`, `AP.Analysis` for
   `overdue_balance` and `accrual_summary`, `AP.FraudReview` for
   `exception_counts` — exactly the design's own words: *"each tool
   call runs through the same checks as the screen it stands in for."*
   Holding `AP.Assistant` alone answers nothing; a person's chat
   answers are scoped exactly the way their screens already are, never
   more. Failing this returns a plain sentence naming the missing
   permission, not a silent wrong answer.
3. **Running the tool.** Each of the four tools calls straight into an
   existing, already-shipped route handler — `handleSupplierSpend`,
   `handleAccruals`, `handleFraudExceptionTrends`, and the new
   `handleOverdueBalance` above — and, where relevant, filters the
   real result by a supplier name the model extracted. No new query
   logic duplicated; every number the assistant can ever surface is a
   number one of the five other AP Analytics tabs would show the same
   person today.
4. **Answer phrasing.** The tool's real, verified JSON result goes
   back to the model with instructions to write one or two plain
   sentences using only those numbers — never inventing, estimating,
   or claiming payment timing the data cannot support — and a fallback
   message if the model's reply comes back empty.

**A fourth screen tool, `exception_counts`**, alongside `supplier_
spend` and `accrual_summary` (both reused as-is) and `overdue_balance`
(new, above) — the assistant's four tools are exactly the design's own
described palette, wrapping Screen 4's accruals metric, Screen 3's
supplier spend, Screen 5's exception trends, and the new overdue-
balance route, one call each.

**The chat panel itself** (`ap-assistant.js`), the sixth tab on AP
Analytics (`ap-analytics.js`), gated `AP.Assistant` in the tab list the
same way every other tab is gated. Deliberately not shaped like the
other five tabs' `load()`/`renderCard()` pattern — there is no card to
render, no report to fetch on tab-open. A module-level `history` array
(ephemeral, per decision above), a message list, an input row, a
"Thinking…" placeholder while a question is in flight, and a plain
error message on any failure. New CSS block in `app.css` for chat
bubbles, reusing existing design tokens throughout, no new ones
introduced.

**New i18n strings** — `workers/vf-licence/migrations/0140_talk_to_
an_ap_expert_strings.sql`, 8 keys × 2 locales (English, German),
following the established `ui_strings` migration pattern exactly.

**Both new `vf-app` routes had to be added to vf-ui's own proxy allow-
list** (`workers/vf-ui/src/index.ts`'s `PROXIED_TO_INSTANCE`) —
checked directly, not assumed: neither `/liabilities/overdue-balance`
nor `/ap-assistant/ask` matches any existing wildcard regex on that
list, the same recurring gap decisions 0418 through 0425 already found
and fixed for their own new routes each time. Missing this would have
shipped a chat panel whose every question came back as a proxy-level
404, not a route-level failure — the exact failure mode `test/
index.test.ts`'s own `CALLED_BY_A_SCREEN` block exists to catch, and
now does: both paths added there too, with the same doc-comment
discipline every prior entry in that block already follows.

## A second, unrelated invariant this decision's own change broke

Adding `AP.Assistant` to `permissions.ts` broke `test/stage-
permissions.test.ts`'s own "the closed set, in two places" check — a
standing invariant (decision 0200, restated by migrations 0062, 0063,
0066, and 0071) that every permission the code defines must also
appear in a SQL `ASSERT ALWAYS` restatement of the full vocabulary,
because SQLite cannot import a TypeScript constant. Fixed the same way
decision 0071 fixed it for `AP.FraudReview`: a new migration,
`0074_ap_assistant_permission.sql`, restating the full 34-permission
closed set with `AP.Assistant` now included. No schema change —
`process_stages.required_permission` already accepts any text, checked
only by this restated invariant. `AP.Assistant` will in practice never
be assigned as a stage's `required_permission` (it gates a screen, not
a workflow stage), the same as `AP.FraudReview`; it is listed in the
closed set anyway because the set is defined as "every permission the
code recognizes," not "every permission a stage could require."

## A pre-existing test-infrastructure gap, found and deliberately left alone

While adding the new `ui_strings` migration, `workers/vf-licence/
test/setup.ts` was found to only import and apply UI-string migrations
through `0126_documents_showing_exceptions_and_aging.sql` — roughly
thirteen to fourteen later migrations (0127 through what is now 0140),
covering essentially all of the AP-Analytics-era screen work from
decision 0417 onward, were never wired into that test harness's
`applyTestSchema()`. Before assuming this needed fixing, `test/
string-coverage.test.ts` — the test that would supposedly catch a UI
key with no backing string — was run in its current, unmodified state
first, and it passed 10/10 despite the gap: its own hand-maintained
`KEYS_THE_INTERFACE_USES` list also never got extended for any of
those screens, so the gap is internally consistent and long predates
this session's own 0415–0429 arc, not something this decision's change
exposed. **Left untouched**, matching this session's own repeated
discipline against silently fixing unrelated pre-existing issues while
building something else — but flagged here explicitly rather than
absorbed quietly, since the operator should know it exists. Confirmed
directly: `workers/vf-licence`'s own full suite still passes 320/320
unchanged after adding migration `0140`, which is exactly what an
unwired-in migration should do.

## Tests

**`workers/vf-app/test/overdue-balance-route.test.ts`** (new, 12
tests): permission-gate tests (200 with `AP.Analysis`, 401 with no
session, 403 with the wrong permission); "what counts as overdue" (6
tests — counts a still-open, past-due invoice; excludes one whose due
date hasn't passed; excludes one with no due date recorded at all;
excludes one at the final, payment-eligible stage even past due;
excludes a completed process instance; empty result when nothing is
overdue); "grouped by (supplier, currency)" (3 tests — sums multiple
invoices for one supplier/currency; splits multi-currency into
separate rows; ranks the largest total first).

**`workers/vf-app/test/ap-assistant.test.ts`** (new, 17 tests):
`parseToolSelection` as a pure function (7 tests — a valid call with no
args, one with a supplier filter, tolerating surrounding prose,
refusing an explicit "none," refusing an unknown tool name, refusing
non-JSON text, dropping a non-string supplier argument); permission-
gate tests via a real fetch (401 no session, 403 with `AP.Analysis`
but not `AP.Assistant`); request validation (400 on an empty, non-
string, or over-500-character question); a refusal shown to the person
verbatim; a per-tool permission-missing case that names the actual
missing permission without running the underlying query; two real
end-to-end cases seeding real DB data (an `accrual_summary` question
whose answer is asserted to be the model's own canned phrasing, and
whose second model call is asserted to actually contain the real
number computed from the seeded data; a `supplier_spend` question
filtered by name, asserting the phrasing prompt contains the matching
supplier and not the excluded one); a fallback message when the
phrasing model returns only whitespace.

**`workers/vf-app/test/stage-permissions.test.ts`** — updated to
include the new migration `0074` in its closed-set comparison; passes
again with `AP.Assistant` in both places.

**`workers/vf-ui/test/index.test.ts`** — two new `CALLED_BY_A_SCREEN`
entries, `GET /api/liabilities/overdue-balance` and `POST /api/ap-
assistant/ask`, proving both reach `vf-app` through the proxy rather
than being silently refused with a 404.

**`workers/vf-ui/test-browser/ap-analytics.test.ts`** — the sixth tab
added to the existing "every tab" test and the "only its own permission"
coverage, plus a new `describe` block (4 tests) for the chat panel
itself: the empty state, sending a question and seeing a real stubbed
answer render, an error message when the request fails, and the input
clearing and re-enabling once an answer lands.

**Full suites, run directly:**

- `vf-app`: 2287 → **2316** (29 new: 12 + 17), all passing, `eslint`
  clean on every changed and new file.
- `vf-ui`: Worker-side 74/74 unchanged in count (only reachability
  entries added, no new `it` blocks); browser suite 910 → **915**
  (4 new chat-panel tests, plus 1 from widening the "every tab" test's
  own coverage). Two pre-existing, unrelated unhandled-rejection
  errors in `document-window.test.ts`/`documents.test.ts` were checked
  directly against the unmodified baseline commit (`b7aa393`) and
  reproduce identically there — not caused by this decision, not fixed
  here, out of scope.
- `vf-licence`: 320/320 unchanged, confirming the pre-existing test-
  harness gap noted above rather than a regression.
- `migrations/test_apply_migrations.py`: **23/23 passing**, run
  directly and in isolation (that file's own test count is independent
  of the migration count it exercises); migration `0074` applies
  cleanly alongside the rest.

## What is not built

- **Open text-to-SQL.** Explicitly ruled out by the design document
  itself, and never considered here.
- **Persisted chat history.** Ephemeral by the operator's own choice —
  see the forks above. A future decision, if ever wanted.
- **The design's own sketched "standalone remote MCP server" option**
  for this screen — explicitly out of scope for the document itself,
  not merely deferred here.
- **Vendor banking-detail-change alerts**, Fraud & Risk Detection's own
  last unbuilt metric, and the Multi-Enterprise CFO View's own
  remaining five metrics — both pre-existing gaps, unrelated to this
  decision, still open.
- **A fifth or sixth assistant tool.** The four built are exactly the
  design's own described palette; nothing else was added speculatively.

With this decision, all six of the Management Dashboard design's own
screens now have at least one real, tested, deployed-pending vertical
slice behind them.

---

## Addendum — nine tools, and the tasks-vs-exceptions bug live testing found

The operator ran the deployed assistant against real questions and
shared the transcript directly. Seven of eight were handled correctly
— refusing "how many users are set up," "a link to the latest invoice"
(no "latest" concept exists), and "documents received since a date,"
none of which any of the four original tools cover, and answering
"where are items in the workflow" and "most active supplier"
correctly from real `accrual_summary`/`supplier_spend` data. **One was
a real bug**, reported back and investigated before anything was
changed: *"Who has the most tasks assigned? — Alice McDonald has the
most tasks assigned, with 2 tasks."*

**Root cause, confirmed by reading the code the live answer actually
ran, not assumed from the symptom.** No tool answers task-assignment
questions at all. `exception_counts`' own description said "broken
down by supplier, **by user**, and by type" — close enough in wording
that the selection model chose it for a "who has the most tasks"
question instead of refusing. The tool then genuinely ran (real SQL,
real permission check) and returned `byUser: [{userName, total}]`,
where `total` counts *exceptions*, not tasks — and the phrasing model,
told to answer the person's own question using that data, relabeled
the count to match the question's own wording rather than the data's
own meaning. **This is the same per-person exception ranking decision
0428's own second addendum pulled from the Workload screen live**,
over a real governance concern about naming individuals in a ranked
list under a broad gate with nothing enforcing the "not to assign
blame" subtitle. This bug let that exact data resurface through the
assistant anyway — mislabeled, and outside whatever review the
Workload screen's own removal was meant to enforce.

The operator's own follow-up, in one message: *"Yes, please fix - Also
the tool should be able to inquire upon purchase orders, invoices,
duplicates, tasks and provide links to documents."* Both handled
together, since the fix and the expansion touch the same file.

### The fix — two layers, not one

1. **A real, correctly-matching tool now exists.** `tasks_by_user`
   wraps `handleWorkloadOpenTasks` (decision 0428's own already-shipped
   route), gated `AP.Analysis` — real, current open-task counts per
   person, exactly what "who has the most tasks" asks for.
2. **Every tool's own result is named after what it actually counts**,
   not a shared, ambiguous `byUser`. `exception_counts` now returns
   `exceptionsPerPerson`; `tasks_by_user` returns `openTasksPerPerson`.
   A field name that could be misread as the other tool's own data is
   what let the model relabel the number in the first place.
3. **The selection prompt now contrasts neighbours explicitly** rather
   than describing each tool in isolation — `exception_counts`' own
   entry says outright *"never about how many tasks someone currently
   has open, which is a different tool below"* and `tasks_by_user`'s
   says *"It has nothing to do with validation failures or
   exceptions."*
4. **The answer-phrasing prompt now says, generally, not to relabel a
   number** — *"never rename or reinterpret what a number counts (for
   example, a count of exceptions is never 'tasks,' and a count of
   open tasks is never 'exceptions')"* — a safeguard against the same
   class of mistake recurring with a tool not yet built.

### The five new tools

- **`tasks_by_user`** — above. `AP.Analysis`.
- **`purchase_order_status`** — counts of purchase orders by status
  (active, on hold, closed, partially invoiced, fully invoiced),
  wrapping `handleGetPurchaseOrderStatusCounts` (decision 0377,
  already shipped). `AP.Validate`, the same permission the Purchase
  Orders screen itself uses. No arguments.
- **`purchase_order_lookup`** — one order's own detail by its order
  number, wrapping `handleGetPurchaseOrder` (decision 0081/0375,
  already shipped). `AP.Validate`. Requires `orderNumber`; the model
  is refused with a plain request for the number rather than guessing
  or running the tool with nothing to look up, the same discipline
  every required-arg tool below follows.
- **`duplicate_invoices`** — invoices flagged as possible duplicates,
  ranked by confidence, wrapping `handlePossibleDuplicates` (decision
  0420, already shipped — the design's own `duplicate_confidence`
  scoring, not a new detection system). `AP.FraudReview`. Optional
  `supplier` filter, capped at the top 10 by confidence.
- **`invoice_lookup`** — one invoice's own detail by its printed
  number, including its current workflow stage and, when one is
  retained, a real, short-lived signed link to its document.
  `AP.Validate`. Requires `invoiceNumber`.

**`invoice_lookup` needed a new route, `invoice-lookup-route.ts`** —
not a reuse of `handleGetInvoice` (the keying screen's own handler),
which hydrates buyer/supplier detail, every line's own facts, and a
live validation verdict that a one-sentence chat answer has no use
for, and which does not report the one thing actually asked for here:
which workflow stage the invoice is at. A new, small, purpose-built
query instead, following `overdue-balance-route.ts`'s own precedent —
join `invoice_headers` to `process_instances`/`process_stages` for the
stage, `suppliers` for the name, and `invoice_documents` for whether a
document exists, scoped by `AP.Validate` and the org-unit clause every
sibling route already uses. **`invoice_number` is not unique** —
checked directly, no `UNIQUE` constraint exists, and two suppliers can
genuinely reuse the same numbering scheme — so every match is
returned; the tool surfaces an ambiguous result rather than silently
answering about the wrong company's invoice, and the answer-phrasing
prompt is told to list what it found and ask which one was meant.
Wired as a real, independently-reachable `GET /invoices/lookup?number=`
endpoint (`AP.Validate`), the same "every capability is a real
endpoint, not only a function the assistant can reach" precedent
`overdue-balance-route.ts` already set.

**Document-link minting was extracted, not duplicated.** The existing
`POST /invoices/:id/document-url` route (decision 0073) had its own
"which document, chosen once" logic written inline inside `index.ts`.
Pulled out into `handleMintDocumentUrl` (`document-route.ts`) so
`invoice_lookup` calls the identical function rather than a second,
independently-drifting copy of the same choice — `index.ts`'s own
route now calls it too, one implementation, two callers. A link is
only ever minted once `invoice_lookup` has resolved to exactly one
unambiguous invoice, never for every candidate in an ambiguous match.

**A correction to this decision's own original text, above.** It
claimed adding `/liabilities/overdue-balance` to vf-ui's proxy
allow-list was necessary because "missing this would have shipped a
chat panel whose every question came back as a proxy-level 404." On
review while building this addendum, that is not accurate: the chat
panel only ever calls `POST /api/ap-assistant/ask` from the browser —
every tool's own underlying route is called as a direct, in-process
function call from `ap-assistant.ts`, never a second browser fetch.
`/api/ap-assistant/ask` genuinely did need proxying, and still does;
`/liabilities/overdue-balance` did not, though adding it was harmless
and consistent with this codebase's general practice of keeping every
`vf-app` endpoint reachable through the proxy. Recorded here rather
than silently edited into the original text above, per this project's
own "records are dated, contradictions are real" discipline — the
original text stands as written, and this note is what corrects it.
`invoice_lookup`'s own new `GET /invoices/lookup` route was
deliberately **not** added to vf-ui's proxy list or `CALLED_BY_A_
SCREEN` for this same reason: nothing in the browser calls it, so
claiming a screen reaches it would repeat the same inaccuracy.

## Tests (addendum)

**`workers/vf-app/test/invoice-lookup-route.test.ts`** (new, 9 tests):
permission-gate tests (200 with `AP.Validate`, 401 no session, 403
wrong permission, 400 with no `?number=`); real lookups — empty when
nothing matches, finds a real invoice case-insensitively, reports the
real current workflow stage, returns every match when a number was
reused across suppliers rather than guessing, and reports whether a
document is retained.

**`workers/vf-app/test/ap-assistant.test.ts`** (15 new tests, 17 → 32):
three more `parseToolSelection` cases (`orderNumber`, `invoiceNumber`,
a no-arg `tasks_by_user` call); the bug-fix regression itself — asserts
`exception_counts`' own result never contains a `byUser` field a
phrasing model could misread, and that `tasks_by_user` answers "who
has the most tasks assigned" from real, seeded open-task counts;
`purchase_order_status`/`purchase_order_lookup` against real seeded
orders, including the required-`orderNumber` refusal and an honest
not-found; `duplicate_invoices` against a real flagged invoice;
`invoice_lookup` end to end, including a **real minted document
URL** (a fake secret passed directly to `handleAskApAssistant`, since
this sandbox's own test config deliberately omits a real
`DOCUMENT_URL_SECRET` — see `wrangler.test.jsonc`'s own comment on the
`ai` binding for why declaring bindings a test doesn't need is
avoided here), a plain "no document on file" case, a refusal to guess
"the latest" invoice, and the ambiguous-match case surfacing both
suppliers rather than picking one.

**Full suites, run directly:** `vf-app` 2316 → **2340** (24 new: 9 in
the new `invoice-lookup-route.test.ts` plus 15 added to
`ap-assistant.test.ts`), all passing, `eslint` clean on every changed
and new file. `vf-ui` untouched — no frontend change was needed; the existing
chat panel already POSTs any question to the same endpoint regardless
of which of the now-nine tools answers it. No new migration, no new
permission — all five new tools reuse `AP.Analysis`, `AP.Validate`,
and `AP.FraudReview`, already held by whoever already sees the
Workload, Purchase Orders, and Fraud Prevention screens respectively.

## What is not built (addendum)

- **A tenth tool for "documents received since a date."** No route
  anywhere in this codebase currently answers that question at all
  (checked directly) — a real gap, not assumed solvable here, and
  outside what was asked.
- **A user-count tool.** Correctly refused live; nothing in the
  operator's own follow-up asked for it.
- **PO-to-invoice matching detail beyond what already exists.** *"How
  many unmatched purchase orders exist"* was correctly refused live —
  `AP.Match` (three-way match) remains an explicit placeholder,
  unbuilt since decision 0010, and `purchase_order_status`'s own
  status counts do not include an "unmatched" state because none
  exists in this schema's own closed vocabulary of order statuses.
