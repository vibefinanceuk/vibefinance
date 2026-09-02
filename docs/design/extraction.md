# Design: AI-Assisted Extraction and Customer-Defined Fields

Status: **design only — nothing here is built.** Written 2 September
2026 for review before any code exists; revised twice the same day
following review — first settling the extraction-rule activation gate
(section 8a), then working through every remaining open question
(section 11). One item, the extraction-pass question, is deliberately
left pending measurement rather than decided.

This is the largest single piece of work the project has attempted. It
touches the closed vocabulary, which everything else depends on, so it
is worth being wrong on paper cheaply rather than in code expensively.

---

## 1. What this is for

Today the system can only ingest invoices that arrive as structured
UBL/XML. A real supplier base does not work that way: plenty of
invoices arrive as PDFs, scans, or photographs. Without extraction,
those documents cannot enter the pipeline at all.

The second, larger idea is an extension of the insight that already
makes the rule compiler work. Customers describe rules in their own
words and get back something checkable. The same should apply one
stage earlier, to extraction itself:

> *"If the supplier name is Data Electronics, ensure the cost centre is
> captured from the invoice."*
>
> *"If the invoice is from a transport provider in the transport and
> logistics group, make sure you identify a Transport Reference."*

A standard field set every customer gets, extended by extraction
definitions each customer authors themselves.

---

## 2. The platform capability is real, and confirmed

Checked directly against Cloudflare's own current documentation rather
than assumed. Workers AI now offers models with vision understanding
covering document and PDF parsing, OCR including multilingual and
handwriting, and — critically — **structured outputs and function
calling**.

Several candidates exist, including Moondream 3 (a fast 9B
mixture-of-experts vision model explicitly aimed at OCR and structured
output) and larger models such as Gemma 4 and Kimi K2.7 with vision
inputs.

This runs through the same `env.AI` binding the rule compiler already
uses. No new credential, no new vendor, no new failure surface.

**Not yet chosen.** Model selection should be a real evaluation
against actual invoices, not a decision made from a docs page. The
`CompilerModel` interface already establishes the pattern: pick one,
put it behind a small interface, make it swappable.

---

## 3. This is a fact-producing agent, not a new concept

Decision 0015 already designed the shape this needs, before any of
this was contemplated:

> *"Fact-producing agents run before rule evaluation and contribute a
> fact... agents run first, producing derived facts; the stage's rules
> then evaluate against native plus derived facts... non-determinism
> enters what facts are available before evaluation runs, never
> evaluation itself."*

Extraction is exactly that. It runs at intake, produces facts, and is
finished before any rule evaluates. The interpreter stays pure; it
receives richer facts, not a different contract.

There is already a working precedent in the codebase:
`computeDuplicateConfidence` produces `invoice.duplicate_confidence`
the same way. Extraction is a bigger instance of an established
pattern, not a new architectural category.

Decision 0015 also set the governing constraint:

> *"Each agent task type is its own fixed, reviewed capability — a
> closed menu... not a general 'let the model figure out what to do'
> black box. Agent configuration should be simple and
> natural-language-based, but the menu of what an agent task type can
> actually do is closed and designed in advance."*

Everything below is an attempt to honour that.

---

## 4. Customer-defined fields: closed per customer

### The problem

*"Identify a Transport Reference"* names a field EN 16931 does not
have. If customers can invent arbitrary field names at extraction
time, the closed vocabulary stops being closed, and nothing downstream
can safely reference what extraction produced. A rule referencing
`TransportRef` against a fact stored as `transport_reference` fails
silently — the exact failure mode this project works hardest to avoid.

### The proposal

A **customer field registry**. A customer declares a field once, as a
real, named, typed entity. It joins *their* vocabulary. The vocabulary
remains closed — it becomes closed per customer rather than closed
globally.

Every existing safety property survives: rules can only reference
declared fields, `validateRule()` still refuses anything outside the
set, and the compiler's prompt still receives a finite, authoritative
list.

A declaration carries:

| Attribute | Why |
|---|---|
| `key` | The stable identifier rules reference. Machine-shaped, not free text. |
| `label` | What a human calls it. |
| `type` | `text` / `number` / `date` / `boolean` — see section 5. |
| `description` | What the extraction model is told to look for. This is the field's real payload: a vague description produces vague extraction. |

### Naming, and a real open question

Standard fields are `BT-*` (borrowed authority from EN 16931) or plain
lowercase (expense fields, deliberately not mimicking a standard that
does not exist for that domain — decision 0022).

Customer fields need a namespace that cannot collide with either, now
or as EN 16931 evolves. A prefix such as `custom.transport_reference`
is the obvious candidate, and has the useful property of being visibly
customer-defined wherever it appears.

**Agreed (section 11.1):** the key is system-generated from the
label. Avoids collisions, invalid characters, and subtle
incompatibility between customers' rules. The label stays editable;
the key is stable forever once created.

---

## 5. Types are not optional, and here is why

The interpreter is already strictly type-aware at runtime:

```
case "greater_than":
  return typeof actual === "number" && typeof value === "number" && actual > value;
```

If extraction returns `"12345"` as a string and a rule says
*"transport reference greater than 10000"*, that rule **silently never
fires**. No error. No refusal. A rule that quietly does nothing.

Declared types fix this at two distinct points:

1. **Extraction** knows to coerce — a field declared `number` is
   parsed as one, or reported as a failed extraction rather than
   stored as a string that will never compare.
2. **Compilation** can refuse `greater_than` against a `text` field at
   compile time, as a real refusal with a real message, rather than
   letting it fail silently at evaluation time.

This is a genuinely new capability. The vocabulary today knows field
*names* but not their *types*, so this check is impossible even for
standard fields.

**Agreed (section 11.5):** do standard fields at the same time. The
mechanism costs nothing extra once built, and `greater_than` against
`BT-1` — an invoice *number*, textual — is precisely the
silent-never-fires bug this exists to catch. Landing it complete beats
landing it oddly partial.

---

## 6. Keeping the interpreter pure

### The problem

`isKnownField(field, vocabulary)` is synchronous and pure — it answers
from constants compiled into the code. That purity is load-bearing.
It is what makes `validateRule()` and the interpreter pure functions,
which is what makes decision 0003's support argument true:
*"reproduces on your laptop from two inputs: their rules and the
invoice."*

Customer field declarations live in a database. A naive implementation
makes field lookup a database read, makes `validateRule()` async,
ripples into the interpreter, and quietly destroys reproducibility.

### The proposal

**Resolve the vocabulary once, at the edge, and pass it in.** A route
handler loads the customer's declared fields, merges them with the
standard set, and hands the compiler and interpreter a complete
vocabulary object. Neither ever performs a lookup.

This is the same shape decision 0022 already established, extended
from *"which of two fixed sets"* to *"here is the resolved set"*.
`VocabularyName` becomes a resolved `Vocabulary` value. Existing
callers keep working via the same defaulting discipline used when
vocabularies were introduced.

The support argument survives intact, with one honest amendment: it
becomes *"reproduces from three inputs: their rules, the invoice, and
their field definitions."*

---

## 7. Extraction rules: when a custom field gets captured

Standard fields are always attempted. Custom fields are attempted
**conditionally**, and the condition is what the customer writes in
natural language.

### The two example shapes are genuinely different

**"If the supplier name is Data Electronics, capture the cost centre."**
The condition tests a fact already extracted (supplier identity), and
the target is already in the vocabulary. This is close to the existing
rule engine and needs little new machinery.

**"If the invoice is from a transport provider in the transport and
logistics group, identify a Transport Reference."**
The condition needs a classification that is not on the document at
all.

### Supplier groups resolve the second case properly

Rather than asking the extraction model to infer an industry
classification from the document, the customer configures it: a
supplier is set up, and assigned to a group. *"From a transport
provider"* becomes a **lookup against known configuration**, not model
judgement.

This is the same instinct that makes the rule engine safe: never ask
the model to decide something you can look up.

**Phasing.** Supplier groups are future work. Phase one supports
conditions resolving against facts already known at extraction time.
The Data Electronics example works in phase one; the transport example
needs groups.

### A real ordering problem, not yet resolved

An extraction rule conditioned on supplier identity requires supplier
identity to already be extracted. So extraction is not one pass — it
is at least two:

1. **Pass one:** standard fields, unconditionally.
2. **Evaluate** extraction rules against those facts.
3. **Pass two:** the custom fields those rules selected.

Two model calls per document, with real cost and latency implications.

**Agreed (section 11.2):** build two-pass, then measure. One call
extracting everything and discarding what no rule selected is simpler
and cheaper, but asks the model to hunt for fields that may be
irrelevant — plausibly degrading accuracy on the ones that matter,
especially where a customer has declared many fields across different
supplier types. Two-pass is also the reversible choice: collapsing to
one pass later is easy; splitting a single-pass design is not. This
remains the most genuinely open item in the design.

---

## 8. Trusting the output

Decision 0015 names the precedent directly:

> *"worked-examples self-verification never trusts the model's own
> claim, independently re-checking every claimed outcome against the
> real interpreter and refusing the whole batch on even one
> mismatch."*

Extraction cannot be verified that way — there is no independent
oracle for "what does this PDF say". But several real disciplines
apply:

**Confidence is a first-class output, not a boolean.** The existing
`invoice.duplicate_confidence` is precedent: a weighted score, not a
yes/no. Extraction should report per-field confidence, and rules
should be able to reference it — *"if extraction confidence is below
0.8, route to manual review"* is a rule the existing engine can
already express.

**A failed extraction is a refusal, not a guess.** The compiler's own
discipline. A field the model cannot find should be absent, never
fabricated. `is_empty` already exists as an operator; an absent field
is a legible, ruleable state.

**Type coercion failure is a refusal too.** A `number` field the model
returns as `"approximately 500"` fails to coerce, and that is a
refusal, not a silent zero.

**The original document is retained.** Decision 0035 already built
this. Every extraction is auditable against the source — which for a
regulatory product is not optional.

**Agreed (section 11.3):** spawn a review task — and make it a rule,
not a hardcoded behaviour. Blocking is too blunt (one uncertain field
should not stop an invoice); flagging alone is too weak (a flag nobody
must look at is decoration). Expose `extraction.confidence` as a
derived field so customers write their own threshold and routing:
*"if extraction confidence is below 0.8, assign a task to the AP
team"*. Their number, their queue, consistent with everything else in
the system.

---

## 8a. Extraction rules get an activation gate too

**Settled in review.** Extraction rules are compiled from natural
language by a model and then run against real customer documents.
That is the same risk, in the same shape, that decisions 0007 and 0008
built the worked-examples-and-activation discipline for. It applies
here.

But the mechanism does not transfer cleanly, and the reason is worth
stating precisely.

### Why business-rule self-verification cannot simply be reused

Decision 0007 works because there is an **independent oracle**. The
model claims "this rule fires on this invoice"; `evaluateConditions()`
— the real production code path — checks that claim, and one mismatch
refuses the whole batch. The model's own claim is never trusted.

There is no equivalent oracle for *"does this PDF contain a Transport
Reference, and is it TR-88431?"* Answering that needs a human or a
pre-labelled document.

### So the gate splits along the rule's own seam

An extraction rule is `condition → capture field`. Those two halves
have genuinely different verifiability:

**The condition is machine-verifiable.** "Given these facts, does this
rule trigger?" is answerable by the real interpreter, exactly as
today. Generated fact-set examples, independently re-checked, whole
batch refused on a single mismatch — decision 0007's mechanism,
reused unchanged.

**The capture is human-verifiable, against a real document.** The
author uploads an actual invoice, extraction runs, and they confirm
the field was found correctly.

### Activation requires a real document

**Settled:** an extraction rule cannot be activated until it has run
against a genuine uploaded document and the author has confirmed the
result.

This makes the extraction gate *stronger* than the business-rule gate,
not weaker. A customer cannot activate an extraction rule without
having watched it work on one of their own invoices at least once.
Generated examples confirm the logic; a real document confirms the
extraction.

### Test documents are discarded; their results are kept

**Settled:** the uploaded test document is transient and is discarded
after the test. What is retained is the **extracted result** — the
field values extraction produced, alongside who confirmed them and
when.

This was a real tension worth resolving explicitly rather than
letting it sit. Retaining evidence that a rule was confirmed, while
discarding the document that evidence refers to, would leave an
auditor asking *"validated against what?"* with a record pointing at
something deleted.

Keeping the extracted result resolves it in the right direction. The
audit trail says *"on this date, this person confirmed this rule
extracted TR-88431"* — which is the genuinely useful artifact. The
source PDF is where the value came from, not the evidence itself, and
a customer's real supplier invoice should not linger indefinitely for
a testing purpose.

Note the deliberate asymmetry with decision 0035: invoices that enter
the system through real intake **are** retained, permanently and by
design. This applies only to documents uploaded for the purpose of
testing a rule.

### What this adds to scope

Non-trivial, and worth being honest about: extraction rules need their
own versions, worked examples, confirmation records, activation
columns, and an activation route — broadly mirroring what
`rule_versions`, `rule_examples` and `activate-route.ts` already do
for business rules. Plus the document-test path, which has no existing
equivalent.

An open question worth answering during build: how much of the
existing approval machinery can be genuinely shared rather than
duplicated? The shapes are similar but not identical, and a forced
abstraction over two things that only look alike would be worse than
two honest implementations.

---

## 9. What this changes, by component

| Component | Change |
|---|---|
| `invoice_headers.facts_json` | **None.** Already deliberately opaque, already designed to be enriched over an invoice's lifecycle. |
| New: customer field registry | New table, new routes. Declarations only. |
| New: extraction rules | Storage, a compiler, worked examples, and an activation gate — mirroring the business-rule pipeline, plus a document-test path with no existing equivalent (section 8a). |
| `shared/interpreter/vocabulary.ts` | `VocabularyName` becomes a resolved `Vocabulary`. The largest blast radius in this design. |
| `validateRule()` | Gains type-awareness. Refuses operator/type mismatches at compile time. |
| Compiler prompt | Renders customer fields alongside standard ones. Already vocabulary-parameterised (decision 0034). |
| Intake | New capture path for PDF/image, alongside the existing UBL/XML one. |
| New: extraction agent | The vision model call, behind a swappable interface. |

---

## 10. Suggested build order

Each step is independently useful and independently testable.

1. **Field registry, types, and vocabulary resolution.** No AI at all.
   Pure schema and plumbing — and per section 11.5, types land for
   standard fields at the same time. Delivers real value alone:
   type-aware validation catches silently-never-firing rules
   (`greater_than` against a textual `BT-1`) that are undetectable
   today.
2. **Extraction of standard fields from a PDF.** One model call, fixed
   field set, no custom fields, no conditions. Proves the vision
   capability end to end against a real document.
3. **Custom field extraction, unconditionally.** Every declared field
   attempted on every document. No extraction rules yet.
4. **Extraction rules.** The conditional layer, with its own compiler
   and refusal boundary — plus worked examples and the activation
   gate (section 8a). The largest single step.
5. **Supplier groups.** Enables the transport example.

Steps 1 and 2 are genuinely independent and could be built in either
order.

---

## 11. Open questions, and the directions agreed

These were worked through in review. Each carries a **direction
agreed**, with the reasoning that led there. They are directions, not
settled decisions — one is explicitly pending measurement, and several
are deliberately reversible. The distinction is kept because a
recommendation recorded as if it were a finding is how a design
quietly becomes unquestionable.

### 1. Field keys — system-generated from the label

The customer types a label; the system derives the key
(`custom.transport_reference`). Avoids collisions, invalid characters,
and two customers' rules being subtly incompatible in ways nobody
notices. The label stays editable for display; the key is stable
forever once created.

### 2. One pass or two — build two-pass, then measure

Two-pass, for a reason specific to this design: custom fields are
customer-authored, and one customer could easily declare thirty across
different supplier types. Asking a vision model to hunt for thirty
fields on every document, when a given invoice is relevant to two of
them, plausibly degrades accuracy on the ones that matter.

**Genuinely empirical, not architectural.** Build two-pass because it
is the *reversible* choice — collapsing to one pass later is easy,
splitting a single-pass design is not — then measure both against real
invoices before committing. This remains the most open item here.

### 3. Low confidence — spawn a review task, via a rule

Blocking is too blunt: one uncertain field should not stop an entire
invoice. Flagging alone is too weak: a flag nobody is obliged to look
at is decoration. A review task is the right shape because the
workflow engine already does exactly this — `assign_task` exists,
tasks carry permissions, and there is a real human queue. Extraction
uncertainty becomes another reason a human looks at something, which
is what the product is for.

**The important part: make it a rule, not a hardcoded behaviour.**
Expose `extraction.confidence` as a derived field and let customers
write *"if extraction confidence is below 0.8, assign a task to the AP
team"*. Their threshold, their routing, their decision — consistent
with everything else in the system, and it avoids guessing a number
that is really theirs to choose.

### 4. Which vision model — by real evaluation, not from a docs page

Unchanged and still open. Put it behind a swappable interface the way
`CompilerModel` already is, and choose on measured performance against
actual invoices.

### 5. Type-awareness on standard fields — immediately

The mechanism costs nothing extra once built, and `greater_than`
against `BT-1` (an invoice *number*, textual) is precisely the
silent-never-fires bug the type system exists to catch. Doing standard
fields at the same time means the capability lands complete rather
than oddly partial.

### 6. Fields across environments — declared per environment

Consistent with decision 0036: a sandbox is genuinely separate
infrastructure. It is also the safer default — a customer
experimenting in sandbox should not silently alter production
behaviour. The sandbox-to-production config migration already on the
roadmap is where a copy path belongs.

### 7. Worked examples and an activation gate — settled: yes

See section 8a, including that activation requires a real document,
and that test documents are discarded while their extracted results
are retained as evidence.

### 8. Shared or duplicated approval machinery — two honest implementations first

Do not abstract up front. The shapes look alike, but the extraction
gate has a document-test step with no equivalent, and premature
abstraction over two things that merely resemble each other is harder
to unpick than duplication. Build both, see what is genuinely
identical, extract then — if it still looks worth it.

### 9. Discard timing — immediate

Delayed discard is a half-measure: it carries most of the retention
risk while adding a background job and a window nobody will tune. If a
customer needs to re-test, they re-upload — it is their document.
