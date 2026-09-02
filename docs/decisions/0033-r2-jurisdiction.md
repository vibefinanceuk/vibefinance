# 0033 — R2 document retention: jurisdiction / data residency

Status: settled, 2 September 2026. Extends decision 0013's own "one
R2 bucket per customer" design — nothing in 0013 has been built yet;
this decision adds the one piece of it that's genuinely buildable and
testable on its own, ahead of the rest.

## The real, current state, confirmed directly rather than assumed

Prompted by a real, practical question: does Cloudflare R2 support
storing data in specific countries, since some jurisdictions (Saudi
Arabia was the example raised) legally require in-country document
storage? Checked against Cloudflare's own current R2 documentation
(dated 19 August 2026) before answering, not from memory.

R2 has two genuinely different location mechanisms, easy to conflate:

- **Location Hints** (`wnam`, `enam`, `weur`, `eeur`, `apac`, `oc`) —
  Cloudflare's own docs are explicit that these are *"a best effort
  and not a guarantee,"* meant for performance, not compliance.
- **Jurisdictional Restrictions** — a genuine, hard guarantee that
  *"objects in a bucket are stored within a specific jurisdiction."*
  Currently supports exactly three: `eu` (European Union), `fedramp`
  (US FedRAMP), `us` (United States).

A separate, easy-to-conflate finding worth stating plainly: Cloudflare
**Regional Services** does support Saudi Arabia, but that governs
where network traffic is *inspected* (a WAF/edge-processing concern),
not where a file is actually *stored at rest*. Treating that as
equivalent to an R2 storage guarantee would have been a real,
substantive mistake for a document-retention design specifically —
caught and ruled out before it could become one.

## Saudi Arabia — and any other country R2 doesn't cover — is a real, stated, unsolved gap

Not silently omitted: a customer needing a genuine in-Kingdom (or any
other R2-unsupported jurisdiction) storage guarantee cannot be
satisfied by R2 alone today. Recorded here as a known limitation of
the whole approach, explicitly deferred rather than worked around with
something less than a real guarantee, per the person's own framing —
"a nice to have at this point."

## What's actually built here — real, and deliberately narrow

`org_profiles` (decision 0009's own per-customer configuration table,
already home to `cius_profile`) gains `r2_jurisdiction`, closed to
`'eu'` / `'fedramp'` / `'us'`, or `NULL` for unspecified/automatic —
R2's own default, not a fourth jurisdiction choice. The natural home:
decision 0013 itself already anticipated `org_profiles` as where
R2-related per-customer configuration (like the retention period)
would eventually live.

Deliberately scoped to just this column, not the rest of R2 retention
— genuine R2 bucket provisioning isn't something this environment can
create or test, so it stays exactly where decision 0013 left it:
design-only. This piece is different — a real, testable schema
addition, buildable independently of everything still unbuilt around
it, the same way `intake_channels`/`cost_centres` became real tables
well before the larger systems they support were fully built out.

## Enforced at two real, distinct layers, not just documented

`isKnownR2Jurisdiction` refuses an unsupported value at the
application layer with a clean `422`. The database's own `CHECK`
constraint refuses it unconditionally, regardless of caller. Proven
directly, and the proof revealed something worth keeping: with the
app-level check deliberately removed, attempting to set `'ksa'` didn't
just skip validation — it threw an **unhandled database exception**
rather than a clean response. That's genuine confirmation of why both
layers matter: the `CHECK` constraint is the unconditional safety net
(nothing invalid is ever stored, either way), but the app-level check
is what turns a rejection into an intentional, clean error rather than
a crash.

## Deliberately not enforced as immutable — yet

Cloudflare's own docs state plainly: once a real R2 bucket is created,
its jurisdiction cannot be changed. This column doesn't enforce that
today, because nothing yet actually creates a real bucket against
it — there is no real bucket-creation event to key an immutability
check against. A genuine, named requirement for whichever future
bundle actually builds bucket creation, not solved here.

## What's still open

- Saudi Arabia, and any other R2-unsupported jurisdiction — a real,
  explicitly unsolved gap, not this decision's to close.
- The rest of decision 0013's own design — bucket creation itself,
  the `invoice_headers`/`invoice_runs` reference column, lifecycle
  rules — all remain entirely unbuilt.
- Immutability enforcement, once real bucket creation exists to key
  it against.
