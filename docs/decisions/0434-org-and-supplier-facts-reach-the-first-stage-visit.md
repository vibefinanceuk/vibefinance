# 0434 — Org placement and supplier matching reach the first stage visit

**Status: built, tested, documented. Not yet confirmed pushed and
deployed** — this session still has no push access to
`vibefinanceuk/vibefinance`; delivered as a git bundle for the
operator's own pull/push/deploy sequence, the same path decisions
0391, 0415–0433 already used.

---

## What was found

Decision 0433 recommended a Validation-stage rule — `Condition:
supplier.unmatchedReason equals ambiguous_site`, `Action: create a
task` — for exactly the scenario the operator had reported: an
invoice whose supplier match was ambiguous reaching payment-eligible
unflagged. The operator built that rule, live, as recommended, and
tested again. **The same behaviour persisted**: *"On testing I am
seeing the same behaviour - the invoice goes straight to
Payment-eligible."*

The rule itself was correct — confirmed directly against the
operator's own screenshot, condition and action both exactly as
recommended, live. So this was not the configuration gap decision
0433 already flagged as the operator's own to fill in. It was a real
bug, and tracing it found one:

**`supplier.unmatchedReason` did not exist yet at the moment the
Validation-stage rule was evaluated.**

`handleCaptureFromSource` (`source-capture-route.ts`) — the email
intake path every real invoice arrives through — dispatches to a
structure-specific handler (`handleCaptureUblXml`,
`capturePreExtractedXml`, or `handleCaptureImage`) that stores the
invoice, creates its process instance, and **immediately visits the
first stage**, cascading through every automatic stage in one call —
sometimes all the way to `completed`. Only *after* that call returns
does `handleCaptureFromSource` derive the invoice's org (decision
0111) and match its supplier (decision 0209), writing both to
`invoice_headers` for display. By then the instance had often already
finished. **A fact written after the only rule that could ever test
it had already run is a fact that rule will never see.**

Confirmed live rather than reasoned through: a reproduction using the
operator's own rule, two supplier sites sharing one VAT number (the
same ambiguous shape as their own `TEST-ORG-0020`), submitted through
`handleCaptureFromSource` exactly as an emailed invoice would be. The
instance completed, zero tasks, while `invoice_headers.facts_json`
correctly held `supplier.unmatchedReason: "ambiguous_site"` — written,
truthfully, to a fact nobody would ever read again.

**Every fact decisions 0230, 0231 and 0238 wired up shares this exact
defect** — not only decision 0433's own flag. `supplier.onHold`,
`supplier.awaitingErp`, `supplier.paymentTerms`, `supplier.matchOption`
and both tolerance facts are computed in the identical post-hoc block,
for the identical reason, and were equally unable to reach a rule at
an email-captured invoice's first stage visit. None of this affects
the direct `/capture-xml` or `/capture-image` API routes — org
derivation and supplier matching have only ever been wired into
`source-capture-route.ts`, a deliberate scope decision 0111 states
explicitly (*"a source is a transport concern... most [paths] have no
source at all"*) — so this was always specific to the mailbox intake
path, not a defect in the rule engine itself.

## What was built

`handleCaptureIntake` (`intake-capture-route.ts`) — the single
choke point every capture path already funnels through to store,
create an instance, and visit it — now takes an optional
`enrichFacts` hook: an async function given the merged facts right
before that first visit, whose result is merged on top. Every existing
caller, including the direct API routes, simply omits it and is
unaffected — additive, not a behaviour change for anyone but the path
that now supplies one.

`handleCaptureUblXml` and `handleCaptureImage` (both shared between
the direct API routes and source-capture) gained the same optional,
purely pass-through parameter.

`source-capture-route.ts` now builds that hook
(`buildIntakeEnricher`) from exactly the same computation the existing
post-hoc block already runs — source default org, else
`deriveOrgUnit`; then `matchSupplier`, org-aware since decision 0317;
then the matched supplier's own hold/ERP/terms/match-option/tolerance
fields — and hands it to every one of its own capture paths
(`capturePreExtractedXml`, the `structured_xml` and image dispatches,
and `captureWithoutFacts`, for consistency even though an
undetectable document has no identifiers to ever be ambiguous about).

**The existing post-hoc block was deliberately left in place**,
unchanged. It still owns the durable `invoice_headers` columns
(`org_unit_id`, `supplier_id`, `on_hold`, and the rest) that outlive
any one request and that other screens read directly rather than
through a process instance's own facts. This decision closes the gap
for the rule engine specifically; it does not merge the two
computations into one, so a future change to either should check
whether the other needs the same change — each function's own comment
says so, in both directions.

## Tests

`workers/vf-app/test/source-capture-workflow.test.ts` — new file, 3
tests: blocks at Validation with a real task for the operator's own
exact scenario (two sites sharing a VAT, neither a pay site), no
regression for an ordinary unambiguous match (still completes, zero
tasks), and no false block for `no_match` (nothing loaded at all —
decision 0433's own scoping, only `ambiguous_site` flags).

`workers/vf-app/test/source-capture.test.ts`,
`intake-capture-route.test.ts`, `workflow-engine.test.ts`,
`capture-pdf.test.ts`, `load-suppliers.test.ts` — all re-run in full,
all still passing: the new hook is additive and every existing caller
still supplies none.

Full `vf-app` suite re-run in full after the change. `eslint .` clean.

## What is not built

**Unifying the pre-visit and post-hoc computations into one.** Both
now call `deriveOrgUnit`/`matchSupplier` independently, from the same
facts, against the same DB state, within the same request — correct
today, but a change to one that is not mirrored in the other is a real
way for them to drift. Left as two deliberately parallel blocks rather
than a deeper refactor of `handleCaptureFromSource`'s own structure,
which touches more of this file than this decision's own scope
justified.

**Retroactively re-evaluating any invoice already sitting at
payment-eligible from before this fix.** An invoice that already
completed under the old ordering — including the operator's own
`TEST-ORG-0020` — stays completed; nothing here revisits history. A
genuinely new test, submitted after this deploys, is what will exercise
the fix.
