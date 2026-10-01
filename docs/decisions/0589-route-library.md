# 0589: The Route library — connectors as definitions

**Status: built and tested locally, not yet pushed or deployed.** It
touches `shared`, `vf-app`, `vf-ui` and `vf-licence`, and needs
**`vf-app` migration `0122`** and **`vf-licence` migration `0235`**.

## What was asked

This is slice 2 of the connector framework
(`claude/connector-framework-design.md`): connector definitions, the
Library screen, "Add to my routes", and version upgrades. Slice 1 (0585,
0586) built the engine, and Dan routed Destinations by business unit and
rule (0587, 0588). Then: *"Please go ahead with Slice 2"*.

## What was decided

### A connector is a definition

`shared/connectors/library.ts` defines `ConnectorDefinition`:

- id, version, direction, publisher and status (available or planned);
- categories (generic, ERP, automation);
- **the route it runs on** (`routeId`: its transport and engine);
- transport, formats, and a source's mechanism;
- whether a process may have more than one;
- for HTTPS out connectors, **settings**: the defaults it fills in, what
  it keeps **fixed** (method, format), and the ways of signing in it
  allows;
- where its target documents its API.

Names and descriptions are interface strings, `connector.<id>.name` and
`.description`.

**Standard connectors ship with the platform**, in `shared`, so every
instance runs exactly the definitions its code was built with, and they
cannot drift. The design note had them published from the control plane.
That matters only once partners publish their own (slice 4), which will
use the same shape from `vf-licence`.

**The library holds:**

| Status | Destinations | Sources |
|---|---|---|
| Available | **HTTPS out**; **Automation webhook**, a new preset on HTTPS out for Zapier, Make and Power Automate (POST and JSON fixed, no sign-in or a header key); the **ERP CSV file**, one per process | **Email in**, **HTTPS in**, **AP upload** (one per process) |
| Planned | **Oracle Fusion Payables**, **SAP S/4HANA Cloud**, **Sage Intacct**, **Microsoft Dynamics 365 Business Central**, **SFTP file drop** | **SFTP in**, **EDI in**, **Peppol in** |

### Instances remember their connector

`route_instances.connector_id` and `connector_version` (migration
`0122`). Null is the route's own standard connector (same id), version 1,
so every instance made before the library has one
(`connectorOfInstance`).

**Adding a Destination** (`POST /processes/:id/destinations
{ name, connectorId }`):

- only an available Destination connector is accepted;
- an HTTPS out connector fills in its defaults;
- the ERP CSV file is refused where the process already has one, and
  added (as `erp-<process>`) where it does not;
- a planned connector, a Source connector or an unknown id is refused.

**Saving** keeps what the connector fixes (`fixed_setting`) and allows
only its ways of signing in (`auth_not_allowed`).

### Versions and upgrades

`GET /route-instances/:id/connector` now gives the connector, its
version, the library's latest, and what it fixes.

Where the library has a later version, **Upgrade**
(`POST …/connector/upgrade`):

- applies what the connector fixes;
- keeps the Destination's own address, sign-in, secret, reference and
  units;
- where the new version no longer allows its way of signing in, moves
  to the new default and says so;
- records the new version.

### The Library screen

`GET /connector-library` (Admin.Configure) lists every connector, the
instances made from each (by process, with whether each can upgrade),
and the processes.

**Route library** opens from the Routes screen. It lights Routes in the
menu, so no screen changes colour. It shows:

- filter chips: All, Destinations, Sources, ERP, Automation, Generic;
- **a card per connector**: its initials, Source or Destination, name,
  publisher, description, transport, formats and version;
- where it is in use, each a link to it on Process routes;
- Available, In use or Planned, and how many routes can upgrade;
- **Add to my routes** for an available connector: choose the process
  and a name. A Destination is added paused; a Source is added as a
  source of its mechanism. It then opens on Process routes, selected.

**On Process routes:**

- **Add a destination** offers the available Destination connectors
  from the library;
- an HTTPS out Destination's panel shows **Connector: … · version N**,
  with **Upgrade** where a later version waits;
- its form greys out what the connector fixes and offers only the ways
  of signing in it allows.

`vf-licence` `0235` adds the strings, every connector's name and
description, and the screen's help.

## Not built

- **Planned connectors.** Oracle, SAP, Sage, Business Central and SFTP
  are listed so an integrator can see what is coming. Their mappings are
  slice 3, and the ERP connectors are slice 5.
- **Copying a connector to make your own.** That comes with outbound
  mapping (slice 3), where there is something to change.
- **Partner connectors** (slice 4).

## Verification

- **`vf-app`**, `connector-library.test.ts`, 5 tests:
  - the library lists every standard connector; the ERP CSV file and the
    mailbox show as in use, made before the library, at version 1;
  - adding the Automation webhook fills in its defaults, records it at
    version 1, and the panel, the library and the flow show it;
  - it refuses CSV, PUT and basic sign-in, and accepts a header key; the
    generic HTTPS out fixes nothing;
  - a planned connector, a Source, an unknown one and a second ERP CSV
    file are refused, and the file is added to a process without one;
  - with a version 2 in the library, it is offered; upgrading keeps the
    address, reference and units, moves sign-in to the new default and
    says so; a second upgrade is refused.

  With `https-out` and `erp-destination`: 32 of 32.
- **`vf-ui`**, `routes.test.ts`, 4 new tests with the real strings:
  - the cards with in use, planned, upgrade, and filters;
  - adding a Destination connector to a chosen process, then opening it
    there;
  - adding a Source connector as a source of its mechanism;
  - the panel's connector line, Upgrade, the fixed fields disabled, and
    only the allowed sign-ins.

  The panel test fails against the interface before this change.
  "Add a destination" now sends `connectorId`, and its test is updated.
  Worker allowlist: the library and upgrade paths.
- **`shared`**, `connectors/library.test.ts`, 3 tests:
  - ids are unique, and every available connector has a route;
  - every HTTPS out connector's default sign-in is one it allows, and it
    fixes only what it gives a default for;
  - every source has its mechanism, and each standard route resolves to
    its own connector.
- **Migrations** replay: `vf-app` 122, `vf-licence` 235.
- **Full runs**:
  - `vf-app`: 3401 tests, of which 3399 pass (the two known failures,
    0511);
  - `vf-ui`: browser 1416 of 1417 (the known `typography.test.ts` 10px
    gap); worker 98 of 98;
  - `vf-licence`: 322 of 322;
  - `shared`: 407, of which 403 pass and 1 is skipped (the three known
    failures).
