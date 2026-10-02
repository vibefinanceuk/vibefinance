# 0601: Partner connectors in the Route library (connector framework slice 4, step 4)

**Status: built and tested locally, not yet pushed or deployed.** It
touches `shared`, `vf-app`, `vf-licence` and `vf-ui`, and needs **`vf-app`
migration `0125`** (the kept copies) and **`vf-licence` migration `0248`**
(strings). Deploy vf-licence, vf-app and vf-ui. `vf-admin` is unchanged.

## What was asked

Step 4 of slice 4 (`claude/connector-framework-design.md`, 9.2): *"Partner
connectors in customers' Route library: approved versions for linked
customers, labelled 'Partner · name', added and upgraded as standard ones,
carrying their mapping."* Dan, 2 October, once the review queue (0600) was
working: *"lets goto step 4"*.

## What was decided

### What the control plane offers (`vf-licence`)

`GET /environments/:id/library-connectors`, with the environment's own key
(as invitations, 0593, and submissions, 0595). For the environment's
customer, each connector:

- of an **active** partner that **serves** the customer (0592), or whose
  **sandbox** this is, so a partner can add its own to try it;
- **not suspended** (0600);
- at its **latest version VibeFinance approved** whose audience includes
  the customer. A version for Acme only leaves Globex on the earlier one.

Never one waiting, sent back or withdrawn. With its name, description,
partner and definition.

### What the instance keeps (`vf-app`, migration `0125`)

When the Route library opens (and the **Add a destination** list, which
reads it), `vf-app` asks, and keeps **a copy of each version** it is
offered in `partner_connector_copies`, marking which are offered now. So:

- a Destination made from one **never changes without Upgrade**;
- one **no longer offered** (suspended, its partner suspended or
  unlinked) leaves the library, unless in use, where it shows as **No
  longer offered** and cannot be added again. Destinations made from it
  keep working from their copy;
- if the control plane cannot be reached, the library says so, and what
  was kept stands;
- the definition is checked again (`validatePartnerDefinition`) before it
  is kept.

Everything else resolves a partner connector as it does a standard one,
through `connectorLibrary(db)`: the standard connectors and the kept
partner ones. Its id is `partner:<connector id>`, so it can never collide
with a standard id.

### Adding one

**Add to my routes** (or Add a destination) makes an HTTPS out
Destination, paused, with the connector's settings, as a standard one.
And, carrying its own layout:

- its **outbound mapping goes live** as the Destination's version 1,
  marked as copied from the connector and version;
- each **look-up list it needs by name** is the customer's list of that
  name; where there is none, an empty one is made, described "Needed by
  <connector>", and the Destination's panel says it is empty and needs
  filling in.

**Saving** keeps what the connector fixes and only its sign-ins, as for
the automation webhook (0589). Where it fixes its own layout, the
customer may still change the mapping.

### Upgrading

A later approved version is offered as **Upgrade**, on the library card
and on the Destination, as a standard one (0589). It applies what the
connector fixes and keeps the customer's address, sign-in, secrets,
reference and units. And its mapping:

- **while the Destination's live mapping is still the one the connector
  gave it**, the new version's mapping goes live, and lists it needs are
  made;
- **once the customer has published their own changes**, theirs is kept,
  and the Destination says so: *"Your own changes to the outbound mapping
  were kept, so it does not follow the new version."*

### What people see (`vf-ui`)

- **Route library:** a partner's card shows its own name and description,
  **Partner · Northwind**, the look-up lists it reads, and **Its own
  layout** where it sends one. A **Partner** filter. **No longer
  offered** on one withdrawn but in use. The note at the top now says
  partners' connectors are kept up to date by their partner, each version
  approved by VibeFinance.
- **The Destination:** *Connector: Oracle Payables · version 1*, **Partner
  · Northwind**, the lists it reads (an empty one marked), and after
  Upgrade what happened to the mapping.

## Not built

- **Partner Sources.** A partner connector is an HTTPS out Destination
  only, as submitted (0595).
- **A partner withdrawing a whole connector** from the library itself.
  VibeFinance can suspend one (0600), which has the same effect.
- **Pushing new versions** to instances. An instance learns of one when
  its library is next opened; Upgrade stays the customer's choice.

## Verification

- **`vf-licence`**, `library-connectors.test.ts`, 4 tests:
  - nothing until approved; then for the customers it serves and its
    sandbox, never another;
  - the latest approved version, never one waiting or sent back, and per
    audience;
  - suspending the connector or the partner, or unlinking the customer,
    stops it;
  - the environment's own key only.

  Full run 350 of 350.
- **`vf-app`**, `partner-library.test.ts`, 5 tests:
  - listed with partner, name and description, and kept; an unreachable
    control plane leaves the copy; an invalid definition is never kept;
  - added with its settings and mapping live, the list it needs made (or
    the customer's own used); fixed settings and sign-ins held; the
    mapping still editable;
  - Upgrade offered on the card and the flow; the mapping follows while
    unchanged, and the customer's own is kept;
  - no longer offered: gone from the library unless in use, not added,
    still working;
  - through the router, with the control plane failing.

  `connector-library.test.ts` updated for the connector's new fields.
- **`vf-ui`**, `routes.test.ts`, 2 new tests: the partner card, filter,
  lists, the failure note and one no longer offered; the Destination's
  connector line, empty list and what Upgrade did. Both fail against the
  interface before this change. Browser 1450, of which 1449 pass (the
  known `typography.test.ts` 10px gap); worker 111 of 111.
- **`shared`**: 416, of which 412 pass and 1 is skipped (the three known
  failures).
- **Migrations** replay: `vf-app` 125, `vf-licence` 248.
- **Screenshot** of the library with a partner card.
