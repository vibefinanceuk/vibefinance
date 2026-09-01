# 0024 — Intake channels: a real, per-process managed list

Status: settled, 1 September 2026. Decision 0023 gave intake channels
free-string values with real example descriptions, but nothing a
customer could actually manage. A direct follow-up: "the ability to
add new Intake channels should be flexible" meant something more
specific than "the string is unconstrained" — a genuine,
customer-managed list, the same shape Teams already has, not baked
into code.

## Scoped per process, not per vocabulary — a real design fork resolved before building

AP and AR both use the invoice vocabulary (decision 0021), but need
genuinely different channel lists — Email/Mailroom for AP,
Billing System A/B for AR. Tagging channels by vocabulary
(`'invoice'`/`'expense'`) would have conflated the two. A `process`
(decision 0018, already real, already customer-authored) is the
precise entity this belongs to instead — each process gets its own
channel list, and the same channel name can exist under two different
processes with no conflict at all (`"Email"` under both an AP process
and an Expense process, say).

## Schema and CRUD, the exact shape Teams already established

`intake_channels` (id, process_id, name), unique per `(process_id,
name)`, mirroring `org_teams`'s own shape from decision 0016 exactly.
`POST /processes/:id/intake-channels` is unauthenticated, matching
every other `/processes/*` definition-time route — this is
administrative setup, not gated product usage. Proven, not assumed:
a customer building up a real per-process list — the exact AP and AR
example values from the original design conversation — was tested
directly, confirming 5 AP channels and 4 AR channels coexist
correctly with no cross-contamination.

The actual point of this feature, proven specifically: adding a
channel nobody anticipated when the process was first set up — no
code change, no deployment, just an ordinary API call — is confirmed
both at the unit level and through the real router, and the routing
itself was confirmed genuinely reachable by deliberately disabling it
and watching the test fail with a `404` before restoring it.

## Deliberately not wired into rule validation — the same declined scope as decision 0023

This is a real, manageable list — but it does not make
`mandate.channel`/`intake.channel` values enforced. Decision 0023
explicitly declined closed-value enforcement (validating that a
condition's *value* belongs to a real set, not just its field name);
this decision doesn't reopen that question. A rule can still
reference any string as a channel value regardless of what's in this
table. Whether this table should ever become the *source* of that
enforcement is a real, separate question, not decided here.

## What's still open

- Closed-value enforcement, again — decision 0023's own still-open
  item, now with a real, concrete candidate source of truth (this
  table) if it's ever built.
- No `GET`/list route — matches the "raw API for now" precedent
  elsewhere in this project, not an oversight.
- No `DELETE` route — same precedent as `org_team_members`.
- The document ingestion path itself remains unbuilt (decisions
  0013/0015/0019) — intake channels record *which* channel something
  arrived through; nothing yet actually receives a raw document
  through any of them.
