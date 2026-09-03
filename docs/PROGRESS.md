# VibeFinance — Progress and Status

Last updated 3 September 2026. A living document: what is built, what
is not, and what is known to be uncertain.

The decision records in `docs/decisions/` are the authority on *why*
anything is the way it is. This is the map.

---

## What the system does today

An invoice enters through one of three paths, and the difference
between them matters more than it first appears:

| Path | How | Nature |
|---|---|---|
| UBL / XML | Parsed directly | **Exact** |
| Hybrid PDF (Factur-X, ZUGFeRD) | Embedded XML extracted, then parsed | **Exact** |
| Photograph or scan | Vision model | **Inferred** |

The first two are deterministic and carry mandate-grade data. The
third is best-effort and is marked as such in its own response —
`documentPath: "image-extraction"`, a confidence score, and a list of
fields that could not be read.

A hybrid PDF is never sent to a model. That is the point of checking
for embedded XML first, and a PDF submitted to the image endpoint is
refused outright rather than silently degraded.

From there: facts are stored, a workflow instance is created, its
stages are visited, rules compiled from natural language are
evaluated, and matching rules spawn real tasks for real people.

**Verified end to end on live infrastructure**: a photograph of a
supplier invoice produced correct structured EN 16931 facts, matched
a rule, and left an approval task in a queue.

---

## Built and live

### The rule engine
- Closed vocabulary, now **typed** — every field declares text,
  number, date or boolean (0041)
- Natural-language compiler with a real refusal boundary
- Worked examples, self-verified against the real interpreter
- Confirmation and activation gate — no rule runs unconfirmed
- Multi-vocabulary: invoice, expense, and per-customer extensions
- Type-aware validation refuses operator/type mismatches at compile
  time, catching rules that would otherwise silently never fire
- Deterministic invoice validation, setting `validation.passed` and
  `validation.failures` as real facts rules can test, recorded on the
  stage visit for audit (0044)
- Line-level extraction from images, which is what lets the line-sum
  check run at all
- Multi-page capture: pages accumulate separately, then extract
  together in one model call (0045)

### Sources and intake
- Sources as their own thing: transport instances bound to a process (0060)
- Intake channels as per-process structural handlers (0061)
- Structure detection, most-specific-first (0062)
- Capture addressed to a source, detection choosing the channel (0063)
- UBL/XML capture (0030)
- Hybrid PDF with embedded-XML extraction (0042)
- Image extraction via vision model (0043), multi-page, one call per page (0046, 0047)
- An undetectable document captured with provenance and no facts, reaching a person (0063)
- Per-channel extraction settings, reaching extraction and validation (0053, 0056, 0057)
- Intake events recording every rejection with a reason

### The workflow engine
- Processes, stages, instances, stage visits
- Tasks, teams, permissions
- Rule sets bound to stages

### Documents
- R2 storage with jurisdiction support (0013, 0033, 0035)
- One original and one generated rendering per invoice

### The control plane
- Signed ECDSA licence tokens, fail-open cache, bootstrap exception
- One customer, many environments — sandbox and production (0036)
- Self-serve trial signup with a human approval checkpoint (0038)
- Control-plane provisioning: customer, environment, trial licence (0039)
- Staged expiry warnings at 14/7/1 days, then blocking (0040)
- Usage telemetry, per environment, aggregate-only

### Customer configuration
- Org units, teams, roles, users, cost centres
- Intake channels
- **Customer-defined fields** — the closed vocabulary becomes closed
  *per customer* rather than globally (0041)

---

## Not built

**Infrastructure provisioning.** Approving a signup creates
control-plane records; the real D1 database, R2 bucket and Worker are
not created. Needs an account-level Cloudflare token whose blast
radius deserves its own design conversation.

**Image-only PDFs.** A PDF cannot be rasterised inside a Worker — no
native renderer, and PDF.js needs a canvas workerd does not provide.
Submit the page as an image instead.

**Abandoned pending documents.** A page-one upload that never returns
holds a customer's invoice image indefinitely. Needs an expiry sweep,
or at minimum a way to list stale ones.

**Capture rules.** Rules changing what the model is *asked for*, before
extraction. Distinct from mapping rules (0058), which run on facts and
need no new machinery — this half remains designed only, and has an
ordering problem: a condition testing the supplier needs extraction to
have happened first.

**Supplier groups.** Needed for conditions like *"if the invoice is
from a transport provider"*, which should be a lookup against
configuration, never a model inference. Now also the missing condition
for mapping rules (0058).

**A retention period.** Nothing expires anything, so today's answer is
"forever". Document 1 section 6.4 records this as a genuine compliance
question.

**Re-evaluation after keying.** The facts change; no rule runs until
something calls `visitCurrentStage`. The manual route exists, so an
operator is not stuck, but the natural flow — key, then see validation
pass — needs a further step. Related to 0064's parked-instance finding.

**Keyed lines.** Lines live in `invoice_lines` rather than `facts_json`,
so `provenance.keyed` covers header fields only and a keyed line is
indistinguishable from a parsed one.

**Send-back.** A task cannot complete negatively, and
`onTaskCompleted` advances by sequence without evaluating rules — so
`route_to` cannot fire at the one moment a task completes (0064).

**`require_second_approval`.** Declared in the vocabulary, implemented
nowhere. Not merely unwired: two tasks on one team can both be claimed
by the same person, so a real second approval needs tasks to relate to
each other and the completion check to refuse the same `completed_by`
(0064). Either build it or remove it from the vocabulary.

**Mapping rules.** Customer-authored rules deciding which extracted
value lands in which field — *"use the transport reference as the
invoice number"* (0058). The machinery exists; what is missing is the
vocabulary's EN 16931 reference fields and supplier groups.

**Line-level extraction.** Extracted from images since 0044's addendum;
still absent from the UBL parser's allowance and charge groups.

**Email.** Nothing is sent on approval, expiry warning, or expiry.
The operator emails people personally.

**Billing.** The payment webhook and the consumption-based pricing
model.

**Sandbox to production.** Converting a trial sandbox into a paid
production environment, and migrating configuration between them.

---

## Known uncertainties

Things that are built but not proven, kept separate from things that
are simply absent.

**One layer disagreeing with another is the recurring bug.** Five
instances so far: `invoice_lines.cost_centre` was a column with no
vocabulary entry; `extraction.confidence` was set as a fact and never
declared, so the rules meant to use it could not be written (0054);
decision 0053 shipped settings that reached nothing (0056, 0057); the
UBL parser populated 11 of 21 declared fields, so validation's
arithmetic checks could never run on the most trustworthy path (0059);
and `CIUS_PROFILES` claimed FatturaPA is a CIUS when the codebase's own
description said otherwise (0065). **None was found by reading either
layer alone.** Decision 0067 now makes one of these a standing test: for
every declared field, either the UBL parser populates it or the check
file records why not — so a gap has to be *stated* to be allowed.

**Declared and implemented nowhere is the second pattern.** `'warned'`,
`validation.passed`, `extraction.confidence`, `set_field` and
`require_second_approval` were all in the vocabulary before they did
anything. The first four have since been built. The last is the worst,
because a customer writing *"invoices over 10,000 require a second
approval"* gets a rule that compiles, activates, fires, and has no
effect — while looking correct in every listing.

**Every extraction decision comes from a sample of one.** A single
German freight invoice, with an unusual two-page structure, drove the
line cap, the conflict-resolution rules, the tolerance, the
description requirement, and the one-call-per-page architecture. None
is wrong today; all are inferences from one document, and several
belong in per-customer configuration rather than platform code.
Decision 0052 lists them explicitly and should be revisited against a
real control set.

**A prompt cannot be verified by unit tests.** Tests can assert that
a prompt contains a phrase; only a live run shows how a model behaves
given it. A page-note change that read as restrictive suppressed a
line table entirely while every test passed. Prompt changes need a
live check before shipping.

**A prompt instruction is not a safety property.** The extraction
prompt forbids calculation outright, and on a real document the model
calculated anyway — reporting a total printed nowhere on the page,
contradicting its own extracted lines. The same instruction held on a
different scan of the same page. Compliance is inconsistent, not
absent, which is harder to design around. Validation caught it;
nothing that matters should rest on an instruction alone.

**The extraction confidence score may mean nothing.** It reported
`0.9` while the model was receiving no image at all, and `1.0` on a
genuinely correct extraction. The design routes low-confidence
extractions to human review; nothing yet demonstrates the number
carries information. Test with a deliberately poor photograph before
relying on it.

**Vision extraction has been verified against exactly one invoice.**
It read every field correctly, including an ambiguous date format
resolved from context. One document is not a sample.

**Two pre-existing test failures** in `shared/licensing/token.test.ts`
— time-expired JWT keys, unrelated to any recent work, failing on
`main` since before this session.

**`compiler-model.ts` has a response-reader ordering that was a real
bug in the extraction path.** It works correctly against
`gpt-oss-120b` and has all session. Left alone deliberately: changing
working code on a theory is the mistake that cost six attempts
elsewhere.

---

## Test counts

| Package | Tests |
|---|---|
| `vf-app` | 802 |
| `vf-licence` | 153 |
| `shared` | 149 passing, 2 known pre-existing failures |

Both migration chains replay clean with every standing invariant
holding — 30 migrations for `vf-app`, 7 for `vf-licence`.

---

## Documentation

| Document | Covers | Currency |
|---|---|---|
| Design Document 1 | Scaffolding | Not reviewed recently |
| Design Document 2 | Compiler & rule engine | Updated for 0041 |
| Design Document 3 | Licensing & control plane | Updated through 0040 |
| Design Document 4 | Source and intake | Current |
| `docs/design/extraction.md` | Extraction, with build record | Current |
| `docs/design/operator-interface.md` | The screens, and what blocks them | Current |
| `docs/design/mockups/` | Four screens as static HTML | Current |
| `docs/design/multi-authority-intake.md` | Non-EN-16931 authorities | Design only |
| `docs/design/text-layer-extraction.md` | Reading a PDF's own text | Design only |
| `docs/decisions/` | 71 decision records | Current |

Document 4's markdown source is at `docs/documents/`, with
`scripts/build-document-04.cjs` rendering the Word edition. The `.docx`
is deliberately not committed: a binary that cannot be diffed would
break the traceability the rest of `docs/` depends on.

**Not written**: a customer-facing API guide, and a document on the
workflow engine.

---

## Working notes

Two habits have repeatedly earned their place, and one lesson was
learned expensively.

**Watch every new check fail.** A test nobody has seen fail is a
comment that takes time to run. Several real bugs this session were
caught only because the check was deliberately broken first — and one
test was found to be hollow that way, then corrected rather than left
overstating itself.

**Refuse rather than approximate.** It runs through the compiler, the
interpreter, extraction, and the type system. A field that cannot be
read is absent, never invented. A rule that cannot be expressed is
refused, never approximated.

**Report what happened, not just that it happened.** A caller told only
that an operation succeeded cannot see *how* it succeeded. Decision
0068's `retained: true` was accurate while the document was being stored
under the wrong content type, and only a database query revealed it
(0069, 0070). The response now names the type and key, so the next
mistake of that kind is visible where somebody is already looking.

**Instrument the boundary with the real payload.** Learned the hard
way over six attempts at one bug. A diagnostic that tests a
*simplified* version of a failing request will confirm every
component works while the real request keeps failing. Send exactly
what production sends, and print exactly what comes back.

**Check one layer against another.** The five divergences above were
all found this way and none any other way. Storage proves nothing about
addressability; an admin route proves nothing about effect; a field
declared in a vocabulary proves nothing about a parser populating it.
The test has to cross the boundary — a unit test that hands a
dependency to the unit proves the unit, never the wiring.

**Draw the interface earlier than feels necessary.** Mocking up screens
that nobody had asked to be built found a hard blocker — captured
documents are not stored at all — and three workflow-engine gaps that
reading the code had not surfaced. A rail showing *"1 of 2 tasks, held
here until both are done"* invited an obvious question, and the answer
was narrower than anyone had assumed.
