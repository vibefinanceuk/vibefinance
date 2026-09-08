# 0157 — Confirming from the rule

**Status: fixed.** A rule waiting on its examples can be confirmed and
activated from the rule screen.

---

## A count with nowhere to act

Reported after writing a real rule:

> Which now says in the list "2 to confirm", but I cannot see what to
> confirm when navigating to the rule.

**Exactly right.** Decision 0153 put confirmation on the compose screen,
immediately after compiling — which is where somebody is when the
examples first appear, and the only place they existed.

Decision 0155's rule screen then showed `examplesTotal` and
`examplesConfirmed` as a **count**, with no way to act on it. So
navigating away stranded the rule: the list said what was needed and
nothing offered it.

**A screen that names an outstanding action and does not offer it is
worse than one that says nothing**, because it tells somebody the system
is waiting on them and hides where.

---

## Only for a version that has not been activated

An approved version's examples were confirmed once and are **history**.
Loading them would invite somebody to confirm what is already running,
which is not a thing to be doing.

So the screen finds the version with unapproved examples — there is at
most one, since a new version is only compiled after the last was dealt
with — and shows those.

---

## Above the history

A rule saying *"2 to confirm"* is **a rule waiting on a person**, and
that is what they came to do. The version history can wait its turn.

The examples read exactly as they do on the compose screen: *"Fires"*
and *"Stays quiet"* rather than `expectMatch: true`, because somebody
confirming is being asked to agree that an outcome is right.

---

## What this says about building a flow in one place

Decision 0153 built the whole authoring flow as a **sequence** — write,
read back, confirm, activate — which is right for somebody doing it in
one sitting.

**It quietly assumed nobody would leave.** The moment somebody compiles
a rule and closes the tab, every step after compiling becomes
unreachable, and nothing in the design noticed because the flow was
always tested end to end.

The rule screen is now the other way in, and the two share the same
example rendering rather than describing them twice.

---

## What is not built

- **The two screens draw the examples separately.** `exampleRow` exists
  in both `compose.js` and `rule.js`, which is the duplication decision
  0151 moved the chevron row to avoid — and it is a copy for now.
- **Nothing says a rule is waiting from anywhere else.** The rules list
  says it, and the task list, the viewer and the mood control do not —
  so somebody who never opens Rules never learns.
- **A rule whose example generation failed still has no retry**, which
  `PROGRESS.md` has recorded since before this screen existed.
