# 0127 — Every route a person can reach

**Status: built.** `requirePermission` accepts a session, all 25 call
sites pass one, and a test refuses a route that forgets.

---

## Found three times

**Decision 0105** found it in the task routes: `requirePermission`
authenticated by **API key only**, so the claim button failed silently
while 927 tests passed. Four routes fixed.

**Decision 0126** found it again in the configuration routes, building
the first configuration screen. Two routes fixed, and the rest recorded
rather than fixed in passing.

**This fixes the remaining 25** — and adds the check that should have
existed after the first time.

**Fixing it two at a time is how it kept coming back.** Each fix was
correct and local, and neither left anything that would notice the next
occurrence.

---

## What was actually wrong

A signed-in administrator could not reach almost any configuration
route. They would be **given an administrator role and refused by it**,
with a 401 that looks like a session problem and is not.

`requirePermission` now takes an optional `SessionContext`. Optional so
a caller without session support behaves exactly as before — an API key
still works everywhere it did, because decision 0095's point stands:
**sessions and keys coexist deliberately**, since a person and a script
are different callers.

---

## A function, not a local

The context is built by `sessionContext(env)` rather than a `const` at
the top of `fetch`.

**Three of the 25 call sites are in helpers** that take `env` and never
see the fetch handler's scope. A local would have covered 22 and left
three failing to compile — loud, but the helper covers all 25 without
anyone choosing.

**Eleven more routes assembled the same four arguments inline**, and
now call `authenticatePerson(db, request, env)`. One place, so a change
to how a session is verified is one change rather than eleven that have
to be found.

---

## The check reads the router, not a list of paths

A test exercising known routes would pass forever while the route added
tomorrow — the case that matters — went unchecked.

It reads `src/index.ts` as text and refuses any `requirePermission` call
without a session context, naming it:

> `requirePermission` without a session context:
> `requirePermission(db, request, "Admin.Configure")`. Pass
> `sessionContext(env)` as the fourth argument, or a signed-in person
> cannot reach this route however they are permissioned.

**The source is imported as text**, because these tests run in `workerd`
and it **has no filesystem** — the same discovery decision 0121 made
from the other side, where a browser test could not use `node:fs`
either.

### And it counted mentions before it counted assemblies

The first version matched `isPublicKeyJwk` anywhere and found two more
— a licence-refresh guard and the scheduled check, which test the same
value for entirely different reasons.

**A test that cannot tell those apart reports work that is not needed**,
which is how a check earns the reputation that gets it ignored. It
counts `publicKeyJwk: isPublicKeyJwk` now — the assembly, not the
mention.

---

## What is not built

- **`vf-licence` is untouched.** Its admin key is an operator
  credential, not a person's, so the same question does not arise there
  yet — but it will when an administrator manages their own licence.
- **Nothing checks the reverse**: a route that accepts a session and
  should not. `/health` and the ungated bootstrap endpoints are
  deliberate (decision 0055), and no test says which those are.
