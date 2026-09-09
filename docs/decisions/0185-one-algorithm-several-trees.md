# 0185 — One algorithm, several trees

**Status: designed, not built.** How a customer configures who approves
what, without the set of strategies being closed by code.

---

## What was asked for

> I think we need a configuration screen with approval hierarchy
> configurations. This could be employee–supervisory based on approval
> thresholds, or perhaps cost-object approval with a cost centre manager
> lookup table. Or perhaps some other condition to be defined.

**The third clause is the design.** Two named strategies produce a
system with two named strategies, and the third arrives as a rewrite.

---

## The two strategies are the same algorithm

Set them side by side.

**Supervisory.** Start at the person who keyed the invoice. Walk up the
management line. Stop at the first person whose signing limit covers the
amount.

**Cost object.** Start at the cost object on the line. Walk up its
parent cost objects. Stop at the first owner whose signing limit covers
the amount.

**Same algorithm. Different tree, different starting point.**

```
walk(tree, from, amount, mode) → chain of approvers
```

Four parameters, and a strategy is a choice of them:

| | Tree | Starts at |
| --- | --- | --- |
| **Supervisory** | people and the units above them | whoever keyed it |
| **Cost object** | cost objects and their parents | the line's `BT-133` |
| **A third** | some other tree | some other fact on the document |

**`mode`** is decision 0184's distinction: `level` walks every rung to
the top; `limit` stops when somebody's authority covers the amount.

---

## Which makes the third one cheap

A third strategy needs a tree and a starting fact, not a new algorithm.
*Approval by supplier category*, *by project*, *by legal entity* — each
is a table with a parent column and a rule for where to begin.

**This is decision 0031's own argument, applied one level up.** That
record closed the *rule vocabulary* and said *"the vocabulary is closed,
and that is the feature"*. The set of **trees** is closed the same way,
and adding one is a row and a lookup rather than a branch in the
walker.

---

## What a customer configures

**Per stage**, because Approval and AP Review can want different things:

- **Which strategy** — which tree, which starting fact.
- **Level or limit**, never both (decision 0184).
- **Whether it runs per line or per document** — `evaluation_scope`
  already exists (decision 0027) and already answers this.

**Per node of the tree:**

- An **owner**, who approves.
- A **signing limit**, in a currency — `org_authority_limits` is
  precisely this shape and is read by nothing today.

---

## What this project already has

**`org_units` is a tree** — `parent_unit_id` referencing itself. And
`org_users.unit_id` points into it, so **there is already a people
hierarchy**, indirectly: a person belongs to a unit, and a unit has a
parent.

**`org_authority_limits`** holds `(user_id, currency, max_amount)`.

**`BT-133`** is the line's cost object.

**Decision 0183's per-line tasks** raise one task per line, each naming
its line.

---

## What is missing

- **A unit has no manager.** The people tree exists and no node of it
  says who approves for that node.
- **Cost objects do not exist as a table at all** — `BT-133` is a string
  on a line, with no parent and no owner (decision 0184).
- **Nothing walks anything.** `assign_task` names one team or one
  person, and there is no *"who is next"*.
- **Completing a task advances nothing** (decision 0183), where a chain
  needs finishing approval *n* to raise approval *n+1*.
- **And no screen configures any of it**, which is what was asked for.

---

## What a screen would need to show

A hierarchy is hard to configure blind. **The tree is the screen**: the
nodes, each with its owner and limit, and an obvious answer to *"who
approves £5,000 charged here?"*

**And it should be testable before it is live**, the way a rule is
(decision 0153). *"An invoice for £5,000 on cost centre 4100 would need
Alice, then Mo"* is the same idea as a worked example, and the same
argument applies: **a configuration somebody cannot check is a
configuration they cannot confirm.**

---

## Deliberately not decided

- **Whether the amount is the line, the cost object's portion, or the
  invoice total.** Decision 0184 records that the sources disagree, and
  it is still the first question.
- **What happens when a chain runs out** with the amount uncovered.
- **Delegation and absence.** Both sources in decision 0184 insist on
  it; nothing here has a delegate.
- **Whether a strategy can fall back to another** when its starting fact
  is missing — a line with no cost object, on a stage configured for
  cost object approval, currently has nowhere to go.
