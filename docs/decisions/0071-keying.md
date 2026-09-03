# 0071 — Keying: a person producing facts

**Status: built.** The third provenance class (decision 0055 section 8).

---

## Why it exists

Decision 0063 made an undetectable document **reachable** — captured with
provenance, given a real process instance, put in front of somebody by a
rule. And then gave them nothing to do about it but reject.

Decision 0068 retained the document so there is something to read.
Decision 0069 typed it so a browser can display it. This is the part
where the person acts.

Every task in this system so far **reviews or approves facts that already
exist**. This is the first where a human being creates them.

---

## A separate table from `field_overrides`

Both record an attributed change to financial data with a before and an
after. The difference is the actor, and it shows up in two `NOT NULL`
constraints:

- **`field_overrides.rule_id`** is NOT NULL because an override with no
  attributable rule is an unattributable change — and knowing *which*
  rule is what lets someone fix the rule rather than just the invoice
  (decision 0049). A person keying a value has no rule.
- **`field_overrides.stage_visit_id`** is NOT NULL because a rule only
  ever runs inside a stage visit. Keying acts on the invoice, and the
  person doing it may not be looking at a stage at all.

Widening either column to nullable would weaken a real guarantee for the
rule case in order to accommodate a different case. `keyed_fields` is the
same evidence with different constraints.

---

## Identity is derived, and there is a test that proves it

`auth.user.id`, from `requirePermission`. A `keyedBy` in the request body
is ignored entirely.

The same discipline decision 0007 applies to rule approval and
confirmation, and it matters more here: **a keyed value is a claim about
what a document says, made by a named person.** It is only worth anything
if the name is real. An anonymous keyed value is a number somebody typed
with nobody accountable for it.

Watched to fail: trusting a `keyedBy` from the body breaks the
spoofed-identity test.

A standing invariant enforces the same thing in the schema —
`keyed_by` must name a real `org_users` row.

---

## Three refusals, each with a reason

**A field outside the closed vocabulary.** A keyed value must be
addressable by a rule, or it cannot be used by one. This is exactly the
divergence that produced `invoice_lines.cost_centre` and
`extraction.confidence` — a real value the vocabulary had never heard of
— and keying is a path that could reintroduce it one document at a time.

**An empty value.** Keying a field to nothing is a deletion wearing a
creation's clothes. A field a person cannot read is one they **leave
alone**, which partial keying permits.

**Keying nothing at all.** It would record a person as having produced
facts they did not produce.

---

## Partial keying is allowed

Someone who can read the total but not the VAT breakdown saves what they
have, and validation reports honestly on what is missing.

Requiring every field would strand an operator on a document that
genuinely does not show a value — and the document, by definition here,
is one the platform already failed to read.

---

## Correcting is distinguished from creating

Keying a field extraction never produced is the ordinary case. Keying one
it produced **wrongly** is the consequential one — the Morrison invoice's
2,272.47 against its real 3,137.47 — and collapsing them would hide the
second.

`previous_value` is NULL for the first and holds the old value for the
second, and the response says `corrected: true` so the distinction is
visible without a query.

---

## `provenance.keyed`, and why it is a fact

A comma-separated list of the keyed fields, declared in the closed
vocabulary — following `validation.failures` and `extraction.conflicts`
in being a string, so the existing `contains` operator applies and no new
operator is needed.

It makes the provenance class **testable**:

```
if provenance keyed contains "BT-112", require a second approval
```

Keyed facts are high-trust — somebody read the document — but **not
reproducible** the way a parsed field is, and a rule may reasonably treat
them differently. Without a fact, that judgement could not be expressed.

Cumulative across sessions, on purpose: a second person keying a
different field must not erase the record that the first keyed theirs.
A field keyed twice appears once in the fact and twice in
`keyed_fields`, which is the right shape for both — the fact answers
*"was this typed?"*, the table answers *"by whom, and when"*.

---

## `AP.Validate`, not a new permission

The document sits at Validation, and a person keying it is validating
what they can read.

Decision 0055 section 5.5 argued that keying and discarding should be
separate permissions, because they differ in consequence: keying
introduces facts, discarding removes a document from processing
entirely. That still holds — but discard is not built, so inventing
`AP.Exceptions` now would create a permission with one member and no
contrast.

---

## What this does not do

- **Nothing re-evaluates after keying.** The facts change; no rule runs
  until something calls `visitCurrentStage`. The manual route exists, so
  an operator is not stuck, but the natural flow — key, then see
  validation pass — needs a further step. Related to decision 0064's
  parked-instance finding.
- **Keyed lines are indistinguishable from parsed ones.** Lines are
  stored in `invoice_lines` rather than `facts_json`, so
  `provenance.keyed` covers header fields only.
- **Discard does not exist**, so reject remains the only alternative
  outcome.
- **There is no interface.** The screens are mocked
  (`docs/design/mockups/key-from-document.html`); this is the endpoint
  they would call.
