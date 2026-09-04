# 0084 — One production per region

**Status: built.** `workers/vf-licence/migrations/0008_environments_per_region.sql`.
The first step of decision 0083's build order.

---

## The change of intent

Migration 0005 introduced environments with `UNIQUE (customer_id, kind)`
and said so deliberately in its own words: *"at most one sandbox and one
production per customer, never more, never a duplicate of either."*

**That was correct when `kind` was the only thing distinguishing
environments.** It is not a bug being fixed; it is a decision being
changed. A customer may now hold `Morrison-EU` and `Morrison-US`
productions, storing data in each region while a single shared UI
presents one at a time (decision 0083 section 5).

The narrower guarantee survives **within** a region: a customer still
cannot have two productions in the EU. Only the axis widened.

---

## The id was the other place it was encoded

The constraint was not alone. The environment id was derived as:

```ts
const id = `${customerId}-${kind}`;
```

So `Morrison-production` would collide between an EU and a US
production **on the primary key**, even with the constraint widened.
Widening one without the other would have produced a feature that
cannot be used — the worst outcome, because it looks done.

Ids now include the region. Existing ids keep their shape:
`Acme-production` is referenced by `licences` and `usage_periods`, and
the id is opaque everywhere it travels — nothing splits or parses it,
**checked directly rather than assumed**. A mixed format is untidy and
harmless; rewriting live ids to tidy it would not be.

### It cost 102 test edits

Ten test files hardcoded environment ids. Every one used `region: "eu"`
exclusively — verified before touching anything, because a regex across
100 strings is exactly where a mistake hides.

Four more were template literals (`` `${customerId}-sandbox` ``) that
the regex correctly left alone and the test run then caught. That
sequence is the argument for running tests between mechanical edits
rather than after all of them.

---

## Two failed attempts, and why the third is so blunt

`environments` is referenced by `licences`, `usage_periods` and
`signup_requests`. SQLite cannot alter a `UNIQUE` in place, so it has to
be rebuilt — and the two obvious ways to rebuild it both fail.

### Attempt one: drop and recreate

**Failed on the first remote apply**, having passed locally.

`DROP TABLE` performs an implicit DELETE, which orphans every
referencing row, and D1 enforces foreign keys on every migration.
`PRAGMA defer_foreign_keys` does not save it — tested directly: the drop
records a deferred violation that recreating the parent afterwards never
clears, so COMMIT fails. `PRAGMA foreign_keys = OFF` is SQLite's own
answer and D1 forbids it, because every migration runs inside an
implicit transaction a query may not change.

**The local check had seeded `environments` and the `customers` it
points AT — but nothing that points at IT.** Decision 0078 rebuilt
`tasks`, which nothing references, and that pattern was carried across
without checking the direction of the dependencies.

### Attempt two: rename aside

**Failed worse, because it failed later.**

SQLite rewrites dependent foreign keys to follow a renamed table — with
or without `legacy_alter_table`, checked directly. So `licences` came to
reference `environments_pre_0008` silently. Existing rows still
resolved, and **every new licence failed.**

The verification for that attempt asserted that existing rows survived.
It never inserted a new one. **A survival test cannot catch a broken
foreign key**, because the rows it checks were copied before the
reference moved.

### Attempt three: rebuild all four

Children copied to holding tables, everything dropped in dependency
order, everything recreated with its foreign keys **stated explicitly**
rather than inherited from whatever SQLite decided to rewrite, then
copied back parent-first.

Blunt, and the only version whose references are written down rather
than derived. The holding tables reference nothing and are referenced by
nothing, so dropping them is safe — which is precisely what dropping a
referenced table is not.

---

## The test that was missing

`test_0008_populated.py`, ten cases, seeding **every table that
references environments** and running the migration as D1 does: one
transaction, commit at the end. The failure appears at COMMIT, so
running statements individually would not reproduce it.

The case that matters most inserts a **new** licence after the
migration. Watched to fail: reinstating attempt two breaks it, along
with the assertion that each child's schema still names
`REFERENCES environments(id)`.

A companion case checks a licence for an unknown environment is still
**refused** — because pointing children at a table that permits anything
would also pass the first test.

---

## What this does not do

- **Nothing creates a second environment yet.** The constraint permits
  it and the route handles it; no customer has one.
- **A blank region would silently restore the old behaviour** by making
  every row collide on the same key. A standing invariant now refuses
  it.
- **The UI's instance selector does not exist.** This is the schema it
  will read from.
