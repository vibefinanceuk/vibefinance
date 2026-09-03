# VibeFinance — Design Document: Source and Intake

*Document 4 of a series · From a document to a trusted fact*

3 September 2026

*Status: living document — reflects the system as built and as designed at time of writing*

---

## 1. Purpose and Scope

Document 2 is subtitled *"From a sentence to an enforced rule"*. It covers
where **rules** come from: the closed vocabulary, the compiler, worked
examples, the activation gate.

The interpreter takes two inputs. This document covers the other one.

> **Half of this document is proposed, and every section says which —**
> Unlike Documents 2 and 3, this one cannot use "built unless marked
> otherwise". The three intake paths, validation and extraction settings
> are live and proven against real documents. Sources as first-class
> configuration, the detection cascade and the provenance classes are
> designed and not built. Section 10 states the position for every
> capability, and the two are never blurred.

Scope boundary: this document ends where Document 2 begins. A fact
reaching the interpreter is the last thing described here. What a rule
then does with it is Document 2's subject.

---

## 2. Sources

> **Status —** The `sources` table is **built** (decision 0060), with
> every existing `intake_channels` row backfilled into it under the same
> id. No route consumes a source yet: capture still happens against
> `intake_channels`, so nothing observable has changed. The binding
> rules and administrative ownership below are as built; the detection
> that would route a source's documents to a structural channel is not.
> See section 2.5.

### 2.1 What a source is

A source is a configured connection through which documents arrive:
a mailbox, an HTTPS endpoint, a watched folder, an SFTP drop.

Each **mechanism type** can be instantiated more than once. Two
mailboxes, or two tax authority APIs for two jurisdictions, are two
source instances of one mechanism — each holding its own configuration.

**A source makes no claim about a document's structure.** It does not
assert that a mailbox receives ZUGFeRD or that an endpoint receives
Factur-X. Structure is determined at intake, from the document itself
(section 3).

### 2.2 Configuration, not a stage

Sources attach to a process definition. They are not stages.

A stage is something a process instance *visits* — the workflow engine
orchestrates when a stage is visited and what happens when its rules
fire. Stages carry rule sets, are evaluated against facts, and produce
outcomes.

A source has none of that. It runs before any instance exists, so there
are no facts to evaluate and no rule could sensibly fire on it. Modelling
it as a stage would mean the workflow engine growing a special case that
skips evaluation entirely — an exception complicating every path
downstream for a visual convenience.

Sources are also hidden from the user's flow. An AP clerk does not visit
them.

> **Cost, named honestly —** A diagram showing Sources as the first box
> implies it is the same kind of thing as Intake and Validation, and it is
> not. A container the process sits inside represents it better than a box
> it flows from. That is a documentation problem, not a design one.

### 2.3 One source, one process

Classification — which business flow a document entered — comes from the
source's process binding, not from the facts.

This appears to contradict section 2.1 and does not. The two claims are
different:

| Claim | Comes from | Because |
| --- | --- | --- |
| **Structure** — what the file is | The document | A customer cannot reliably assert it, and a Factur-X emailed to the ZUGFeRD address must still be handled correctly |
| **Classification** — which flow it entered | Configuration | A customer genuinely controls this: they decide which address to give which counterparty |

Deriving classification from the facts instead would mean a
classification step that can fail, on every document, to avoid a
misfiling that is rare and human.

**The failure mode does not disappear.** A supplier invoice emailed to
the AR address enters the AR process and is treated as receivable. That
is human misfiling — rarer than classification failure, but silent.

**The check comes for free.** AR reuses `INVOICE_FIELDS` entirely
unchanged, and `direction` alone distinguishes an AR rule from an AP one
(Document 2, section 4.3). The extracted facts therefore carry the
document's own claim about direction regardless of which process it
landed in. A validation rule comparing the two catches misfiling: **route
deterministically by source, verify by facts, flag the disagreement.**

Consequence: a customer wanting one mailbox for both AP and AR cannot
have it — they need two addresses. Probably good discipline rather than a
limitation, but it surfaces in a customer conversation rather than in
design, so better decided deliberately.

A process with no sources attached is inert rather than broken. Worth
surfacing in the interface rather than leaving someone to wonder why
nothing arrives.

### 2.4 Administrative ownership

Source configuration is `Admin.*` — platform plumbing, not accounts
payable work.

**Configuration and provenance are separated deliberately.** Configuring
a source means credentials: mailbox passwords, API keys, SFTP details.
Seeing *which* source a document arrived through is provenance, and an AP
clerk investigating a misfiled invoice has a legitimate reason to know it
came in via the AR mailbox. Configuration is `Admin.*`; `mandate.channel`
remains an ordinary fact any AP user sees.

Collapsing these into one permission would make the section 2.3 misfiling
check invisible to the people best placed to notice it.

> **Credentials are the same class of secret as signing keys —** Document
> 3 records a real incident in which a private signing key was pasted into
> a shared session and had to be revoked and regenerated, and the practice
> that followed: the operator generates and handles key material directly,
> and it never passes through a shared conversation. Source credentials
> want the same treatment — settable by an administrator, never rendered
> back, not even to them.

Per-customer isolation helps here. Document 1 establishes one D1 database
and one Worker per customer, so source credentials are a per-deployment
concern rather than a shared secret with fleet-wide blast radius.

### 2.5 A naming collision, unresolved

`intake_channels` today is `(id, process_id, name)` plus the extraction
settings of section 8. It is process-bound and knows nothing about
structure — which is to say **it is a source** under this design.

Meanwhile "intake channel" in the structural sense — a handler for XML,
PDF/A or images — is not a table at all. It is the branches of the
cascade, expressed in code.

Two ways to remove the ambiguity:

- **Rename the table to `sources`.** Accurate, and cheapest now while
  there is one customer. Breaks the public route paths
  (`/intake-channels/:id/...`), needs a migration carrying two foreign
  keys across (`intake_capture_events`, `pending_documents`), and leaves
  stored `mandate.channel` values referring to a name that no longer
  exists.
- **Name the structural concept something else** — "extraction paths",
  say — and document `intake_channels` as what a source is. Costs
  nothing, breaks nothing.

The second is likely better, because the structure handlers may never need
to be a table at all. Spending a migration and an API break to free a word
for something that is not a database concept is a poor trade.

> **Resolved, the other way round —** The recommendation above was
> wrong, because a question had not been settled when it was written:
> intake channels are **per-process**, since mapping rules are tailored
> to a process and an AR invoice wants different mappings from an
> expense receipt. Once they are genuinely per-process structural
> handlers, `intake_channels` is the right name for them, and what
> needs a new home is the source. That turns a rename into an addition.
> Built as decision 0060: a `sources` table, additive, with every
> existing channel backfilled under the same id so stored
> `mandate.channel` values keep resolving.

---

## 3. Intake

### 3.1 The three paths, as built

> **Status —** Built and proven end to end on live infrastructure.

An invoice enters through one of three paths, and the difference between
them matters more than it first appears.

| Path | How | Nature |
| --- | --- | --- |
| UBL / XML | Parsed directly | **Exact** |
| Hybrid PDF (Factur-X, ZUGFeRD) | Embedded XML extracted, then parsed | **Exact** |
| Photograph or scan | Vision model | **Inferred** |

The first two are deterministic and carry mandate-grade data. The third
is best-effort and says so in its own response: a document path of
`image-extraction`, a confidence score, and a list of fields that could
not be read.

> **The exact paths were, until recently, the least validated —** The UBL
> parser populated 11 of the 21 fields the vocabulary declares, and the
> three it omitted at document level (`BT-106`, `BT-110`, `BT-115`) are
> exactly what validation's arithmetic checks compare. Neither
> `vat_arithmetic` nor `amount_due_mismatch` could run on a parsed
> document at all, so inference was being checked more thoroughly than
> fact. Decision 0044's `checked` array had been reporting this
> correctly and unread the whole time. Fixed in decision 0059.

> **A hybrid PDF is never sent to a model —** Factur-X and ZUGFeRD carry a
> complete EN 16931 XML invoice as an embedded attachment, and that XML is
> the authoritative data. Reading it from a picture instead would
> substitute inference for fact on exactly the documents where accuracy is
> legally required. Every PDF is checked for an embedded invoice first,
> and a PDF submitted to the image endpoint is refused rather than
> silently degraded.

### 3.2 Today the caller chooses the path

This is the gap section 3.3 closes, and it is larger than it looks.

The live route surface is:

```
POST /intake-channels/:id/capture-xml
POST /intake-channels/:id/capture-pdf
POST /intake-channels/:id/capture-image
POST /intake-channels/:id/documents        (multi-page, then finalise)
```

The **caller** selects the path. That is workable for an API integration
where the sender knows what it is sending. It does not survive a mailbox:
an email arrives with an attachment, and nothing has yet decided what
kind of document it is.

Sources (section 2) make this unavoidable rather than merely untidy. A
mailbox cannot choose an endpoint.

### 3.3 The ordered cascade

> **Status —** Partly built. The **detector** is real (decision 0062)
> and tested against genuine Factur-X fixtures; nothing calls it yet.
> The **channels** are real (decision 0061):
> `intake_channels` carries a `structure` of `structured_xml`,
> `structured_pdfa` or `image`, with a partial unique index giving
> detection exactly one candidate per structure per process. What is
> **not** built is the detection itself — capture is still addressed to
> a caller-chosen endpoint, and nothing yet routes to the structural
> channels.

Detection runs most-specific-first, because the categories overlap:

1. **Structured PDF/A** — a PDF/A-3 container with embedded XML. Extract
   the attachment, parse as EN 16931.
2. **Structured XML** — UBL or a Peppol BIS message.
3. **Best-effort extraction** — a rendered page, facts inferred.
4. **Refused** — no structure recognised.

**The ordering is the substance of this section.** A Factur-X *is* a PDF.
If "is this a PDF?" is asked before "does this PDF carry embedded XML?",
every hybrid document falls into best-effort extraction and the
structured data inside it is never opened. The failure is silent and
produces plausible facts, which is the worst shape a failure can take.

### 3.4 The CIUS profile is detected, not asserted

ZUGFeRD and Factur-X are both CIUS of EN 16931, so both yield the same
Business Term codes and neither needs a second vocabulary — `profiles.ts`
already carries `factur_x` on exactly this basis. The profile is read from
the embedded XML's own declaration.

Same reasoning as `direction`: the document carries the distinction, so
ask the document.

> **A dimension beyond structure —** Peppol BIS, XRechnung and Factur-X
> are all CIUS of EN 16931 and yield the same Business Term codes. A
> national format never derived from EN 16931 — Colombia's DIAN, or
> Italy's FatturaPA — is UBL syntactically and its own semantic model
> underneath, so the fields inside mean different things. That is a
> third dimension alongside transport and structure, and it is not
> designed. See `docs/design/multi-authority-intake.md`, which
> deliberately builds nothing and records what to keep open.

---

## 4. The Image Path, and What It Cost

> **Status —** Built. Every finding below came from live testing against
> one real two-page freight invoice, and several were expensive.

This section is longer than its importance to the architecture warrants,
because the failures were instructive and the mistakes are worth not
repeating.

### 4.1 The request shape

Getting an image to a Workers AI vision model took three attempts and a
purpose-built diagnostic. The failure mode is the one worth remembering:
**the image was silently dropped and the model answered confidently
anyway.** A wrong answer that looks exactly like a right one.

The diagnostic that finally resolved it sent the *real* payload rather
than a simplified one. Earlier diagnostics tested a reduced request and
validated components that were never broken.

### 4.2 Two inference calls in one request

Multi-page capture was first built as a single call carrying every page.
Two real scans — 1.5MB and 2.8MB — exceeded the model's time budget
together, so it was rebuilt as one call per page with a merge.

It still failed. Page 1 timed out in the multi-page path while the
identical file extracted perfectly through `capture-image` minutes
earlier.

Three candidates: the R2 round-trip, the per-page prompt, or something
about two calls in one request. One controlled test separated them —
finalise a *single-page* document, which returned eight line items
cleanly.

> **A single Worker request cannot reliably make two large inference
> calls —** Page 1 succeeds alone and times out when page 2 follows it,
> **despite running first**. That detail rules out simple accumulation:
> the failure is not "the second call ran out of time", it is the first
> call behaving differently because a second one is coming.

The fix was to stop trying. Each page is extracted in its **own request**
at upload time, and the result stored on the page row. Finalise reads
those results and merges them, making no model call at all.

Better architecture regardless of the limit that forced it: uploads are
naturally spread over time, every page gets a full request budget, and
finalise becomes a database read and a merge.

### 4.3 Page conflicts are surfaced, not resolved

When two pages disagree about a field, the merge keeps one value and
**reports the disagreement** as a fact. It does not silently reconcile.

A platform default was available and rejected: where lines exist and one
candidate matches their sum, prefer it. That is arithmetic rather than
policy and would have picked correctly on the invoice at hand.

> **Why silent resolution was rejected —** Resolving the conflict would
> hide the signal entirely. Nobody would see that two pages disagreed, so
> nobody would ever configure a rule for a supplier whose documents do
> this every time. **The manual task is not a workaround for a missing
> rule — it is the mechanism by which the need for a rule becomes
> visible.**

`extraction.alternative(BT-n)` exposes what a later page said, so a rule
can resolve the conflict once a customer has decided how. `set_field`
applies the resolution and records what it changed.

### 4.4 A prompt instruction is not a safety property

The extraction prompt forbids the model from calculating values it cannot
read. It calculated anyway, producing a total of 2,272.47 on a document
whose real total is 3,137.47.

The lesson generalises well beyond extraction, and is why "a line item
must have a description" (decision 0052) is enforced in code rather than
asked for in the prompt.

### 4.5 One document is not a sample

Every finding in this section came from a single German freight invoice
with an unusual two-page structure. Decision 0052 lists six assumptions
derived from it that a different document set could legitimately
overturn — the line cap, first-page-wins, single alternatives, the
currency tolerance, the description requirement, and one-call-per-page.

None is wrong today. All are inferences from one document, which is why
section 8 makes them configurable rather than constant.

---

## 5. Refusal

> **Status —** Proposed as a terminal path. Refusal as an outcome exists
> today (`intake_capture_events` records `rejected` with a reason);
> keying, discard and terminal states do not.

### 5.1 Refusal produces facts

Intake refuses rather than falling through to a best-effort read. This
follows the discipline Document 2 already establishes for the compiler: a
rule outside the closed vocabulary becomes a refusal reported back to its
author, never something silently stored or dropped.

**A refusal is not an absence of facts.** The document yielded no invoice
facts, but intake knows the source instance, which structures were
attempted, which test failed, and holds the raw artefact.

Without those, the refusal path has nowhere to go: no facts means no
instance, and no instance means no rule can fire.

### 5.2 Three outcomes, all rule-driven

- **Reject** — no message is sent. See below.
- **Key from the document** — a person reads what extraction could not.
- **Discard** — recorded as an event with an actor and a reason, never a
  deletion.

### 5.3 Rejection is recorded, not transmitted

`reject` exists in the closed vocabulary but takes no params, and
rejecting *to the sender* would require a return path belonging to the
source instance rather than the document. An email instance has a sender;
an SFTP drop may have only a filename. Making the action conditionally
available depending on the arrival mechanism would mean rules failing
differently depending on configuration they cannot see.

Instead the instance reaches a **terminal state**, and any contact with
the sender happens outside the system. This keeps the document visible
instead of vanishing, and stops the platform claiming a capability it
does not have.

### 5.4 Two states, not a new kind of stage

`in_progress` and `completed` already exist as instance statuses, so this
adds states rather than inventing a mechanism — and instances that are not
`in_progress` are simply not visited. No stage needs to express
"terminal".

| State | Means |
| --- | --- |
| `returned_manually` | A person has taken responsibility and contacted the sender |
| `archived` | The matter is closed; nobody needs to look again |

Two states rather than one, for a reporting reason: collapsing them loses
the distinction between "someone is dealing with this" and "nothing
further is needed", which is exactly the open-items question a queue
exists to answer.

**The manual action is a fact, even though it happens elsewhere.** The
transition to `returned_manually` should carry who dealt with it and a
free-text note. Without it, reporting answers volume but not resolution —
and resolution is the number that says whether a source is worth keeping.

### 5.5 Exceptions handling

Refusals are assigned to a team by role. There is no supplier and no
amount, so the usual routing signals are unavailable — team assignment by
permission is the natural fit, and `assign_task` already supports it.

**Naming.** `AP.Reject` reads as the act of rejecting an invoice, which is
a different thing from handling one the system could not read. Prefer a
name describing the queue rather than one outcome within it —
`AP.Exceptions` or similar — since the same person will key some
documents and discard others.

**Keying and discarding should be separate permissions.** They differ in
consequence: keying introduces facts, discarding removes a document from
processing entirely. Someone trusted to transcribe an amount is not
automatically someone who should decide an invoice never existed.

Several permissions in the existing scheme are placeholders unbacked by
any route — a consequence of AP having had the most build-out. Something
close to this may already exist.

---

## 6. Provenance

> **Status —** Proposed. `extraction.confidence` is declared and populated
> (decision 0054); the three-class distinction is not built.

| Class | Origin | Reproducible from the artefact |
| --- | --- | --- |
| Parsed | The document asserted it | Yes |
| Inferred | The platform read it off a page | Approximately |
| Keyed | A person read it and typed it | No |

Keying is a capability the system does not have. Every task described so
far reviews or approves facts that already exist; this is a human
**producing** facts extraction could not.

It must inherit the identity discipline already applied to rule approval
(Document 2, section 8): who keyed a value is derived from the
authenticated caller, never accepted from a request body. There should be
a test that sends a spoofed identity claim and confirms the real caller is
recorded, matching the existing test for confirmation and activation.

Keyed facts are deliberately their own class rather than folded into
either neighbour. They are high-trust — a person read the document — but
not reproducible the way a parsed field is, and a downstream rule may
reasonably treat them differently.

### 6.1 Confidence is a score, and the threshold belongs to the rule

Intake records how a fact was obtained and, for inferred facts, how
confident extraction was. Validation decides what that means.

A customer processing scanned utility bills and one processing supplier
invoices will not agree on a threshold, and neither should have to. This
follows `invoice.duplicate_confidence`, deliberately a weighted score
from 0.0 to 1.0 rather than a boolean, for the same reason.

> **The confidence score may still mean nothing —** It reported 0.9 while
> the model was receiving no image at all, and 1.0 on a genuinely correct
> extraction. Nothing yet demonstrates the number carries information.
> Worth testing with a deliberately poor photograph before any rule relies
> on it.

Decision 0054 records a related and sharper problem: `extraction.confidence`
was being **set as a fact and never declared in the vocabulary**, so
`validateRule` refused any rule referencing it. The rules this section
describes could not be written at all until that was fixed.

---

## 7. Validation

> **Status —** Built.

### 7.1 Deterministic checks

Validation is arithmetic and presence, never inference. There is nothing
to be uncertain about, which is precisely why it belongs here rather than
in a prompt asking a model to be careful.

The checks: a missing total, VAT arithmetic, amount due against total,
date ordering, and line sum against the stated net.

Two design points carry weight:

- **`checked` is tracked separately from `failures`.** A check that could
  not run is neither a pass nor a failure. Conflating them would let
  "passed" quietly come to mean "nothing was checked".
- **Tolerance lives here and nowhere else.** Currency sums do not compare
  exactly in floating point — eight lines summing to 3,137.47 produce
  `3137.4700000000003`. A naive equality check would fail a perfectly
  correct document.

### 7.2 Before and after rules

Validation runs at the start of a stage visit, before any rule fires. When
a rule then corrects a field (`set_field`), the stored invoice is no
longer the document that was validated.

Both verdicts are kept. `validation.passed` describes the document **as it
arrived** and never changes. `validation.passedAfterRules` describes what
was **actually stored**, and is present only when a rule changed
something.

They answer genuinely different questions: an auditor asks the first about
the supplier, the finance team acts on the second. Collapsing them would
answer one at the cost of the other — and for a regulatory system, losing
the record that a document arrived broken is the more consequential loss.

The second validation is **recorded, never re-evaluated**. Allowing it to
trigger another rule pass would let rules change facts that change
validation that triggers rules, an ordering problem with no obvious end.

---

## 8. Extraction Settings

> **Status —** Built.

Every assumption in section 4 came from one document. Rather than
hardcoding them, they are configurable per intake channel — because
hardcoded behaviour asserts *"this is always true"*, while a default
asserts *"this is usually true, and here is where to change it"*. An
administrator can inspect the second and cannot inspect the first.

| Setting | Default | From |
| --- | --- | --- |
| `requireLineDescription` | true | 0052 |
| `maxExtractedLines` | 25 | 0043 |
| `currencyTolerance` | 0.01 | 0044 |
| `conflictWinner` | first | 0046 |

Every default is exactly the shipped behaviour, so the migration changed
nothing until somebody edited a value. `GET /intake-channels/:id/extraction-settings`
returns the current values **and the decision each came from**.

> **Configuration that reached nothing —** Decision 0053 shipped the
> migration, the table, the admin route and tests. None of it reached the
> image path: `extractInvoiceFromImages` took no settings parameter at
> all, and `extractInvoiceFromImage` accepted settings and dropped them
> when delegating. An administrator could change a value, read it back,
> and see it stored; it changed nothing about how a document was read.
> Fixed in decision 0056.

**Why the tests missed it** is worth recording. Decision 0053's tests are
titled "the settings genuinely change behaviour" and do prove that — by
calling the extraction functions with a settings object constructed in the
test. That proves the *functions* honour settings. It cannot prove a
*channel's* settings arrive, because the test supplies them by hand,
bypassing exactly the wiring that was missing.

**A unit test that hands a dependency to the unit proves the unit, never
the wiring.**

Settings are loaded from the document's **own channel** at each call site
rather than passed by the caller. Caller-supplied settings could disagree
with the channel a document actually arrived through, and the document
would then be read under rules its own channel never configured.

> **Audited, and it found more —** The PDF and XML paths are clean: three
> of the four settings govern model output, and neither path invokes a
> model, so they are meaningless there rather than merely unwired. But
> `currencyTolerance` governs **validation**, which every path reaches,
> and it was arriving nowhere — the workflow engine passed `undefined`,
> so every comparison used the platform penny regardless of what a
> channel had configured. Images included. Decision 0056 fixed extraction
> wiring and validation was never wired at all, so the bug survived the
> decision meant to catch this class of thing. Fixed in decision 0057.

---

## 9. Text-Layer Extraction

> **Status —** Proposed. A diagnostic exists to answer the one open
> question; nothing else is built.

### 9.1 The mistake this corrects

Considerable effort went into teaching a vision model to read a document
that carries its own text.

The Morrison invoice was tested as PNG scans — 1.5MB and 2.8MB, visibly
skewed and grey. Everything difficult in section 4 came from that: the
timeout, the fabricated total, the page conflicts.

**The original PDF is 133KB with a complete text layer.** Every value
extracts exactly, including the total the model invented.

A business invoice is usually a generated PDF, not a photograph. **The
hard case was being treated as the default.**

### 9.2 `env.AI.toMarkdown()`

Workers AI provides document conversion as a built-in. For PDFs it does
not OCR: it extracts the PDF's own tagged element structure (`StructTree`,
per ISO 14289) and builds a semantic Markdown representation, falling back
to raw page text where no `StructTree` exists.

Either way it reads **characters that are in the file**, not pixels.
Cloudflare's own example response shows `"tokens": 0` for a PDF, so this
path costs nothing in inference.

### 9.3 Text still needs interpreting

Extraction gives a layout, not fields. `"TOTAL  EUR 3,137.47LOA No:"` is
exact text and still needs turning into `BT-112: 3137.47`.

Pattern rules would be deterministic and brittle — every invoice layout
differs, and a rule set that works for one supplier needs rewriting for
the next. That is the trap the closed vocabulary and compiler were built
to avoid.

A text model with the same schema is the better answer, for a specific
reason: **a model reading extracted text cannot fabricate a total that is
not in the text** — not because it is better behaved, but because it is
reading characters rather than inferring from pixels.

### 9.4 The revised routing

```
PDF arrives
 ├─ has embedded XML (Factur-X / ZUGFeRD)? → parse it     EXACT
 ├─ toMarkdown yields usable text?          → text model   NEAR-EXACT
 └─ no text layer                           → image path   INFERRED
```

**"Usable" is the one real judgement call.** A scanned PDF may still yield
stray characters. Any threshold is a guess until measured against real
documents, and it should be a setting (section 8) rather than a constant.

The image path is unchanged and still needed. What changes is the
**order**.

---

## 10. Status: Built vs. Designed

| Capability | Status |
| --- | --- |
| UBL / XML intake, parsed directly | **Built, live** |
| Hybrid PDF intake, embedded XML extracted | **Built, live** |
| Image intake via vision model | **Built, live** |
| Multi-page capture, one inference call per page | **Built, live** |
| Extraction at upload time, not at finalise | **Built, live** |
| Page conflicts surfaced as facts | **Built, live** |
| `set_field`, with every change recorded | **Built, live** |
| Deterministic validation checks | **Built, live** |
| Validation before and after rules | **Built, live** |
| Extraction settings, per channel | **Built, live** |
| `extraction.confidence` declared in the vocabulary | **Built, live** |
| Sources as first-class configuration | **Proposed, not built** |
| Source-to-process binding | **Proposed, not built** |
| Ordered detection cascade | **Proposed, not built** |
| Refusal as a terminal path, with keying and discard | **Proposed, not built** |
| Provenance classes (parsed / inferred / keyed) | **Proposed, not built** |
| Terminal instance states | **Proposed, not built** |
| Text-layer extraction via `toMarkdown` | **Proposed, not built** |
| Image-only PDFs (rasterisation inside a Worker) | **Not possible today** |

---

## 11. Open Questions

1. **The naming collision** of section 2.5 — rename the table, or rename
   the concept. Must be decided either way.
2. **One confidence field or two.** A single `intake.confidence` where
   structured intake scores 1.0 is fewer fields, but conflates "certain
   because parsed" with "certain because the model was confident" — two
   different claims.
3. **`mandate.channel` as display name or stable identifier.** A display
   name means renaming a mailbox splits its history; a stable identifier
   keeps history but makes a fact a reference to a configuration record,
   cutting against the reproducibility property the design leans on.
4. **Are additional instance statuses a schema change**, or is status
   already open-ended?
5. **Does `intake_capture_events` need a source instance reference**
   alongside `channel_id`?
6. **Does `toMarkdown` preserve a charge table readably?** A diagnostic
   exists; the result is not yet recorded.
7. **`mandate.channel` remains outside the closed vocabulary** — a free
   string, so a rule testing a misspelled value compiles and never fires.
   This design increases its load rather than reducing it.
8. **Which EN 16931 reference fields should the vocabulary carry?** The
   closed vocabulary has `BT-10` and `BT-13`; the standard also defines
   `BT-12`, `BT-16`, `BT-18`, `BT-19` and `BT-128`. A customer needing a
   transport reference is served today by a `custom.*` field, which does
   not round-trip into a Peppol document — where `BT-18` with a scheme
   identifier is the standard's own mechanism for it. Decision 0058.

---

## Appendix A: Decision Record Index

Every claim in this document traces back to one of the following, kept in
the repository at `docs/decisions/`:

| # | Title | Covers |
| --- | --- | --- |
| 0042 | Hybrid PDF invoices | Section 3.1 — embedded XML extraction |
| 0043 | Vision extraction | Sections 3.1 and 4.1 — the request shape |
| 0044 | Validation | Section 7.1 — the deterministic checks |
| 0045 | Multi-page capture | Section 4.2 — the single-call failure, and 4.4 |
| 0046 | Per-page extraction | Section 4.2 — per-page calls and the merge rules |
| 0047 | Extract at upload | Section 4.2 — two inference calls per request |
| 0048 | Conflicts as facts | Section 4.3 — why conflicts are not resolved |
| 0049 | `set_field` | Section 4.3 — applying a resolution, with an audit record |
| 0050 | Conflict alternatives | Section 4.3 — `extraction.alternative(BT-n)` |
| 0051 | Revalidation | Section 7.2 — validation before and after rules |
| 0052 | A line item must have a description | Sections 4.4 and 4.5 |
| 0053 | Extraction settings | Section 8 — the four configurable values |
| 0054 | `extraction.confidence` declared | Section 6.1 — the undeclared fact |
| 0055 | Source, intake and validation | Sections 2, 3.3, 5 and 6 in full |
| 0056 | Settings reach extraction | Section 8 — configuration that reached nothing |
| 0057 | The settings audit | Section 8 — the PDF/XML audit, and the tolerance gap |
| 0058 | Mapping rules | Section 11 — the naming, and the vocabulary subset |
| 0059 | The UBL parser field gap | Section 3.1 — why the exact paths were least validated |
| 0060 | Sources | Section 2 — the sources table, and the collision resolved |
| 0061 | Intake channel structure | Section 3.3 — channels as per-process structural handlers |
| 0062 | Structure detection | Section 3.3 — the cascade, and why its order is the substance |

Design notes, longer than a decision record and narrower than this
document, are kept at `docs/design/`: `extraction.md`, `validation.md`
and `text-layer-extraction.md`.
