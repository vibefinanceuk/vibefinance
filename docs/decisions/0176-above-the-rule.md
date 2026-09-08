# 0176 — Above the rule

**Status: built.** What identifies a document sits in its heading, and
an unclaimed task says so.

---

## The rule is a boundary and things were on the wrong side of it

Decision 0175 moved Waiting and Owner out of a status card and put them
beneath the topbar. **Beneath its horizontal rule**, which separates the
heading from the page — so they read as the first row of *content*
rather than as part of the heading.

They are neither. *"Waiting 2h"* and *"Owner: alice@acme.com"* say what
this document **is to somebody right now**, which is the heading's own
job.

`topbar` now takes them, and the rule falls where it should.

---

## And nobody had claimed it, so it said nothing

The owner line appeared only when `lockedBy` was set, so an unclaimed
task showed no owner at all — which is exactly the case where somebody
is deciding whether to pick it up.

**An absent line reads as a screen that forgot.** *"Nobody yet"* is a
real answer and a more useful one: it means anybody may take it.

A document with **no stage at all** still says nothing, and should — one
opened from the document manager is not work (decision 0167), so it has
no owner to lack.

---

## What is not built

- **The team is not named.** A task owned by `AP team` and claimed by
  nobody says *"Nobody yet"*, where *"AP team, unclaimed"* would tell
  somebody whether it is theirs to take.
- **Nothing offers to claim it from here.** The viewer reports who has
  it and the task list is where somebody acts.
