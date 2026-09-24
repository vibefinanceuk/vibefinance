# 0473 — Matching Tab: the proxy never carried its own new routes

**Status: built and verified locally, not yet committed/pushed at the
time of writing.** No push access from this session — delivered as a
git bundle, per this repo's own established handover mechanism.

---

## What was reported

*"pushed and deployed - however I get an error message accessing AP
Setup - saying 'AP Setup could not be loaded'"* — immediately after
confirming decision 0472 (the real AP Setup Matching tab) itself
pushed and deployed.

## What was found

**The exact gap decision 0441 already named and fixed once, for this
same screen.** `workers/vf-ui` is a backend-for-frontend (decision
0102) that proxies API calls to `vf-app` through an explicit allowlist,
`PROXIED_TO_INSTANCE` in `workers/vf-ui/src/index.ts` — a route real
and tested in `vf-app` is invisible to the browser until it is *also*
added here. `GET`/`PUT /matching-config` were built and tested in
`matching-config-route.ts` and wired into `vf-app`'s own router, but
never added to this list — so `ap-setup.js`'s own `load()` had its
third, now-required fetch refused outright with `{"error": "not
found"}`, returned `false`, and the screen's own failure path fired:
*"AP Setup could not be loaded."* `ap-setup.js` and
`matching-config-route.ts` were both already correct — confirmed by
reading them again rather than assumed.

**Not caught before delivery for the identical reason decision 0441
already diagnosed and named as a habit to fix.** `workers/vf-ui/test/
index.test.ts`'s own `CALLED_BY_A_SCREEN` list exists specifically to
catch this — it is a *separate* suite (`vitest.config.ts`) from the
browser one (`vitest.browser.config.ts`) this session ran repeatedly
for decision 0472. Decision 0441's own closing section states this
exactly: *"Run the package's own `test` script, not an ad-hoc `vitest
run`, for any change that touches `vf-ui`: it is the one command that
cannot forget the second suite exists."* This session ran
`vitest run --config vitest.browser.config.ts` directly, several
times, and never once ran `npm test` (or bare `vitest run`) inside
`workers/vf-ui` — the documented lesson from decision 0441 was not
followed. `vf-app`'s own suite (targeted files) and `vf-licence`'s own
suite (full, 320/320) both ran clean, and neither one touches this
allowlist either — the same blind spot decision 0441 already mapped
exactly.

**A second, related gap found while fixing this one, not from a live
report.** `PUT /approval-config/cost-object-dimensions` (decision
0452, the Cost-Object Priority panel) was checked directly against
this same list while adding the Matching entries and found missing
too — real and tested in `vf-app` since that decision, never added
here. No operator report names this one; found by checking this file
against every AP Setup write route it should be forwarding, the same
discipline decision 0441 itself used, rather than waiting for a third
identical bug report on the same screen.

## What was built

Two new entries on `PROXIED_TO_INSTANCE`:

```
/^\/approval-config\/cost-object-dimensions$/
/^\/matching-config$/
```

And three new entries on `CALLED_BY_A_SCREEN`
(`workers/vf-ui/test/index.test.ts`) — one per method+path, proven
reachable by a real fetch through the test rather than assumed from
the pattern alone, the same discipline every earlier entry in that
list already follows.

**Nothing in `vf-app` or `vf-licence` changed.** This is a `vf-ui`-only
fix — the route and the screen decision 0472 shipped were already
correct and are already confirmed live in `vf-app`; only the proxy in
front of them needed to learn `/matching-config` exists (and,
separately, that `/approval-config/cost-object-dimensions` always
did).

## Tests

`workers/vf-ui/test/index.test.ts` — confirmed failing first
(`git stash` of `src/index.ts` alone, plain `vitest run test/
index.test.ts`): the three new entries all 404'd, exactly the
"AP Setup could not be loaded" symptom. Restored, all green — **74/74**
(unchanged in count; additions landed inside the existing
`CALLED_BY_A_SCREEN` list and `it()`, not as new tests). Full
`workers/vf-ui` package `test` script (`npm test`, the exact command
decision 0441 asked future sessions to run) — plain suite green, full
browser suite **1070/1071**, the one failure (`typography.test.ts`)
already confirmed pre-existing and unrelated in decision 0472.

## What this changes about the delivery habit, again

Decision 0441 already wrote this lesson down in plain language and it
was not followed three decisions later. No new tooling is proposed
here — the existing habit was already correct and already documented;
what failed was following it. Recorded again, plainly, rather than
assuming decision 0441's own writeup was sufficient the first time.
