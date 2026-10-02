# 0603: The operator console, laid out like the main site

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-admin` and `vf-licence`. No migrations. Deploy vf-licence and
vf-admin.

## What was asked

Dan, 2 October: *"I wondered if you could overhaul the Operator Screen …
introduce the site menu, like we have on the main site? With side menu
options to cover the different activities, such as Provisioning,
Connector Auth, Partners, Audit. If you can think of more sensible
options - I'm open to suggestion."*

Asked to choose, Dan took:

- **the grouped menu**, like the main site's;
- **this pass**: the menu, a Home page, today's panels moved under it,
  and new screens for Customers & environments and People & access;
  Interface wording and Branding come next;
- by "Connector Auth" he meant the connectors waiting for review.

## What was decided

### The menu

The console was one long page. It is now a side menu by activity, each
item a screen of its own at `#/name`, as on the main site: the logo at
the head, grouped items with icons that take their colour on hover and
when open, and who is signed in at the foot. On a narrow screen the menu
becomes a bar across the top. It keeps its own words and colours
(0140): only the shape is shared.

| Group | Screen | What it holds |
|---|---|---|
| Overview | **Home** | What waits (sign-ups, connector reviews, invitations not sent), the fleet at a glance, and the latest actions |
| Customers | **Sign-up requests** | Waiting for a decision (as before), and the decisions taken, with any approved but not yet provisioned |
| | **Customers & environments** | *New.* Each customer, its environments, where each is deployed (or not yet), its Worker and database, its licence, how many people; **Licence** to change plan, volume, dates and state; **Config** for what a deploy needs; **Add customer** |
| | **People & access** | *New.* Everyone who can sign in, by customer, with the environments they may reach: **Grant** one of their customer's, **Revoke** (asked once more). The invitations, as before |
| Partners | **Partners** | As before |
| | **Connector reviews** | The review queue and every partner connector (0600) |
| Platform | Interface wording, Branding | Shown as *next*: their screens come in a later pass |
| Audit | **Admin log** | The latest 500 actions, found by who, what or which, and by outcome, with what each acted on |

**Badges** on Sign-up requests, Connector reviews and People & access say
what waits wherever the operator is. Each screen loads on its own and
says in place why it could not (0602).

Building an environment stays with the provisioning script (0038):
Customers & environments shows where each stands, and the licence and
config it needs.

### What the new screens read (`vf-licence`)

Two privileged reads, recorded in the admin log at the edge:

- `GET /fleet-overview`: every customer with its environments, whether
  each is deployed (its address is not the `not-yet-deployed.invalid`
  placeholder), its licence and its people;
- `GET /people?customerId=`: everyone with a password, the environments
  they may reach (when, and by whom), and the partner they work for.

Never a key or a password hash. `vf-admin` forwards both, and only them.

## Not built

- **Interface wording** and **Branding** screens, next.
- **Rotating an environment's key** or deleting one from the console:
  both break a running instance until its own secret is changed, so they
  stay with the scripts for now.
- Setting a password for someone: invitations (0593) do that, by the
  person themselves.

## Verification

- **`vf-licence`**, `operator-views.test.ts`, 3 tests: the fleet by
  customer with deployed, licence and people, and never a key; people
  with the environments they may reach and their partner, never a hash,
  and by customer; both privileged. Full run 353 of 353.
- **`vf-admin`**: the two routes forwarded, and a lookalike refused. 13
  of 13.
- **The console**, in a browser against stubbed routes: every screen
  opens from its address and its menu item, with the badges; a licence
  saved, the config read, access granted, and revoked only on the second
  click, each sending what it should; the log filtered. Screenshots, and
  at phone width.
