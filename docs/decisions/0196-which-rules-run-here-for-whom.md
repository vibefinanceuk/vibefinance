# 0196 — Which rules run here, for whom

**Status: built.** A unit may override a stage's rule set, and one
resolver decides.

---

## A process is the wrong grain

Decision 0192 named the shape — a nullable scope, absent meaning *the
group's own*, resolved by walking decision 0036's tree — and listed
several things to scope. This is the first, and **which one is the whole
design.**

**France and Germany almost always want the same stages and different
thresholds.** Scoping the *process* would mean duplicating seven stages
to change one rule, and every later change made twice.

So a **stage keeps its own `rule_set_id` as the group's answer**, and a
unit may override it **for that stage alone**.

**Nothing migrates.** Every stage today behaves exactly as it did
yesterday, and an override is a row somebody adds.

---

## An override on a country covers every department in it

The override names a **unit**, not specifically an operating unit. So
one on *Acme France* applies to `AP France` and everything else beneath
it — a country-wide rule expressed once rather than per department.

**Most specific wins.** An override on the operating unit beats one on
its legal entity, which beats the stage's own.

---

## One resolver, and nothing else walks the tree

This is the defence decision 0192 asked for, and the reason it has to
exist:

> Forgetting the unit does not fail. It returns the group's answer — a
> plausible answer, quietly wrong.

Decision 0001's `resolveTenant` is protected by a lint rule that makes
the equivalent mistake **uncompilable**. This cannot be, because the
scope is optional by design and a query omitting it returns valid rows.

**So the defence is that there is one walk**, in `unit-config.ts`, and a
route wanting unit-aware configuration calls it rather than joining for
itself.

### The walk stops on a cycle it did not create

A tree is a tree because a migration says so, and **a guarantee the code
makes is not one the data keeps** — decision 0152's lesson. A test
builds a cycle by direct `UPDATE`.

---

## The negative proof, twice

Decision 0022 insisted on it for vocabularies — *"the critical negative
proof"* — and it matters more here, because the failure is silent: the
wrong rules run and produce a plausible outcome.

**A French invoice must never see a German rule set**, and a sibling's
override must never become the group's. Both tested directly.

### And a test I nearly did not write

The resolver passed thirteen tests. Then removing the engine's call to
it left **every test still passing** — the resolver was right and
nothing proved anything used it.

**Which is decision 0192's risk in miniature.** Ignoring the unit does
not fail; it quietly runs the group's rules. Two more tests drive a real
invoice through the engine and read `stage_visit_steps` for which rule
actually ran, and removing the call now breaks them.

---

## What is not built

- **Only rule sets are scoped.** Roles, teams, field visibility and
  settings are still customer-wide, and decision 0192 lists them.
- **No screen.** An override is a row, and `explainRuleSetForStage`
  exists to say *"Approval: Acme France's rules"* with nothing calling
  it — decision 0185's argument that a configuration nobody can see is
  one nobody will trust.
- **It is not a boundary.** Everybody still sees every invoice; this
  decides which rules run, not who may look. That remains decision
  0192's third step, and the irreversible one.
- **Nothing prevents the next unscoped query.** The resolver is
  available and using it is a convention, not a constraint.
