# 0592: Partners in the control plane (connector framework slice 4, step 1)

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-licence` and `vf-admin`, and needs **`vf-licence` migration
`0237`**. `vf-app`, `vf-ui` and `shared` are unchanged.

## What was asked

Slice 4 of the connector framework is partner authoring: a system
integrator builds a connector, and it reaches the customers it serves. On
1 October Dan decided (`claude/connector-framework-design.md`, 9.1):

1. *A partner is its own record*, created by VibeFinance in the operator
   console, with its people by email.
2. *VibeFinance links a partner to the customers it serves.*
3. *Partners build and try in a partner sandbox*, a VibeFinance
   environment of their own.
4. *VibeFinance approves each version* before any customer sees it.

He agreed to build it in four steps, and said *"Yes please"* to step 1:
partners in the control plane.

## What was decided

### The records (migration `0237`)

- **`partners`**: id, name, status (active or suspended, with when, by
  whom and why), who created it, and its sandbox's customer record.
- **`partner_people`**: the partner's people, by email, with who added
  them. These are the people who will submit connectors for it (step 2).
- **`partner_customers`**: the customers VibeFinance links it to, with
  who linked each. Their Route library will show its approved connectors
  (step 4).

### The sandbox is an ordinary customer

Making a partner also makes a customer record, `partner-<id>`, named
"*Name* (partner sandbox)". Its environments are provisioned, its people
given passwords (`/credentials`) and access (`/access`), exactly as for
any customer. Nothing about provisioning, sign-in or the instance
changes, and a sandbox is a real VibeFinance with real invoices to try
connectors on, as decided.

So that the gap is visible, the operator console shows, for each of the
partner's people, whether they can sign in to the sandbox yet: no password
for it yet, no access yet, or can sign in.

A sandbox is never a customer the partner serves: linking it is refused,
and the customer list marks whose sandbox each is.

### Suspending

Suspending takes a reason, and records who and when. Reinstating clears
it. Suspended, a partner's connectors will leave customers' libraries
(step 4), while Destinations already made from them keep working.

### Routes (`vf-licence`, `partners-route.ts`)

Every one is privileged (the admin key), and recorded in the admin log at
the edge, attributed to the operator Access verified:

| Route | Does |
|---|---|
| `GET /partners` | each partner, its sandbox and environments, its people (and whether each can sign in), its customers |
| `POST /partners` `{ id, name }` | a partner and its sandbox customer |
| `POST`/`DELETE /partners/:id/people` `{ email }` | add or remove one of its people |
| `POST`/`DELETE /partners/:id/customers` `{ customerId }` | link or unlink a customer it serves |
| `POST /partners/:id/suspend` `{ reason }`, `/reinstate` | suspend or reinstate |
| `GET /customers` | every customer, for linking, with whose sandbox each is |

Refusals are in words: an id that is not 2 to 40 lower-case letters,
digits and hyphens; no name; an id or name taken; a bad email; a person
or customer already there; a customer that does not exist; a sandbox;
suspending without a reason.

### The operator console (`vf-admin`)

`vf-admin` forwards the new routes (its allow-list), and its screen has a
**Partners** panel between the decisions waiting and the log:

- **Add partner**: id and name;
- each partner: its name, id and status (with the reason when suspended);
  - **Sandbox**: its customer id and environments, or that none is
    provisioned yet;
  - **People**: each with whether they can sign in to the sandbox,
    **Remove**, and **Add person**;
  - **Customers it serves**: each with **Unlink**, and **Link** from the
    customers not yet linked (never a sandbox);
  - **Suspend** with a reason, or **Reinstate**.

## Not built (the next steps)

- **Step 2, Submit for review** from the sandbox: a Destination with its
  settings and published outbound mapping becomes a connector version,
  sent to the control plane by one of the partner's people.
- **Step 3, the review queue** in the operator console: approve, or send
  back with a reason.
- **Step 4, partner connectors in linked customers' Route libraries.**
- Provisioning the sandbox from this panel. It is provisioned as any
  customer is.

## Verification

- **`vf-licence`**, `partners-route.test.ts`, 6 tests:
  - a partner with its sandbox customer, and the refusals;
  - people, with whether each can sign in to the sandbox;
  - linking and unlinking, never a sandbox or an unknown customer; the
    customer list marks sandboxes;
  - suspend with a reason, and reinstate;
  - the router: every route privileged, refused without the key, and the
    refusal recorded;
  - with the key: created, linked and listed, attributed to the operator.
- **`vf-admin`**: 1 new test, the partner routes forwarded and a lookalike
  refused. It fails against the Worker before this change.
- **The panel**, in a browser against stubbed routes: Link, Add person,
  Suspend, Reinstate and Add partner each send what they should, and a
  linked customer or a sandbox is not offered to link. Screenshot.
- **Migrations** replay: `vf-licence` 237.
- **Full runs**: `vf-licence` 328 of 328; `vf-admin` 10 of 10. `vf-app`,
  `vf-ui` and `shared` are unchanged.
