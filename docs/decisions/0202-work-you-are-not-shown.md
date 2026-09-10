# 0202 — Work you are not shown

**Status: built.** A German validator is no longer shown French work.

---

## Decision 0199's largest gap, closed

That record said it plainly:

> A person is correctly denied acting and still shown the work.

The operator's requirement was the same sentence from the other side:

> Someone assigned AP.Validation does not get access to French
> documents when they have been given access to the German
> AP.Validation role.

---

## Where, not whether

**A permission somebody does not hold has never hidden a task.**
`required_permission` decided which **actions** were offered; ownership
decided what was **listed**.

Making the permission a visibility filter broke twenty-two tests, and
correctly — it is a different change from the one asked for, and a
larger one.

**So this filters on where a permission is held, not on whether.** A
task about a French invoice is hidden from somebody holding
`AP.Validate` only in Germany, and everything else is exactly as it
was.

**Held everywhere** — every assignment predating decision 0199, and
every customer not using units — is unaffected. **Held nowhere** is
unaffected too, and that is a separate question worth asking one day:
whether work nobody may do should appear in anybody's list.

---

## Resolved against the document, walking up

A role held at Acme France covers AP France beneath it, so the walk is
`unitLineage` again — the same one from decisions 0196, 0197 and 0199,
now on its fourth use.

**Cached per unit within a request**, because forty tasks in two orgs
would otherwise be forty walks for two answers.

---

## And a comment that was already claiming this

`task-list-route.ts` opens with:

> `required_permission` decides who sees it.

**It did not.** The comment described a filter nobody had written, and
has done since the file was created — which is the same class of thing
decision 0144 found when field visibility was enforced by a screen and
described as enforced by a route.

It is true now.

---

## What is not built

- **Claiming and completing are still not unit-aware.** A German
  validator cannot *see* a French task and could still claim one by its
  id. Decision 0199's count stands: fourteen permission checks, and now
  two of them consider a unit.
- **Nothing tells a person why a queue is empty.** A validator with no
  role in any unit that has work sees the same blank screen as one whose
  queue is genuinely clear.
- **Teams and settings remain customer-wide**, and decision 0192 lists
  them.
