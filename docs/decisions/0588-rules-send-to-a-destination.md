# 0588: A rule can send an invoice to a Destination

**Status: built and tested locally, not yet pushed or deployed.** It
touches `shared`, `vf-app` and `vf-licence`, and needs **`vf-app`
migration `0121`** and **`vf-licence` migration `0234`**, which it
shares with 0587.

## What was asked

With business units on Destinations (0587), Dan wanted routing *"also
influenced by rules activated in the Payment-eligible stage"*. When I
asked whether a rule should replace or add to the business unit
routing, he answered: *add to it*.

## What was decided

**A new rule action, `send_to_destination`**, with params
`{ "destination": "<id>" }`. It also sends the invoice to that
Destination once it is payment-eligible, as well as to those its
business unit chooses.

**Compiling:**

- the compiler is shown **REAL DESTINATIONS**: the rule set's process's
  Destinations that are not retired, by id and name, or every
  Destination when the rule set is on no stage;
- it is told to resolve "go to Oracle Projects" to the id by meaning, or
  refuse;
- after compiling, a `send_to_destination` naming no such Destination is
  **refused**, naming the ones it could, so a rule never silently fails
  to send.

**When the rule fires**, at a stage visit, the workflow engine records
`destination_requests` (invoice, Destination, rule; migration `0121`).
It only records Destinations of the invoice's own process; any other is
ignored, as a second guard.

**The Destination takes it**:

- `destinationPayable` for HTTPS out, and `eligibleInvoiceIds` for the
  ERP CSV file, add requested invoices to those their units cover;
- **it is still only sent once payment-eligible**, and only once,
  whatever its unit;
- a requested invoice is never taken away by the units.

The action is labelled "Also send to a destination" (`vf-licence`
`0234`).

## Not built

- **Holding an invoice back from every Destination by rule.** Dan's
  answers made routing additive and treated "not routed" as a case that
  should not happen, so there is no hold. `hold_until` remains for
  holding an invoice in the process itself.

## Verification

- **`vf-app`**:
  - `destination-requests.test.ts`, 2 tests:
    - a firing rule naming two Destinations of its process, one of
      another process and an unknown one records only the two; a rule
      not firing records nothing. Both fail against the engine before
      this change;
    - with HTTPS out and the ERP CSV file both covering the UK, the rule
      adds a German invoice to both, and another German invoice goes to
      neither.
  - `compile-route.test.ts`, 2 new tests: the prompt lists the process's
    Destinations, and not another process's; a send to another process's
    Destination, or to a name, is refused, naming those it could be.
- **`shared`**, `prompt.test.ts`, 1 new test: REAL DESTINATIONS listed
  when given, and the action in the vocabulary either way. `compiler`
  and `interpreter`: 165 of 165.
- **Full runs**, with 0587 and 0588 together: `vf-app` 3396 tests, of
  which 3394 pass (the two known failures, 0511). `vf-ui` browser 1412
  of 1413 (the known `typography.test.ts` 10px gap), worker 96 of 96.
  `vf-licence` 322 of 322.
