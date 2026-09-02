# 0037 — CUSTOMER_ID and ENVIRONMENT_ID are two different things

Status: settled, 2 September 2026. The `vf-app` half of decision
0036 — required for `vf-app` to keep working at all against the
re-keyed control plane, and the point at which a real, previously
hidden ambiguity in `CUSTOMER_ID` became visible.

## The obvious fix would have been wrong

Decision 0036 re-keyed `vf-licence`'s licence and usage endpoints from
customer id to environment id. The apparent `vf-app` fix was a
one-line config change: set `CUSTOMER_ID` to `"Acme-production"`.

Checking every real use of `CUSTOMER_ID` before making that change —
rather than assuming its two call sites were the only ones — showed it
was quietly doing two genuinely different jobs:

1. **Entitlement and reporting identity**: which deployment is
   fetching its licence token and pushing its usage. After 0036 this
   must be an environment id.
2. **Storage identity**: the R2 object key prefix,
   `{customer}/{year}/{invoice_id}.{ext}` (decision 0013), via
   `document-route.ts`.

Changing the single var would have silently started writing every new
document under a different R2 prefix from every existing one — a real,
quiet inconsistency in stored data that nothing would have surfaced as
an error.

## The split, and why the key prefix stays customer-scoped

Two separate vars now:

- `CUSTOMER_ID` — unchanged (`"Acme"`), matching `customers.id`. Used
  only for the R2 key prefix.
- `ENVIRONMENT_ID` — new (`"Acme-production"`), matching
  `environments.id`. Used for the licence-token fetch and the usage
  push, in both the `fetch()` routes and the `scheduled()` handler.

The R2 prefix stays customer-scoped deliberately: an R2 bucket is
already per-deployment (a customer's sandbox and production
environments each get their own bucket, decision 0013), so the key has
nothing to gain from re-encoding which environment wrote it, and a
document's own key stays stable and meaningful on its own terms.

## One rename that genuinely had to happen, and one that genuinely didn't

`UsageReport.customerId` -> `UsageReport.environmentId`
(`shared/usage/types.ts`). This one is not cosmetic: the type is
serialised directly as the `POST /usage` request body, so the field
name is a real wire contract with `vf-licence`, which after 0036
expects `environmentId` and would reject the old shape with a 400.

`LicenceClaims.customerId` was deliberately left alone, consistent
with decision 0036's own reasoning: it is only ever *read* by `vf-app`
after verifying a token `vf-licence` signed, never sent, so its name
is not a wire contract in the same way. Its value is now an
environment id. Worth stating plainly because a bulk rename during
this work did briefly change it in the tests, and the resulting
failure was a genuinely useful one: the token's claims-shape check
rejected the unexpected field, nothing cached, and the licence state
came back `known: false` — a real demonstration that the claims-shape
validation from decision 0003 does its job.

## What the operator must do, and why it can't be skipped

`workers/vf-app/wrangler.jsonc` gains `ENVIRONMENT_ID`. Until this is
deployed, `vf-app`'s scheduled licence refresh and usage push both
fail against the re-keyed `vf-licence` — the licence cache would sit
on its last known good state (fail-open, decision 0003, so nothing
breaks for the customer immediately) and usage rows would silently
stop updating. Not an outage, but a real, quiet degradation worth
closing promptly rather than discovering later.

For any future customer, both vars must be set: `CUSTOMER_ID` to their
`customers.id`, `ENVIRONMENT_ID` to the specific
`environments.id` that deployment represents.
