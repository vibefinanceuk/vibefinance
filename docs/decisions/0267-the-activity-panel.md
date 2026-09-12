# 0267 — The activity panel, and a real environment reset mid-build

**Status: built.** The Conversation feed only — Alerts remains
deliberately deferred, as scoped at the start of this piece.

---

## What was asked

> a collaboration / chat panel, which serves as a complete audit trail
> for every document, and is visible (expandable) from the document
> viewer. The panel allows a user to enter conversation about the
> document, which is given a timestamp. It also hosts alerts which are
> system generated when a document moves between stages after being
> acted upon... The conversation should be internal only.

Refined through the mock-ups in decisions 0264/0265's own record and
this one's own discussion: system events phrased as real facts, never
first-person AI narration; a rule firing named as *"Business rule
'Spend Threshold' fired: routed to AP Review and assigned to the AP
Team"* — which is exactly why decision 0266 (a rule's own name) came
first.

---

## One kind of new storage, and only one

`document_comments` — id, invoice, author, body, timestamp. Nothing
else. Every system-generated line — received, a stage completed, a
rule fired — is derived at read time from tables that already exist:
`invoice_headers`, `tasks`, and `stage_visit_steps` (a real,
pre-existing record of which rules matched at which stage visit,
found by reading the workflow engine directly rather than assumed).
Storing "a rule fired" a second time alongside `stage_visit_steps`
already recording exactly that would be the same fault decisions 0236
and 0264 already found and fixed: a record able to quietly disagree
with the thing it claims to describe.

**Every one of the closed vocabulary's eleven actions is described
honestly**, not only the two the operator's own example used —
`route_to`, `assign_org`, `assign_cost_centre`, `hold_until`, `flag`,
`reject`, `tag`, `set_field`, `notify`, `escalate_after`,
`assign_task`, each resolved from `shared/interpreter/vocabulary.ts`'s
own real param shapes, with stage/team/user/org ids batch-resolved to
names rather than looked up per action.

**A rule's name, with the fallback decision 0266 was built for**:
named where a name exists, the compiled sentence otherwise — the exact
reason that record was written first.

**No fallback chain for "who."** `stageCompletedEvents` and
`commentEvents` were first written with `name ?? email ?? "Someone"`
chains. Both are unreachable: `completed_by` is FK-enforced and
covered by a standing invariant guaranteeing it is set whenever a task
is completed (migration 0033), and `org_users.name` is itself
`NOT NULL`. Found by trying to test the fallback and having the schema
itself refuse the insert — the code was simplified rather than kept
untestable and defensive against a state that cannot occur.

---

## Hidden, then wide — reconciling both things said about it

"Visible (expandable)" and, later, "it can be hidden but also opened"
described the same reference image: closed by default, a small tab
naming how much is behind it, opening into real room rather than a
strip squeezed into whatever space was left over. The panel manages
its own container directly rather than depending on `viewer.js`'s own
full-shell re-render, since that render (`shell.replaceChildren`)
would otherwise reset the panel's open state and discard whatever was
loaded on every unrelated form edit.

---

## Two real, pre-existing bugs found while wiring this in

Neither caused by this work — both latent, both now fixed because a
new regression test happened to look at the whole page rather than one
element.

**`Node.append(null)` inserts the literal text "null."** Confirmed
directly against the real DOM, not assumed. `unreadableNote()` and
`progressRow()` both return `null` in their common case, and the
arrays holding them were never filtered — meaning the shipped viewer
has likely been rendering a stray "null" between its header and its
two-column layout, and again in its right column, on ordinary
documents, for some time. Fixed with `.filter(Boolean)` at both
points. The first attempt at the second fix landed on the wrong
closing bracket — `.columns`'s own two-element array rather than the
true outer array — caught immediately because the regression test
still failed identically, and fixed by tracing the actual bracket
structure rather than the one assumed from indentation.

**Hardcoded font sizes.** Seven declarations in the new CSS used raw
pixel values instead of the four-step scale this app enforces with its
own test. Caught by that test, not missed by it — every value mapped
to `--text-sm` or `--text-base`.

---

## A sandbox reset, mid-build

The build environment was wiped entirely partway through this piece —
outside anything either side did. Recovery took two attempts: every
bundle ever delivered this session survived, but reconstructing full
git history from them hit a permanent, confirmed gap nine bundles in
— a merge commit created only on the operator's own side during an
early `git pull`, never received back. The operator's own repository,
cloned directly, had the complete and correct history throughout;
everything already committed (through decision 0266) was never at
risk. Only this record's own in-progress work — fully held in
conversation context — needed rebuilding, and rebuilt to be identical
to what existed before the reset, re-verified test by test rather than
assumed to still be correct.

---

## What is not built

**Alerts** — the second tab from the mock-ups — remains out of scope,
exactly as scoped before this piece began. It needs its own honest
pass through `validation.ts`'s real checks rather than reuse of the
mock-up's two illustrative examples.

vf-app: 1491 tests. vf-ui: 49 Worker, 307 browser. vf-licence: 320.
