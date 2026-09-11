# 0235 — A migration replay could not break

**Status: fixed.** The supplier rebuild survives a database with data in
it.

---

## It passed every check and failed on the first real database

```
applying 0055_a_supplier_awaiting_the_erp.sql to 'vf-app-poc' ...
✘ FOREIGN KEY constraint failed
```

`invoice_headers.supplier_id` references `suppliers`, so `DROP TABLE`
fails **the moment one invoice points at one.**

**Replay runs against empty data.** The migrations build a schema and
insert almost nothing, so a drop with no child rows succeeds — and a
rebuild that breaks every real customer replayed clean.

**The harness is not at fault for the foreign keys.** It sets `PRAGMA
foreign_keys = ON` deliberately, with a comment explaining that D1
enforces them and plain SQLite does not. **It is at fault for having
nothing to violate.**

---

## And the obvious fix does not work

`PRAGMA defer_foreign_keys = ON` defers the check to commit — and
**SQLite counts each dropped child as a violation, which the later
rename does not clear.** So the commit fails instead of the drop.

`PRAGMA legacy_alter_table = ON` fails the same way.

**Both were tested rather than reasoned about**, which took three
attempts and was worth every one: the first two are what the
documentation suggests.

---

## So the links are parked

Lift `invoice_id → supplier_id` into a temporary table, null the column,
rebuild, put them back.

**No pragma**, which means D1 behaves exactly as a local replay does.
**One transaction**, so a failure halfway leaves the links where they
were.

**And a point-in-time assertion that no invoice lost its supplier** —
the one thing this migration could plausibly break, checked rather than
trusted.

---

## And a remote apply does not roll back

**The failed attempt left `suppliers_new` behind**, which the operator
had to drop by hand before retrying.

So `wrangler`'s file import is **not transactional across the whole
file**: a migration that fails halfway leaves the database part-changed.

**Which makes the script's own message do real work** rather than being
cautious:

> chain now needs manual inspection before continuing

**It means what it says.** A failed remote apply is not a no-op, and the
next thing to check is what the database actually looks like — not what
the bookkeeping table claims.

---

## What is not fixed

**Replay still runs against empty data.** This migration is now proven
against a referencing row **by a script written for it**, not by
anything that runs with the tests.

**A rebuild is rare and this will recur.** The honest fix is a fixture —
a handful of rows loaded before replay, so a migration that cannot
survive data fails where it is cheap to find out.

**Not built here**, and it is the second time this month a check has
been strictly weaker than production: decision 0223's CSS variables were
the first.
