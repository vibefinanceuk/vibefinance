# 0596: A partner may submit from a customer it serves

**Status: built and tested locally, not yet pushed or deployed.**
`vf-licence` (and **migration `0243`**, two strings) and `vf-ui`.

## What was asked

After 0595, Dan looked for **Waiting for review** in Acme's environment,
where his partner's person works and had made an HTTPS out Destination.
The card was not there: 0595 shows it only in the partner's own sandbox,
and he had none yet (*"Ahh - I have no partner sandbox yet"*). A sandbox
is a whole new instance to provision. Offered the choice, he chose to let
a partner's people **also submit from any environment of a customer the
partner serves**.

## What was decided

- In **a customer's environment**, the card shows, and submitting works,
  only for **one of the people of a partner linked to that customer**.
  The customer's own people never see it.
- In a **partner's sandbox**, nothing changes (0595).
- A customer the partner does not serve, or no longer serves, is refused
  (`not_partner_environment`).
- The connector records **the environment it was built in**
  (`source_environment_id`, as before); the state says where
  (`source`: the customer, and whether it is the sandbox), so the review
  (step 3) can show it.
- The card says so: *"You are working in Acme Ltd's environment, a
  customer Northwind serves. VibeFinance will see that this version was
  built here."*

## Verification

- **`vf-licence`**, `partner-connectors.test.ts`, 2 new tests and 2
  updated: a partner's person submits and withdraws from a linked
  customer's environment, recorded there; a customer's own person is
  refused; a customer not served, or unlinked, is refused. 4 fail against
  the code before this change. Full run 342 of 342.
- **`vf-ui`**, `routes.test.ts`, 1 new test: the note in a customer's
  environment and not in the sandbox. Full browser run 1443, of which
  1442 pass (the known `typography.test.ts` 10px gap).
- `vf-app` is unchanged but for a comment; its submission tests pass.
