# 0054 — `extraction.confidence` is declared

Status: built, 3 September 2026.

## A promise the code did not keep

`extraction.ts` sets `facts["extraction.confidence"]`, twice, and
carries a comment saying it is exposed as a real derived fact so
customers can write rules against it — naming the exact rule intended:
*"if extraction confidence is below 0.8, assign a task."*

That rule could not be written. The field was never added to
`DERIVED_FIELDS`, so `isKnownField` returned false and `validateRule`
refused it:

```
unknown field "extraction.confidence" — not in the closed vocabulary
```

Confirmed by probe before changing anything, rather than inferred from
reading the list.

## The same divergence as `cost_centre`

`invoice_lines.cost_centre` was a real, indexed database column that
had never been added to the closed vocabulary, so no rule could
reference it. That was found by checking storage against the
vocabulary directly, and closed by declaring `BT-133`.

This is the identical shape, one layer up: a fact written into
`facts_json` on every extraction, addressable by nothing.

It is worth noting *why* the two are indistinguishable from the
outside. Storage and rule-addressability are genuinely decoupled here
— `POST /rules/evaluate` parses the whole of `facts_json` and merges
the structured columns on top with no filtering, and `isKnownField` is
applied only to a rule's condition fields and `set_field` targets.
An undeclared key is therefore inert: present, handed to the
interpreter, unreferenceable. That decoupling is deliberate and useful
(decision 0055, section 9), which is exactly what makes an accidental
omission look like an intentional one.

## Declared as a score, not a boolean

Same reasoning as `invoice.duplicate_confidence`, and stated in the
description: the threshold is the customer's to choose, not the
platform's to assume. A customer processing scanned utility bills and
one processing supplier invoices will not agree on a number.

Typed `number`, which means the type-aware operator check earns its
place immediately — `extraction.confidence contains "high"` is refused
at compile time rather than silently never firing.

The description also records what the values mean, since the field is
populated from more than one path: 1.0 for anything parsed from
structured XML, lower for a rendered page the model interpreted, and 0
when any page of a multi-page document failed outright.

## What this does not do

Nothing populates a **provenance** field yet — parsed, inferred or
keyed. `extraction.confidence` conflates "certain because parsed" with
"certain because the model was confident", which are different claims;
0055 section 10 leaves the one-field-or-two question open, and this
decision does not settle it. A confidence of 1.0 today means either.

Watched to fail: removing the declaration breaks three of the four new
tests.
