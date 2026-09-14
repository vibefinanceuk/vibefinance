# 0324 — The route existed on one side of the proxy, not the other

**Status: built.** The actual cause of the live failure, found from
the exact error text rather than more guessing.

---

## What was asked

> It is red and says {"error":"not found"}

That exact string does not appear anywhere in `/org/overview`'s own
backend logic — nothing it returns says "not found." That ruled out
the route handler itself immediately and pointed somewhere else
entirely: `"not found"` is `vf-ui`'s own proxy layer, in a completely
different Worker, in a file this whole arc had never once opened.

## What was found

`vf-ui` forwards `/api/*` requests to `vf-app` only for paths on an
explicit allow-list, `PROXIED_TO_INSTANCE`. A path not on it never
reaches `vf-app` at all — the proxy answers `{"error":"not found"}`
itself, regardless of whether the backend route exists, works, or was
tested six different ways.

`/org/overview` was added to `vf-app`'s own `index.ts` across
decisions 0319–0321, and never added here. Every one of the fifty-nine
backend tests built for it — including decision 0323's own real
`SELF.fetch` requests, built specifically to catch a routing bug —
tested `vf-app` directly, and none of them go through `vf-ui`'s proxy
at all. The bug was invisible to every test written for this feature
so far, because none of them crossed the one boundary it was actually
in.

**This is not a new class of mistake.** Decision 0212 already
documents it happening twice before — decision 0204's org picker,
decision 0211's supplier load — with the same operator's own words
from that record standing unchanged: *"the gap is that adding a route
and adding it here are two steps, and nothing ties them together."*
This is the third time, not a new kind of bug.

## What was built

`/^\/org\/overview$/` added to `PROXIED_TO_INSTANCE`.

## What has coverage

`/org/overview` added to `index.test.ts`'s own `reachable` list —
decision 0212's own mechanism, built specifically for this exact
failure mode, that this feature was never added to. Probed directly:
removing the new allow-list entry reproduces the live bug exactly,
and the test catches it.

vf-ui: 50 Worker (was 49), 425 browser, unchanged (this fix lives
entirely in the Worker's own proxy, not in anything a browser test
exercises). No migration, no `vf-app` change — the backend was
correct the entire time.

## What is not built, and this matters

**The mechanism decision 0212 already named is still just a list.**
A third instance of the same gap is a pattern, not a coincidence — a
route can still be built, tested thoroughly, and shipped without ever
reaching a customer, and nothing before a live report would have said
so.
