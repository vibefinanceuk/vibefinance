# 0058 — Mapping rules, and the vocabulary subset

**Status: proposed.** Nothing here is built. Records a naming decision, a
sequencing finding, and a gap in the closed vocabulary that is worth
closing whether or not the rules follow.

---

> **Scope, narrowed after this was written —** This decision covers
> **customer** mapping only: a customer deciding which extracted value
> lands in which field. Translating a foreign semantic model — a tax
> authority outside EN 16931, such as Colombia's DIAN — into this
> system's facts is a different problem with a different blast radius,
> and should not be built on this feature. See
> `docs/design/multi-authority-intake.md`.

## 1. The name

Call them **mapping rules**, not extraction rules.

"Extraction rule" describes *when* it runs. "Mapping rule" describes
*what it does*: decide which extracted value lands in which field.

The distinction is not pedantry. It separates cleanly from the rules that
follow in Validation — **mapping decides where a value goes, validation
decides whether it holds up** — and those are different rule sets in
different stages, over the same facts.

It also avoids repeating the `intake_channels` mistake (decision 0055,
section 2.5), where a name that described one thing came to mean its
opposite and nobody noticed until a design conversation collided with the
schema.

---

## 2. Mapping runs after extraction, not before it

This was the hard part, and it resolved once the requirement was stated
precisely.

**The problem, as first understood.** A rule like *"if the supplier is
Data Electronics, capture the cost centre"* has to test `BT-31` to
decide, and `BT-31` comes out of extraction — the condition depends on
its own outcome. Solving that needs two-pass extraction, which doubles
inference cost on every document and is exactly what decision 0047 found
a Worker request cannot afford.

**The requirement, as actually stated.** *"If this invoice is a transport
and logistics order, include a transport reference as an invoice
number."*

That is not asking extraction to look for something different. The model
reads what is on the document either way. It is asking which extracted
value lands in which field — a **mapping** decision, which runs on facts
and has no ordering problem at all.

> **Which means the machinery already exists —** A mapping rule is an
> ordinary rule: conditions over facts, evaluated by the existing
> interpreter, applied with `set_field` and its `fromField` form
> (decision 0049), and gated by worked examples like every other rule.
> The Morrison conflict-resolution rules are structurally identical —
> *"if these pages disagree about BT-112, set BT-112 from the
> alternative"* is a mapping rule in all but name.

Nothing new is needed in the rule engine. What is missing is what a
mapping rule can *target*, and what it can *test*.

---

## 3. The vocabulary is a subset, and it is missing the reference fields

VibeFinance's closed vocabulary carries two of EN 16931's reference
fields:

| In the vocabulary | Not in the vocabulary, but in the standard |
| --- | --- |
| `BT-10` buyer reference | `BT-12` contract reference |
| `BT-13` purchase order reference | `BT-16` despatch advice reference |
| | `BT-18` invoiced object identifier |
| | `BT-19` buyer accounting reference |
| | `BT-128` invoice line object identifier |

**`BT-18` is the standard's designated escape hatch for this exact
problem.** It identifies an invoiced object at document level, `BT-128`
does the same per line, and it carries an optional *scheme identifier* —
which is what lets a value declare itself as a transport reference rather
than being an unlabelled string. Peppol's own guidance advises using the
scheme identifier for precisely that purpose.

`BT-16` is transport-adjacent in its own right: an invoice may reference
at most one despatch advice.

### Why this matters more than the rule work

Today the transport-reference case would be served by a customer-defined
field. `custom.transport_reference` is literally the worked example in
`shared/interpreter/vocabulary.ts` for the custom-field mechanism.

**A `custom.*` field does not round-trip.** It exists inside VibeFinance
and cannot be expressed in a Peppol document, so it cannot be sent to
anyone else's system. `BT-18` with a scheme identifier is standard,
exportable, and survives the boundary.

For a product whose entire premise is mandate-grade e-invoicing, that is
not a detail. A customer solving a real need through `custom.*` when the
standard already has a field for it is quietly building data that cannot
leave.

> **The same divergence, a third time —** `invoice_lines.cost_centre`
> existed as a column with no vocabulary entry until `BT-133` was added.
> `extraction.confidence` was set as a fact and never declared, so the
> rules meant to use it could not be written (decision 0054). This is the
> mirror: fields that exist in the *standard* and not in our subset, so
> customers reach for `custom.*` instead. All three are one layer
> disagreeing with another, and all three were found by checking rather
> than reading either in isolation.

**Recommended before any mapping rule work:** audit which `custom.*`
fields customers are asking for against EN 16931, and declare the ones
the standard already covers. It is a one-line-per-field addition to a
single file, the same shape as decision 0054.

---

## 4. Conditions need supplier groups

*"If this is a transport and logistics order"* needs a testable fact, and
there isn't one.

The progress document already names supplier groups as not built, and is
explicit about why they must be a **lookup against configuration, never a
model inference**. A model asked to decide whether a supplier is a
transport provider will answer confidently and sometimes wrongly, and the
answer would vary between documents from the same supplier.

Until supplier groups exist, a mapping rule's conditions are limited to
what extraction produced — a specific supplier VAT rather than a
category — or to facts available before extraction, such as the source
instance the document arrived through (decision 0055, section 2).

That second option is genuinely useful and worth remembering: *"documents
arriving at the freight mailbox"* is expressible today and needs nothing
built.

---

## 5. What a generic base layer would be

The discussion that prompted this described two layers: generic mappings
shipped with the product, and customer rules on top.

The base layer is probably **not** rules. A standard EN 16931 document
needs no mapping — the fields arrive already addressed by Business Term,
which is the entire point of the standard. What the base layer really is
is the *extraction schema*: which fields are asked for at all.

That makes the two layers different in kind rather than in precedence:

| Layer | Is | Applies to |
| --- | --- | --- |
| Base | The extraction schema | What is asked for |
| Customer | Mapping rules | Where what came back goes |

Worth settling before building, because "generic rules plus custom rules"
implies a precedence model — which rule wins — that may not need to exist
at all.

---

## 6. Open questions

1. **Should the base layer be rules or schema?** Section 5 argues schema.
   If schema, there is no precedence question to answer.
2. **Does `BT-18`'s scheme identifier need to be in the vocabulary as its
   own field**, or is it a property of `BT-18`? The interpreter's fields
   are flat values; a value-plus-scheme pair does not obviously fit.
3. **Which `custom.*` fields already exist in the standard?** Needs the
   audit in section 3 rather than a guess.
4. **Do mapping rules live in Intake or Validation?** They run on facts,
   so either is mechanically possible. Intake matches the intent — the
   document is still being understood — but Validation is where rules
   over facts already run.
