# 0323 — Testing the route, not just the function

**Status: built.** A real gap in test coverage, closed — the live
failure itself remains open.

---

## What was asked

> After deployed I get a message - We could not load this screen. Try
> again in a moment.

Confirmed decision 0322's own fix is working as intended: a failure
that used to be silent is now visible. The actual cause is still
unknown, and investigating it surfaced a real, separate gap worth
closing on its own.

## What was found

Every test written for `/org/overview` across decisions 0319–0321 —
fifty-five of them — calls `handleGetOrgOverview` directly. Not one
goes through the real HTTP route. `index.ts`'s own
`authenticatePerson` and `hasPermission` calls, and everything Cloudflare
itself does around a real request, have never been exercised at all.
Reported live is exactly the shape of bug that gap could hide: a real
500 or 403 the unit tests could never have caught, because none of
them ever went through the route that would produce one.

## What was built

Four new tests, built through `SELF.fetch` — a real HTTP request
against the actual worker, the same pattern `scoped-roles.test.ts`
already established for testing a route rather than a function
directly. A real user, a real API key, a real role, a real request:
succeeds for somebody holding `Admin.Configure`, succeeds for a
delegated `Admin.UserManagement` holder, 401s with no credential,
403s somebody holding neither.

**All four pass.** In a clean test environment, with a fresh
database, the route works exactly as designed — the same conclusion
decision 0322's own tests already reached, now confirmed one layer
deeper. This is a genuine, useful result: it rules out a whole class
of route-wiring bug as the cause of the live failure, and it is
coverage worth having regardless of what that cause turns out to be.

## What has coverage

Probed directly: forcing the route to always refuse, regardless of
which permission is actually held, fails the `Admin.Configure` test
correctly — confirming these tests exercise the real route logic, not
a fixture that would pass regardless.

vf-app: 1524 tests (was 1520). No frontend change, no migration.

## What is not built, and this matters

**The actual cause of the live failure is still unknown.** Passing
tests, including new ones built specifically to catch this class of
bug, rule out several plausible explanations without identifying the
real one. The next, necessary step is the actual response the live
worker returns — its status code and body — which nothing in this
record has access to.
