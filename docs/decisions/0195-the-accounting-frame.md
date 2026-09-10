# 0195 — The accounting frame

**Status: built.** A ledger, a cost centre tree beneath it, and the
chain that walks it.

---

## The one thing both vendors have and this did not

Decision 0194 compared this project's org model to Oracle's and SAP's
and found it had reached the same answer for legal entities and
operating units — and had **no accounting frame at all**.

Oracle calls it a **Ledger**, SAP a **Controlling Area**, and both
describe one object: a chart of accounts and a fiscal calendar, to which
legal entities are assigned. SAP's rule is the one this table exists to
enforce:

> One or many company codes can be linked to a single controlling area.
> All the companies within one controlling area should use the same
> chart of accounts and fiscal year variant.

---

## Which is where a cost centre belongs

SAP again: *"controlling area is created under company code, and cost
center is created under controlling area."*

**Not under a legal entity.** So one cost centre may be charged by
several companies that share a chart of accounts — which is exactly what
decision 0031 sensed when it kept `BT-133` apart from `org_units` as *"a
financial construct, not an organizational one."*

That record was right and could not name what the financial construct
belonged to instead. **It belongs to a ledger.**

### And a `cost_centres` table already existed

Flat, since decision 0016: an id and a name. It gains a ledger, a
parent, an owner and that owner's limit — so the thing that was a label
becomes a node.

---

## Four standing invariants, and each one is a mistake somebody would make

**Only a legal entity accounts in a ledger.** An operating unit
processes transactions and does not account for itself — decision 0036's
split, and Oracle's rule that a business unit posts to a ledger
*through* its entity.

**A cost centre's parent is in the same ledger.** A tree crossing charts
of accounts is a tree whose totals mean nothing.

**A cost centre is not its own parent.** Cheap to state, and the
cheapest cycle to make.

**A limit needs an owner.** A number nobody can act on is not a
configuration.

All four are `ASSERT ALWAYS`, re-checked on every future migration, and
all four were watched to fail.

---

## The chain, walked once

Decision 0184's **Limit** mode: start at the cost centre, climb while
nobody's limit covers the amount, stop at the first owner whose does.

**Written once** so no route walks it itself — decision 0192's argument
that a resolver is the defence against thirty places getting it slightly
different.

**Three behaviours worth stating:**

**A null limit approves anything.** Escalation happens when an amount
*exceeds* a threshold, and an owner with none has none to exceed — which
is how a group CFO at the top of a chain is configured.

**A cost centre with no owner escalates immediately**, which is a real
configuration rather than a broken one.

**The chain records who was asked**, not only who approved. Decision
0184 left *"what happens when a chain runs out"* undecided, and this
reports it: the caller sees the people consulted and that none could
cover it.

### And it will not loop

The route refuses a self-parent, and **a guarantee the code makes is not
one the data keeps** — decision 0152's lesson. The walk tracks what it
has seen, and a test builds a cycle by direct `UPDATE` to prove it.

---

## What is not built

- **Nothing calls the chain.** `assign_task` still names one team or one
  person, and wiring approval to this is the next piece.
- **Level mode.** Decision 0184 records that a step is Level or Limit
  and never both; only Limit exists.
- **A chart of accounts.** `chart_of_accounts` is a **string naming
  one**, not a structure — so two ledgers cannot silently share a name
  and differ, and nothing validates a cost centre against it.
- **No screen.** A ledger is created by `POST`, and a hierarchy nobody
  can see is one nobody will trust — decision 0185's own argument.
- **Nothing assigns a cost centre to an invoice line automatically.**
  `BT-133` is extracted where a document carries it, and no rule action
  sets one.
