# 0215 — Two names for one permission

**Status: fixed.** The supplier load asks for the permission every other
configuration route asks for.

---

## Reported by using it

> I get a message saying *"you do not have permission to do this."*

**Correct, and for a distinction nobody had made.**

`Admin.Configure` and `Admin.ConfigManagement` both exist in the closed
set. **Twenty-two routes use the first. Nothing uses the second** — and
the supplier load was written against it.

So a person holding every configuration right in the system was refused
by one route, because I picked a name from a list without checking which
one the codebase had settled on.

---

## Decision 0010 predicted this exactly

> Several permissions in this scheme are placeholders today, unbacked by
> any real route.

`Admin.ConfigManagement` is one of them, and has been since September.
**A placeholder is harmless until somebody reaches for it**, at which
point it is indistinguishable from the real thing by name alone.

**And the comment beside it was stale.** It said `Admin.Configure` had
*"no specific route of its own yet"* — true when written, and untrue for
months by the time I read it. So the file argued for exactly the wrong
choice.

---

## Not removed, and that is deliberate

`Admin.ConfigManagement` stays. **A permission a customer may already
have granted is not something to delete in passing** — a role naming it
would become a role naming nothing, silently.

What changed is the note beside both, which now says which is used and
which is not.

---

## The test is behavioural, and the first one was not

My first attempt read `index.ts` and asserted the string in it. **It
failed, and deserved to**: `workerd` has no filesystem, and a test that
greps source proves the source says something rather than that the
system does it.

Replaced with two requests through the real router: somebody holding
`Admin.Configure` loads a file, somebody holding `AP.Validate` gets a
403. **Watched to fail** by putting the old name back.

**The boundary was always real. It was the name that was wrong.**
