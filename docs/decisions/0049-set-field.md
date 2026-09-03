# 0049 — set_field, and recording what a rule changed

Status: built, 3 September 2026.

## The third declared-but-unimplemented capability this week

`set_field` has been in the closed vocabulary since the beginning,
described in `ACTION_DESCRIPTIONS`, offered to the compiler in every
prompt — and implemented nowhere. After `'warned'` (0040) and
`validation.passed` (0044), the third capability found fully plumbed
and never once executed.

Which meant there was no existing behaviour to preserve. The design
was genuinely open.

## What prompted it

Decision 0048 deliberately does not resolve a page conflict: the
merge keeps the first page's value, reports the disagreement, and a
rule raises a task for a human. That was the operator's call, and the
right one — silent resolution would hide the signal that a rule is
needed.

But once a customer *has* decided how to resolve it, they need a way
to say so. This is that way.

## Two sources, exactly one per action

- `{ "field": "BT-112", "value": 3137.47 }` — a literal
- `{ "field": "BT-112", "fromField": "BT-106" }` — copy another
  field's current value

**Not** a composition of several values. Joining fields is a short
step from string manipulation, and string manipulation is a short
step from the rule language ceasing to be closed — the property
Document 2 calls *"the feature"*. A customer needing a reference
assembled from two fields is a real requirement (raised in review)
and a separate decision.

Exactly one source, enforced at compile time. Both would leave which
one wins to whichever the implementation checked first; neither would
set nothing while looking like it does something.

## Any field, and every change recorded

The operator's call: a rule may target any field in the vocabulary,
standard or customer-defined, but **every change is recorded**.

That pairing is what makes the breadth safe. A rule silently
rewriting an extracted value would destroy the one property that
makes extraction trustworthy — that a stored fact came off the
document. *"This total was 2,272.47 as read, and a rule changed it to
3,137.47"* is exactly the question an auditor asks, and it must be
answerable from the record rather than reconstructed.

`field_overrides` carries the stage visit, the rule responsible, the
field, the previous value and the new one. Per visit rather than per
invoice, matching 0044: a rule firing describes a *moment* of
evaluation, not a permanent property of a document, and a revisited
invoice produces a second set of overrides with both surviving.

Written in the same batch as the visit, so an override can never
exist without the visit that produced it, nor a visit silently lose
what it changed.

## Three details worth stating

**A set and an overwrite are different acts.** `previous_value` is
genuinely NULL when the field had no value, not an empty string.
Overwriting an extracted value is the more consequential case, and
conflating them would hide it.

**A no-op is not recorded.** Setting a field to the value it already
holds changed nothing, and filling the audit trail with non-changes
would make the real ones harder to find. Enforced by a standing
invariant as well as in code.

**Changes do not feed back into the same evaluation.** A rule
changing a field that a later rule in the same pass then tests would
make the outcome depend on rule order in a way nobody could reason
about, and would open a path to rules that never settle. `set_field`
applies after evaluation, not during it.

Watched to fail: applying changes without recording them breaks nine
tests; removing the param validation breaks five.

## What's still open

- **Composition** — the reference-assembly case. Needs a fixed set of
  value sources rather than an expression language, and deserves its
  own decision.
- **Capture rules** — the other half of what "extraction rules"
  originally meant: rules that change what the model is *asked for*,
  before extraction. Still designed-not-built, and now clearly a
  separate concern rather than a variant of this one.

---

## Addendum — the target field's declared type is enforced

Found by *reading generated worked examples*, not by testing. A
resolution rule's examples gave the alternative total as the string
`"1185.00"` for `BT-112`, a field declared `number`.

The real data path carries types through intact, so it would not have
happened live. But nothing stopped it — and a string in a numeric
field is exactly the silent-never-fires bug decision 0041's type
system exists to prevent. A downstream `greater_than` would simply
stop matching, with no error anywhere.

Building 0049 without this check was an oversight: the whole argument
for typing fields was that an untyped write produces a rule that
quietly does nothing, and `set_field` is the one action that writes.

**Numeric strings are coerced rather than refused.** `"1185.00"` is
unambiguously the number a document printed, and refusing it would
reject a correct value on a formatting technicality. Prose is not
coerced — the same boundary extraction already draws between
`"1185.00"` and `"approximately 500"`.

**A value the type cannot hold is skipped, not an error.** The rule
fired correctly and the value was unusable, so the field keeps what
it had rather than acquiring something no operator will match.

**A stated limit:** this resolves against the invoice vocabulary,
which covers every standard field. The workflow engine does not
currently resolve a customer's vocabulary at all, so custom fields go
unchecked — an unknown type permits any value, which is an honest
"cannot say" rather than a guess. Threading the resolved vocabulary
through the workflow engine would close it, and is a wider change than
this warranted.

Watched to fail: removing the check breaks six tests.

---

## Addendum 2 — two bugs the live test found

Both mine, and the second is the more serious.

### Every override was attributed to the wrong rule

`applySetFieldActions` took a flat action list plus a single rule id,
guessed from the trace as *"the first rule that matched"*. In
`all_matches` mode with several rules matching, every override was
credited to whichever sorted first.

Found immediately: a correct resolution was recorded against the
**task-raising** rule that happened to sort ahead of it. For a table
whose entire purpose is answering *"which rule changed this financial
value?"*, that is a serious flaw — an auditor following the record
would investigate the wrong rule.

`RuleSetOutcome` now carries `attributedActions`, pairing each action
with the rule that produced it. Kept as a parallel array so `actions`
is untouched for every existing caller.

### The correction never reached the stored invoice

Worse. Facts are stored *before* the stage visit, so a `set_field`
correction changed a copy that was never written back. The override
was recorded, and `invoice_headers` kept the fabricated 2,272.47.

An audit trail describing a change that did not happen is arguably
worse than no audit trail: it asserts something false about the
document.

Building 0049 without this was a testing failure, not just a coding
one. The end-to-end test asserted a `field_overrides` row existed and
stopped — confirming the machinery while missing the point entirely.
There was no test that the corrected value *took effect*.

`visitCurrentStage` now returns `correctedFacts` and the capture
route persists them. Written there rather than in the workflow
engine because that is where "the subject is an invoice" is known;
the engine deliberately never assumes how to store facts for a
subject type.

### And a third, caught before shipping

The first write-back attempt spread the original request body, whose
`totalWithVat` still held the pre-correction value. `handleUpsertInvoice`
takes the header columns as their own parameters rather than reading
them from `facts` — so it would have written corrected `facts_json`
alongside a stale `total_with_vat`.

That is worse than not correcting at all: the two would disagree,
with nothing recording why. Header columns are now derived from the
corrected facts.

Per-line evaluations are excluded from the write-back: a line's facts
are not the invoice's, and merging them into the header would
attribute one line's value to the whole document.
