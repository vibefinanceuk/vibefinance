# 0191 — A screen that assumed it was showing

**Status: fixed.** Tasks is reachable from every other screen.

---

## Three dead links, and all of them the same one

> The links on the left menu do not work in some cases. When in the
> Rules page, Tasks does not launch. When in Sources, Tasks does not
> launch. When in Documents, Tasks does not launch.

**One fault, reported three times**, because it looks like a different
broken link on each screen.

`go("tasks")` called `loadTasks()` — which fetches tasks and updates the
table. **That is right when Tasks is already on screen and does nothing
at all when it is not**, and Sources, Rules and Documents each replace
the shell with their own.

The other three branches call something that renders. This one assumed
it was already rendered.

---

## Which was true when it was written

Tasks was the only screen. `go()` existed to change a filter, not to
change a page — and every screen added since has been reached *from*
Tasks and quietly could not be left.

**The same shape decision 0149 found in the navigation itself**, where
`current === "sources" ? "" : "on"` meant *"not sources means tasks"*
until a third screen made it wrong. Both are assumptions that were facts
when a list had one member.

---

## Tested as a round trip, not a click

The test navigates **away and back** for each of the three screens, and
asserts that the task table is there — not merely that the navigation
entry is marked.

**Marking the entry without rebuilding the screen is exactly what made
this look like a dead link**, so a test that checked only the highlight
would have passed throughout.

---

## What is not built

- **Nothing checks that every screen can reach every other.** This tests
  three routes into Tasks; a fifth screen would need its own, and
  nothing derives the matrix from the navigation.
- **`go()` still does two jobs** — changing a filter and changing a
  page. It happens to work because rendering twice is harmless.
