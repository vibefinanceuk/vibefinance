# 0074 — `require_second_approval` is removed

**Status: built.** Resolves the open decision recorded in 0064 section 2.

---

## Removed rather than built

0064 framed this as *build it or remove it*, and leaned toward building:
a second approval needs a second approver who is a **different person**,
which tasks could not express.

Describing the actual AP process settled it the other way. **Nothing was
left for the action to mean.**

---

## The three things it might have meant, and what already does each

**Multiple approvers at the Approval stage.** Already built. Several
`assign_task` actions on one rule — or several rules firing in
`all_matches` — spawn parallel tasks on the same stage visit. They are
claimed and completed in any order, and `onTaskCompleted` counts open
tasks per visit, releasing the instance only at zero (0064 section 1).
Parallel rather than sequential is the point: it is what makes approval
fast.

**Deciding when further review is needed.** Already expressible. The
condition — over an amount, a new supplier, a failed validation — is a
rule's condition, and the action is `assign_task` at the Review stage.
Both exist.

**Separation of duties.** An RBAC concern, not a rule one. `AP.Approve`
and `AP.Review` are separate permissions; a customer keeps them in
separate roles and does not grant both to one person.

---

## What removal does not solve, stated plainly

**Nothing prevents a role holding both permissions.** The live
deployment's own role holds `AP.Validate`, `AP.Approve` and `AP.Review`
together, which is exactly how segregation of duties erodes — a
convention that holds until somebody is on holiday.

An incompatible-permissions check would refuse at assignment time and
turn *"we don't do that"* into *"the system won't let you"*. It is
small: a set of pairs, checked when a role is created and when one is
assigned.

**Deliberately not built here.** The operator's position is that an RBAC
violation is better *surfaced* than prevented — a fraud-reporting
surface can see that the same person approved and reviewed a document,
which is a fact about what happened rather than a rule about what is
permitted, and it catches the case where roles changed between the two
actions. That surface does not exist yet.

So this is deferred, not answered. Recorded here so it is not mistaken
for handled.

---

## Why removing beats leaving it

An action in the closed vocabulary is a **promise to the compiler**. A
customer writing *"invoices over 10,000 require a second approval"* got
a rule that compiled, passed the activation gate, fired on the right
invoices, and did nothing — while looking correct in every listing.

That is worse than the action not existing. A refusal at compile time
would have told the customer to express it differently; silence told
them it worked.

**The fifth of this pattern, and the first resolved by removal.**
`'warned'` (0040), `validation.passed` (0044), `set_field` (0049) and
`extraction.confidence` (0054) were all declared before they did
anything, and all four were later built. This one had nothing to build.

---

## Safe to remove

Checked before touching anything: **no stored rule references it.**

```sql
SELECT count(*) FROM rule_versions WHERE compiled_json LIKE '%require_second_approval%'  -- 0
```

That mattered. `validateRule()` runs at evaluation time as well as
compile time, on the principle of never trusting storage blindly — so a
stored rule using a removed action would become a refusal on its next
evaluation. With zero references there is nothing to migrate.

A test now asserts `isKnownAction("require_second_approval")` is
**false**, so the removal is a property rather than an absence somebody
could undo without noticing.
