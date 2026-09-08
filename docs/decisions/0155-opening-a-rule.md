# 0155 — Opening a rule

**Status: built.** A rule opens, shows every version, and can be paused
or given a new one.

---

## Pause is deactivate

The operator, correcting themselves mid-conversation:

> I saw in the Validation stage there was a rule with a paused status. I
> think I meant to say pause — which is similar to deactivate.

**One word, not two.** The rules list already said *Paused*, and an
interface with two names for one act is an interface somebody has to
learn twice. Decision 0067 made the same argument about the vocabulary
of actions.

### Nothing changed `rules.enabled` before this

A rule was created enabled and stayed so. **The only way to stop one was
to delete it**, which loses the sentence somebody wrote and every
example they confirmed.

**Pausing is not unapproving.** The version keeps its approval and its
confirmed examples, so resuming needs no second trip through the
activation gate — decision 0034's gate exists to prove somebody read the
rule, and they did.

That is exactly why the list distinguishes *paused* from *draft*: one
was trusted once and the other never has been.

---

## The sentence is the way in

A rule row names a rule, and opening one is the first thing anybody
wants to do with it. **A separate "open" button would put navigation
where the rule itself is** — the same reasoning decision 0142 applied to
the task list's subject.

---

## Every version, and only one read-back

The list shows the latest; this shows the history. Somebody asking *"why
did this change"* needs to see that v2 replaced v1 and when.

**The read-back appears only for the version being looked at.** Every
version rendered in full would bury the current one, and the older
sentences are what show what changed.

**And which version is running is computed, not stored**: enabled, plus
approved, plus no `effective_to`. A rule can hold three versions where
one is live, and *"which"* is the first thing anybody asks.

---

## A new version starts from the old one

The compile route has accepted a `ruleId` since decision 0014, producing
a v2 rather than a new rule. The screen now passes it, **and carries the
existing sentence into the box**.

Rewriting from a blank page invites somebody to lose a clause they meant
to keep.

---

## A routing bug this introduced, caught by reading

`^/rules/([^/]+)$` matches **`stages`** too. The detail route was placed
before the stage list and would have answered it with *"no rule called
stages"* — a 404 that looks like a missing rule and is a routing
mistake.

Found by reading the pattern rather than by any test, which is why a
test now asserts both `/rules/stages` and `/rules/compile` still reach
their own routes.

---

## What is not built

- **A version cannot be rolled back to.** Every version is shown and
  only the latest can be acted on, so *"go back to v1"* means writing v1
  again.
- **Nothing warns before pausing a live rule.** It stops applying to
  invoices immediately, and the only signal is the label changing.
- **A paused rule still appears at its stage** in the chevron count,
  which counts rules rather than running rules.
