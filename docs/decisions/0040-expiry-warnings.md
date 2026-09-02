# 0040 — Staged expiry warnings, and making 'warned' real

Status: settled, 2 September 2026. Closes the gap decision 0039's own
open-items list named: the expiry sweep blocked a trial and told
nobody. A customer discovered their trial had ended by getting a 402
mid-task.

## The mechanism already existed and had never been used

The Blueprint's staging for the licence lifecycle is *"notice in the
product, then notice with a date, then restriction"*. Decision 0039
built the restriction. Neither notice stage existed.

But the `'warned'` status has been in the schema since 0001, is
carried through the signed token, and is accepted by `vf-app`'s own
claims-shape check — fully plumbed, and never once set by anything.
Its own code comments said as much: *"a product-surface concern with
no corresponding access restriction"*. This decision is what finally
makes it real, and it needed no changes to the token format at all:
`status_reason` and `status_effective_at` already flow through.

## Why a column rather than status alone

Warnings are staged at 14, 7 and 1 days by default. If the sweep only
set `status = 'warned'`, it could not tell a licence warned at 14 days
from one warned at 7, and would have no way to avoid re-firing on
every hourly run.

That is tolerable for an in-product banner, which just reads current
state. It would be a genuine problem for the email notification this
deliberately leaves for later: three identical emails, or one every
hour, is worse than none at all. `warned_at_days` costs one column
now and makes the email piece straightforward later, rather than
needing a schema change then.

Storing the threshold itself, rather than a boolean or a timestamp,
is what makes "have we already warned at this stage" directly
answerable.

## A real bug the tests caught

The first implementation searched thresholds largest-first and took
the first match. With `[14, 7, 1]` and a licence six hours from
expiry, `0.25 <= 14` matches immediately — so a customer with hours
left would have been shown *"expires in 14 days"*.

Caught by the test written for exactly that scenario: a sweep that
missed several runs and crosses multiple thresholds at once. The fix
is to search smallest-first, taking the most urgent threshold
genuinely crossed. A related invariant is also tested: a warning never
walks backwards, so a 1-day notice is not softened by a later sweep.

## The product surface finally has something to read

`vf-app` had no endpoint exposing licence state at all — it was
cached and used internally for blocking, but never surfaced.
`GET /licence/status` returns exactly what a notice needs: status,
plan, the human-readable reason, the real expiry date, and the volume
entitlement. Nothing more; a test pins the exact key set so a future
change can't quietly start leaking the whole claims object.

Two deliberate properties, both tested:

- **Not licence-gated.** An endpoint whose entire purpose is to
  explain a restriction must work while restricted. Watched to fail:
  adding `/licence/status` to the gate makes it 402 — hiding the
  notice exactly when it matters most.
- **No network call.** Reads the local cache only, matching the
  Blueprint's "no network call in the hot path". A UI polling this on
  every page load must never depend on `vf-licence` being reachable.

An instance that has never successfully cached anything reports
`{ known: false }` — an honest "we don't know", never a fabricated
"active".

## Ordering in the scheduled handler

Warn first, then expire. A licence crossing its expiry during the same
run should be blocked, not warned about an expiry that has already
happened — `warnExpiringLicences` ignores anything already past
`valid_to`, and `expireOverdueLicences` then blocks it. Tested as a
real sequence: warned at 14 days, escalated at 1 day, blocked at
expiry.

## What's still open

- **Email.** Deliberately not built here. It needs a real provider,
  real credentials, and deliverability handling — a separate piece of
  work. `warned_at_days` is the hook it will use to send exactly one
  email per stage.
- The in-product banner itself: this decision provides the endpoint,
  not a UI.
- Nothing tells the operator either. A trial expiring is visible only
  by looking at the control plane.
