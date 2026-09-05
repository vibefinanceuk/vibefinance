# 0104 — Releasing a claim

**Status: built.** `POST /tasks/:id/release`, and the action reported in
the task list.

---

## Why an explicit release exists at all

Decision 0103 settled that **locks do not expire**, and rejected a lease
with a timeout for two reasons:

A browser closing is **undetectable** — `beforeunload` does not fire on
a crash, a sleeping laptop or a killed tab, and cannot reliably make a
network request even when it does. Any release depending on the browser
announcing its departure will leak locks.

And a lease has its own failure: somebody reading a difficult invoice
loses their claim mid-thought, on a timeout nobody can choose correctly.

**A lock that never expires is at least predictable.** This is what
makes it workable: explicit recovery, by a person or by a manager.

---

## `AP.TaskManage`, and why not `AP.ReturnAny`

They look similar and are not.

`AP.ReturnAny` returns a **document** to a previous stage on somebody
else's behalf — the document moves through the workflow. Releasing a
claim leaves the task exactly where it is and merely makes it available
again.

Bundling them would mean **anybody who can unlock a task can also send
documents backwards.** Different powers, so a different permission.

The same permission should gate the all-users task view, since seeing
every person's work and being able to release it are one job.

---

## Both names are recorded

`releasedBy` and `previousHolder`, because they answer different
questions. When Sarah asks why her task moved, *"Mo released it"* and
*"it was yours"* are both part of the answer — and `claimed_by` going
null loses the first entirely.

`viaOverride` distinguishes **a person releasing their own from a
manager releasing another's**. Identical effect, different acts.

---

## Releasing something nobody claimed is not an error

It returns 200 with `released: false`. The desired state already holds,
and a caller retrying should not be told off for it.

Refusing would make the client's job harder for no gain — it would have
to check before acting, and the check could go stale between the two
calls anyway.

---

## Where the action appears

The task list reports `release` (decision 0103), and it appears in
exactly two places:

- **On a task this person claimed.** Not on one assigned to them
  directly — there is no claim to release, and putting it back would
  mean returning it to nobody.
- **On a colleague's locked task, to somebody with `AP.TaskManage`**,
  and it is then the *only* action offered. Nothing else may be done to
  another person's work.

Watched to fail: removing the permission check lets anybody release
anybody's claim.

---

## What is not built

- **The all-users view.** The permission is named and enforced; the
  screen that lists every person's tasks is a separate piece.
- **Out-of-office reassignment**, deferred in 0103. It needs a notion of
  absence that does not exist, and manager release covers the case
  meanwhile.
- **A record that survives the release.** `releasedBy` is returned to
  the caller and then gone — nothing stores it. That is a gap worth
  closing when something records task history.
