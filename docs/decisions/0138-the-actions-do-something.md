# 0138 — The actions do something

**Status: built.** Complete, release, return, return to supplier and
discard work from the viewer.

---

## They rendered and did nothing

Decision 0122 gave the actions icons and recorded this as **worse than
before**: *"icons advertise more confidently than a greyed-out word."*

Two reasons, both found by tracing what a click reached rather than by
reading the code.

**The proxy carried two of six task paths.** `claim` and `release` were
listed; `complete`, `return`, `return-to-supplier` and `discard` were
not — so four of them were refused by `vf-ui` before reaching the route
they were aimed at. Decision 0131 had just found the same shape in the
sources screen.

**And three routes authenticated by API key only.** Decision 0127 fixed
that everywhere `requirePermission` was used; `return`, `discard` and
`return-to-supplier` call `authenticateUser` directly and were missed.

**`authenticateUser` is now imported by nothing.** Every route in
`vf-app` accepts a session.

---

## Returning and discarding ask why

Decision 0075 made a reason a **requirement** rather than a courtesy: a
document that comes back with no explanation is one the next person
cannot act on. Decision 0078 says the same of discarding — *"nothing
goes back"*, so the record of why is all there is.

**Cancelled means cancelled**, and an empty reason is not a reason. The
server refuses one too, so sending it would be a round trip to be told
what the screen already knows.

**Completing asks nothing.** It is not a refusal, so there is nothing to
explain.

---

## The underscore matters

`return_to_supplier` is the action; `return-to-supplier` is the route.
Getting it wrong is a 404 that looks like a permission problem, so a
test asserts the conversion.

---

## Four things the tests got wrong before the code was right

Worth recording together, because the code was correct throughout and
every failure was mine.

**`stubFetch` in `viewer.test.ts` took one argument** where the sources
version takes two — so a test passing an array of posted paths got it
back empty and read that as *"nothing was called"*.

**Two helpers named `openWith` in one file.** Decision 0122's takes a
single argument and stubs no routes; mine was shadowed by it. A reader's
trap as much as a test's.

**`setTimeout(0)` is not long enough for a click**, which awaits a fetch
and then a JSON parse — the assertion ran between them.

**And `action.return_to_supplier` reads "To supplier"**, not "Return to
supplier". A test looking for a label nobody uses finds nothing and says
the button is missing.

Each one reported a failure that was not there. **A test that is wrong
in a plausible way costs more than no test**, because it sends somebody
to look at working code.

---

## What is not built

- **Nothing confirms an irreversible action.** Discard and return to
  supplier both end a task, and the reason prompt is the only pause.
  Decision 0122 recorded this and it is still true — a prompt asking
  *why* is not a prompt asking *are you sure*.
- **The Task Manager still uses text buttons**, so there are two
  vocabularies for the same actions.
- **`window.prompt`** again, as decisions 0130 and 0133 both note.
