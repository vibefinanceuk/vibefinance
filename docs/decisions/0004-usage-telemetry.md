# 0004 — Usage telemetry: idempotent by key, frequent-and-on-demand as one capability

Status: settled, 30 August 2026. Implements the `usage_periods` half of
Blueprint build order step 4 ("Subsystem three") — the payment webhook
and `payment_events` remain deferred, per the Blueprint's own words:
"Payments last — the webhook is the easy part."

## The core design choice: report the current period's running totals, always

`workers/vf-app/src/usage.ts`'s `computeCurrentPeriodUsage()` reads
whatever the current calendar month's counts are *right now* — not a
final tally computed once when a period closes. Every push, whether
from the 6-hourly cron or the on-demand endpoint, sends the same shape
of thing: "here's this period so far." Combined with the composite
primary key on `usage_periods` (`customer_id, period_key`), this makes
three separate asks collapse into one mechanism:

- **Idempotent** (Blueprint's own requirement): a retried push or a
  duplicate cron fire just overwrites the same row.
- **More frequent**: pushing more often means the row on vf-licence is
  fresher, nothing else changes.
- **On-demand**: an operator- or product-triggered push right now is
  not a different code path from the cron's push — same function,
  same idempotency guarantee, called from a different trigger.

The alternative considered and rejected: accumulate counts in
application state and push a final total once per period. Rejected
because it would need vf-app to track "have I already reported this
period" somewhere, adds a failure mode (a missed final push loses that
period's data entirely, rather than just being stale until the next
successful push), and doesn't naturally support "on-demand" without
inventing a second, different push path.

## Same cron, but genuinely independent — found live, not designed in from the start

The person's stated preference was "same cron, both jobs fire
together." The first version of `scheduled()` implemented this as one
combined guard: if the licence public key was missing or invalid, nothing
ran, including the usage push — which needs none of that
configuration at all. Caught by a test that expected usage push to
still fire with a broken licence key, before this shipped, not after.

Restructured into two independently-guarded blocks, each resolving its
own `db` and swallowing its own failures: a broken or unconfigured
licence key must not silently stop usage reporting, and a failing
usage push (e.g. vf-licence briefly down) must not stop the licence
refresh either. Both properties are tested directly — deliberately
breaking the independence and confirming the right tests catch it,
per §7's discipline.

## `activeUsers`: null, never fabricated

`vf-app` has no user or authentication concept at all today — nothing
to count. `UsageReport.activeUsers` is typed `number | null` and is
always `null` in practice until that changes. The alternative (`0`)
was rejected because `0` is a specific, false claim ("zero active
users"), whereas `null` honestly says "not measured." The schema and
the API shape are ready for a real value the moment user tracking
exists, without a migration or a payload-shape change then.

## `outcomeCounts`: a free-form object, not a fixed enum

Both `UsageReport.outcomeCounts` and `usage_periods.outcome_counts_json`
are keyed by whatever outcome strings the interpreter actually
produces (`evaluateRuleSet`'s own `outcome` field), not a hardcoded
list. If the interpreter's vocabulary of outcomes ever changes, this
table and type need no migration or code change to keep working.

## Known gap, flagged rather than silently expanded: no authentication

`POST /usage` has no authentication, the same as `POST /customers` and
`POST /licences` before it — not a new gap this bundle introduces, but
worth calling out explicitly here rather than silently adding a third
open endpoint without comment: **usage data has a direct billing
implication** (Blueprint: "invoices_processed... the billing number"),
which `customers` and `licences` data mostly doesn't in the same
immediate way. Anyone who knows a customer's id and vf-licence's URL
can currently report arbitrary usage numbers for them, in either
direction. Not fixed here — this bundle is scoped to the telemetry
mechanism itself — but it's a real reason to prioritize authenticating
`vf-licence`'s endpoints sooner rather than later, ahead of any real
customer being billed off this data.

## What's still deferred

- Idempotent usage push exists; nothing yet reads `usage_periods` back
  out for billing, reporting, or a dashboard. That consumption side is
  unbuilt.
- The payment webhook and `payment_events` — unchanged from
  docs/decisions/0003's own deferral, still waiting on a chosen
  provider.
- Authentication on all three `vf-licence` endpoints, per the gap
  above.
