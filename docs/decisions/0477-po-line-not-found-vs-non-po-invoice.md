# 0477 — "PO Line Not Found" vs. an Ordinary Non-PO Invoice

**Status: built and verified locally, not yet committed/pushed at the
time of writing.** No push access from this session — delivered as a
git bundle, per this repo's own established handover mechanism.

---

## What was asked

*"If a non-po invoice is received with no PO on it, will the item be
able to bypass the matching queue with these rules in place. I expect
that Non-PO invoice will stop in the Coding queue to be coded by an AP
user."* — a direct factual question, following on from having just
authored decision 0474's own "Standard rule: PO line not found" for
real on their Matching stage. Answered directly, with the code traced
rather than assumed: no, as the suggested sentence was written, a
wholly non-PO invoice reaching the Matching stage would trigger it and
stop there for an AP Matching task, not continue on to Coding. Asked as
a follow-up: *"can you take a look"* at whether the platform should
split "no PO at all" from "PO line not found" as separate facts, the
same way decision 0466 already split price/quantity/unit apart.

## What was found

**A single boolean, `po.line_reference_found`, reads `false` for two
genuinely different situations `computePoLineMatch` cannot tell apart
once collapsed to one bit**: a real matching exception (the invoice
carries a PO reference, but that specific line couldn't be found in
it), and an ordinary non-PO invoice (no `BT-13` at all — the function's
own `if (!orderNumber || !lineRef) return notFound` fires identically
either way). `po.line_matched` carries the identical ambiguity, for the
same reason.

**This fact's own "false, never absent" design — deliberate, decision
0466's own choice, made so a rule could test it directly — is exactly
what makes the ambiguity possible.** The other three standard rules
(`po.line_price_matched`, `po.line_quantity_matched`,
`po.line_unit_mismatch`) do **not** have this problem: `mergePoMatchFacts`
leaves those keys genuinely *absent* from the facts object when there
is no PO line to compare against (`...(lineMatch.priceMatched !==
undefined ? {...} : {})`), and `evaluateCondition`'s own `is`/`is_not`
never fire against an absent field (`resolveField` returns `undefined`,
and `undefined === false` is `false`) — so those three already leave a
genuinely non-PO invoice alone. Confirmed by reading `evaluate.ts`
directly, not assumed.

**No new fact is actually needed to fix this.** `BT-13` ("purchase
order reference") is already a real, standard, `text`-typed vocabulary
field, and `is_present`/`is_empty` are valid for every type
specifically because they test presence rather than a value (this
codebase's own stated reason for making them universally valid). A rule
author can already write *"If the invoice has a purchase order
reference and a purchase order line cannot be found for an invoice
line..."* today, no vocabulary change required — confirmed against
`shared/compiler/vocabulary-doc.ts`, which renders exactly
`DERIVED_FIELD_DESCRIPTIONS` (the same constant this decision edits)
into the compiler's own prompt, so correcting these descriptions
changes what the compiler's model is told, not only what a human reads.

**Considered and rejected: a new header-level fact (e.g.
`po.referenced`).** Decision 0465 already rejected a "system rule"
concept as a departure from this codebase's closed-vocabulary
principle; adding a fact for something an existing, already-standard
field already expresses directly (`BT-13 is_present`) would be the same
kind of unnecessary addition, not the same situation `po.line_unit_mismatch`
was in (decision 0466 added that one because no existing fact captured
unit disagreement *at all* — here, presence-of-BT-13 already does).

## What was built

- **`shared/interpreter/vocabulary.ts`**: `po.line_reference_found`'s
  and `po.line_matched`'s own `DERIVED_FIELD_DESCRIPTIONS` entries
  corrected to state plainly that both read `false` for a wholly
  non-PO invoice too, not only for "PO referenced but this line wasn't
  found" — and to name the fix (`BT-13 is_present`) directly, since
  this text is what the compiler's own model is shown.
- **`workers/vf-app/src/matching-config-route.ts`**: `STANDARD_MATCHING_RULES`'s
  `po_line_not_found` entry's `suggestedSentence` changed from *"If a
  purchase order line cannot be found for an invoice line..."* to *"If
  the invoice has a purchase order reference and a purchase order line
  cannot be found for an invoice line..."* — the other three suggested
  sentences are unchanged, since they don't share the bug (see above).
  A new doc-comment block explains the fix and why it is scoped to this
  one entry alone.

## What was not built

No schema change, no migration, no new permission, no new route, no
`vf-ui`/`vf-licence` change — a two-file, text-only fix. Nothing
retroactive: **the operator's own already-compiled "Standard rule: PO
line not found," authored from the old suggested sentence, is not
touched by this decision and keeps the ambiguity** until re-authored by
hand (write the corrected sentence, compile, confirm the generated
examples, activate — the ordinary flow, unchanged) — this session has
no access to the operator's live rule content to fix it directly, and
would not silently rewrite an operator's own authored rule even if it
did.

## Verification

`shared` package: `interpreter/` + `compiler/` suites **159/159**.
`workers/vf-app/test/matching-config-route.test.ts` **15/15**;
`test/po-matching.test.ts` + `test/rules-list.test.ts` +
`test/rule-set-loader.test.ts` together **75/75**. `eslint` clean on
both touched files. `tsc --noEmit` on `shared` shows no new errors —
only the same pre-existing `cloudflare:test` module-resolution noise
already documented repeatedly in this session. Two pre-existing,
unrelated `shared` test failures (`licensing/token.test.ts`'s Web
Crypto round trip, `migration/table-classes.test.ts`'s table
classification) confirmed present on unmodified `origin/main` via
`git stash`, not introduced or affected by this change. No test in the
repo asserts either changed description string or the changed
suggested-sentence string verbatim, so nothing needed updating to match.

## Still to do, operator side

**Re-author your own already-compiled "Standard rule: PO line not
found"** using the corrected sentence — *"If the invoice has a purchase
order reference and a purchase order line cannot be found for an
invoice line, assign a task to the AP Matching team requiring
AP.Match"* — on the same stage, then compile, confirm its examples, and
activate it in place of (or alongside, then disable) the old one. Until
you do, a genuinely non-PO invoice reaching that stage will still be
caught by the version you already built. Push and deploy this decision
first — no migration to apply, `shared` and `vf-app` only.
