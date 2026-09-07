# 0136 — The manifest is the config

**Status: the manifest is complete and readable.**
`GET /environments/:id/config` returns every binding a deploy needs, and
`r2_bucket_name` is the column it was missing. **The deploy step itself
is still unwritten** — `provision_infrastructure.py` stops at it.

Answers the question decision 0135 left open — generated `wrangler.jsonc` or one maintained per customer — with
a third option that is better than either.

---

## The question, and why both answers were poor

A Worker deploy needs a config naming that customer's D1 id, their R2
bucket, their `CUSTOMER_ID` and `ENVIRONMENT_ID`. Decision 0011 records
this as the hard part of `deploy-all`, and decision 0135 left it open.

**Generated at deploy time**: nothing to maintain, every customer
identical by construction — and the config a customer runs exists only
for the seconds of the deploy, so nobody can read what is deployed.

**Maintained per customer in the repository**: reviewable and diffable —
and a file per customer to keep in step with the control plane, which is
**two places holding the same facts**, the thing this project finds most
often.

### The operator's question

> Is there any way this could be stored in the licence server, without
> physically having to update files to provision?

**It already is.** `environments` carries `worker_name`,
`d1_database_name` and `d1_database_id`, and `handleSetFleetMetadata`
exists precisely so the control plane records each customer's deployment
details. Document 3 describes it as *"a real fleet manifest — a place
recording which customers exist and their own deployment-specific
details"*, and names `deploy-all` as what it was waiting for.

**The config is data the control plane already holds.** It was being
treated as a file because nothing had asked the manifest for it.

---

## The shape

1. The script creates the D1 database and reads back its id.
2. It **records the id in `vf-licence`** — the manifest, not a file.
3. It asks `vf-licence` for the environment's config.
4. It writes a `wrangler.jsonc` **into a temporary directory** and
   deploys from it.

**No file per customer anywhere.** The manifest is the source of truth
rather than a copy of one, and a config that disagrees with it is
impossible because there is only one.

And `deploy-all` becomes a **loop**, not a design problem: read every
environment, generate, deploy. Decision 0011 listed it as blocked on
exactly this.

---

## Three things this must not become

### Secrets do not go in it

**This project has already made that mistake.** Decision 0009 records a
private signing key sitting in a customer's `wrangler.jsonc` as a plain
`var` — in git history and Cloudflare's deployment logs — caught only
because a reviewer noticed `key_ops: ["sign"]` where a public key should
read `["verify"]`.

The manifest holds **non-secret bindings only**. Secrets are still set
by `wrangler secret put`, by the operator, and never travel through the
control plane.

Worth stating as a rule rather than a habit, because the manifest will
look like a natural place to put one.

### It becomes security-relevant

`environments` currently records names. Once a deploy **reads** it, a
change to `d1_database_id` points a customer's Worker at another
customer's database — the isolation decision 0001 exists for, undone by
a row.

Not a new single point of failure: an attacker would need the deploy
token too, which is the operator's and never in a Worker (decision
0135). But the manifest stops being a record and starts being an
instruction, and that deserves saying out loud.

**A deploy should verify what it is about to do**: an environment whose
`d1_database_id` does not match a database named `{environment_id}` is a
mismatch worth refusing rather than deploying.

> **Built after demonstrating the need for it.** Setting Acme's
> `r2_bucket_name` by hand, the value was **guessed wrong** —
> `vf-documents-poc` where the Worker is bound to `acme-documents`.
> Nothing objected, and a deploy reading that manifest would have
> produced a Worker bound to a bucket that does not exist.
>
> The step now runs **before** the deploy rather than after, and reports
> **every** disagreement at once: being told about a wrong bucket,
> fixing it, and then being told about a wrong database id is two round
> trips for one problem.
>
> It reads no manifest yet, and **says so rather than reporting a clean
> verification of an empty config**. Doing so needs an admin key for
> `vf-licence` alongside the Cloudflare token, and two credentials in
> one script deserves the thought decision 0135 gave the first.

### And the generated config is recorded

Written to `docs/operations/` after a successful deploy — not as the
source, but as **an artefact of what was deployed**.

The first option's real cost was that nobody could read what a customer
runs. Keeping the output answers that without making it authoritative.

---

## Built

**`r2_bucket_name`**, and a route that returns the whole config with
**`deployable`** alongside it. A caller reading a config with a null
`d1_database_id` and deploying anyway would produce a Worker bound to
nothing — and when it is not deployable, the response **names what is
missing**, because *"the config is incomplete"* sends somebody looking.

**A test asserts the response carries no secret**, checking for
`apikey`, `secret`, `private`, `hash` and `password` in the serialised
body. Decision 0009's incident is the reason that test exists rather
than a comment saying not to.

**And two standing invariants the manifest did not need when it held
only names:** no two environments may share a bucket, and none may share
a `d1_database_id`. Once a deploy reads this, a duplicate is one
customer's Worker reading another's invoices.

---

## All five steps now run

`provision_infrastructure.py` creates the database, applies the chain,
creates the bucket, **records what it created in the manifest**, reads
the config back, verifies it, deploys from a generated
`wrangler.jsonc`, and records the real URL last.

**The script holds a second credential**, and the reasoning is worth
stating because decision 0135 gave the first real thought.

Recording ids by hand produced a **wrong bucket name within an hour** of
the column existing. Having the thing that created an id record it
removes that error class rather than checking for it afterwards. And an
admin key is **strictly less dangerous than the Cloudflare token already
there**: anybody holding an account-level token can deploy a Worker that
reads whatever they like.

**The generated config is written to `docs/operations/`** after a
successful deploy — not as the source, but as an artefact. Generating at
deploy time otherwise means nobody can read what a customer runs.

### What the script deliberately does not do

**Secrets.** Decision 0009's incident is why the generated config
carries bindings and non-secret vars only, and the script ends by saying
so.

**Email Routing rules.** They are **per source, not per customer**
(decision 0126) — a source gets its address whenever somebody creates
one, which may be long after provisioning. Running them once here and
never again would be wrong.

---

## Deliberately not decided here

- **Which commit gets deployed.** The config comes from the manifest;
  the *code* comes from a checkout, and nothing records which one a
  customer is running — decision 0011 names this as unsolved and
  `DEPLOYED.md` does it by hand.
- **Whether a customer can be deployed to a version other than the
  latest.** A loop over the fleet deploys one commit to everybody, and
  staged rollout is a different question.
- **What happens when a deploy half-succeeds across the fleet.**
  Decision 0011 raises the same for `migrate-all` — *"what happens when
  customer #7 of 20 fails partway through"* — and it is still
  unanswered.
