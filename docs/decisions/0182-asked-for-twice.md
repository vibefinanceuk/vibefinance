# 0182 — Asked for twice

**Status: fixed.** The viewer's four lines are one list.

---

## The instruction was plain and I kept adding to it

> "Stage", "Unique Ref", "Waiting" and "Owner" sections should all have
> the same font and colour and be equal distance apart.

Then, after a first attempt:

> Same font, same weight, same size. They look different.

**Decision 0180 matched the subtitle and the subhead**, and left the
`h2` bold and a size larger. **Decision 0181 found a duplicate rule**
that had been beating them, and left the `h2` alone again.

Both times on my own reasoning — *"the heading keeps its weight, because
it is the heading"* — which is a defensible view of a screen and **not
what was asked for**, twice.

`Stage`, `Unique Ref`, `Waiting` and `Owner` answer the same kind of
question: what is this, and where does it stand. They match.

---

## Scoped to the viewer, by an id

`#viewer .topbar h2`. The general rule comes later in the file and would
win on order; an id beats a class regardless.

**Other screens keep their heading.** Tasks, Sources, Rules and
Documents each name a place, and a place is a heading — the viewer's is
a list of facts about one document, which is a different thing.

---

## What is worth noticing

Two records already exist for this, and neither fixed it. Each found a
real fault — a mismatched size, then a duplicated rule — **and each
stopped short of the thing that had been asked for**, because I had a
view about headings and kept applying it.

**A defensible reason is still a reason to have said so** rather than to
have quietly kept the difference and reported the change as done.

---

## What is not built

- **Nothing else in the interface is checked for this.** Four screens
  have a heading and a subtitle, and only the viewer's relationship
  between them has been thought about.
