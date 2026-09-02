# 0034 — Worked-examples vocabulary parameterization

Status: settled, 2 September 2026. Found live, testing the real AI
compiler against real AR and Expense sentences for the first time —
the natural follow-up to decisions 0021/0022's own seeded-rule tests,
now exercising the compiler and the worked-examples generation step
with genuine natural language rather than pre-built rules.

## The real test, and what it proved

Two real sentences, compiled by the actual deployed model, for domains
never directly tested this way before:

- AR: *"If this is a receivable invoice and it's more than 30 days
  past due, assign a task to the AR team requiring AR.Collect."*
  Compiled correctly — `direction: receivable`, `BT-9 older_than_days
  30`, a correct `assign_task` params shape.
- Expense: *"If the expense category is Travel and the amount is over
  500 and no receipt is attached, assign a task to the finance team
  requiring Expense.Review."* Compiled correctly — `category: Travel`,
  `amount greater_than 500`, `receipt_attached: is: false`, using the
  plain Expense field names rather than reaching for a `BT-*` code out
  of habit.

Both rules' worked examples were independently re-evaluated against
the real interpreter and matched the model's own claimed outcomes —
the self-verification step itself worked correctly in both cases.

## The real gap this surfaced

The Expense rule's own worked examples came back containing real
invoice fields (`BT-1`, `direction`) that don't belong to the Expense
vocabulary at all, mixed in alongside the genuinely Expense-shaped
ones. Traced directly to the code, not guessed: `buildExamplesPrompt`
called `buildVocabularyDoc()` with no vocabulary argument at all —
always the default (`'invoice'`) — and its own framing language was
hardcoded to *"an invoice-processing rule"* / *"worked examples of
invoices"* regardless of which vocabulary the rule actually used.

This was a real inconsistency, not a new problem invented here:
`compileRule` (decision 0022) already threads a real `vocabulary`
parameter through to `buildVocabularyDoc`, and `compile-route.ts`
already loads the rule set's real vocabulary from the database and
passes it correctly at the compile step — the exact same value was
sitting right there, just never passed the few lines further to
`generateExamples`.

Didn't affect *correctness* — the interpreter only reads the fields a
rule's conditions actually reference, so the extra invoice fields
never changed either rule's evaluation outcome — but it's exactly the
kind of vocabulary-discipline gap this project doesn't otherwise
tolerate, and worth closing on that basis alone.

## The fix, mirroring the existing correct pattern exactly

`buildExamplesPrompt` and `generateExamples` both gain a `vocabulary:
VocabularyName = "invoice"` parameter, defaulting exactly the way
`compileRule` already does — full backward compatibility for every
caller that predates decision 0022. `compile-route.ts`'s own call to
`generateExamples` now passes `ruleSetExists.vocabulary`, the same
value it already loads and already passes to `compileRule` a few
lines earlier. The prompt's own hardcoded "invoice" framing language
was also softened to vocabulary-neutral wording ("a business rule,"
"worked examples of records") rather than only fixing the vocabulary
doc itself and leaving the surrounding sentences contradicting it.

Proven directly: the fix was deliberately reverted and the exact
gap — invoice-specific vocabulary and framing language leaking into
an Expense-vocabulary prompt — reproduced via a real test before being
restored.

## A real, live infrastructure finding, recorded honestly though not root-caused

While testing the Expense compile request specifically, a single HTTP
request consistently failed with a misleading `"invalid JSON body"`
error against a payload independently confirmed byte-for-byte valid
(verified via `wc -c`, `od -c`, and direct `python3 -m json.tool`
validation — file corruption, a BOM, and shell-quoting differences
were all ruled out directly, not assumed). The identical payload sent
over `--http1.1` instead of the default HTTP/2 succeeded immediately.
Reproducible in this one instance; not something this session had the
visibility to root-cause further (whether it's local-curl-specific or
something in Cloudflare's own HTTP/2 handling isn't established).
Recorded here as a real, honest data point rather than silently
dropped, in case a longer request body hits the same thing again.
