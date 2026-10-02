# 0595: Submit for review (connector framework slice 4, step 2)

**Status: built and tested locally, not yet pushed or deployed.** It
touches `shared`, `vf-licence`, `vf-app` and `vf-ui`, and needs
**`vf-licence` migrations `0241`** (partner connectors) **and `0242`**
(strings). Deploy vf-licence, vf-app and vf-ui. `vf-admin` is unchanged:
the review queue is step 3.

## What was asked

Slice 4's second step, as agreed on 1 October
(`claude/connector-framework-design.md`, 9.2): *"a Destination with its
settings and published outbound mapping becomes a connector version, sent
to the control plane by one of the partner's people."* Dan, 2 October:
*"lets start with step 2"*.

## What was decided

### The connector (`shared/connectors/partner-connector.ts`)

A partner's connector is an HTTPS out Destination as data
(`vibefinance.connector.v1`):

- **how it sends**: method, format (the standard JSON, the CSV layout, or
  its own mapping), how it signs in (and a key's header name), and where
  the reply holds the target's reference;
- **what a customer may not change**: the method, the format, or both;
- **the ways a customer may sign in**, which must include its own;
- **its outbound mapping** (0591), when it sends its own layout;
- **the look-up lists it reads, by name.** In the sandbox a mapping names
  lists by id; the connector names them by name, and each customer will
  fill in a list of that name (step 4). `renameLists` swaps one for the
  other;
- the vendor's API documentation, optionally.

**Never an address or a secret.** Each customer sends to its own ERP with
its own credentials. `validatePartnerDefinition` accepts nothing outside
the shape, so a definition carrying `url`, `secret` or anything else is
refused in words.

### Made from the Destination (`vf-app`, `library-submission-route.ts`)

The definition is built **from what the Destination does**, never from
what the page sends: its method, format, sign-in and reference path,
and the **published** version of its mapping with lists renamed. The
person chooses only:

- the connector's name and what it does (shown to customers);
- notes for the reviewer (shown only to VibeFinance);
- what customers may not change, and which sign-ins are allowed;
- the vendor's documentation;
- **which customers see it**: all those the partner serves, or chosen
  ones.

It cannot be submitted while it sends its own layout with no version of
its mapping published, or reads a list that no longer exists. A draft not
yet published is noted: the published version is what is submitted.

### In the control plane (`vf-licence`, migration `0241`, `partner-connectors.ts`)

- **`partner_connectors`**: one per Destination in a partner's sandbox
  (`source_environment_id`, `source_instance_id`), so submitting from it
  again makes its next version. Its name is unique for the partner.
- **`partner_connector_versions`**: each version with its name,
  description, notes, audience, definition, who submitted it and when,
  and its review (step 3): `submitted`, `approved`, `returned` with a
  reason, or `withdrawn`.

Asked by the sandbox with **its own environment key**, as invitations are
(0593), for the person signed in there. The control plane checks:

- the environment is a **partner's sandbox**, and the partner is active;
- the person is **one of the partner's people** (0592);
- the audience is customers **the partner serves**;
- the definition is one a connector can carry;
- **one version waits at a time**: another is refused until it is
  decided or **withdrawn**.

| Route (`vf-licence`) | Does |
|---|---|
| `GET /environments/:id/partner-connectors?instanceId=&email=` | whether this is a partner's sandbox; the partner, its customers, whether this person may submit, and this Destination's connector with its versions |
| `POST /environments/:id/partner-connectors` | submit a version |
| `POST /environments/:id/partner-connectors/withdraw` | withdraw one still waiting |

`vf-app`: `GET`/`POST /route-instances/:id/library-submission` and
`POST …/withdraw`, under `Admin.Configure`. `vf-ui` proxies them.

### On screen (`vf-ui`, `destinations.js`)

In a partner's sandbox only, an HTTPS out Destination's panel has
**Share in the Route library**:

- what it is for, and that VibeFinance reviews each version before any
  customer sees it, and that its address and secrets are never sent;
- each version: **Waiting for review**, **Approved**, **Sent back** with
  the reviewer's reason, or **Withdrawn**; when and by whom; which
  customers; **Withdraw** while one waits;
- why it cannot be submitted, if it cannot (not the partner's person, the
  partner suspended, no published mapping, a list gone), and a draft not
  yet published;
- the form, and **Submit for review** (or **Submit version N**) top right.

Outside a partner's sandbox the card is not there. Strings in English and
German: `vf-licence` `0242`.

## Not built (the next steps)

- **Step 3, the review queue** in the operator console: see the
  definition, mapping and notes, approve, or send back with a reason.
- **Step 4, approved partner connectors in linked customers' Route
  libraries**, labelled "Partner · name", added with their mapping and
  look-up lists by name, and upgraded as standard ones.
- Submitting a Source as a connector.

## Verification

- **`shared`**, `partner-connector.test.ts`, 3 tests: a whole definition
  accepted; refusals (an address, a secret, a sign-in not allowed, an
  unnamed list, a missing mapping, an unknown fixed setting, an `http`
  link, a bad reference path); list ids swapped for names and back.
- **`vf-licence`**, `partner-connectors.test.ts`, 4 tests: a customer's
  environment is not a partner's; the partner, its customers and who may
  submit; version 1 waiting, a second refused, withdraw, version 2 with
  chosen customers and a new name; the refusals (a customer's environment,
  someone not the partner's, an unlinked or empty audience, no
  description, a definition carrying an address, a name taken, a
  suspended partner); the router takes the sandbox's own key only.
- **`vf-app`**, `library-submission.test.ts`, 4 tests: built from the
  Destination with its sign-in, reference and published mapping and
  lists by name, whatever the page sends, with no address, secret, user
  name or list id in it; refused without a published mapping, and what
  the control plane says passed on; the standard layout with no mapping;
  the router: `Admin.Configure` only, with this environment's key and the
  person's email.
- **`vf-ui`**, `routes.test.ts`, 4 new tests with the real strings: not
  there outside a sandbox; the form submits what is chosen and says it is
  waiting; versions with their review and Withdraw, and no form while one
  waits; the reasons it cannot be submitted. All 4 fail against the
  interface before this change. Worker allowlist: the two paths.
- **Migrations** replay: `vf-licence` 242.
- **Full runs**: `vf-app` 3415, of which 3412 pass (the two known failures, 0511, and the known router timeout in `index.test.ts`, which passes alone); `vf-ui` browser 1442, of which 1441 pass
  (the known `typography.test.ts` 10px gap), worker 109 of 109;
  `vf-licence` 340 of 340; `shared` 416, of which 412 pass, 1 skipped (the
  three known failures). `vf-admin` unchanged.
- A screenshot of the card in a partner's sandbox, with a version sent
  back.
