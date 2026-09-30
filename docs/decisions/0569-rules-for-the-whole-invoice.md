# 0569: Routes phase 2, slice 3: rules for the whole invoice

**Status: built and tested locally, not yet pushed or deployed.** It
touches `shared`, `vf-app`, `vf-ui` and `vf-licence`, and needs
**`vf-licence` migration `0219`**. There is no `vf-app` migration: rules
are part of a mapping's definition.

## What was asked

This is the last part of slice 3. Dan confirmed look-up lists live on 30
September: "Rolle" was read as RO through his Units list.

For whole-invoice rules he chose two kinds to start with:

- **derived values**, such as "the due date is 30 days after the invoice
  date" or "the buyer reference is the order number";
- **defaults**, such as "if the currency is missing, use EUR".

He chose to keep the rules **on the mapping**, versioned, tried and
published with it. Skipping lines and refusing a file are not built yet.

## What was decided

### One shape (`shared/ingestion/mapping-engine.ts`)

A `DocumentRule` fills one whole-invoice term. It has:

- `target`: the term it fills;
- `when`: `missing` or `always`;
- `from`: another whole-invoice term to work from, or `null` for a fixed
  value;
- `fx`: a chain from the closed function list;
- `say`: what the person said.

Examples of the one shape:

| Rule | target | when | from | fx |
|---|---|---|---|---|
| Default currency | BT-5 | missing | null | `always EUR` |
| Due date after invoice date | BT-9 | missing | BT-2 | `add_days 30` |
| Buyer reference from order number | BT-10 | missing | BT-13 | none |

**Order.** Rules are applied after the lines and before the EN 16931
checks, in order. A later rule can work from what an earlier one filled.
So a derived due date satisfies BR-CO-25, for example.

**When a rule does nothing.** A rule working from a term the invoice does
not have does nothing, unless its chain gives a value itself. A value it
cannot make is a problem naming the rule, for example `rule 1 (from
BT-13)`.

**Validation** (`validateRules`, part of `validateMapping`):

- at most 20 rules;
- whole-invoice terms only, for both the target and `from`;
- a term cannot be worked out from itself;
- a rule with nothing to work from needs a fixed value;
- a term mapped from the document may be filled by a rule only when it is
  missing. The document wins.

**Look-up lists.** Lists a rule uses count with the lines' lists, so
drafts naming an unknown list are refused, and the lists are loaded when
reading.

### A new function: `add_days`

`add_days(days)` adds a number of days to an ISO date, across months and
years. A negative number goes back. A value that is not an ISO date is
refused in words.

### Compiling a rule (`shared/ingestion/document-rules.ts`)

`compileDocumentRule` works like a line's function (0561):

- The prompt lists every whole-invoice term, with its name and this
  invoice's value, the closed function list, and the customer's look-up
  lists.
- The model answers with one rule, or a refusal.
- The rule is validated against the shape and the mapping's lines, and a
  look-up list the customer does not have is refused.
- **The worked example is computed by our code**: the rule applied to what
  the draft reads from its own sample, showing the term before and after.

The names avoid the rule compiler's own `compileRule` and `RuleExample`.
The endpoint is `POST /supplier-mappings/:id/compile-rule`, under
`Admin.Configure`. It is proxied by `vf-ui`, with its allowlist test.
Nothing is saved until the person accepts.

### The mapping editor

A **Rules for the whole invoice** card sits below the Mapping card. It
shows each rule in order:

- what was said;
- the rule in words, for example "Payment due date (BT-9) · when it is
  missing · from Issue date (BT-2)";
- its functions;
- **Remove rule**.

A box takes a new rule. **Understand** shows the rule understood and its
example on the sample, before and after. **Accept** adds it to the draft.

In the right-hand column, a term a rule fills shows **By a rule** in place
of "Needs a source", and is not counted as a required term still needing
one. A retired mapping shows its rules without buttons.

### Strings and help

`vf-licence` `0219` adds 17 keys in English and German, none with a `;`.
The mapping editor's help gains *Rules for the whole invoice*.

## Not built

- **Skipping lines**, such as "ignore lines with a zero quantity", and
  **refusing a file**, such as "refuse it if the customer is not Acme UK
  Ltd". Dan did not choose them for now. The rule shape can grow a kind
  for each.
- **Rules on line terms.** Rules fill whole-invoice terms only.
- **Reordering rules.** They apply in the order they were added. Remove
  one and add it again to move it.

## Verification

- **`shared`**: `document-rules.test.ts`, 11 tests. They cover:
  - `add_days` across a month and a year, backwards, and refusing a date
    that is not ISO;
  - defaults and derived values applied;
  - `missing` and `always`;
  - nothing to work from, and a problem naming the rule;
  - a later rule using an earlier one's value;
  - validation, including a mapped term under `always`;
  - rules in a CSV mapping, with the derived due date meeting BR-CO-25;
  - the prompt showing terms with their values;
  - compiling with an example our code computed;
  - refusals;
  - an example that shows its reason.

  The whole package: 378 pass. The three failures existed before this
  change.
- **`vf-app`**: `supplier-mappings.test.ts`, 2 new tests:
  - a rule on a line term, and a rule naming an unknown list, both refused
    on saving; the rules then saved, tried (EUR, and a due date 30 days
    on), kept on the draft, published, and applied to the next CSV at
    intake;
  - a rule compiled against the draft's sample, with its example and the
    prompt's whole-invoice terms. This test fails against the code before
    this change.

  The first test passes against that code, because the engine that
  applies rules is in `shared`. `index.test.ts` checks that compile-rule
  needs `Admin.Configure`. Full, unfiltered run: 141 files and 3315 tests,
  of which **3313 passed**. The two failures are the ones already known
  (0511).
- **`vf-ui`**: `mapping-editor.test.ts`, 2 new tests using the real
  strings:
  - understanding a rule, its example and its function, accepting it into
    the draft, and seeing it in words;
  - a refusal; a term filled by a rule showing "By a rule"; removing a
    rule.

  Both fail against the interface before this change, and the proxy test
  fails without the allowlist entry. Full browser suite: 1374 of 1375
  pass. The one failure is the known `typography.test.ts` 10px gap. Worker
  tests: 75 of 75.
- **`vf-licence`**: 322 of 322 pass, with `0219` loaded and its keys
  covered.
- **Migrations**: `vf-licence` replays 219. `vf-app` is unchanged at 113.
- **Screenshot** of the editor with a rule accepted and another understood,
  checked by eye. It showed that "Currency" still said "Needs a source"
  though a rule filled it, and that was fixed as above.
