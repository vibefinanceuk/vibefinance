# 0135 — The Cloudflare half of provisioning

**Status: three steps of five built** —
`migrations/provision_infrastructure.py`. The D1 database, the migration
chain and the R2 bucket. **The Worker deploy stops deliberately**, and
the two steps after it are unwritten rather than written and never run.

---

## What is missing

Provisioning is eight steps and does five.

| Step | Built |
| --- | --- |
| Create the D1 database | **No** |
| Apply the migration chain to it | **No** |
| Create the R2 bucket | **No** |
| Generate the environment's API key | Yes |
| Create the customer and environment rows | Yes |
| Issue a trial licence | Yes |
| Deploy a `vf-app` Worker with per-customer bindings | **No** |
| Record the result | Yes |

And since decision 0126, a ninth: **create the Email Routing rule** for
each email source's address.

**Decision 0039 was right to split here.** The control-plane half needs
no credentials and is testable end to end; the Cloudflare half needs an
account-level write token whose blast radius *"deserves its own design
conversation"*. This is that conversation.

---

## The token is the whole problem

The API calls are five HTTP requests. **The credential that makes them
is the most dangerous thing this system would hold.**

A token that can create D1 databases and deploy Workers can also
**delete every customer's database** and **replace any Worker with
anything**. Decision 0001 already named this cost — *"the account-scoped
token blast radius is a cost worth naming, not defaulting into"* —
about a lesser use.

### So it does not live in `vf-licence`

`vf-licence` is reachable from the internet, holds an admin key, and
serves every customer. Giving it account-level write means **a flaw in
any route becomes total account compromise**.

Nothing else in this system holds a credential of that reach. The
signing key is scoped to licence tokens; a per-customer API key reaches
one instance.

### The operator runs it, with a token they hold

**A script, not a route.** `provision_infrastructure.py`, run by the
operator after approving a request, with the token from their own
environment — the same shape as `apply_migrations.py`, which already
does the genuinely dangerous part of the migration story and is trusted
because a person runs it deliberately.

This costs automation. **Decision 0038's whole point is that approval is
a human checkpoint** — *"speak with the customer, sell them on the
technology, guide them through onboarding"* — so a person is already in
this loop. Provisioning being one more deliberate act is not friction
being added; it is friction already there.

**And it is reversible.** If the fleet grows to where hand-running is
untenable, a route can be added later with a token scoped by then to
what it actually needs. The reverse — taking capability away from a
Worker once something depends on it — is much harder.

---

## What happens when step three of five fails

The question decision 0039 named and did not answer.

**A customer with a database, no bucket, and a licence saying they are
live** is worse than one with nothing, because every fleet tool now
reads them as real.

### Ordered so that failure is visible

The steps are ordered **cheapest to undo first**, and the control-plane
rows are written **last**:

1. Create the D1 database.
2. Apply the migration chain.
3. Create the R2 bucket.
4. Deploy the Worker.
5. Create Email Routing rules for any configured addresses.
6. **Then** record `instance_url`, clear the placeholder, and set
   `infrastructureProvisioned: true`.

A failure before step 6 leaves the customer exactly as the control-plane
half left them: **`not-yet-deployed.invalid` and
`infrastructureProvisioned: false`**, which decision 0011 already says a
fleet tool must read as *"not deployable yet"*.

**The half-built infrastructure is orphaned, not hidden.** A database
with no Worker costs nothing and is visible in the Cloudflare dashboard.
Deleting it automatically would mean the failure path holds delete
authority, which is the one thing worth not automating.

### And it is re-runnable

Each step checks whether its object already exists before creating it,
so a second run after a failure continues rather than duplicating.
`apply_migrations.py` is already idempotent, which is the hardest of the
five to make so.

---

## What it unblocks

Three records currently end waiting on this:

- **0117** — onboarding cannot provision anybody, so the administrator
  who is *"the requesting user"* has nowhere to be created.
- **0126** — an address is reserved and **nothing delivers to it**.
- **0128** — the sources screen says *"Not receiving yet"* and will keep
  saying it.

It is also what ends *"every customer provisioned by hand"*, which is
why there is one.

---

## What the script does, and where it stops

Three steps run: **create the D1 database**, **apply the migration
chain**, **create the R2 bucket**. Each checks whether its object
already exists, so a second run after a failure continues rather than
duplicating.

The migration chain is **delegated to `apply_migrations.py`**, not
reimplemented. Decision 0011 calls it the genuinely hard part — it
replays against a throwaway copy first, checks every assertion, and
keeps idempotent bookkeeping — and a second implementation would be a
second thing to get right.

**The Worker deploy raises rather than warns.** A script reporting
success having skipped the step that makes an instance reachable would
be worse than one that stops. Its message says everything before it is
safe to re-run, which is what somebody needs to know at six o'clock with
half a customer in their account.

### The dry run was not credential-free, at first

It is promised to touch nothing and need no token. It did not:
`apply_migrations.py --dry-run` **still reaches the network** to ask
which migrations are recorded as applied — reasonable for a database
that exists, wrong for one that has not been created.

**Found by running it.** The dry run stopped asking for a token, which
is exactly the failure a person would hit on their first use.

It now lists the chain from disk instead, and a test asserts no token is
demanded.

---

## Deliberately not decided here

- **Whether the Worker is deployed from a generated `wrangler.jsonc` or
  a maintained one per customer.** Decision 0011 records this as the
  hard part of `deploy-all` and it is the same problem here.
- **How a customer's Worker is updated afterwards.** Provisioning
  deploys it once; every subsequent deploy is still per-customer and by
  hand.
- **Whether the token is scoped per resource type.** Cloudflare permits
  narrower tokens than "account write", and the narrowest set that
  performs these five steps has not been established.
- **What happens to Email Routing rules when a customer leaves.** They
  outlive the Worker they point at, and mail would arrive at nothing.
