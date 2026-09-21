# 0426 — `docs/PROGRESS.md` undercounted the design: a sixth screen, and Workload's own metrics, never tracked

**Status: committed. Documentation only — nothing to deploy.** This
session still has no push access to `vibefinanceuk/vibefinance`;
delivered as a git bundle for the operator's own pull/push sequence,
the same path decisions 0391, 0415–0425, 0562 and 0566 already used.

---

## What was asked

"What else is remaining, to bring the dashboards in line with the
mock-ups" — the operator's own open-ended prompt, once decision 0425
shipped, was pushed, deployed, and confirmed directly. Answering it
required reading the design document itself again, directly, rather
than trusting this codebase's own prior summary of it — and that
re-read surfaced two things `docs/PROGRESS.md` had gotten wrong.
Reported to the operator before touching the file; the operator chose
to have the record corrected now, before picking the next build.

---

## What was found

**The design names six new dashboard additions, not five.** Its own
Executive Summary states this directly: *"a design for six new,
permission-gated dashboard additions... Supplier Performance, User &
Team Workload, Fraud & Risk Detection, Liabilities & Accruals, a
Multi-Enterprise View for the Office of the CFO, and a conversational
Talk to an AP Expert tab."* `docs/PROGRESS.md` and every decision doc
through 0425 had only ever named five — Screen 6, "Talk to an AP
Expert," had never once appeared anywhere in this repo's own
documentation, despite the design document giving it a full section
(Screen 6), its own Role-Based Access Model row (a new `AP.Assistant`
permission), and its own place in the Recommended Phasing (Phase 5,
sequenced last on purpose, since its tool palette wraps the scoped
query functions the other five screens' own routes already build).

**Workload's own remaining metrics had never been checked against the
design's own list for that screen.** Screen 2 — User & Team Workload
lists eight key metrics; decision 0415 built one ("Throughput by user,
stacked by stage," itself only a partial read of the design's own
first bullet, which also asks for a breakdown "by business unit, by
team/group" that 0415 does not build). The other seven — open task
count by user split by ownership, average handling time by stage and
by user, claim-to-complete cycle time, tasks pending action and
approaching/past due, team queue depth, workload balance, and
exceptions by user — had never been named as unbuilt anywhere, because
`PROGRESS.md`'s own "one of five screens... stay unbuilt" framing
treated a screen as accounted for once it had *a* tab and *a* real
metric, without checking that metric count against the design's own
list the way every other screen's count already was.

**"Payment history" had dropped out of the named list under
Liabilities & Accruals**, despite being a real, distinct bullet in the
design and named directly in decision 0419's own doc as needing
payment-execution data this codebase does not capture. The prose
instead named "payment terms held vs. actual" and "DPO" as two
separate items — which the design states as one bullet — while
silently losing "payment history" itself. The count (four of six
unbuilt) was correct; the four named things were not the right four.

---

## What was built

No code — this decision corrects `docs/PROGRESS.md` alone.

**The "Not built" section's own Management Dashboard paragraph
rewritten**, correcting: the design's own screen count (six, not
five); Workload's own unbuilt count (seven of eight, previously
uncounted); the named list under Liabilities & Accruals (restoring
"payment history," folding "payment terms held vs. actual" and "DPO"
back into the design's own single bullet). A new paragraph added for
**Screen 6 — "Talk to an AP Expert,"** entirely unbuilt: its purpose,
its new `AP.Assistant` permission, its named-tool-calls architecture
(explicitly not open text-to-SQL against D1), its own place in the
Recommended Phasing, and the design's own further "standalone remote
MCP server" option for this screen — named as explicitly out of scope
for the document itself, not merely deferred.

The historical, dated narrative entries for decisions 0415 and 0417
(which describe the design as "five screens," matching what was
believed at the time) are left untouched — this project's own standing
rule (`docs/HANDOVER.md`): records are never rewritten to agree with
later ones, and a dated entry describing what was known then is not
wrong, only superseded.

---

## What is not built

Unchanged by this decision — see `docs/PROGRESS.md`'s own corrected
"Not built" section for the full, now-accurate list across all six
screens. Nothing here is a new gap; every item named was already true,
only some of it had never been written down.
