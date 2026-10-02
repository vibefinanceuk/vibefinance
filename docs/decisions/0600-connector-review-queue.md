# 0600: The review queue (connector framework slice 4, step 3)

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-licence`, `vf-admin` and `vf-ui`, and needs **`vf-licence`
migrations `0246`** (connector suspension) **and `0247`** (strings).
Deploy vf-licence, vf-admin and vf-ui. `vf-app` is unchanged.

## What was asked

Step 3 of slice 4 as agreed (`claude/connector-framework-design.md`,
9.2): *"Review queue in the operator console: see the definition and
mapping, approve or send back with a reason; suspend."* Dan decided on 1
October that VibeFinance approves each version before any customer sees
it. On 2 October: *"Yes - please go ahead with step 3"*.

## What was decided

### The queue (`vf-admin`, **Connectors waiting for review**)

A new panel near the top of the operator console, under the decisions
waiting. For each version waiting, oldest first, everything the decision
rests on:

- the connector's name and version, the partner, and whether the partner
  or the connector is suspended;
- what it does, and the **notes for the reviewer**;
- who submitted it and when;
- **where it was built**: the partner's sandbox, or a named customer's
  environment and its kind (0596);
- **which customers** it is for: all the partner serves, or by name;
- how it sends (method and format), how it signs in and which sign-ins it
  allows, what customers may not change, the reference path, the look-up
  lists it needs, and the vendor's documentation;
- its **outbound mapping field by field**: level, the name it is sent as,
  where it comes from (or its fixed value), and its functions, with how
  empties are sent;
- the whole definition as submitted, folded away.

**Approve**, or **Send back** with a reason, which is required: the
partner sees it on their card (0595).

Beneath, **All partner connectors**: each connector with its versions and
their state, and **Suspend** with a reason, or **Reinstate**.

### In the control plane (`vf-licence`, `connector-review.ts`, migration `0246`)

| Route (privileged) | Does |
|---|---|
| `GET /partner-connectors?status=submitted` | the queue, oldest first; without `status`, every connector's versions |
| `POST /partner-connectors/:id/versions/:v/approve` | approved, with who and when |
| `POST /partner-connectors/:id/versions/:v/return` `{ reason }` | sent back with the reason |
| `POST /partner-connectors/:id/suspend` `{ reason }`, `/reinstate` | a whole connector |

- Only a version **waiting** is decided; one decided or withdrawn meanwhile
  is refused (`not_waiting`).
- Every decision is recorded on the version (`reviewed_by`, `reviewed_at`,
  `review_reason`) and in the admin log, attributed to the operator Access
  verified.
- `partner_connectors` gains `status` (active or suspended) with when, by
  whom and why. **A suspended connector takes no new versions**
  (`connector_suspended`) until it is reinstated, and (step 4) will not be
  offered to customers. Destinations already made from it keep working.

### What the partner sees (`vf-ui`)

The card already showed **Approved**, and **Sent back** with the reason.
Now, when a connector is suspended, it says so with the reason, and
offers no form: *"VibeFinance has suspended this connector: … New
versions cannot be submitted until it is reinstated."* Strings: `0247`.

## Not built (step 4)

Approved partner connectors in their customers' Route library, labelled
"Partner · name", added with their mapping and look-up lists by name, and
upgraded as standard ones are.

## Verification

- **`vf-licence`**, `connector-review.test.ts`, 4 tests: the queue with
  everything a decision rests on, oldest first, from a customer's
  environment and the sandbox; send back needs a reason and the partner
  sees it; approve, recorded; only what waits; suspend with a reason, seen
  by the partner, refusing new versions, then reinstated; the router: all
  privileged, refused without the key, attributed. Full run 346 of 346.
- **`vf-admin`**: the review routes forwarded and a lookalike refused.
  12 of 12.
- **`vf-ui`**, `routes.test.ts`, 1 new test: the suspended connector's
  note, no form, versions listed. It fails against the interface before
  this change. Browser 1448, of which 1447 pass (the known
  `typography.test.ts` 10px gap); worker 111 of 111.
- **The panel**, in a browser against stubbed routes: Send back, Approve,
  Suspend and Reinstate each send what they should. Screenshot.
- `vf-app` is unchanged.
