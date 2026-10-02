# 0599: Deleting a Destination that has never sent

**Status: built and tested locally, not yet pushed or deployed.** `vf-app`,
`vf-ui`, and **`vf-licence` migration `0245`** (strings). No `vf-app`
migration.

## What was asked

Dan, 2 October 2026, after 0597 gave Destinations Retire: *"Can we delete
destinations that have never sent?"*

## What was decided

An HTTPS out Destination that has **never sent, nor tried to**, may be
**deleted**: one made by mistake or to try something leaves nothing worth
keeping. It goes entirely, with its settings, secrets, outbound mapping
(0591) and any invoices queued or set aside for it but never attempted.

Anything that is history is kept, so these are refused in words, with
Retire (0597) as the way:

| Refused when | Reason |
|---|---|
| it has a route message, or a delivery attempted, delivered, failed or retrying | `has_sent` |
| a rule sent invoices to it (`destination_requests`, 0588) | `rule_requested` |
| a rule in force sends invoices to it, naming the rules | `rule_sends_here` |
| an alert watches it (0559) | `has_alerts` |
| it is the ERP CSV file | `not_https_out` |

A connector submitted from it (0595) is not touched: the version in the
control plane carries its own copy of the definition.

### On screen

Process routes now knows which Destinations have never sent (`neverSent`).
Their panel has **Delete** beside Rename and Retire; a pop-out asks first
and says it cannot be undone; a refusal is said in the pop-out. One that
has sent never shows Delete.

`DELETE /route-instances/:id`, under `Admin.Configure`. `vf-ui` passes it
on (0598).

## Verification

- **`vf-app`**, `destination-rename-retire.test.ts`, 2 new tests and the
  router test extended: deleted with its secrets, mapping and set-aside
  deliveries, `neverSent` on the flow, gone after; each refusal (sent, a
  rule's request, a rule in force, an alert, the ERP CSV file); `DELETE`
  through the router.
- **`vf-ui`**, `routes.test.ts`, 1 new test: Delete only when it never
  sent, asked first, and the refusal in words. It fails against the
  interface before this change.
- **Migrations** replay: `vf-licence` 245.
- **Full runs**: `vf-app` 3422, of which 3419 pass (the two known failures, 0511, and the known router timeout in `index.test.ts`, which passes alone); `vf-ui` browser 1447, of which 1446 pass
  (the known `typography.test.ts` 10px gap), worker 111 of 111;
  `vf-licence` 342 of 342.
