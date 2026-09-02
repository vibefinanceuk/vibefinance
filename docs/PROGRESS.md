# VibeFinance — Progress and Status

Last updated 2 September 2026. A living document: what is built, what
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

### Intake
- UBL/XML capture (0030)
- Hybrid PDF with embedded-XML extraction (0042)
- Image extraction via vision model (0043)
- Per-channel policy for unreadable hybrids: refuse or degrade
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

**Line extraction and the validation stage.** Designed in
`docs/design/validation.md`, prompted by a real failure: the model
fabricated an invoice total that was off by 340.00, on a document
where no total was printed. Step 1 (the extractor no longer
calculating) is built; line extraction and the validation stage are
not.

**Extraction rules.** The conditional layer — *"if the supplier is
Data Electronics, capture the cost centre"* — with its own compiler
and activation gate. Designed in `docs/design/extraction.md`.

**Supplier groups.** Needed for conditions like *"if the invoice is
from a transport provider"*, which should be a lookup against
configuration, never a model inference.

**Line-level extraction.** Only document-level fields are extracted
from images today.

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
| `vf-app` | 540 |
| `vf-licence` | 153 |
| `shared` | 120 passing, 2 known pre-existing failures |

Both migration chains replay clean with every standing invariant
holding — 20 migrations for `vf-app`, 7 for `vf-licence`.

---

## Documentation

| Document | Covers | Currency |
|---|---|---|
| Design Document 1 | Scaffolding | Not reviewed recently |
| Design Document 2 | Compiler & rule engine | Updated for 0041 |
| Design Document 3 | Licensing & control plane | Updated through 0040 |
| `docs/design/extraction.md` | Extraction, with build record | Current |
| `docs/decisions/` | 43 decision records | Current |

**Not written**: a customer-facing API guide, and a Document 4 on the
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

**Instrument the boundary with the real payload.** Learned the hard
way over six attempts at one bug. A diagnostic that tests a
*simplified* version of a failing request will confirm every
component works while the real request keeps failing. Send exactly
what production sends, and print exactly what comes back.
