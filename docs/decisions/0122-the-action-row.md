# 0122 — The actions, below the document

**Status: built.** A horizontal row of icons under the document,
replacing a stack of full-width buttons in a panel of their own.

---

## Why the stack was wrong

Eight full-width buttons in a panel headed *"Actions"* read as a **menu**
— a list of things the application offers — rather than as things to do
with the document sitting above them.

Putting them under the document says what they act on.

---

## Icons above labels, both

The reference the operator supplied has three actions, each an icon with
its word beneath. **Every one is labelled**, and that is the part worth
copying: an icon alone is a guess, and a guess about *"return"* versus
*"return to supplier"* is an expensive one.

Drawn inline rather than pulled from a library. This interface has no
build step, and a dependency for eight shapes is a dependency to keep
current for eight shapes. `stroke="currentColor"` so they follow the
customer's livery and the light or dark surface without a second set.

---

## Each icon has to be true

**This is the part that took the thinking**, and two were at risk of
lying.

**`discard` is an archive box, not a waste bin.** Discarding archives
and deletes nothing (decision 0078). A bin promises a customer something
this system does not do, and they would be right to believe it.

**`release` is an open padlock**, and `claim` a closed one. A claim *is*
a lock and locks never expire (decision 0104), so letting go is
unlocking. The two are mirrors, or neither reads.

The rest are conventional: corner arrows for expand, a tray for save, a
checkmark for complete, a curving arrow back for return, an arrow
leaving a box for return to supplier.

A test asserts the archive is not a bin and the padlocks differ —
**on the path data**, since that is the actual claim.

---

## "Open in new window" became "Expand"

The old wording described **the mechanism**. Somebody wants the document
bigger; that it arrives in another window is *how*, not *why* — and it
is only in another window because a Worker cannot render a PDF (decision
0042), which is our constraint rather than theirs.

---

## One action still dominates

Decision 0108 asked for one dominant element per screen. Giving every
action the same weight would lose which one a person is there to press,
so Save keeps a heavier stroke and full-strength colour while the rest
sit quieter.

`expand` and `save` are the **screen's own** and always appear; the rest
come from what the task reports, which is still the server's decision
(decision 0103). Icons changed how they look, not where they are
decided.

---

## What is not built

- **The other actions do nothing.** `complete`, `release`, `return` and
  the rest render disabled — they were disabled as buttons too, and this
  change did not wire them up.
- **No confirmation on anything irreversible.** `discard` and
  `return_to_supplier` end a task, and both are one click.
- **The Task Manager still uses text buttons.** Two vocabularies for the
  same actions until it follows.
