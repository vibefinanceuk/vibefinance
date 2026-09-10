# 0192 — Configuration belongs to a unit

**Status: designed, not built.** One instance per customer, with
configuration scoped to an operating unit and inherited from above.

---

## The question

> Those individual business units — France, Germany or UK — may have
> their own configuration of users, roles, permissions, different
> reporting structures, general ledgers, and configurations. Although
> they might inherit from the parent org, they may require their own. I
> need to know to what degree our setup and configuration can be
> isolated to one operating unit.

### First, what the per-customer split is actually for

An earlier version of this record said the alternative was *"one
instance per legal entity, which is what decision 0001 already gives per
customer."* The operator corrected it:

> The purpose of separate D1 and R2 was in order to isolate customer
> data from another and support hosting in different locations.

**Isolation between customers, and data residency.** Not a general
mechanism for splitting one customer up.

And residency already has its own level: `environments` carries a
**`region`**, and a customer may have several. A group needing French
data in the EU and UK data in the UK has **two environments** — two
databases, two buckets, in two places.

**So this record is not about that choice at all.** It is about what
happens *within* one environment, where units share a database because
they are permitted to.

---

**Which sharpens the question into two, not one.**

**Must these units be hosted apart?** Then they are separate
environments, and nothing here applies. That is a legal question about
where bytes may sit, and it is answered above units.

**May they share a database?** Then they are units in one environment,
and their configuration needs scoping.

The operator chose the second:

> The other route would cause multiple D1 instances (difficult to
> manage), and limit reporting and analytics across countries (limited
> visibility).

**Both halves of that are right for units that may share**, and the
second is the stronger: *"what did the group spend with this supplier"*
becomes unanswerable **by construction** once they are apart.

**And it remains unanswerable across environments**, which is the cost
residency imposes and this record does not remove. A group split for
legal reasons has a reporting problem that lives in the control plane,
not here.

---

## What is scoped today, and it is four things

| | Scoped by |
| --- | --- |
| A person | `org_users.unit_id` |
| An invoice | `org_unit_id`, and **only ever an operating unit** (0036) |
| A source | `default_org_unit_id` — how an arriving document gets its unit |
| Which national rules apply | `org_profiles.unit_id` — the CIUS profile |

**Everything else is customer-wide.** Roles, teams, processes, stages,
rule sets, field visibility, settings — none carries a unit. France and
Germany share every one of them.

---

## The shape of the change

**A configuration row gains a nullable `unit_id`.** Null means *the
group's own*, which is what every existing row already is — so nothing
migrates and nothing breaks on the day the column appears.

**Resolution walks up.** Given an invoice's operating unit, look for the
most specific configuration: that unit, then its legal entity, then that
entity's parent, up to the group default at null.

**This is decision 0036's tree doing work it was already shaped for**,
and it is why that record's invariant matters: an operating unit's
parent is a legal entity, so the walk is short and its shape is known.

---

## The trap, and it is the whole risk

**Forgetting the unit does not fail.** It returns the group's
configuration — a plausible answer, quietly wrong.

Decision 0001's `resolveTenant` has the same danger and a real defence:
a lint rule bans `env.DB` by name, so a route that forgets a tenant
**cannot compile**. There is no equivalent here, because the column is
nullable by design and a query omitting it is valid SQL that returns
rows.

**This is the exact class of fault this project keeps finding** — a
default that was correct when there was one of something. Decision 0144
found field visibility enforced only by a screen; decision 0191 found a
screen that assumed it was the only one.

So the defence has to be built with the feature, not after it:

- **A resolver, not a join.** One function that takes a unit and returns
  the configuration, so no route writes the walk itself.
- **A test that a French invoice never sees a German rule set**, which
  is the negative proof decision 0022 insisted on for vocabularies and
  the same argument here.

---

## Permissions are the hardest part

A permission is a string today: `AP.Approve`. **Scoped, it becomes a
pair** — `AP.Approve` *in France*.

**Alice with `AP.Approve` can approve a German invoice**, and that is
either correct or a serious hole depending on the customer. A group
treasury team that approves everywhere is real; so is a French clerk who
must not see German payroll.

**Not decided here.** It changes `hasPermission`, every route that calls
it, and the role model itself — and it is the difference between a unit
being a *filing* boundary and a *security* boundary.

---

## And document visibility follows from it

An invoice carries its unit. **Nothing filters by it**, so the document
manager (0164) shows every invoice to everybody.

Whether that is right is the same question as permissions, one layer
along.

---

## What would need building

- **`unit_id` on** roles, teams, processes, rule sets, field visibility,
  settings.
- **One resolver** that walks the tree, and a rule that nothing else
  does.
- **A decision about permissions**, above.
- **A screen**, because a configuration inherited from three levels up
  is one nobody can see. Decision 0185 made the same argument about
  approval hierarchies: *"a configuration somebody cannot check is a
  configuration they cannot confirm."*

---

## Deliberately not decided

- **Whether a unit may override or only add.** A French rule set that
  *replaces* the group's is different from one that *adds to* it, and
  the second has no obvious ordering.
- **General ledger structure**, which the question named and this record
  does not cover. `BT-133` is a cost centre string with no chart of
  accounts behind it.
- **Reporting across units**, which is the reason this route was chosen
  and which nothing yet does.
- **Reporting across environments**, which is harder and separate: two
  regions are two databases by law, and joining them is a control-plane
  problem decision 0083 already refused to make the licence server solve
  — *"making the control plane a reporting proxy is a far larger
  decision."*
