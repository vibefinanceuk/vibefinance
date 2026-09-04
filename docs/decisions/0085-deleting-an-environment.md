# 0085 — Removing an environment created in error

**Status: built.** `DELETE /environments/:id`, admin only.

---

## Why it exists

Decision 0084's verification created `Acme-production-us` to prove that a
second production in another region was permitted. It was — and the row
stayed, pointing at a Worker that does not exist, appearing in the fleet
manifest as though it were a deployment.

Nothing could remove it. There was no delete route at all, so the
options were raw SQL against the live control plane, or leaving a
falsehood in the manifest.

**Raw SQL against production is what this project avoids everywhere
else**, and it offers no protection against deleting an environment that
does have history.

---

## Deliberately narrow

**An environment that anything references cannot be deleted.** A licence,
a usage period or a signup request pointing at it means the environment
has a history — and `usage_periods` in particular is billing evidence.

So this removes exactly one thing: a row created by mistake, before it
was used. That is the case it exists for, and the only case where
deletion is unambiguously safe.

The rule falls out of the schema rather than being invented: the foreign
keys already refuse a delete that would orphan anything. What this adds
is a **useful refusal**.

---

## The references are checked explicitly, not left to the keys

A foreign key would refuse too — with a constraint error saying nothing
about **which** reference blocked it.

An operator deciding whether a deletion is safe needs that. So all three
are counted and every blocker is named:

```
environment acme-production-eu has history and cannot be deleted:
1 licence(s), 2 usage period(s)
```

**Every blocker, not just the first.** Fixing one and retrying, only to
be refused again for a different reason, is how somebody ends up
reaching for raw SQL — which is the thing this exists to prevent.

Watched to fail: removing the guard breaks three tests, including the
one asserting that both blockers appear together.

---

## What it does not do

- **It does not delete a customer.** A test asserts the customer
  survives, because "remove this environment" and "remove this customer"
  are very different requests and one route should not quietly do both.
- **It does not deprovision anything.** No Worker, no D1 database, no R2
  bucket. Consistent with provisioning, which also creates only
  control-plane records (`docs/PROGRESS.md`) — the infrastructure is
  still created and destroyed by hand.
- **It leaves no tombstone.** The row is gone rather than marked. For an
  environment that was never used, there is nothing to preserve; for one
  that was, the delete is refused.

A test confirms the region becomes available again afterwards, which is
the point of removing a mistake.
