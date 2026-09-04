# 0093 — Making the one dangerous row impossible

**Status: built.** `workers/vf-licence/migrations/0011_grants_carry_their_customer.sql`.

---

## What happened

Decision 0092 claimed a standing invariant meant a cross-customer access
grant *"cannot be written by any route or by hand"*.

**It could.** A standing invariant is checked by the migration runner at
replay time: it **detects** a violation rather than preventing one, and
SQLite cannot express this rule as a `CHECK` because it spans three
tables.

That was demonstrated rather than argued. A hand-written `INSERT`
granting `nobody@example.com` access to `Acme-production` **succeeded
against the live control plane** and sat there until it was deleted. Had
the login endpoint existed, `hasAccess` would have returned true for it.

The suggestion to run that insert was mine, offered as a demonstration
that the guard would refuse. It did not.

---

## Why this row and not others

**This is the one row in the system that crosses the customer
boundary.** Everything else is protected structurally: each customer has
their own database, their own Worker, their own R2 bucket. A mistake in
`vf-app` reaches one customer's data because that is all it can reach.

`user_environment_access` is the single place a control-plane row can
hand somebody another customer's data — and every other control would
work perfectly while it happened. The audience claim would check out,
the session token would verify, the instance would serve.

Detection after the fact is not enough for that one.

---

## Carrying the customer, rather than a trigger

A trigger was written first, tested, and rejected.

It works. It is also **invisible in a way a foreign key is not**: it
does not appear in the table definition, and a table rebuild drops it
silently — which this project has done three times (decisions 0078,
0084). Guarding against that needs a further invariant asserting the
trigger still exists, which is a guard for a guard.

Its body also contains semicolons, which broke the test harness's
statement splitter immediately and would plausibly have broken D1's own.

**Carrying `customer_id` on the grant turns the rule into two ordinary
foreign keys:**

```sql
FOREIGN KEY (email, customer_id)          REFERENCES user_credentials(email, customer_id),
FOREIGN KEY (environment_id, customer_id) REFERENCES environments(id, customer_id)
```

Neither alone is enough. Together they require the environment and the
credential to name the same customer, which is exactly the rule —
enforced at write time, visible in the schema, travelling with any
future rebuild, and needing no mechanism this project did not already
use.

The customer is written from the **environment** rather than from the
caller, so a caller cannot name one and mean another. A test asserts a
row claiming the wrong customer is refused either way.

---

## Watched to fail, twice over

- The row that reached production, written **verbatim** and bypassing
  `grantAccess` entirely — which is how it arrived in the first place.
- A grant naming another customer's environment, under both possible
  values of `customer_id`.

Removing the two foreign keys while keeping the column breaks both.

---

## A new migration, not an edit

Migration 0010 was already applied to production. Editing it would have
left the remote schema disagreeing with the file that claims to describe
it — the drift decision 0076 exists to catch.

So 0011 rebuilds the table. Safe here in a way decision 0084's rebuild
was not: **nothing references `user_environment_access`**, where
`environments` had three dependants and the same operation failed twice
before it worked.

---

## What this does not change

`grantAccess` still checks and still returns a reason, because a
constraint error tells a caller nothing useful. The difference is that
it is no longer the only thing standing between a mistake and a breach.
