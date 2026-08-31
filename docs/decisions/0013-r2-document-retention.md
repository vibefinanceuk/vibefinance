# 0013 — R2 document retention: physical files, not runtime data

Status: settled, 31 August 2026. First sketched as Section 6 of the
"VibeFinance Design Document — Scaffolding," which never had a
corresponding entry in this directory — every other real design
decision in this project gets a numbered file here; this formalizes
that one, with two real corrections found by reviewing it properly
rather than just restating it.

**Nothing here is built.** This is a design record for a future
implementation bundle, not a description of running code.

## The intended split, confirmed

D1 holds runtime data: extracted invoice facts, compiled rules,
evaluation results, a *reference* to a stored document — never the
document's own bytes. R2 holds the physical files themselves: the
original PDF, JPEG, or XML a customer's invoice actually arrived as.

This isn't an arbitrary division. D1's per-database storage ceiling is
10 GB, a hard cap that cannot be increased on request (confirmed
against Cloudflare's own current D1 limits documentation) — runtime
data stays comfortably within that regardless of volume, since it's
small, structured, and query-shaped. Physical documents accumulate
indefinitely over a multi-year retention period and would fill that
ceiling fast if stored there directly. R2 objects support up to 5 TiB
each, with unlimited objects and storage per bucket — built for
exactly the kind of unbounded, append-only growth years of retained
documents represent. "D1 holds a reference, not the document" is the
one mechanism that makes this split real rather than aspirational.

## Correction 1: key by `invoice_id`, never `invoice_run_id`

The original sketch proposed
`{customer}/{year}/{invoice_run_id}.{ext}` as the R2 object key.
Checked against the real schema before finalizing this: `invoice_runs`
has its own `id` (the run) and a separate, indexed `invoice_id` column
— and an invoice can genuinely have more than one run against it. The
append-only execution log exists specifically so a rule change can be
tested against historical invoices, and reprocessing is a normal,
expected pattern, not an edge case.

Keying the retained document by `invoice_run_id` would mean
re-uploading and re-storing the identical physical file every time the
same invoice is re-evaluated — the exact duplication this design
exists to avoid. **The key must be `{customer}/{year}/{invoice_id}.{ext}`.**
`invoice_runs` references the one stored document via its
`invoice_id`; it never causes a new copy to be written. Retention is a
property of the document, not of any individual evaluation attempt
against it.

## Correction 2 (recorded, not acted on): the real fleet ceiling was never R2's own limits

The original sketch justified "one R2 bucket per customer" by citing
R2's own account-level bucket limit (1,000,000, confirmed against
Cloudflare's docs) as comfortable headroom. True, but beside the
point: this whole architecture is one dedicated `vf-app` Worker per
customer, and Cloudflare accounts cap out at 500 Workers on the paid
plan — a ceiling `docs/decisions/0001-worker-split-and-tenant-
resolution.md` already found and explicitly flagged to fold into
future planning, re-confirmed as still current here. The fleet is
bounded by the Worker count long before R2's own bucket limit could
ever matter.

Decided explicitly: not a blocker, and not addressed by this decision
either. Same stance decision 0001 already took on this exact number —
deferred deliberately, revisited "in the fortunate event" the fleet
actually approaches it, at which point the already-identified
alternative (per-customer Cloudflare accounts, not just per-customer
Workers within one shared account) is the lever to pull. Recorded here
so a future implementation of R2 retention doesn't need to re-discover
or re-litigate this; it inherits the same deferral, on purpose.

## Design, restated with both corrections folded in

- **One R2 bucket per customer.** Structural data sovereignty, the
  same reasoning as the per-customer D1 databases (decision 0011) —
  not chosen because of headroom (see Correction 2 above), chosen
  because it's the same isolation boundary this whole system already
  applies everywhere else.
- **D1 holds a reference, not the document.** `invoice_runs` gains a
  column referencing the R2 object key for that invoice's source
  document.
- **Key structure: `{customer}/{year}/{invoice_id}.{ext}`** — never
  `invoice_run_id`. One physical file per invoice, referenced by every
  run against it, stored exactly once.
- **Lifecycle rules for expiry** via R2's own native object lifecycle
  configuration, not an application-level cron job — Cloudflare's
  platform becomes responsible for actually deleting an object once
  its retention period has elapsed.
- **Retention period stays deliberately unspecified in code.**
  Statutory retention periods vary by jurisdiction, are set in
  national law, and change over time; asserting a number here without
  qualified legal review would be a real liability for a product whose
  entire purpose is regulatory compliance. The lifecycle rule is a
  configuration value, set per customer (or per CIUS profile — see
  `org_profiles`, decision 0009) once the correct period for that
  customer's actual jurisdiction has been confirmed with counsel —
  never a hardcoded constant.

## What building this would actually require

- A D1 migration adding an R2 object-key reference to `invoice_runs`.
- An R2 bucket binding added to each customer's own `wrangler.jsonc`,
  following the same per-customer-vars pattern already used for D1,
  the signing key, and locale (decisions 0011, 0012).
- A decision on who actually uploads the source document to R2 — this
  system does not currently receive raw invoice files at all, only
  extracted facts, so this depends on a not-yet-built ingestion path
  upstream of the interpreter.
- Real, jurisdiction-specific retention periods, confirmed with
  counsel, before any lifecycle rule is configured.

## What's still open

- Everything in "what building this would require" above — none of it
  is built.
- The ingestion path — nothing upstream of the interpreter currently
  handles a raw document at all, so R2 retention has no real input to
  attach to yet even once the storage side exists.
- The 500-Worker fleet ceiling — deliberately deferred, not this
  decision's problem to solve, tracked here so it isn't lost.
