# 0055 — Source, Intake and Validation

**Status: proposed.** Nothing in this record is built. Where a
capability already exists it is named as such; everything else is a
decision taken on paper and not yet in code.

Decision 0054 landed the one piece that turned out to be a live bug
rather than a design question: `extraction.confidence` was set as a
fact and never declared, so the confidence rules in section 10 could
not be written at all. Everything else here remains proposed.

---

## 1. What prompted this

`mandate.channel` has been carrying two unrelated jobs: recording how
a document arrived, and standing in for what kind of document it is.
That worked while everything arrived through one path and one format.
It stops working as soon as a customer has two mailboxes, a tax
authority API and an SFTP drop — and as soon as the same intake
handling serves documents arriving by different routes.

The decision is to separate the two, and to be explicit about which
part of the system owns which question.

---

## 2. Three questions, answered in order

| Question | Answered by | Nature |
| --- | --- | --- |
| How did it arrive? | Source configuration | Transport and provenance |
| What is it? | Intake | Detection, then extraction |
| Which process? | The source's binding | Configuration, not inference |
| Do the facts hold up? | Validation | Rules over facts |

The ordering is not arbitrary. Intake cannot ask `direction` or
`rule_sets.vocabulary` because neither exists until extraction has
produced facts. Validation cannot ask how confident extraction was
unless intake recorded it.

---

## 3. Sources are configuration, not a stage

**Settled.** Sources attach to a process definition. They are not
stages.

A stage is something a process instance *visits* — the workflow engine
orchestrates when a stage is visited and what happens when its rules
fire, and stages carry rule sets, get evaluated against facts, and
produce outcomes like `matched` or `no_match`.

A source has none of that. It runs before any instance exists, so
there are no facts to evaluate and no rule could sensibly fire on it.
Modelling it as a stage would mean the workflow engine growing a
special case that skips evaluation entirely — an exception that
complicates every path downstream for a visual convenience.

Instantiation happens upstream. The engine picks up at the first real
stage.

> **Cost, named honestly.** The diagram becomes less truthful. Showing
> Sources as the first box implies it is the same kind of thing as
> Intake and Validation, and it is not. A container the process sits
> inside represents it better than a box it flows from. That is a
> documentation problem, not a design one.

### Mechanisms and instances

A source is a configured connection: a mailbox, an HTTPS endpoint, a
watched folder or SFTP drop. Each mechanism type can be instantiated
more than once — two mailboxes, or two tax authority APIs for two
jurisdictions — and each instance holds its own configuration.

**A source makes no claim about the document's structure.** It does
not assert that a mailbox receives ZUGFeRD or that an endpoint
receives Factur-X. Structure is determined at intake, from the
document (section 6).

---

## 4. A source binds to exactly one process

**Settled.** Classification comes from the source's process binding,
not from the facts.

This looks like it contradicts section 3's "a source makes no claim",
and does not. The two claims are different:

- **Structure** — what the file is — comes from the document. A
  customer cannot reliably assert this, and a Factur-X emailed to the
  ZUGFeRD address must still be handled correctly.
- **Classification** — which business flow it entered — comes from
  configuration. A customer genuinely controls this: they decide which
  address to give which counterparty. It is a claim they can actually
  make.

Deriving classification from the facts instead would mean a
classification step that can fail, on every document, to avoid a
misfiling that is rare and human.

### The failure mode does not disappear

A supplier invoice emailed to the AR address now enters the AR process
and is treated as receivable. That is human misfiling rather than
classification failure — rarer, but silent.

**The check comes for free.** AR reuses `INVOICE_FIELDS` entirely
unchanged, and `direction` alone distinguishes an AR rule from an AP
one. The extracted facts therefore carry the document's own claim
about direction regardless of which process it landed in. A validation
rule comparing the two catches misfiling: **route deterministically by
source, verify by facts, flag the disagreement.**

### Consequence

One source instance feeds one process. A customer wanting a single
mailbox for both AP and AR cannot have it — they need two addresses.
Probably good discipline rather than a limitation, but it surfaces in
a customer conversation rather than in design, so better decided
deliberately.

A process with no sources attached is inert rather than broken. Worth
surfacing in the UI rather than leaving someone to wonder why nothing
arrives.

---

## 5. Source configuration is administrative

**Settled.** `Admin.*` — it is platform plumbing, not accounts payable
work, and the permission categories already exist for exactly this
kind of split.

**Separate configuration from provenance.** Configuring a source means
credentials: mailbox passwords, API keys, SFTP details. Seeing which
source a document arrived through is just provenance, and an AP clerk
investigating a misfiled invoice has a legitimate reason to know it
came in via the AR mailbox. So configuration is `Admin.*` while
`mandate.channel` stays an ordinary fact any AP user sees.

Collapsing these into one permission would make the section 4
misfiling check invisible to the people best placed to notice it.

> **Credentials are the same class of secret as signing keys.**
> Document 3 records a real incident where a private key was pasted
> into a session and had to be revoked and regenerated, and the
> practice that followed: the operator generates and handles key
> material directly, and it never passes through a shared
> conversation. Source credentials want to be write-only — settable by
> an administrator, never rendered back, not even to them.

---

## 6. Intake determines the structure

Detection is an **ordered cascade**, most specific first, because the
categories overlap:

1. **Structured PDF/A** — a PDF/A-3 container with embedded XML.
   Extract the attachment, parse as EN 16931.
2. **Structured XML** — UBL or a Peppol BIS message.
3. **Best-effort extraction** — a rendered page, facts inferred.
4. **Refused** — no structure recognised.

The ordering is the substance of this section. A Factur-X *is* a PDF.
If "is this a PDF?" is asked before "does this PDF carry embedded
XML?", every hybrid document falls into best-effort extraction and the
structured data inside it is never opened. The failure is silent and
produces plausible facts, which is the worst shape a failure can take.

### The CIUS profile is detected, not asserted

ZUGFeRD and Factur-X are both CIUS of EN 16931, so both yield the same
BT codes and neither needs a second vocabulary — `profiles.ts` already
carries `factur_x` on exactly this basis. The profile is read from the
embedded XML's own declaration.

Same reasoning as `direction`: the document carries the distinction,
so ask the document.

---

## 7. Refusal is terminal, and produces facts

Intake refuses rather than falling through to a best-effort read.
This follows the discipline already established for the compiler,
where a rule outside the closed vocabulary becomes a refusal reported
back to its author, never something silently stored or dropped.

**A refusal is not an absence of facts.** The document yielded no
invoice facts, but intake knows the source instance, which structures
were attempted, which test failed, and holds the raw artefact. Those
are recorded, which is what allows a refusal to enter a process
instance at all and lets a rule act on it.

Without this, the refusal path has nowhere to go: no facts means no
instance, and no instance means no rule can fire.

### Three outcomes, all rule-driven

- **Reject** — no message is sent. The instance reaches a terminal
  state and is archived; see below.
- **Key from the document** — a person reads what extraction could
  not.
- **Discard** — recorded as an event with an actor and a reason, never
  a deletion.

### Rejection is recorded, not transmitted

**Settled.** The system does not send anything back to the sender.

`reject` exists in the closed vocabulary but takes no params, and
rejecting *to the sender* would require a return path belonging to the
source instance rather than the document. An email instance has a
sender; an SFTP drop may have only a filename. Making the action
conditionally available depending on which mechanism a document
arrived through would mean rules failing differently depending on
configuration they cannot see.

Instead the instance reaches a **terminal state**, and any contact
with the sender happens outside the system. This keeps the document
visible instead of vanishing, and stops the platform claiming a
capability it does not have.

### Two states, not a new kind of stage

**This is instance status, not process structure.** `in_progress` and
`completed` already exist as instance statuses, so this adds states
rather than inventing a mechanism — and instances that are not
`in_progress` are simply not visited. No stage needs to express
"terminal", and the workflow engine needs no concept of a stage that
is arrived at and never left.

| State | Means |
| --- | --- |
| `returned_manually` | A person has taken responsibility and contacted the sender |
| `archived` | The matter is closed; nobody needs to look again |

Two states rather than one, for a reporting reason: collapsing them
loses the distinction between "someone is dealing with this" and
"nothing further is needed", which is exactly the open-items question
a queue exists to answer.

**The manual action is a fact, even though it happens elsewhere.**
Someone emailed the supplier, or phoned them, or decided not to
bother. The transition to `returned_manually` should carry who dealt
with it and a free-text note — that is where the human action actually
happened. Without it, reporting answers volume but not resolution, and
resolution is the number that says whether a source is worth keeping.

Both transitions are actions taken by a person holding a permission,
not something that happens automatically after a period. Same
`AP.Exceptions` family (section 12), same identity derivation as
everywhere else: the actor comes from the authenticated caller, never
from a request body.

---

## 8. Provenance: three classes, not two

| Class | Origin | Reproducible from the artefact |
| --- | --- | --- |
| Parsed | The document asserted it | Yes |
| Inferred | The platform read it off a page | Approximately |
| Keyed | A person read it and typed it | No |

Keying is a capability the system does not currently have. Every task
described so far reviews or approves facts that already exist; this is
a human **producing** facts extraction could not.

It must inherit the identity discipline already applied to rule
approval: who keyed a value is derived from the authenticated caller,
never accepted from a request body. **There should be a test that
sends a spoofed identity claim and confirms the real caller is
recorded**, matching the existing test for confirmation and
activation.

Keyed facts are deliberately their own class rather than folded into
either neighbour. They are high-trust — a person read the document —
but not reproducible the way a parsed field is, and a downstream rule
may reasonably treat them differently.

---

## 9. Intake metadata, and what belongs in the vocabulary

Intake records what it learned, in an `intake.*` namespace alongside
the document. This follows the existing separation between BT codes
and platform-derived fields — `invoice.*`, `po.*`, `party.*`.

**Not everything recorded should be declared in the vocabulary.**
Field descriptions live in a single file reused by both the compiler's
prompt and the interpreter's validation, so every declared field is
one the model may reach for when writing a rule. The closed vocabulary
is deliberately small, and "the model must refuse rather than
approximate" gets harder to hold as the field count grows.

The split:

| Recorded | Declared | Because |
| --- | --- | --- |
| Provenance class | Yes | A rule needs it (section 10) |
| Extraction confidence | Yes | A rule needs it |
| Detected structure | Yes | Reporting, and plausibly rule-testable |
| Tests attempted before refusal | No | Diagnostic; no sensible rule tests it |

Undeclared metadata travels with the document, is reportable, and
`validateRule()` refuses any rule referencing it — the correct
outcome, not a limitation.

> **Resolved: they are separable, by precedent.** Document 2 records
> that `invoice_lines.cost_centre` existed as a real database column
> from the time invoice-facts storage was first built, and had never
> been added to the closed vocabulary — so no rule could reference it.
> That is precisely the shape proposed here: stored, reportable, and
> invisible to `validateRule()`. No schema change is needed.

> **But the separation is not policed.** That gap was found by
> checking storage against the vocabulary directly rather than
> assuming they matched. For `cost_centre` the divergence was a bug,
> closed by adding the field. For refusal diagnostics it is the
> intended state — and the two look identical from the outside.
>
> **The intent must be recorded where the next person auditing storage
> against the vocabulary will find it**, or someone closes the
> "gap" and widens the vocabulary for nothing. A comment at the field
> definition, not only in this record.

> **Confirmed mechanically, not only by precedent.**
> `POST /rules/evaluate` parses the whole of `facts_json` and merges
> the structured columns on top before handing it to the interpreter —
> there is no filtering to declared fields. Separability comes instead
> from `isKnownField` being applied to a **rule's** condition fields
> and `set_field` targets, never to the fact set contents, and being
> re-validated at evaluation time as well as compile time on the
> stated principle of never trusting storage blindly. An undeclared
> key in `facts_json` is therefore inert: present, passed to the
> interpreter, unreferenceable by any rule.

### A better home for the diagnostic half

`intake_capture_events` already exists — keyed by channel with an
index, recording `outcome`, a specific `reason` on rejection, and the
`process_instance_id` on acceptance. That is already most of the
intake record this decision wants, and the reporting question
(outcome by source) is a query over columns there rather than over
keys buried in a JSON blob.

Inert keys in `facts_json` remain possible, but they are the worse
option for anything reporting-facing: invisible to SQL, and carried on
every evaluation for no benefit. Prefer:

| Metadata | Home |
| --- | --- |
| Provenance, confidence, detected structure | `facts_json`, declared |
| Tests attempted, failure detail | `intake_capture_events` |

> **Follow-on, not blocking.** `intake_capture_events.channel_id`
> references `intake_channels`. Under section 4 a source instance
> binds to a process, so capture events may want a source instance
> reference too. Worth confirming when the cascade is built.

### Why detected structure matters for reporting

A document that reached best-effort extraction because it was a plain
PDF is a different story from one that reached it because it was a
PDF/A-3 whose embedded XML was malformed. The first is a supplier who
has not adopted e-invoicing; the second is a supplier whose
implementation is broken. Same outcome, opposite conversations.

The useful report is intake outcome by source: which channels produce
structured documents, which produce scans, which produce refusals.
That is the number that tells a customer to go and ask a supplier for
Peppol rather than PDF attachments.

---

## 10. Confidence belongs in validation, as a score

Intake records how a fact was obtained and, for inferred facts, how
confident extraction was. Validation decides what that means.

The threshold lives in the **rule**, not the platform. A customer
processing scanned utility bills and one processing supplier invoices
will not agree on a number, and neither should have to.

This follows `invoice.duplicate_confidence`, which is deliberately a
weighted score from 0.0 to 1.0 rather than a boolean, for the same
reason.

A rule of the intended shape composes entirely from vocabulary that
already exists — an `all` combinator over the provenance field and a
`less_than` comparison, firing `require_second_approval` or
`assign_task`. `between` is available for a middle band that is
flagged rather than held.

Such a rule still goes through the activation gate: worked examples
confirmed in both directions, at least one where it fires and one
where it stays silent. Slightly awkward for a confidence rule, since
the examples need plausible score values rather than plausible invoice
content — but it is the same discipline, and it would catch a rule
written with the comparison inverted.

**Open: one field or two.** A single `intake.confidence` where
structured intake scores 1.0 is fewer fields, but conflates "certain
because parsed" with "certain because the model was confident" — two
different claims. A separate provenance field keeps them apart at the
cost of a second entry.

---

## 11. `mandate.channel` carries the source instance

Not the mechanism type. "AP mailbox" and "AR mailbox" are both email,
and a report collapsing them to "email" answers nothing useful.

> **Known limitation, now load-bearing.** `mandate.channel` remains a
> free string rather than a closed enum — Document 2 says so
> explicitly. A rule testing `mandate.channel is "Emial"` compiles and
> never fires. This decision does not fix that, and the exemption
> matters more now that source instances depend on it. Worth its own
> decision record.

> **Open: display name or stable identifier.** Source instances get
> renamed, retired, replaced. A display name means renaming a mailbox
> silently splits its history across two values, and a year-on-year
> report shows one channel stopping and another starting. A stable
> identifier keeps history intact but makes a fact a reference to a
> configuration record rather than a self-contained string — cutting
> against the reproducibility property the design leans on, where a
> rule and an invoice suffice to reproduce an outcome. Probably accept
> the display name and its imperfect history, but decide it rather
> than discover it.

---

## 12. Exceptions handling

Refusals are assigned to the AP team by role. There is no supplier and
no amount, so the usual routing signals are unavailable — team
assignment by permission is the natural fit, and `assign_task` already
supports exactly this.

**Permission naming.** `AP.Reject` reads as the act of rejecting an
invoice, which is a different thing from handling one the system could
not read. Prefer something describing the queue rather than one
outcome within it — `AP.Exceptions` or similar — since the same person
will key some documents and discard others.

**Keying and discarding should be separate permissions.** They differ
in consequence: keying introduces facts, discarding removes a document
from processing entirely. Someone trusted to transcribe an amount is
not automatically someone who should decide an invoice never existed.
Separate permissions cost nothing and can be granted together.

**Check before adding.** Several permissions in the existing scheme
are placeholders unbacked by any route — a consequence of AP having
had the most build-out. Something close to this may already exist.

The queue is team-wide by default. If refusals from a specific source
instance should later reach a specific person, the fact carrying that
must exist at intake.

---

## 13. Suggested build order

1. **This record.** The refusal terminus in
   particular is the sort of decision that gets quietly softened into
   a fallback if nobody wrote down why it is not one.
2. **Vocabulary additions** — provenance and confidence fields, plus
   the exceptions permissions.
3. **The detection cascade.** Testable on its own: feed it a Factur-X
   and confirm it lands in structured PDF/A rather than best-effort;
   feed it a scan and confirm it claims no structure it has not got.
4. **Confidence rules last**, once there is something to calibrate
   against.

> **Sequencing risk.** Vocabulary additions change what the compiler
> offers the model. A customer writing a rule tomorrow will see
> `intake.confidence` in the vocabulary document whether or not the
> cascade behind it exists. Either land steps 2 and 3 close together,
> or accept that a rule can be written against a field nothing
> populates.

---

## 14. Open questions

**Parked**, all five. None blocks the build order.

1. One confidence field or two (section 10).
2. `mandate.channel` as display name or stable identifier
   (section 11).
3. `mandate.channel` remains outside the closed vocabulary, and this
   decision increases its load rather than reducing it (section 11).
4. Are additional instance statuses a schema change, or is status
   already open-ended? (section 7)
5. Whether `intake_capture_events` needs a source instance reference
   alongside `channel_id` (section 9).

Resolved since the first draft: sources are configuration rather than
a stage (section 3); classification comes from the source binding
rather than the facts (section 4); source configuration is `Admin.*`
while provenance stays visible to AP (section 5); rejection is
recorded as a terminal instance state rather than transmitted, with
contact handled outside the system (section 7); the fact set and the
stored record are separable, so intake metadata needs no schema change
(section 9).

---

## Appendix: what this record assumes

Written from Design Documents 2 and 3, not from the codebase.
Everything asserted about existing behaviour — the closed vocabulary
contents, `profiles.ts`, the permission scheme, `assign_task` params,
the `facts` structure, the identity-derivation tests — should be
checked against current code before this is treated as accurate.
Document 2 makes the point itself: sections were verified against the
code rather than assumed still correct from when they were written.
