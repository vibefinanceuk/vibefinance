# 0430 — "Talk to an AP Expert," Screen 6, the sixth and last AP Analytics tab

**Status: original build and all three addenda pushed and deployed,
confirmed directly.** `origin/main` fetched directly reads `b084859`,
matching this session's own commit exactly for the original four-tool
build, the first addendum (five more tools, the tasks-vs-exceptions
bug fixed), the second addendum (`invoice_search`, a tenth tool), and
the third addendum (an exact count, ambiguous-match links returned
immediately, bounded conversation memory); the operator separately
confirmed vf-licence migration `0140` applied remotely too, and none
of the three addenda needed a new migration. This session still has
no push access to `vibefinanceuk/vibefinance`; delivered as
a git bundle for the operator's own pull/push/deploy sequence, the
same path decisions 0391, 0415–0429 already used.

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

## Addendum two — `invoice_search`, the gap the first addendum's own "What is not built" already named

Further live testing, three real refusals in a row: *"Can you provide
a link to the latest invoice document?"*, *"Please list invoices
received this month,"* and *"Please lookup all invoices"* — all
correctly refused, because nothing in this codebase, not just no
assistant tool, could list a *set* of invoices at all. Checked
directly before writing anything: every existing invoice route was
either one invoice by its own id (the keying screen) or by its own
printed number (`invoice_lookup`, the first addendum, above), or an
aggregate summary (spend, overdue balance, accruals). This is exactly
the gap the first addendum's own "What is not built" section already
named and left alone as "outside what was asked" — now asked.

**The operator's own question first, answered honestly before
building anything.** Asked directly whether this was a permission or
model limitation: it was neither — the assistant's refusal was
correct given what existed. Three real design forks put to the
operator before writing code, all decided in one answer:

1. **How many results, with no pagination UI in a chat reply.**
   Capped at 50, newest received first; when the cap is hit, the
   answer says so and points at the real Documents screen rather than
   silently truncating. *"Notify the user that the query is capped at
   50 invoices, and to leverage the Document search for larger
   datasets"* — the operator's own words, and also the reason no
   count-total query was built: honest about hitting a limit, without
   pretending to know an exact total beyond it.
2. **Document links per result — deliberately not built.** Minting a
   token is cheap for one invoice; multiplied across up to 50 results
   it is real added cost and complexity for a tool whose own job is
   browsing, not confirming one document. `invoice_lookup` already
   exists for that, once a specific number is known from the list.
3. **Which date "latest" and "this month" mean.** `created_at` (when
   an invoice entered this system), not `issue_date` (the number
   printed on it) — monotonic and never backdated by a supplier, so
   "latest" cannot surprise anyone the way a printed date could.

**Wraps the real Documents screen's own route, not a new query** —
the same discipline `invoice_lookup` already followed for its own
document-link minting. `documents-route.ts`'s `handleListDocuments`
already does everything this needed except a date floor: real unit
scoping, real org scoping, the same `AP.Review` permission the actual
Documents screen itself checks, and an existing in-memory supplier
text search. One small, additive extension — a `since` query param,
`AND (?14 IS NULL OR h.created_at >= ?14)`, the same "inert unless a
real value is given" shape every other optional filter in that route
already has (`unplaced`, `duplicates`, `stage`, `doneByMe`, and so
on) — is the only change to a route the real screen itself still
uses unmodified; nothing there needed to send the new param for the
screen to keep working exactly as before.

**A new date helper, mirroring the one that already exists for
"this week."** `dates.ts`'s `mondayOfThisWeek()` (decision 0265)
already established calendar-unit-not-rolling-window as this
codebase's own answer to "this X," and already established the
`now: Date` parameter shape so a test never has to wait for a
particular day. `firstOfThisMonth()` follows both exactly.

**The new tool itself, `invoice_search`**, gated by `AP.Review` — not
`AP.Validate` or `AP.Assistant` — because that is the real permission
the Documents screen it wraps already requires; a person who cannot
browse invoices on that screen cannot browse them through the
assistant either. Two optional args beyond the existing `supplier`:
`period` (only ever `"this_month"` today) and `latestOnly` (caps the
result to exactly one, for "the latest invoice" specifically rather
than a general list). The selection prompt was rewritten to
distinguish it explicitly from `invoice_lookup` — *"use this only
when the person already named a specific invoice number"* — the same
contrastive-description discipline the first addendum's bug fix
established, so a fifth tool sounding similar to a fourth does not
repeat that mistake a third time.

**`moreMayExist` is checked against what was actually fetched, not
against what survived an optional supplier filter** — a subtlety
caught before it shipped: a supplier-narrowed question could
legitimately return only a handful of matches even when the raw
50-row fetch behind it was exhausted, and "more may exist beyond what
was even looked at" is a claim about the fetch hitting its cap, not
about how many of those fetched rows happened to match one supplier's
name.

## Tests (addendum two)

**`workers/vf-app/test/dates.test.ts`** (11 new tests): `firstOfThisMonth`
against the first of a month, the last day of a long month, a short
month, and a leap day; a year-boundary case; an hour-of-day stability
case — the same shape `mondayOfThisWeek`'s own existing tests already
use.

**`workers/vf-app/test/documents.test.ts`** (2 new tests): the new
`since` param excludes a document received before the given date, and
is inert (matches everything) when absent — tested directly at the
route it actually lives in, not only indirectly through the
assistant, since the real Documents screen shares this route
unmodified.

**`workers/vf-app/test/ap-assistant.test.ts`** (5 new tests, 32 → 37):
the `AP.Review` permission gate; recent invoices returned newest
received first; `period: "this_month"` genuinely excluding an invoice
received months ago; `latestOnly: true` returning exactly one result
and correctly reporting `moreMayExist` when others do; narrowing to
one named supplier. The shared `invoice()` test helper was extended to
also write `facts_json`'s own `BT-1` key, not only the `invoice_number`
column — `documents-route.ts`'s listing reads the number from `facts_json`
(the field every other Documents test in this codebase already seeds),
a genuinely different reading of "the invoice's own number" than
`invoice_lookup`'s route uses; both are real, and a helper meant to
exercise both tools now sets both.

**Full suites, run directly:** `vf-app` 2340 → **2355** (15 new: 11 in
`dates.test.ts`, 2 in `documents.test.ts`, plus 5 more in
`ap-assistant.test.ts` bringing that file's own total from 32 to 37 —
see its own count above for why 15, not 18: some of the 11 date cases
are `it.each` rows counted individually by the test runner, not one
per bullet above), all passing. `eslint` clean on every changed and
new file. `tsc --noEmit` was also run directly: every error it reports
is in files this addendum never touched (`workload*.test.ts`,
every `vf-licence`/`vf-ui` test importing `cloudflare:test` at the
project root rather than through vitest's own resolved config) —
confirmed pre-existing, not introduced here, and left alone rather
than fixed as a drive-by. No new migration, no new permission —
`invoice_search` reuses `AP.Review`, already real and already held by
whoever sees the Documents screen itself.

## What is not built (addendum two)

- **An arbitrary date range.** Only "this calendar month" exists —
  the operator's own words named that specifically; a `since`/`until`
  pair for any other range was not asked for and was not built.
- **A true total count past the 50-row cap.** `moreMayExist` is
  honest about the fetch having hit its limit; it is not a claim about
  how many rows exist beyond it, matching the real Documents screen's
  own "searched N" framing rather than inventing a "N of M" figure
  neither route actually computes. **Superseded by the third addendum
  below** — this record stands as written (dated, not rewritten), but
  is no longer true: `totalMatching` is now that exact count.
- **Document links inside `invoice_search`'s own results.** A
  deliberate choice (fork 2, above), not an oversight — `invoice_lookup`
  already covers it once a specific number is known.

## Addendum three — an exact count, ambiguous links returned immediately, and bounded conversation memory

A third round of live testing, real transcripts, three more genuine
gaps:

1. *"How many invoices were received this month?"* and *"How many
   invoices are received from Northwind Logistics?"* — both correctly
   refused. `invoice_search`'s own result never had a true count, only
   a capped, 50-row list — exactly the limitation the second
   addendum's own "What is not built" section had already named and
   left alone.
2. *"Can you provide the link to INV-NW-1003"* — genuinely ambiguous
   (two real invoices, same number, same supplier, same stage, same
   total, in this operator's own live data) — correctly surfaced both,
   but withheld every document link and asked *"which one did you
   mean?"* The operator then asked for **both** documents, in three
   different phrasings across three more messages, and every one
   failed: *"I need the specific invoice numbers... before I can
   retrieve document links,"* *"Could you confirm which one you
   need?,"* *"The request 'both' is ambiguous."*
3. Root cause of (2), traced directly rather than guessed at: **this
   chat has zero memory between questions**, the operator's own
   original, explicit choice for the first build (`ap-assistant.js`'s
   own top comment: *"Ephemeral... nothing sent anywhere but the one
   question being asked"*). Every one of the operator's follow-up
   replies was received by the server as a brand-new, context-free
   question — a reply to the assistant's own clarifying question could
   never reach back to it. This is not specific to ambiguous invoices:
   any clarifying question this assistant has ever asked (`purchase_
   order_lookup`'s own missing-`orderNumber` message included) is the
   same kind of dead end.

**The operator's own question first, answered honestly before
building anything**: asked directly whether "how many" was a
permission or model limitation, and it was neither — a genuine,
confirmed gap (checked directly: no route anywhere counted invoices,
only listed them, capped). Two real design forks, put to the operator
directly, both answered:

1. **Should an ambiguous `invoice_lookup` return every match's own
   document link immediately, rather than withholding all of them and
   asking which one?** *"Yes, return every match's link immediately"*
   — reversing this tool's own original safety choice (the first
   addendum's own comment: *"minting one for every candidate would
   hand over a document before anyone confirmed which invoice was
   meant"*), on the reasoning that withholding only works if a
   follow-up reply can reach back to the question, and — per finding
   (3) above — it never can today. A person who asked for a specific
   number has already confirmed enough intent; getting every real
   candidate's own link is strictly better than a dead end.
2. **Should the assistant gain short-lived memory of recent questions
   and answers, reversing the original "ephemeral, nothing sent"
   choice?** *"The assistant should keep memory for the current
   session length, to a maximum of 15 minutes... without causing
   system strain, and too wide a context?"* — answered directly before
   building: this runs on Cloudflare Workers + D1, stateless per
   request, so genuine session memory would mean a real new
   architecture piece (a Durable Object, KV, or a new D1 table) with
   its own cost and cleanup story. Proposed instead: no new
   server-side storage at all — `ap-assistant.js`'s own `history` array
   already exists, kept only for display; send a *bounded* recent
   slice of that same array with each new question. Bounded on **both**
   turn count and time (a time-only cap does not bound a fast
   conversation's own prompt growth), landing on at most `MAX_
   RECENT_TURNS` turns from the last fifteen minutes. The operator
   then asked the real Cloudflare cost of raising that cap to 10 turns
   — answered with this app's own actual Workers AI pricing for
   `@cf/openai/gpt-oss-120b` ($0.35/M input tokens): negligible, a
   fraction of a cent per question either way, since this design adds
   no storage cost at all and the only thing that grows is prompt
   tokens on calls this assistant already makes. Given that, and given
   this screen has no users yet and is being limited to AP Managers
   and C-Suite (the operator's own words), the cap was raised to 50
   turns rather than kept low for cost reasons that do not actually
   apply here.

**The count, `invoice-count-route.ts`, new and deliberately separate
from `invoice_search`'s own list** — a small, unbounded `COUNT(*)`,
always exact regardless of how many rows match, rather than derived
from a capped, in-memory-filtered list the way a naive fix might have
tried. Reuses `AP.Review` and the same unit/org scoping `invoice_
search` and the real Documents screen already enforce. Got its own
real HTTP route (`GET /invoices/count`) for the same reason `/invoices
/lookup` did in the first addendum — a real, independently-reachable
endpoint, not a function only the assistant can call.

**A genuine, narrow asymmetry found while testing this, recorded
rather than smoothed over**: `invoice-count-route.ts`'s own supplier
match prefers the real, linked `suppliers.name` record, falling back
to the raw `BT-27` fact only when no supplier is linked — the more
authoritative of the two. `documents-route.ts`'s own in-memory search
(which `invoice_search`'s own list still uses) reads only the raw
`BT-27` fact, never the linked record, an existing, already-documented
limitation of that route ("searched only what was loaded"). The two
usually agree, since a real invoice's extracted supplier name and its
matched supplier record are usually the same string — but they are
not the same query, and a supplier-narrowed `invoice_search` answer
can, in principle, show a `totalMatching` that disagrees slightly with
what its own capped `invoices` list actually contains, if a specific
record's `BT-27` and linked supplier name have drifted apart. Left as
is rather than forcing the count to match the list's weaker
definition — not asked about directly, and a real product decision
either way, not a bug to silently pick a side on.

**Conversation memory, entirely client-driven, nothing new stored
anywhere.** `ap-assistant.js`'s own `recentTurnsToSend()` filters its
existing `history` array to completed turns from the last fifteen
minutes, caps it at `MAX_RECENT_TURNS`, and sends that alongside the
question; `ap-assistant.ts`'s own `sanitizeRecentTurns` re-validates
and re-caps server-side regardless of what the client claims (the same
trust level `question` itself has always had) before folding it into
both the selection and the answer prompt as a clearly-labelled
"for context" block — explicitly instructed to use it only to resolve
what a short follow-up refers to, never as a source of facts for the
new question itself.

## Tests (addendum three)

**`workers/vf-app/test/invoice-count-route.test.ts`** (new, 9 tests):
the route's own permission gate (200 with `AP.Review`, 401, 403); real
counts — zero, a plain count with no filters, exact past the 50-row
cap that would have truncated `invoice_search`'s own list (62 real
rows), a `since` date floor, a case-insensitive supplier narrowing,
and both filters combined as a real `AND`.

**`workers/vf-app/test/ap-assistant.test.ts`** (10 new tests, 37 →
47): `invoice_search`'s own `totalMatching` exact past the cap and
correctly reflecting a supplier filter (the test that first caught the
`BT-27`-vs-`suppliers.name` asymmetry above — the shared `invoice()`
test helper now embeds a seeded supplier's own name into `facts_json`'s
`BT-27` automatically, via a small `supplierNames` map populated by
`supplier()`, so test data matches what a real captured invoice
usually has); an ambiguous `invoice_lookup` now returning a real
minted document link for every match rather than none, including the
case where only one of two matches actually has a document on file;
a `recentTurns` describe block — absent from both prompts with no
history (unchanged behaviour), present in both when given, silently
ignored when not an array, a malformed entry (missing `answer`)
dropped rather than included half-formed, an oversized turn truncated
to `MAX_RECENT_TURN_CHARS`, and a 55-turn array capped to the most
recent 50.

**`workers/vf-ui/test-browser/ap-analytics.test.ts`** (1 new test):
the client sends `recentTurns: []` on a first question and the prior
exchange's own `{question, answer}` on the very next one, read
directly off the real `fetch` mock's own call arguments — the same
request-inspection pattern `access.test.ts` already established for
this codebase, not a new one invented here.

**Full suites, run directly:** `vf-app` 2355 → **2374** (19 new: 9 in
the new `invoice-count-route.test.ts`, 10 in `ap-assistant.test.ts`),
`vf-ui` Worker suite unchanged at 74, `vf-ui` browser suite 915 →
**916** (all passing; the suite's own pre-existing unhandled-rejection
exit-1 issue — decision 0380 — is untouched by this addendum, confirmed
by checking that the one new failure surfaced belongs to
`document-window.test.ts`, a file this addendum never touched). `eslint`
clean on every changed and new file. No new migration, no new
permission — `invoice-count-route.ts` reuses `AP.Review`, already real.

## What is not built (addendum three)

- **Server-side conversation storage of any kind.** Explicitly
  decided against, given the real architecture cost (a new Durable
  Object, KV namespace, or D1 table) versus a client-sent bounded
  slice of an array that already existed. If a future need requires
  memory the browser tab itself cannot supply (a conversation
  continuing across devices, say), this decision would need
  revisiting.
- **Reconciling the `BT-27`-vs-`suppliers.name` supplier-match
  asymmetry** between `invoice_search`'s own list and its own
  `totalMatching` count — recorded above as a real, narrow,
  undecided-on-purpose asymmetry, not fixed either direction.
- **A document-count tool for anything other than invoices** (purchase
  orders, tasks) — not asked for; `invoice-count-route.ts` is
  deliberately invoice-specific, matching `invoice_search`'s own scope.
