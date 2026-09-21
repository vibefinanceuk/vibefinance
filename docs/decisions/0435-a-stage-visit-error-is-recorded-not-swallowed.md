# 0435 — A stage visit error is recorded, not swallowed

**Status: built, tested, documented, pushed and deployed, confirmed
directly** — `origin/main` fetched directly reads `7233382`, matching
this session's own commit exactly; the operator confirmed with
*"pushed and deployed"*. This session still has no push access to
`vibefinanceuk/vibefinance`; delivered as a git bundle for the
operator's own pull/push/deploy sequence, the same path decisions
0391, 0415–0434 already used.

---

## What was found

Immediately after decision 0434 deployed, the operator re-tested and
reported real progress — *"pushed and deployed - this seems to have
worked. The item is in validation, so far as I can see the in the
Documents screen."* — followed directly by: *"however, nothing appears
in the Tasks screen strangely."*

The invoice reaching Validation and stopping there was decision 0434
working exactly as intended. The missing task pointed at something
else. Tracing `handleCreateTask` (`task-route.ts`) found the
requirement decision 0200 built it around: `assign_task` needs a
`requiredPermission` from *somewhere* — the stage's own declared
permission, or the rule's own action naming one — and refuses outright
(`422`) if neither supplies one. `visitCurrentStage`
(`workflow-engine.ts`) turns that refusal into its own `500`.

**And `handleCaptureIntake` (`intake-capture-route.ts`) was
unconditionally returning `201` regardless of what `visitCurrentStage`
reported**, folding the real error into `body.visit.error` — a field
nothing ever read. An invoice whose rule fired `assign_task` against a
stage with no declared permission stored successfully, sat at
Validation because the visit errored out before it ever reached the
"advance" logic, and produced no task, no error banner, no signal of
any kind that anything had gone wrong. It looked identical to an
invoice genuinely waiting on a person — the exact shape this session
had just spent two decisions making sure a *rule-driven* block would
never be silently missed, undone by a *misconfigured* one being
silently invisible instead.

Two follow-up questions to the operator — whether the Validation
stage's own settings, or the rule's own action, declared a required
permission — came back *"can't tell from the screen"* / *"not sure."*
Rather than keep asking the operator to hunt through configuration
screens for a setting that might not exist, the more useful fix is
making the failure visible wherever they are already looking: the
invoice itself.

**Confirmed directly against the live database** (read-only queries,
run by the operator, against `vf-app-poc`) while this decision was
being built: `process_stages.required_permission` for the Validation
stage is `null`, and the live rule's own `compiled_json` is exactly
`{"conditions":{...ambiguous_site...},"actions":[{"type":"assign_task","params":{"team":"ap-validation"}}]}`
— no `permission` key anywhere. Neither of decision 0200's own two
sources supplied one, matching this decision's own hypothesis exactly.
Fixed live with `UPDATE process_stages SET required_permission =
'AP.Validate' WHERE id = 'validation'` — a one-column, reversible
change, not something this decision's own code needed to touch.

## What was built

`handleCaptureIntake` now checks `visitResult.status` after the first
visit. Where it is `>= 400` — a genuine engine refusal, not an
ordinary "nothing fired" outcome — the underlying error is written
onto the invoice as a new fact, `workflow.stageError`, the same
"why, not just that" treatment decision 0162 already gives an
unplaced document (`org.unplaced`). The response itself still reports
`201`: the invoice genuinely was stored, and turning that into an
error status risked a caller (a mail pipeline, say) treating a stored
document as lost and retrying it.

`invoice-facts-route.ts`'s invoice-detail response surfaces it as
`workflowStageError`, mirroring `buyerUnplaced`'s own field right
beside it. The viewer (`viewer.js`) shows it as a new banner —
`workflowErrorPanel()` — in the process column, above the stage
progress bar, whenever it is present: a labelled prefix (one new
string, `viewer.workflow.stageerror`, migration `0144`) followed by
the raw error text itself, shown as recorded rather than translated —
unlike `supplier.unmatchedReason`'s three closed reasons, an engine
error has no fixed vocabulary to translate it into.

This is a general fix, not specific to `assign_task` or to Validation:
any stage-visit refusal `visitCurrentStage` can produce (an
`assign_org` naming an org that does not exist, a `route_to` aimed at
a stage that does not, a stage requiring a permission a rule
disagrees with) now reaches the same fact, the same banner.

## Tests

`workers/vf-app/test/source-capture-workflow.test.ts` — new describe
block, "a stage visit that errors out is recorded, not swallowed
(decision 0435)," 2 tests: reproduces the operator's own exact
misconfiguration (a rule's `assign_task` naming no permission, on a
stage declaring none either) and confirms the invoice still stores
(`201`), no task exists, and `workflow.stageError` names the real
underlying error; and confirms an ordinary successful visit writes
nothing (no false positives).

`workers/vf-ui/test-browser/viewer.test.ts` — new describe block, "a
workflow stage error is shown, not silently absorbed (decision 0435),"
2 tests: the banner renders with the labelled prefix and the raw error
text when `workflowStageError` is present, and renders nothing when it
is not.

`workers/vf-licence/test/string-coverage.test.ts` — **not extended**,
the same reasoning as decision 0433's own Tests section:
`test/setup.ts`'s migration-application list still stops at `0126`,
eighteen migrations behind this one, so `viewer.workflow.stageerror`
would never be checked here regardless.

**Suite state:** `vf-app` 2488 → **2490** (+2). `vf-ui` browser 951 →
**953** (+2). `vf-licence` unchanged at 320. `vf-ui` Worker unchanged
at 74. Full suites re-run in every workspace, all green. `eslint .`
clean across `vf-app` and `vf-ui`.

## What is not built

**Resolving the operator's own live misconfiguration.** This decision
makes the *next* occurrence — including, most usefully, the operator's
own current one — visible with a concrete error message instead of an
unexplained stall. It does not know or fix what the operator's live
Validation stage or rule actually has configured; once this deploys
and the operator re-submits a test invoice, the banner itself will say
exactly what is missing.

**A closed, translated vocabulary for engine errors.** Deliberately
left as raw text — these are configuration/engine details with no
fixed enumeration the way `supplier.unmatchedReason`'s three reasons
have, so there is nothing meaningful to translate.

**Retroactive surfacing for an invoice already stuck from before this
fix**, including the operator's own current one. Nothing here
revisits history; the fact is written only on a stage visit that
happens after this deploys. The operator's already-stuck invoice needs
a fresh submission (or a direct look at its own `facts_json`) to show
the underlying error under the current code.
