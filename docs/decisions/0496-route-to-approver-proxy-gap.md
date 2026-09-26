# 0496 — Route To Approver's own candidates route, missing from `vf-ui`'s proxy allowlist

**Status: built and verified locally, not yet committed/pushed at the
time of writing.**

## What was asked

Not a new feature — a bug found while the operator smoke-tested
decision 0495 in production. Reported live, working through it
together: the "Route To Approver" button rendered correctly, but
clicking it immediately showed a pop-out alert reading "That could not
be done," with no picker ever opening. A DevTools Network check
confirmed the exact request: `GET /api/tasks/:id/route-to-approver-
candidates` returning a bare `404 (Not Found)` — not a JSON `{error:
...}` body from any of `handleRouteToApproverCandidates`'s own
refusals, a plain 404 from something in front of `vf-app` entirely.

## What was found

`vf-ui/src/index.ts` proxies `/api/*` to a customer's `vf-app` instance
through an **explicit allowlist** (`PROXIED_TO_INSTANCE`), not a
general forwarder — deliberately, per the file's own doc comment,
after an earlier incident where a blanket passthrough exposed three
write routes above an admin gate (decision 0097). The cost of that
choice, named in the same file more than a dozen times since (decisions
0212, 0319, 0324–0328, 0415, 0417–0431, 0440, 0444, 0452, 0472–0474,
0483, 0485, 0487, 0490): a route can be real and fully tested in
`vf-app`, and a screen can call it correctly, and it will still 404
through this proxy until its exact path is added to this one file —
a second place every new route must be remembered, separate from
`vf-app`'s own router.

Decision 0495 added `GET /tasks/:id/route-to-approver-candidates` to
`vf-app` and built, tested, and shipped the button and picker that call
it — but never added the path here. Confirmed directly: `POST
/tasks/:id/complete` (what the picker's own confirm step posts to) was
already on the list, since it's the same existing endpoint every stage
completion uses — so only the new GET route was ever missing. The
button itself renders from `GET /tasks` (already proxied, unaffected),
which is why it appeared correctly while the picker it opens could not.

## What was decided

Add the one missing pattern, following this file's own established
shape and comment convention exactly — the same "found directly,
checked against this list" discipline every prior instance of this gap
already uses, rather than reaching for a wildcard that would also
admit paths nobody has reviewed.

## What was built

- **`workers/vf-ui/src/index.ts`**: added
  `/^\/tasks\/[^/]+\/route-to-approver-candidates$/` to
  `PROXIED_TO_INSTANCE`, directly after the Return-targets entry decision
  0490 added, with a doc comment naming both 0495 (where the gap was
  introduced) and 0496 (this fix).
- **`workers/vf-ui/test/index.test.ts`**: added
  `["GET", "/api/tasks/t-1/route-to-approver-candidates"]` to
  `CALLED_BY_A_SCREEN` — the same list whose own `it("carries all of
  them")` test is what would have caught this before it ever reached
  the operator, had it been added in 0495 itself.

## What was not built

No change to `vf-app` or `vf-licence` at all — the underlying route,
resolver, and migration from decision 0495 were correct throughout;
this was purely `vf-ui`'s own proxy allowlist catching up to them.

## Verification

- `workers/vf-ui`: `test/index.test.ts` **61/61**, including the new
  entry (confirmed it fails without the fix — reverting the
  `src/index.ts` change locally and re-running reproduces exactly the
  reported symptom: the new path appears in the test's own `refused`
  list). Full worker-side suite (`test/index.test.ts` +
  `test/session.test.ts`) **74/74**. `npx eslint src/index.ts
  test/index.test.ts` clean.
- Not yet re-verified live — pending the operator redeploying `vf-ui`
  from this commit and retrying "Route To Approver" against the same
  task that reproduced the 404.

## Still to do, operator side

Push, then redeploy **`vf-ui` only** (this fix touches nothing in
`vf-app` or `vf-licence`, so those need no redeploy for this specific
fix) and retry "Route To Approver" on the same in-flight task. The
picker should now open and list candidates as decision 0495 originally
described.
