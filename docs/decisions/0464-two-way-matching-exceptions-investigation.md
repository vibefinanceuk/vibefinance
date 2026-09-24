# 0464 — Two-Way Matching Exceptions: Investigation

**Status: investigated and documented, not built.** This is a design
record, the same kind of deliverable decisions 0184 and 0450 already
were. No migration, no vocabulary change, no route, no screen.

---

## What was asked

*"I think I'd like to tackle PO matching next in the Matching stage...
Please can you investigate 2-way matching exceptions that typical AP
departments need to address? Please can you also investigate how
exceptions are typically resolved."* Alongside five direct questions
about how Matching should be configured in AP Setup: a list of fields
to match on, a tolerance percentage per field, org-wide versus
supplier-specific tolerances, who an exception routes to (AP Team, PO
Buyer, or an AP Matching team), and what rules the existing
infrastructure can already support beyond the one that exists today,
"PO Line Not Matched."

An investigation, explicitly — not a build.

## What was found

**Matching itself already runs**, at header and line level
(`po-matching.ts`, decisions 0081/0370), recomputed fresh every
evaluation, using tolerance that is already supplier-specific
(`supplier.amountTolerancePct`/`quantityTolerancePct`, decision 0209)
— **with no org-wide default**, so a supplier with nothing set today
silently gets exact-match-required rather than a sensible fallback.
Validation already surfaces one combined `po_mismatch` check
(`validation.ts`, decision 0400), but the rule vocabulary only ever
sees one collapsed boolean per line (`po.line_matched`) — a rule
cannot today tell "no order line was ever found to compare against"
apart from "found, but price or quantity disagreed," which is exactly
why "PO Line Not Matched" can only ever be one rule rather than three.

`AP.Match` already exists in the closed permission vocabulary
(`permissions.ts`) and is enforced by no route anywhere — the same
state `AP.Code` was in before decisions 0455/0456 widened specific
routes to accept it. Routing a task to a **team** needs no new
capability at all (`assign_task { team }` already exists, Teams
already has a real screen, decisions 0332/0333); routing to **"the PO
Buyer"** specifically is not buildable today — `purchase_orders.
buyer_party_id` is a party/organisation identifier, not a person, the
same shape of gap Cost-Object Approval Hierarchy (0450) found for a
project code's own origin. The **Matching tab in AP Setup already
exists**, as a placeholder, since decision 0440 — genuinely
greenfield, not a screen deferred by accident.

Research into what typical AP departments actually treat as 2-way
match exceptions and how they resolve them lines up closely with what
this codebase already computes or is close to computing — no PO/
invalid PO reference, a PO line that can't be found, price variance,
quantity variance (usually over-billing), a unit-of-measure mismatch
(today silently skipped rather than surfaced), and a fully-consumed
PO. Resolution splits by who owns the discrepancy: price to AP/a
matching team, quantity and PO-side problems to the buyer/procurement
— a real organisational pattern this codebase's own `AP.Match`-vs-
(not-yet-real)-PO-Buyer split already anticipated without building
either side.

Full findings, the direct answers to all five of the operator's own
questions, and six explicitly open questions to decide before any of
it is built are in `docs/design/two-way-matching-exceptions.md`.

## What was built

- `docs/design/two-way-matching-exceptions.md` — the investigation:
  what already exists (checked directly against the code, not
  assumed), the exception taxonomy and resolution pattern research
  with sources, direct answers to each of the operator's own five
  configuration questions, a proposed vocabulary split
  (`po.line_reference_found`/`po.line_price_matched`/
  `po.line_quantity_matched`, generalizing `po.line_matched` rather
  than replacing it, the same "generalized, not rewritten" treatment
  0452 gave the approval resolver), and six questions named as
  genuinely open.

## What was not built

No `org_matching_config` (or equivalent) table, no new derived-field
vocabulary entries, no change to `po-matching.ts` or `validation.ts`,
no route, and `ap-setup.js`'s Matching tab is byte-for-byte unchanged
— still decision 0440's own placeholder. No mock-up, since none was
asked for this time; the design document says a mock-up is a natural
next step once the open questions have answers.

## Still to do, operator side

Read `docs/design/two-way-matching-exceptions.md` and answer the six
open questions it names — in particular whether quantity matching
should be toggleable, whether an org-wide default tolerance is wanted
now regardless of this feature, and whether "PO Buyer" as a real
routing target is worth building the schema for in a first version, or
a named team is enough to start. There is nothing to deploy or apply —
this decision touches no running code and no migration.
