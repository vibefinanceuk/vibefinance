# Design: Multi-Authority Intake

**Status: design only — nothing here is built, and nothing should be
built yet.**

The purpose of this note is to make a later decision cheap rather than
to bring it forward. Build without it; keep the extension points open.

---

## 1. The dimension we had not accounted for

Decision 0055 separated two questions: *how did this arrive* (transport,
answered by a source) and *what is this* (structure, answered by the
Intake cascade). Decision 0058 named a third thing — mapping — and
treated it as a customer convenience.

A tax authority outside EN 16931 introduces a dimension none of those
cover.

| Dimension | Examples | Settled? |
| --- | --- | --- |
| Transport | Email, SFTP, HTTPS, EDI | Yes — decision 0055 |
| Structure | XML, hybrid PDF, image | Yes — decision 0055 |
| **Semantic model** | EN 16931 CIUS, or DIAN, or FatturaPA | **No** |

The three are genuinely independent. A Colombian DIAN document could
arrive by email as XML; so could a Peppol BIS invoice. Same transport,
same structure, and the fields inside mean different things.

---

## 2. Why CIUS is not the hard case

Peppol BIS Billing 3.0, XRechnung and Factur-X are all **CIUS of EN
16931** — Core Invoice Usage Specifications. They constrain the same
semantic model rather than replacing it, so all three yield the same
Business Term codes. Decision 0055 section 3.4 records the consequence:
neither needs its own vocabulary, and the profile is worth detecting for
compliance and constraint reasons rather than for field addressing.

A national format that was never derived from EN 16931 is a different
proposition. Colombia's DIAN is UBL 2.1 syntactically, and semantically
its own standard — with its own extensions, its own `CUFE` fiscal
identifier, and its own signature requirements. Same syntax, different
meaning.

> **The existing profile list already crosses this line —**
> `CIUS_PROFILES` in `profiles.ts` contains `fatturapa`, described in
> the codebase's own words as *"Italy's national e-invoicing format,
> predating and distinct from Peppol BIS 3.0"*. FatturaPA is not a
> CIUS. The constant's name asserts something about its contents that
> one entry already contradicts — which is the same class of quiet
> divergence decisions 0054, 0056, 0057 and 0059 each turned out to be.
> Worth correcting whether or not this note is ever built on.

---

## 3. Two classes of mapping, and they should not be one feature

Decision 0058 established mapping rules: conditions over facts,
`set_field` with `fromField`, gated by worked examples. That is right for
what it describes. It is wrong for this.

| | Profile mapping | Customer mapping |
| --- | --- | --- |
| Answers | DIAN's XML paths → facts | *"Use the transport reference as the invoice number"* |
| Authored by | The platform | A customer |
| Changes when | A tax authority revises its schema | A customer's needs change |
| A mistake means | Every Colombian invoice is wrong | One customer's rule misfires |
| Shape | Verified code, like `ubl-parser.ts` | Compiled rules, like decision 0058 |

**Profile mapping should not be a rules feature.** The blast radius is
wrong for something expressed in natural language and compiled by a
model. `ubl-parser.ts` is already the right shape for it: explicit
paths, each verified against the real specification before being
written, with the spec's own traps recorded in comments — the repeating
`PartyTaxScheme`, the 1..2 `TaxTotal` (decision 0059).

That is a deliberately unglamorous answer. It is also the one that has
survived four rounds of layer-divergence findings.

---

## 4. The harder problem is the vocabulary, not the parsing

`CUFE` is a Colombian fiscal identifier with no EN 16931 equivalent. It
is not a mapping problem — no BT code is the right target — it is a
vocabulary problem.

Three options, none free:

**Profile-specific vocabulary.** `rule_sets.vocabulary` already supports
this: `INVOICE_FIELDS` and `EXPENSE_FIELDS` are isolated from each
other, validated separately, and a rule set declares which it uses
(Document 2, section 4). A `DIAN_FIELDS` would follow the same pattern.
Honest, and multiplies the vocabulary per authority.

**Extend the invoice vocabulary.** Add `CUFE` and its equivalents to
`INVOICE_FIELDS`. Simplest, and the closed vocabulary stops being a
model of EN 16931 — every customer's compiler prompt then offers fields
that mean nothing for their documents.

**Customer-defined fields.** The `custom.*` mechanism already exists.
But decision 0058 records why that is unsatisfying: a `custom.*` field
does not round-trip, and a *fiscal identifier a tax authority requires*
is precisely the thing that must survive leaving the system.

The first looks right. It is also the one that makes the vocabulary
count grow with the number of authorities supported, which is worth
knowing before committing.

---

## 5. What to keep open, building nothing

The point of this note. Four extension points, all of which exist or
cost nothing today:

1. **`rule_sets.vocabulary` stays a lookup, not a boolean.** It already
   is. Nothing should collapse it back to "invoice or expense".
2. **The profile is detected and recorded, not asserted** (decision 0055
   section 3.4). Already the position. It means a document's own claim
   about its standard is available as a fact whenever something needs
   it.
3. **The Intake cascade's branches stay a closed set, extensible by
   addition.** A new authority is a new branch, not a change to existing
   ones.
4. **Parsers stay code with verified paths.** Resist the pull toward
   expressing profile mapping as rules; the customer-mapping feature is
   not a general-purpose translation layer and should not become one.

None of that is work. All of it is a decision not to close a door.

---

## 6. What would make this real

In order, and none of it now:

- A real customer with a non-EN-16931 requirement. Every extraction
  decision so far came from a sample of one document; committing to a
  vocabulary shape for an authority nobody uses would repeat that
  mistake at greater cost.
- Fixing `CIUS_PROFILES` to stop claiming FatturaPA is a CIUS —
  cheap, and true regardless.
- A decision on section 4's three options, taken with a real document
  in hand rather than from the specification alone.

---

## 7. What this changes about decision 0058

0058 should be read as being about **customer mapping only**. Its
`BT-18` finding — that the standard already has an invoiced object
identifier with a scheme identifier, where a `custom.*` field does not
round-trip — stands and is unaffected.

What it does not cover, and should not be extended to cover, is
translating a foreign semantic model into this one.
