# 0041 — Typed vocabulary, and customer-defined fields

Status: settled, 2 September 2026. Step one of the extraction design
(`docs/design/extraction.md`), and deliberately the step with no AI in
it at all — pure schema, plumbing and validation, delivering real
value on its own before any vision model is involved.

## Two things, one change

**Customer-defined fields.** A customer declares a field once, as a
real, named, typed entity, and it joins their own vocabulary. The
closed vocabulary stays closed; it becomes closed *per customer*
rather than closed *globally*. Every property that makes the rule
engine safe survives: a rule can still only reference declared fields,
`validateRule()` still refuses anything outside the set, and the
compiler's prompt still receives a finite, authoritative list.

**Typed fields.** Every field — standard as well as custom — now
declares whether it holds text, a number, a date or a boolean.

The second turned out to matter more than the first.

## Why types are not decoration

The interpreter has always been strictly type-aware at runtime:

```
case "greater_than":
  return typeof actual === "number" && typeof value === "number" && actual > value;
```

So a rule comparing a textual field with `greater_than` does not
error. It does not refuse. It returns `false`, forever, silently — a
rule that quietly does nothing, with nothing to investigate.

The clearest real instance is already in the codebase: **`BT-1` is an
invoice number, and it is text.** `"INV-2026-0042"` is a reference,
not a quantity. A perfectly sensible-sounding rule — *"flag invoices
where the invoice number is greater than 10000"* — compiles today,
stores today, activates today, and never fires. Ever.

`validateRule()` now refuses that at compile time, naming the field,
its declared type, and the operators that would actually work.

`OPERATORS_BY_TYPE` was derived from what `evaluateCondition` actually
does, not from intuition about what ought to work. `is_present` and
`is_empty` are valid for every type because they test presence and
never touch the value, so they cannot suffer the mismatch this exists
to prevent.

Standard fields were typed at the same time as custom ones, rather
than custom-only-for-now. The mechanism costs nothing extra once
built, and the `BT-1` case above is live today — landing the
capability complete beat landing it oddly partial.

`BG-20` and `BG-21` are deliberately left untyped. They are
document-level groups, not scalar values, and calling them
text/number/date/boolean would be a claim this design cannot honestly
make. An absent type means "cannot say", and every operator stays
permitted — the honest answer rather than a guess.

**All 439 existing tests passed unchanged** after types were
introduced. That is the meaningful result: it means the types assigned
match what real rules already do, rather than breaking them.

## Keeping the interpreter pure

`isKnownField` was synchronous and pure, answering from constants
compiled into the code. That purity is load-bearing — it is what makes
`validateRule()` and the interpreter pure functions, which is what
makes decision 0003's support argument true: *"reproduces on your
laptop from two inputs: their rules and the invoice."*

Customer field declarations live in a database. A naive
implementation makes field lookup a database read, makes
`validateRule()` async, ripples into the interpreter, and quietly
destroys reproducibility.

**Resolution happens once, at the edge.** `compile-route.ts` loads the
customer's declared fields and calls `resolveVocabulary()`; everything
downstream receives a complete `ResolvedVocabulary` and never performs
a lookup. `loadCustomFields()` is the single database read in the
entire path.

The support argument survives with one honest amendment: it becomes
*"reproduces from three inputs: their rules, the invoice, and their
field definitions."* Still reproducible, which is the property that
actually matters.

`VocabularyInput = VocabularyName | ResolvedVocabulary` means every
existing caller keeps working untouched — a bare name resolves to that
vocabulary with no custom fields, which is exactly what it means
today. The same defaulting discipline decision 0022 used when
vocabularies were first introduced.

## Keys are derived, never supplied

`deriveCustomFieldKey("Transport Reference")` produces
`custom.transport_reference`. The customer types a label; the system
derives the key.

This avoids collisions, invalid characters, and two customers' rules
being subtly incompatible in ways nobody notices. It is deliberately
lossy: two labels differing only in case or punctuation derive to the
same key, and the registry refuses the duplicate rather than creating
two fields nobody can tell apart. The 409 names the *existing label*,
not the derived key — far more useful to someone who just typed a
variant of it.

The `custom.` prefix guarantees a customer field can never collide
with a `BT-`/`BG-` Business Term (now, or as EN 16931 evolves) or with
an expense field, and makes a custom field visibly customer-defined
wherever it appears.

## Declared per environment, structurally

Custom fields live in `vf-app`'s own database, so a sandbox and a
production environment already have separate ones (decision 0036). A
customer experimenting in sandbox cannot silently alter production
behaviour — and the separation costs no column, because the databases
are already separate. A copy path belongs with the
sandbox-to-production config migration already on the roadmap.

## The compiler prompt keeps the distinction sharp

Customer fields render in their own clearly-labelled section, told
plainly to be *"not part of any standard — these descriptions are the
customer's own"*. Merging them into the standard list would blur
exactly the distinction the closed vocabulary exists to hold, and
would invite the model to treat a customer's field as if it carried EN
16931's authority.

Field types are rendered alongside each field, for a practical reason:
a model choosing an operator needs to know `BT-1` is a textual
reference and `BT-112` is an amount, or it will produce rules that
`validateRule()` then refuses.

## What this does NOT do

Declaring a field makes it *referenceable by rules* and *describable
to an extraction model*. It does not by itself cause anything to be
extracted — there is no extraction yet. That is step two of the
design, and it needs a vision model, real documents, and a live
session to verify, since `env.AI` has no local simulation.

## What's still open

- Everything in `docs/design/extraction.md` from step two onward:
  extraction itself, extraction rules, their activation gate, and
  supplier groups.
- Whether declared types should also drive *coercion* at extraction
  time (a `number` field returned as `"approximately 500"` should fail
  to coerce, and that failure should be a refusal, not a silent zero).
  Designed, not built.
- No authentication on the registry routes, matching the same "raw API
  for now" precedent as `/org/units`, `/org/teams` and
  `/org/cost-centres`.
