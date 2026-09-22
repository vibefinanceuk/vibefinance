# Handover

**Written 4 September 2026, updated 17 September (six times), updated
18 September (four times), updated 19 September (thirty-two times),
updated 20 September (twenty-two times), updated 21 September
(twenty-five times).**

**For a session starting cold.** Where things stand, what needs a
decision rather than work, what to do next, and the habits this project
has earned the hard way.

It holds **only what the other files cannot give you**:

- `docs/PROGRESS.md` — the map. What exists, what does not.
- `docs/decisions/` — the authority on *why* anything is as it is.
- `docs/decisions/SUPERSEDED.md` — what stopped being true.

**Nothing is struck through here.** When a thing is done it leaves this
page and appears in `SUPERSEDED.md`, because two copies of the same
history is one copy that lies — and the stale one is always the copy
nobody is told to check.

**Read `SUPERSEDED.md` before trusting an old record.** Records are never
rewritten to agree with later ones, so **contradictions between them are
real and neither is wrong** — they are dated. That page maps which
supersedes which, and it exists because the trap has been fallen into
twice.

---

## Where things stand

| | |
| --- | --- |
| `origin/main` | `184f53d` — fetched directly by this session, matching this session's own decision 0439 commit exactly. Decisions 0434 (org placement and supplier matching now reach the first stage visit) and 0435 (a stage visit error is recorded, not swallowed) are confirmed pushed and deployed. **Decisions 0436 through 0438 (the sidebar fix) are confirmed pushed and deployed — the operator reported *"deployed and pushed - works great"*.** **Decision 0439 (Approval Hierarchy — the migration and the resolver) is now also confirmed pushed and deployed — the operator reported *"pushed and deployed"*.** |
| vf-admin deployed | `8e27a34` · `https://admin.vibefinance-ai.com` · behind Cloudflare Access |
| vf-app deployed | `ca1de60` confirmed — decisions 0429 (agreed payment means, a supplier-record placeholder), 0430 (Talk to an AP Expert, Screen 6) with all eight of its own addenda, 0431 (Executive IQ's remaining four metrics), 0432 with its own addendum, 0433 (org-ranked supplier search), 0434 (org/supplier facts reach the first stage visit), 0435 (a stage visit error is recorded, not swallowed), and 0436 (vf-ui only — the nav's own content scrolls), all confirmed. **Decision 0439 (Approval Hierarchy — schema and resolver, vf-app only) is also confirmed pushed and deployed, per the operator's own report — no screen or write API exists yet for any of it, so nothing behind it is reachable except by direct SQL, exactly as decision 0439 itself says.** |
| vf-licence deployed | `ca1de60` per the operator's own reports; migrations `0140` through `0144` all applied — `0144` is decision 0435's own banner-label string. Decision 0436 added none. |
| vf-ui deployed | `ca1de60` · `https://app.vibefinance-ai.com` — operator's own reports, confirmed directly: *"deployed and pushed"* against the icon buttons live, then, with a screenshot, *"the icons are a little lower or the text box is higher. They seem a little un-aligned"*, then *"pushed and deployed"* again confirming the alignment-fix addendum live, then *"deployed and pushed"* confirming decision 0433's own org-ranked supplier search live, then *"pushed and deployed - this seems to have worked"* confirming decision 0434 live, then *"pushed and deployed"* again confirming decision 0435 live, then *"pushed and deployed"* again confirming decision 0436 live, then *"deployed and pushed - works great"* confirming decisions 0437 and 0438 live together. |
| Domain | `vibefinance-ai.com` · **email intake receives real invoices** |
| `vf-app-poc` migrations | through `0074` applied and confirmed live — `0073` (decision 0429) is real schema; `0074` (decision 0430) is a documentation-only `ASSERT` restatement with no schema change, the same shape as `0071`; none of 0430's eight addenda needed a new `vf-app` migration; decision 0431 also needed none — its four new routes read existing tables only; decision 0433 also needed none — its ranking change reads the existing `org_unit_id` column only; decision 0434 also needed none — it changes when facts already computed reach the workflow engine, not the schema; decision 0435 also needed none — it writes a new fact through the existing `facts_json` column. **A tenant-data fix, not a migration**: the operator's own live Validation stage had `required_permission IS NULL` — the root cause behind decision 0435's own finding — fixed directly with `UPDATE process_stages SET required_permission = 'AP.Validate' WHERE id = 'validation'`. **This did not hold on the first attempt**: after decision 0435 deployed, a fresh test invoice hit the identical `requiredPermission "undefined"` error via the new `workflow.stageError` banner, and a direct re-check found `required_permission` back to `NULL` — code was traced end to end (`process-route.ts`'s stage-creation and draft/publish handlers, `field-visibility-route.ts`, `rules-list-route.ts`) and **nothing in the application ever writes this column**, so the revert's cause is unexplained, not a known bug. Re-run a second time with the `UPDATE` and a `SELECT` in the same statement batch, confirmed set to `AP.Validate` in that same round-trip, and then confirmed durable and working end-to-end by the operator submitting a genuinely fresh test invoice: it stopped at Validation, no error banner, and a task appeared with `required_permission = AP.Validate`. **If this reverts a third time**, suspect a second database bound to the same `vf-app-poc` name (check `wrangler d1 list` against `workers/vf-app/wrangler.toml`'s `database_id`) rather than re-tracing application code again. **`0075` (decision 0439, Approval Hierarchy) is now applied and confirmed live too** — the operator's own report, *"pushed and deployed"*. |
| `vf-licence-poc` migrations | through `0144` applied and confirmed live — the operator's own `apply_migrations.py --remote` run, `0144` is decision 0435's own banner-label string (`viewer.workflow.stageerror`, en/de). |
| Tests | vf-admin 9 · vf-app **2513** (2490 + 21 `approval-hierarchy.test.ts` + 2 `workflow-engine.test.ts`, decision 0439, confirmed by one unfiltered whole-suite run) · vf-licence 320 (unchanged) · vf-ui 74 Worker (unchanged by 0439 — vf-app only) + 960 browser (unchanged by 0436/0437/0438 since those confirmed live) · shared 295 (+3 known pre-existing failures) |
| Decision records | 439 |

**Decision 0437 (the nav's box is really one viewport tall, and
doesn't scroll sideways) is built, tested, documented, and confirmed
pushed and deployed** — `origin/main` fetched directly reads `07326fa`,
matching this session's own commit exactly, and the operator confirmed
with *"deployed and pushed - works great"* alongside decision 0438.
Decision 0436 shipped, and the operator reported
back: *"that doesn't seem to have worked... I still have to scroll
down the page to see the username and instance"*, then separately:
*"Now there seems to have been introduced a horizontal scrollbar which
is not needed."* Re-checked live (built-in browser, a genuine desktop
width, with the device's own dev tools reached directly) rather than
assumed either way — this session's device connection dropped
mid-investigation and had not reconnected as of this paragraph, so the
fix below is verified by live measurement taken just before the
connection dropped, not by a live re-check of the fix itself.
**Decision 0436's own diagnosis was wrong**: the 1040px-vs-1000px
measurement it read as `.navscroll`'s content overflowing its box was
actually `.nav`'s own `padding: 20px 12px`, added on top of `height:
100vh` by the default `box-sizing: content-box` rather than included
in it — `.navscroll`'s content was confirmed, by the same live check,
to fit its own space with zero overflow. Measuring `.nav` before and
after decision 0436 deployed gave identical numbers, which a real
before/after comparison should have caught and didn't. The horizontal
scrollbar is a real, separate regression from decision 0436's own
`overflow-y: auto` — the CSS Overflow spec silently promotes
`overflow-x` to `auto` whenever the other axis is set and this one is
left at its default `visible`, turning a small pre-existing horizontal
overflow in the nav column from invisible into an actual scrollbar.
Fixed: `.nav { box-sizing: border-box }` (so `height: 100vh` now means
the whole rendered box, padding included) and `.nav .navscroll {
overflow-x: hidden }`. Decision 0436's own `.navscroll` wrapper was
left in place — real protection against a genuinely longer nav
someday outgrowing its box, even though it wasn't what this particular
symptom needed — with its own comment in `app.css` corrected rather
than left to mislead the next reader. **Not fully closed**: `body`'s
own top padding (32px) still leaves `.nav`'s natural, un-stuck
position 32px below the true top of the viewport, so a small scroll
can still be needed immediately on page load before `position: sticky`
engages — a candidate fix (a matching negative `margin-top` on `.nav`)
was considered and deliberately not shipped without a live visual
check, since the connection dropped before it could be verified and a
position change to a hand-tuned sidebar is exactly the kind of thing
arithmetic alone has gotten wrong once already in this same
investigation. New describe block in `tasks.test.ts` (+2). `vf-ui`
browser 956 → 958, all green; Worker, `vf-app`, `vf-licence`
untouched. `eslint public test-browser` clean. **The remaining 32px
gap named above was closed the same session, once the device
connection came back — see decision 0438.** See decision 0437 for the
full reasoning and tests.

**Decision 0438 (the nav is flush with the top of the viewport from
the very first paint) is built, tested, documented, and confirmed
pushed and deployed** — the operator confirmed with *"deployed and
pushed - works great"*, the same reply that confirmed decision 0437.
The device connection came back this session, so the
gap decision 0437 deliberately left open was checked properly rather
than left for a future session: the candidate fix (`margin-top:
-32px` on `.nav`, cancelling `body`'s own 32px top padding for this
one element) was live-patched onto the still-deployed page (decision
0436's own code — 0437 had not yet reached production) and measured
directly before writing anything to source. **Unpatched**: `.nav`'s
rendered box measured `top: 32, bottom: 1072`, `.who`'s own bottom at
`1012` — twelve pixels below a 1000px viewport, at scroll position
zero. **Patched**: `.nav` became `top: 0, bottom: 1000`, exactly one
viewport, flush at the top; `.who`'s bottom moved to `980`, fully
visible with no scrolling at all. `.topbar` (the rest of the page)
measured identically before and after, confirming a negative margin on
one grid item doesn't disturb its siblings — checked rather than
assumed — and a screenshot of the patched page was reviewed directly
for visual misalignment (none found). Built: `.nav { margin-top:
-32px }` in the wide layout, `margin-top: 0` resetting it in the
narrow-screen media query, where `.nav` is an ordinary flow element
with no such gap to cancel. Coupled to `body`'s own padding value
(`tokens.css`, `2rem 1rem`) by a literal number, not a shared
variable — stated plainly in the comment. New describe block in
`tasks.test.ts` (+2). `vf-ui` browser 958 → 960, all green; Worker,
`vf-app`, `vf-licence` untouched. `eslint public test-browser` clean.
**Nothing from this session is outstanding for the sidebar — decisions
0436 through 0438 together fully resolve the original report, now
confirmed live by the operator's own *"deployed and pushed - works
great."*** See decision 0438 for the full reasoning and tests.

**Decision 0439 (Approval Hierarchy — the migration and the resolver)
is built, tested, and confirmed pushed and deployed** — `origin/main`
fetched directly reads `184f53d`, matching this session's own commit
exactly, and the operator confirmed with *"pushed and deployed."* The
operator asked
for a new "AP Setup" nav section (Matching, Account Coding, Approval
Hierarchy tabs), starting with Approval Hierarchy's Employee-Supervisor
mode, and to investigate before building. That investigation found
more already in place than the backlog note claimed: `org_users.
manager_id` (0334) and `org_authority_limits` (0009) already hold a
supervisor and a per-currency limit, and `resolveApprovalChain` (0195)
already implements Cost-Object mode's own chain walk — both just
unused. **The exact gap the operator named directly was real**: both
are global per person, with no way to express "EUR at Acme France, GBP
at Acme UK." Closed additively — two new unit-scoped override tables
(`org_user_supervisor_overrides`, `org_authority_limit_overrides`)
beside the existing global ones, neither rebuilt, read through
`unit-config.ts`'s own `unitLineage()` walk. A new `org_approval_config`
singleton holds the customer-wide mode and a Default Approver (the
operator's own answer for a routing gap); a new `process_stages.
uses_approval_hierarchy` column (the same shape `required_permission`
already has) marks the one stage that resolves through it rather than
whatever a rule names. The new resolver (`approval-hierarchy.ts`)
starts an Employee-Supervisor chain from whoever completed the task on
that line at the stage immediately before Approval — structurally, by
sequence, never a hardcoded stage id — and climbs through supervisors
by unit-scoped limit; a person with **no limit recorded escalates**
rather than approves everything, deliberately the opposite of
`resolveApprovalChain`'s own null-limit convention. `workflow-engine.ts`
wired accordingly: an unresolved hierarchy 409s with a named reason
rather than creating an ownerless task. `vf-app` 2490 → 2513 (+21 new
`approval-hierarchy.test.ts`, +2 `workflow-engine.test.ts`), full
unfiltered run, all green; migration chain replays clean (75
migrations); `eslint` clean. **Deliberately not built this round, at
the operator's own sequencing**: the AP Setup screen and its three
tabs, the write API for the new tables, a way to turn
`uses_approval_hierarchy` on other than by hand, Matching and Account
Coding (both confirmed genuinely greenfield), and Manual/API modes
(named, no resolver). See decision 0439 for the full reasoning and
tests.

**Decision 0436 (the nav's own content scrolls, so `.who` stays on
screen) is pushed and deployed, confirmed directly.** `origin/main`
fetched directly reads `ca1de60`, matching this session's own commit
exactly; the operator confirmed with *"pushed and deployed"*
immediately after the automated stop-hook flagged the one unpushed
commit. Asked live: *"I wondered if the height of the side menu
alone can resize to the height of the browser window, so the username
and instance, which appear at the bottom can always be seen
on-screen?"* — read as a possible duplicate of decision 0281's own fix
(the wording is close to identical), so checked live before touching
anything rather than assumed either way. Signed in through the
built-in browser at a genuine desktop width (the preview pane's own
default width is under 1100px and triggers a *different*, intentional
0281 behaviour — the narrow-screen horizontal bar, which hides `.who`
entirely by design): `.nav` itself measured exactly as 0281 built it —
`position: sticky`, a `1000px` computed height — but its own rendered
content (the logo images plus every `.navgroup`/`.navitem`) measured
`1040px`, forty pixels taller than the box, overflowing straight past
`.nav`'s own bottom edge with nowhere else to go. **0281 capped the
box; nothing capped what went inside it** — three more configuration
screens (Purchase Orders, Rules, Processes) joined the nav afterwards,
each a real addition nobody had reason to re-check against a
fixed-height sidebar at the time. Fixed by wrapping the logo and every
nav item in a new `.navscroll` div (`tasks.js`), kept a sibling of
`.who` rather than a parent of it, given `overflow-y: auto; min-height:
0` in the wide layout (`app.css`) so the nav ITEMS scroll internally
once there are enough of them while `.who` stays pinned to the bottom
of `.nav`'s own unchanged, one-viewport box; `display: contents` in
the narrow-screen media query undoes the wrapper there so the
horizontal bar's flex layout is unaffected. New describe block in
`tasks.test.ts` (+3); one pre-existing test ("the brand mark... sits
at the head of the column") repointed at `.navscroll`'s own children,
since the DOM it asserted against genuinely moved one level deeper —
the property it checks is unchanged. `vf-ui` browser 953 → 956, all
green; Worker, `vf-app`, `vf-licence` untouched. `eslint public
test-browser` clean. **This decision's own diagnosis was wrong, found
after it deployed with zero effect — see decision 0437, which
corrects it.** The `.navscroll` wrapper this decision built stayed in
place (real protection against a genuinely longer nav someday
outgrowing its box), but the 1040-vs-1000px measurement it read as
content overflow was actually `.nav`'s own padding being added on top
of its `height: 100vh` rather than included in it — nothing this
decision built addressed that. See decision 0436 for the full
reasoning and tests.

**Decision 0435 (a stage visit error is recorded, not swallowed) is
pushed and deployed, confirmed directly.** `origin/main` fetched
directly reads `7233382`, matching this session's own commit exactly;
the operator confirmed with *"pushed and deployed"* immediately after
the automated stop-hook flagged the one unpushed commit. Immediately
after decision 0434 deployed, the operator re-tested and reported real
progress — *"pushed and deployed - this seems to have worked. The item
is in validation"* — followed directly by *"however, nothing appears
in the Tasks screen strangely."* Traced to `handleCreateTask`'s own
requirement (decision 0200): a task needs a required permission from
either the stage or the rule's own action, and refuses outright if
neither supplies one — `visitCurrentStage` turns that refusal into a
real error, and `handleCaptureIntake` was unconditionally returning
`201` regardless, folding the error into a `body.visit.error` field
nothing ever read. The invoice looked exactly like one genuinely
waiting on a person. **Confirmed live against the real database**, by
the operator's own read-only queries: the Validation stage's own
`required_permission` was `null`, and the live rule's own
`compiled_json` named no permission either — fixed live with a
one-column `UPDATE`, no code involved (see the migrations row above).
This decision is the code fix for the *next* time this class of
misconfiguration happens, anywhere in the process: `handleCaptureIntake`
now writes the real error onto the invoice as `workflow.stageError`
whenever a visit genuinely fails (`>= 400`) — the same "why, not just
that" treatment `org.unplaced` already gets (decision 0162) — surfaced
through `invoice-facts-route.ts` and shown as a labelled banner in the
viewer, above the stage-progress bar. One new string, migration
`0144`, now applied and confirmed live. New describe blocks in
`source-capture-workflow.test.ts` (+2) and `viewer.test.ts` (+2), both
reproducing the operator's own exact misconfiguration. Full suites
re-run in every workspace — `vf-app` 2490, `vf-ui` browser 953 — all
green. **This did not retroactively fix `TEST-ORG-0020`** — nothing
here revisits history; a person needs to manually re-trigger its stage
visit or submit a fresh test invoice to see the now-working rule, now
that the stage's own permission is set (already done live — see the
`vf-app-poc` migrations row). **Nothing from this session is currently
outstanding for decision 0435 itself.** See decision 0435 for the full
reasoning and tests.

**Decision 0434 (org placement and supplier matching now reach the
first stage visit) is pushed and deployed, confirmed directly.**
`origin/main` fetched directly reads `d07e5f5`, matching this session's
own commit exactly; the operator confirmed with *"pushed and deployed
- this seems to have worked."* The operator built decision 0433's own
recommended Validation-stage rule exactly as written, tested again, and reported
the same behaviour: *"On testing I am seeing the same behaviour - the
invoice goes straight to Payment-eligible."* The rule was confirmed
correct, live, against the operator's own screenshot. Tracing it found
a real bug, not a configuration gap: `handleCaptureFromSource` (the
email intake path every real invoice arrives through) creates a fresh
process instance and visits its first stage **immediately** — often
cascading straight to `completed` in that one call — and only
*afterward* derives the invoice's org and matches its supplier,
writing both to `invoice_headers` for display. A Validation rule
testing `supplier.unmatchedReason` was being asked to test a fact that
did not exist yet. Confirmed live with a reproduction using the
operator's own rule and the same ambiguous-VAT shape as their own
`TEST-ORG-0020`: the instance completed with zero tasks while the fact
it needed sat correctly, and uselessly, in `facts_json`. Every
supplier.* fact decisions 0230/0231/0238 wired up shared the identical
defect, not only decision 0433's own flag. Fixed with an additive hook
— `handleCaptureIntake` now takes an optional `enrichFacts` callback,
called immediately before the first visit; every existing caller,
including the direct `/capture-xml`/`/capture-image` API routes,
supplies none and is unaffected. `source-capture-route.ts` builds it
from the same computation its own post-hoc block already runs, left in
place unchanged for the durable columns other screens still read
directly. New file `source-capture-workflow.test.ts`, 3 tests: blocks
with a real task for the operator's own exact scenario, no regression
for an ordinary match, no false block for `no_match`. Full `vf-app`
suite (2488) re-run and green; `vf-licence`/`vf-ui` untouched. **This
decision genuinely fixed the ordering bug it targeted** — confirmed by
the operator's own re-test, which correctly reached and stopped at
Validation. What it did not yet reveal was decision 0435's own
finding, immediately above: the Validation stage itself had no
required permission configured, an unrelated, pre-existing tenant
misconfiguration nothing here could have caught, since it only becomes
visible once a rule actually tries to fire. **Nothing from this
session is currently outstanding for decision 0434 itself.** See
decision 0434 for the full reasoning and tests.

**Decision 0433 (the manual supplier search ranks by the invoice's own
org) is pushed and deployed, confirmed directly.** `origin/main`
fetched directly reads `a3d5ab1`, matching this session's own commit
exactly; the operator confirmed with *"deployed and pushed."* Live
testing surfaced an invoice whose seller matched two active sites
sharing one VAT number, neither a pay site — `matchSupplier`'s own
`ambiguous_site` outcome — reported directly by the operator with a
screenshot: *"however when I open the invoice it states that the
supplier could not be recognised."* The invoice had already run
through every stage to payment-eligible despite that. Asked directly
what to build: *"I think we need a rule in the Validation stage to
flag for a user to select the right supplier, based on the Org of the
Buying legal entity identified."* Two things, not one: the Validation-
stage rule itself is tenant configuration this session cannot reach —
no migration in this repository seeds a process, stage, or rule set,
every one is created through the product's own Rules screen — so it is
written up as an exact recommendation for the operator's own Rules
screen (Stage: Validation; Condition: `supplier.unmatchedReason equals
ambiguous_site`; Action: create a task) rather than built. What *is*
code, and is built here: the manual "select the right supplier"
picker a person reaches from that task had no idea which org the
invoice belonged to, searching every active supplier with equal
weight. `handleSearchSuppliers` now takes the invoice's own org and
ranks a same-org site first — never filters, only ranks, the same
answer decision 0317's own tiebreak already gives for the automatic
case — with a new *"Same org as this invoice"* marker in the picker's
own list so a person sees why a row is near the top. One new string
(migration `0143`), no new icons, no vocabulary or rule-engine changes
— `supplier.matched` and `supplier.unmatchedReason` were already real
facts, "create a task" was already an ordinary action. Full
`vf-app` (2485) and `vf-licence` (320) suites both confirmed green
after the build; the full `vf-ui` browser suite (951) confirmed green
too. **Nothing from this session is currently outstanding — every
commit through decision 0433 is pushed and deployed.** See decision
0433 for the full reasoning, the two clarifying questions and their
answers, and the complete test breakdown.

**Decision 0432 (Ask and Clear, restyled as icon-above-label buttons)
is pushed and deployed, confirmed directly.** `origin/main` fetched
directly reads `4b76969`, matching this session's own commit exactly;
the operator confirmed with *"deployed and pushed"*, against the icon
buttons live on the screen. Asked directly, live: *"change the Ask and
Clear buttons to be Icons, similar to other buttons on the page, with
text beaneath."* Both now go through `viewer.js`'s own `actionLink()`
— the same icon-above-label stack every other action button on the
page already uses — reusing two already-true icons rather than drawing
new ones: `post`'s own paper plane for Ask (decision 0268's "send"),
`restoredefault`'s own curling arrow for Clear (decision 0303's
"restore to default," which is exactly what clearing this
never-persisted chat is). No new strings, no new icons, no new test
file — six new assertions inside two already-tested cases. See
decision 0432 for the full reasoning and tests.

**Decision 0432's own addendum — a vertical alignment fix — is pushed
and deployed, confirmed directly.** `origin/main` fetched directly
reads `f1001f5`, matching this session's own commit exactly; the
operator confirmed with *"pushed and deployed."* Reported directly,
live, with a screenshot, once the icon buttons above went live:
*"please can you fix the alignment, so that the icons are a little
lower or the text box is higher. They seem a little un-aligned."*
`.chatinputrow`'s own `align-items: flex-end` (this decision's
original build) was bottom-edge-aligning the input against
`.actionlink`'s own icon-above-label stack exactly as written —
confirmed by a headless rendering of the actual markup and stylesheet,
bottom edges matched to the pixel — but the stack's own weight sits in
its icon near the top, so a shared bottom edge still read as the
buttons floating above the input; the same rendering measured the two
elements' visual centres roughly 9-10px apart. Switched to
`align-items: center`, which lines up the two elements' own visual
centres instead — confirmed by the same rendering — without
reintroducing `stretch`'s own problem. One rule changed, no new
strings, no new icons, no new test file — the existing 82-test
`ap-analytics.test.ts` + `typography.test.ts` pair and the full
948-test `vf-ui` browser suite both still pass in full. **Nothing from
this session is currently outstanding — every commit through decision
0432's own addendum is pushed and deployed.** See decision 0432's own
addendum section for the full reasoning and tests.

**Decision 0431 (Executive IQ's remaining four data-buildable metrics
— liabilities and accruals by entity, cross-entity supplier
concentration, cross-entity exception and fraud-signal trend, and
cross-org throughput/workload comparison) is pushed and deployed,
confirmed directly.** `origin/main` fetched directly reads `e4534f0`,
matching this session's own commit exactly; the operator confirmed
with *"deployed and pushed - I can see the reports in the Executive IQ
tab"* — a report against the live screen itself, not just the served
code. Asked directly: *"are there any more dashboards to create in the
AP Analytics screens?"*, then *"Please can you build 'Executive IQ /
Multi-Enterprise CFO View — 1 of 6 metrics built. Consolidated spend
across org units/legal entities exists'"* — the operator's own choice
once every screen's own build status was laid out. One real fork went
to the operator first: cross-entity supplier concentration's own "top
vendor" definition and flag threshold, answered **top 5 per entity,
flagged at 2 or more entities**. Every new route reuses decision
0425's own resolved scoping question unchanged — `AP.Analysis` +
`holdsEverywhere`, no `currentOrg` narrowing, grouped by the invoice's
own recorded `org_unit_id`, never summed across currencies, uncapped.
**Cash position across currencies, the design's own sixth and last key
metric for this screen, was checked directly and confirmed
unbuildable** — no table anywhere in the schema captures a cash or
bank balance, the same class of gap Financial Performance's own
DPO/cash-flow-forecast/payment-history metrics already document — and
is left honestly not built rather than faked. Executive IQ now shows
five of the design's own six key metrics. Migration `0142` (decision
0431's own strings) confirmed applied the same way. **Nothing from
this session is currently outstanding — every commit through decision
0431 is pushed and deployed.** See decision 0431 for the full
reasoning, every route and card, and the complete test breakdown.

**Decisions 0429 (agreed payment means, a supplier-record placeholder),
0430 (Talk to an AP Expert, Screen 6), and all eight of 0430's own
addenda are pushed and deployed, confirmed directly.** `origin/main`
fetched directly reads `eb921d1`, matching this session's own commit
exactly, and the operator's own report — *"deployed and pushed"* —
covers all of it together; migrations `0140` and `0141` (the chat
tab's own strings, and its Clear/Download button strings) both
confirmed applied the same way. None of the eight addenda needed a new
`vf-app` migration. **Nothing from this session is currently
outstanding — every commit through decision 0430's eighth addendum is
pushed and deployed.**

**Decision 0430's eighth addendum (disclosing `unclaimedAndAvailable`
even when nobody currently has a task claimed) is pushed and deployed,
confirmed directly.** A production smoke test run right after the
sixth/seventh addenda went live confirmed both of those fixes work
correctly, and found one more small gap of the same shape as the sixth
addendum's own disclosure fix: *"who is the most active AP team
member?"* answered as though the workflow were empty
(`openTasksPerPerson` genuinely was empty) without ever mentioning
`unclaimedAndAvailable` — the same tool's own real, positive count
sitting right beside that empty list, on a workflow whose one open task
simply hadn't been claimed by anyone yet. Every other easy-to-miss
field (`documentUrl`, `moreMayExist`, the sixth addendum's own
`unconfirmedAmountCount`) already gets its own explicit answer-prompt
instruction for exactly this reason; this one never had. Fixed with one
new sentence in `buildAnswerPrompt` — no change to `tasks_by_user`'s own
data, which was already correct. See decision 0430's own doc, "Addendum
eight," for the full reasoning and tests.

**Decision 0430's seventh addendum (a downloadable CSV/PDF report, and
a Clear button next to Ask) is pushed and deployed, confirmed
directly.** Asked directly, live: *"when asked for a report, provide something I can download,"*
and a Clear button next to Ask. Two forks went to the operator —
format ("both, user's choice") and trigger ("explicit ask only") — both
answered before building. `ApAssistantAnswer.table` is now built
server-side, straight from `invoice_search`'s own real tool result
(never LLM-authored), and returned alongside the answer text so a
download can never show a number the chat bubble didn't. The client
renders "Download CSV"/"Download PDF" only when the *question* itself
reads as a download ask and a table came back — never automatically.
CSV reuses `purchase-orders.js`'s own `Blob`/`createObjectURL` pattern
with real per-cell escaping; PDF has no library and no bundler to add
one with, so it opens a blank window, builds a plain `<table>` with the
same `textContent`-only discipline as everywhere else, and calls
`win.print()` — the browser's own print-to-PDF is the export. The
Clear button resets the in-memory chat history to empty; nothing
persisted server-side to undo. New bilingual UI strings via a new
`vf-licence` migration, `0141`, following `0140`'s own exact pattern.
See decision 0430's own doc, "Addendum seven," for the full reasoning
and tests.

**Decision 0430's sixth addendum (disclosing an unconfirmed-amount
total mismatch, and fixing a document link that neither worked nor
rendered) is pushed and deployed, confirmed directly.** A live-test transcript showed a
five-row invoice list summing to £8,580 sitting directly above its own
"exact" total of £6,072 — correct (the total only ever sums confirmed
rows, third addendum) but never explained, so it read as wrong. Fixed
with a new `unconfirmedCount`/`unconfirmedAmountCount` signal, and an
explicit instruction for the answer prompt to disclose the exclusion
rather than leave the mismatch unexplained or blend the unconfirmed
amount into the total. The same transcript's document link used the
retired, decision-0073-era raw signed-URL pattern instead of decision
0384's `document-window.html`, and, even had it been right, rendered as
inert plain text — `el()`'s own deliberate `textContent`-only
discipline (0126) never turns a string into a link on its own. Fixed by
switching to decision 0384's own URL pattern (which also let
`documentUrlSecret`/`origin` come out of the tool-run context and route
handler entirely) and by having the answer prompt emit exactly one
narrow markup form, `[label](url)`, that the client parses into a real
`<a>` — never `innerHTML`, never a markdown library — sharing decision
0384's "one window, always" pop-out via `viewer.js`'s newly-exported
`POPOUT_NAME`. Neither item was put to the operator as a fork — both
direct continuations of already-established discipline. See decision
0430's own doc, "Addendum six," for the full reasoning and tests.

**Decision 0430's fifth addendum (workflow-stage filtering on
`invoice_search`, and a systemic fix for two separate overclaim bugs
sharing one root cause) is pushed and deployed, confirmed directly.**
A second live
test surfaced two more gaps: "list the invoices held at the Validation
stage" refused outright (no filter existed for it), and in the same
round `accrual_summary` overclaimed "no invoices are listed in any
other stage" — a claim its own data structurally cannot support, since
it only ever covers invoices still accruing. Both trace to one shared
architectural gap — `buildAnswerPrompt` never told the phrasing model
what a tool's own data does and does not cover, the same root cause
already behind the document-fabrication bug the third/fourth addenda
fixed for `invoice_search` specifically — so this was fixed once,
systemically, with a new `AP_ASSISTANT_TOOL_SCOPE` map (one scope
statement per tool, fed into every answer) rather than patched at each
symptom. The stage filter itself resolves a stage *name* to every
matching real stage id first (`resolveStageIds`, since
`process_stages` is customer-configurable and a name can mean more
than one real id), added additively to `invoice_search`,
`documents-route.ts`, and `invoice-count-route.ts` (the last via
`EXISTS`, deliberately not a `JOIN`, to avoid inflating a count for
any invoice that ever picks up more than one process instance — proved
with a dedicated test). A third live-test transcript also surfaced a
formatting-only follow-up gap ("can you provide a table of results?"
refused as naming no criteria of its own) — fixed by having the
selection prompt re-run the same tool and arguments as the preceding
real question, re-fetching fresh data rather than reformatting a
remembered answer. Neither item was put to the operator as a fork —
both narrow, low-risk, and within already-approved scope. See decision
0430's own doc, "Addendum five," for the full reasoning and tests.

**Decision 0430's fourth addendum (calendar-period totals, a minted
document link for the single-invoice case, and dash normalization) is
pushed and deployed, confirmed directly.** The same live-test round surfaced three more real
gaps: "total invoice amount for this quarter" refused outright (only a
month floor existed on the third addendum's own count route, never a
quarter one); the single-row "most recent invoice" case (`latestOnly`)
never got the same document-link minting `invoice_lookup` already had,
so a real document was reported as "not on file"; and an invoice
number that had just appeared correctly in a search result then failed
an exact-match follow-up lookup — most likely, though not reproducible
against this session's own test data (no production database access),
because the pasted transcript's own invoice numbers use a
non-standard Unicode hyphen that `COLLATE NOCASE` does not fold. Fixed
with `firstOfThisQuarter()` in `dates.ts`; a bounded, single-mint
document link added to `invoice_search`'s own `latestOnly` case; and a
defensive `normalizeInvoiceNumberQuery()` on `invoice_lookup`'s own
exact-match query, stripping Unicode dash variants before the bind,
never touching what gets stored. Two forks put to the operator
directly, both answered: whether to build period-scoped totals at all
(*"Yes, month + quarter"*) and whether `invoice_search` should mint a
document link for the `latestOnly` case (*"Yes, mint one for
`latestOnly` only"*). See decision 0430's own doc, "Addendum four,"
for the full reasoning and tests.

**Decision 0430's third addendum (an exact invoice count, ambiguous-
lookup links returned immediately, and bounded conversation memory)
is pushed and deployed, confirmed directly.** A third live-test
transcript the operator pasted in showed three further real gaps:
"how many invoices" questions still refused (no tool anywhere computed
an exact count — `invoice_search`'s own list is capped at 50, so
reusing it would undercount); an ambiguous `invoice_lookup` (two real
invoices sharing the printed number `INV-NW-1003`) asked "which one
did you mean?" and then could never be answered, across five further
follow-up messages ("both," "share both invoices," ...); root cause
traced directly to the AP Assistant having **zero memory between
questions** — its own original, explicit "ephemeral, nothing sent to
the server" design choice from decision 0430's first build. Two
design forks put to the operator directly rather than decided
silently: whether an ambiguous lookup should return every match's own
document link immediately instead of asking an unanswerable follow-up
question (the operator chose **yes, return every match's link
immediately**); and how long the assistant should remember prior
turns (the operator's own answer: *"The assistant should keep memory
for the current session length, to a maximum of 15 minutes. Would
that be okay, without causing system strain, and too wide a
context?"*). Built: a new, separate, unbounded `GET /invoices/count`
route (`invoice-count-route.ts`) — deliberately not derived from
`invoice_search`'s own capped list, mirroring `/invoices/lookup`'s own
precedent of a real, independently-reachable endpoint; `invoice_lookup`
reversed to mint and return a document link for every ambiguous match
(capped at 10, matching `duplicate_invoices`' own precedent) instead
of withholding all of them; and bounded conversation memory reusing
the browser's own pre-existing `history` array (kept for display since
the original build, never before sent to the server) rather than any
new server-side storage — no Durable Object, KV, or D1 table added,
consistent with this app running stateless per request on Cloudflare
Workers. Bounded on both turn count and client-side recency (15
minutes) together, since a time-only cap would not bound a fast
conversation's own prompt growth. The operator asked directly what
raising the turn cap to 10 would cost in real Cloudflare Workers AI
terms; answered with sourced, current pricing
(`@cf/openai/gpt-oss-120b` at $0.35/million input tokens, 10,000 free
Neurons/day) showing the cost negligible even at 10 turns. The
operator's own explicit instruction followed: *"That cost is
negligible. We currently have no users, and I would limit this
functionality to AP Managers and C-Suite. So lets bound it at 50
turns"* — built at `MAX_RECENT_TURNS = 50` exactly, both server
(`ap-assistant.ts`) and client (`ap-assistant.js`), re-validated and
re-capped server-side regardless of what the client sends, the same
untrusted-input treatment the question text itself already gets. A
real, narrow production asymmetry was found while fixing a test
fixture gap, not silently resolved: `invoice_search`'s own list (via
`documents-route.ts`) matches a supplier name only against the
document's own captured `BT-27` fact, never the real linked
`suppliers.name` record, while the new count route prefers the real
linked name, falling back to `BT-27` — documented as a deliberate,
unresolved limitation. `vf-app` 2355 → 2374 (19 new, plus a new
`invoice-count-route.test.ts` file), `vf-ui` browser 915 → 916 (1 new).
`eslint` clean. See decision 0430's own doc, "Addendum three," for the
full reasoning.

**Decision 0430's second addendum (`invoice_search`, a tenth tool) is
pushed and deployed, confirmed directly.** A live-test transcript the
operator pasted in showed three plain browsing questions refused
outright — "can you provide a link to the latest invoice," "please
list invoices received this month," "please lookup all invoices" —
because every existing tool needed an exact identifying detail
(a supplier, a PO, an invoice number) the assistant had no tool for
answering without. The operator's own direct question, *"Should I not
be able to query like this?,"* confirmed this was a real gap, not
intended behaviour. Built `invoice_search`, wrapping the real
Documents screen's own existing route (`handleListDocuments` in
`documents-route.ts`) rather than a new query, gated by `AP.Review`
(the same permission that screen itself uses), capped at 50 results
(or 1 for "the latest" specifically), with an optional `period:
"this_month"` (a new `firstOfThisMonth()` date helper and a new
`since` SQL param, inert unless supplied) and optional supplier
narrowing reusing that route's own existing in-memory text search.
Put to the operator directly when asked "what are the design forks?":
result cap and how to communicate it (the operator's own custom
answer — notify the user the query is capped at 50 and to use the
Documents screen for larger sets, rather than silently truncating or
paginating). `vf-app` 2340 → 2355 (15 new, plus `firstOfThisMonth`
tests in `dates.test.ts` and a `since` test in `documents.test.ts`).
`eslint` clean. See decision 0430's own doc, "Addendum two," for the
full reasoning.

**Decision 0430's own addendum (five more AP Assistant tools, and the
tasks-vs-exceptions bug live testing found).** Real live-tested
transcripts the operator pasted in showed the assistant answering
"Who has the most tasks assigned?" with mislabeled exception-count
data — root cause was an ambiguous tool description plus a shared,
ambiguous result field name letting the phrasing model relabel an
exception count as a task count. The operator's own explicit
instruction: *"Yes, please fix - Also the tool should be able to
inquire upon purchase orders, invoices, duplicates, tasks and provide
links to documents."* Fixed with a two-layer approach — a new,
correctly-matching `tasks_by_user` tool, plus renamed, unambiguous
result fields (`exceptionsPerPerson`, `openTasksPerPerson`),
contrastive tool descriptions in the selection prompt, and a general
anti-relabeling instruction in the phrasing prompt. Five new tools in
total: `tasks_by_user`, `purchase_order_status`,
`purchase_order_lookup`, `duplicate_invoices`, and `invoice_lookup`
(which returns every match rather than guessing, since
`invoice_number` carries no uniqueness constraint in this schema, and
mints a real document link via the same `document-token.ts` machinery
the existing document route uses, extracted into a shared
`handleMintDocumentUrl` so both paths stay in sync). No new permission
or migration needed — all nine tools (four original, five new) are
each gated by their own existing, real permission. `vf-app` 2316 →
2340 (24 new), `eslint` clean. A self-correction is recorded in the
addendum's own text: the original decision 0430 doc had wrongly
justified adding `/liabilities/overdue-balance` to `vf-ui`'s proxy
list on the grounds that a missing entry would 404 every assistant
question — false, since every tool call is an in-process function
call, never a second browser fetch; the addendum corrects this in
place rather than silently editing the original. See decision 0430's
own doc, addendum section, for the full reasoning.

**Decision 0430 ("Talk to an AP Expert," the sixth and last AP
Analytics tab).** The operator's own instruction, following decision
0426's discovery of a sixth screen this repo had never tracked:
*"okay thank you I think lets try part 6 next."* A conversational tab
answering plain-language AP questions through exactly four named tool
calls (`supplier_spend`, `overdue_balance`, `accrual_summary`,
`exception_counts`) — never open text-to-SQL, the design's own
explicit instruction — gated by a new, dedicated `AP.Assistant`
permission that gates the tab itself, not the data: every tool call is
separately re-checked against its own real permission at call time.
Three genuine design forks put to the operator directly rather than
decided silently: "overdue" honestly defined as still-open and past
its due date (this codebase has no payment-execution data — 0429);
the final answer phrased by a second model call rather than shown as
raw structured data; chat history ephemeral for this first build. Two
model calls per question, both reusing decision 0002's own existing
`CompilerModel`/`AiRunnable` infrastructure rather than duplicating it.
A new standalone `GET /liabilities/overdue-balance` route backs the
design's own worked example, deliberately kept out of the Financial
Performance tab since "overdue balance" is not one of that screen's
own six listed metrics. Along the way: adding `AP.Assistant` broke the
"closed set, in two places" permissions invariant, fixed with a new
migration (`0074`) restating it, the same pattern decision 0071
already used for `AP.FraudReview`; both new `vf-app` routes were found
missing entirely from `vf-ui`'s own proxy allow-list and added there;
a pre-existing gap was found in `vf-licence`'s own test harness
(roughly the last fourteen UI-string migrations never wired into
`test/setup.ts`) — confirmed pre-existing and self-consistent, left
alone. `vf-app` 2287 → 2316 (29 new), `vf-ui` browser 910 → 915 (5
new), `vf-licence` 320 (migration `0140`, no new test file). `eslint`
clean on every changed file. See decision 0430's own doc for the full
reasoning, and `docs/PROGRESS.md` for the durable record.

**Decision 0429 (agreed payment means, a supplier-record placeholder;
the report dashboard deliberately not built).** The operator's own
instruction, following a factual question about Peppol BIS Billing
3.0's payment fields: *"add the fields to the supplier record, as a
placeholder — but we should hide the report dashboard at this
point."* Three new nullable columns on `suppliers` (migration `0073`),
loaded exactly like `discount_pct`/`discount_days` (0427) from a
customer's own CSV export, and deliberately left out of every other
surface — not in `EDITABLE`, not in the suppliers screen, not in any
route's `SELECT` list beyond the load itself, no comparison route, no
dashboard card. Two independent reasons the report stays unbuilt,
both checked directly: this codebase captures nothing from an inbound
invoice's own `BG-16` payment-instructions group, so there is no
"invoiced" side to compare against yet; and a report over a mostly-
`NULL` column is the same category of mistake decision 0428's own
second addendum already pulled a live card for. `vf-app` 2281 → 2287
(6 new). `eslint` and `migrations/test_apply_migrations.py` (27
passed) clean. See decision 0429's own doc for the full reasoning, and
`docs/PROGRESS.md` for the durable record.

**Decision 0428 (Workload's remaining seven metrics) and both of its
own live addenda are pushed and deployed, confirmed directly.**
`origin/main` fetched directly reads `32a99d5`, matching this
session's own commit exactly (superseded by `df32830` above), and the
operator's own "pushed and deployed" covers all three commits
together.

**The original build (`7fd97e0`).** "shall we tackle - User & Team
Workload 1/8. - 7 metrics, none previously tracked" — the operator's
own instruction; Workload's own count against its own design list had
never actually been checked before decision 0426's own correction, and
only "Throughput by user, stacked by stage" (0415) existed of its own
eight. Built all seven together, the operator's own choice over one at
a time. One genuine structural gap surfaced before building: "tasks
pending action and approaching/past due" needs a per-task due date,
and none exists anywhere in this schema — `hold_until` is a fired rule
action logged against an *invoice*, never a queryable column on a
*task*, confirmed by grepping the whole codebase. The operator chose
to build "pending over a period" only, honestly leaving "approaching/
past due" unbuilt rather than held back entirely. Seven new
`AP.Analysis`-gated routes, no new `vf-app` migration (reuses
`tasks`/`org_teams`/`stage_visits`); `vf-ui`'s `PROXIED_TO_INSTANCE`
wildcard widened rather than extended with seven exact-match entries,
matching the `/suppliers/[^/]+$/` precedent; new `vf-licence` strings
migration `0139` (34 keys, 68 rows). Test suites at this point: `vf-app`
2233 → 2287 (54 new), `vf-ui` browser 873 → 915 (42 new), `vf-licence`
320 (migration `0139`, no new test file).

**First addendum, a real scoping bug found live and fixed
(`0c646a7`).** The operator's own confirmation of the deploy came with
a screenshot: the Workload Balance card showing the same person,
"Alice McDonald," with an identical count in every one of seven teams
— "the chart seems to show replication though." Investigated directly
rather than patched on sight: `org_team_members` was joined correctly
per team, so the memberships were real, not duplicated — the *count*
beside each name was the bug, global (a member's whole open workload,
anywhere) rather than scoped to the team the card was showing, exactly
as this decision's own first build intended but not as the operator
expected once seen live. Put to the operator directly: team
memberships confirmed real (expected for an early pilot with one
person staffed across every team); the operator chose to scope each
team's own count to tasks that team itself owns
(`t.owner_team_id = tm.id`, the same column `workload/queue-depth`
already reads) over keeping the whole-workload reading. Two new tests
prove it: a member on two real teams now shows a different, smaller
count in each; a task with no owning team at all is honestly excluded
even when it's genuinely that member's own. `vf-app` 2287 → 2289 (2
new); `vf-ui` unaffected (backend-only fix, no response shape changed).

**Second addendum, Exceptions by user pulled entirely (`a861a69`,
`32a99d5`).** No request attached, just the card's own subtitle quoted
back: *"Not to assign blame — to see where extra support or training
would help."* Put to the operator directly rather than assumed —
explain the reasoning, change the wording, or flag a real concern.
The operator chose **flag a real concern**, and was right on two
counts: naming individual users in a ranked list, gated only behind
the broad `AP.Analysis` rather than the narrower `AP.FraudReview`
decision 0423 used for the identical underlying exception data, with a
subtitle that disclaims blame but enforces nothing; and, once the
calculation itself was investigated at the operator's own request, a
raw `COUNT(*)` of exceptions per user with **no denominator** — the
operator's own words, *"that does not indicate that they need
training. It indicates that they are the most productive."* Offered
three ways to fix the calculation (rank by rate with count as context,
add rate but keep ranking by count, or pull the report), with both the
calculation and the access question still unresolved at once, the
operator chose to **pull the report entirely** rather than ship a
partial fix. No route, no card — `workload-exceptions-route.ts` and
`workload-exceptions.js` (plus their tests and wiring) removed, fully
recoverable from commit `7fd97e0` for whoever redesigns the
calculation and the access gate together. `vf-app` 2289 → 2281 (−8),
`vf-ui` browser 915 → 910 (−5). **A staging mistake caught before
delivery, not by the operator**: the first commit for this addendum
(`a861a69`) only staged the file deletions — a bad `git add` pathspec
silently dropped the rest — caught by `git status` before bundling,
fixed with a second commit (`32a99d5`) that wired up the actual
removal (index.ts, ap-analytics.js, both test files).

Workload now has six of its own eight key metrics built and live, one
built half (pending-over-a-period, honestly not approaching/past-due),
and one built, deployed, then pulled (exceptions by user) — not the
full parity with its own design list the decision's own original title
implied. See decision 0428's own doc, including both addenda, for the
full reasoning, and `docs/PROGRESS.md` for the durable record.

**Decision 0427 (early-payment discount eligibility and hold
history — Supplier Performance's last two metrics) is pushed and
deployed, confirmed directly — the live behaviour itself, not just the
served code.** `origin/main` fetched directly reads `96c7eae`, matching
this session's own commit exactly. "Lets finish off Supplier
Performance" — both of this screen's own remaining metrics had been
genuinely parked, not merely deferred; investigating the real blockers
first surfaced three real design decisions, each put to the operator
directly: how discount terms are captured (structured `discount_pct`/
`discount_days` fields on `suppliers`, the operator's own choice, over
parsing free text), how hold history is captured (a general
field-change audit trail across all three real write paths into
`suppliers`, the operator's own choice — explicitly the *broader* of
two options offered, after investigating those write paths found CSV
mirror-load can silently flip `on_hold` on every reload), and how the
discount metric should be scoped once "capture rate" turned out to
still need payment-execution data nowhere in this codebase (the
operator chose eligibility, an honestly narrower metric, over the
design's own literal but overclaiming "capture rate"). Deliberately
kept separate from decision 0350's own pre-existing
`detectSupplierChanges` mechanism, left untouched. **The two new cards
first showed "Could not load this tab right now"** — migration `0072`
(the new `suppliers` columns and the `supplier_field_changes` table)
had not yet been applied to the live database, a separate step from
the code deploy this project has always kept separate (`apply_migrations.py
--remote`, operator-run only). Resolved once the operator ran that
migration and vf-licence's own `0138` for the new strings; confirmed
directly with "I put a supplier on hold and it applied to the list."
Supplier Performance now has all eight of its own key metrics built —
the first of the design's six dashboard screens to reach full parity
with its own design list. Full local test suites all clean: `vf-app`
2196 → 2233 (37 new), `vf-ui` browser 860 → 873 (13 new), `vf-licence`
320 (migration `0138`, no new test file), `vf-ui` Worker unchanged
(both new routes matched an existing proxy wildcard). `eslint .` and
`tsc --noEmit` clean. See decision 0427's own doc for the full
reasoning, and `docs/PROGRESS.md` for the durable record.

**Decision 0426 (`docs/PROGRESS.md` undercounted the design — a sixth
screen, and Workload's own metrics, never tracked) is pushed, confirmed
directly.** `origin/main` fetched directly reads `96c7eae` (decision
0427's own commit), which carries this one in its own history.
Documentation only, nothing to deploy. Asked "what else is remaining,
to bring the dashboards in line with the mock-ups" once decision 0425
shipped; answering it meant re-reading the design document directly
rather than trusting this repo's own prior summary of it, which
surfaced two real gaps in the record: the design names **six** new
dashboard additions, not five — its own Executive Summary lists "Talk
to an AP Expert" as a sixth, which had never once appeared anywhere in
this repo's docs, its own full Screen 6 section, `AP.Assistant`
permission, and Phase 5 sequencing all previously unrecorded — and
Workload's own remaining seven of eight key metrics had never been
checked against the design's own list for that screen at all, unlike
every other screen's count. Reported to the operator before touching
anything; the operator chose to correct the record now, before picking
the next build. `docs/PROGRESS.md`'s own "Not built" section rewritten:
the six-screen count, Workload's own seven unbuilt metrics named for
the first time, "payment history" restored to the Liabilities &
Accruals list (it had silently dropped out), and a new paragraph for
Screen 6 itself. No code changed. The dated 0415/0417 narrative entries
describing "five screens" are left as-is — they record what was
believed at the time, and this project's own standing rule is that
records are never rewritten to agree with later ones. See decision
0426's own doc for the full reasoning.

**Decision 0425 (consolidated spend across org units / legal
entities — the Multi-Enterprise CFO View's first real metric) is
pushed and deployed, confirmed directly — the live report itself, not
just the served code.** `origin/main` fetched directly reads
`a432413`, matching this session's own commit exactly; the operator
confirmed with "deployed and pushed," then "Confirmed I can see the
new report." Asked "what would be next on the list" once decision 0424
shipped; offered four candidates, the operator chose Executive IQ /
Multi-Enterprise CFO View. The design document itself flags two real
decisions before this screen could be built at all, both put to the
operator directly: the scoping approach (the operator chose the
design's own recommended "Option 1" — reuse `holdsEverywhere` with
`GROUP BY org_unit_id`, over a genuinely new multi-select
org-comparison scope its own "Option 2" explicitly defers) and which
of the screen's six key metrics to build first (the operator chose
consolidated spend, the design's own first-listed bullet, reusing data
no new capture is needed for). No new access-control concept — the
design's own Role-Based Access Model table for this screen already
matches the pre-existing client-side tab gate exactly (`AP.Analysis`
and `holdsEverywhere = true`, checked independently server-side).
Enterprise-wide by definition — no `?org=` narrowing on either the
route or the card, since the entire point is comparing every entity at
once rather than collapsing back into a one-org-at-a-time view. Grouped
by the invoice's own recorded `org_unit_id` exactly as recorded, no
invented rollup from an operating unit to its own parent legal entity,
never summed across currencies, an unplaced invoice excluded rather
than guessed into a bucket. Executive IQ now shows one real card, not
the whole six-metric screen — the last of AP Analytics' five tabs to
gain real content. Full local test suites all clean: `vf-app` 2184 →
2196 (12 new, exactly), `vf-ui` browser 850 → 860 (9 new plus one net
new in `ap-analytics.test.ts`, both worker and browser-known-rejection
counts otherwise unchanged), `vf-licence` 320 (migration `0137`, no new
test file). `eslint .` clean across all three packages. See decision
0425's own doc for the full reasoning, and `docs/PROGRESS.md` for the
durable record.

**Decision 0424 (statistical outliers and segregation-of-duties
flags — Fraud Prevention's fourth and fifth real metrics, built
together) is pushed and deployed, confirmed directly.** `origin/main`
fetched directly reads `a3cdbe6`, matching this session's own commit
exactly; the operator confirmed with "deployed and pushed." Asked
"what would be next" once decision 0423 shipped; offered four
candidates, the operator's own answer was "Can you tackle 1 and 2" —
both statistical outliers and segregation-of-duties flags in one
request, the same bundling precedent decision 0421 already set.
Investigated first: two designs for segregation-of-duties were
considered and rejected (hardcoded stage ids, violating the engine's
own subject/stage-agnostic principle; a fully generic "any two
permissions," too unfaithful to the design's own specific word
*approving*) before settling on a hybrid — anchored on `AP.Approve`
(`process_stages.required_permission`, decision 0048), paired
generically with any other distinct permission the same person
completed on the same invoice, using `completed_by` consistently on
both sides so a pass-through stage with no declared permission never
contributes either half. Statistical outliers computes a z-score
against a supplier's own same-currency history, the candidate
self-excluded from its own baseline, with a named minimum-history gate
(5 other invoices) and threshold (2.5 standard deviations) stated
directly rather than left implicit, and an honest `zScore: null` for
the zero-variance case rather than a fabricated number. Both gated
`AP.FraudReview`, scoped by the invoice's own org unit, shaped as
uncapped worklists matching `/fraud/duplicates` and
`/fraud/unapproved-suppliers`. Fraud Prevention now shows five real
cards, not three — only vendor banking-detail-change alerts remains
unbuilt on Fraud & Risk Detection's own six metrics. Full local test
suites all clean: `vf-app` 2151 → 2184 (33 new, exactly), `vf-ui`
browser 837 → 850 (13 new, both worker and browser-known-rejection
counts otherwise unchanged), `vf-licence` 320 (migration `0136`, no
new test file). `eslint .` clean across all three packages. See
decision 0424's own doc for the full reasoning, and
`docs/PROGRESS.md` for the durable record.

**Decision 0423 (exceptions by type, by user, by supplier, trended —
Fraud Prevention's third real metric) is pushed and deployed, tested
successfully, confirmed directly.** `origin/main` fetched directly
reads `e262666`, matching this session's own commit exactly; the
operator confirmed with "deployed and pushed - tested successfully - I
can see exceptions by type, by user, and by supplier" — the live
screen itself, not just the served code. Asked "what would you
suggest next?" once decision 0422 shipped; offered four candidates,
the operator chose this one. Investigated first: a genuinely new
metric, not a re-listing of decision 0421's own supplier-exceptions
card — that one lives on Supplier Performance with one aggregate rate
per supplier over 90 days, this one lives on Fraud Prevention
(`AP.FraudReview`, scoped by the invoice's own org unit, decision
0420's own rule) and trends three breakdowns weekly over eight
calendar weeks, adding a "by user" breakdown 0421 never attempted.
Trended as weekly counts rather than rates — a rate on one week's own
small denominator would mislead, and the design's own words ask only
that a rise be *visible*, which a sparkline already shows. `charts.js`'s
own `sparkline()`, built by decisions 0242/0265 and left deliberately
unused since, gets its first real caller. "By user" credits completed
review tasks via the same `tasks.stage_visit_id` join
`workload-route.ts`'s own throughput already uses, not exceptions
directly — a visit that spawns one task per line can credit several
people once each, a real, tested asymmetry against the supplier/type
breakdowns, not a double-count bug. Full local test suites all clean:
`vf-app` 2126 → 2151, `vf-ui` browser 828 → 837 (both worker and
browser-known-rejection counts otherwise unchanged), `vf-licence` 320
(migration `0135`, no new test file). `eslint .` clean across all
three packages. See decision 0423's own doc for the full reasoning,
and `docs/PROGRESS.md` for the durable record.

**Decision 0422 (unapproved-supplier invoices, Fraud Prevention's
second real metric) is pushed and deployed, confirmed directly.**
`origin/main` fetched directly reads `30d6e10`, matching this
session's own commit exactly; the operator confirmed with "pushed and
deployed." Asked "whats next?" once decision 0421 shipped; offered
four candidates, the operator chose this one. Investigated first: an
invoice is "not on file" when `invoice_headers.supplier_id IS NULL` —
confirmed reliable by reading `matchSupplier()`'s own write path
directly, since `source-capture-route.ts` only ever sets that column
on a real match, across all three of that function's own failure
reasons. "On hold" is read **live** from `suppliers.on_hold`,
deliberately not the frozen `supplier.onHold` fact captured once at
invoice arrival (decision 0231's own snapshot, built for automated
rule evaluation, not for a reviewer asking about today) — a hold
placed after capture would be invisible under the frozen fact, and a
lifted hold would keep flagging a resolved invoice. Gated
`AP.FraudReview`, scoped on the invoice's own org unit, the identical
rule decision 0420's duplicates route already established — the only
one available here, since an unmatched invoice has no `supplier_id`
and so cannot use Supplier Performance's own supplier-org scoping.
Fraud Prevention now shows two real cards, not one. Full local test
suites all clean: `vf-app` 2110 → 2126, `vf-ui` browser 818 → 828
(both worker and browser-known-rejection counts otherwise unchanged),
`vf-licence` 320 (migration `0134`, no new test file). `eslint .`
clean across all three packages. See decision 0422's own doc for the
full reasoning, and `docs/PROGRESS.md` for the durable record.

**Decision 0421 (Supplier Performance, the remaining six metrics) is
pushed and deployed, confirmed directly.** `origin/main` fetched
directly reads `bb382fd`, matching this session's own commit exactly;
the operator confirmed with "deployed and pushed." Asked directly to
"build out all of the supplier performance metrics." Investigated
first, the same discipline every decision in this arc follows: the
design document, read fresh, now lists eight key metrics for this
screen, not the seven decision 0416 recorded — the extra one, "Active
supplier count, by status," turned out to already exist elsewhere
(`/api/suppliers/status-counts`, decision 0378), just never wired into
this tab. Built four genuinely new routes (average cycle time,
exception rate + type mix, PO variance, payment terms held vs.
negotiated with an on-time rate), each reusing an honesty pattern an
earlier decision already established rather than inventing a new one
— decision 0418's "payment-eligible = readiness to pay," decision
0419's "recompute PO facts directly, never trust the ephemeral ones,"
decision 0021's own persisted validation verdict. Six of the screen's
eight metrics are now real; early-payment/discount capture stays
parked exactly as decision 0420 left it, and hold history is newly
found blocked for a different, permanent reason — no audit/history
table exists anywhere in this codebase for any supplier field, only
current state. Full local test suites all clean: `vf-app` 2048 → 2110,
`vf-ui` browser 790 → 818 (both worker and browser-known-rejection
counts otherwise unchanged), `vf-licence` 320 (migration `0133`, no
new test file). `eslint .` clean across all three packages. See
decision 0421's own doc for the full reasoning, and `docs/PROGRESS.md`
for the durable record.

**Decision 0420 (potential duplicate invoices, Fraud Prevention's
first real metric) is pushed and deployed, confirmed directly.**
`origin/main` fetched directly reads `1ebb957`, matching this
session's own commit exactly; the operator's own report — "deployed
and pushed. I can see the potential duplicate in the UI under Fraud
Prevention" — confirms the live screen itself, not just the served
code. Recommending early-payment/discount eligibility as the
next slice, investigated it first and found it genuinely blocked — no
structured discount-rate/window field anywhere, on the invoice
(`BT-20`, free text) or the supplier record (`suppliers.payment_terms`,
also free text). Reported directly rather than built around; the
operator's own instinct (terms belong on the supplier record, not the
invoice) matches this codebase's own existing structure but does not
by itself unblock the metric, since that field is still free text —
**parked at the operator's own direction, "it needs more thought."**
Moved to Fraud Prevention instead: the design's own first bullet under
Fraud & Risk Detection is explicit this is not new work — "VibeFinance
already computes this: the Dashboard's possible_duplicates card reads
a real duplicate_confidence column today: this screen is a fuller,
filterable view of data already captured, not a new detection
system." New route (`GET /fraud/duplicates`,
`workers/vf-app/src/fraud-duplicates-route.ts`, gated on
`AP.FraudReview` — its first real consumer, reserved since decision
0417): reads the same `duplicate_confidence` column and the same
`>= 0.5` threshold the Dashboard's own card already uses, so the two
screens never disagree. **A table of flagged invoices, not matched
pairs** — which other invoice a given one was scored against is never
itself persisted, only the resulting scalar confidence, so the route
honestly answers "which invoices look like duplicates" rather than
"invoice A duplicates invoice B." Supplier name falls back to the
document's own printed name (`BT-27`) the same way `dashboard-route.ts`
and `documents-route.ts` already do. New screen
(`fraud-duplicates.js`, a plain data table — `.tablewrap`/`table`, the
same shape `purchase-orders.js` and `documents.js` already build,
since the design's own suggested visualization here is literally a
sorted table, not a chart). Fraud Prevention is now the fourth of AP
Analytics' five tabs to be real; only Executive IQ remains a
placeholder. **Checked the proxy allow-list immediately again**:
`/fraud/duplicates` matched no existing wildcard, so it got a real new
entry alongside the route itself. Tests: 16 new in
`workers/vf-app/test/fraud-duplicates.test.ts` (permission gate
including "AP.Analysis alone is not enough," reads-the-stored-score
behaviour, supplier-name fallback, scoping), 6 new in
`workers/vf-ui/test-browser/fraud-duplicates.test.ts`, 2 new in
`workers/vf-ui/test-browser/ap-analytics.test.ts` (the real card
renders; its own load failure shows the real error). Full suites:
vf-app 2048/2048 (2032 + 16 new), vf-licence 320/320 (migration-only;
full suite re-run clean), vf-ui 74 Worker + 790 browser (782 + 8 net
new), known pre-existing unhandled-rejection count unchanged (160).
`eslint .` clean across `vf-app`, `vf-ui`, and `vf-licence`. Full
detail in
`docs/decisions/0420-potential-duplicate-invoices-fraud-preventions-first-real-metric.md`.
**Five of Fraud & Risk Detection's own six metrics stay unbuilt** —
see that decision's own "What is not built."

**Decision 0419 (spend under management, Financial Performance's
second real metric) is pushed and deployed, confirmed directly.**
`origin/main` fetched directly reads `28aaf9c`, matching this
session's own commit exactly; the operator's own report — "pushed and
deployed" — confirms it. With decision 0418 confirmed live, asked directly which of
the remaining vertical slices to build next — another Liabilities &
Accruals metric, Fraud Prevention, Executive IQ, or Supplier
Performance's own other six metrics — the operator chose "Spend under
management (Recommended)": no new scoping concept, needing only a
first look at how PO matching's own fields identify a matched invoice.
New route (`GET /spend/under-management`,
`workers/vf-app/src/spend-under-management-route.ts`, gated on
`AP.Analysis` like the rest of the tab): "with PO" means the invoice's
own BT-13 resolves to a real `purchase_orders` row — deliberately not
`po.matched`, which is a price/quantity-tolerance verdict rather than
a procurement-governance one — with an order named but never stored
here correctly not counted, the same "nothing to check against yet"
reasoning `po-matching.ts` already gives for a different question.
Though the design's own catalog lists this report's *primary* screen
as the not-yet-built Executive IQ (Multi-Enterprise CFO View), the
design is explicit that such cross-listing is deliberate — this was
built on Screen 4's own listing instead, the same "one real vertical
slice" discipline every Financial Performance metric has followed.
**Never summed across currencies**, the same discipline every
Financial Performance metric so far has kept. New screen
(`spend-under-management.js`, built straight as
`load()`/`renderCard()`), reusing `charts.js`'s own single-proportion
`donut()` — previously exported but unused — since the design's own
suggested visualization here ("Stat tile, % of total spend") is a
genuinely different shape from Accruals' own "stat tile + table."
Financial Performance now shows **two real cards**, not one;
`ap-analytics.js`'s own `tabContent()` loads both and the two fail
independently, proven directly. **Checked the proxy allow-list
immediately again**: `/spend/under-management` matched no existing
wildcard, so it got a real new entry alongside the route itself.
Tests: 16 new in `workers/vf-app/test/spend-under-management.test.ts`
(permission gate, what-counts-as-with-PO including the
never-arrived-order exclusion, never-summed-across-currencies,
scoping), 8 new in
`workers/vf-ui/test-browser/spend-under-management.test.ts`, 2 new in
`workers/vf-ui/test-browser/ap-analytics.test.ts` (both real cards
render; the two fail independently). Full suites: vf-app 2032/2032
(2016 + 16 new), vf-licence 320/320 (migration-only; full suite
re-run clean), vf-ui 74 Worker + 782 browser (772 + 10 net new), known
pre-existing unhandled-rejection count unchanged (160). `eslint .`
clean across `vf-app`, `vf-ui`, and `vf-licence`. Full detail in
`docs/decisions/0419-spend-under-management-with-po-vs-total-spend.md`.
**Four of Liabilities & Accruals' own six metrics stay unbuilt** — see
that decision's own "What is not built."

**Decision 0418 (the accruals report, Financial Performance's first
real metric) is pushed and deployed, confirmed directly.**
`origin/main` fetched directly reads `ea47035`, matching this session's
own commit exactly; the operator's own report — "deployed and pushed -
I see the accruals now" — confirms the live screen itself, not just
the served code. With decision 0417 confirmed live, asked directly which of
the three remaining vertical slices to build next — Financial
Performance, Fraud Prevention, Executive IQ, or Supplier Performance's
own other six metrics instead — the operator chose Financial
Performance, the recommended option: no new scoping concept, and the
tab it lands in is already reachable by anyone who reaches Operational
Performance. The design's own first bullet under Liabilities &
Accruals' six key metrics — "Accruals report: invoices received but
not yet at the payment-eligible stage" — because it needed no
payment-execution data this codebase does not capture, unlike three of
the other five (payment history, payment terms held vs. actual, and
the DPO trend they feed). New route (`GET /accruals`,
`workers/vf-app/src/accruals-route.ts`, gated on `AP.Analysis` like
the rest of the tab): an invoice counts as accrued while its process
instance is still in flight and **not yet at its own process's final
stage** — computed per process (`MAX(sequence)`), never assumed from
`ap-live`'s own 7-stage shape, proven directly with a 2-stage test
process whose own "final" stage is 2, not 7. **Never summed across
currencies**, the same discipline decision 0416 established, but
**broken out by stage in process order rather than ranked by size** —
a liability reads as the money's own path through the process, not
biggest-first — and **always shows its own currency total even in the
ordinary single-currency case**, a real difference from Supplier
Performance's own bare currency label: the accrued total here is the
report's own headline figure, not merely a disambiguation. New screen
(`accruals.js`, built straight as `load()`/`renderCard()` — never a
standalone screen with its own `open()`, unlike Workload and Supplier
Performance before 0417 folded them in), wired into AP Analytics'
Financial Performance tab alongside the two other real tabs.
**Checked the proxy allow-list immediately this time, not after a live
report**: `/accruals` matched no existing wildcard, so it got a real
new entry alongside the route itself, proven reachable by a
regression test in the same change — this file's own comments already
name the same recurring gap several times over (0415's own case among
them); this is one caught and fixed before shipping rather than
after a real request failed on it.
Tests: 18 new in `workers/vf-app/test/accruals.test.ts` (permission
gate, what-counts-as-an-accrual including the per-process final-stage
computation and the completed-instance exclusion, never-summed-across-
currencies, stage ordering proven against a deliberately
size-inverted fixture, scoping), 7 new in
`workers/vf-ui/test-browser/accruals.test.ts`. **Two existing
`ap-analytics.test.ts` tests needed real changes, not just a re-run**:
the one test asserting Financial Performance said "not built yet" no
longer holds, split into a real wiring test plus the still-accurate
"Executive IQ and Fraud Prevention" pairing, and a new test proves
Financial Performance's own load-failure path. Full suites: vf-app
2016/2016 (1998 + 18 new), vf-licence 320/320 (migration-only; full
suite re-run clean), vf-ui 74 Worker + 772 browser (762 + 10 net new),
known pre-existing unhandled-rejection count unchanged (160). `eslint
.` clean across `vf-app`, `vf-ui`, and `vf-licence`. Full detail in
`docs/decisions/0418-accruals-report-excludes-the-payment-eligible-stage.md`.
**Five of Liabilities & Accruals' own six metrics stay unbuilt** — see
that decision's own "What is not built."

**Decision 0417 (AP Analytics, tabbed and permission-gated) is pushed
and deployed, confirmed directly.** `origin/main` fetched directly
reads `299b316`, matching this session's own commit exactly; the
operator's own report — "deployed and pushed" / "I have the new AP
Analytics dash now" — confirms the live screen itself, not just the
served code. Before another Management Dashboard screen was built, the
operator asked to align on
navigation first: "I was hoping to have an AP Analytics link, with
all dashboard available via tabs. Using similar pill-box tabs seen in
the Access screen. The tabs can be for Operational Performance,
Financial Performance, Supplier Performance, Executive IQ, and Fraud
Prevention." Three questions were asked and answered directly: which
design screen each tab name maps to (confirmed one-to-one, Operational
= Workload, Financial = Liabilities & Accruals, Executive IQ = the
CFO view, Fraud Prevention = Fraud & Risk Detection); whether Workload
and Supplier Performance's own standalone nav items move under the new
screen (confirmed — moved, their own nav items removed entirely); and
what to actually build (confirmed — the tab shell now, two tabs real,
three as permission-gated placeholders). A fourth requirement arrived
mid-build as its own explicit instruction: "Access to tabs, and
visibility of tabs controlled through user permissions." Built:
`workload.js` and `supplier-performance.js` lost their own `open()`
and became reusable `load()`/`renderCard()` modules; a new
`ap-analytics.js` reuses `access.js`'s own `.tabbar`/`.tab` pill
component over a `TABS` array, each entry carrying its own permission
— `AP.Analysis` for Operational and Financial, `AP.Supplier` for
Supplier Performance, `AP.Analysis` **and** `holdsEverywhere` for
Executive IQ, and a new, reserved `AP.FraudReview` for Fraud
Prevention. **Each tab's own gate matches its own route's own gate,
never a stricter or looser independent guess** — the design
document's original two-permission-per-screen proposal was
deliberately not followed, because decisions 0415 and 0416 each
already shipped with one permission apiece, and a tab gated more
strictly than its own data would let someone reach that data through
the API the tab itself hid from them. Nav consolidated: `workload` and
`supplierperformance` standalone entries replaced by one `apanalytics`
entry, unlocked by any of the three tab permissions (an OR-gate, the
same shape `roles` already uses). New icon (a rising trend line);
new `ui_strings` migration `0129` (en/de). **`AP.FraudReview`'s own
addition to `permissions.ts` failed `stage-permissions.test.ts`'s
standing closed-set check on the first full `vf-app` run, exactly as
that test exists to catch** — fixed with a new migration
(`migrations/0071_ap_fraud_review_permission.sql`) restating the
invariant, the same way decision 0350's own `Supplier.Maintain`
addition was fixed, not by weakening the check. Tests: 15 new in
`workers/vf-ui/test-browser/ap-analytics.test.ts` (tab visibility per
permission including the `holdsEverywhere` double-gate, default-tab
selection among a filtered set, tab switching with exactly one tab
active at a time, real-tab wiring, load-failure handling);
`workload.test.ts` and `supplier-performance.test.ts` rewritten (not
just re-passed) to call `load()`/`renderCard()` directly since neither
module exports `open()` any more. **`tasks.test.ts`'s and
`rules.test.ts`'s own nav-enumeration tests needed updating for the
second time in three decisions** — `"Performance"` removed, `"AP
Analytics"` inserted where `"Workload"` used to sit (itself never
tested here, a pre-existing gap decision 0416 already documented and
left alone), and `tasks.test.ts`'s own `AP.Supplier`-unlocks-two-items
assertion changed to `["AP Analytics", "Suppliers"]` — a different
label **and** a different order (`NAV_GROUPS` lists AP Analytics'
own heading ahead of Suppliers'), caught by the test itself failing on
the first, order-naive guess rather than reasoned out in advance.
Full suites: vf-app 1998/1998 (permission change only, no new test
file — `org-route.test.ts` derives its expectations from
`PERMISSIONS`/`PERMISSION_DESCRIPTIONS` so it re-passed unchanged),
vf-licence 320/320 (migration-only; full suite and a `--replay-only`
of the whole 129-migration chain both re-run clean), vf-ui 74 Worker +
762 browser (747 + 15 new), known pre-existing unhandled-rejection
count unchanged (160). `eslint .` clean across `vf-app`, `vf-ui`, and
`vf-licence`. Full detail in
`docs/decisions/0417-ap-analytics-tabbed-and-permission-gated.md`.
**Financial Performance, Executive IQ, and Fraud Prevention still have
no route or real screen** — each is a permission-gated placeholder;
see that decision's own "What is not built."

**Decision 0416 (spend by supplier, never summed across currencies)
is pushed and deployed, confirmed directly by the operator's own
report rather than taken on trust alone: "deployed and pushed - I can
see the supplier performance link now" / "Yes, I see spend by
supplier. but only 1 supplier right now" — confirmed as correct,
sparse-seed-data behaviour, not a bug, once the operator reported only
one supplier's invoices were actually seeded.** Asked
directly which of the Management Dashboard's four remaining screens to
build next, the operator chose Supplier Performance over Liabilities &
Accruals, Fraud & Risk Detection, and the Multi-Enterprise CFO View
(left for last — it needs a real multi-org scoping concept this
codebase does not have). The same "one real vertical slice" discipline
0415 established: one of the design's seven key metrics — "Spend by
supplier, with a top-N ranking" — because it needed no new permission
(`AP.Supplier`, already gating the Suppliers screen) and no new scoping
concept. **A real conflict surfaced along the way, not decided
silently**: real invoices here are genuinely multi-currency (GBP, EUR
and USD all in this project's own test fixtures) and nothing in this
codebase converts between currencies, so summing a supplier's spend
blindly would produce a number with no honest meaning the moment that
supplier is billed in more than one currency. Asked directly, the
operator chose to group spend by `(supplier, currency)` and rank each
currency separately, rather than switch the metric to invoice count or
ship the blended sum with the gap merely noted. New route (`GET
/suppliers/spend`, `workers/vf-app/src/supplier-performance-route.ts`,
gated on `AP.Supplier`, scoped exactly the way the Suppliers list
already is), new screen (`supplier-performance.js`), `charts.js`'s
existing `barList` gains an optional `display` field so a row can show
a formatted money figure while still sorting and sizing by the plain
number underneath it — additive, no existing caller affected. Nav
entry, icon, and a new `ui_strings` migration (`0128`, en/de).
**Learned from decision 0415's own mistake, confirmed rather than
assumed this time**: before shipping, checked whether `/suppliers/spend`
needed a new entry in `vf-ui`'s own proxy allow-list — it did not,
already covered by an existing wildcard pattern — and added a
regression test proving that reachable by a real fetch rather than
trusting the pattern match alone. Tests: 14 new in
`workers/vf-app/test/supplier-spend.test.ts` (permission gate,
never-summed-across-currencies with the exact £15,600-equivalent
blended figure asserted absent, scoping, ranking and `limit`), 8 new in
`workers/vf-ui/test-browser/supplier-performance.test.ts` (including
one proving a multi-currency supplier never shows one blended figure
anywhere on the page). **Two pre-existing nav-enumeration tests needed
real updates, not just a re-run** — `tasks.test.ts` and `rules.test.ts`
both hard-code the full nav list precisely to catch a screen appearing
or disappearing, and `AP.Supplier` now unlocks two items together the
same way `Admin.Configure` already does, so `tasks.test.ts`'s own
one-permission-one-label loop needed that case pulled out the same
way. Their own `STRINGS` fixtures were already stale for decision
0415 (neither ever gained `nav.workload`) — a pre-existing gap this
decision did not introduce and left alone, adding only
`nav.supplierperformance` to keep the diff to what 0416 actually
changed. Full suites: vf-app 1998/1998 (1984 + 14 new), vf-licence
320/320 (migration-only; full suite and a `--replay-only` of the whole
128-migration chain both re-run clean), vf-ui 74 Worker + 747 browser
(739 + 8 new), known pre-existing unhandled-rejection count unchanged
(160). `eslint .` clean across `vf-app` and `vf-ui`. Full detail in
`docs/decisions/0416-spend-by-supplier-never-summed-across-currencies.md`.
**Supplier Performance's own other six metrics, and two of the four
remaining Management Dashboard screens, stay unbuilt** — see that
decision's own "What is not built."

**Decision 0415 (`AP.Analysis` reads something at last) is pushed and
deployed, confirmed directly rather than taken on the report alone.**
This session had no push access to `vibefinanceuk/vibefinance` and
committed locally on top of `1eb33d6`, delivered as bundle 0611 for
the operator's own pull/push/deploy sequence — the same path decisions
0391, 0562 and 0566 already used. `origin/main` fetched directly reads
`26f8c86`, matching this session's own commit exactly. `vf-licence`:
`GET /api/ui-strings?locale=en` on the live deployment returns all six
new `workload.*`/`nav.workload` values, which only reads correctly if
migrations `0126`/`0127` and the worker redeploy all landed. `vf-ui`:
the live `workload.js`, fetched directly, is real code — `stackedBarChart`,
`chartLegend`, and the `/api/workload/throughput` fetch — not a stale
build. `vf-app`'s own deploy rests on the operator's report, same as
every prior decision whose API sits behind auth. Asked
mid-edit to a Workload mock-up: *"In order to make this a reality -
what would you start with?"*, answered with one vertical slice —
"Throughput by user, stacked by stage" — because it needed no new
permission (`AP.Analysis`, reserved since before this arc, its own
description literally read "no screen shows it yet") and no new
scoping concept. *"lets go!"* A real conflict surfaced along the way
rather than decided silently: the design's own 7 AP stages against
`tokens.css`'s deliberate 5-chart-colour cap; asked directly, the
operator chose "Merge to 5 buckets." Built as a positional bucketing
formula (`bucketOf()`, `workload-route.ts`) rather than a hardcoded
merge, since `process_stages` is customer-configurable data (0008) —
reproduces the operator's own approved merge for the real 7-stage
`ap-live` process (Matching+Coding, Review+Payment-eligible) while
staying correct for any other customer's own stage count, verified by
test rather than assumed. New route (`GET /workload/throughput`,
gated on `AP.Analysis`, the `/dashboard` GET route's own template),
new screen (`workload.js`), two new chart primitives
(`stackedBarChart`, `chartLegend` in `charts.js`, colour-per-segment
rather than colour-by-position — two users with different subsets of
the same 5 buckets would otherwise draw one bucket in two different
colours), nav entry, icon, and a new `ui_strings` migration (`0127`,
en/de). `AP.Analysis`'s own stale description corrected alongside it.
**A real bug, caught by the test that was checking for something
else**: the first version built each bucket's legend label from a
`Set`'s own insertion order, which was really SQL row order
(`GROUP BY ... s.id`, alphabetical) rather than the stage's own
sequence — read "Coding & Matching" instead of "Matching & Coding"
for the real process. Fixed to sort by sequence explicitly. Tests:
14 new in `workers/vf-app/test/workload.test.ts` (permission gate,
bucketing — including the caught bug and a non-`ap-live` process
proving the bucketing is genuinely positional — scoping, the 7-day
window, ranking and `limit`), 7 new in
`workers/vf-ui/test-browser/workload.test.ts` (including one proving
a segment's colour is read off its own bucket, not its position in
one user's own row). `vitest.browser.config.ts` needed one new alias
line (`/workload.js`) — every screen module is resolved there by
hand, and this one was not yet listed. Full suites: vf-app 1984/1984
(1970 + 14 new), vf-licence 320/320 (migration-only; both the full
suite and a `--replay-only` of the root D1 chain re-run clean),
vf-ui 74 Worker + 739 browser (732 + 7 new), known pre-existing
unhandled-rejection count unchanged (160, re-confirmed against a
clean stashed tree). `eslint .` clean across the whole repo. Full
detail in `docs/decisions/0415-ap-analysis-reads-something-at-last.md`.
**The other four Management Dashboard screens remain design-only** —
see that decision's own "What is not built."

**A second bug in decision 0415, found live after that first deploy
was confirmed, is fixed, pushed, deployed, and confirmed live by
screenshot.** Reported from the screen: *"I see the Workload menu option as my user,
but I cannot click it"* — the cursor still changed to a pointer, and
redeploying `vf-app` on the working theory that it had not picked up
the new route changed nothing. The real cause was never `vf-app`:
`workers/vf-ui/src/index.ts`'s `/api/*` handler is an explicit
allow-list (`PROXIED_TO_INSTANCE`, decision 0102), not a forwarder,
and `/workload/throughput` was never added to it — `vf-ui`'s own proxy
answered `{"error":"not found"}`, 404, before the request ever reached
`vf-app`, and `workload.js`'s own `load()` treats a non-OK response as
a silent failure, which is why the screen looked like it did nothing
at all. This decision's own "What was built" section had claimed *"the
generic `/api/*` proxy needed no change"* — wrong, and now corrected in
place rather than quietly: there is no generic proxy, and this is the
eighth time this file's own allow-list has been missed for a route
that shipped on `vf-app` (it documents seven prior instances by
decision number, from 0212 on). Fixed by adding
`/^\/workload\/throughput$/` to `PROXIED_TO_INSTANCE`; regression
coverage added to `test/index.test.ts`'s own decision-0131 block
(*"the proxy carries every path a screen calls"*), which exists for
exactly this failure mode and would have caught this before the first
deploy had it been added when the route was. `vf-ui` Worker suite:
74/74, count unchanged (an entry added to an existing test). Browser
suite unaffected: 739/739, same 160 known pre-existing unhandled
rejections. `eslint .` clean. Full detail, including why `vf-app`'s
redeploy could never have fixed this, now lives in
`docs/decisions/0415-ap-analysis-reads-something-at-last.md`'s own
new "A second bug, found live" section. **Only `vf-ui` needed
redeploying for this fix** — `vf-app` and `vf-licence` were untouched
by it. After the operator pulled bundle 0613, pushed, and redeployed
`vf-ui`, a screenshot of the live screen showed the whole path working
end to end: a real user's real throughput (Alice McDonald, 2
completed, one Validation segment in its own bucket colour, the
legend dot matching it exactly) — confirmation by rendered output with
real data, not just served code, which is what the first deploy's own
confirmation had to settle for.

**Decision 0414 (claiming does not finish anything) is pushed and
deployed** — `origin/main` is `5d771aa`, confirmed by direct `git
fetch`; the operator confirmed vf-ui deployed. Reported live: *"When I
open a task that it not claimed, the
fields are locked. There is a claim button in the document viewer.
Upon selecting Claim, I am redirected to the task list. However it
would be preferable to open the same viewer in edit mode, now that I
have claimed the document."* `runAction()` (`viewer.js`) closed the
viewer unconditionally after any action the server accepted — right
for Complete, Return, Discard and Return to supplier, which really do
finish the task or move it away, wrong for Claim, which only changes
who holds the lock. Reopening on the same stale `task` object would
not have unlocked the fields either: `canEditAnything` reads
`task.ownership` from whatever object `openViewer()` was handed, and
the claim response itself (`{ taskId, claimedBy, claimedAt }`) carries
no such field. `tasks.js` gains `refreshTask(taskId)` — there is no
single-task endpoint, so it re-fetches the list and hands back the one
row, the same lookup `openTask()` and `act()` already make from
`lastTasks` — for `runAction()` to reopen the viewer on when the claim
succeeds; a task that fell out of the current filtered view (claiming
something in an "available"-only view) has nothing to reopen, so that
falls through to the same close every other action already takes.
Release and every other action are untouched — the report was specific
to Claim, and Release's own desired reopen behaviour was not obviously
the same. Two new tests, fail-first verified (the first pass at the
test itself had a bug — `button.act` matched the list's own hidden
row-level Claim button rather than the viewer's, so it exercised the
wrong code path; caught by the failure landing on the wrong assertion
and fixed by scoping the selector to `#viewer`). Full vf-ui suite
74 Worker + 732 browser (730 + 2 new), known pre-existing
unhandled-rejection count unchanged (160). `eslint` clean. Full detail
in `docs/decisions/0414-claiming-does-not-finish-anything.md`.

**Decision 0413 (a language has no relationship to the org) is pushed
and deployed** — `origin/main` is `674d79b`, confirmed by direct `git
fetch`; the operator confirmed both `vf-app` and `vf-ui` deployed and
reported testing it successfully. Reported live, right after
0412 shipped: *"when the language is changed, the main browser window
resets, and redirects to the Dashboard... rather than keeping focus on
the invoice task that is currently on the screen. Is there a way to
keep the current session window, and update the language rather than
redirecting?"* Self-diagnosed correctly as predating 0412:
`languagePicker()` has reloaded the whole page since decision 0302,
and a reload always lands on the default screen regardless of what was
open. Fixed with exactly decision 0362's own precedent — the org
switcher used to reload for the identical reason and was fixed by
relaunching via `go()` instead. `languagePicker()` now takes an
`onChosen` callback, the same shape `orgPicker` already has;
`relaunchAfterLanguageChange()` (`tasks.js`) refreshes strings, then
either relaunches the current screen or reopens the exact task that
was open — the one real difference from `relaunchAfterOrgChange()`,
which falls back to the default screen instead, because an org-scoped
invoice genuinely does not survive an org switch the way it survives a
language change. `viewer.js` gains `currentTask()` so the reopen has
the task object to work with. Two new tests, fail-first verified;
along the way, closed a real gap in `openList()`'s own shared test
stub table that was surfacing as unhandled-rejection noise. Full vf-ui
suite 74 Worker + 730 browser, known pre-existing error count *down*
(160, was 162) as a side effect of closing that gap. Full detail in
`docs/decisions/0413-a-language-has-no-relationship-to-the-org.md`.

**Decision 0412 (the window with no button of its own) is pushed and
deployed** — `origin/main` is `bdebfa4`, confirmed by direct `git
fetch`; the operator confirmed both `vf-app` and `vf-ui` deployed.
Reported live, verbatim: *"Are you
able to configure the system, so that when a different skin (such as
Day or Night), or a different language (such as English or German) is
selected in the main browser, that your selection is pushed to the
current screen, but also push to the extended Document Image viewer,
when the image viewer is Expanded, to the breakout window?"* The main
window already pushed each choice to itself; the document pop-out
(decision 0384) carries no mood or language button of its own and only
ever read either setting once, at its own boot, so a choice made in
the main window while the pop-out was already open never reached it.
Fixed with `storage`, the one event a same-origin window gets for free
when a *different* window writes to `localStorage` — the same
same-origin-page reasoning decision 0384 already relied on, and the
same platform-primitive-over-a-built-channel choice decision 0384 made
for retargeting the pop-out to a different task. `mood.js` gains
`watchMoodChanges()` (re-applies the mood attribute live — pure CSS
from there, no re-render); `strings.js` gains `watchLocaleChanges()`
(reloads, matching what the language button's own click already does
on the window where somebody clicked it); `document-window.js`'s
`boot()` calls both. Seven new tests across three files, all
fail-first verified; full vf-ui suite 74 Worker + 728 browser, same
known pre-existing 162-error batch, unchanged. Full detail in
`docs/decisions/0412-the-window-with-no-button-of-its-own.md`.

**Decision 0411 (ask the bar, not a second query) is pushed and
deployed** — `origin/main` is `266218e`, confirmed by direct `git
fetch`; the operator confirmed both `vf-app` and `vf-ui` deployed.
Reported live, verbatim: *"please can
you update the exceptions by supplier, and Task Aging Report in the
Dashboard, so that they link to the Document screen with items
shortlisted?"* Both cards now drill through to Documents the same way
`where_things_are` already does: a supplier's own bar opens Documents
filtered to that supplier's own name (the exact expression
`exceptionsBySupplier()` groups by, with the same 30-day/failed-
validation condition — "ask the click," decision 0368); an aging
bucket's own bar opens Documents filtered to that bucket's own
`minDays`/`maxDays`, carried from `ageing()`'s own response rather than
re-decided in a second place. Neither `barChart` nor `barList` had a
click before this — added directly to the bar itself (a wide rectangle,
unlike the donut's thin arc that decision 0264 avoided clicking).
20 new tests (1 server dashboard, 15 server documents, 5 browser, one
of which is this codebase's first SVG `dispatchEvent` click and was
confirmed working before anything else was treated as done), all
fail-first verified. **Also found and fixed in the same commit**:
`documents-route.ts`'s pre-existing `duplicates=1` filter had the same
never-persisted-`facts_json`-key bug decision 0410 already fixed on
the dashboard-count side, but that fix never touched this route — so
clicking "Possible Duplicates" through to Documents still showed
nothing. Raised with the operator directly rather than folded in
silently; they chose to fix it here. Now reads `h.duplicate_confidence`
directly, the same column 0410 pointed the tile's own count at; the
existing test's own fixture, which had been `json_set`-ing the stale
key to pass, now seeds the real column instead. Full `vf-app` suite
1970/1970, full `vf-ui` suite 74 Worker + 721 browser, full
`vf-licence` suite 320/320. Full detail in
`docs/decisions/0411-ask-the-bar-not-a-second-query.md`.

**Decision 0410 (two empty cards, two different answers) is pushed and
deployed** — `origin/main` is `a25b0dc`, confirmed by direct `git
fetch`; the operator confirmed both `vf-app` and `vf-ui` deployed. Reported live: *"My Priority Tasks is
empty, even though I have 3 tasks for my user"* and *"Possible
Duplicates is empty, even though I have emailed in the same invoice
about 4 times."* Both traced against the real remote database before
any code changed. **Possible Duplicates was a real bug**:
`possibleDuplicates()` counted `json_extract(facts_json,
'$."invoice.duplicate_confidence"')`, a key the stored `facts_json`
never actually carries — it's synthesised only in memory, at read
time, by a different route; the score itself lives only in the
`duplicate_confidence` column. Confirmed directly against the
operator's own data (two genuine resubmissions scored `1` in the
column, with no such key in their own stored `facts_json`), then
fixed to read the column. **My Priority Tasks was not a bug** — all
the operator's open tasks were owned by their team, unclaimed by
anyone, and `on_my_clock` has always deliberately excluded a team
queue (decision 0180). What broke was the explanation: decision 0401
renamed the card to "My Priority Tasks" and deleted its own subtitle
in the same change. Put to the operator as a design question — keep
the personal-only scope and restore the explanation, or widen the
card to include the team queue — they chose to restore the
explanation; `dash.myclocksub` reads again, unchanged in the
database the whole time. Four new tests (three server, one browser),
each fail-first verified; full `vf-app` suite 1955/1955 (1952 + 3
new), full `vf-ui` suite 74 Worker + 716 browser (715 + 1 new), full
`vf-licence` suite 320/320. Full detail in
`docs/decisions/0410-two-empty-cards-two-different-answers.md`.

**Decision 0409 (one firing, not one per line) is pushed and
deployed** — `origin/main` is `2815b5d`, confirmed by direct `git
fetch`; the operator confirmed both `vf-app` and `vf-ui` deployed.
Discussing whether the existing Timeline/Chat audit trail (decision
0267) would get long if triggered rules
logged to it — it already does log rule firings, and mostly stays
short: an automatic stage writes nothing, and only a matched rule
shows up, never one merely evaluated. Found one real gap by reading
the code: a line-scoped rule set (decision 0027) evaluates once per
invoice line, and `ruleFiredEvents()` had no grouping and never even
selected the line number back out — so a rule matching on eight of
twelve lines produced eight identical, same-timestamp entries with no
way to tell them apart. Fixed: grouped by `(stage_visit_id, rule_id,
rule_version)` server-side, carrying which lines matched (`lines:
number[]`, empty for an ordinary header-scoped firing) rather than
discarding that; the Timeline shows *"...fired: flagged it (lines 2,
5, 7)"* instead of the same line three times over. Five new tests
(two server, three browser), each fail-first verified; full `vf-app`
suite 1952/1952 (1950 + 2 new), full `vf-ui` suite 74 Worker + 715
browser (712 + 3 new). Full detail in
`docs/decisions/0409-one-firing-not-one-per-line.md`.

**Decision 0408 (the nav that only worked once) is pushed and
deployed** — `origin/main` is `da312fa`, confirmed by direct `git
fetch`; the operator confirmed `vf-ui` deployed. Reported live: "When
in the Validation window, none of the menu links on the left work."
Traced to `go()` (`tasks.js`), the one function behind every nav link everywhere:
`openViewer()` renders its own copy of the nav into `#viewer`, a
sibling of `#shell` that every entry point hides/shows on the way in
and out — but `go()`'s own branches all wrote into `#shell`
unconditionally, with no check for which of the two was actually on
screen. A nav click from inside an open task silently rebuilt the
hidden `#shell`; `#viewer` never moved. Every destination was affected
equally, since every screen module reaches `#shell` the same way —
matching "none... work" exactly, and not a regression from anything
built this week (`go()`/`frame()`/the `#shell`/`#viewer` split all
predate 0405/0406). Decision 0362 had already solved this once, for
the org switcher's own relaunch; this puts the same check where every
nav click actually starts. One new test, fail-first verified against
the reported bug; full `vf-ui` browser suite 712/712 (711 + 1 new).
Full detail in `docs/decisions/0408-the-nav-that-only-worked-once.md`.

**Decision 0407 (the plan that was already written down) is pushed** —
`origin/main` is `da312fa`, confirmed by direct `git fetch`; docs-only,
so there is nothing to deploy. Right after 0406 shipped,
the operator recalled a different, earlier plan: *"we had previously
discussed rendering invoices as a document, rather than HTML, so that
they can be treated like other images."* Not lost conversation — found
written down twice, before decision 0205 ever built anything: decision
0013's addendum (31 August) designed `generated_rendering` as a PDF
from the start; decision 0035 (2 September) built `invoice_documents`
around that shape and left "who generates the PDF" explicitly open.
0205 built HTML instead for a real reason — SaxonJS throws in
`workerd` — but never said on the page that it was deviating from the
original PDF plan. Also found: decision 0206 already built correct
print pagination (`@page`, `break-inside: avoid`) for this HTML,
unused because nothing has ever printed or PDF'd it. Two real paths to
an actual PDF were laid out — Cloudflare Browser Rendering (reuses all
existing rendering, needs a live binding this session can't provision
or test) vs. a pure-JS layout library (fully local-testable, but a
second, separately-maintained layout). Asked directly: **the operator's
call is to stop here for now** — decision 0406's iframe fix stands as
the real answer for the moment. No code changed. Full detail in
`docs/decisions/0407-the-plan-that-was-already-written-down.md`.

**Decision 0406 (a page that is not a picture) is pushed and deployed**
— `origin/main` is `b7e749f`, confirmed by direct `git fetch`; the
operator confirmed `vf-ui` deployed. The very first invoice ever rendered
successfully under decision 0405 immediately surfaced a second gap:
confirmed via the diagnostic that the `generated_rendering` document
genuinely existed in `vf-app-poc`, yet the operator couldn't see it.
`showPreview()` (`viewer.js`) hands every document's content type
straight to `pageViewer()` (decision 0382), which only recognises PDF
and "everything else is an image" — a `generated_rendering`'s
`text/html` content type falls into the image branch, gets handed to
`new Image().src`, and fails silently; the document was never missing,
it was being asked to render as a photograph. Never caught while
0380–0382 were built, because per 0405 nothing had ever rendered
successfully before, so this path had never actually run. Fixed:
`showPreview()` now routes HTML through `documentFrame()`, the same
signed-URL-refresh iframe the XML tab already uses, instead of the
canvas page renderer built for scanned images and PDFs. One new test,
fail-first verified; full `vf-ui` browser suite 711/711 (710 + 1 new).
Full detail in `docs/decisions/0406-a-page-that-is-not-a-picture.md`.

**Decision 0405 (a declaration nobody made) is pushed and deployed** —
`origin/main` is `cab33c1`, confirmed by direct `git fetch`; the
operator reported `vf-app` deployed. The operator's own report: XML submitted by email is
captured fine, but the "physical invoice" rendering feature they
remembered building isn't showing up. Traced the whole capture-to-render
path first — `inbound-email.ts` → `handleCaptureFromSource` →
`retainOriginal` → `renderPeppolDocument` — and found it fully intact,
nothing disconnected. A read-only diagnostic against `vf-app-poc` told
the real story instead: **every invoice this system has ever captured,
today and historically, has had rendering refused** with reason
`not_peppol` — this was never a regression, it never once worked.
`renderPeppolDocument` requires a `CustomizationID` declaring Peppol BIS
Billing 3.0 before it will render anything (the same guard OpenPEPPOL's
own stylesheet applies); every invoice XML this system actually
receives — checked directly against one of today's own test fixtures —
is valid, EN 16931-shaped UBL that simply never declares that formally.
Put to the operator as the product call it is (keep strict and treat it
as a sender/data problem, or render plain UBL too): **loosen it**. The
guard now refuses only a *declared* foreign profile; an *undeclared*
one renders, since the traversal itself never depended on the
declaration anyway. Three existing `source-capture.test.ts` tests had
the old refused-rendering behaviour baked into their expectations
(document counts) rather than their actual point, and were updated
accordingly. Full `vf-app` suite: 1950/1950 (1947 + 3 new). Full detail
in `docs/decisions/0405-a-declaration-nobody-made.md`. **Not built:**
no retroactive rendering of today's four already-refused invoices —
worth a follow-up if wanted.

**Decision 0404 (a header nothing ever styled) is pushed and deployed**
— `origin/main` is `fec65ef`, confirmed by direct `git fetch`; the
operator confirmed `vf-ui` deployed and tested directly, headers now
matching. The operator's own report: the Invoice Lines table's
column headers render bold and white, and should match the Tasks/
Documents header style instead. `.linetable th` had never set its own
`font-weight`, `color`, or `font-size` at all — left unstyled, a `<th>`
is bold by the browser's own default, and its colour inherits from
`.panel`'s `--text-primary`, which is `#e8eef7` (near-white) at Night.
Bold-and-white was never a rule; it was the default nobody overrode,
surfaced by the dark theme. The Tasks/Documents style itself comes from
`#shell th` (`font-weight: 500`, `color: var(--text-secondary)`,
`font-size: var(--text-sm)`) — a second rule, `.tablewrap th`, declares
a *different* weight/colour for the Documents table specifically, but
since both tables render inside `#shell` and an id selector always
outranks a class one, `#shell th` is what has actually been rendering
on both screens all along; `.tablewrap th`'s own values are dead CSS,
noted but deliberately left alone (a different, unreported issue).
`.linetable th` copied `#shell th`'s three properties directly. CSS-only,
no new test (nothing asserts on computed style); full `vf-ui` browser
suite re-run as a regression check, 710/710 unchanged. Full detail in
`docs/decisions/0404-a-header-nothing-ever-styled.md`.

**Decision 0403 (the check the line table never got) is pushed and
deployed** — `origin/main` is `04072df`, confirmed by direct `git fetch`;
`vf-app`, `vf-licence`, and `vf-ui` all redeployed by the operator
directly (`wrangler deploy` output pasted in full), `vf-ui`'s own asset
list naming exactly `/viewer.js` and `/app.css` as what it uploaded. The
operator's UI-styling report ("Header
fields look square, Lines look rounder") turned out to have nothing to
do with CSS: locked fields render as plain text with no box at all
(decision 0114) while editable fields render a real, rounded `<input>`
— so "square vs. round" was flat text beside a genuine box, not two
boxes with different corners. Chasing *why* the Header was locked, on a
Validation-stage document the operator expected to correct, led
somewhere more consequential: a read-only diagnostic against
`process_stages`/`stage_field_visibility`/`field_visibility` came back
empty on every row that would explain a lock, so the Header's fields
are all configured `edit` — the lock is actually decision 0288's own
claim gate (`task.ownership === "mine"`), correctly applied. **The real
finding: that gate was never applied to the line table at all.**
`lineRow()`'s `cell()` in `viewer.js` checked only a field's own
visibility, never `canEditAnything` — so an unclaimed document rendered
its Header correctly read-only and its Lines as real, editable,
saveable-looking inputs, the same failure shape `read-only-stage.test.ts`
already documents once for a different gate (a stage's own read-only
flag, once missed line fields too). Fixed: `cell()` now checks
`canEditAnything` alongside the field's own visibility, matching
`field()`; `.readonly` also gained the app's shared `border-radius` and
a subtle `--surface-0` fill (the operator's own choice among three
options), so a locked field now shares its rounded-corner shape with
every editable one without looking clickable. One new regression test,
fail-first verified; full `vf-ui` browser suite 710/710 (709 on `main`
before this). Full detail in
`docs/decisions/0403-the-check-the-line-table-never-got.md`.

**Decision 0402 (echoing the sentence back) is pushed —** `origin/main`
is `ab68d69`, confirmed by direct `git fetch` rather than taken on the
operator's report alone. Live rule data was already patched directly,
ahead of the code deploy. Investigating the operator's report of a stuck invoice
("Stage Validation, In progress, but no task in Tasks") traced through
`stage_visits`/`stage_visit_steps` ground truth to a genuine, systemic,
pre-existing bug: the rule compiler's own prompt
(`shared/compiler/prompt.ts`) taught the model, via its worked
example, to write the literal phrase `"team": "AP team"` in a compiled
`assign_task` action instead of the real `org_teams.id` (`"ap-team"`)
— and never gave the compiler the real team list to resolve against
at all. `task-route.ts` 404s on the unresolved id, and
`workflow-engine.ts` turns that into a silently swallowed 500 — the
invoice just looks stuck, nothing in the UI says why. A system-wide
query (`loadActiveRuleSet`'s own activation criteria) found **6** of
**8** currently-active `assign_task` rules broken this way. Reviewing
those 6 surfaced two more bugs from the same root cause (no real data
for the compiler to resolve a sentence's reference against): one rule
(`88f6e5ef`) had the identical problem in `route_to`'s `stage` param
(a display name stored instead of the real `process_stages.id`); one
(`94e1d9db`) had a different, bigger problem — the compiler picked the
wrong action type (`assign_org` instead of `assign_task`) for a
sentence with no real org-unit match at all. Fixed: the compiler
prompt now injects real `org_teams`/`process_stages` data and
instructs the model to resolve by meaning, never copy the sentence's
words (`shared/compiler/prompt.ts`/`compile.ts`,
`workers/vf-app/src/compile-route.ts`); all 7 broken live rules
patched directly as new `rule_versions` rows, following this project's
own never-edit-in-place discipline. Full detail, including the
`compiled_by`/`approved_by` values used and the one real inference
made (a permission `94e1d9db`'s sentence never named), in
`docs/decisions/0402-echoing-the-sentence-back.md`. Tests: 1947/1947
`vf-app`, fail-first verified; `eslint`/`check-citations.py` clean.

**Decision 0394 (a column, two arrows, and a marker) is pushed and
deployed, confirmed directly by the operator opening the pop-out
window and seeing the Timeline / Chat column.** An evaluation request
— Timeline / Chat as a pop-out-only right-hand column at 25% width,
next/previous page cycling in the shared control row, and a
session-only rectangle highlight tool as a deliberate first cut of
"annotations" — mocked up with Playwright before anything was built,
then scoped by three explicit choices (25% over 20%; page cycling in
both the pop-out and the embedded card, since the control row is
shared; build a small first cut of annotations now rather than scope
the full feature first). Touches `vf-ui` (`app.css`, `icons.js`,
`page-renderer.js`, `viewer.js`) and `vf-licence` (migration `0123`,
`test/setup.ts`, `test/string-coverage.test.ts`) — no `vf-app` or
`vf-admin` change. Ten new tests, full suites vf-ui 74 Worker + 684
browser, vf-licence 320/320, all passing; `eslint` and
`scripts/check-citations.py` both clean.

**Decision 0395 (a fourth state, and a borrowed accent) is pushed and
now deployed** — confirmed live: a fetch of `/tokens.css` from
`https://app.vibefinance-ai.com` (cache-busted) returns
`--heading-accent: #854f0b;` and `--font-heading: "Big Shoulders
Display", var(--font-sans);`. First of four
decisions building out a look the operator liked from another product
this team built (e-invoicingcompliancecorner.com), narrowed down
through a mockup canvas (built and iterated directly with the
operator, outside this repository) to four pieces, with an explicit
fifth requirement running across all of them — Day and Night both, not
Day alone. Agreed build order: tokens first (this one, purely
additive, nothing visible changes); then the two global pieces — a
bold heading treatment and a rule beneath every card title — together,
since both touch every screen and need the widest regression check;
then the Document tab row restyled as a segmented pill, narrow and
independent; then red/amber/green severity on the validation screen
last, since that one still needs an answer to whether "mismatch" and
"needs review" already exist as separate claims anywhere upstream, or
whether the distinction has to be added there first — not yet
investigated.

**The push/deploy status is worth recording precisely, because it
is the opposite of this morning's gap.** The operator first reported
"deployed and pushed"; a live check of `/tokens.css` came back showing
only the pre-0395 properties; and — given today's earlier history of
that exact check being wrong against this exact site — this session
asked the operator to verify directly rather than trust its own fetch
again. **This time the fetch was right**: the operator confirmed vf-ui
has not actually been deployed yet. Same check, same site, and this
time correct — so the lesson from earlier today ("trust the operator
over this session's own fetch when they disagree") still holds; it was
never "the fetch tool is always wrong here," only that it had been
wrong more than once and so was not to be trusted *unquestioned*
either way. That deploy has since happened, alongside 0396's own —
see the confirmation above, and 0396's own paragraph below.

This decision only adds `--heading-accent` and a
`--bg-danger`/`--text-danger`/`--border-danger` trio to `tokens.css`,
Day and Night, `--heading-accent` reusing `--text-warning`'s own
proven pair rather than the reference site's raw orange (which read
under 3:1 against `--surface-2`). Two new tests in `mood.test.ts`,
watched to fail against the pre-change file first. Full suites: vf-ui
74 Worker + 686 browser (684 pre-existing + 2 new), both passing;
`eslint` and `scripts/check-citations.py` both clean (the citation
checker does not scan `.css` files at all — its own `SUFFIXES` list is
`.ts`/`.js`/`.sql`/`.md`/`.py` — so the record exists for the one
citation in `mood.test.ts`, not for anything inside `tokens.css`
itself). Touches `vf-ui` (`public/tokens.css`,
`test-browser/mood.test.ts`) only.

**Decision 0396 (a title in its own face, and a line beneath it) is
pushed and deployed too** — confirmed live the same way: a fetch of
`/app.css` from `https://app.vibefinance-ai.com` (cache-busted) returns
the exact `.panel > h3, .panel > .cardhead > h3` rule below, word for
word, including the `border-bottom: 1px solid var(--border-strong)`
line. The operator reported "deployed and pushed" together this time,
and both checked out directly — `git fetch` for the push (`origin/main`
at `0cd8c6d`, a docs-only commit on top of 0396's own `7ba798f`,
matching this session's `main` exactly) and the two live fetches above
for the deploy. Unlike this morning, no correction was needed. Second
of the four — the two global pieces
together, as agreed: every panel title now takes a self-hosted Big
Shoulders Display (one weight, 800, shipped the way Carlito was —
decision 0124), uppercase, in `--heading-accent`, at `--text-lg`
rather than `--text-base`; and a `border-bottom: 1px solid
var(--border-strong)` runs beneath every card title's own row.
CSS-only — no JS file touched, since every card already had exactly
one heading element to extend. Scoped deliberately to `.panel >
h3`/`.panel > .cardhead > h3` (not bare `.cardhead`), which keeps it
off every modal dialog's own title (access.js, sources.js,
suppliers.js, processes.js, purchase-orders.js all share `.cardhead`
for those) and off the dashboard's KPI tiles (`card-narrow` nests its
`cardhead` inside `.tilefg`, never a direct child of `.panel`) without
either exclusion needing to be written by name. Five new tests in
`test-browser/typography.test.ts`, watched to fail against the
pre-change files first (4 of 30 failed, exactly the new assertions).
Full suites: vf-ui 74 Worker + 691 browser (686 pre-existing + 5 new),
both passing; `eslint` clean; `scripts/check-citations.py` clean (396
records). Touches `vf-ui` (`public/app.css`, `public/tokens.css`,
`public/fonts/big-shoulders-display-latin-800-normal.woff2`,
`test-browser/typography.test.ts`) only. Not yet visually reviewed
across every screen — the widest-blast-radius piece of the four by
design, and that regression pass has not been done as part of this
change. Next: the Document tab row (piece three, narrow and
independent), then red/amber/green severity (piece four, still needs
the upstream data-model question answered first).

**Decision 0397 (the first live look back at 0396) is pushed and
deployed** — confirmed both directly, not taken on the operator's
report alone: `git fetch` puts `origin/main` at `6613e3d`, matching
this session's own `main` exactly; and two cache-busted fetches of
`/app.css` from `https://app.vibefinance-ai.com` return the new
`.panel > .cardhead { align-items: flex-end; }` and
`.panel > .cardhead > .actionlink { padding: 4px 6px; gap: 3px; }`
rules, the new `.panel > .tilefg > .cardhead > h3` selector reaching
the dashboard's tiles, and confirm the old
`.card-narrow > .cardhead > h3` text is genuinely gone rather than a
stale response happening to omit it. The operator's own first look at
0396 live, not the mock-up, produced two corrections. First: a card
whose action is
`actionLink()`'s icon-above-label shape (decision 0122) — Purchase
Orders' own CSV Template/Load CSV, wrapped in `.statebuttons` and so
outside `.cardhead > .actionlink`'s existing `-6px` pull, decision
0300 — made the whole heading row as tall as the action, with the
title pinned to the top by `flex-start` and a bare gap opening above
the new rule rather than the title sitting on it. Fixed with `.panel >
.cardhead { align-items: flex-end; }` plus a compacted, card-scoped
`.actionlink` override (smaller padding/gap/icon, only inside a card's
own heading — the control row and the pagination arrows keep the base
rule's own size). Second: the Dashboard's own KPI tiles
(`card-narrow`/`card-graphic`) had been deliberately left quiet by
0396's own scoping, reasoning they already had decision 0242's "no
verdict" treatment — but live, next to "On my clock" (which had picked
up 0396's rule on its own, since its `cardhead` sits a level shallower
than the other tiles'), the quiet tiles read as unfinished rather than
intentional. Three ways to resolve it were rendered against the real
stylesheet and shown side by side; **the operator chose directly**:
extend the heading and the rule to every tile. `.panel > .tilefg >
.cardhead > h3`/`.panel > .tilefg > .cardhead` reaches through the one
extra layer `dashboard.js`'s `panel()` helper adds, and the dead
`.card-narrow > .cardhead > h3` override — which never actually
matched, the same `.tilefg` nesting being why — is removed rather than
left contradicting a live rule beside it.

Both fixes were rendered against the real, unmodified stylesheet with
Playwright before being called done (Day and Night both, a card with
no action at all to confirm nothing untouched moved). Nine new tests
in `test-browser/typography.test.ts` (two existing 0396 tests updated
for the selector's new third line), watched to fail first (7 of 35
failed — 5 new assertions plus the two whose selector text had
changed). Full suites: vf-ui 74 Worker + 696 browser (691 pre-existing
+ 5 new), both passing — `dashboard.test.ts`'s own unhandled-rejection
noise confirmed pre-existing, not introduced here. `eslint` clean;
`scripts/check-citations.py` clean (397 records). Touches `vf-ui`
(`public/app.css`, `test-browser/typography.test.ts`) only — no new
token, no `tokens.css` change.

**Decision 0398 (a toggle for the document tabs) is pushed and
deployed** — confirmed both directly, not taken on the operator's
report alone: `git fetch` puts `origin/main` at `6b470c8`, matching
this session's own `main` exactly; two cache-busted fetches of
`/app.css` and `/tokens.css` from `https://app.vibefinance-ai.com`
return the new `.doctabs`/`.doctab`/`.doctab.on`/`.activitycount`
rules word for word — the pill background and `border-radius: 999px`,
the active tab's `box-shadow: var(--tab-active-shadow)`, the badge's
`--bg-accent`/`--text-accent` — and `--tab-active-shadow` itself in
all three places it should be: `0 1px 2px rgba(18, 26, 38, 0.12)` in
the plain `:root` (Day), `none` in both the
`@media (prefers-color-scheme: dark)` block and
`:root[data-mood="night"]`. Third of the four pieces from 0395's own
sequence — the
Document/XML/Timeline & Chat tab row, narrow and independent, as
agreed. Styling only, no JS file touched: `buildDocTabs()` in
`viewer.js` already builds `.doctabs`/`.doctab`/`.doctab.on`/
`.activitycount`, the same four class names before and after, and
`document-window.js`'s own pop-out picks up the same restyle with no
change of its own since it calls the same function. `.doctabs` becomes
a filled, fully rounded pill (`background: var(--surface-1)`,
`border-radius: 999px`, `padding: 3px`, tabs spaced 2px apart rather
than the old 18px margin); `.doctab` drops its underline entirely for
a transparent border ready to be filled; `.doctab.on` fills that
border, lifts onto `--surface-2`, and picks up a new
`--tab-active-shadow` token — a real shadow in Day, `none` in Night,
since the same value that reads as depth on a light surface is either
invisible or a smear on a dark one. `.activitycount`, the timeline's
own unread badge, moves from a neutral grey to `--bg-accent`/
`--text-accent`. Deliberately kept separate from `.tabbar`/`.tab`
(decision 0333, the Access screen's own Organizations/Roles/Teams/
People switcher) — that decision's own case for underline-only was
made for a row of *sections*, and Document/XML/Timeline & Chat are
views of one thing instead, closer to the reference site's own toggle
— with a test now guarding `.tabbar` stays exactly as 0333 left it.
Rendered against the real, unmodified stylesheet with Playwright
before being called done, Day and Night both — the actual markup
`buildDocTabs()` builds, inside `.cardhead` exactly as
`documentPanel()` returns it; this card's own `.cardhead` has no
`<h3>` at all when tabs are showing (the tab row *is* the card's own
head), and 0396/0397's own `align-items: flex-end`/compacted-
`.actionlink` rules already reached it correctly with no further
change needed. Five new tests in `test-browser/typography.test.ts`,
one new test plus a list entry in `test-browser/mood.test.ts`, watched
to fail first (5 of 55 combined failed, exactly the new assertions).
Full suites: vf-ui 74 Worker + 702 browser (696 pre-existing + 6 new),
both passing; `eslint` clean; `scripts/check-citations.py` clean (398
records). Touches `vf-ui` (`public/app.css`, `public/tokens.css`,
`test-browser/typography.test.ts`, `test-browser/mood.test.ts`) only.
Not yet reviewed live — the narrowest of the four pieces by design, so
unlike 0396 it did not get its own dedicated round of "look at it live
across several screens" before this write-up; that first look is
expected the same way it happened for 0396, any correction recorded
the way 0397 was. Next: red/amber/green severity (piece four, still
needs the upstream data-model question answered first — not yet
investigated).

**Decision 0399 (one pill for every tab) is pushed and deployed** —
confirmed both directly, not taken on the operator's report alone:
`git fetch` puts `origin/main` at `f862d37`, matching this session's
own `main` exactly. The live-deploy check needed more care than usual:
a first cache-busted fetch of `/app.css` asked to quote `.tabbar
.tab`'s rule body came back with `font-size`/`cursor`/`display`/
`align-items`/`gap` properties this decision never gave it — a fourth
instance of this exact fetch tool's documented unreliability against
this exact site, this time not a stale read but the summarization
model merging `.tabbar .tab` with the structurally similar, nearby
`.doctab` rule (confirmed by a follow-up fetch that had it name
`.tabbar .tab.on` — which exists nowhere in the file — as the
selector immediately following `.tabbar .tab`'s own closing brace,
plainly `.doctab.on` bleeding into the wrong answer). A third fetch,
asked explicitly to distinguish the two rules and count each one's
declarations separately, gave `.tabbar .tab` exactly five — background,
border, border-radius, padding, color — matching the source file
exactly, with `cursor`/`gap` correctly placed in `.doctab`'s own count
of ten instead. `.tabbar` itself and `.tabbar .tab.active` read
correctly on the very first fetch: `border-radius: 999px`/`background:
var(--surface-1)` on the container, `background: var(--surface-2)`/
`box-shadow: var(--tab-active-shadow)` on the active tab. Lesson
restated once more because it held again: **when this fetch tool's
own answer looks structurally too similar to a neighbouring rule, ask
it to distinguish the two by name and count rather than trusting a
single quote.**
The correction 0398's own write-up half-expected, though not from a
live review this time — asked directly, the same day 0398 shipped:
*"the most recent tab select update to pill box, also... applied to
the tabs in the Access screen. There are tabs for Org Units, Roles,
People and Teams."* This reverses 0333's and 0398's own stated
reasoning for keeping `.tabbar`/`.tab` underline-only and separate
from `.doctabs` — on purpose, per the operator's own direct request,
not an oversight of it; recorded in `SUPERSEDED.md` rather than
quietly edited away. Styling only, no JS touched: `tabBar()` in
`access.js` already builds `.tabbar`/`.tab`/`.tab.active`, the same
three class names before and after. `.tabbar` now takes `.doctabs`'s
own exact shape — filled `--surface-1` background, `border-radius:
999px`, `0.5px` border, `3px` padding; `.tab.active` lifts onto
`--surface-2` and reuses 0398's own `--tab-active-shadow` token rather
than a second one invented for the same job, since the same case for
"real shadow in Day, `none` at Night" applies here exactly as it did
there. Rendered against the real, unmodified stylesheet with
Playwright before being called done, Day and Night both. The old test
guarding `.tabbar` as underline-only (added at 0398) is replaced with
one mirroring the Document-tabs tests — pill background/radius, the
active tab's lift, the same shadow token reused rather than a new one
— watched to fail first (2 of 3 new assertions failed against the
pre-change file; the shadow-token check passed vacuously, since 0398
already shipped that token). Full suites: vf-ui 74 Worker (unchanged)
+ 704 browser (702 pre-existing, net +2 — one old test replaced by
three new ones), both passing; `eslint` clean;
`scripts/check-citations.py` clean (399 records). Touches `vf-ui`
(`public/app.css`, `test-browser/typography.test.ts`) only — no
`tokens.css` change, no JS file, no other Worker.

**Decision 0400 (three tiers for the fourth piece) is pushed and
deployed**, confirmed directly rather than taken on the operator's
report alone. Closes the four-piece
sequence 0395 opened: red, amber, and green on the validation screen's
key fields and exceptions list. Investigated first, per the deferral
0395/0396/0397/0398 all left for it — no upstream distinction between
"mismatch" and "needs review" existed to repurpose — then three scope
questions went to the operator directly: wire the existing PO
three-way-match into the exceptions pipeline (**yes**), bring back the
hidden exceptions panel (**no**, left hidden), and the green state's
own definition (**Claude's judgement**). Backend: a new `po_mismatch`
check in `validation.ts`, gated on a real comparison having happened
(`po.variance_pct !== undefined`) rather than on `po.matched` alone,
since that field alone conflates "no PO referenced" with "PO
referenced but disagrees"; a required `severity` on every failure
("danger" for `po_mismatch` only — checked against a linked purchase
order, not the document's own numbers; "warning" for the original
six); and `confirms`, the deliberate positive twin of
`ValidationFailure`, withheld from `total_missing` on a pass since
presence is not agreement. Frontend: four new mood-invariant severity
tokens, pale in both Day and Night per the operator's own correction
to the first mock-up (*"can you use the paler 'day' colours for the
night scheme also?"*) rather than redarkening the general
warning/success tokens used in roughly fifteen other places; a
three-pass deterministic paint order in `markFields()` so a danger
always wins a field over a warning or an ok, never dependent on which
entry the backend happened to list first. Found and fixed, along the
way, a genuine pre-existing off-by-one in the line-cell marking logic
(`row.children[index + 1]` read the wrong cell — the field *after* the
named one, or the remove button's own cell for the last field — should
have been `index`; present since before this decision, caught only by
screenshotting a real line cell for the first time, which nothing
before this change had done). Visually verified against the real
integrated markup with Playwright — not just the standalone mock-up
already shown and approved — in both Day and Night. 20 new tests
across `vf-app` (15) and `vf-ui` (5), plus two existing `vf-ui` tests
rewritten in place for the new tiers, all fail-first verified. Full
suites: vf-app 1936/1936, vf-licence 320/320, vf-ui 74 Worker + 709
browser, all passing; `eslint` clean; `scripts/check-citations.py`
clean (400 records). Touches `vf-app` (`validation.ts`,
`invoice-facts-route.ts`, `key-fields-route.ts`), `vf-ui`
(`tokens.css`, `app.css`, `viewer.js`), and `vf-licence` (migration
`0124`, `test/setup.ts`, `test/string-coverage.test.ts`) — no
`vf-admin` change. `key-fields-route.ts` wires header-level
`po_mismatch` only, documented at the call site: its `lines.results`
is a pre-existing, unparsed line-facts shape this decision does not
reach into.

**Push and deploy, checked rather than taken on the report alone.**
`origin/main` fetched directly reads `e4da3a2`, matching this
session's own `main` exactly. `vf-licence`: `GET
/api/ui-strings?locale=en` on the live deployment returns
`"check.po_mismatch": "Does not match the purchase order"` — a clean
positive, since that only reads correctly if migration `0124` and the
worker redeploy both landed. `vf-ui`: the live `viewer.js`, fetched
cache-busted, has `row.children[index]` (the off-by-one fix) with zero
occurrences of the old `row.children[index + 1]`; the live
`tokens.css` has all seven new `--severity-*` custom properties with
their exact committed hex values. The live `app.css` could not be
checked either way — same known truncation this exact fetch tool has
against this exact site's larger files, recorded below and in earlier
entries; not treated as a signal. `vf-app`'s own deploy rests on the
operator's report, same as every prior decision whose API sits behind
auth (0383's own entry below is the precedent) — `git push` itself
rested on the same standard before this session could fetch and check
it.

**A small follow-up on top of the pushed commit, in its own commit,
not yet pushed.** A request after 0400 shipped asked for a test
covering "the last matching changes" — the PO three-way-match's own
route-level wiring had unit tests (`validation.test.ts`,
`po-matching.test.ts`) but nothing exercising the real path end to
end: a keyed invoice, a real PO already in storage, read back through
`handleGetInvoice`. Three tests added to
`workers/vf-app/test/key-fields.test.ts` — a genuine mismatch marked
danger, a genuine match confirmed, and no PO referenced at all
correctly skipping the check — fail-first verified (temporarily
removed the PO-merge call in `invoice-facts-route.ts`; 2 of 3 failed
for the right reason, the third passed vacuously as expected), full
`vf-app` suite 1939/1939 with them in place, `eslint` clean. Confirmed
with the operator before committing; the Test count above already
includes them. Test-only — no behaviour change, so it stayed inside
decision 0400's own record rather than taking a new number. Sits on
top of `e4da3a2` as its own commit, delivered the same way as every
other unpushed commit here (bundle, not a direct push — this session
has no push access to `vibefinanceuk/vibefinance`).

**Decision 0401 (six titles, and a subtitle gone) is pushed and
deployed, confirmed directly rather than taken on the report alone.**
A direct wording request: six Dashboard
card titles reworded ("Waiting for me" → "My Tasks by Stage", "Where
things are" → "All Open Tasks by Stage", "How long they have waited"
→ "Task Aging Report", "On my clock" → "My Priority Tasks", "Suppliers
awaiting the ERP" → "Supplier Setup Required", "Done" → "Tasks
Completed This Week"), and "On my clock"'s own subtitle ("Assigned to
me or claimed by me — not a team queue") removed outright, not
reworded. The six titles are `ui_strings` values updated in place
(migration `0125`, English and German both, the same UPDATE-in-place
pattern decision 0307/`0090` used) — their keys are untouched, so
nothing else reading them needs to change. The subtitle's own
`dashboard.js` line is deleted outright; its `ui_strings` row stays
seeded (migrations here never delete a row) and comes out of
`string-coverage.test.ts`'s used-keys list instead. `dashboard.test.ts`
updated at roughly twenty call sites to the new wording, with two
verbatim historical quotes deliberately left unchanged (decision
0363's own "the Waiting for me card..." report, and the "across 4
stages" report) since rewriting a direct quote to the new name would
misquote what was actually said at the time; "Done" needed care rather
than a blind replace, since it also appears inside the unrelated "Done
arranging" string. Full suites: vf-licence 320/320, vf-ui 74 Worker +
709 browser (same counts — a rename, not an added or removed test),
`eslint` clean, `scripts/check-citations.py` clean (401 records).
Touches `vf-ui` (`public/dashboard.js`,
`test-browser/dashboard.test.ts`) and `vf-licence` (migration `0125`,
`test/setup.ts`, `test/string-coverage.test.ts`) only — `vf-app` and
`vf-admin` need no redeploy for this one.

**Push and deploy, checked rather than taken on the report alone.**
`origin/main` fetched directly reads `86ed836`, matching this
session's own `main` exactly. `vf-ui`: the live `dashboard.js`, fetched
cache-busted, has no `dash.myclocksub` reference left — the subtitle
line is gone from the served file, not just the source. `vf-licence`:
`GET /api/ui-strings?locale=en` on the live deployment returns all six
new values (`dash.waiting_for_me` → "My Tasks by Stage",
`dash.where_things_are` → "All Open Tasks by Stage", `dash.ageing` →
"Task Aging Report", `dash.on_my_clock` → "My Priority Tasks",
`dash.suppliers_awaiting_erp` → "Supplier Setup Required", `dash.done`
→ "Tasks Completed This Week") — a clean positive, since that only
reads correctly if migration `0125` and the worker redeploy both
landed. The operator's first "deployed and pushed" report showed
`git push`, `vf-ui deploy`, and `vf-licence deploy` but no
`apply_migrations.py` step; this session's own `/api/ui-strings` check
came back with the old titles still live, so the gap was flagged
rather than assumed covered. The operator then ran the migration and
reported it; this session's own re-check, not the report, is what
confirmed it.

**A real gap in this session's own verification, worth recording
plainly.** `origin/main` fetched directly read the right commit at
every step, confirming the push each time — that part of the usual
"check, don't just trust the report" discipline held up. But this
session then fetched `viewer.js`/`page-renderer.js`/`app.css` from the
live site *repeatedly*, each time with a freshly generated,
never-before-used cache-busting query string, and every one of those
fetches reported the old, pre-0394 content — through two full
`wrangler deploy` runs, a cleared `.wrangler` cache, and a fresh
Cloudflare Worker Version each time (confirmed via `wrangler
deployments list`, each new version at 100% traffic). The operator was
asked to redeploy twice and consider a cache purge on the strength of
those fetches. **The deploy was correct the whole time.** The operator
opened the actual pop-out window in their own browser and the Timeline
/ Chat column was there. Re-fetching the exact same URL immediately
after that confirmation *still* returned the old content to this
session's own fetch tool — so the false negative was not fixed by the
operator's redeploys, because there was never anything for a redeploy
to fix. The likely cause is caching somewhere between this session and
the live site (this environment's outbound HTTPS runs through a
pre-configured proxy) that does not key on the query string the way
earlier decisions in this project assumed it did — decision 0384's own
handover notes a *15-minute* stale read that a cache-busted refetch
fixed; this one did not clear even after several distinct cache-busted
attempts spread over multiple minutes, which is a different and worse
failure mode than that earlier one. **Lesson for next time: when a
fetch-based deploy check disagrees with the operator directly looking
at the page, trust the operator** — do not ask for a second redeploy
or a cache purge on the strength of this session's own fetch alone
without saying plainly that the fetch tool itself may be the thing
that is wrong.

`vf-licence`'s migrations `0122` and `0123` have since been applied to
the remote by the operator, directly — `python3
migrations/apply_migrations.py --remote --migrations-dir
workers/vf-licence/migrations --database vf-licence-poc`, both
migrations landing with checksums and no errors (see the correction
below the decision-0393 paragraph: this session had first wrongly
reported no such process existed).

**A third instance of the same false negative, same session, same
endpoint — recorded rather than acted on again.** After the operator
ran the migration, this session checked `GET
/api/ui-strings?locale=en` on the live deployment and got a
part-right, part-wrong-looking result: `viewer.previouspage` and
`viewer.nextpage` showed the new wording, but `viewer.openinwindow`
still showed the old "Open in a separate window" and `viewer.highlight`
did not appear at all — reproduced identically across two independent,
freshly cache-busted fetches. Given the gap already documented above
(this exact fetch, against this exact site, giving a confident wrong
answer more than once today), this session declined to report it as a
confirmed bug and instead asked the operator to check two things
directly in their own browser rather than trust the fetch again: the
pop-out placeholder text, and the Highlight button's tooltip. **Both
came back correct** — the placeholder reads "Document open in a
separate window" (`0122`) and the Highlight button's hover text reads
"Highlight", not the raw key (`0123`). So `0122` and `0123` are both
fully live, and this session's own `/api/ui-strings` check was wrong a
third time, on partial data this time rather than a flat stale read —
worth noting as a *different* wrong shape from the first two instances
(entirely-stale content, twice, versus a plausible-looking mix of old
and new this time), which argues against a single simple explanation
like a slow-to-invalidate cache and for treating this session's fetch
tool against `app.vibefinance-ai.com` as unreliable in general, not
just slow. Restating the lesson already recorded above because it held
again: **when this session's own fetch disagrees with what the
operator sees directly, the operator is right.**

**Decision 0393 (filling the row, and a number to ring) is pushed and
deployed, with one part still outstanding**: every `vf-ui` change
(`app.css`, `viewer.js`) is confirmed live — the wording change is
data, not code, and needs the `vf-licence-poc` remote D1 migrated
separately from a `wrangler deploy`; that has not happened yet (see
"Where things stand" and the paragraph below). Everything else is
deployed and confirmed. Decision 0392 (more room
in every direction) was reported pushed and deployed, and checked
rather than taken on that report alone: `origin/main` fetched directly
reads `7d9a63b`, matching this session's own `main` exactly; the live
`app.css`, fetched cache-busted, has `#viewer .columns.docpoppedout`'s
`grid-template-areas` with `"parties parties header"`, `.vcanvas.zoomedin
{ max-width: none; }`, `.vcanvasholder.pannable { cursor: grab; }`, and,
inside the narrow `@media (max-width: 1100px)` block, the single-column
reset for `#viewer .columns.docpoppedout` — all exactly as built; the
live `viewer.js`, fetched cache-busted, has `setDocPoppedOut` toggling
`docpoppedout` via `classList.toggle`, and `documentPanel`'s second
`onPoppedOutChange` parameter called after toggling
`normalBody.hidden`/`placeholderBody.hidden`; the live
`page-renderer.js`, fetched cache-busted, has the `zoomedIn` toggle on
`.zoomedin`/`.pannable` and the `pointerdown`/`pointermove`/`pointerup`
drag handlers with `setPointerCapture`. Decision 0391 (the
Document card stops borrowing space) was reported pushed and
deployed, and checked rather than taken on that report alone:
`origin/main` fetched directly reads `bb818bb`, matching this
session's own `main` exactly; the live `app.css`, fetched cache-busted,
has `#viewer .columns`'s `position: relative`, `.c-document { ...
position: absolute; inset: 0; }`, `.c-document .vpreview { height:
100%; min-height: 0; }`, and, inside the narrow `@media (max-width:
1100px)` block, `.c-document { position: static; }` — all exactly as
built. Decision 0390 (three
fifths, two fifths, and a freed rail) was reported pushed and
deployed, and checked rather than taken on that report alone:
`origin/main` fetched directly reads `a9af7bb`, matching this
session's own `main` exactly; the live `app.css`, fetched cache-busted,
has `#viewer .columns`'s `grid-template-columns: minmax(0, 3fr)
minmax(0, 2fr)`, `#viewer .vrail { display: none; }`, and
`.c-document .vpreview { height: 100%; }` exactly as built. Decision
0389 (the country stays a code) was reported pushed and deployed, and
checked rather than taken on that report alone: `origin/main` fetched
directly reads `310b5fd`, matching this session's own `main` exactly;
the live `viewer.js`, fetched cache-busted, has `addressBlock()`
reading `party.country` alone, with no `party.countryName` anywhere in
its `lines` array. Decision 0388 (the
process row and Document card) was reported pushed and deployed, and
checked rather than taken on that report alone: `origin/main` fetched
directly reads `6de0573`, matching this session's own `main` exactly;
the live `app.css`, fetched cache-busted, has `#viewer .columns`'s
`grid-template-areas` exactly as built, `.exceptions { display: none;
}`, and the plain `.columns` rule Sources uses still reads
`align-items: start` with no named areas of its own. Decision 0387
(the Seller/Buyer cards) was reported pushed and deployed, and
checked rather than taken on that report alone: `origin/main` fetched
directly reads `8278aeb`, matching this session's own `main` exactly;
the live `viewer.js`, fetched cache-busted, calls `pair()` for Name
and VAT only and no longer for endpoint/email/phone, and
`addressBlock()` returns a plain `.sfield`; the live `app.css`,
fetched the same way, has `.sellergrid { grid-template-columns:
minmax(0, 1fr); ... }` and no `.sfield.address` rule anywhere. Bundle
0553, the previous one, is confirmed live too — a fresh clone of the
real `origin/main`, made while verifying this one, found it already
at `eadafef`, settling in the operator's favour a question this
handover had left open (whether that one genuinely reached the
remote). Decision 0383 (phase 3 of
the document viewer — a hybrid PDF's embedded XML retained as its own
artifact) touched `vf-app` (migration `0070`, plus
`document-storage.ts`, `document-token.ts`, `document-route.ts`,
`index.ts`, `invoice-facts-route.ts`, `source-capture-route.ts`) and
`vf-ui` (`viewer.js`) — no `vf-licence` or `vf-admin` file changed, so
neither Worker needed redeploying.
**Confirmed against the live origin, not just reported, as far as this
session can reach**: `origin/main` was fetched directly and reads
`4d44b59`, not taken on the operator's word alone. `vf-ui`'s deployed
`/viewer.js` was fetched and does contain `showXmlPreview`'s
`stored.embeddedXmlDocument` check. **`vf-app`'s own deploy and
migration `0070`'s application to `vf-app-poc` could not be checked
the same way from here** — every route that would show the third
document type sits behind session auth, and this session has no D1
credentials to query the remote schema directly — so those two rest on
the operator's own report of "pushed and deployed," the same standard
`git push` itself rested on before this session could fetch and check
it.
**vf-app's count reads 1921, up from 1912** — the third document
type's own tests, plus two real bugs caught before shipping:
`preferredDocumentType`'s `ORDER BY CASE` had no `ELSE`, so the new
type would have silently outranked both existing ones (SQLite sorts
`NULL` first, ascending); and `invoice-facts-route.ts` computed "which
document the preview shows" with its own ad-hoc query that had only
ever agreed with `preferredDocumentType()` by coincidence (0383).
**vf-ui's browser count reads 653, up from 651** — this phase's two
new XML-tab tests. Unhandled rejections read 137, was 135 at 0382 —
the same pre-existing class (0380), not investigated further this
arc.
`vf-admin` and `vf-licence` untouched this arc.

**Decision 0384 (phase 4 — the pop-out window) is built, pushed, and
deployed.** Touches `vf-ui` only (`viewer.js`, plus three new files —
`document-window.html`, `document-window.js`, `app.css` — and
`index.html` reduced to a `<link>` after its inline CSS moved out) and
`vf-licence` (migration `0121`, four new `ui_strings` keys, no Worker
code). `vf-app` and `vf-admin` untouched — confirmed via `git status`
showing zero files changed in `vf-app`, not assumed from the file list
alone, and its full 1921-test suite was rerun anyway.
**Confirmed against the live origin, not just reported, as far as this
session can reach**: `origin/main` fetched directly and reads
`abb300e`, matching this session's own `main` exactly. `vf-ui`'s
deployed `document-window.js` was fetched and matches this phase's
file exactly. Its deployed `viewer.js` was fetched too — the first
fetch came back from this session's own 15-minute cache and, read
literally, looked like a stale deploy (no `POPOUT_NAME`, no
`buildDocTabs`); a cache-busted refetch of the same URL found both,
plus `openDocumentWindow`, at the expected place in the file. Worth
naming plainly rather than quietly correcting: the first read was
wrong, not the deploy. **Migration `0121`'s application to the live
`vf-licence-poc` database could not be checked the same way from
here** — this session has no `CLOUDFLARE_API_TOKEN` to query the
remote D1 database directly (`wrangler d1 execute --remote` refuses
without one), and nothing public exposes `ui_strings` — so that rests
on the operator's own report, the same standard `vf-app`'s migration
`0070` rested on at decision 0383.

**There are four Workers now.** `vf-app` per customer, `vf-licence`
shared, `vf-ui` shared — the customer's interface, its own deployment
because binding it to `vf-licence` would mean every UI change
redeploying the component that mints licence tokens for the whole fleet
(0099) — and `vf-admin`, the operator's, behind Cloudflare Access
(0186).

`shared`'s own three known failures: two are time-expired JWT keys in
the licensing token tests, failing on `main` since before any of this
work. The third — `migration/table-classes.test.ts`, "names each one
exactly once" — reports **seven** unclassified tables as of 0402's own
test run, not the six last recorded here: `_supplier_links`,
`dashboard_cards`, `dashboard_cards_new`, `document_comments`,
`invoice_documents_new`, `org_spend_limits`, and `org_teams_new`.
`invoice_documents_new` (migration `0070`, already applied before this
update — not introduced by 0402) was simply missed the last time this
paragraph was written; the other six's own history is unchanged. Worth
a real fix, still not done.

---

## What the system does

**`docs/PROGRESS.md` is the map** — what exists, what does not, and the
reasoning for each. This page does not repeat it.

In one paragraph: an invoice arrives by email, by upload, or as UBL. It
is captured whether or not anything can read it, evaluated against rules
a customer wrote **in plain English**, and routed through a process of
stages where people key, approve and return it. Every visible word comes
from the control plane and every colour from a token, so a wording fix
or a new language is rows rather than a deployment.

**Ten screens**, grouped in the side nav (0346): Dashboard, Tasks and
Documents under Accounts payable; Suppliers under Supplier management;
Access, Sources, Purchase Orders, Rules and Processes under
Configuration — and the viewer that serves every stage. *(This line
read "Seven screens" until decision 0380, from before the Dashboard,
Purchase Orders and Processes existed.)* **Roles was renamed Access and
restructured into tabs this arc** (0333) — Org Units, Roles, People,
Teams, no longer four sections on one long scroll, with Org Units and
Roles themselves hidden from a delegated administrator holding only
`Admin.UserManagement`. Roles itself dates to 0319–0331: read for
anyone holding `Admin.Configure` or a scoped `Admin.UserManagement`,
write (creating and editing a role, assigning and revoking one,
creating a person) for the same permissions, kept deliberately
separate — editing what a role itself grants is instance-wide and
never delegable, where assigning an existing role to a person already
was (0201) and stays so. **Teams are real** (0332): the two routes that
already existed gained the three that did not (list, remove a member,
rename), every one gated, and every team now belongs to exactly one
org (`unit_id NOT NULL`, migration 0064) rather than sitting outside
the scoping every person already has. **A person's own properties are
real too** (0334): cost centre, manager, address, and a derived Budget
Holder flag, plus a genuinely new spend limit distinct from the
existing approval limit. **Creating and editing an org unit is real**
(0335), closing a real, previously-unauthenticated `POST /org/units`
gap along the way. **The org list is a real tree, not a flat sort**
(0336) — a child now sorts immediately beneath its own parent, the
way the screen's own indentation had always implied it should.

**Role allocation and property assignment are two separate pop-outs
again** (0337), each reached by its own icon in the row rather than a
single click on the row itself (0338 moved those icons into their own
columns once stacking them beneath a cell's own text grew every row
too tall) — reported live as *"not very user friendly"* when 0334
first combined them into one. The approval and spend limit currency
fields are a closed dropdown now, not free text (0339), corrected
twice more after building: to the real, researched Peppol BIS Billing
3.0 / ISO 4217 list rather than a stated four-currency guess (0340),
then filtered to the 156 of those 178 codes a company can actually
purchase with — precious metals, bond-market units, and ISO 4217's own
"funds" excluded (0342) — with the field's own width fixed twice more
along the way (0341, 0343, 0344).

**The side nav is grouped under three static headings** (0346):
Accounts payable, Supplier management, Configuration — distinct from
a single, collapsible "Vibe AP" folder decision 0274 built and 0276
reverted; nothing here expands or collapses, and a heading with
nothing unlocked beneath it is never shown. **Sources gained icons on
Rename, Retire, and a repositioned Create action** (0347), and its own
Rename and Retire confirmations are real, in-app pop-outs now rather
than native browser dialogs, which could never be made to look like
part of this app (0348).

**An org switcher** sits in the topbar for the first time: a person
holding a role at more than one org picks which one they are looking
at, and Tasks, Documents, Dashboard, and Suppliers all narrow to it
(0313–0316) — narrowing what is shown, never granting anything a
person could not already reach some other way.

**An invoice bills a company** (decision 0226), matched on its buyer
VAT id or electronic address. **Which department bears the cost is a
line-level question** and is not built — decision 0225 named three
things that were sharing the word *business unit*, and decision 0226
settled the first. The Coding stage, where a line is charged to a cost
centre or GL code, **does not exist**.

**The supplier mirror is built end to end** (decisions 0207–0219): a CSV
loads from the customer's ERP, an arriving invoice matches on the
seller's endpoint or VAT id, a pay site wins where several sites share a
number, and a load re-matches whatever was unmatched. **Nothing reads
the terms, hold, match option or tolerances** — they load, they display,
and no process consults them.

**Both party cards show our own record beside the image** (decisions
0219–0229), with a search on each for choosing by hand.

**And a supplier can be recorded before the ERP has one** (decision
0231). `erp_identifier` is nullable, `supplier.awaitingErp` is a fact a
rule can test, and **the next load adopts that row** and fills the
identifier in — which is decision 0233, and the whole sequence the
operator described. **The trigger now exists** (0350): Supplier
Maintenance is a real, separate workflow, not a stage on the existing
AP process, closing a gap decisions 0231 and 0233 both named and
deliberately left open until there was a real team and stage to write
the routing rule against.

**The Suppliers screen is complete as a piece** (decisions 0230, 0234,
0236, 0237): load a file or record one, click a row to hold, release,
activate, deactivate or edit — with a warning on save that the ERP is
the master and the next load overwrites this. **`supplier.onHold` is
testable and no rule reads it**, which is the same shape. **Real,
permission-based scoping arrived later** (0358): reading the list had
never been unit-scoped at all, and the dashboard's own supplier card
was silently using the wrong permission's visible set. **Search and
real, server-side pagination followed** (0378, mirroring 0376's own
work for Purchase Orders below) — which forced a fix to the status
ring and its click-to-filter, both of which had computed themselves
over the fully-loaded array in the browser and would have silently
gone wrong the moment that array became only one page.

**A UBL invoice is rendered as a document** (decisions 0205, 0206), at
capture and stored beside the original — A4 portrait, using OpenPEPPOL's
own CSS, code lists and labels, with a notice saying it is a rendering
and what of. **We could not run their stylesheet**: it is XSLT 2.0,
browsers do 1.0, and SaxonJS fails on import inside `workerd`.

**Proven on real documents**, not only in tests: a photographed invoice
has been read automatically and reached Payment-eligible with nobody
touching it, and one the model could not read was retained, explained on
screen, and left to be keyed.

---

## Since 15 September (0349–0380)

**Three genuinely separate arcs**, each closing a gap this document
itself used to name as open, plus smaller fixes along the way.
Supplier Maintenance (0350) and Suppliers' own search, pagination, and
permission scoping (0358, 0378) are covered above, in context.

**Process version control, finally wired up** (0349, 0352–0354).
Decisions 0150 and 0160 designed and built the foundation and said
plainly what was missing — "nothing creates a v2." A draft is not new
schema: it is the rows already sitting at `processes.version + 1`,
real the moment the first edit is made, gone entirely if discarded.
Along the way, three more real, previously-unauthenticated or
unreachable write routes were closed, the same class of gap this
project keeps finding rather than a new kind. Two real bugs in the
Rules screen itself, both found live and both the same shape in
opposite directions (0351, 0355): a stage list with no `WHERE
process_id = ?` at all, and a rule list that showed everything rather
than nothing when a process had no stages.

**Purchase orders, built end to end** (0370–0377) — the largest single
piece of work in this window. Line-level matching against a real
Peppol BIS Order Only 3.3 vocabulary, CSV load alongside XML
ingestion, org derivation and real, permission-based access control
matching what Suppliers already had, then search, pagination, and a
full status lifecycle (Active/On-Hold/Closed, with Invoiced
Part/Full derived live rather than stored) mirroring Suppliers' own
mechanisms rather than inventing new ones. **A real SQL bug was found
and fixed by testing, not by inspection**: `GROUP BY status` silently
grouped by the real, underlying column rather than the computed
expression sharing its name, since SQL resolves an unqualified
identifier against a real column before a `SELECT`-list alias —
collapsing rows with genuinely different statuses into one group.

**The Dashboard reshaped, mostly in direct response to live reports**
(0359–0369): the default screen at login, two real width bugs found
one at a time because the first fix didn't look at the sign-in screen
too, the org switcher relaunching whatever is open instead of
reloading to the default, a bar chart for Waiting for Me with two of
its own bugs fixed after shipping, and card layout arrived at only
after two earlier attempts (0364, 0365) each made the same underlying
problem smaller without closing it — a card's own stored order and
the band sorting it into disagreeing — until the bands themselves were
removed entirely (0366).

**One bug, in two files, found only because a test exercised failure
after success**: `loadStatusCounts()`, on both Purchase Orders' and
Suppliers' own status charts (one screen's own version was written by
copying the other's), returned early on a failed fetch without ever
resetting its own counts to `null` — a chart that had once loaded real
data kept showing it, silently stale, after a later, genuine failure.
Fixed in both files the same day it was found.

**The viewer's document frame, and a premise measured before fixing
it** (0380). A review of every past discussion of the viewer found a
comment claiming the preview was "refreshed when somebody returns to
the tab" — nothing did. Measured in Chromium before building that: an
expired link breaks nothing while a frame sits, scrolls, zooms, hides
or the tab changes; it breaks only when the frame *loads again*, and
then shows `vf-app`'s JSON error rather than going blank. So the fix is
the frame's own `load` event, not a timer — a return-to-tab refresh
would have reloaded a working PDF and lost the reader's place. The same
review corrected three stale comments, four missing `SUPERSEDED.md`
rows and one misattributed one, and the screen and test counts above. **Safari and Firefox were not measured.**

**Smaller, on-request fixes**: the Org Units table now shows Parent
Org and Tax Identifier as real columns, both data the edit form
already had and the table simply never showed (0379); the recorded
title "VAT ID" reads "Tax Identifier" everywhere, one string read by
both the table and the form so the two can't drift apart.

**The document viewer's ultimate shape was designed, and its first
phase built** (`docs/design/document-viewer.md`, decision 0381). The
operator's own request — one viewer for images, image PDFs and
structured PDFs, a thumbnail rail, rotate and zoom, and an Expand that
pops the whole document panel (Timeline/Chat included) into its own
window for two-screen use — was parked since decision 0123 and picked
back up straight out of 0380's review. Three decisions came out of that
conversation: build a real client-side page renderer rather than lean on
the browser's own PDF viewer (phase 2, the largest single piece), keep
retaining every page of a multi-page scan rather than reconsidering
whether to, and have the pop-out carry the whole panel, not just the
image. **Phase 1, built now, is backend only**: checking decision 0068's
own claim that the multi-page flow "deletes on finalise" turned up
nothing that deletes anything, anywhere — every page has been sitting in
R2 since decision 0045, unreachable rather than gone, because finalising
never linked a multi-page invoice into `invoice_documents`. Two new
routes (`GET /invoices/:id/pages`, `POST
/invoices/:id/pages/:n/document-url`) and one unauthenticated fetch route
(`GET /document-pages/:token`) now expose what was always there, with
their own signed token shape alongside decision 0073's. Nothing in the
viewer called any of it yet — phase 2 is what calls it.

**Phase 2, the client-side page renderer, built the same day** (0382).
One thumbnail rail, one zoom, one rotate, shared by images and PDFs —
`page-renderer.js` replaces the `<img>`/`<iframe>` split the Document
tab used since decision 0123. The one open question the design
document left — reset rotate/zoom on open, or remember it — was asked
directly and decided: reset, a session convenience rather than data.
pdf.js is vendored locally (`workers/vf-ui/public/vendor/pdfjs/`), not
loaded from a CDN, the same reasoning decision 0124 gave the font.
**Nobody planned this separately, but phase 2 retires decision 0380's
whole problem**: that bug could only happen because an `<iframe>` is a
live connection that can reload with a link gone stale; a canvas is
pixels already drawn, so nothing reloads it and nothing can ask an
expired token again. A real bug was caught by the new test suite's own
completeness check before it ever shipped — `REAL_DEPS` was missing
the `resolvePages` key `pageViewer()` actually calls, watched to fail
and fixed. Phases 3 through 5 are still design only.

## Waiting on you

**Nothing blocks the next piece of work.** Six things worth settling,
none urgent.

### 1. Who creates the `org_users` row — **answered**

**Provisioning does**, for the requester, who becomes the customer's
administrator (0117). `signup_requests` already names them, so there is
no bootstrap account to invent — and approval still gates provisioning,
which the administrator is a consequence of rather than a substitute
for.

Not built, and **its place in the order moved**. Decision 0117 put it
third behind email; decision 0126 made the **Cloudflare API half of
provisioning** the blocker in front of both, because provisioning is
where the `org_users` row is written and provisioning cannot yet create
anything.

### 2. Alerting on failed sign-ins

*"A lockout policy that generates no alert is half a control."* Attempts
are recorded and shown to the person on their next sign-in (ISO 27001
A.8.5), but nobody is **told**.

Waiting on email, which decision 0117 promoted from *"would be nice"* to
the gate on onboarding itself.

### 3. Do the party panels show enough?

Decision 0115 gave the seller and buyer their own panels, and most of
their fields default to `read`. If they look thin, that is configuration
(0114) rather than code — adjustable per customer without a deployment.

### 4. Two actions that sound like the same thing

Found twice on the first day of real use (decisions 0153, 0158).
*"Hold it for review"* wants `assign_task` and the vocabulary offers
`hold_until`, which holds until a **date**. *"Assign to the AP team"*
wants `assign_task` and the model chose `assign_org`, which assigns an
**operating unit** (0111).

Both are the same question: **does the compiler's prompt teach the
difference, or does the vocabulary stop sounding ambiguous?** A prompt
is cheaper and keeps the closed set small, which 0031 argues for.

### 5. Does the sources screen read right?

**Renaming is free** — `name` is display, `id` is the key, and nothing
references the name:

```
UPDATE process_stages SET name = 'Intake' WHERE id = 'received';
UPDATE process_stages SET name = 'AP Review' WHERE id = 'review';
```

**Removing Line Review used to need decision 0150's own versioning,
which now exists** (0349). It has a completed task against it, so
deleting the row directly would still fail on a foreign key or orphan
history — but a draft of the AP process can now genuinely drop it from
a new version's own membership, with existing instances finishing on
whichever version they started, exactly the mechanism decision 0150
designed. Nobody has actually done this yet; the mechanism blocking it
is what's gone.


Decision 0134 removed every success message from it: a retired source
shows *"Retired"*, a deleted one is gone, and the list is the answer.
**If an action now feels like nothing happened**, that judgement was
wrong and the message should come back.

### 6. Should the line comparison move into the panel?

*"Lines total 150.00 · differs by 30.00"* sits under the line table and
was **read as an exception** (0119). It is not: it is live feedback as
somebody types, where the panel reflects a stored verdict.

They are genuinely different, which is why they sit apart. **The
distinction was not obvious to the person looking at it**, which is
worth more than the argument for keeping them separate.

---

### 7. Columns that are empty on every invoice

Extraction reads a description and an amount per line and nothing else,
so `Line no.`, `Unit`, `Item net price`, `Quantity` and `VAT category`
are blank on every real document (decisions 0171, 0172).

**A column that never has a value teaches somebody to ignore columns.**
Either extraction learns to read them — `BT-152` in particular, which
two derived columns depend on — or a field with nothing in it stops
being shown.

### 8. What "how much has been keyed" should count

Decision 0175 removed a status reading *"0/4 fields known"* on every
document, counting four fields chosen when the screen was written.

The idea was right and the implementation was not. **A real version
counts the fields the current stage asks for**, which is a question
about field visibility rather than about a hardcoded list.

### And two data changes, not code ones

**The live Validation rule** reads *"assign a task to the AP team
requiring **AP.Review** permission"* where it should say `AP.Validate`.
The rule engine is doing exactly what the sentence says; **the sentence
needs recompiling** and taking through the activation gate. No deploy.

**And Approval spawns two tasks per invoice** — seventeen open requiring
`AP.Approve` and seventeen requiring `AP.Review`, against the same
stage. That may be parallel approvers by design (0074 describes how
multiple approval works) or a rule firing twice. **Nobody has
established which**, and the two readings have different fixes.

---

## Suggested next pieces

**Phase 3 of the document viewer is built, pushed, and deployed**
(decision 0383 — *"Lets do the order written, so phase 3 next,"* the
operator's own answer when phase 2 closed). The embedded XML in a
structured PDF (Factur-X, ZUGFeRD) is now its own retained artifact,
so those invoices get an XML tab the way a bare-XML invoice already
does, rendered the same way. A real regression was caught before it
shipped: `invoice-facts-route.ts` computed "which document the
preview shows" with its own ad-hoc query rather than calling
`preferredDocumentType()` — the two had only ever agreed by
coincidence, and widening `document_type` to a third value broke it.
Confirmed live where this session could reach: `origin/main` fetched
directly at `4d44b59`, `vf-ui`'s deployed `viewer.js` fetched and
checked for the new logic. `vf-app`'s deploy and migration `0070`
rest on the operator's own report, per the table above.

**Phase 4, the pop-out window carrying the whole document panel, is
built, pushed, and deployed** (decision 0384 — *"Yes please - lets
look at phase 4,"* the operator's own answer when phase 3 was
confirmed live). Expand now navigates to a real page of this app,
`document-window.html`, carrying the same tabs and Timeline/Chat the
embedded card shows, in place of decision 0073's raw
`window.open(signedUrl)` on a blank tab — 0073's signed-URL mechanism
itself is untouched, only the chrome around it changed. A fixed
`window.open` name makes the browser itself refuse a second pop-out;
opening a different task while one is already up retargets that same
window, the operator's own explicit answer (*"there should not be a
situation where the user has multiple pop-out windows open"*) to the
one question the design document had deliberately left open. Required
extracting the app's entire inline CSS out of `index.html` into a new
`app.css`, since a second real page had no other way to share the
same classes. Confirmed live where this session could reach:
`origin/main` fetched directly at `abb300e`; `vf-ui`'s deployed
`document-window.js` and `viewer.js` both fetched and checked for the
new logic (the first `viewer.js` fetch came back from a stale
15-minute tool cache and had to be re-fetched cache-busted to see the
real deployed file). Migration `0121`'s application to the live
`vf-licence-poc` database rests on the operator's own report — this
session has no D1 credentials to query it directly, same as `vf-app`'s
migration `0070` at decision 0383.

**Phase 5 is built, pushed, and deployed** (decision 0385 — the
operator asked directly whether phase 5 was genuinely a no-op or had
something real left in it). Checked rather than assumed: both
behaviours phase 5 was named for really are already gone — no
surviving call site for the old raw-file Expand, no surviving
`<img>`/`<iframe>` split. One real leftover, in the CSS rather than
the JS: `app.css` still carried `.vimage`, styling an `<img>` decision
0382 had already stopped creating; removed, with a comment explaining
why the neighbouring `.vframe` rule (the XML tab's own, still-live
frame) stays. This closes `docs/design/document-viewer.md`'s
five-phase plan in full. Touched `vf-ui` only (`app.css`), no
migration, no other Worker. **Confirmed against the live origin and
the live deployment, not just reported**: `origin/main` fetched
directly and reads `9e77954`, matching this session's own `main`
exactly; `vf-ui`'s deployed `app.css`, fetched cache-busted, no longer
contains the `.vimage` selector — only the explanatory comment
mentions the name.

**Decision 0386 (the pop-out fills the window) is built, pushed, and
deployed.** Reported live from a screenshot after phase 5 shipped: the
pop-out's card sat centred with a 1100px width cap nothing else in
`app.css` has, and no rule stretched it to fill the window's height
either. Both replaced with a flex chain — `body.docwindowbody`/
`#docwindow-root`/`.panel` each `flex: 1`, `.vpreview`'s own height
reset to `auto` inside this page rather than given a second guessed
constant. Measured in a headless Chromium at two window sizes rather
than reasoned about on paper: the panel's own box tracked the viewport
exactly at both (860px and 610px tall against 900px and 650px
viewports, minus this page's own padding). Touches `vf-ui` only
(`app.css`), no migration, no other Worker.
**Confirmed against the live origin and the live deployment**:
`origin/main` fetched directly and reads `3ecfbc5`, matching this
session's own `main` exactly; `vf-ui`'s deployed `app.css`, fetched
cache-busted, no longer contains the `max-width: 1100px; margin: 0
auto` rule and does contain the new `body.docwindowbody { display:
flex; ... }`. One thing noticed and left open rather than fixed here:
the Timeline / Chat tab, once stretched the same way, leaves visible
empty space below its own feed and input box — worth a decision from
the operator, since tightening it touches CSS the embedded card also
uses.

**Decision 0387 (the Seller/Buyer cards give up a column) is built,
pushed, and deployed.** Asked directly for screen real estate:
E-address, E-mail and Phone dropped from both cards; `.sellergrid`'s
two parallel columns (Name/VAT beside Address) became one, vertical,
in the order Name → VAT no → Address. The hedge in "make the card
height smaller if possible" was checked rather than assumed away —
two parallel columns becoming one sequential stack could plausibly
have made the card *taller* once the three removed rows' own height
stopped hiding behind whichever column was already tallest. Measured
in a headless Chromium against a realistic fixture (a long supplier
name, a long country name) before and after the edit rather than
reasoned about on paper: **421px before, 263px after** — the wrapping
two half-width columns were causing cost more height than the extra
stacked rows ever gave back. A second, smaller change landed the same
arc, reported live once the wider card was in front of the operator:
the address itself moved from beneath its own label back to beside
it, superseding decision 0280 (whose reasoning was specific to a
column half the card's own width, which no longer exists once
`.sellergrid` is one full-width column). Touches `vf-ui` only
(`viewer.js`, `app.css`, `test-browser/viewer.test.ts`), no migration,
no other Worker. Three tests changed — one that asserted an email
address rendered (now asserts the opposite), two decision-0280 tests
that read a CSS rule and a DOM class that no longer exist (replaced
with their decision-0387 equivalents) — each watched fail against the
pre-edit code before being trusted. Full suites: vf-ui 74 Worker + 665
browser, both passing; `eslint` clean. **Confirmed against the live
origin and the live deployment, not just reported**: `origin/main`
fetched directly and reads `8278aeb`, matching this session's own
`main` exactly; `vf-ui`'s deployed `viewer.js` and `app.css`, both
fetched cache-busted, carry every change described above and no
`.sfield.address` rule or endpoint/email/phone `pair()` call anywhere.

**Decision 0388 (the process row and Document card join the grid) is
built, pushed, and deployed.** Two asks, each mocked up in a
headless Chromium and sent as a screenshot before being built, and
each approved before the next line of production code changed for it.
First: the process chevrons moved from a full-width panel above
`.columns` into the left column's own grid area, so their width
matches the Seller/Buyer cards by construction. Second: `#viewer
.columns` gained named `grid-template-areas` so the Document card's
own area spans exactly the process+parties+header rows — pixel-
measured, its bottom and the header card's bottom both land at
768.33px — and Lines now runs full width under both columns instead of
being confined to the left one, filled with the same flex chain
decision 0386 built for the pop-out rather than a second guessed
height. The Exceptions card is hidden, the operator's own words,
"without removing the code, just the visibility" — one CSS rule,
`.exceptions { display: none; }`, and deleting it is the entire way
back. **The shared `.columns` class was the real hazard here**:
`sources.js` uses the same class name for an unrelated two-panel
layout (decision 0177), and a bare `.columns` override would have
reached it too, pushing its real content down by four newly-implicit,
empty, gapped rows. Every new rule is scoped under `#viewer` or a
class unique to this screen — checked, not assumed, by rendering both
screens' own use of `.columns` side by side in a synthetic page and
reading `getComputedStyle` back: `#shell .columns` (Sources' own
scope) still reads `grid-template-areas: none; align-items: start`,
untouched. Decision 0281's own nav test slices this stylesheet by
counting closing braces from the first `@media (max-width: 1100px)`
occurrence; every rule this decision would have added ahead of `.nav`
in that same block pushed the test's own target text out of the
window it slices — watched fail, then fixed by giving this decision's
rules a second block of their own placed after the one that test
depends on, not before it. Touches `vf-ui` only (`viewer.js`,
`app.css`), no migration, no other Worker. No test needed changing —
none asserted on `.columns`'s previous plain-stack shape in a way this
decision's own checks (above) didn't already cover by other means.
Full suites: vf-ui 74 Worker + 665 browser, both passing; `eslint`
clean. **Confirmed against the live origin and the live deployment,
not just reported**: `origin/main` fetched directly and reads
`6de0573`, matching this session's own `main` exactly; the live
`app.css`, fetched cache-busted, carries `#viewer .columns`'s named
areas, `.exceptions { display: none; }`, and a still-untouched plain
`.columns` rule for Sources.

**Decision 0389 (the country stays a code, superseding decision 0221
in part) is built, pushed, and deployed.** Asked directly,
GB-expanding-to-"United Kingdom of Great Britain and Northern
Ireland" as the example: "I think in all cases, we can stick with the
short form country code." 0221 chose the expanded Peppol name on
purpose — "say what the image says" — and that reasoning does not
survive a long form the invoice itself never prints either.
`addressBlock()`, the one function both `sellerPanel()` and
`buyerPanel()` call, now reads `party.country` alone rather than
`party.countryName ?? party.country` — one fix reaches both cards, as
asked. Checked rather than assumed: `countryName` is derived from
`country` (`CODE_LISTS.iso3166?.[code]?.en ?? code` in
`invoice-facts-route.ts`), so there is no case where the name is
present and the code is not, and it is left computed and sent but
unread — the same call decision 0387 made for the fields it dropped
from these cards. Touches `vf-ui` only (`viewer.js`,
`test-browser/viewer.test.ts`), no migration, no other Worker. Two
existing fixtures changed from a long country name to `country: "GB"`,
and one new dedicated test stubs an invoice carrying **both**
`country` and `countryName` (the real backend's own shape) and asserts
the rendered cards show the code and not the name — watched fail
against the pre-edit code first. Full suites: vf-ui 74 Worker + 666
browser, both passing (663 unchanged, 2 changed, 1 new); `eslint`
clean. **Confirmed against the live origin and the live deployment,
not just reported**: `origin/main` fetched directly and reads
`310b5fd`, matching this session's own `main` exactly; the live
`viewer.js`, fetched cache-busted, has `addressBlock()` reading
`party.country` alone — no `party.countryName` anywhere in its `lines`
array.

**Decision 0390 (three fifths, two fifths, and a freed rail) is built,
pushed, and deployed.** Asked directly against two mocked-up,
measured options: `#viewer .columns` moved from `2fr 1fr` (Seller,
Buyer and Document each roughly a third) to `3fr 2fr` (Seller/Buyer
share three fifths, Document two fifths) — approved as "I like this
balance." Measuring the Document card *before* touching anything,
`.vpreview` sat at exactly its own `min-height: 320px` floor — a rule
written for the pre-0388 layout (decision 0271), never revisited once
0388 made the card's height a function of the grid; the reason,
checked rather than assumed, is that 0388's own `height: auto`
override sizes to content on a plain block element whose real,
flex-computed height lives one level up, and an empty preview has no
content to size to. Changed to `height: 100%`, confirmed by measuring
`.vpreview`/`.vpagesroot`/`.vmain`/`.vcanvasholder` before and after:
all four now report a real, filled height rather than a fixed 320px
regardless of what the card was actually given. The thumbnail rail is
hidden while docked regardless of page count — `#viewer .vrail {
display: none; }`, the operator's own words, "the document image
thumbnail can be hidden when the card is docked... should the user
wish to view thumbnails then they can Expand" — a second, independent
reason alongside `page-renderer.js`'s own single-page `.hidden` logic,
which is untouched and still governs the pop-out window
(`#docwindow-root`) exactly as before. `.vmain`'s existing `flex: 1`
picks up the freed 92px automatically. Touches `vf-ui` only
(`app.css`), no migration, no other Worker. No test needed changing —
nothing asserted on `.columns`'s column-width value, `.vpreview`'s
computed height, or `.vrail`'s CSS `display`, checked by rerunning the
full suite rather than assumed; decision 0281's own fragile
brace-counting nav test still passes, since these rules landed in the
viewer's own, later `@media` block rather than the shared one it
slices. Full suites: vf-ui 74 Worker + 666 browser, both passing.
**Confirmed against the live origin and the live deployment, not just
reported**: `origin/main` fetched directly and reads `a9af7bb`,
matching this session's own `main` exactly; the live `app.css`,
fetched cache-busted, has `#viewer .columns`'s `grid-template-columns:
minmax(0, 3fr) minmax(0, 2fr)`, `#viewer .vrail { display: none; }`,
and `.c-document .vpreview { height: 100%; }` all exactly as built.

**Decision 0391 (the Document card stops borrowing space, superseding
part of 0390's own reasoning) is built, pushed, and deployed.**
Zooming an invoice grew the Document card itself, pushing large blank
gaps into the process/parties/header column beside it — reproduced
first, not assumed, with a genuinely tall test image, which measured
`.c-process`, `.c-parties` and `.c-header` all inflating together,
not just the Document card. The cause is CSS Grid's own "increase
sizes to accommodate spanning items" step, which runs for `auto`,
`min-content` *and* `max-content` tracks alike — checked by trying
`min-content` explicitly on those rows and watching the exact same
inflation happen anyway. There is no track-sizing keyword that lets a
spanning item's content need more room without its spanned tracks
growing to give it that room. `position: absolute` on `.c-document` is
what actually works — it removes the item from the sizing algorithm
while its resolved `grid-area` still becomes its containing block
(`#viewer .columns` gained `position: relative` for this to anchor
to), so the card is now capped to exactly what process+parties+header
add up to, every time. That surfaced a second, real regression, found
by re-measuring rather than assumed clean: 0390's own `.vpreview {
height: 100%; }` now resolves against a genuinely shorter parent on
some invoices, and the base rule's leftover `min-height: 320px`
(decision 0271) then won, growing the preview past its own card's
bottom, into the Lines panel — fixed with `min-height: 0` for the
docked case. The scrolling this implied, asked for separately mid-
turn ("it may be necessary to add scroll bars... to allow the user to
scroll to a specific part of the zoomed image"), needed no new code:
`.vcanvasholder { overflow: auto; }` has been there since decision
0382, and once the box stopped growing to swallow the overflow, that
rule is what shows the scrollbar — measured directly (`scrollHeight`
exceeds `clientHeight`; setting `scrollTop` actually moves it). The
narrow, single-column screen broke the same way building the wide fix
did — `document` has nothing else in its own row there to size itself
by once taken out of the algorithm, measured collapsing to `0` —
reset with `.c-document { position: static; }` inside that width's
own, pre-existing media query. Touches `vf-ui` only (`app.css`), no
migration, no other Worker. No test needed changing — nothing
asserted on `.c-document`'s `position`, on `.vpreview`'s `min-height`,
or on any pixel height in this chain; the full suite and decision
0281's own fragile nav test were both rerun after every step above,
not assumed clean at the end. Full suites: vf-ui 74 Worker + 666
browser, both passing — including a pre-existing class of 152
unhandled-rejection console errors in the browser suite (none of them
test failures), reproduced identically on a fresh clone of the
pre-0391 commit to confirm this decision did not introduce them.
Touches `vf-ui` only (`app.css`), no migration, no other Worker. **This
session had no push access to `origin/main`** — delivered as bundle
0562 for the operator's own pull/push/deploy sequence, which is how it
reached the remote. **Confirmed against the live origin and the live
deployment, not just reported**: `origin/main` fetched directly and
reads `bb818bb`, matching this session's own `main` exactly; the live
`app.css`, fetched cache-busted, carries every rule described above —
`#viewer .columns`'s `position: relative`, `.c-document`'s `position:
absolute; inset: 0`, `.c-document .vpreview`'s `min-height: 0`
alongside `height: 100%`, and `.c-document { position: static; }`
inside the narrow media query.

**Decision 0392 (more room in every direction) is built, pushed, and
deployed.** Asked directly, in four parts: whether zoom can go
past its own frame; whether the Document card's now-unused row (freed
by 0391) can be reclaimed once popped out, with Seller/Buyer/Header
sharing one row; whether the Lines card can grow into the space that
frees; and whether the pop-out placeholder can shrink to help free it.
The zoom control was never actually stuck — the canvas genuinely
redraws at a higher pixel resolution on every click, measured
1000→1250→1500→2000→3000px across five clicks — only `.vcanvas {
max-width: 100%; }` clamping the *display* width regardless of that,
and most invoices are already wider than their card even unzoomed, so
further clicks bought resolution the screen never showed more of.
Fixed by lifting the clamp only once zoomed in past the default step
(`zoomIndex > DEFAULT_ZOOM_INDEX`, a `.zoomedin` class toggled in
`draw()`), with drag-to-pan added on top via `pointerdown`/
`pointermove`/`pointerup`/`pointercancel` and `setPointerCapture` —
chosen over `window`-level mouse listeners specifically because
`pageViewer()` is called fresh per opened document with no teardown
hook (decision 0382's own design), so a `window` listener pair would
leak one more copy every time a document is opened; pointer capture
self-releases and never touches `window`, guarded with `?.` for jsdom
(decision 0121), which has no such method. For the reclaimed row, two
more complex approaches were mocked up, measured, and rejected first:
an equal-thirds split with the placeholder given its own dedicated
row (saved ~62px from the merge, cost ~50px back for the new row,
netting almost nothing — Lines in one case landed *worse*, 738px vs a
718px baseline), and moving Header's own DOM node into the Parties
container via JavaScript (worked, matched the eventual numbers almost
exactly at 521px vs 520px, but was more code for the same result).
What shipped moves nothing: `.c-header` stays exactly where it has
always lived, and a `docpoppedout` class toggled on `.columns` (by
`viewer.js`, via the same `popoutStateSetter` the placeholder already
uses) changes only `grid-template-areas`, so `parties` spans two of
three column tracks and its own pre-existing internal grid splits
Seller from Buyer automatically. The width ratio — 25%/25%/50% against
30%/30%/40% — was measured both ways before asking: 30/30/40 leaves
Header too narrow for its own natural layout, so it grows *taller*
instead of using the width (350px vs 258px), landing Lines at 613px
against 25/25/50's 520px, the opposite of the point of widening it.
Presented both, and the operator chose 25/25/50 directly. **A CSS
specificity bug caught and fixed before it shipped, not after**:
`#viewer .columns.docpoppedout` (ID + 2 classes) outranks the plain
narrow-screen `#viewer .columns` rule (ID + 1 class) regardless of
which `@media` block either is declared in, so an unscoped wide-mode
`.docpoppedout` rule would have kept winning even inside the existing
narrow `@media (max-width: 1100px)` block — reproduced deliberately
(a mockup run without the reset, showing the narrow columns cramped to
424px) before writing an equally-specific reset inside that same media
query. The placeholder itself shrinks from a box that filled the whole
card to a slim, right-aligned flex row sharing the Process row's own
line, costing no additional row height — the same trick that made the
equal-thirds attempt fail is exactly what this version avoids. A
temporal-dead-zone risk in the original single-expression construction
of `.columns` (`documentPanel()` calls its own `popoutStateSetter`
synchronously, during construction, which would reference `columnsEl`
before it existed if built inside the same expression) was avoided by
building `columnsEl` empty first and `.append()`-ing its children in a
later statement. Verified against the real production code, not
mockups alone — clicking the actual `Expand` button, stubbing
`window.open` the way the real test suite's `fakeWindow()` does — at
both 1400px and 900px viewports and through a full open → reflow →
close cycle, restoring the exact pre-Expand layout on close (process
72px/679px, document 562px/453px, lines at 718px, matching precisely).
The first pass at that last check used a fake `window.open` handle
whose `close()` was a no-op, so `handle.closed` never became `true`
and the real 700ms `watchPopout()` poll never fired — a bug in the
verification script, fixed by making the fake `close()` actually set
`closed = true`, matching a real browser window. Three new tests, each
watched to fail against the pre-fix code first (`git stash` on the
three production files, test edits kept, rerun to confirm clear
assertion failures, `git stash pop`). Touches `vf-ui` only (`app.css`,
`page-renderer.js`, `viewer.js`), no migration, no other Worker. Full
suites: vf-ui 74 Worker + 669 browser (666 pre-existing + 3 new), both
passing — 153 unhandled-rejection console errors (152 pre-existing +
1 new instance of the same known, tolerated "no stub for
/api/documents/inv-1/activity" class, not a regression). **This session
had no push access to `origin/main`** — delivered as bundle 0564 for
the operator's own pull/push/deploy sequence, which is how it reached
the remote. **Confirmed against the live origin and the live
deployment, not just reported**: `origin/main` fetched directly reads
`7d9a63b`, matching this session's own `main` exactly; the live
`app.css`, fetched cache-busted, has `#viewer .columns.docpoppedout`'s
`grid-template-areas` with `"parties parties header"`, `.vcanvas.zoomedin
{ max-width: none; }`, `.vcanvasholder.pannable { cursor: grab; }`, and
the narrow-media-query reset back to a single-column stack, all exactly
as built; the live `viewer.js`, fetched cache-busted, has
`setDocPoppedOut` toggling `docpoppedout` via `classList.toggle`, and
`documentPanel`'s second `onPoppedOutChange` parameter called after
toggling `normalBody.hidden`/`placeholderBody.hidden`; the live
`page-renderer.js`, fetched cache-busted, has the `zoomedIn` toggle on
`.zoomedin`/`.pannable` and the `pointerdown`/`pointermove`/`pointerup`
drag handlers with `setPointerCapture`. The operator's own screenshot of
the deployed UI confirms it visually too: Seller, Buyer, and Invoice
header sharing one row at the built 25/25/50 widths, and the pop-out
placeholder sitting compactly in the Process row's own line rather than
filling a tall card.

**Decision 0393 (filling the row, and a number to ring) is pushed and
deployed, with one part outstanding.** Asked against a screenshot of the
deployed 0392 layout: the placeholder sat visibly shorter than Process
beside it, and Seller/Buyer ended well above Header's own bottom —
both measured real (44px vs Process's 90px; 244px vs Header's 421px),
not assumed from the screenshot alone. Both traced to the identical
shape: `align-items: stretch` (0388) was already stretching the
*outer* grid item to match its row — checked directly, and it was —
but nothing told the *visible panel inside it* to fill that box, since
0392's own override (`height: auto; display: block;` on
`.c-document > .panel:not(.exceptions)`, reasoned at the time as
needing "neither... a height matched to anything else") had turned
off the general rule that would otherwise have done exactly that.
Deleting that override — rather than adding a second, competing one —
let the *existing* `.c-document > .panel:not(.exceptions)` rule (its
own `height: 100%` plus `flex: 1` on non-`.cardhead` children, written
for the docked, three-row case) apply here too. Fixing Document's own
side surfaced a **third instance of the identical bug, found only by
re-measuring after the first fix rather than assumed clean**: with a
realistic placeholder (badge text plus two buttons), the row can now
be *taller* than Process's own natural content, which left Process's
panel short instead — the same gap, moved to the other card. Process's
own panel needed the identical `height: 100%` fix. `.c-parties >
.parties` got the same one-line fix for the Seller/Buyer side — its
own internal grid (decision 0179's own comment: "its panels stretch to
the same row height") then stretches Seller and Buyer to fill it with
no further rule needed. All three are scoped to `.docpoppedout` alone,
and asked for directly for the Seller/Buyer case: "when the document
image is expanded only." Separately, the placeholder's actions changed
from decision 0392's row-format override back to the plain,
unmodified `.actionlink` square — deleted outright, not replaced, so
"Bring to front" and "Show here instead" now look like "Header Fields"
the same way every other cardhead action already does — and its text
moved left and reads "Document open in a separate window" (`en`)
rather than "Open in a separate window", a wording change carried by
`ui_strings` (migration 0122 in `vf-licence`, wired into
`test/setup.ts`'s own migration chain the same as every migration
before it) rather than decided in `viewer.js` or `app.css`. Two more
changes, independent of the layout fix: `addressBlock()` now joins
city and country onto one line ("Felixstowe, GB") rather than each
keeping its own; and Phone — dropped by decision 0387 along with
E-address and E-mail to give the card back a column — is reintroduced
alone, beneath the address, since `s.phone`/`b.phone` never stopped
being fetched onto `stored.supplier`/`stored.buyer`, only stopped
being read. Five new tests, all watched to fail against the pre-fix
code first, plus one existing test (decision 0384's own placeholder
test) corrected for the wording change — narrowed from an exact string
to the substring both wordings share, since checking the exact new
text is the newer test's job and one test asserting both would be
asserting the same fact twice for two different reasons. Touches
`vf-ui` (`app.css`, `viewer.js`) and `vf-licence` (migration 0122 +
`test/setup.ts`) only — no change to `vf-app` or `vf-admin`. Full
suites: vf-ui 74 Worker + 674 browser (669 pre-existing + 5 new);
vf-licence 320/320, both passing. `eslint` clean. **This session had
no push access to `origin/main`** — delivered as bundle 0566 for the
operator's own pull/push/deploy sequence, which is how it reached the
remote. **Confirmed against the live origin and the live deployment,
not just reported — with one genuine gap found, not assumed clean**:
`origin/main` fetched directly reads `0125d52`, matching this
session's own `main` exactly; the live `app.css`, fetched cache-busted,
has `#viewer .columns.docpoppedout .c-process > .panel`'s `height:
100%; box-sizing: border-box;`, no `.vpoppedoutactions .actionlink {`
anywhere, `.vpreview.vpoppedout .vthumb`'s `flex-direction: row;
justify-content: space-between;`, and `.c-parties > .parties`'s
`height: 100%` — all exactly as built; the live `viewer.js`, fetched
cache-busted, has `addressBlock()`'s `cityCountry` join and both
`pair(t("viewer.supplier.phone"), …)` calls. **The wording change did
not reach production with the rest of it** — `GET
/api/ui-strings?locale=en` on the live deployment still answers
`viewer.openinwindow` with the old "Open in a separate window", not
migration 0122's "Document open in a separate window", checked
directly rather than assumed alongside everything else that did land.
The cause, once traced rather than guessed at: `ui_strings` is data in
the `vf-licence-poc` D1 database, not code `wrangler deploy` touches.

**Correction, made after the operator pointed it out directly —
recorded plainly rather than quietly fixed.** This session first ran
`migrations/apply_migrations.py --replay-only` with no further flags,
watched it replay `vf-app-poc`'s own 70-migration chain, and wrongly
concluded from that single, default-argument run that the script "is
wired to a different chain entirely" and that no process for applying
a `vf-licence` migration was documented anywhere. Both were wrong, and
both were readable in the repo the whole time: the script's own
`--migrations-dir` flag exists specifically for this (its own help
text gives `--migrations-dir workers/vf-licence/migrations --database
vf-licence-poc` as the example), and `docs/change-and-promotion-
model.md`'s own "what changed → what deploys" table already lists
`workers/vf-licence/migrations/*.sql` against exactly that same
invocation. Re-run pointed at the right chain
(`--replay-only --migrations-dir workers/vf-licence/migrations
--database vf-licence-poc`), the full 123-migration `vf-licence` chain
replays cleanly with every assertion held, migrations `0122` and
`0123` included. The command the operator needs, for the mode this
session cannot run itself (no Cloudflare credentials):

```
python3 migrations/apply_migrations.py --remote \
  --migrations-dir workers/vf-licence/migrations \
  --database vf-licence-poc
```

How migration `0121`'s own strings ("Bring to front", "Show here
instead") reached the live deployment earlier is now explained by this
same command, not a mystery — the operator most likely already runs
it, or something equivalent, and this session simply hadn't found it
yet when it first asked.

**Built this arc, closing out most of what was named here before:
teams, most of the "user variable" fields, creating and managing an
org, and the org list's own tree ordering.** Reported live in one
request — "a UI for creating Users, allocating user variables,
allocating roles to user, and assigning users to teams. creating and
maintaining teams" — deliberately scoped down to one piece at a time
rather than built all at once (0328 onward), and each piece landed in
turn: teams (0332), the Access screen's own tabs (0333), user
properties (0334), org create/edit (0335), org tree ordering (0336).

**What is still genuinely new schema, not yet built**: a picture (no
image storage exists for anything user-related — the real lift here,
deliberately not started), a forename/surname split (today one `name`
field, and splitting it touches every place a name is already
displayed), and a business title. Cost-centre allocation *for a
person* is built (0334) — the field this note used to name as
missing.

**Rules and Sources as further Access tabs** were discussed and
deliberately scoped out of 0333 — Org Units, Roles, People, and Teams
are the four tabs today; a fifth and sixth would each need their own
scoping decision, not an assumption that they belong alongside the
other four.

**Teams have no org-scoping in the task-queue sense.** `org_teams.unit_id`
(0332) scopes who may *administer* a team's own definition and
membership; task assignment still names a team by id directly, with
nothing narrowing which teams a given screen offers based on the org
a task or document belongs to.

**1. Cost object approval** (decisions 0184, 0195) — **update (0439):
now callable, not yet the active mode.**

A **ledger** exists (Oracle's word; SAP's *controlling area*), legal
entities account in one, and a cost centre hangs beneath it with a
parent, an owner and a limit. `resolveApprovalChain` walks it in
decision 0184's **Limit** mode — decision 0439's own
`approval-hierarchy.ts` is the first thing that calls it, wired to
`assign_task` through a new stage flag (`uses_approval_hierarchy`) and
a new customer-wide setting (`org_approval_config.mode`). Selecting
`cost_object` there activates this path; the operator's own first mode
to build was Employee-Supervisor instead, so that is what
`org_approval_config` defaults to today. **The next piece** is the
screen: nothing yet lets an operator actually change the mode, or set
a cost centre's owner/limit, without direct SQL.

*The original design note:* Cost object approval (decision 0184) — **designed, not built.**
An invoice line finds its approvers from its cost centre, and how many
it needs depends on a hierarchy: *"1, 2 or none or 6."*

**It has a name and two established shapes**, taken from SAP Concur and
Oracle Fusion rather than invented. **Level** walks every rung to the
top; **Limit** stops at the first person whose signing authority covers
the amount; and a step is one or the other, **never both**.

**Parallel across cost centres, serial within one** — which is what
*"serial line-level approval"* meant. Decision 0183's per-line tasks are
the parallel half and already work.

**The hierarchy is one of cost objects, not org units.** Escalation
climbs to a *parent cost object manager*, so a cost object carries a
default approver, a limit, and a parent of its own — which vindicates
decision 0031's separation for a reason it did not anticipate.

`org_authority_limits` is the signing authority, **written by a route
and read by nothing**, and `BT-133` is the line's cost centre. **The
join is missing**: a cost object has no approver, nothing walks a chain,
and completing a task advances nothing.

**The first question to answer** is whether the amount tested is the
line, the cost object's portion, or the invoice total — the sources
disagree, and it decides which approvals a split invoice needs.

**And the configuration screen that goes with it** (decision 0185).
Supervisory approval and cost object approval are **the same algorithm
over different trees**: start somewhere, walk up, stop when a signing
limit covers the amount. A third strategy is then a tree and a starting
fact rather than a rewrite — decision 0031's *"the vocabulary is closed,
and that is the feature"*, applied one level up.

`org_units` is already a tree and `org_users.unit_id` points into it, so
**the people hierarchy exists indirectly**. What no node of it has is a
manager.

**2. Unit-scoped configuration** (decisions 0192, 0196) — **rule sets
are scoped; nothing else is.**

**Update, this arc (0313–0331): roles now have a real UI, not only a
scoped assignment.** The Roles screen — read (0319–0323) and write,
including assignment (0326–0328) — is what closes that gap. **Teams
are scoped too now** (0332): every team belongs to exactly one org
(`unit_id NOT NULL`), with a real UI (0333) reached through the
Access screen's own Teams tab. **Still customer-wide, unchanged**:
settings.

A unit may override a stage's rule set, resolved by one walk in
`unit-config.ts`. A process was the wrong grain: France and Germany want
the same stages and different thresholds, so scoping the process would
duplicate seven stages to change one rule.

**Field visibility too** (decision 0197), per field so that restricting
one field in France cannot silently drop what the group said about every
other — decision 0143's trap, one layer along.

**Roles are scoped too** (decision 0199) — on the *assignment*, so one
*AP Manager* definition is held per org. **But applied in one place**:
fourteen permission checks exist and one is unit-aware, so a person
restricted to France cannot see German documents in the document
manager and can reach one by other routes. **That is not a boundary
yet**, and 0199 says so. **The count is stale as of this update**:
Suppliers (0358) and Purchase Orders (0375) have each since gained
real, permission-based scoping through the same `unitsWherePermitted`/
`scopedToChosenOrg` mechanism — more of the fourteen are unit-aware
now than when this was written, though nobody has re-counted the
full set since.

**And a stage may declare its permission** (decision 0200) — the
vocabulary was already right, since 0010 named permissions after
business activities and the activities are the stages. A rule asking for
something else is refused rather than quietly corrected. **No stage
declares one yet.**

**And delegated administration** (decision 0201): a role is granted in
an org by somebody who administers it, bounded above as well as below —
granting *everywhere* is refused, because it reaches further than the
granter holds.

**A regional manager needed no new mechanism**: a role is a list of
permissions and an assignment carries a unit, so *AP Manager (France)*
is the two together.

**And the org endpoints were ungated for ever**, not only at bootstrap
— decision 0010's reason holds while there is nobody, and stopped
holding the moment one person existed. Now authenticated once anybody
exists.

**And the task list is unit-aware** (decision 0202) — a German
validator is no longer shown French work, which was 0199's largest
recorded gap. **Claiming and completing are too** (decision 0203) — the last place the
boundary was a screen rather than a route. **Twelve of fourteen
permission checks still ignore the unit**, and those two are the ones
that matter most — the same stale count noted above; Suppliers and
Purchase Orders have each since joined the unit-aware side.

**Still customer-wide**: teams, settings.

**And the screen agrees with the route** (decision 0198) — which meant
loading the invoice before the fields, because its unit now decides
which are editable.

**An invoice can place itself** (decision 0204). A source chooses a
fixed org or `<Automatic>`, and `<Automatic>` reads the buyer's
identifiers off the document — decision 0036 added those columns in
September and nothing had ever read them.

**A match names a legal entity and an invoice needs an operating unit**,
so one department beneath it is unambiguous, several means *"the entity,
and no particular one"*, and none needs a department created. All three
are recorded in `org.unplaced`, **which no screen reads.** And
it is not a boundary — everybody sees every invoice.

*The original design note:* Unit-scoped configuration (decision 0192) — **designed, not
built**, and it touches almost everything.

**Two questions, not one.** *Must these units be hosted apart?* Then
they are separate **environments** — per-customer D1 and R2 exist for
isolation and residency (decision 0001). *May they share a database?*
Then this applies.

**The second is the case you have.** Residency splits are transatlantic;
a European group shares a database because it may, not as a compromise.

**And a contradiction worth knowing about**: `environments` has `UNIQUE
(customer_id, kind)`, so one production environment per customer — while
decision 0083 reasoned about *"a customer with EU and US instances"* and
built the sign-in screen an environment picker for it. **The interface
expects a shape the database forbids.** Harmless until a customer is
transatlantic, and recorded rather than lifted.

Four things carry a unit today: a person, an invoice, a source, and
which national rules apply. **Roles, teams, processes, rule sets and
field visibility are customer-wide**, so France and Germany share every
one.

The chosen shape is a nullable `unit_id` where null means *the group's
own* — so nothing migrates — and a resolver that walks up decision
0036's tree.

**The trap is the whole risk**: forgetting the unit does not fail, it
returns the group's answer. `resolveTenant` has a lint rule that makes
the equivalent mistake uncompilable; this has no equivalent, because the
column is nullable by design.

**Permissions have an answer now** (decision 0194): Oracle Fusion scopes
the **role** to a unit and lets a person hold several, so *AP Approver
(France)* and *AP Approver (Germany)* are two rows and a group treasurer
holds both. `org_user_roles` is already `(user_id, role_id)`, so this is
a column on `org_roles` and **no change to `hasPermission`**.

**And decision 0036 landed on Oracle's own model without knowing it** —
Legal Entity and Business Unit, with Oracle's older name for the second
being literally *Operating Unit*. Decision 0194 records what Oracle has
that this does not: a **ledger**, a **division** that can span legal
entities, a **department** separate from a business unit, and a shared
service centre serving several entities, which decision 0036's
invariant forbids.

**3. Measured pagination and annotation** (decision 0206) — **one piece
of work, by the operator's own choice.**

Both need to know where things are inside a rendered document, and both
need **same-origin delivery**: the document URL is minted on `vf-app`'s
origin and the viewer runs on `app.vibefinance-ai.com`, so the iframe is
cross-origin and the parent can read nothing.

**A same-origin iframe, not a shadow root** — that correction is in 0206
and the reason matters: shadow DOM isolates CSS and **not JavaScript**,
and this document is built as a string with an `esc()` on every
supplier-controlled value.

**And annotation here beats annotation on a photograph**, because a
field can carry its Business Term — an annotation anchored to `BT-48`
survives re-rendering, zoom and translation, where a coordinate on an
image does not.

**4. Coding — where a line is charged.** **The largest gap, and the one
the operator's own correction pointed at** (decisions 0225, 0226).

An invoice bills a company; **which department bears the cost is
per-line**, and routinely split — *"a purchase for stationery is booked
across multiple departments, cost centers and GL codes."*

`invoice_lines.cost_centre` has existed since decision 0007 and
`BT-133` since decision 0031. **Nothing assigns one.** A PO would carry
it, and without a PO the Coding stage does — and that stage does not
exist.

**5. A rule that reads the supplier fields.** All of them are now facts
a rule can test — hold (decision 0230), terms, match option and
tolerances (decision 0238) — and **no rule reads any of them.**

**That is deliberate.** The sentences are a customer's: *"if the
supplier is on hold, route this for review"*, *"if the match option is
three-way, visit Matching"*. **What is missing is a customer writing
one**, and the match option in particular still decides nothing — the
stages an invoice visits come from a process definition.

**6. Process configuration, versioned — built** (0349). Real version
control landed as described: `process_stage_versions (process_id,
version, stage_id, sequence)`, leaving all six foreign keys untouched
and making removing a stage "not in this version" rather than a
deletion that orphans history. An invoice finishes on the version it
started; rules still resolve on arrival. A draft is not new schema —
it is the rows already sitting at `processes.version + 1`.

**7. Email sending**, which decision 0125 evaluates. "Email" means three
different things — supplier contacts *out to strangers*, user
notifications *out to colleagues*, and a source which is *inbound* and
not sending at all.

Its order: **the sending mechanism** with the administrator's password
link (which blocks onboarding entirely), then **users**, then
**suppliers**. Sources are as far as they can go without item 1.

Two questions answered: a source's address lives on a **VibeFinance
domain**, and a user's role is a **job title**, so the column is named
`job_title` — a column called `role` beside a roles table is an
invitation to two answers about what somebody may do.

Still open: **which provider**, **where sending lives** (0091 says the
control plane never holds customer content), **whether templates sit in
D1** like `ui_strings`, and **what happens when sending fails**.

**8. BG-4 and BG-7 in the vocabulary.** The seller and buyer field lists
live in the viewer (0115). Recording business-group membership in
`shared`, as `INVOICE_LINE_FIELDS` does for BG-25, is the consistent
thing and a known shortcut until it is done.

**9. BG-23, the VAT breakdown.** Mandatory and **repeating** — one entry
per VAT category and rate, whose tax amounts must sum to BT-110. The
flat facts model cannot hold a repeating group (0112). A design
question, not an omission, and *"one of the most common causes of
validation errors"*.

**10. Despatch Advice (T16) — the two-way matcher is now built, and
this is what's left.** `po.matched`/`po.variance_pct`, and now real
line-level matching too (`po.line_matched` and the two line variance
fields), are computed live rather than declared and left uncomputed
(0370) — the gap this item used to name as blocking the matcher
itself is closed. What remains is exactly the goods receipt, the
missing third leg of three-way matching. BT-132 now exists, which is
what lets matching compare a line to an order line.

**11. Acting on `cbc:CustomizationID` beyond rendering.** Decision 0205
reads it to decide whether a document is Peppol BIS 3.0 and refuses the
rendering otherwise — which is the first thing to use it. **Nothing
routes or validates on it**, so a document from another profile is
processed as though it were this one. **Purchase orders now have their
own, separate ingestion path** (`POST /purchase-orders`, decision 0370)
rather than being detected automatically within `/sources/:id/capture`
itself — a real Order is matched against, but the underlying gap this
item names is still there: the capture pipeline itself still cannot
tell a Peppol Order from an Invoice by its own `cbc:CustomizationID`.

*The original note:* Reading `cbc:CustomizationID`. BT-24 is now read into the facts
(0112), so the discriminator is available; detection still does not use
it, and a valid Peppol Order sent to `/sources/:id/capture` is refused.

**12. `party.first_document`**, the **all-users task view**, a **screen
for placing an invoice** by hand, and **four more languages** —
`GET /ui-strings/keys` shows the gaps.

---

### Two habits this week earned

**A failed remote apply is not a no-op** (decision 0235). `wrangler`'s
file import does not roll back across a whole migration, so a failure
halfway leaves the database part-changed — **check the schema, not the
bookkeeping table**, before retrying.

**And replay runs against empty data.** A migration that cannot survive
a database with rows in it will pass every check here. The honest fix is
a fixture and it is not built.

### The citation check runs with the tests

**Nineteen comments cited two records nobody had written** — decisions
0188 and 0224, found by comparing citations against `docs/decisions/`
and not by anyone reading the code.

`npm test` now runs `scripts/check-citations.py` first. It names the
record and where it is cited, and **it was watched to fail** by deleting
decision 0224 and seeing it report eight references.

**The convention is that a citation can be followed.** Twice it could
not, and neither was noticed while writing three of the records in
between.

## Habits worth keeping

`docs/PROGRESS.md` has the longer list.

### The shape this project keeps finding

**A real mechanism, aimed at something that used to be true.** Not a
missing check — a working one, pointed slightly wrong.

| | The mechanism | What it was aimed at |
| --- | --- | --- |
| 0084 | A migration test | Existing rows, not new ones |
| 0093 | A standing invariant | Detection, where prevention was claimed |
| 0097 | `isAdminRoute` | Routes it never reached |
| 0100 | A lint rule | Output nobody read |
| 0103 | A counts test | A page that happened to hold the task |
| 0105 | A session test | The helper, not the routes calling it |
| 0109 | A keying screen | A line's columns, not its facts |
| 0110 | A vocabulary | Two of six mandatory line terms |
| 0112 | A vocabulary, again | Two of eight mandatory header terms |
| 0119 | A validation route | A block assembled by hand, which the validator had outgrown |
| 0120 | A keying form | A summary of five fields, once the form offered more |
| 0124 | A font stack | A face nobody's machine had installed |
| 0126 | A configuration screen | Listing sources, while the create route sat unreachable |
| 0131 | A proxy allow-list | Every path beneath `/sources/:id` but not the path itself |
| 0132 | A translation system | Every label, and none of the sentences the API sent |
| 0143 | A stage restriction | Three fields somebody listed, not the ones added later |
| 0144 | Field visibility | The screen, never the route — since September |
| 0152 | A visit timeline | Stages minutes apart, never a straight-through second |
| 0157 | An authoring flow | Somebody doing it in one sitting, never leaving halfway |
| 0158 | A read-back | A combinator, never a rule that is one condition |
| 0165 | A viewer | One caller, so its requirements read as facts |
| 0167 | A viewer | A task, never a document nobody is working on |
| 0170 | Extraction | A model that reads badly, never one confident about it |
| 0174 | A line save | Every field the screen holds being a field it sends |
| 0212, 0324–0328 | A proxy allow-list | Six routes, real and tested in `vf-app`, never once added to `vf-ui`'s own list of what it will forward |
| 0337, 0338, 0339, 0346, 0347 | A test file's own strings stub | The new keys a change actually introduced, not the ones the file already had — hit five separate times across one arc, each time cascading into several unrelated-looking failures traced back to the same missing key |
| 0341 | A `flex: 1` CSS rule | The row shape it was written for (0332's team-member picker), not the different shape a later decision (0334) put in the same class |

**And this table itself.** It was removed by a rewrite of the section
above it, and three later edits claimed to add rows to a table that was
no longer there — a scripted `replace` finds nothing and changes
nothing, silently. Rebuilt here.

---

**Check one layer against another.** Fifteen divergences found this way and
none any other way: a column with no vocabulary entry; a fact never
declared; settings reaching nothing twice over; a parser populating half
its fields; a constant contradicting its own contents; a storage layer
nothing called; a content type derived from half a detection result; a
migration checksum written and never compared — under a comment
asserting it *was* verified; and three derived fields nothing computes.
**Storage proves nothing about addressability; an admin route proves
nothing about effect; a passing unit test proves nothing about wiring.**

Decision 0067 makes one of these a standing check — and decision 0079
records what it does not cover.

**Watch every new check fail.** A test nobody has seen fail is a comment
that takes time to run. One fail-watch reordered detection in a way that
broke nothing meaningful and *proved the wrong thing*; only re-doing it
correctly showed the guarantee was real. And in decision 0078 a test was
written that asserted the **wrong** behaviour — which would have
defended the mistake against anyone who later tried to fix it.

**A survival test cannot catch a broken reference.** Rebuilding a
referenced table (0084) took three attempts. The second passed a check
that existing rows survived — and would have shipped a schema where
every NEW child row failed, because SQLite rewrites foreign keys to
follow a renamed parent and the rows being checked were copied before it
moved. **Insert after a migration, not just count.**

**Tests, `tsc` and the bundler read the module graph differently.**
A dependency installed at the repository root passed both test suites
and the typechecker, and failed the deploy outright (0089). Only one of
the three is the one that matters. `wrangler deploy --dry-run` is the
check.

**A standing invariant detects; it does not prevent.** Decision 0092
claimed one meant a cross-customer access grant could not be written. A
hand-written `INSERT` then wrote one against the live control plane —
suggested as a demonstration that the guard would refuse. Where a rule
spans tables and matters, **carry the discriminator and use composite
foreign keys** (0093): prevention that is visible in the schema and
survives a rebuild.

**A fail-watch that does not fail is information.** A case-sensitivity
test in 0090 passed with the protection removed, because it recorded
with mixed case and read with lowercase while the write path lowercased
anyway. The bypass ran the other way. Twice this session a test needed
correcting rather than the code.

**Ask what a query actually answers.** Decision 0080's rule survey
filtered on `approved_by IS NOT NULL`, returned seven rules, and read
past a count in the same output saying eight. No harm that time; had the
eighth been a different rule it would have been left firing at the wrong
stage.

---

## Reading order

**For a person:** Documents 1 to 4 in `docs/documents/` and as Word
editions, then `docs/PROGRESS.md`. The decision records are reference,
not reading.

**For a new AI session:** `docs/PROGRESS.md`, this file, then name the
task and the relevant decision numbers. The records are written to be
read cold — each states what was decided, what was rejected, and why.

**One-off configuration** lives in `docs/operations/` — SQL run once
against a named database, reviewed like code but not part of the
migration chain.

**Document shapes come from Peppol BIS 3.x** (decision 0082), not from
what an ERP exports and not from a shape invented here. One caveat that
is easy to get wrong: **only the invoice has Business Terms.** BIS
Billing is a CIUS of EN 16931; the other eleven transactions use UBL
element names, so "use Peppol throughout" must not be read as "use BT
codes throughout".
