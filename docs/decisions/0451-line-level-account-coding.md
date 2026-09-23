# 0451 — Line Level Account Coding

**Status: confirmed pushed, deployed, and migration `0152` applied.**
`origin/main` fetched directly reads `c25ff2b`, matching this
session's own commit exactly, and the operator confirmed with
*"pushed and deployed and sql applied."* All three in one report —
the code, the deploy, and the migration's own separate apply step —
rather than the two- or three-part sequence earlier decisions in this
project needed.

---

## What was asked

Not asked directly — judged. The operator's own question, answered
during the Cost-Object Approval Hierarchy follow-up (decision 0450):

*"We already have a Coding stage in the Standard AP process, where
coding will take place. We have not built the Line Level Account
Coding feature yet. Does it make sense to do that before the Cost
Center approval routing."*

Yes. Decision 0450's own design document said it plainly: *"a line
coded to a Project, Commodity Code, or GL Code"* is the precondition
for routing on any of those three, and nothing in the codebase could
put such a value on a line at all. Building Cost-Object routing beyond
Cost Centre first would have been a resolver with nothing real to
resolve.

**So this is Phase 1 of two.** Phase 2 — the generalized chain walk
across cost-object dimensions, the `approval_limit` column, the
multi-task-per-line spawning the operator described (*"multiple
approval requirements for each line... would spawn multiple tasks that
could be completed in parallel"*), and the real screens from decision
0450's mock-up — is not this decision, and nothing here reaches it.

## What was found

**The capture mechanism already existed, for a field that had never
been declared.** Three generic layers, each checked directly against
its own code rather than assumed:

- `key-fields-route.ts` (`handleKeyInvoiceFields`) refuses any field —
  header or per-line — not in the closed vocabulary or not editable at
  the invoice's current stage, but places **no restriction on which
  vocabulary fields exist**. It has never had a BT-code assumption
  anywhere in it.
- `field-visibility-route.ts` (`resolveFieldVisibility`) walks
  `INVOICE_FIELDS` itself to build the list a screen receives, tagging
  `line: INVOICE_LINE_FIELDS.includes(field)` — a field declared in the
  vocabulary is configurable the moment it exists, with no new route
  code.
- `viewer.js`'s line table fetches `headerFields`/`lineFields` from
  that same resolver at render time — its own comment says why: *"the
  resolver's `line` flag says which belong to a line, so the interface
  keeps no second list of its own."*

**BT-133 (cost centre) was never special-cased — it just happened to
be the only field anyone had declared this way.** Adding three more
meant declaring them, nothing else.

## What was built

- **Three new vocabulary fields** — `coding.project`,
  `coding.commodity_code`, `coding.gl_code`
  (`shared/interpreter/vocabulary.ts`) — added to `INVOICE_FIELDS`,
  `INVOICE_LINE_FIELDS`, `INVOICE_FIELD_TYPES` (all `text`), and
  `FIELD_DESCRIPTIONS`. Named to match `coding_list_types.list_type`
  exactly, so the field and the Account Coding list it draws its
  values from never drift apart. No EN 16931 Business Term exists for
  any of them — they are keyed by a person, never parsed from a
  document — so each carries an inline comment saying that, and each
  is exempted in `shared/interpreter/field-coverage.test.ts`'s
  `DELIBERATELY_UNMAPPED` with that reason stated, the same discipline
  that test exists to enforce for every other gap.
- **A new `ui_strings` migration**,
  `workers/vf-licence/migrations/0152_line_level_account_coding_field_labels.sql`
  — `field.coding.project` / `field.coding.commodity_code` /
  `field.coding.gl_code`, in English and German, the same
  `field.bt-133` precedent (migration 0020) `viewer.js` already reads
  for every other line label. `workers/vf-licence/test/setup.ts`
  updated to apply it in the test schema, matching every migration
  before it.
- **Tests proving the mechanism reaches these fields with no route
  change**, not just declaring them and hoping:
  - `workers/vf-app/test/field-visibility.test.ts` — hidden by default
    (the same as BT-133), becomes editable and is tagged `line: true`
    once a customer configures it, and can be restricted back to
    read-only at a stage — the ordinary field-visibility lifecycle,
    unchanged.
  - `workers/vf-app/test/key-fields.test.ts` — refused with
    `not_editable_here` until configured editable, then a line can
    actually be keyed to a project, a commodity code, and a GL code
    together, stored in the line's own `facts_json`, and recorded in
    `keyed_fields` the same way `line.1.BT-131` already is.

## What was not built

- **No Coding stage.** The operator reports one already exists in
  their own live environment, created at runtime through
  `process-route.ts` and stored in D1 — not something this repo seeds
  through a migration, and not something this session can see or
  verify directly. Nothing here creates, names, or assumes a specific
  stage; the mechanism works at whichever stage a customer configures
  these fields `edit` on, exactly as BT-133 already does.
- **No enforcement against Account Coding's own lists.** A person can
  key `coding.project` to any text today, the same free-text status
  decision 0031/0076 already left BT-133 in. Validating a keyed value
  against `coding_list_entries` is real, unbuilt scope of its own —
  named so it is not mistaken for something this decision quietly
  assumed.
- **No approval routing.** Nothing in `approval-hierarchy.ts` or
  `workflow-engine.ts` reads any of these three fields — that is
  exactly Phase 2, and building it now, ahead of a resolver ready to
  use the values, would be plumbing that does nothing. `resolveCostObject`
  is unchanged and still reads `costCentreId` alone.
- **No `AP.Code` wiring, no screen.** The permission decision 0450's
  design document already named as the closest fit stays exactly what
  it was — declared, unused.

## Verification

Targeted, given the vf-app full-suite timeout decision 0449 already
hit and recorded: `shared/interpreter/field-coverage.test.ts` (4/4),
`shared/interpreter/vocabulary.test.ts` and
`shared/standards/code-lists.test.ts` (37/37 together),
`workers/vf-licence/test/string-coverage.test.ts` (10/10, confirming
the new labels resolve and nothing is self-referential),
`workers/vf-licence`'s full suite (320/320, unchanged count — no new
suite added, existing coverage tests now exercise the new fields),
`workers/vf-app/test/field-visibility.test.ts` and
`workers/vf-app/test/key-fields.test.ts` together (76/76 — 70
pre-existing plus 6 new), `workers/vf-app/test/ar-process.test.ts` and
`test/expense-process.test.ts` (9/9, the other two files anywhere in
the codebase that import `INVOICE_FIELDS`), and
`workers/vf-ui/test-browser/compose.test.ts` (32/32, the remaining
consumer). Every file anywhere in the codebase that imports
`INVOICE_FIELDS`, `INVOICE_LINE_FIELDS`, `INVOICE_FIELD_TYPES`, or
`FIELD_DESCRIPTIONS` was checked directly rather than assumed clear —
ten files found, all ten run. `shared/licensing/token.test.ts`'s two
Web Crypto failures are pre-existing and unrelated — confirmed by
running the identical file against `origin/main` before any of this
segment's edits, with the same two failures.

## Still to do, operator side

Deploy `workers/vf-licence`'s migration `0152` once pushed. Confirm
where the operator's live Coding stage sits in their process, so a
future decision can name it. Then: Phase 2, the Cost-Object Approval
Hierarchy generalization itself, per decision 0450's design document
and the operator's own priority answer (*"multiple tasks... completed
in parallel"*).
