# 0039 — Control-plane provisioning, and what actually ends a trial

Status: settled, 2 September 2026. Builds directly on decision 0038's
approved-but-not-yet-provisioned state, and turns it into a real
trial sandbox — as far as the control plane can, on its own.

## Deliberately half of provisioning

Turning an approved request into a working sandbox takes eight steps:
create a D1 database, apply the migration chain to it, create an R2
bucket, generate the environment's API key, create the customer and
environment rows, issue a trial licence, deploy a `vf-app` Worker with
per-customer bindings, and record the result.

This decision builds the control-plane half — the API key, the
customer, the environment, the licence, and the link back to the
request. It deliberately does not touch the Cloudflare API.

The operator's own call, and the right one: the control-plane half can
be built and genuinely tested end to end today, with no credentials
and no live infrastructure. The Cloudflare API half needs an
account-level write token whose blast radius deserves its own design
conversation (see decision 0001's own reasoning about minimising
exactly that kind of concentrated capability). Splitting here keeps
that a clean, well-defined addition rather than a coupled mess.

The route says so plainly rather than leaving it to be inferred:
`infrastructureProvisioned: false`, and the fleet metadata fields are
left genuinely NULL — which is precisely how decision 0011 already
says a fleet tool must read "not deployable yet". `instance_url` is
`NOT NULL` in the schema, so it gets a visibly fake
`https://not-yet-deployed.invalid/...` placeholder: a URL that
announces itself as unreal is better than a plausible one that
silently 404s.

## Reusing the real handlers, not reimplementing them

`handleProvisionTrial` calls `handleCreateCustomer`,
`handleCreateEnvironment` and `handleUpsertLicence` — the same route
handlers an operator would call by hand — rather than writing its own
inserts. A failure in any step returns that step's own error
unchanged, so "that customer id is already taken" surfaces as a real
409 with a real message rather than a generic provisioning failure.
Tested directly, including that a failed provision leaves the signup
request untouched and still provisionable.

The customer id is supplied by the operator, never derived from the
company name: `company_name` is free text a stranger typed into a web
form, and decision 0038's schema already says it must never be
treated as an id.

## What actually ends a trial

Setting `valid_to` is not enough, and this is the part worth stating
plainly. `vf-app`'s licence cache fails open at its last known good
state (decision 0003) — deliberately, so an unreachable licence server
never takes a customer down. The consequence: a licence that merely
stops being renewable never stops anything. An expired trial would
keep working indefinitely.

So something has to make the transition happen. `expireOverdueLicences`
sweeps every licence whose `valid_to` has passed and sets it to
`blocked`, with `status_reason: 'expired'`.

`blocked` is the right status rather than deleting the licence or the
environment, because blocking is already read-only, not lights-out
(decision 0003): `/rules/evaluate` and `/rules/compile` return 402,
while everything read-only stays reachable. That is exactly the
intended end-of-trial experience — the sandbox and every piece of
configuration in it survive, and the customer is prompted to pay to
resume real work. Proven end to end: a provisioned trial is active on
day 1, blocked on day 31, and its environment still exists afterwards.

## vf-licence's first scheduled handler

This adds a cron trigger to `vf-licence`, which had none. Hourly
rather than daily: the cost is one indexed query against a small
table, and it bounds how long an expired trial can keep working to an
hour rather than most of a day.

The handler is deliberately thin — all the real logic is
`expireOverdueLicences`, a plain function over the database, so it is
testable without simulating a scheduled event and can be run on
demand if ever needed. Failures are silent, matching `vf-app`'s own
scheduled handler: a sweep that fails once has let nothing through
permanently, since the same overdue rows are still overdue an hour
later.

## A test that was watched to fail, and one that was watched to pass

Two real expiry bugs were introduced deliberately to check the tests
catch them. The boundary case (`<=` becoming `<`, so a licence never
expires exactly at its `valid_to`) was caught correctly.

The other was more instructive: removing the `valid_to IS NOT NULL`
guard did **not** fail its test. The reason is real — SQL's
three-valued logic already excludes those rows, because
`NULL <= '2030-01-01'` evaluates to NULL rather than true. The clause
is defensive, not load-bearing, and the test's implied claim to verify
it was hollow. Rather than delete the test or pretend otherwise, its
comment now states exactly what it does and doesn't prove: the
behaviour (a perpetual licence is never swept) genuinely matters and
is worth checking; the specific clause is not what makes it true.

## Trial parameters, and why they're what they are

- `plan: 'trial'` — `plan` is a free string, not a closed vocabulary,
  so this needed no schema change.
- 30 days, per the described flow.
- `volumeEntitlement: 500` — deliberately generous relative to the
  0-99/month free tier the operator sketched. Volume is reported
  against, never enforced mid-period (Blueprint), so this number
  cannot interrupt anything; a trial that hit a wall mid-evaluation
  would be a worse first experience than one that simply reports what
  it used.

## What's still open

- The Cloudflare API half: the real D1 database, R2 bucket, and Worker
  deployment, plus the account-level credential that work requires.
- Any notification when a trial expires — the sweep changes the status
  and tells nobody. The customer discovers it on their next mutating
  request (a 402); the operator discovers it by looking.
- Converting a sandbox into a paid production environment, and
  migrating configuration between them.
