# 0015 — A generic process/workflow engine

Status: design only, 31 August 2026. **Nothing described in this
document is built.** This is a record of a genuinely large design
conversation, kept here so its reasoning and its open questions
survive past the conversation that produced them — not a description
of running code, and not yet scoped into an implementation bundle the
way decision 0013 (R2) or 0014 (rule versioning) were.

## Where this started, and why it grew

This began as "authority-limit enforcement" — `org_authority_limits`
(decision 0009) is real, stored, validated data that nothing checks.
Working through what "enforcement" would actually require surfaced
that the honest scope was much larger: multiple approval types (header
amount, line-specific amount, cost-center-conditional routing),
multiple required approvals per invoice, and a general AP lifecycle
(received, validated, matched/coded, approved, reviewed, payment-
eligible) that authority-limit checking is only one small piece of.

That reframing itself then generalized further: the same
stage-and-task mechanism needed for AP invoice processing applies
identically to AR and to Expense Management, and to "any flow you
could build with this model." What started as a feature is, honestly,
a new subsystem — a generic process/workflow engine, with the existing
rule interpreter as its deterministic decision layer, not a
description of "authority limits" at all anymore.

## Core concept: one engine, many domains

A single workflow engine serves AP invoice processing, AR, Expense
Management, and any future process — not a bespoke approval feature
built once for invoices. The rule interpreter (built, live, decisions
0001/0002/0007) is reused as the decision layer throughout; this
design is about what acts on its output, not a replacement for it.

## Process definitions: a branching graph, closed per definition

Stages are not one global, shared list (an "Approved" stage meaning
the same thing for every customer and every domain) — each process
definition (e.g. "Standard AP Invoice Processing," "Expense
Reimbursement") declares its own closed stage list, the same
"deliberate, reviewed, never inferred" discipline `rule_sets` already
gets.

Stages are not strictly sequential. Rules govern "when an item is
halted or routed" (the person's own words) — an invoice with no PO
might skip a Matching stage entirely; a rule that rejects outright
needs to route somewhere other than the next stage in sequence. A
process definition is a **directed graph** of stages with conditional
transitions, not a fixed pipeline with a single "current position."
Decided explicitly now rather than discovered as a retrofit later — a
linear model would need real rework to add branching; a graph model
that only ever uses linear paths costs nothing extra today.

## Process instances: subject-agnostic

An AP process instance is about an invoice; an Expense instance is
about an expense report; AR about a receivable. Rather than a
hardcoded foreign key into any one domain table, a process instance
holds a generic `subject_type` + `subject_id` pair. The workflow
engine never needs to know or care what an "invoice" or "expense
report" actually is structurally — only that something with an id
exists and rules can be evaluated against facts supplied about it.

## Stages: rule-evaluation events, not monolithic pass/fail

A stage may require no human interaction at all — some stages are
purely automatic: a rule evaluates, an outcome is recorded, nothing
is spawned, the instance auto-advances. Confirmed directly with a
concrete example: an invoice with two lines, each individually under
its own cost centre's approval threshold, visits the Approval stage,
a rule genuinely evaluates and records that decision, and the
instance proceeds with zero human tasks created.

The mechanism this reuses rather than invents: a "stage visit" is
simply a rule-evaluation event against that stage's subject, logged
the same way `invoice_runs`/`invoice_run_steps` (built, live, an
append-only execution log) already record that a rule acted and what
it decided, independent of whether any action fired. Recording "a
rule acted on this invoice, here was the outcome" with no human task
attached is not a special case to build — it's the existing logging
behaviour, already proven.

A single stage visit can produce zero, one, or many task requirements
— never a monolithic pass/fail for the whole stage. The two-line
example again: each line is evaluated independently, and only a line
actually exceeding its own threshold spawns a task. A stage only
fully clears once every task it produced (if any) resolves.

## Tasks: header or line scoped, human or agent

A task's scope should be a first-class field from the start — even
though only a header-level scope is likely to be exercised first —
so that line-level scoping is an additive migration later, not a
rework. Same "add now, unused, clearly flagged" precedent as
`org_users.locale`.

**Human task assignment**: either to one specific person, or to a
**team** — visible to every member, claimable by any one of them.
Claiming a task must be atomic: the first person to claim it locks it
to their user; a second claim attempt on the same task must be
refused, not racily allowed. The same category of care as the
statement-ordering bug found and fixed in rule versioning (decision
0014) — build the claim operation correctly from the start rather
than discovering a real double-claim in production.

**Eligibility to claim a task = team membership AND the required
permission**, composed with AND, confirmed directly: "the user must
however have the right permission to perform a task." This reuses
existing, tested infrastructure rather than inventing a second
authorization system — `enforce.ts`'s `hasPermission()` and the
closed `AP.*`/`AR.*`/`Admin.*`/`System.*` permission vocabulary
(decision 0010) answer "is this person allowed to do this at all";
team membership answers "whose queue is this in." Notably,
`AP.Match` and `AP.Code` already exist in that vocabulary, explicitly
flagged when built as "placeholders with zero backing capability" —
this workflow engine is what would finally give them real backing.

**Teams are a deliberately separate concept from `org_roles`**, not a
reuse of it. `org_roles` answers a permission question (can this
person approve AP invoices at all, ever); a team answers a routing
question (which specific queue does a task land in). Confirmed
directly rather than assumed: two teams could hold the exact same
permission while working entirely separate queues. A team is built
from the same underlying `org_users` pool but is its own grouping.

## Cost-centre-tied line routing: two genuinely open questions

Neither of these is resolved. Both need deciding before line-level,
cost-centre-conditional routing can be designed further, let alone
built:

- **Is a cost centre the same thing as an `org_unit`, or a separate
  concept?** `org_units` (decision 0009) represents a customer's own
  organisational structure. In many real AP systems, cost centres are
  a distinct budget/GL-coding dimension that doesn't map 1:1 onto the
  org chart. Building line-item routing against `org_units` on an
  unexamined assumption they're the same axis risks a real rework if
  that assumption turns out wrong for how a given customer actually
  works.
- **Should approval authority flow down the org hierarchy?**
  `org_units` is already hierarchical (`parent_unit_id`). If a line's
  cost centre maps to a child unit, should someone in the parent unit
  also be authorized to approve it — the common "a manager can
  approve a subordinate's costs" pattern — or strictly the exact unit
  only? This changes the shape of the grant-matching query, not just
  a detail of it.

## Vocabulary strategy across domains

The closed vocabulary is not one monolithic thing — it has four
parts, and they don't all vary by domain equally:

- **`OPERATORS`** (`is`, `greater_than`, `contains`, ...) — already
  domain-agnostic; nothing here references invoices specifically.
- **`ACTIONS`** (`route_to`, `flag`, `require_second_approval`, ...) —
  also already domain-agnostic in name and semantics.
- **`INVOICE_FIELDS`** — genuinely domain-specific, grounded in
  EN 16931.
- **`DERIVED_FIELDS`** — domain-specific in meaning (`po.matched` is a
  purchase-order concept with no obvious Expense equivalent under the
  same name).

The real finding: only the field lists need to vary per domain.
Operators and actions can very plausibly stay one shared, universal
vocabulary across every domain this engine serves.

**AP and AR likely don't need separate field vocabularies.** An AR
invoice is still an EN 16931 invoice — same standard, issued rather
than received. The existing `direction` derived field
(`'payable'`/`'receivable'`) may already be sufficient to distinguish
AP rules from AR rules against the same field vocabulary. Not
confirmed — flagged as worth checking once real AR rules are actually
written, not assumed to hold.

**Expense is the genuinely hard case.** AP's vocabulary earns its
legitimacy from being a direct translation of an external, authoritative
standard (EN 16931) — reviewable against a real document a tax
adviser or auditor already recognises. Expense management has no
equivalent standard to lean on. Its field vocabulary would have to be
*authored*, not *translated* — the same "deliberate, reviewed, never
inferred" discipline, but the legitimacy has to come from the
operator's own review rather than an external document providing it
for free. Real, unavoidable authoring work per new non-invoice
domain, not a one-time cost paid once and then free forever.

**The mechanism**: each process definition would declare which field
vocabulary its rules compile against — a closed, code-defined list of
vocabulary identifiers, the same discipline as `CIUS_PROFILES`
(decision 0009).

**The real consequence for existing code**: `validateRule()`,
`isKnownField()`, and every call site that validates a rule
(`compile-route.ts`, `handleEvaluate`, `examples.ts`'s self-
verification) currently check against one global, module-level
vocabulary. This has to become parameterized by which vocabulary
applies. Without that change, a rule compiled for Expense that
happened to reference `BT-112` would silently validate — the field
would just never appear in Expense's actual fact data, so the
condition would quietly always evaluate false rather than being
caught as invalid at compile time. That is exactly the class of
silent-wrong-answer failure this system has been careful to avoid
everywhere else; this refactor is mechanical but real, and necessary
before multi-domain support can be trusted.

## AI agents: two distinct shapes, not one

Agent configuration is deliberately a different shape from rule
configuration — confirmed directly — even though both are natural-
language authored and both produce non-deterministic output on the
same underlying mechanism already built and tested this session (the
compiler). Two genuinely different roles emerged from working through
concrete examples, not one general "agent" concept:

**Fact-producing agents** run before rule evaluation and contribute a
derived fact — they never themselves decide a consequence. The
duplicate-invoice-detection example: an agent finds "invoice X and Y
are a 94% match, same supplier, same amount, same line item
description, within 30 days" — a finding. A deterministic rule then
decides whether that finding crosses a threshold worth a final review
task. This slots into the same conceptual place `DERIVED_FIELDS`
already occupies (`po.matched`, `validation.passed`) — a platform-
computed fact, just AI-computed instead of formula-computed. The rule
engine doesn't need to know or care which.

**Rule-triggered acting agents** are spawned as tasks the same way a
human task would be — draft-and-send a supplier notification, for
example — and fit the task-workflow shape directly, including
(implicitly) the same team/permission eligibility model, though this
wasn't worked through in as much depth as the fact-producing case.

**Ordering, to preserve rule-evaluation's own purity**: agents run
first, producing derived facts; the stage's rules then evaluate
against native plus derived facts, deciding whether to auto-pass or
spawn a task. Agent execution and rule evaluation stay two separate,
sequential operations within a stage visit — non-determinism enters
what facts are *available* before evaluation runs, never evaluation
itself.

**Each agent task type is its own fixed, reviewed capability** — a
closed menu (`enrich_field`, `notify_supplier`, and so on), the same
discipline as the existing `ACTIONS` list, not a general "let the
model figure out what to do" black box. This was explicit: agent
configuration should be simple and natural-language-based, but the
menu of what an agent task type can actually *do* is closed and
designed in advance, the same way rule actions are.

**Existing precedent for bounding AI non-determinism safely, already
built and tested**: compiled rules are immutable once stored — the
compiler's own non-determinism never propagates forward past that
point; and worked-examples self-verification never trusts the model's
own claim, independently re-checking every claimed outcome against
the real interpreter and refusing the whole batch on even one
mismatch (decision 0007). Both are directly relevant precedent for
designing how an agent task's output gets trusted (or re-verified)
before it's treated as final.

**Genuinely open, not resolved**: does an agent action that plays the
same functional role as a human clearing a task — an autonomous
"agent_approve," specifically — need the extra discipline of a
required deterministic check or human confirmation before being
treated as final, the way worked examples are never trusted on the
model's own claim alone? Raised as a real tension (an auditor asking
"why was this cleared" getting "an LLM decided it" as the honest
answer is a real problem for a compliance product) but not settled
either way — no example discussed so far actually specified an agent
autonomously clearing an approval; the duplicate-detection example
specifically confirmed the agent does not decide when an alert takes
place. Whether a genuinely autonomous approval-clearing agent action
should exist at all, and if so under what extra discipline, remains
open.

## The historical, queryable invoice-facts framework

**The gap this surfaces**: nothing in this system persists invoice
*facts* today, only evaluation *outcomes*. `invoice_runs` logs id,
`invoice_id`, `rule_set_id`, and outcome — never the actual field
values (amount, supplier, line item descriptions) that were
evaluated. "Find other invoices from this supplier, same amount,
same line item description, within 30 days" cannot be answered by
anything in the current schema — this is genuinely new persistence,
not a new way of reading something already stored.

**Confirmed use cases beyond the duplicate-detection agent**: a
future UI for operators, and a future analytics/reporting page — not
single-purpose to agents.

**Shape, confirmed directly**: one shared query *interface*, with
multiple purpose-built *methods* per real consumer — not one generic
query capability every consumer builds on top of directly, and not
three separate ad-hoc implementations of "search past invoices." The
same discipline `resolveTenant()` already enforces for tenant-scoped
data access, and the same reuse discipline `evaluateConditions()`
already demonstrates for the interpreter itself. A narrow, fast,
targeted lookup (the agent's "same supplier, same amount, last 30
days") and a broad aggregate (a future analytics page's "totals by
month") are different access patterns against the same underlying
data — different methods on one interface, not different systems.

**Where it lives**: inside each customer's own `vf-app` database —
invoice facts are unambiguously customer content, the same category
`invoice_runs` already sits in. No new trust boundary; an extension
of the one that already exists (decision 0001).

**Coupled to the line-item gap, not independent of it**: matching on
"same line item description" means this framework cannot be fully
built without per-line facts already being resolved. These are not
two separate future gaps that happen to sit near each other.

## Three distinct gaps, kept separate on purpose

| Gap | What's missing | Concern |
|---|---|---|
| No document ingestion path | The original PDF/XML/JPEG itself | Storage — connects directly to decision 0013's own stated blocker ("this system does not currently receive raw invoice files at all") |
| No line-item facts | Per-line structure within *one* invoice | Interpreter/vocabulary — blocks line-scoped tasks, cost-centre routing, and the duplicate-detection agent's line-item matching |
| No queryable invoice history | Structured facts persisted *across* invoices | A new D1 persistence concern, distinct from raw document storage |

The second and third are coupled, as above; the first is independent
of both but shares the same root cause (nothing upstream of the
interpreter currently handles a raw document at all).

## What's still open

- Cost centre vs. `org_units` — same concept or genuinely separate.
- Whether authority should flow down the org hierarchy.
- Whether AP and AR can safely share one field vocabulary via the
  existing `direction` field, or need to diverge — plausible, not
  confirmed.
- Whether an autonomous "agent_approve"-style action should exist at
  all, and under what extra verification discipline if so.
- The full schema for process definitions, stages, tasks, teams, and
  the historical-facts query interface — none of this has been
  designed at the table/column level; this document is the conceptual
  model the schema would need to implement, not the schema itself.
- Which piece to actually build first, and in what order, given how
  many of these pieces are now known to depend on each other (line-
  item facts blocks both cost-centre routing and duplicate detection;
  document ingestion blocks R2 retention independently).
