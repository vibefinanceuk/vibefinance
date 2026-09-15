# 0350 — Supplier Maintenance: a Third Vocabulary and a Real Trigger

**Status: built.** "A new Supplier Maintenance process... identify
that a new supplier invoice has been received, or maybe some
information has changed. Create a task for the Supplier Maintenance
team, who can validate the changes and receive a task to do so."
Confirmed as a genuinely separate process rather than a stage on the
existing AP one, on the operator's own reasoning: "a separate process
flow would be more efficient for monitoring and reporting."

---

## What this closes, named years ago and left open

Decision 0231 built `supplier.awaitingErp` specifically so a rule
could route on it, and said so directly: "a rule can route on
*awaiting*, and that rule is the new-supplier process the operator
described." Decision 0233 confirmed the same boundary from the other
side — *"nothing triggers the new-supplier process... that is
deliberate. Building it here would be guessing at three things they
know and we do not: their team, their stage, their permission."*

The operator has now supplied all three. This is that sentence
finally getting written — as a real, own process rather than a rule
on the existing one, per the reasoning above.

**The other half was never designed at all.** Checked directly rather
than assumed: no fact, column, or comparison anywhere detects a
changed supplier. Decision 0208's own "replace rather than merge"
philosophy means a load has always silently overwritten a supplier's
old values. This is genuinely new work, not a missing rule over an
existing signal.

## A third vocabulary, and two bugs it found

`SUPPLIER_FIELDS` (`id`, `name`, `reason`, `changed_fields`) joins
`invoice` and `expense` in the `VOCABULARIES` registry, no derived
fields at all — everything here is supplied directly at the moment a
maintenance instance is created, nothing computed the way
`party.first_document` is.

**Two real, pre-existing bugs surfaced by being the third name to
exist**, both a binary `vocabulary === "invoice" ? A : B` ternary that
only ever worked because exactly two vocabularies existed until now:

- `resolveVocabulary` itself would have silently given a third
  vocabulary expense's own field types.
- The compiler's own prompt-builder would have rendered "EXPENSE
  FIELDS:" as a third vocabulary's own heading, and told the model
  its platform-derived fields were "never submitted by the employee"
  — wrong on both counts for a supplier record.

Both fixed with a real, generic lookup; both probed directly by
reverting each fix in turn and confirming the right test fails. A
vocabulary with zero derived fields (supplier's own case) also needed
its own fix — the doc-builder rendered an empty "PLATFORM-DERIVED
FIELDS:" heading over nothing before this.

## A draft is not new schema; neither is a new process instance

The mechanism is `spawnSupplierMaintenanceInstance` — one instance,
`subject_type: "supplier"`, on the same generic `process_instances`
machinery every invoice already uses, wired into two places:

- **`handleCreateSupplier`**, when `!erp` — exactly decision 0231's
  own `supplier.awaitingErp`.
- **`handleLoadSuppliers`**, via a new `detectSupplierChanges`
  comparison — scoped deliberately narrow to name, VAT id, electronic
  address, and payment terms. There is no bank or payment-account
  field in this schema at all today, worth knowing rather than
  quietly working around.

**Fails soft, by design.** A supplier record must never fail to save
because an optional, later-added maintenance process hasn't been
seeded in a given deployment — confirmed directly with a test that
creates a supplier against a database where the process does not
exist at all.

## The rule is hand-written, not compiled — and said so

The real compiler runs on Cloudflare Workers AI, which this session
has no credentials for (confirmed directly from the code's own
comment: "this session has no Cloudflare credentials"). The rule
needed here — assign a task to the Supplier Maintenance team,
unconditionally — has no genuine compilation ambiguity for a model to
resolve, so it is hand-written to the exact JSON shape the compiler
would have produced, and validated directly against the real
interpreter (`validateRule`, `evaluateRuleSet`) before being seeded,
not merely believed correct.

`required_permission` is set directly on the stage itself (decision
0200's own safer pattern), not left to the rule alone: `Supplier.
Maintain` is a new permission, added the same way this codebase
already extends a closed permission set — restating the standing
invariant in a new migration (`0066`) rather than editing an
already-applied one in place, the exact, documented discipline
`stage-permissions.test.ts` already names for `0062` and `0063`.

**The same discipline was nearly missed for a second, similar
invariant.** `rule_sets.vocabulary`'s own standing invariant (migration
0010) was initially edited in place — caught from the same evidence
that named the permission convention, reverted, and redone as its own
new migration (`0067`) for consistency. Worth recording rather than
just quietly fixing: the wrong instinct was to edit history, and the
codebase's own test suite is what corrected it.

## Seeded, not migrated

`docs/operations/supplier-maintenance-seed.sql` — the process, its
one stage, the team, the rule set, and the rule — deliberately not a
migration, the same reasoning `ap-live-process-definition.sql`
already established: this is one customer's own configuration, not
something every customer's database should get asserted onto it.

**One real, honest limitation, stated rather than guessed around.**
`org_teams.unit_id` is `NOT NULL`, and this session has no visibility
into which real org units exist in the live database. The script
assigns the team to whichever unit has no parent — the top-level
entity every real setup has exactly one of — and says so plainly in
its own comments: review before running.

## What has coverage

Two of decision 0022's own doc-builder tests extended with a
`supplier`-vocabulary block, plus new tests directly on the two bugs
this found (each probed by reverting the fix). Seven new integration
tests exercise the full, real path — a supplier created via
`handleCreateSupplier`, a supplier changed across two loads via
`handleLoadSuppliers` — seeding exactly what the operations script
does, confirming a real instance and a real, claimable task exist at
the end of it. Both triggers probed directly: removing each in turn
and confirming the right test fails.

`shared`: 281 (+13, 3 known pre-existing failures unchanged).
`vf-app`: 1677 (was 1671).

## Deliberately not decided here

- **No worked examples exist for the seeded rule.** The normal
  compile → confirm → activate path (decision 0007) was bypassed
  entirely, by necessity; a real customer's own future edits to this
  rule would go through that path as normal.
- **Whether "changed" should ever distinguish which fields changed
  in the routing itself** — `changed_fields` is in the vocabulary,
  comma-separated, ready for a `contains` condition, but the seeded
  rule does not use it. A real customer wanting a different team for
  a payment-terms change specifically now can.
- **Reconciling two local rows for one company** — decision 0231's
  own largest named hole, untouched by this.
