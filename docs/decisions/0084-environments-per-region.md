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

## The rebuild

SQLite cannot alter a `UNIQUE` in place, so `environments` was rebuilt —
the second such rebuild in this project after decision 0078's.

Verified against a populated replica rather than trusted: every column
carried across, the foreign key to `customers` intact, **two productions
in different regions permitted and two in the same region still
refused.** Both directions, because a widening that widened too far
would pass a test that only checked the new case.

The standing invariants from 0005 are restated in 0008, because the
rebuild replaced the table they were written against. An invariant that
quietly stops applying reads as protection while protecting nothing.

### The superseded invariant is edited, not duplicated

0005's `(customer_id, kind)` rule is rewritten in place to the widened
form, requiring `--refresh-checksums`. The alternative — leaving the old
rule and adding a new one — means two invariants over the same columns
with one of them stale, which is how they come to disagree.

Same reasoning as decision 0075's edit to migration 0009, and the
mechanism decision 0076 made actually work.

---

## What this does not do

- **Nothing creates a second environment yet.** The constraint permits
  it and the route handles it; no customer has one.
- **A blank region would silently restore the old behaviour** by making
  every row collide on the same key. A standing invariant now refuses
  it.
- **The UI's instance selector does not exist.** This is the schema it
  will read from.
