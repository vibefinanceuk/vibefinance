# 0511 — Coding values checked against Account Coding's own lists

**Status: built and tested locally. Not yet pushed or deployed.** This
session's clone has no push access, so it is delivered as a git bundle.
It needs one `vf-licence` migration (`0179`), applied as its own step,
and no `vf-app` migration.

## What was asked

The first item under `docs/HANDOVER.md`'s "Suggested next pieces", as
it stood: *"a keyed value is free text, not checked against Account
Coding's own configured lists"* — named in items 1 and 4 (Cost object
approval, Coding) and in "What the system does".

The operator answered three questions before any building started:

- **A keyed value that is not valid**: *refuse the save*, not save it
  and flag it.
- **The links between lists** (Cost Centre and General Ledger Code to
  the invoice's company code; General Ledger Code to the line's
  Commodity Code): *enforce them*.
- **A UBL invoice whose own `cbc:AccountingCost` is not a known Cost
  Centre**: *keep it and flag the line*. The invoice is captured as
  normal, rules can test the flag, the line is visibly marked, and
  approval routing says "not on the list" instead of quietly falling to
  the Default Approver.

A fourth question came up during the work (see "What was found"), and
the operator answered it too: **Cost Centre is filtered by company
code, leniently.** A cost centre with no company code at all stays
valid for every company.

## What was found

**The save route never looked.** `POST /invoices/:id/key`
(`key-fields-route.ts`) checked that a field was in the vocabulary,
that the stage allowed editing it (0144, 0197), and that the caller had
claimed the task (0486). It never checked that the value was an entry
Account Coding actually holds. The Coding pop-out (0453–0462) only
*offers* real entries, but anything sent to the API directly, or from
an out-of-date screen, was stored as it came.

**Approval routing hid the problem.** In Cost-Object mode,
`resolveChainFor` (`approval-hierarchy.ts`) looked the value up, found
no row, and reported *"The … chain ran out uncovered"*. The line then
went to the Default Approver with a reason that read like "the amount
is above everyone's limit". A mistyped or supplier-supplied code sent
the line to the wrong person and gave the wrong reason.

**Supplier values bypassed the pop-out entirely.** `ubl-parser.ts`
copies each line's `cbc:AccountingCost` into BT-133. That is the
supplier's version of the buyer's reference, and nothing compared it
to `cost_centres`.

**Cost Centre's company filter was documented but never built.**
Decision 0453 says *"Cost Centre by Company Code"* is one of the linked
relationships the pop-out reuses, and migration 0076 declares it
(`coding_list_type_filters`). But `viewer.js`'s `CODING_PICKER_FIELDS`
has shipped `filterKeys: []` for BT-133 since the commit that
introduced it (`ccbbc82`), so the pop-out has always offered every
cost centre. Enforcing the link on save alone would have refused
values the picker offered. Enforcing it strictly in both places could
have emptied the picker live, if cost centres were loaded without
company codes, and nobody here can query live data to check. Hence the
question, and the lenient answer.

**Coding suggestions would have become a trap.** Decision 0457
pre-fills a suggestion and saves it without a further click. A
suggestion drawn from values keyed before this decision, and now
refused, would block the very save it was meant to speed up.

Entries can't be deleted or deactivated today. No route removes a row
from `coding_list_entries` or `cost_centres`. So a value that was valid
when it was saved stays valid. The live check matters for values that
were never valid, not for ones that went stale.

## What was decided

**One check, `coding-validation.ts`, with two callers**, so the save
and the facts a rule sees can never disagree about what "valid" means.

- **`checkLineCoding`** checks BT-133, `coding.project`,
  `coding.commodity_code` and `coding.gl_code` against their lists. It
  applies each list's declared filters (`coding_list_type_filters`),
  using the same context the picker uses: company code is the
  invoice's `org_unit_id`, applied only when the invoice has one;
  Commodity Code is the line's own `coding.commodity_code`, applied
  only when the line has one. The result is `not_on_list`,
  `wrong_company` or `wrong_commodity`.
- **Strict for General Ledger Code, lenient for Cost Centre.** This is
  the picker's existing reading for the three greenfield lists, plus
  the operator's own choice for Cost Centre. `LENIENT_FILTER_LISTS`
  holds the rule once, and `ledger-route.ts`'s
  `costCentreFilterClause` repeats it in SQL, so the picker never
  offers a value the save refuses.

**On save — refused** (`key-fields-route.ts`). The route returns a 422
with `reason: "invalid_coding"`, a structured `invalid` list (line,
field, value, reason) and an English `error` sentence for anyone
calling the API directly. The check runs before anything is written.
**Only values this save changes are checked.** The viewer resends every
editable line field on every save (0109), so an untouched supplier
BT-133 that is already flagged must not block someone correcting the
amount beside it. General Ledger Code is re-checked whenever the line's
Commodity Code changes. Header-level coding is checked too, because
header facts reach every line (0027).

**On arrival and on every re-evaluation — flagged.**
`coding.line_invalid` is a new derived line fact. It holds a
comma-separated list of the failing fields, or `""` when every coded
value is valid. It is computed fresh and never stored, the same way
`po.line_*` is (0370), because a list can gain the missing entry later.
It is merged in at every place where `po.*` is already merged:

- `intake-capture-route.ts`, after `enrichFacts`, because that hook
  has only just placed the invoice's org;
- `loadLiveInvoiceFacts`, which covers every re-evaluation after a
  task completes;
- the revisit route in `index.ts`;
- the viewer's read (`handleGetInvoice`).

**A new validation check, `account_coding`**, with `danger` severity.
0400 reserved `danger` for a claim checked against a source of truth
and found not to be there, and approval routing reads these values. It
flows into `validation.failures` like every other check, so
`validation.failures contains account_coding` is a second way for a
rule to test it. The keying route builds its advisory verdict from raw
rows, so it adds this check itself through the exported
`accountCodingFailures`. Otherwise a flagged line would lose its mark
the moment someone saved an unrelated change.

**Approval routing names the real reason.** `resolveCostObjects` now
checks that the value exists first. It still goes to the Default
Approver (a line has to go somewhere), but now reads *"The cost centre
value X is not on the Account Coding list."*

**Suggestions never offer what the save would refuse.**
`handleCodingSuggestions` runs the suggested set through
`checkLineCoding` as one line, so a suggested General Ledger Code is
tested against the Commodity Code suggested beside it, and drops
anything that fails.

**The screen** (`viewer.js`, `app.css`):

- Cost Centre's picker passes `filter.company_code`.
- A line flagged by `account_coding` marks its own Coding button
  (`.codingbtn.danger`) and shows the check's label on hover. The
  coding fields live in the pop-out, so a marked table cell would be
  invisible. The Exceptions card is still hidden (see `app.css`'s
  `.exceptions`).
- A refused save is shown in the reader's own language from the
  structured `invalid` list, one line per problem
  (`codingRefusalText`). `.notealert-message` gained
  `white-space: pre-line` so those line breaks show. A message without
  line breaks renders exactly as before.

**`vf-licence` migration `0179`**: five strings in English and German
— `check.account_coding`, `viewer.coding.invalid`, and one phrase for
each reason.

## What was verified, and how

Every new test was **watched fail** first, with the production change
stashed:

- `test/coding-validation.test.ts`: 12 of 19 failed without the fix.
  The 7 that passed are the "accepts…" cases and the module's own unit
  cases, which are expected to pass either way.
- The new capture test failed with only `intake-capture-route.ts`
  stashed.
- The three new `viewer.test.ts` tests all failed with only `viewer.js`
  stashed.

Four existing tests encoded the old behaviour on purpose and were
changed on purpose:

- `key-fields.test.ts`: the two 0451 tests now seed the entries they
  key.
- `accounting-frame.test.ts`: 0453's "a cost centre with no filter
  value set at all does not match" is reversed to the lenient reading,
  and a new sibling test checks that a cost centre linked only to
  another company still doesn't match.
- `viewer.test.ts`: 0459's "a plain empty result, with no active
  filter" now uses an invoice with no org, because Cost Centre is
  scoped now.
- `coding-suggestions.test.ts`: the existing handler test seeds its
  entry.

The full-suite counts are in the "Verification" section below.

## What was not built

- **Live data was not checked.** This session has no D1 credentials.
  Before relying on the flag, run these read-only queries against
  `vf-app-poc` to see how many stored lines already hold a value that
  isn't on the list:

  ```sql
  SELECT l.invoice_id, l.line_number, json_extract(l.facts_json, '$."BT-133"') AS cc
  FROM invoice_lines l
  WHERE json_extract(l.facts_json, '$."BT-133"') IS NOT NULL
    AND json_extract(l.facts_json, '$."BT-133"') NOT IN (SELECT id FROM cost_centres);
  ```

  Run the same query for `coding.project`, `coding.commodity_code` and
  `coding.gl_code` against `coding_list_entries`.
- **Header-level stored coding is not flagged.** Keyed header coding is
  refused on save. A stored header BT-133 is not flagged on arrival,
  because UBL puts `AccountingCost` on lines, and `coding.line_invalid`
  is a line fact.
- **A suggestion is not checked against a Commodity Code already on the
  line.** The suggestions route doesn't know which line it is serving.
  A suggested General Ledger Code that fits the suggested Commodity
  Code, but not one already keyed on the line, is still refused on
  save. When that happens, the refusal message says so clearly.
- **Deactivating an entry** doesn't exist yet. If it's ever built, it
  should decide whether an inactive entry fails this check. Today every
  row in the tables counts as valid.

## Verification

- **`vf-app`**, a full, unfiltered whole-suite run: 125 files and 3051
  tests, of which 3047 passed.
  - Two failures predate this change. `capture-pdf.test.ts`'s "writes
    the corrected value back" (2272.47 vs 3137.47) and
    `stage-permissions.test.ts`'s "names exactly the permissions the
    code defines" both fail identically on untouched `origin/main`,
    confirmed with `git stash -u`.
  - The other two were this decision's own suggestion tests. The
    suite loaded `coding-suggestions.ts` before its change was saved.
    Re-run afterwards, `coding-suggestions.test.ts` and
    `coding-validation.test.ts` together passed 30/30.
- **`vf-licence`**: full suite 320/320 across 21 files, including
  `string-coverage.test.ts` with the five new keys required.
- **`vf-ui`**: Worker 75/75.
  - Browser 1194/1195 across 48 files. The one failure is the known
    `typography.test.ts` hardcoded-`10px` gap, the same one recorded
    at 0510.
  - `viewer.test.ts` on its own: 246/246.
- **`shared`**: 295 passed, 3 failed. Two are the known Web Crypto
  failures in `licensing/token.test.ts`. The third is
  `migration/table-classes.test.ts`, which lists 25 unclassified
  tables. It is the known third failure and predates this change,
  because no table was added here.
- **`python3 scripts/check-citations.py`**: 511 records, none
  dangling.
- **`npx eslint`** on every touched file: clean, apart from one error
  that predates this change (the unused `loadStoredInvoiceLines`
  import on `index.ts` line 111, identical on `HEAD`).
- **`npx tsc --noEmit`**: no new errors in any touched file. The two
  `ledger-route.ts` errors, at lines 247 and 269, predate this change,
  confirmed with `git stash`.
- **`wrangler deploy --dry-run`**: both `vf-app` and `vf-ui` bundle.
