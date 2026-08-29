# 0001 — Two Workers now; tenant resolution behind one function

Status: settled, 29 August 2026 (extends the Blueprint, "What sits where"
and "Settled · one Worker per customer, a binding per region").

## The line that's certain

Control plane versus application is a trust boundary, not a scaling one.
The licence and telemetry server holds cross-customer data, must be
unreachable from any customer's bindings, fails open when unreachable,
and deploys on a different cadence from the product. Two Workers from
day one:

- `vf-app` — the product: invoice model, interpreter, everything a
  customer's data touches.
- `vf-licence` — the control plane: customers, licences, usage counts.
  No customer content ever crosses into it. See Blueprint §"Subsystem
  three" for the passive-licensing contract this Worker implements.

## The question this does not answer yet

Per-tenant database binding. Checked against the current state of D1:
bindings are static in Worker configuration, with no runtime way to
select a database by id (cloudflare/workerd#3564 — a Cloudflare
engineer's suggested workaround is updating the Worker's config through
the API; no ETA on a runtime-select mechanism). So "one codebase,
per-customer database" is not a single ordinary deployment. Three routes,
kept open rather than chosen between now:

1. **One Worker deployment per customer**, each with its own binding.
   Works today. Fails at scale of *operation*, not the 500-Worker cap:
   every version is N deploys by one person, long before the cap bites.
2. **D1 REST API**, database id resolved per request. One deployment,
   unlimited customers — at the cost of binding latency and an
   account-scoped token living in the Worker, which widens the blast
   radius of a routing bug to every customer's database at once. That
   cuts against the product's actual selling point (per-customer
   isolation).
3. **Workers for Platforms.** A dispatcher Worker routes to a per-tenant
   user Worker; each user Worker's bindings are set at upload time via
   the API. Onboarding becomes an API call, not a deploy — the property
   that matters most for a one-person operation.

## The discipline that keeps all three open

Nothing may reference `env.DB` (or any tenant-scoped binding) directly.
Every query site goes through:

```ts
resolveTenant(request, env) -> { db, kv, ... }
```

in `shared/tenant.ts`. Reaching for the binding directly is a silent
choice of route 1 — it's the only shape where the handle is a bare
global. Behind `resolveTenant`, the same application code runs unchanged
whichever route is picked later: bound at deploy, fetched over the REST
API, or dispatched by Workers for Platforms.

Enforced by a lint rule (`no-restricted-properties` on `env.DB`) rather
than left as a convention — see §7 of the change-and-promotion model:
"advice does not hold a line, a check does."

## Two facts to fold into the Blueprint's numeric ceilings

- D1 has an account-level ceiling of **1 TB total storage**, alongside
  the existing 50,000-database and 10 GB-per-database limits.
  Increasable on request, but it confirms the existing plan: D1 holds
  structured invoice data, R2 holds everything heavy.
- Both the 1 TB figure and the 500-Worker cap are **account limits**.
  This strengthens the case — already on the table for platform-standard
  reasons — for a deployment shape where a customer's instance lives in
  their own Cloudflare account: the caps reset per customer and stop
  being a shared resource at all.

## Deferred, on purpose

The adapter layer (ERP connectors, Peppol access point egress) becomes a
third Worker the day a slow third party starts affecting request latency
for everything else — not before. Different failure domain, third-party
retries, long timeouts; no reason to carry that cost until it's real.

## Alternatives considered and rejected here

Recorded so a future session does not re-open them without new
information:

| route | why not, for now |
|---|---|
| Single Worker for app + licence | Trust boundary violated on day one; a bug in the product could reach cross-customer licence data. |
| Per-tenant Worker deployment (route 1 above) | Not rejected — deferred. Operationally too expensive at any real customer count, but the discipline above keeps it choosable later without a rewrite. |
| D1 REST API per request (route 2 above) | Not rejected — deferred. Live option if latency is provably acceptable, but the account-scoped token blast radius is a cost worth naming, not defaulting into. |
